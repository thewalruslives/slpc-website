/* Second Line Crew Call — CSV import.
   Built to swallow an export of the Master Calendar as-is: its own header
   names, Excel's date format, and boil times written like "5-8". */
window.SLPC_CSV = (function () {
  "use strict";

  /* ── parsing ── */
  // Handles quoted fields, commas and newlines inside quotes, "" escapes,
  // CRLF, and a leading BOM.
  function parse(text){
    text = String(text || "").replace(/^﻿/, "");
    const rows = [];
    let row = [], field = "", i = 0, quoted = false;
    while (i < text.length){
      const c = text[i];
      if (quoted){
        if (c === '"'){
          if (text[i+1] === '"'){ field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"'){ quoted = true; i++; continue; }
      if (c === ","){ row.push(field); field = ""; i++; continue; }
      if (c === "\r"){ i++; continue; }
      if (c === "\n"){ row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    row.push(field);
    rows.push(row);
    // drop trailing blank lines
    while (rows.length && rows[rows.length-1].every(f => !f.trim())) rows.pop();
    return rows;
  }

  /* ── header matching ── */
  const norm = h => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  // Exact normalized names first, then prefix rules for the long ones
  // (the sheet has "Nick bring craw and work direclty to location" — typo included).
  const EXACT = {
    place:"place", venue:"place", location:"place",
    date:"date",
    city:"city", town:"city",
    boiltime:"boil", boil:"boil", eventtime:"boil", time:"boil",
    supporthours:"support", support:"support", supporttime:"support", crewhours:"support",
    soldestimate:"soldEstimate", soldest:"soldEstimate", estimate:"soldEstimate",
    nickwork:"nickWork", delivery:"nickWork", deliverynote:"nickWork",
    aaronnote:"aaronNote", note:"notes", notes:"notes",
    confirmed:"confirmed",
    musicbooking:"band", band:"band", music:"band", act:"band",
    staffneeded:"staffNeeded", crewneeded:"staffNeeded", staff:"staffNeeded",
    howmany:"staffNeeded", headcount:"staffNeeded",
    kind:"kind", type:"kind"
  };
  const PREFIX = [
    ["nickdropoff", "nickDropoffDublin"],
    ["nickbringcraw", "nickDirectToLocation"],
    ["nickneedsride", "nickNeedsRide"],
    ["support", "assigned"]   // Support A / Support B / Support C
  ];

  function mapHeaders(header){
    const map = [], ignored = [];
    header.forEach((h, idx) => {
      const n = norm(h);
      if (!n) { map.push(null); return; }
      if (EXACT[n]) { map.push(EXACT[n]); return; }
      const pre = PREFIX.find(p => n.startsWith(p[0]));
      if (pre) { map.push(pre[1]); return; }
      map.push(null);
      ignored.push(String(h).trim());
    });
    return { map, ignored };
  }

  /* ── value parsing ── */
  const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

  function parseDate(raw){
    const s = String(raw || "").trim();
    if (!s) return null;
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);                 // 2026-10-03
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(s);        // 10/3/2026, 10-3-26
    if (m){
      let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
      return iso(y, +m[1], +m[2]);                                   // US month-first
    }
    m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})?$/i.exec(s);      // Oct 3, 2026
    if (m){
      const mi = MONTHS.indexOf(m[1].slice(0,3).toLowerCase());
      if (mi >= 0) return iso(m[3] ? +m[3] : new Date().getFullYear(), mi+1, +m[2]);
    }
    m = /^(\d{1,2})\s+([a-z]{3,9})\.?,?\s*(\d{4})?$/i.exec(s);      // 3 Oct 2026
    if (m){
      const mi = MONTHS.indexOf(m[2].slice(0,3).toLowerCase());
      if (mi >= 0) return iso(m[3] ? +m[3] : new Date().getFullYear(), mi+1, +m[1]);
    }
    return null;
  }
  function iso(y, mo, d){
    if (!(y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    return y + "-" + String(mo).padStart(2,"0") + "-" + String(d).padStart(2,"0");
  }

  // "5-8" -> 17:00/20:00. SLPC events run midday into the evening, so a bare
  // 1..7 is PM and 8..11 is AM. Trailing junk like "(band 12:30-3:30)" is kept
  // as a note by the caller, not parsed.
  const RANGE = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

  function hour24(h, mer, isEnd, start){
    h = +h;
    if (mer){
      mer = mer.toLowerCase();
      if (mer === "am") return h === 12 ? 0 : h;
      return h === 12 ? 12 : h + 12;
    }
    let v = h === 12 ? 12 : (h >= 8 ? h : h + 12);
    if (isEnd && start != null && v <= start && v + 12 <= 23) v += 12;
    return v;
  }
  // A lone time with no end, e.g. an extra-labor day that just starts at 10.
  const SINGLE = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;

  function parseRange(raw){
    const s = String(raw || "").trim();
    if (!s) return { start:null, end:null, rest:"" };
    const m = RANGE.exec(s);
    if (!m){
      const one = SINGLE.exec(s);
      if (one){
        const h = hour24(one[1], one[3], false);
        return { start: String(h).padStart(2,"0") + ":" + String(+(one[2]||0)).padStart(2,"0"),
                 end: null, rest: "" };
      }
      return { start:null, end:null, rest:s };
    }
    const sh = hour24(m[1], m[3], false);
    const eh = hour24(m[4], m[6], true, sh);
    const pad = (h, mm) => String(h).padStart(2,"0") + ":" + String(+(mm||0)).padStart(2,"0");
    return { start: pad(sh, m[2]), end: pad(eh, m[5]), rest: s.slice(m[0].length).trim() };
  }

  function parseBool(raw){
    const s = String(raw || "").trim().toLowerCase();
    if (["true","yes","y","x","1","✓"].includes(s)) return true;
    if (["false","no","n","0",""].includes(s)) return false;
    return false;
  }
  const PLACEHOLDER = new Set(["x","?","na","n/a","-","none",""]);
  const clean = v => {
    const s = String(v == null ? "" : v).trim();
    return PLACEHOLDER.has(s.toLowerCase()) ? "" : s;
  };
  const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g,"-")
    .replace(/^-|-$/g,"") || "x";

  /* ── rows -> events ── */
  // existing: the events already in the database. A row matching one on venue
  // AND date reuses that row's id, so importing updates instead of duplicating
  // even when the stored id was minted some other way.
  function toEvents(text, existing){
    const known = new Map();
    for (const e of (existing || [])){
      if (e && e.date && e.place) known.set(e.date + "|" + slug(e.place), e.id);
    }
    const rows = parse(text);
    if (!rows.length) return { events:[], errors:[{ line:0, why:"The file is empty." }], ignored:[] };

    const { map, ignored } = mapHeaders(rows[0]);
    if (!map.includes("place") || !map.includes("date")){
      return { events:[], ignored, errors:[{ line:1,
        why:"Couldn't find a Place and a Date column in the header row." }] };
    }

    const events = [], errors = [], seen = new Set();
    for (let r = 1; r < rows.length; r++){
      const cells = rows[r];
      if (cells.every(c => !String(c).trim())) continue;

      const g = {}; const assigned = [];
      map.forEach((key, i) => {
        if (!key) return;
        const v = cells[i];
        if (key === "assigned"){ const a = clean(v); if (a) assigned.push(a); return; }
        if (g[key] === undefined || g[key] === "") g[key] = v;
      });

      const place = clean(g.place).replace(/^@\s*/, "");
      const dateRaw = String(g.date || "").trim();
      // Month banners like "OCT" sit in the date column of the real sheet.
      if (!place && !parseDate(dateRaw)) continue;
      if (!place){ errors.push({ line:r+1, why:"No venue name." }); continue; }
      const date = parseDate(dateRaw);
      if (!date){
        errors.push({ line:r+1, why:'Couldn’t read the date "' + dateRaw + '".', place });
        continue;
      }

      const boil = parseRange(g.boil);
      const sup  = parseRange(g.support);
      const extra = [clean(g.notes), boil.rest, sup.rest].filter(Boolean).join(" · ");

      const matched = known.get(date + "|" + slug(place));
      const id = matched || (date + "-" + slug(place)).slice(0,120);
      if (seen.has(id)){ errors.push({ line:r+1, place,
        why:"Same venue and date appears twice in this file — only the first was kept." }); continue; }
      seen.add(id);

      events.push({
        id, place, date,
        city: clean(g.city),
        event_start: boil.start, event_end: boil.end,
        support_start: sup.start, support_end: sup.end,
        band: clean(g.band),
        sold_estimate: clean(g.soldEstimate),
        notes: extra,
        aaron_note: clean(g.aaronNote),
        nick_work: clean(g.nickWork),
        confirmed: parseBool(g.confirmed),
        kind: clean(g.kind).toLowerCase() === "labor" ? "labor" : "event",
        nick_dropoff_dublin: parseBool(g.nickDropoffDublin),
        nick_direct_to_location: parseBool(g.nickDirectToLocation),
        nick_needs_ride: parseBool(g.nickNeedsRide),
        staff_needed: Math.max(0, Math.min(99, parseInt(clean(g.staffNeeded), 10) || 0)),
        assigned_staff: assigned,
        poster_path: null,
        source: "CSV import",
        _isNew: !matched,
        _line: r + 1,
        _noTimes: !boil.start && !sup.start
      });
    }
    return { events, errors, ignored };
  }

  const TEMPLATE =
    "Place,Date,City,Boil Time,Support Hours,Staff Needed,Band,Sold Estimate,Notes,Aaron Note,Confirmed\n" +
    "Humble Sea Pacifica,10/4/2026,Pacifica,5-8,3-9,3,Back Dimples,200,,Bring the big pot,TRUE\n" +
    "Woods Bar & Brewery,11/8/2026,Oakland,12-3,10-5,2,,150,Ticketed,,FALSE\n";

  return { parse, mapHeaders, parseDate, parseRange, parseBool, toEvents, TEMPLATE };
})();
