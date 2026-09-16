/* Second Line Crew Call — CSV export.
   Three shapes: the schedule (which re-imports through csv.js unchanged), the
   crew's answers one row at a time, and the wide staffing grid that mirrors the
   old worksheet. */
window.SLPC_EXPORT = (function () {
  "use strict";
  const K = window.SLPC;

  // Quote anything that could break a cell; double up embedded quotes.
  function cell(v){
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const row = arr => arr.map(cell).join(",");
  // The BOM makes Excel read UTF-8 properly; csv.js strips it on the way back.
  const build = rows => "﻿" + rows.map(row).join("\r\n") + "\r\n";

  // 24-hour so it is unambiguous, and csv.js parses it straight back.
  const range = (a, b) => {
    const s = K.hhmm(a), e = K.hhmm(b);
    return s && e ? s + "-" + e : s || e || "";
  };
  const yn = v => v ? "TRUE" : "FALSE";

  function inScope(e, scope){
    const t = K.today();
    if (scope === "upcoming") return e.date >= t;
    if (scope === "past")     return e.date <  t;
    return true;
  }
  const sorted = (events, scope) => events
    .filter(e => inScope(e, scope))
    .slice().sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 :
      (a.place||"").localeCompare(b.place||""));

  /* 1. The schedule. Header names match what csv.js imports, so this file can
        be edited in a spreadsheet and loaded straight back in. */
  function schedule(events, scope){
    const rows = [["Place","Date","City","Boil Time","Support Hours","Staff Needed",
      "Band","Sold Estimate","Notes","Aaron Note","Confirmed","Kind",
      "Support A","Support B","Support C",
      "Delivery Note","Nick Drop off in Dublin only",
      "Nick bring craw and work directly to location",
      "Nick needs ride from Dublin to location"]];
    for (const e of sorted(events, scope)){
      const crew = e.assigned_staff || [];
      rows.push([e.place, e.date, e.city,
        range(e.event_start, e.event_end), range(e.support_start, e.support_end),
        e.staff_needed || "", e.band, e.sold_estimate, e.notes, e.aaron_note,
        yn(e.confirmed), e.kind || "event",
        crew[0] || "", crew[1] || "", crew[2] || "",
        e.nick_work, yn(e.nick_dropoff_dublin),
        yn(e.nick_direct_to_location), yn(e.nick_needs_ride)]);
    }
    return build(rows);
  }

  /* 2. Every answer, one per line — the shape to pivot or filter in a sheet. */
  function answers(events, responses, scope){
    const rows = [["Date","Place","City","Support Hours","Person","Answer",
      "On The Crew","Can Deliver","Note","Answered At"]];
    const byId = new Map(events.map(e => [e.id, e]));
    const list = responses
      .filter(r => byId.has(r.event_id) && inScope(byId.get(r.event_id), scope))
      .slice().sort((a,b) => {
        const ea = byId.get(a.event_id), eb = byId.get(b.event_id);
        return ea.date < eb.date ? -1 : ea.date > eb.date ? 1 : a.staff.localeCompare(b.staff);
      });
    for (const r of list){
      const e = byId.get(r.event_id);
      rows.push([e.date, e.place, e.city, range(e.support_start, e.support_end),
        r.staff, r.status || "no answer", yn(K.isConfirmed(e, r.staff)),
        yn(r.can_deliver), r.note, r.updated_at ? String(r.updated_at).slice(0,16).replace("T"," ") : ""]);
    }
    return build(rows);
  }

  /* 3. The wide grid: a column per person, the way the old worksheet read. */
  function grid(events, responses, roster, scope){
    const head = ["Place","Date","City","Boil Time","Support Hours","Staff Needed",
      "On The Crew","Still Needed"].concat(roster);
    const rows = [head];
    for (const e of sorted(events, scope)){
      const rs = responses.filter(r => r.event_id === e.id);
      const line = [e.place, e.date, e.city,
        range(e.event_start, e.event_end), range(e.support_start, e.support_end),
        e.staff_needed || "",
        (e.assigned_staff || []).length,
        e.staff_needed ? K.shortfall(e, rs) : ""];
      for (const n of roster){
        if (K.isConfirmed(e, n)) line.push("confirmed");
        else {
          const r = rs.find(x => x.staff === n);
          line.push(r && r.status ? r.status : "");
        }
      }
      rows.push(line);
    }
    return build(rows);
  }

  function download(text, filename){
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const stamp = () => K.today();

  return { schedule, answers, grid, download, stamp, sorted };
})();
