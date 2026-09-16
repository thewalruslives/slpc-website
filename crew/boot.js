/* Second Line Crew Call — shared crew-side boot.
   The passcode gate, the data load, "who am I", and writing an answer, used by
   index.html, me.html and calendar.html so the three cannot drift apart.

   The page supplies: #gate, #gate-form, #gate-code, #gate-go, #gate-status,
   #top, #app, #me-select, #banner, and a render callback. */
window.SLPC_BOOT = (function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const K = window.SLPC;

  const S = { code:null, events:[], resp:[], roster:[], me:null, loaded:false };
  let sb = null, onRender = () => {};

  const store = {
    get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
    set(k,v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k,v); } catch(e){} }
  };

  const respFor = id => S.resp.filter(r => r.event_id === id);
  const mineFor = id => S.me ? S.resp.find(r => r.event_id === id && r.staff === S.me) : null;

  async function load(code){
    const { data, error } = await sb.rpc("crew_load", { p_passcode: code });
    if (error) throw error;
    if (!data){ const e = new Error("bad code"); e.badCode = true; throw e; }
    S.events = data.events || [];
    S.resp   = data.responses || [];
    S.roster = data.roster || [];
    S.loaded = true;
  }

  function fillRoster(){
    const sel = $("#me-select"); if (!sel) return;
    sel.innerHTML = '<option value="">Pick your name</option>' +
      S.roster.map(n => '<option value="' + K.esc(n) + '">' + K.esc(n) + "</option>").join("");
    if (S.me && S.roster.includes(S.me)) sel.value = S.me;
    else if (S.me){ S.me = null; store.set("slpc.crew.me", null); }
  }

  function banner(html){
    const b = $("#banner"); if (!b) return;
    if (!html){ b.hidden = true; return; }
    b.innerHTML = html; b.hidden = false;
  }

  async function submit(eventId, patch){
    if (!S.me) return;
    let r = S.resp.find(x => x.event_id === eventId && x.staff === S.me);
    if (!r){ r = { event_id:eventId, staff:S.me, status:"", can_deliver:false, note:"" }; S.resp.push(r); }
    Object.assign(r, patch);
    onRender();
    const { error } = await sb.rpc("submit_response", {
      p_passcode: S.code, p_event_id: eventId, p_staff: S.me,
      p_status: r.status || "", p_can_deliver: !!r.can_deliver, p_note: r.note || ""
    });
    banner(error ? "<b>That didn’t save.</b> " +
      K.esc(error.message || "Check your connection and try again.") : "");
    return !error;
  }

  function showApp(){
    $("#gate").hidden = true;
    const t = $("#top"); if (t) t.hidden = false;
    $("#app").hidden = false;
    fillRoster(); onRender();
  }
  function showGate(msg){
    $("#gate").hidden = false;
    const t = $("#top"); if (t) t.hidden = true;
    $("#app").hidden = true;
    const st = $("#gate-status"); if (!st) return;
    st.className = msg ? "status err" : "status";
    st.textContent = msg || "";
  }

  function start(opts){
    onRender = (opts && opts.onRender) || (() => {});
    if (!K.configured()){
      const slot = $("#setup-slot");
      if (slot) slot.innerHTML = K.setupNotice();
      return;
    }
    const cfg = window.SLPC_CONFIG;
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY,
      { auth: { persistSession: false } });

    const sel = $("#me-select");
    if (sel) sel.addEventListener("change", e => {
      S.me = e.target.value || null; store.set("slpc.crew.me", S.me); onRender();
    });

    const form = $("#gate-form");
    if (form) form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const code = $("#gate-code").value.trim(); if (!code) return;
      const btn = $("#gate-go"); btn.disabled = true;
      $("#gate-status").className = "status"; $("#gate-status").textContent = "Checking…";
      try {
        await load(code);
        S.code = code; store.set("slpc.crew.code", code);
        showApp();
      } catch (err){
        showGate(err && err.badCode ? "That code doesn’t match. Check with Aaron."
          : "Couldn’t reach the schedule. Check your connection.");
      } finally { btn.disabled = false; }
    });

    S.me = store.get("slpc.crew.me");
    if (sel && S.me) sel.value = S.me;
    const saved = store.get("slpc.crew.code");
    if (saved){
      load(saved).then(() => { S.code = saved; showApp(); })
        .catch(err => { if (err && err.badCode) store.set("slpc.crew.code", null); showGate(""); });
    } else showGate("");

    let busy = false;
    async function refresh(){
      if (!S.code || busy || document.hidden) return;
      busy = true;
      try { await load(S.code); fillRoster(); onRender(); } catch(e){} finally { busy = false; }
    }
    setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  return { S, start, submit, respFor, mineFor, banner, fillRoster };
})();
