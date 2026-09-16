/* Second Line Crew Call — shared helpers and event rendering.
   Used by both index.html (crew) and admin.html. */
window.SLPC = (function () {
  "use strict";

  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const MONL = ["January","February","March","April","May","June","July","August",
                "September","October","November","December"];

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g,"-")
    .replace(/^-|-$/g,"") || "x";

  function ymd(d){
    return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") +
           "-" + String(d.getDate()).padStart(2,"0");
  }
  const today = () => ymd(new Date());

  function parts(iso){
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? { y:+m[1], m:+m[2], d:+m[3],
                 dow:new Date(+m[1], +m[2]-1, +m[3]).getDay() } : null;
  }
  // Postgres hands back "17:00:00"; an <input type=time> gives "17:00".
  function mins(t){
    const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
    return m ? +m[1]*60 + +m[2] : null;
  }
  const hhmm = t => { const v = mins(t); return v == null ? "" :
    String(Math.floor(v/60)).padStart(2,"0") + ":" + String(v%60).padStart(2,"0"); };

  function fmt(t){
    const v = mins(t); if (v == null) return "";
    let h = Math.floor(v/60); const mm = v % 60, ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + (mm ? ":" + String(mm).padStart(2,"0") : "") + " " + ap;
  }
  function span(a, b){
    const A = fmt(a), B = fmt(b);
    if (!A && !B) return ""; if (!B) return A; if (!A) return B;
    return (A.slice(-2) === B.slice(-2) ? A.slice(0,-3) : A) + "–" + B;
  }
  function addMin(t, d){
    const v = mins(t); if (v == null) return null;
    const x = Math.max(0, Math.min(23*60+59, v + d));
    return String(Math.floor(x/60)).padStart(2,"0") + ":" + String(x%60).padStart(2,"0");
  }

  const rkey = (eventId, staff) => eventId + "__" + slug(staff);

  function posterURL(path){
    if (!path) return "";
    const c = window.SLPC_CONFIG || {};
    return c.SUPABASE_URL + "/storage/v1/object/public/" +
           (c.POSTER_BUCKET || "posters") + "/" + path;
  }

  /* ── the time track: support window drawn as a bar, boil lit inside it ── */
  function trackHTML(e){
    const ss = mins(e.support_start), se = mins(e.support_end);
    const bs = mins(e.event_start),  be = mins(e.event_end);
    const lo = ss != null ? ss : bs, hi = se != null ? se : be;
    if (lo == null || hi == null || hi <= lo){
      const t = span(e.event_start, e.event_end) || span(e.support_start, e.support_end);
      return '<div class="tbd">' + (t ? "Support " + esc(t) : "Times to be confirmed") + "</div>";
    }
    let boil = "";
    if (bs != null && be != null && be > bs){
      const l = Math.max(0, (bs-lo)/(hi-lo)*100);
      const w = Math.min(100-l, (be-bs)/(hi-lo)*100);
      boil = '<div class="track-boil" style="left:' + l.toFixed(2) +
             '%;width:' + w.toFixed(2) + '%"></div>';
    }
    return '<div class="track"><div class="track-bar">' + boil + '</div>' +
      '<div class="track-lab"><span>' + esc(fmt(e.support_start || e.event_start)) + '</span>' +
      '<span>' + esc(fmt(e.support_end || e.event_end)) + '</span></div></div>' +
      '<div class="times">' +
        (bs != null ? '<span class="boil"><span class="k">Boil</span><b>' +
          esc(span(e.event_start, e.event_end)) + '</b></span>' : '') +
        (ss != null ? '<span><span class="k">Support</span><b>' +
          esc(span(e.support_start, e.support_end)) + '</b></span>' : '') +
      '</div>';
  }

  function detailLines(e){
    const lines = [];
    if (e.band) lines.push("<div><b>Band</b> · " + esc(e.band) + "</div>");
    if (e.assigned_staff && e.assigned_staff.length)
      lines.push("<div><b>Penciled in</b> · " + esc(e.assigned_staff.join(", ")) + "</div>");
    const del = [];
    if (e.nick_dropoff_dublin)     del.push("Drop off in Dublin only");
    if (e.nick_direct_to_location) del.push("Bring craw and work on site");
    if (e.nick_needs_ride)         del.push("Needs a ride from Dublin");
    if (e.nick_work)               del.push(e.nick_work);
    if (del.length) lines.push("<div><b>Delivery</b> · " + esc(del.join(" · ")) + "</div>");
    if (e.sold_estimate) lines.push("<div><b>Sold estimate</b> · " + esc(e.sold_estimate) + "</div>");
    if (e.notes)      lines.push("<div>" + esc(e.notes) + "</div>");
    if (e.aaron_note) lines.push('<div class="aaron">' + esc(e.aaron_note) + "</div>");
    return lines.length ? '<div class="lines">' + lines.join("") + '</div>' : "";
  }

  function crewHTML(rs, me){
    if (!rs.length)
      return '<div class="crew"><span class="chip none">Nobody has answered yet</span></div>';
    const order = { yes:0, maybe:1, no:2 };
    rs = rs.slice().sort((a,b) =>
      (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.staff.localeCompare(b.staff));
    return '<div class="crew">' + rs.map(r =>
      '<span class="chip ' + r.status + (r.staff === me ? " me-chip" : "") + '">' +
      esc(r.staff) +
      (r.can_deliver ? '<span class="dv">Can deliver</span>' : "") +
      (r.note ? '<span class="dv" title="' + esc(r.note) + '">Note</span>' : "") +
      "</span>").join("") + "</div>";
  }

  function answerHTML(e, mine, me){
    if (!me) return '<div class="answer"><span class="pickfirst">' +
      "Pick your name up top to sign up for this one.</span></div>";
    const r = mine || {};
    const win = span(e.support_start, e.support_end) || span(e.event_start, e.event_end);
    const b = (v, cls, label) => '<button type="button" class="rb ' + cls +
      '" data-act="status" data-v="' + v + '" aria-pressed="' + (r.status === v) + '">' +
      label + "</button>";
    return '<div class="answer">' +
      '<div class="q">Can you work ' + (win ? "<em>" + esc(win) + "</em>" : "this one") + "?</div>" +
      '<div class="rowbtns">' + b("yes","yes","Yes, I can work") + b("maybe","maybe","Maybe") +
        b("no","no","Can’t make it") +
        '<button type="button" class="rb deliver" data-act="deliver" aria-pressed="' +
        (!!r.can_deliver) + '">I can deliver</button></div>' +
      '<div class="subrow"><input class="note-in" data-act="note" ' +
        'id="note-' + esc(e.id) + '" ' +
        'placeholder="Add a note — arrival time, what you can bring, anything Aaron should know" ' +
        'value="' + esc(r.note || "") + '">' +
        '<span class="saved" data-saved hidden>Saved</span></div></div>';
  }

  /* opts: {responses, me, showAnswer, showEdit} */
  function evHTML(e, opts){
    const o = opts || {}, rs = o.responses || [];
    const p = parts(e.date), past = e.date < today();
    const labor = e.kind === "labor";
    const nc = !past && !labor && !rs.some(r => r.status === "yes");
    const tags = [];
    if (labor) tags.push('<span class="tag labor">Extra labor</span>');
    else if (!e.confirmed && !past) tags.push('<span class="tag hold">Not confirmed</span>');
    if (nc) tags.push('<span class="tag needs">No crew yet</span>');
    const mine = o.me ? rs.find(r => r.staff === o.me) : null;
    return '<article class="ev' + (past ? " past" : "") + '" data-id="' + esc(e.id) +
      '" data-needs="' + (nc ? 1 : 0) + '">' +
      '<div class="when"><span class="dow">' + (p ? DOW[p.dow] : "") + '</span>' +
        '<span class="dnum">' + (p ? p.d : "?") + '</span>' +
        '<span class="mon">' + (p ? MON[p.m-1] : "") + '</span></div>' +
      '<div class="ev-main">' +
        '<div class="hd"><h3>' + esc(e.place || "Untitled event") + "</h3>" +
          (e.city ? '<span class="city">' + esc(e.city) + "</span>" : "") + tags.join("") +
          (o.showEdit ? '<button type="button" class="edit" data-act="edit">Edit</button>' : "") +
        "</div>" +
        trackHTML(e) + detailLines(e) +
        (e.poster_path ? '<img class="poster" loading="lazy" src="' + esc(posterURL(e.poster_path)) +
          '" alt="Poster for ' + esc(e.place) + '">' : "") +
        crewHTML(rs, o.me) +
        (o.showAnswer && !past ? answerHTML(e, mine, o.me) : "") +
      "</div></article>";
  }

  function monthGroups(rows){
    let out = "", last = "";
    for (const r of rows){
      const p = parts(r.e ? r.e.date : r.date), key = p ? p.y + "-" + p.m : "";
      if (key !== last){
        last = key;
        out += '<div class="month"><h2>' + (p ? MONL[p.m-1] + " " + p.y : "Undated") +
               '</h2><div class="rule"></div></div>';
      }
      out += r.html;
    }
    return out;
  }

  function configured(){
    const c = window.SLPC_CONFIG || {};
    return c.SUPABASE_URL && c.SUPABASE_ANON_KEY &&
           c.SUPABASE_URL.indexOf("PASTE_") === -1 &&
           c.SUPABASE_ANON_KEY.indexOf("PASTE_") === -1;
  }

  function setupNotice(){
    return '<div class="setup"><h2>Not connected yet</h2>' +
      "<p>Open <code>crew/config.js</code> and paste in your Supabase project URL " +
      "and anon public key, then push the change. Until then this page has nothing " +
      "to read.</p></div>";
  }

  return { DOW, MON, MONL, esc, slug, ymd, today, parts, mins, hhmm, fmt, span,
           addMin, rkey, posterURL, trackHTML, detailLines, crewHTML, answerHTML,
           evHTML, monthGroups, configured, setupNotice };
})();
