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
    { id: "home", label: "Home", icon: "🏠" }, { id: "meals", label: "Meals", icon: "🍽️" },
    { id: "exercises", label: "Exercises", icon: "🧘" }, { id: "tracking", label: "Tracking", icon: "📈" },
    { id: "stress", label: "Stress release", icon: "🌬️" }, { id: "academy", label: "Academy", icon: "📖" },
    { id: "challenges", label: "Challenges", icon: "🏆" }, { id: "favorites", label: "Favorites", icon: "♡" },
  ];
  const MOBILE_NAV = ["home", "exercises", "meals", "tracking", "academy"];

  function renderNav(active) {
    const nav = document.getElementById("nav"), bn = document.getElementById("bottomnav");
    if (nav) nav.innerHTML = NAV.map(n => `<a href="#/${n.id}" class="${active === n.id ? "active" : ""}"><span class="ic">${n.icon}</span>${n.label}</a>`).join("");
    if (bn) bn.innerHTML = NAV.filter(n => MOBILE_NAV.includes(n.id)).map(n => `<a href="#/${n.id}" class="${active === n.id ? "active" : ""}"><span class="ic">${n.icon}</span>${n.label}</a>`).join("");
    const name = (PROFILE && (PROFILE.name || PROFILE.email)) || "You";
    const av = document.getElementById("avatar"), em = document.getElementById("acctEmail");
    const goProfile = () => { location.hash = "#/profile"; };
    if (av) { av.textContent = (name[0] || "Y").toUpperCase(); av.style.cursor = "pointer"; av.onclick = goProfile; }
    if (em) { em.textContent = name; em.style.cursor = "pointer"; em.title = "Profile & settings"; em.onclick = goProfile; }
  }

  // ---------- Auth / gate ----------
  function renderAuth() {
    document.getElementById("nav").innerHTML = ""; document.getElementById("bottomnav").innerHTML = "";
    view.innerHTML = `<div class="gate"><img class="gate-logo" src="assets/logo.webp" alt="Tai Motion">
      <h1 class="page">Sign in</h1><p class="page-sub">Enter your email and we'll send you a magic link.</p>
      <div class="card" style="max-width:380px;margin:0 auto"><input id="email" class="logger" type="email" placeholder="you@example.com" style="width:100%;border:2px solid var(--line);border-radius:12px;padding:14px;font-size:16px">
      <button class="btn block" id="send" style="margin-top:12px">Send magic link</button><div id="msg" class="page-sub" style="margin-top:12px"></div></div></div>`;
    view.querySelector("#send").onclick = async () => {
      const btn = view.querySelector("#send"), msg = view.querySelector("#msg");
      const email = view.querySelector("#email").value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { view.querySelector("#email").focus(); return; }
      btn.disabled = true; msg.style.color = ""; msg.textContent = "Sending…";
      const { error } = await AUTH.signIn(email);
      if (error) {
        const limited = error.status === 429 || /rate|too many/i.test(error.message || "");
        msg.style.color = limited ? "var(--muted)" : "var(--accent)";
        msg.innerHTML = limited
          ? "We just sent a few links — please wait a minute, then try again. (Also check your spam folder.)"
          : "⚠️ " + esc(error.message);
      } else {
        msg.style.color = "var(--primary-dark)";
        msg.innerHTML = "✓ Link sent! Check your email (and spam). Click it to sign in.";
      }
      // Re-enable with a short cooldown so the user can always retry (never lock them out).
      let s = error ? 30 : 20; const orig = "Send magic link";
      (function tick() {
        if (s <= 0) { btn.disabled = false; btn.textContent = orig; return; }
        btn.textContent = "Resend in " + s + "s"; s--; setTimeout(tick, 1000);
      })();
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
        <a class="pdfcard" href="assets/tai-chi-walking.pdf" download="Tai-Chi-Walking.pdf">
          <span class="pc-ic">🎁</span>
          <span class="pc-txt"><span class="pc-t">Download Free PDF: Tai Chi Walking</span><span class="pc-s">Click here to download</span></span>
          <span class="pc-dl">⬇</span></a>
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
    const steps = w.steps || [];
    const stepsHtml = steps.length ? `<div class="section-title"><h2>Workouts</h2><span style="color:var(--muted);font-weight:700">${steps.length}</span></div>
      <div class="card listcard">${steps.map((s, i) => `<div class="lrow"><span class="lnum">${String(i+1).padStart(2,"0")}</span>
        <span class="ltext"><span class="lt">${esc(s.t)}</span><span class="ls"><span class="badge ${lv(s.lvl)}">${esc(s.lvl||"Beginner")}</span> · ${s.min||""} min</span></span><span class="chev">›</span></div>`).join("")}</div>` : "";
    view.innerHTML = `<button class="backlink" onclick="history.back()">‹ Back</button>
      <div class="player"><img src="${img(w.seed,1000,560)}" alt=""><div class="ov"><span class="badge" style="position:absolute;top:16px;left:16px;background:rgba(255,255,255,.9)">COLLECTION</span><div class="pbtn">▶</div><div class="note">Video coming soon — hosting to be added</div></div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="badge ${lv(w.level)}">${w.level}</span><h1 class="page" style="margin:0;font-size:24px">${esc(w.title)}</h1>
        <button class="favico" id="favBtn" title="Save">${fav?"♥":"♡"}</button></div>
      <p class="page-sub">${w.min} min · ${esc(w.focus || "")}${steps.length?` · ${steps.length} workouts`:""}</p>
      <p style="color:#34433b">A gentle ${esc((w.cat||"").toLowerCase())} session. Follow along at your own pace — sit tall, breathe slowly, and stop if anything hurts.</p>
      ${stepsHtml}
      <div class="cta-fixed"><button class="btn block" id="markDone">${done?"✓ Completed — do it again":"▶ Start collection"}</button></div>`;
    view.querySelector("#markDone").onclick = async () => { const on = !ST.completed[id]; if (on) ST.completed[id] = true; else delete ST.completed[id]; await DB.toggleSession(id, on); vWorkout(id); };
    view.querySelector("#favBtn").onclick = async () => { const on = !ST.favorites[id]; if (on) ST.favorites[id] = true; else delete ST.favorites[id]; await DB.toggleFav(id, on); vWorkout(id); };
  }

  // ---------- Meals ----------
  let _recipes = null;
  let _mealCat = "all", _mealQ = "";
  let _week = null;         // { startISO, endISO, items:{'date|slot':item}, targets }
  let _selDay = null;       // ISO date currently selected
  const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
  const CAP = s => s.charAt(0).toUpperCase() + s.slice(1);

  function recipeById(id) { return (_recipes || []).find(r => r.id === id); }
  function curWeightKg() { const w = parseFloat(ST.latest.weight); return w > 0 ? w : null; }

  async function ensureWeek(force) {
    const ws = PLAN.weekStartOf(new Date());
    const startISO = PLAN.isoDate(ws), endISO = PLAN.isoDate(PLAN.addDays(ws, 6));
    if (!force) {
      const existing = await DB.getPlanItems(startISO, endISO);
      if (existing.length) {
        const run = await DB.getPlanRun(startISO);
        const items = {}; existing.forEach(it => items[it.plan_date + "|" + it.meal_type] = it);
        return { startISO, endISO, items, targets: run ? { daily: run.daily_kcal, split: run.split || {}, basis: run.start_weight_kg ? "personalized" : "default", goal: run.goal_weight_kg } : { daily: null, split: {}, basis: "default" } };
      }
    }
    const t = PLAN.targets(PROFILE, curWeightKg());
    const gen = PLAN.generateWeek(_recipes, t.split, ws, PROFILE.id || "seed");
    if (force) await DB.deletePlanWeek(startISO, endISO);
    await DB.savePlanRun({ week_start: startISO, start_weight_kg: curWeightKg(), goal_weight_kg: PROFILE.target_weight_kg || null,
      gender: t.gender, age: t.age, height_cm: t.height, activity: 1.35, daily_kcal: t.daily, split: t.split });
    await DB.savePlanItems(gen);
    const items = {}; gen.forEach(it => items[it.plan_date + "|" + it.meal_type] = Object.assign({ status: "pending" }, it));
    return { startISO, endISO, items, targets: { daily: t.daily, split: t.split, basis: t.basis, goal: PROFILE.target_weight_kg, missing: t.missing } };
  }

  async function vMeals(tab) {
    tab = tab === "library" ? "library" : "plan";
    view.innerHTML = `<h1 class="page">Meal plan</h1><p class="page-sub">Loading&hellip;</p>`;
    _recipes || (_recipes = await DB.recipes());
    const tabs = `<div class="tabs"><button data-t="plan" class="${tab==='plan'?'on':''}">Plan</button><button data-t="library" class="${tab==='library'?'on':''}">Library</button></div>`;

    if (tab === "library") {
      view.innerHTML = `<h1 class="page">Meal plan</h1>${tabs}<div class="meal-tools"><input id="mealSearch" class="meal-search" type="search" placeholder="Search recipes or ingredients&hellip;" value="${esc(_mealQ)}"><div class="chips" id="mealCats">${["all","breakfast","lunch","dinner","snack"].map(c=>`<button data-c="${c}" class="chip ${_mealCat===c?'on':''}">${c==='all'?'All':CAP(c)}</button>`).join("")}</div></div><div id="mealResults"></div>`;
      view.querySelectorAll(".tabs button").forEach(b => b.onclick = () => location.hash = "#/meals/" + b.dataset.t);
      const results = view.querySelector("#mealResults");
      const cardHtml = r => `<div class="wcard meal" data-id="${r.id}"><div class="thumb"><img src="${img(r.image_seed,400,260)}" alt=""><span class="b badge beg">${esc(r.meal_type)}</span></div><div class="body"><div class="t">${esc(r.title)}</div><div class="m">${r.minutes} min &middot; ${r.kcal} kcal</div></div></div>`;
      const doRender = () => {
        const q = _mealQ.trim().toLowerCase();
        const list = _recipes.filter(r => {
          if (_mealCat !== "all" && r.meal_type !== _mealCat) return false;
          if (!q) return true;
          const hay = (r.title + " " + (r.ingredients||[]).join(" ") + " " + (r.instructions||[]).join(" ")).toLowerCase();
          return hay.indexOf(q) !== -1;
        });
        results.innerHTML = list.length ? `<p class="meal-count">${list.length} recipe${list.length===1?'':'s'}</p><div class="grid-cards">${list.map(cardHtml).join("")}</div>` : `<p class="page-sub">No recipes match your search.</p>`;
        results.querySelectorAll(".meal").forEach(el => el.onclick = () => location.hash = "#/recipe/" + el.dataset.id);
      };
      doRender();
      const search = view.querySelector("#mealSearch");
      search.oninput = () => { _mealQ = search.value; doRender(); };
      view.querySelectorAll("#mealCats .chip").forEach(b => b.onclick = () => { _mealCat = b.dataset.c; view.querySelectorAll("#mealCats .chip").forEach(x => x.classList.toggle("on", x === b)); doRender(); });
      return;
    }

    // ---- Plan tab ----
    _week = await ensureWeek(false);
    const today = PLAN.isoDate(new Date());
    if (!_selDay || _selDay < _week.startISO || _selDay > _week.endISO) _selDay = (today >= _week.startISO && today <= _week.endISO) ? today : _week.startISO;

    function dayCount(dateISO) {
      let done = 0, total = 0;
      SLOTS.forEach(s => { const it = _week.items[dateISO + "|" + s]; if (it) { total++; if (it.status === "done") done++; } });
      return { done, total };
    }
    function renderPlan() {
      const t = _week.targets || {};
      const goalTxt = t.goal ? ` &middot; goal ${(+t.goal).toFixed(0)} kg` : "";
      const targetLine = t.daily ? `Daily target ~${t.daily} kcal${goalTxt}` : "Set your details to personalize";
      const needs = (t.missing || []).filter(m => m === "weight" || m === "height");
      const note = (t.basis === "default" || needs.length)
        ? `<div class="plan-note">Add your ${needs.length?needs.join(" and "):"current weight and height"} in <a href="#/profile">Profile</a> to personalize this plan for weight loss.</div>` : "";
      const strip = Array.from({ length: 7 }, (_, i) => PLAN.isoDate(PLAN.addDays(new Date(_week.startISO + "T00:00:00"), i))).map(d => {
        const dt = new Date(d + "T00:00:00"); const c = dayCount(d);
        return `<button class="daychip ${d===_selDay?'on':''} ${d===today?'today':''}" data-day="${d}">
          <span class="dow">${dt.toLocaleDateString(undefined,{weekday:'short'}).toUpperCase()}</span>
          <span class="dnum">${dt.getDate()}</span><span class="dct">${c.done}/${c.total||4}</span></button>`;
      }).join("");
      const rows = SLOTS.map(slot => {
        const it = _week.items[_selDay + "|" + slot]; if (!it) return "";
        const r = recipeById(it.recipe_id); if (!r) return "";
        const footer = it.status === "done"
          ? `<div class="mc-state done" data-slot="${slot}" data-act="reset">&#10003; Completed</div>`
          : it.status === "skipped"
          ? `<div class="mc-state skip" data-slot="${slot}" data-act="reset">&#9655; Skipped</div>`
          : `<div class="mc-actions"><button data-slot="${slot}" data-act="done">&#10003; Done</button><button data-slot="${slot}" data-act="change">&#8635; Change</button><button data-slot="${slot}" data-act="skip">&#9655; Skip</button></div>`;
        return `<div class="meal-card" data-id="${r.id}"><div class="mc-top"><img src="${img(r.image_seed,240,180)}" alt="">
          <div class="mc-body"><span class="badge beg">${CAP(slot)}</span><div class="n">${esc(r.title)}</div><div class="s">${r.minutes} min &middot; ${r.kcal} kcal${it.kcal_target?` &middot; target ~${it.kcal_target}`:""}</div></div></div>${footer}</div>`;
      }).join("");
      const selDate = new Date(_selDay + "T00:00:00");
      view.innerHTML = `<div class="mealhdr"><h1 class="page" style="margin:0">Meal plan</h1><button class="regen" id="regen">&#8635; Regenerate</button></div>
        ${tabs}
        <div class="target-card"><div class="tc-main">${targetLine}</div><div class="tc-sub">Meals tuned to a gentle, steady deficit. Guidance only, not medical advice.</div></div>
        ${note}
        <div class="daystrip">${strip}</div>
        <div class="subtabs"><button class="on" data-s="meals">Meals</button><button data-s="nutrition">Nutrition</button><button data-s="groceries">Groceries</button></div>
        <div id="subview"><h2 class="today-h">${selDate.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</h2>${rows}</div>`;
      view.querySelectorAll(".tabs button").forEach(b => b.onclick = () => location.hash = "#/meals/" + b.dataset.t);
      view.querySelector("#regen").onclick = async () => {
        if (!confirm("Regenerate this week's plan from your current weight? This replaces the current week.")) return;
        view.innerHTML = `<h1 class="page">Meal plan</h1><p class="page-sub">Building your plan&hellip;</p>`;
        _week = await ensureWeek(true); renderPlan();
      };
      view.querySelectorAll(".daychip").forEach(b => b.onclick = () => { _selDay = b.dataset.day; renderPlan(); });
      view.querySelectorAll(".subtabs button").forEach(b => b.onclick = () => {
        view.querySelectorAll(".subtabs button").forEach(x => x.classList.toggle("on", x === b));
        const sv = view.querySelector("#subview");
        if (b.dataset.s === "meals") { renderPlan(); }
        else sv.innerHTML = `<div class="soon"><div class="big">${b.dataset.s==='nutrition'?'&#128202;':'&#128722;'}</div><p>${b.dataset.s==='nutrition'?'Nutrition totals vs. your daily target are coming soon.':'Auto-built grocery lists from your week are coming soon.'}</p></div>`;
      });
      view.querySelectorAll(".meal-card .mc-top").forEach(el => el.onclick = () => location.hash = "#/recipe/" + el.closest(".meal-card").dataset.id);
      view.querySelectorAll(".mc-actions button, .mc-state[data-slot]").forEach(b => b.onclick = async (e) => {
        e.stopPropagation();
        const slot = b.dataset.slot, act = b.dataset.act, key = _selDay + "|" + slot, it = _week.items[key];
        if (!it) return;
        if (act === "done" || act === "skip" || act === "reset") {
          const status = act === "reset" ? "pending" : act === "done" ? "done" : "skipped";
          it.status = status; renderPlan();
          await DB.setPlanStatus(_selDay, slot, status);
        } else if (act === "change") {
          const tgt = it.kcal_target || 0;
          const cands = _recipes.filter(r => r.meal_type === slot).sort((a, c) => Math.abs((a.kcal||0)-tgt) - Math.abs((c.kcal||0)-tgt));
          const idx = Math.max(0, cands.findIndex(r => r.id === it.recipe_id));
          const next = cands[(idx + 1) % cands.length];
          it.recipe_id = next.id; it.status = "pending"; renderPlan();
          await DB.changePlanRecipe(_selDay, slot, next.id);
        }
      });
    }
    renderPlan();
  }

  async function vRecipe(id) {
    const recipes = _recipes || (_recipes = await DB.recipes());
    const r = recipes.find(x => x.id === id); if (!r) return notFound();
    const fav = !!ST.favorites[id];
    const ing = (r.ingredients || []).map(i => `<li>${esc(i)}</li>`).join("");
    const ins = (r.instructions || []).map((s, i) => `<div class="lrow"><span class="lnum">${i+1}</span><span class="ltext"><span class="lt" style="font-weight:600">${esc(s)}</span></span></div>`).join("");
    const similar = recipes.filter(x => x.id !== id).slice(0, 6).map(x => `<div class="wcard meal" data-id="${x.id}" style="min-width:200px"><div class="thumb"><img src="${img(x.image_seed,400,260)}"><span class="b badge beg">${x.kcal} kcal</span></div><div class="body"><div class="t" style="font-size:15px">${esc(x.title)}</div></div></div>`).join("");
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/meals'">‹ Meals</button>
      <div class="info-photo" style="max-width:none;margin:6px 0 14px"><img src="${img(r.image_seed,1000,520)}" alt=""></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="badge beg">${esc(r.meal_type)}</span><h1 class="page" style="margin:0;font-size:24px">${esc(r.title)}</h1>
        <button class="favico" id="favBtn">${fav?"♥":"♡"}</button></div>
      <p class="page-sub">${r.minutes} min · ${r.kcal} kcal · ${r.servings} servings</p>
      <div class="macros"><div><b>${r.protein}g</b><span>Protein</span></div><div><b>${r.carbs}g</b><span>Carbs</span></div><div><b>${r.fat}g</b><span>Fat</span></div><div><b>${r.fiber||0}g</b><span>Fiber</span></div></div>
      <div class="card" style="margin-top:16px"><div class="tabs" id="rtabs"><button data-t="ing" class="on">Ingredients</button><button data-t="nut">Nutrition</button></div>
        <div id="rbody"><ul class="ing-list">${ing}</ul></div></div>
      <div class="section-title"><h2>Instructions</h2></div><div class="card listcard">${ins}</div>
      <div class="section-title"><h2>Similar recipes</h2></div><div class="row-scroll">${similar}</div>`;
    view.querySelector("#favBtn").onclick = async () => { const on = !ST.favorites[id]; if (on) ST.favorites[id] = true; else delete ST.favorites[id]; await DB.toggleFav(id, on, "recipe"); vRecipe(id); };
    view.querySelectorAll("#rtabs button").forEach(b => b.onclick = () => {
      view.querySelectorAll("#rtabs button").forEach(x => x.classList.toggle("on", x === b));
      view.querySelector("#rbody").innerHTML = b.dataset.t === "ing"
        ? `<ul class="ing-list">${ing}</ul>`
        : `<div class="macros" style="margin:6px 0 0"><div><b>${r.kcal}</b><span>kcal</span></div><div><b>${r.protein}g</b><span>Protein</span></div><div><b>${r.carbs}g</b><span>Carbs</span></div><div><b>${r.fat}g</b><span>Fat</span></div></div>`;
    });
    view.querySelectorAll(".meal").forEach(el => el.onclick = () => location.hash = "#/recipe/" + el.dataset.id);
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
    const isWeight = metric === "weight";
    const tgtField = isWeight ? `<label class="fl">Target weight (kg)</label><input id="tgt" class="tin" type="number" inputmode="decimal" value="${PROFILE?.target_weight_kg ?? ""}" placeholder="e.g. 70">` : "";
    const trend = (isWeight && hist.length > 1) ? `<div class="sec-label" style="margin:18px 0 8px">TREND</div><div class="card">${trendSvg(hist, PROFILE?.target_weight_kg)}</div>` : "";
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/tracking'">‹ Tracking</button>
      <h1 class="page">${t.icon} ${t.label}</h1>
      <div class="card">${input}${tgtField}<button class="btn block" id="save" style="margin-top:14px">Save entry</button></div>
      ${trend}
      <div class="sec-label" style="margin:18px 0 8px">HISTORY</div>
      <div class="hist">${hist.length?hist.map(h=>`<div class="h"><span>${esc(String(h.value))} ${t.unit||""}</span><span style="color:var(--muted)">${new Date(h.at).toLocaleString()}</span></div>`).join(""):'<p class="page-sub">No entries yet.</p>'}</div>`;
    let mood = null;
    view.querySelectorAll(".moodrow button").forEach(b => b.onclick = () => { mood = +b.dataset.mood; view.querySelectorAll(".moodrow button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); });
    view.querySelector("#save").onclick = async () => {
      let v = t.numeric ? view.querySelector("#val").value : mood;
      if (t.numeric) { if (!(parseFloat(v) >= 0)) { view.querySelector("#val").focus(); return; } }
      else { if (!v) return; v = ["Very low","Low","Okay","Good","Great"][v-1]; }
      if (isWeight) { const tg = parseFloat(view.querySelector("#tgt").value); if (tg > 0) { await DB.updateProfile({ target_weight_kg: tg }); if (PROFILE) PROFILE.target_weight_kg = tg; } }
      await DB.addCheckin(metric, v, t.unit);
      (ST.history[metric] = ST.history[metric] || []).unshift({ value: v, at: new Date().toISOString() });
      ST.latest[metric] = v; vTrack(metric);
    };
  }

  // small trend line for numeric history (newest-first input)
  function trendSvg(hist, target) {
    const pts = hist.slice(0, 12).map(h => parseFloat(h.value)).filter(n => !isNaN(n)).reverse();
    if (pts.length < 2) return "";
    const W = 300, H = 110, pad = 8;
    let lo = Math.min(...pts, target || Infinity), hi = Math.max(...pts, target || -Infinity);
    if (lo === hi) { lo -= 1; hi += 1; } const range = hi - lo;
    const x = i => pad + i * (W - 2 * pad) / (pts.length - 1);
    const y = v => pad + (1 - (v - lo) / range) * (H - 2 * pad);
    const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const tgtLine = (target > 0) ? `<line x1="${pad}" y1="${y(target).toFixed(1)}" x2="${W-pad}" y2="${y(target).toFixed(1)}" stroke="#9cc2a9" stroke-dasharray="4 4"/>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      <path d="${d} L${x(pts.length-1).toFixed(1)},${H-pad} L${x(0).toFixed(1)},${H-pad} Z" fill="#5a9e6f22"/>
      ${tgtLine}
      <path d="${d}" fill="none" stroke="#5a9e6f" stroke-width="2.5"/>
      <circle cx="${x(0).toFixed(1)}" cy="${y(pts[0]).toFixed(1)}" r="4" fill="#5a9e6f"/>
      <circle cx="${x(pts.length-1).toFixed(1)}" cy="${y(pts[pts.length-1]).toFixed(1)}" r="4" fill="#5a9e6f"/>
    </svg><div class="chartlabels"><span>${pts[0]}</span><span>Target ${target||"—"}</span><span>${pts[pts.length-1]}</span></div>`;
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

  async function vFavorites() {
    const ids = Object.keys(ST.favorites);
    if (!ids.length) {
      view.innerHTML = `<h1 class="page">Favorites</h1><div class="soon"><div class="big">♡</div><p>No favorites yet. Tap the heart on any workout, meal or session to save it here.</p></div>`;
      return;
    }
    const recipes = _recipes || (_recipes = await DB.recipes());
    const workouts = DATA.workouts.filter(x => ids.includes(x.id));
    const media = Object.values(DATA.stress).flat().filter(x => ids.includes(x.id));
    const meals = recipes.filter(x => ids.includes(x.id));
    const mediaCard = x => `<div class="wcard" data-media="${x.id}"><div class="thumb"><img src="${img(x.seed,400,260)}"><button class="fav" data-id="${x.id}" data-type="media">♥</button></div><div class="body"><div class="t">${esc(x.title)}</div><div class="m">${x.min} min</div></div></div>`;
    const mealCard = x => `<div class="wcard meal" data-recipe="${x.id}"><div class="thumb"><img src="${img(x.image_seed,400,260)}"><button class="fav" data-id="${x.id}" data-type="recipe">♥</button></div><div class="body"><div class="t">${esc(x.title)}</div><div class="m">${x.minutes} min · ${x.kcal} kcal</div></div></div>`;
    const section = (title, html) => html ? `<div class="section-title"><h2>${title}</h2></div><div class="grid-cards">${html}</div>` : "";
    view.innerHTML = `<h1 class="page">Favorites</h1>`
      + section("Workouts", workouts.map(wcard).join(""))
      + section("Meals", meals.map(mealCard).join(""))
      + section("Stress release", media.map(mediaCard).join(""));
    view.querySelectorAll(".wcard[data-id]").forEach(c => { if (workouts.find(w => w.id === c.dataset.id)) c.onclick = (e) => { if (e.target.closest(".fav")) return; location.hash = "#/workout/" + c.dataset.id; }; });
    view.querySelectorAll(".wcard[data-recipe]").forEach(c => c.onclick = (e) => { if (e.target.closest(".fav")) return; location.hash = "#/recipe/" + c.dataset.recipe; });
    view.querySelectorAll(".fav").forEach(f => f.onclick = async (e) => { e.stopPropagation(); delete ST.favorites[f.dataset.id]; await DB.toggleFav(f.dataset.id, false, f.dataset.type || "session"); vFavorites(); });
  }

  // ---------- Profile / settings ----------
  function vProfile() {
    const p = PROFILE || {};
    const units = p.measurement_system || "metric";
    view.innerHTML = `
      <h1 class="page">Profile</h1>
      <div class="prof-id"><span class="prof-av">${esc((p.name||p.email||"Y")[0]).toUpperCase()}</span>
        <div><div class="prof-name">${esc(p.name||"Your name")}</div><div class="page-sub" style="margin:0">${esc(p.email||"")}</div></div></div>

      <div class="card" style="margin-top:16px">
        <div class="sec-label">YOUR INFO</div>
        <label class="fl">Name</label><input id="pf-name" class="tin" value="${esc(p.name||"")}">
        <label class="fl">Email address</label><input class="tin" value="${esc(p.email||"")}" disabled>
        <label class="fl">Height (cm)</label><input id="pf-height" class="tin" type="number" inputmode="decimal" value="${p.height_cm||""}" placeholder="e.g. 165">
        <label class="fl">Daily steps goal</label><input id="pf-steps" class="tin" type="number" value="${p.daily_steps_goal||7000}" placeholder="7000">
        <div style="text-align:right;margin-top:14px"><button class="btn" id="pf-save">Save changes</button></div>
        <div id="pf-msg" class="page-sub" style="text-align:right;margin-top:8px"></div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="sec-label">MEASUREMENT SYSTEM</div>
        <div class="seg"><button data-u="metric" class="${units==='metric'?'on':''}">Metric</button><button data-u="imperial" class="${units==='imperial'?'on':''}">Imperial</button></div>
      </div>

      <div class="card listcard" style="margin-top:16px">
        <a class="lrow" href="#/subscription"><span>Manage subscription</span><span class="chev">›</span></a>
        <a class="lrow" href="#/install"><span>Install the app</span><span class="chev">›</span></a>
      </div>

      <div class="card listcard" style="margin-top:16px">
        <div class="sec-label" style="padding:0 4px 6px">HELP &amp; LEGAL</div>
        <a class="lrow" href="https://taimotion.com" target="_blank"><span>Privacy Policy</span><span class="chev">›</span></a>
        <a class="lrow" href="https://taimotion.com" target="_blank"><span>Terms of Service</span><span class="chev">›</span></a>
        <a class="lrow" href="mailto:hello@taimotion.com"><span>Support</span><span class="chev">›</span></a>
      </div>

      <div style="text-align:center;margin:26px 0"><button class="logout" id="pf-logout">Logout ⎋</button></div>`;
    // save
    view.querySelector("#pf-save").onclick = async () => {
      const name = view.querySelector("#pf-name").value.trim();
      const steps = parseInt(view.querySelector("#pf-steps").value) || 7000;
      const heightRaw = parseFloat(view.querySelector("#pf-height").value);
      const height_cm = heightRaw > 0 ? heightRaw : null;
      await DB.updateProfile({ name, daily_steps_goal: steps, height_cm });
      PROFILE.name = name; PROFILE.daily_steps_goal = steps; PROFILE.height_cm = height_cm;
      const m = view.querySelector("#pf-msg"); m.style.color = "var(--primary-dark)"; m.textContent = "✓ Saved";
      renderNav("profile");
    };
    view.querySelectorAll(".seg button").forEach(b => b.onclick = async () => {
      const u = b.dataset.u; view.querySelectorAll(".seg button").forEach(x => x.classList.toggle("on", x === b));
      await DB.updateProfile({ measurement_system: u }); PROFILE.measurement_system = u;
    });
    view.querySelector("#pf-logout").onclick = () => AUTH.signOut();
  }

  function vManageSub() {
    const p = PROFILE || {};
    const planName = ({ "1w": "1-week plan", "4w": "4-week plan", "12w": "12-week plan" }[p.subscription_plan] || "Your plan");
    const renew = p.current_period_end ? new Date(p.current_period_end).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—";
    const off = !!p.cancel_at_period_end;
    view.innerHTML = `
      <button class="backlink" onclick="location.hash='#/profile'">‹ Back</button>
      <h1 class="page">Manage subscription</h1>
      <div class="card" style="max-width:520px">
        <div class="sec-label">${planName.toUpperCase()} ${off?'<span class="pill-off">Auto-renew off</span>':'<span class="pill-on">Active</span>'}</div>
        <div class="order-row"><span>Status</span><span>${esc(p.subscription_status||"—")}</span></div>
        <div class="order-row"><span>${off?"Access until":"Renews on"}</span><span>${renew}</span></div>
        <div class="subbox ${off?'warn':''}" style="margin-top:14px">
          ${off
            ? `<b>Auto-renew is off — access until ${renew}.</b><p class="page-sub" style="margin:6px 0 0">Your plan won't renew. Turn it back on to keep your progress.</p>
               <button class="btn block" id="renew-on" style="margin-top:12px">Keep my subscription</button>`
            : `<b>Need a breather?</b><p class="page-sub" style="margin:6px 0 0">You can turn off auto-renewal anytime. You'll keep access until the end of your billing period.</p>
               <button class="btn block" id="renew-off" style="margin-top:12px">Turn off auto-renewal</button>`}
        </div>
      </div>`;
    const onBtn = view.querySelector("#renew-on"), offBtn = view.querySelector("#renew-off");
    if (offBtn) offBtn.onclick = async () => { if (!confirm("Turn off auto-renewal? You'll keep access until "+renew+".")) return; await DB.setAutoRenew(false); PROFILE.cancel_at_period_end = true; vManageSub(); };
    if (onBtn) onBtn.onclick = async () => { await DB.setAutoRenew(true); PROFILE.cancel_at_period_end = false; vManageSub(); };
  }

  function vInstall() {
    view.innerHTML = `
      <button class="backlink" onclick="location.hash='#/profile'">‹ Back</button>
      <h1 class="page">Install the app</h1>
      <p class="page-sub">Add Tai Motion to your home screen for one-tap access — works like a normal app, no app store needed.</p>
      <div class="card" style="max-width:560px">
        <div class="seg" id="os"><button data-os="iphone" class="on">iPhone</button><button data-os="android">Android</button></div>
        <ol class="steps-list" id="steps"></ol>
      </div>`;
    const STEPS = {
      iphone: ["Open taimotion.com in Safari", "Tap the Share button (square with an arrow)", "Scroll down and tap “Add to Home Screen”", "Tap “Add”, then open Tai Motion from your home screen"],
      android: ["Open taimotion.com in Chrome", "Tap the menu (⋮, top-right)", "Tap “Add to Home screen” (you may need to scroll)", "Follow the prompts, then open Tai Motion from your home screen"],
    };
    const render = (os) => { view.querySelector("#steps").innerHTML = STEPS[os].map((s, i) => `<li><span class="sn">${i+1}</span><span>${esc(s)}</span></li>`).join(""); };
    view.querySelectorAll("#os button").forEach(b => b.onclick = () => { view.querySelectorAll("#os button").forEach(x => x.classList.toggle("on", x === b)); render(b.dataset.os); });
    render("iphone");
  }

  // ---------- Academy ----------
  let _lessons = null;
  async function vAcademy() {
    view.innerHTML = `<h1 class="page">Academy</h1><p class="page-sub">Loading…</p>`;
    const [lessons, prog] = await Promise.all([DB.academyLessons(), DB.lessonProgress()]);
    _lessons = lessons;
    const doneCount = lessons.filter(l => prog[l.id]?.done).length;
    const pct = lessons.length ? Math.round(doneCount / lessons.length * 100) : 0;
    let firstLocked = false;
    const rows = lessons.map((l, i) => {
      const done = !!prog[l.id]?.done;
      const unlocked = i === 0 || prog[lessons[i - 1].id]?.done;
      const locked = !unlocked && !done;
      return `<div class="lrow lesson ${locked ? "locked" : ""}" data-id="${l.id}">
        <span class="lnum ${done ? "done" : ""}">${done ? "✓" : (l.day_number || i + 1)}</span>
        <span class="ltext"><span class="lt">${esc(l.title)}</span><span class="ls">Day ${l.day_number} · ${l.duration_min} min</span></span>
        <span class="chev">${locked ? "🔒" : "›"}</span></div>`;
    }).join("");
    view.innerHTML = `<h1 class="page">Academy</h1><p class="page-sub">Daily lessons on balance, movement &amp; healthy aging — self-paced.</p>
      <div class="card" style="margin-bottom:16px"><div class="section-title" style="margin:0 0 8px"><h2>Your progress</h2><span style="color:var(--muted);font-weight:700">${doneCount} of ${lessons.length}</span></div>
        <div class="pbar"><i style="width:${pct}%"></i></div></div>
      <div class="card listcard">${rows}</div>`;
    view.querySelectorAll(".lesson:not(.locked)").forEach(el => el.onclick = () => location.hash = "#/lesson/" + el.dataset.id);
  }
  async function vLesson(id) {
    const list = _lessons || await DB.academyLessons();
    const l = list.find(x => x.id === id); if (!l) return notFound();
    const prog = await DB.lessonProgress(); const taskDone = !!prog[id]?.task;
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/academy'">‹ Academy</button>
      <h1 class="page" style="font-size:24px">${esc(l.title)}</h1>
      <div class="info-photo" style="max-width:none;margin:10px 0 18px"><img src="${img(l.cover_seed || ("lesson"+id), 1000, 500)}" alt=""></div>
      <div class="article">${(l.body || "").split("\n").map(p => `<p>${esc(p)}</p>`).join("")}</div>
      <div class="card" style="margin-top:18px"><div class="section-title" style="margin:0 0 8px"><h2>Your task</h2></div>
        <div class="task ${taskDone ? "done" : ""}" id="task"><span class="box">${taskDone ? "✓" : ""}</span><span class="lab">${esc(l.task || "Reflect on today's lesson.")}</span></div>
        <button class="btn block" id="finish" style="margin-top:14px">${prog[id]?.done ? "✓ Completed" : "Mark lesson complete"}</button></div>`;
    let done = taskDone;
    view.querySelector("#task").onclick = () => { done = !done; const t = view.querySelector("#task"); t.classList.toggle("done", done); t.querySelector(".box").textContent = done ? "✓" : ""; };
    view.querySelector("#finish").onclick = async () => { await DB.completeLesson(id, done); view.querySelector("#finish").textContent = "✓ Completed"; };
  }

  // ---------- Challenges ----------
  async function vChallenges(tab) {
    tab = tab || "all";
    view.innerHTML = `<h1 class="page">Challenges</h1><p class="page-sub">Loading…</p>`;
    const [list, mine] = await Promise.all([DB.challengesList(), DB.myChallenges()]);
    const tabs = `<div class="tabs"><button data-t="mine" class="${tab==='mine'?'on':''}">My challenges</button><button data-t="all" class="${tab==='all'?'on':''}">All challenges</button></div>`;
    const show = tab === "mine" ? list.filter(c => mine[c.id]) : list;
    const cards = show.length ? `<div class="grid-cards">${show.map(c => {
      const m = mine[c.id]; const dd = (m && m.days_done) || [];
      return `<div class="wcard chal" data-id="${c.id}"><div class="thumb"><img src="${img(c.cover_seed,400,260)}" alt="">
        ${m ? `<span class="b badge beg">${dd.length}/${c.days} days</span>` : ""}</div>
        <div class="body"><div class="t">${esc(c.title)}</div><div class="m">${esc(c.subtitle || "")} · ${c.days} days</div></div></div>`;
    }).join("")}</div>` : `<div class="soon"><div class="big">🏆</div><p>${tab==='mine'?"You haven't joined a challenge yet. Browse all challenges to start one.":"No challenges yet."}</p></div>`;
    view.innerHTML = `<h1 class="page">Challenges</h1><p class="page-sub">Short, focused plans to help you build a habit.</p>${tabs}${cards}`;
    view.querySelectorAll(".tabs button").forEach(b => b.onclick = () => location.hash = "#/challenges/" + b.dataset.t);
    view.querySelectorAll(".chal").forEach(el => el.onclick = () => location.hash = "#/challenge/" + el.dataset.id);
  }
  async function vChallenge(id) {
    const [list, mine] = await Promise.all([DB.challengesList(), DB.myChallenges()]);
    const c = list.find(x => x.id === id); if (!c) return notFound();
    const m = mine[id]; const dd = (m && m.days_done) || [];
    const grid = Array.from({ length: c.days }, (_, i) => i + 1).map(d => {
      const done = dd.includes(d);
      return `<button class="daycell ${done ? "done" : ""} ${m ? "" : "preview"}" data-day="${d}">${done ? "✓" : d}</button>`;
    }).join("");
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/challenges'">‹ Challenges</button>
      <div class="info-photo" style="max-width:none;margin:6px 0 14px"><img src="${img(c.cover_seed,1000,440)}" alt=""></div>
      <h1 class="page">${esc(c.title)}</h1><p class="page-sub">${esc(c.subtitle || "")} · ${c.days} days</p>
      <div class="card"><div class="section-title" style="margin:0 0 8px"><h2>About</h2></div><p style="color:#34433b;margin:0">${esc(c.about || "")}</p></div>
      <div class="section-title"><h2>Day-by-day plan</h2><span style="color:var(--muted);font-weight:700">${m ? dd.length + "/" + c.days : c.days + " days"}</span></div>
      <div class="daygrid">${grid}</div>
      <p class="page-sub" style="margin-top:10px">${m ? "Tap a day to check it off." : "A peek at the plan. Start the challenge to check off each day."}</p>
      <div class="cta-fixed"><button class="btn block" id="cbtn">${m ? "Keep going" : "Start the challenge"}</button></div>`;
    if (!m) {
      view.querySelector("#cbtn").onclick = async () => { await DB.startChallenge(id); vChallenge(id); };
    } else {
      view.querySelector("#cbtn").onclick = () => location.hash = "#/challenges/mine";
      view.querySelectorAll(".daycell").forEach(cell => cell.onclick = async () => {
        const day = +cell.dataset.day; const nd = await DB.toggleChallengeDay(id, day);
        const on = nd.includes(day); cell.classList.toggle("done", on); cell.textContent = on ? "✓" : day;
      });
    }
  }

  function vSoon(title, icon, msg) { view.innerHTML = `<h1 class="page">${title}</h1><div class="soon"><div class="big">${icon}</div><p>${msg}</p></div>`; }
  function notFound() { view.innerHTML = `<div class="soon"><div class="big">🤷</div><p>Page not found.</p></div>`; }

  function route() {
    if (!DATA) return;
    const [r, a] = (location.hash.replace(/^#\//, "") || "home").split("/");
    const navMap = { workout: "exercises", track: "tracking", profile: "", subscription: "", install: "",
      lesson: "academy", challenge: "challenges", recipe: "meals" };
    renderNav(r in navMap ? navMap[r] : r);
    window.scrollTo(0, 0);
    ({ home: vHome, meals: () => vMeals(a), recipe: () => vRecipe(a),
       exercises: () => vExercises(a), workout: () => vWorkout(a), tracking: vTracking,
       track: () => vTrack(a), stress: () => vStress(a), favorites: vFavorites,
       profile: vProfile, subscription: vManageSub, install: vInstall,
       academy: vAcademy, lesson: () => vLesson(a),
       challenges: () => vChallenges(a), challenge: () => vChallenge(a),
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
