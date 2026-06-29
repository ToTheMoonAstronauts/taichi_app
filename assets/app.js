/* Tai Motion members' app — Supabase-backed SPA.
 * Boot: auth session -> subscription gate -> load content + user state from DB -> route.
 * Mutations persist to Supabase (RLS-scoped). Per-day task/plan checklists use localStorage.
 */
(function () {
  const C = window.CONTENT, view = document.getElementById("view");
  const el = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lv = (l) => l === "Advanced" ? "adv" : l === "Intermediate" ? "int" : "beg";
  const img = (seed, w, h) => `https://picsum.photos/seed/${encodeURIComponent("ctc-" + seed)}/${w}/${h}`;

  let DATA = null, ST = null, PROFILE = null;

  const NAV = [
    { id: "home", label: "Home", icon: "🏠" }, { id: "exercises", label: "Exercises", icon: "🧘" },
    { id: "tracking", label: "Tracking", icon: "📈" }, { id: "stress", label: "Stress release", icon: "🌬️" },
    { id: "academy", label: "Academy", icon: "📖" }, { id: "challenges", label: "Challenges", icon: "🏆" },
    { id: "favorites", label: "Favorites", icon: "♡" },
  ];
  const MOBILE_NAV = ["home", "exercises", "tracking", "stress", "favorites"];

  function renderNav(active) {
    const nav = document.getElementById("nav"), bn = document.getElementById("bottomnav");
    if (nav) nav.innerHTML = NAV.map(n => `<a href="#/${n.id}" class="${active === n.id ? "active" : ""}"><span class="ic">${n.icon}</span>${n.label}</a>`).join("");
    if (bn) bn.innerHTML = NAV.filter(n => MOBILE_NAV.includes(n.id)).map(n => `<a href="#/${n.id}" class="${active === n.id ? "active" : ""}"><span class="ic">${n.icon}</span>${n.label}</a>`).join("");
    const name = (PROFILE && (PROFILE.name || PROFILE.email)) || "You";
    const av = document.getElementById("avatar"), em = document.getElementById("acctEmail");
    if (av) av.textContent = (name[0] || "Y").toUpperCase();
    if (em) { em.textContent = name; em.style.cursor = "pointer"; em.title = "Sign out"; em.onclick = () => AUTH.signOut(); }
  }

  // ---------- Auth / gate ----------
  function renderAuth() {
    document.getElementById("nav").innerHTML = ""; document.getElementById("bottomnav").innerHTML = "";
    view.innerHTML = `<div class="gate"><div class="big">🪷</div>
      <h1 class="page">Sign in</h1><p class="page-sub">Enter your email and we'll send you a magic link.</p>
      <div class="card" style="max-width:380px;margin:0 auto"><input id="email" class="logger" type="email" placeholder="you@example.com" style="width:100%;border:2px solid var(--line);border-radius:12px;padding:14px;font-size:16px">
      <button class="btn block" id="send" style="margin-top:12px">Send magic link</button><div id="msg" class="page-sub" style="margin-top:12px"></div></div></div>`;
    view.querySelector("#send").onclick = async () => {
      const email = view.querySelector("#email").value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { view.querySelector("#email").focus(); return; }
      view.querySelector("#send").disabled = true;
      const { error } = await AUTH.signIn(email);
      view.querySelector("#msg").innerHTML = error ? "⚠️ " + esc(error.message) : "✓ Check your email for the sign-in link.";
    };
  }
  function renderGate() {
    renderNav("");
    view.innerHTML = `<div class="gate"><div class="big">🔒</div><h1 class="page">No active plan</h1>
      <p class="page-sub">We couldn't find an active subscription for this account.</p>
      <a class="btn" href="https://taimotion.com">Get your plan</a>
      <p class="page-sub" style="margin-top:16px"><button class="backlink" onclick="AUTH.signOut()">Sign out</button></p></div>`;
  }

  // ---------- Views ----------
  function vHome() {
    const name = (PROFILE && PROFILE.name) || "there";
    const hero = DATA.workouts.find(w => w.locked) || DATA.workouts[0];
    const tdone = C.tasks.filter(t => DB.dayGet("tasks")[t.id]).length;
    const tasksHtml = C.tasks.map(t => { const d = DB.dayGet("tasks")[t.id];
      return `<div class="task ${d ? "done" : ""}" data-task="${t.id}"><span class="box">${d ? "✓" : ""}</span><span class="lab">${esc(t.label)}</span></div>`; }).join("");
    view.innerHTML = `
      <div class="greet"><div class="day">${new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</div>
        <h2>Good day, ${esc(name)}</h2><p>A little movement today goes a long way.</p></div>
      <div class="widgets"><div class="col">
        <div class="hero-card" data-go="${hero.id}"><img src="${img(hero.seed,800,500)}" alt=""><div class="veil"></div>
          <div class="meta"><div class="pills"><span>${hero.min} min</span><span>${hero.level}</span><span>Today's session</span></div>
          <div class="title">${esc(hero.title)}</div></div><button class="play">▶</button></div>
        <div class="card"><div class="section-title" style="margin:0 0 6px"><h2>Today's tasks</h2><span style="color:var(--muted);font-weight:700">${tdone}/${C.tasks.length}</span></div>${tasksHtml}</div>
      </div><div class="col">
        <div class="card mini"><div><div style="font-weight:700">Weight</div><div class="v">${ST.latest.weight??"—"} <small>kg</small></div></div><a class="btn ghost" href="#/track/weight">Log</a></div>
        <div class="card mini"><div><div style="font-weight:700">Water</div><div class="v">${ST.latest.water??0} <small>glasses</small></div></div><a class="btn ghost" href="#/track/water">Log</a></div>
        <div class="card mini"><div><div style="font-weight:700">Mood</div><div class="v" style="font-size:16px;color:var(--muted)">${ST.latest.mood??"Not set"}</div></div><a class="btn ghost" href="#/track/mood">Log</a></div>
      </div></div>`;
    view.querySelectorAll(".task").forEach(t => t.onclick = () => { DB.dayToggle("tasks", t.dataset.task); vHome(); });
    view.querySelector(".hero-card").onclick = () => location.hash = "#/workout/" + hero.id;
  }

  function wcard(w) {
    const fav = !!ST.favorites[w.id];
    return `<div class="wcard" data-id="${w.id}" ${w.locked ? 'data-locked="1"' : ""}>
      <div class="thumb"><img src="${img(w.seed,400,260)}" alt=""><span class="b badge ${lv(w.level)}">${w.level}</span>
      ${w.locked ? `<div class="lock">🔒<span>${esc(w.locked)}</span></div>` : `<button class="fav" data-id="${w.id}">${fav ? "♥" : "♡"}</button>`}</div>
      <div class="body"><div class="t">${esc(w.title)}</div><div class="m">${w.min} min · ${esc(w.focus || "")}</div></div></div>`;
  }

  function vExercises(tab) {
    tab = tab || "workouts";
    const tabs = `<div class="tabs"><button data-t="workouts" class="${tab==='workouts'?'on':''}">Workouts</button><button data-t="plan" class="${tab==='plan'?'on':''}">Plan</button></div>`;
    let body = "";
    if (tab === "workouts") {
      const active = sessionStorage.getItem("exfilter") || "All";
      const chips = ["All", ...DATA.categories];
      body = `<div class="filters">${chips.map(c => `<button data-c="${c}" class="${c===active?'on':''}">${c}</button>`).join("")}</div>` +
        (active === "All" ? DATA.categories : [active]).map(cat => {
          const items = DATA.workouts.filter(w => w.cat === cat); if (!items.length) return "";
          return `<div class="section-title"><h2>${esc(cat)}</h2></div><div class="${active==='All'?'row-scroll':'grid-cards'}">${items.map(wcard).join("")}</div>`;
        }).join("");
    } else {
      const total = DATA.plan.length, done = DATA.plan.filter(p => DB.dayGet("plan")[p.id]).length;
      body = `<div class="plan-prog"><span>Today's progress</span><span>${done}/${total}</span></div>
        <div class="pbar"><i style="width:${total?Math.round(done/total*100):0}%"></i></div>
        ${DATA.plan.map(p => `<div class="plan-item"><img src="${img(p.seed,200,150)}" alt="">
          <div class="pt"><div class="n">${esc(p.title)}</div><div class="s">${p.level} · ${p.min} min</div></div>
          <button class="chk ${DB.dayGet("plan")[p.id]?'on':''}" data-p="${p.id}">${DB.dayGet("plan")[p.id]?'✓':''}</button></div>`).join("")}`;
    }
    view.innerHTML = `<h1 class="page">Exercises</h1>${tabs}${body}`;
    view.querySelectorAll(".tabs button").forEach(b => b.onclick = () => location.hash = "#/exercises/" + b.dataset.t);
    view.querySelectorAll(".filters button").forEach(b => b.onclick = () => { sessionStorage.setItem("exfilter", b.dataset.c); vExercises("workouts"); });
    view.querySelectorAll(".wcard").forEach(c => { if (!c.dataset.locked) c.onclick = (e) => { if (e.target.closest(".fav")) return; location.hash = "#/workout/" + c.dataset.id; }; });
    view.querySelectorAll(".fav").forEach(f => f.onclick = async (e) => { e.stopPropagation(); const on = !ST.favorites[f.dataset.id]; ST.favorites[f.dataset.id] = on || undefined; if (!on) delete ST.favorites[f.dataset.id]; await DB.toggleFav(f.dataset.id, on); vExercises(tab); });
    view.querySelectorAll(".chk").forEach(c => c.onclick = () => { DB.dayToggle("plan", c.dataset.p); vExercises("plan"); });
  }

  function vWorkout(id) {
    const w = DATA.workouts.find(x => x.id === id); if (!w) return notFound();
    const done = !!ST.completed[id], fav = !!ST.favorites[id];
    view.innerHTML = `<button class="backlink" onclick="history.back()">‹ Back</button>
      <div class="player"><img src="${img(w.seed,1000,560)}" alt=""><div class="ov"><div class="pbtn">▶</div><div class="note">Video coming soon — hosting to be added</div></div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="badge ${lv(w.level)}">${w.level}</span><h1 class="page" style="margin:0;font-size:24px">${esc(w.title)}</h1></div>
      <p class="page-sub">${w.min} min · ${esc(w.focus || "")}</p>
      <p style="color:#34433b">A gentle ${esc((w.cat||"").toLowerCase())} session. Follow along at your own pace — sit tall, breathe slowly, and stop if anything hurts.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:14px"><button class="btn" id="markDone">${done?"✓ Completed":"Mark as complete"}</button><button class="btn ghost" id="favBtn">${fav?"♥ Saved":"♡ Save"}</button></div>`;
    view.querySelector("#markDone").onclick = async () => { const on = !ST.completed[id]; if (on) ST.completed[id] = true; else delete ST.completed[id]; await DB.toggleSession(id, on); vWorkout(id); };
    view.querySelector("#favBtn").onclick = async () => { const on = !ST.favorites[id]; if (on) ST.favorites[id] = true; else delete ST.favorites[id]; await DB.toggleFav(id, on); vWorkout(id); };
  }

  function vTracking() {
    view.innerHTML = `<h1 class="page">Tracking</h1><p class="page-sub">Log and review your daily metrics.</p>
      <div class="track-grid">${C.trackers.map(t => { const last = ST.latest[t.id];
        return `<div class="track-tile" data-m="${t.id}"><div class="ic">${t.icon}</div><div class="tt"><div class="l">${t.label}</div>
        <div class="v">${last!=null?esc(last)+(t.unit?" "+t.unit:""):"No entries yet"}</div></div><span style="color:var(--muted)">›</span></div>`; }).join("")}</div>`;
    view.querySelectorAll(".track-tile").forEach(t => t.onclick = () => location.hash = "#/track/" + t.dataset.m);
  }

  function vTrack(metric) {
    const t = C.trackers.find(x => x.id === metric); if (!t) return notFound();
    const input = t.numeric
      ? `<div class="logger"><input id="val" type="number" inputmode="decimal" placeholder="Enter ${t.label.toLowerCase()} (${t.unit})"></div>`
      : `<div class="moodrow">${["😟","😕","😐","🙂","😄"].map((m,i)=>`<button data-mood="${i+1}">${m}</button>`).join("")}</div>`;
    const hist = ST.history[metric] || [];
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/tracking'">‹ Tracking</button>
      <h1 class="page">${t.icon} ${t.label}</h1>
      <div class="card">${input}<button class="btn block" id="save" style="margin-top:14px">Save entry</button></div>
      <div class="hist">${hist.length?hist.map(h=>`<div class="h"><span>${esc(String(h.value))} ${t.unit||""}</span><span style="color:var(--muted)">${new Date(h.at).toLocaleString()}</span></div>`).join(""):'<p class="page-sub">No entries yet.</p>'}</div>`;
    let mood = null;
    view.querySelectorAll(".moodrow button").forEach(b => b.onclick = () => { mood = +b.dataset.mood; view.querySelectorAll(".moodrow button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); });
    view.querySelector("#save").onclick = async () => {
      let v = t.numeric ? view.querySelector("#val").value : mood;
      if (t.numeric) { if (!(parseFloat(v) >= 0)) { view.querySelector("#val").focus(); return; } }
      else { if (!v) return; v = ["Very low","Low","Okay","Good","Great"][v-1]; }
      await DB.addCheckin(metric, v, t.unit);
      (ST.history[metric] = ST.history[metric] || []).unshift({ value: t.numeric ? v : v, at: new Date().toISOString() });
      ST.latest[metric] = v; vTrack(metric);
    };
  }

  function vStress(tab) {
    const tabsList = Object.keys(DATA.stress); tab = tab && tabsList.includes(tab) ? tab : tabsList[0];
    const items = DATA.stress[tab] || [];
    view.innerHTML = `<h1 class="page">Stress release</h1><p class="page-sub">Calm your mind with short sessions.</p>
      <div class="tabs">${tabsList.map(t=>`<button data-t="${t}" class="${t===tab?'on':''}">${t}</button>`).join("")}</div>
      <div class="grid-cards">${items.map(m=>`<div class="wcard"><div class="thumb"><img src="${img(m.seed,400,260)}" alt="">
        <button class="fav" data-id="${m.id}">${ST.favorites[m.id]?"♥":"♡"}</button></div>
        <div class="body"><div class="t">${esc(m.title)}</div><div class="m">${m.min} min</div></div></div>`).join("")}</div>`;
    view.querySelectorAll(".tabs button").forEach(b => b.onclick = () => location.hash = "#/stress/" + b.dataset.t);
    view.querySelectorAll(".fav").forEach(f => f.onclick = async (e) => { e.stopPropagation(); const on = !ST.favorites[f.dataset.id]; if (on) ST.favorites[f.dataset.id] = true; else delete ST.favorites[f.dataset.id]; await DB.toggleFav(f.dataset.id, on, "media"); vStress(tab); });
  }

  function vFavorites() {
    const ids = Object.keys(ST.favorites);
    const all = [...DATA.workouts, ...Object.values(DATA.stress).flat()];
    const items = all.filter(x => ids.includes(x.id));
    view.innerHTML = `<h1 class="page">Favorites</h1>` + (items.length
      ? `<div class="grid-cards">${items.map(x => x.cat ? wcard(x) : `<div class="wcard"><div class="thumb"><img src="${img(x.seed,400,260)}"><button class="fav" data-id="${x.id}">♥</button></div><div class="body"><div class="t">${esc(x.title)}</div><div class="m">${x.min} min</div></div></div>`).join("")}</div>`
      : `<div class="soon"><div class="big">♡</div><p>No favorites yet. Tap the heart on any session to save it here.</p></div>`);
    view.querySelectorAll(".wcard[data-id]").forEach(c => { if (DATA.workouts.find(w=>w.id===c.dataset.id)) c.onclick = (e)=>{ if(e.target.closest(".fav"))return; location.hash="#/workout/"+c.dataset.id; }; });
    view.querySelectorAll(".fav").forEach(f => f.onclick = async (e) => { e.stopPropagation(); delete ST.favorites[f.dataset.id]; await DB.toggleFav(f.dataset.id, false); vFavorites(); });
  }

  function vSoon(title, icon, msg) { view.innerHTML = `<h1 class="page">${title}</h1><div class="soon"><div class="big">${icon}</div><p>${msg}</p></div>`; }
  function notFound() { view.innerHTML = `<div class="soon"><div class="big">🤷</div><p>Page not found.</p></div>`; }

  function route() {
    if (!DATA) return;
    const [r, a] = (location.hash.replace(/^#\//, "") || "home").split("/");
    renderNav(["workout","track"].includes(r) ? ({workout:"exercises",track:"tracking"}[r]) : r);
    window.scrollTo(0, 0);
    ({ home: vHome, exercises: () => vExercises(a), workout: () => vWorkout(a), tracking: vTracking,
       track: () => vTrack(a), stress: () => vStress(a), favorites: vFavorites,
       academy: () => vSoon("Academy", "📖", "Daily Tai Chi & healthy-aging lessons are coming here soon."),
       challenges: () => vSoon("Challenges", "🏆", "Short habit challenges are coming soon."),
     }[r] || vHome)();
  }

  // ---------- Boot ----------
  async function boot() {
    const session = await AUTH.session();
    if (!session) return renderAuth();
    PROFILE = await DB.profile();
    if (!DB.hasAccess(PROFILE)) return renderGate();
    [DATA, ST] = await Promise.all([DB.loadContent(), DB.loadUserState()]);
    if (!location.hash) location.hash = "#/home";
    route();
  }
  window.addEventListener("hashchange", route);
  SB.auth.onAuthStateChange((event) => { if (event === "SIGNED_IN" || event === "SIGNED_OUT") boot(); });
  boot();
})();
