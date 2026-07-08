/* Tai Motion members' app — Supabase-backed SPA.
 * Boot: auth session -> subscription gate -> load content + user state from DB -> route.
 * Mutations persist to Supabase (RLS-scoped). Per-day task/plan checklists use localStorage.
 */
(function () {
  const C = window.CONTENT, view = document.getElementById("view");
  const el = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lv = (l) => l === "Advanced" ? "adv" : l === "Intermediate" ? "int" : "beg";
  const img = (seed, w, h) => {
    if (/^https?:/.test(seed)) {
      // Supabase Storage objects: serve a resized/compressed (WebP when supported) variant
      // on the fly via the image-transformation endpoint — ~95% smaller than the 1024px original.
      // Image transformations aren't enabled on this project, so serve the original object directly.
      if (seed.includes("/storage/v1/object/public/")) return seed;
      return `${seed}?w=${w}&h=${h}&fit=crop&crop=entropy&q=70&auto=format`;
    }
    return `https://picsum.photos/seed/${encodeURIComponent("ctc-" + seed)}/${w}/${h}`;
  };
  const rimg = (r, w, h) => img((r && (r.image_url || r.image_seed)) || "", w, h);

  let DATA = null, ST = null, PROFILE = null;

  const NAV = [
    { id: "home", label: "Home", icon: "🏠" }, { id: "meals", label: "Meals", icon: "🍽️" },
    { id: "exercises", label: "Exercises", icon: "🧘" }, { id: "tracking", label: "Tracking", icon: "📈" },
    { id: "academy", label: "Academy", icon: "📖" },
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
    view.innerHTML = `<div class="gate"><img class="gate-logo" src="assets/logo2.webp" alt="Tai Motion">
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
  function homeMealCard() {
    try {
      if (!_week || !_recipes) return "";
      const today = PLAN.isoDate(new Date());
      if (today < _week.startISO || today > _week.endISO) return "";
      let next = null;
      for (const slot of SLOTS) { const it = _week.items[today + "|" + slot]; if (it && it.status === "pending") { next = it; break; } }
      if (!next) return `<div class="card home-meal"><div class="hm-head"><span class="hm-k">TODAY'S MEALS</span><a href="#/meals" class="hm-more">›</a></div><p class="page-sub" style="margin:6px 0 0">All meals handled for today 🎉</p></div>`;
      const r = recipeById(next.recipe_id); if (!r) return "";
      return `<div class="card home-meal">
        <div class="hm-head"><span class="hm-k">TODAY'S NEXT MEAL</span><a href="#/meals" class="hm-more">›</a></div>
        <a class="hm-body" href="#/recipe/${r.id}"><img src="${rimg(r,400,260)}" alt="">
          <div class="hm-info"><span class="badge beg">${esc(r.meal_type)}</span><div class="hm-title">${esc(r.title)}</div><div class="hm-kcal">${r.kcal} kcal</div></div></a>
        <div class="hm-actions"><button class="btn small" data-mact="done" data-slot="${next.meal_type}">✓ Mark complete</button><button class="btn ghost small" data-mact="skip" data-slot="${next.meal_type}">▷ Skip</button></div></div>`;
    } catch (e) { return ""; }
  }
  function homeCaloriesCard() {
    try {
      if (!_week || !_recipes) return "";
      const today = PLAN.isoDate(new Date());
      if (today < _week.startISO || today > _week.endISO) return "";
      let kcal = 0; SLOTS.forEach(s => { const it = _week.items[today + "|" + s]; if (it && it.status === "done") { const r = recipeById(it.recipe_id); if (r) kcal += r.kcal || 0; } });
      const target = (_week.targets && _week.targets.daily) || 2000;
      return `<div class="card home-cal"><div class="hm-head"><span class="hm-k">CALORIES TODAY</span><a href="#/meals" class="hm-more">›</a></div>
        <div class="hc-body">${donut(kcal, target, Math.round(kcal), "KCAL")}<div class="hc-info"><div class="hc-big">${Math.round(kcal)} <small>/ ${target}</small></div><div class="hc-sub">${Math.round(kcal / target * 100)}% of daily target</div></div></div></div>`;
    } catch (e) { return ""; }
  }
  async function homeAcademyCard() {
    try {
      const [lessons, prog] = await Promise.all([DB.academyLessons(), DB.lessonProgress()]);
      if (!lessons.length) return "";
      const done = lessons.filter(l => prog[l.id]?.done).length;
      const pct = Math.round(done / lessons.length * 100);
      let cur = null, idx = 0;
      for (let i = 0; i < lessons.length; i++) { const unlocked = ACADEMY_UNLOCK_ALL || i === 0 || !!prog[lessons[i - 1].id]?.done; if (unlocked && !prog[lessons[i].id]?.done) { cur = lessons[i]; idx = i + 1; break; } }
      if (!cur) return `<div class="card home-acad"><div class="hm-head"><span class="hm-k">ACADEMY</span><a href="#/academy" class="hm-more">›</a></div><div class="ha-title">All lessons complete 🎉</div><div class="pbar" style="margin:8px 0 0"><i style="width:100%"></i></div></div>`;
      return `<div class="card home-acad"><div class="hm-head"><span class="hm-k">ACADEMY · LESSON ${idx} OF ${lessons.length}</span><a href="#/academy" class="hm-more">›</a></div>
        <div class="ha-title">${esc(cur.title)}</div>
        <div class="pbar" style="margin:10px 0 12px"><i style="width:${pct}%"></i></div>
        <a class="btn block" href="#/lesson/${cur.id}">Start lesson ${idx} ›</a></div>`;
    } catch (e) { return ""; }
  }

  // ---- Premium guides (upsell content) ----
  const GUIDES = [
    { id:"joint-mobility", title:"Joint & Mobility", sub:"Gentle seated joint-care routine", file:"assets/guide-joint-mobility.pdf?v=1", group:"essentials", offer:"guide_joint-mobility", unlock:["essential_guides","essential_guides_onetime","guide_joint-mobility"], ready:true },
    { id:"breathing", title:"Stress-Relief Breathing", sub:"Seated breathing to calm body & mind", file:"assets/guide-breathing.pdf?v=2", group:"essentials", offer:"guide_breathing", unlock:["essential_guides","essential_guides_onetime","guide_breathing"], ready:true },
    { id:"nutrition", title:"Weekly Gentle Nutrition", sub:"7 gentle habits for eating well", file:"assets/guide-nutrition.pdf?v=1", group:"essentials", offer:"guide_nutrition", unlock:["essential_guides","essential_guides_onetime","guide_nutrition"], ready:true },
    { id:"desserts", title:"Sweet & Gentle: 25 Lighter Desserts", sub:"25 lighter treats you'll love", file:"assets/guide-desserts.pdf?v=1", group:"essentials", offer:"guide_desserts", unlock:["essential_guides","essential_guides_onetime","guide_desserts"], ready:true },
    { id:"sleep", title:"Better Sleep", sub:"A Chair Tai Chi wind-down for restful nights", file:"assets/guide-sleep.pdf?v=1", group:"wellbeing", offer:"guide_sleep", unlock:["all_guides","guide_sleep"], ready:true },
    { id:"eating", title:"Eating Without Guilt", sub:"A calm, kind relationship with food", file:"assets/guide-eating.pdf?v=1", group:"wellbeing", offer:"guide_eating", unlock:["all_guides","guide_eating"], ready:true },
    { id:"aging", title:"Aging Gracefully", sub:"7 pillars for a strong, calm, joyful later life", file:"assets/guide-aging.pdf?v=1", group:"wellbeing", offer:"guide_aging", unlock:["all_guides","guide_aging"], ready:true },
  ];
  const GROUPS = [
    { id:"essentials", bundle:"essential_guides", title:"Premium Essentials Guides", sub:"Movement, breathing & everyday nutrition", bundlePrice:"$38.99", allLabel:"all four guides" },
    { id:"wellbeing", bundle:"all_guides", title:"Premium Wellbeing Guides", sub:"Sleep, mindset & healthy aging", bundlePrice:"$38.99", allLabel:"all three guides" },
  ];
  const SINGLE_PRICE = "$18.99";
  const guideOwned = (g) => g.unlock.some(u => ST && ST.owned && ST.owned[u]);
  function renderGuides() {
    const card = g => {
      const owned = guideOwned(g);
      if (owned && g.ready) return `<a class="gcard owned" href="${g.file}" download="${esc(g.title)}.pdf"><span class="gc-ic">\uD83D\uDCD7</span><span class="gc-tx"><b>${esc(g.title)}</b><small>${esc(g.sub)}</small></span><span class="gc-dl">\u2B07</span></a>`;
      if (owned && !g.ready) return `<div class="gcard soon"><span class="gc-ic">\uD83D\uDCD7</span><span class="gc-tx"><b>${esc(g.title)}</b><small>Owned \u00B7 coming soon</small></span></div>`;
      return `<div class="gcard locked" data-guide="${g.id}"><span class="gc-ic">\uD83D\uDD12</span><span class="gc-tx"><b>${esc(g.title)}</b><small>${esc(g.sub)}</small></span><span class="gc-lock">Unlock</span></div>`;
    };
    const sections = GROUPS.map(gr => {
      const cards = GUIDES.filter(g => g.group === gr.id).map(card).join("");
      return `<div class="prem-grp"><div class="prem-h">\u2726 ${esc(gr.title)}</div><div class="guides">${cards}</div></div>`;
    }).join("");
    return `<div class="premium">${sections}</div>`;
  }
  function wireGuides(root) {
    root.querySelectorAll(".gcard.locked").forEach(c => c.onclick = () => openGuideModal(c.dataset.guide));
  }
  function openGuideModal(guideId) {
    const g = GUIDES.find(x => x.id === guideId); if (!g) return;
    const gr = GROUPS.find(x => x.id === g.group); if (!gr) return;
    const ov = document.createElement("div"); ov.className = "modal-ov";
    ov.innerHTML = `<div class="modal"><button class="modal-x" aria-label="Close">\u00D7</button>
      <div class="modal-badge">\uD83D\uDD12 Locked</div>
      <h3>${esc(g.title)}</h3>
      <p class="modal-sub">${esc(g.sub)}</p>
      <div class="modal-msg" style="display:none"></div><div class="modal-pay" style="display:none;margin:8px 0 12px"></div>
      <button class="btn block modal-single">Unlock this guide \u2014 ${SINGLE_PRICE}</button>
      <button class="btn block ghost modal-bundle">Get ${esc(gr.allLabel)} \u2014 ${gr.bundlePrice}</button>
      <p class="modal-fine">One-time \u00B7 yours to keep \u00B7 charged to your card on file.</p></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector(".modal-x").onclick = close;
    ov.onclick = (e) => { if (e.target === ov) close(); };
    const msg = ov.querySelector(".modal-msg"), payBox = ov.querySelector(".modal-pay");
    const btnS = ov.querySelector(".modal-single"), btnB = ov.querySelector(".modal-bundle");
    const say = (t, err) => { msg.style.display = "block"; msg.textContent = t; msg.style.color = err ? "#c0392b" : "var(--muted)"; };
    const unlocked = async (grant) => { ST.owned = ST.owned || {}; ST.owned[grant] = true; close(); try { await vHome(); } catch (e) {} requestAnimationFrame(() => requestAnimationFrame(() => { const el = document.querySelector(".premium"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); })); };
    const buy = (offerId, price, grant, cta, other) => async () => {
      const orig = cta.textContent; cta.disabled = true; other.disabled = true; cta.textContent = "Processing\u2026"; say("");
      try {
        const res = await callBuyGuides(offerId);
        if (res.status === "accepted" || res.status === "already_owned") return unlocked(grant);
        if (res.status === "requires_action" && res.clientSecret) return payPopup(res.clientSecret, res.pk, price, payBox, cta, say, () => unlocked(grant));
        say("Sorry, we couldn't complete that. Please try again.", true); cta.disabled = false; other.disabled = false; cta.textContent = orig;
      } catch (e) { say("Something went wrong. Please try again.", true); cta.disabled = false; other.disabled = false; cta.textContent = orig; }
    };
    btnS.onclick = buy(g.offer, SINGLE_PRICE, g.offer, btnS, btnB);
    btnB.onclick = buy(gr.bundle, gr.bundlePrice, gr.bundle, btnB, btnS);
  }
  async function callBuyGuides(item) {
    const { data } = await SB.auth.getSession();
    const token = data && data.session && data.session.access_token;
    const r = await fetch(window.SUPA.url + "/functions/v1/buy-guides", {
      method: "POST", headers: { "Authorization": "Bearer " + token, "apikey": window.SUPA.key, "Content-Type": "application/json" },
      body: JSON.stringify({ item }),
    });
    return r.json();
  }
  function loadStripeJs() {
    return new Promise((resolve) => {
      if (window.Stripe) return resolve(window.Stripe);
      const el = document.createElement("script"); el.src = "https://js.stripe.com/v3"; el.onload = () => resolve(window.Stripe); document.head.appendChild(el);
    });
  }
  async function payPopup(clientSecret, pk, price, payBox, cta, say, unlocked) {
    say("Enter your card to finish \u2014 one-time " + price + ".");
    const S = await loadStripeJs(); const stripe = S(pk);
    const elements = stripe.elements({ clientSecret });
    const pe = elements.create("payment"); payBox.style.display = "block"; pe.mount(payBox);
    cta.disabled = false; cta.textContent = "Pay " + price;
    cta.onclick = async () => {
      cta.disabled = true; cta.textContent = "Paying\u2026";
      const { error } = await stripe.confirmPayment({ elements, redirect: "if_required" });
      if (error) { say(error.message || "Payment failed.", true); cta.disabled = false; cta.textContent = "Pay " + price; return; }
      unlocked();
    };
  }

  async function vHome() {
    const _n = _nav;
    const name = (PROFILE && PROFILE.name) || "there";
    view.innerHTML = `<div class="greet"><div class="day">${new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</div>
      <h2>Good day, ${esc(name)}</h2><p>A little movement today goes a long way.</p></div>
      <p class="page-sub" style="padding:8px 2px">Loading your day&hellip;</p>`;
    // Dynamic hero = the member's next video session: first one with real video that they
    // haven't completed yet (advances as they finish each). Falls back gracefully.
    const _hasVid = w => (w.steps || []).some(s => s.video);
    const hero = DATA.workouts.find(w => _hasVid(w) && !w.locked && !ST.completed[w.id])
      || DATA.workouts.find(w => _hasVid(w) && !w.locked)
      || DATA.workouts.find(w => w.cat === "Tai Chi Chair" && !w.locked)
      || DATA.workouts.find(w => !w.locked) || DATA.workouts[0];
    const heroPill = ST.completed[hero.id] ? "✓ Completed" : "Up next";
    let activeFast = null, fastHist = [];
    try { if (!_recipes) _recipes = await DB.recipes(); if (!_week) _week = await ensureWeek(false); } catch (e) { /* plan optional */ }
    const acadCard = await homeAcademyCard();
    try { [activeFast, fastHist] = await Promise.all([DB.activeFast(), DB.fastingHistory()]); } catch (e) { /* optional */ }
    // Self-assessment: show today's mood/stress icons
    const mi = ST.latest.mood ? MOOD_LAB.indexOf(ST.latest.mood) : -1;
    const si = ST.latest.stress ? STRESS_LAB.indexOf(ST.latest.stress) : -1;
    const selfSub = mi >= 0 ? `<span style="font-size:22px">${MOOD_EMO[mi]}${si >= 0 ? " " + STRESS_EMO[si] : ""}</span>` : "Log mood &amp; stress";
    const impW = PROFILE && PROFILE.measurement_system === "imperial";
    const wUnitH = impW ? "lb" : "kg";
    const wValH = ST.latest.weight != null ? (impW ? Math.round(ST.latest.weight * 2.20462 * 10) / 10 : ST.latest.weight) : "—";
    // Fasting: show live/last state
    let fastSub = "Start a fast";
    if (activeFast) { const s = (Date.now() - new Date(activeFast.started_at)) / 3600000; fastSub = `⏱ Fasting now · ${Math.floor(s)}h ${Math.floor((s % 1) * 60)}m`; }
    else { const today = PLAN.isoDate(new Date()); const f = fastHist.find(x => PLAN.isoDate(new Date(x.started_at)) === today); if (f) { const d = (new Date(f.ended_at) - new Date(f.started_at)) / 3600000; fastSub = `✓ Done today · ${Math.floor(d)}h ${Math.round((d % 1) * 60)}m`; } }
    if (_n !== _nav) return;   // user navigated away while Home was loading — don't clobber the new view
    view.innerHTML = `
      <div class="greet"><div class="day">${new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</div>
        <h2>Good day, ${esc(name)}</h2><p>A little movement today goes a long way.</p></div>
      <div class="widgets"><div class="col">
        <div class="hero-card" data-go="${hero.id}"><img src="${img(hero.seed,800,500)}" alt=""><div class="veil"></div>
          <div class="meta"><div class="pills"><span>${hero.min} min</span><span>${hero.level}</span><span>${heroPill}</span></div>
          <div class="title">${esc(hero.title)}</div></div><button class="play">▶</button></div>
        <a class="pdfcard" href="assets/tai-chi-walking2.pdf?v=1" download="Tai-Chi-Walking.pdf">
          <span class="pc-ic">🎁</span>
          <span class="pc-txt"><span class="pc-t">Download Free PDF: Tai Chi Walking</span><span class="pc-s">Click here to download</span></span>
          <span class="pc-dl">⬇</span></a>
        ${homeMealCard()}
        ${acadCard}
      </div><div class="col">
        ${homeCaloriesCard()}
        <div class="card mini"><div><div style="font-weight:700">Weight</div><div class="v">${wValH} <small>${wUnitH}</small></div></div><a class="btn ghost" href="#/track/weight">Log</a></div>
        <div class="card mini"><div><div style="font-weight:700">Water</div><div class="v">${ST.latest.water??0} <small>glasses</small></div></div><a class="btn ghost" href="#/track/water">Log</a></div>
        <div class="card mini"><div><div style="font-weight:700">Balance</div><div class="v">${ST.latest.balance??"—"} <small>/10</small></div></div><a class="btn ghost" href="#/track/balance">Log</a></div>
        <div class="card mini"><div><div style="font-weight:700">Self-assessment</div><div class="v" style="font-size:14px;color:var(--muted)">${selfSub}</div></div><a class="btn ghost" href="#/track/mood">Log</a></div>
        <div class="card mini"><div><div style="font-weight:700">Fasting</div><div class="v" style="font-size:14px;color:var(--muted)">${fastSub}</div></div><a class="btn ghost" href="#/track/fasting">Open</a></div>
      </div></div>
      ${renderGuides()}
      <a class="home-settings" href="#/profile"><span class="hs-ic">⚙️</span><span class="hs-txt"><b>Settings</b><small>Profile, units, palette &amp; more</small></span><span class="hs-ch">›</span></a>`;
    view.querySelector(".hero-card").onclick = () => location.hash = "#/workout/" + hero.id;
    wireGuides(view);
    view.querySelectorAll("[data-mact]").forEach(b => b.onclick = async (e) => {
      e.preventDefault();
      const today = PLAN.isoDate(new Date()), slot = b.dataset.slot, status = b.dataset.mact === "done" ? "done" : "skipped";
      const it = _week.items[today + "|" + slot]; if (it) it.status = status;
      await DB.setPlanStatus(today, slot, status); vHome();
    });
  }

  function walkDay(w) { return DATA.workouts.filter(x => x.cat === "Tai Chi Walking").findIndex(x => x.id === w.id) + 1; }
  function wcard(w) {
    const fav = !!ST.favorites[w.id];
    const isWalk = w.cat === "Tai Chi Walking";
    const walkImg = /^(https?:|assets\/)/.test(w.seed || "");
    const src = (isWalk && walkImg) ? w.seed : img(w.seed, 400, 260);
    const title = isWalk ? `Day ${walkDay(w)}` : esc(w.title);
    const meta = isWalk ? `${esc(w.title)} · ${w.min} min` : `${w.min} min · ${esc(w.focus || "")}`;
    return `<div class="wcard${isWalk ? " walk" : ""}" data-id="${w.id}" ${w.locked ? 'data-locked="1"' : ""}>
      <div class="thumb"><img src="${src}" alt=""><span class="b badge ${lv(w.level)}">${w.level}</span>
      ${w.locked ? `<div class="lock">🔒<span>${esc(w.locked)}</span></div>` : `<button class="fav" data-id="${w.id}">${fav ? "♥" : "♡"}</button>`}</div>
      <div class="body"><div class="t">${title}</div><div class="m">${meta}</div></div></div>`;
  }

  function vExercises(tab) {
    tab = tab || "workouts";
    const tabs = `<div class="tabs"><button data-t="workouts" class="${tab==='workouts'?'on':''}">Workouts</button><button data-t="plan" class="${tab==='plan'?'on':''}">Plan</button></div>`;
    let body = "";
    if (tab === "workouts") {
      const ACTIVE = ["Tai Chi Chair", "Tai Chi Walking"];
      const activeCats = DATA.categories.filter(c => ACTIVE.includes(c));
      const comingCats = DATA.categories.filter(c => !ACTIVE.includes(c));
      let active = sessionStorage.getItem("exfilter") || "All";
      if (active !== "All" && !activeCats.includes(active)) active = "All";
      const chips = ["All", ...activeCats];
      const sections = (active === "All" ? activeCats : [active]).map(cat => {
        const items = DATA.workouts.filter(w => w.cat === cat); if (!items.length) return "";
        return `<div class="section-title"><h2>${esc(cat)}</h2></div><div class="${active==='All'?'row-scroll':'grid-cards'}">${items.map(wcard).join("")}</div>`;
      }).join("");
      const coming = comingCats.length ? `<div class="section-title"><h2>Coming soon</h2></div>
        <div class="coming-row">${comingCats.map(c => `<div class="coming-chip"><span>${esc(c)}</span></div>`).join("")}</div>` : "";
      body = `<div class="filters">${chips.map(c => `<button data-c="${c}" class="${c===active?'on':''}">${c}</button>`).join("")}</div>${sections}${coming}`;
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
    if (steps.some(s => s.video || s.img)) return vAccWorkout(w, id, done, fav, steps);
    const stepsHtml = steps.length ? `<div class="section-title"><h2>Workouts</h2><span style="color:var(--muted);font-weight:700">${steps.length}</span></div>
      <div class="card listcard">${steps.map((s, i) => `<div class="lrow"><span class="lnum">${String(i+1).padStart(2,"0")}</span>
        <span class="ltext"><span class="lt">${esc(s.t)}</span><span class="ls"><span class="badge ${lv(s.lvl)}">${esc(s.lvl||"Beginner")}</span> · ${s.min||""} min</span></span><span class="chev">›</span></div>`).join("")}</div>` : "";
    view.innerHTML = `<button class="backlink" onclick="history.back()">‹ Back</button>
      <div class="player"><img src="${img(w.seed,1000,560)}" alt=""><div class="ov"><span class="badge" style="position:absolute;top:16px;left:16px;background:rgba(42,35,25,.82);color:#fff">COLLECTION</span><div class="pbtn">▶</div><div class="note">Video coming soon — hosting to be added</div></div></div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="badge ${lv(w.level)}">${w.level}</span><h1 class="page" style="margin:0;font-size:24px">${esc(w.title)}</h1>
        <button class="favico" id="favBtn" title="Save">${fav?"♥":"♡"}</button></div>
      <p class="page-sub">${w.min} min · ${esc(w.focus || "")}${steps.length?` · ${steps.length} workouts`:""}</p>
      <p style="color:var(--ink-soft)">A gentle ${esc((w.cat||"").toLowerCase())} session. Follow along at your own pace — sit tall, breathe slowly, and stop if anything hurts.</p>
      ${stepsHtml}
      <div class="cta-fixed"><button class="btn block" id="markDone">${done?"✓ Completed — do it again":"▶ Start collection"}</button></div>`;
    view.querySelector("#markDone").onclick = async () => { const on = !ST.completed[id]; if (on) ST.completed[id] = true; else delete ST.completed[id]; await DB.toggleSession(id, on); vWorkout(id); };
    view.querySelector("#favBtn").onclick = async () => { const on = !ST.favorites[id]; if (on) ST.favorites[id] = true; else delete ST.favorites[id]; await DB.toggleFav(id, on); vWorkout(id); };
  }

  function vAccWorkout(w, id, done, fav, steps) {
    const isWalk = w.cat === "Tai Chi Walking";
    const hasVideo = steps.some(s => s.video);
    const perMove = !hasVideo;                       // photo/walking sessions: close each move one-by-one
    const day = isWalk ? walkDay(w) : 0;
    const sd = () => { ST.stepDone = ST.stepDone || {}; return (ST.stepDone[id] = ST.stepDone[id] || {}); };
    const nDone = () => steps.reduce((a, _, i) => a + (sd()[i] ? 1 : 0), 0);

    const items = steps.map((s, i) => {
      const isDone = !!sd()[i];
      let body;
      if (s.video) {
        body = `<div class="wacc-video"><video controls playsinline preload="metadata"><source src="${s.video}" type="video/mp4"></video></div>${s.desc ? `<p class="wacc-desc below">${esc(s.desc)}</p>` : ""}<div class="wacc-foot"><button class="wacc-skip" data-i="${i}">Skip this move ⏭</button></div>`;
      } else {
        const how = Array.isArray(s.how) && s.how.length
          ? `<div class="wacc-how"><div class="wacc-how-h">How to do it</div>${s.how.map(p => `<div class="wacc-step"><b>${esc(p[0])}</b> — ${esc(p[1])}</div>`).join("")}</div>`
          : "";
        body = `<div class="wacc-photo"><img src="${s.img}" alt="${esc(s.t)}"></div>
          ${s.desc ? `<p class="wacc-cue">${esc(s.desc)}</p>` : ""}
          ${how}
          <button class="wacc-done${isDone ? " is-done" : ""}" data-i="${i}">${isDone ? "✓ Done — tap to undo" : "Mark as done"}</button>`;
      }
      const meta = s.dose ? esc(s.dose) : (s.min ? `${s.min} min` : "");
      return `<div class="wacc-item${isDone ? " done" : ""}${i === 0 ? " open" : ""}" data-item="${i}">
        <button class="wacc-head" data-i="${i}">
          <span class="lnum">${isDone ? "✓" : String(i + 1).padStart(2, "0")}</span>
          <span class="ltext"><span class="lt">${esc(s.t)}</span><span class="ls"><span class="badge ${lv(s.lvl)}">${esc(s.lvl || "Beginner")}</span>${meta ? ` · ${meta}` : ""}</span></span>
          <span class="wacc-chev">›</span></button>
        <div class="wacc-body">${body}</div>
      </div>`;
    }).join("");

    const nd0 = nDone();
    const progressHtml = perMove ? `<div class="wk-prog"><div class="wk-prog-top"><span>Your progress</span><span id="wkProgTxt">${nd0}/${steps.length} moves</span></div><div class="wk-bar"><i id="wkProgBar" style="width:${Math.round(nd0 / steps.length * 100)}%"></i></div></div>` : "";
    const allDone0 = nd0 >= steps.length;
    const showCta = hasVideo || allDone0;                 // no "mark all" shortcut — reset shows only once complete
    const startLabel = hasVideo
      ? (done ? "✓ Completed — do it again" : "▶ Start session")
      : "✓ Day complete — start over";

    view.innerHTML = `<button class="backlink" onclick="history.back()">‹ Back</button>
      <div class="wk-head"><span class="badge ${lv(w.level)}">${w.level}</span><h1 class="page wk-title">${esc(w.title)}</h1><button class="favico" id="favBtn" title="Save">${fav?"♥":"♡"}</button></div>
      <p class="page-sub">${isWalk ? `Day ${day} · ` : ""}${w.min} min · ${steps.length} moves${perMove ? " · tap each move done" : ""}</p>
      ${progressHtml}
      <div class="wacc" id="wacc">${items}</div>
      ${showCta ? `<div class="cta-fixed"><button class="btn block" id="markDone">${startLabel}</button></div>` : ""}`;
    _sessionRunning = false;
    const wacc = view.querySelector("#wacc");
    const els = () => view.querySelectorAll(".wacc-item");
    const played = new Set();
    const clearInterim = () => { if (_interimTimer) { clearInterval(_interimTimer); _interimTimer = null; } const el = document.getElementById("interim"); if (el) el.remove(); };
    const nextUnplayed = () => { for (let k = 0; k < steps.length; k++) if (!played.has(k)) return k; return -1; };
    const playMove = (i) => {
      view.querySelectorAll("video").forEach(v => v.pause());
      els().forEach((x, k) => x.classList.toggle("open", k === i));
      const it = els()[i]; if (!it) return;
      it.scrollIntoView({ behavior: "smooth", block: "center" });
      const v = it.querySelector("video");
      if (v) { try { v.currentTime = 0; } catch (e) {} const p = v.play(); if (p && p.catch) p.catch(() => {}); }
      else afterMove(i);
    };
    const finish = async () => {
      clearInterim(); _sessionRunning = false; if (wacc) wacc.classList.remove("playing");
      view.querySelectorAll("video").forEach(v => v.pause());
      const btn = view.querySelector("#markDone"); if (btn) btn.textContent = "✓ Completed — do it again";
      if (!ST.completed[id]) { ST.completed[id] = true; try { await DB.toggleSession(id, true); } catch (e) {} }
    };
    const showInterim = (i) => {
      clearInterim();
      view.querySelectorAll("video").forEach(v => v.pause());
      let count = 3;
      const el = document.createElement("div"); el.id = "interim"; el.className = "interim";
      el.innerHTML = `<button class="interim-x" aria-label="End session">✕</button>
        <div class="interim-eyebrow">COMING UP</div>
        <div class="interim-ring"><span id="interimCount">${count}</span></div>
        <div class="interim-title">${esc(steps[i].t)}</div>
        <div class="interim-sub">Move ${i + 1} of ${steps.length} · get ready</div>
        <button class="interim-skip">Skip move</button>`;
      document.body.appendChild(el);
      el.querySelector(".interim-x").onclick = () => { clearInterim(); _sessionRunning = false; if (wacc) wacc.classList.remove("playing"); const btn = view.querySelector("#markDone"); if (btn && !ST.completed[id]) btn.textContent = "▶ Start session"; };
      el.querySelector(".interim-skip").onclick = () => { clearInterim(); played.add(i); const n = nextUnplayed(); if (n < 0) return finish(); showInterim(n); };
      _interimTimer = setInterval(() => { count--; if (count <= 0) { clearInterim(); playMove(i); } else { const c = document.getElementById("interimCount"); if (c) c.textContent = count; } }, 1000);
    };
    function afterMove(i) { played.add(i); const n = nextUnplayed(); if (n < 0) return finish(); showInterim(n); }
    view.querySelectorAll(".wacc-head").forEach(b => b.onclick = () => {
      const item = b.closest(".wacc-item"), wasOpen = item.classList.contains("open");
      view.querySelectorAll("video").forEach(v => v.pause());
      els().forEach(x => x.classList.remove("open"));
      if (!wasOpen) item.classList.add("open");
    });
    els().forEach((it, i) => { const v = it.querySelector("video"); if (v) v.addEventListener("ended", () => { if (_sessionRunning) afterMove(i); }); });
    view.querySelectorAll(".wacc-skip").forEach(b => b.onclick = (e) => { e.stopPropagation(); if (_sessionRunning) afterMove(+b.dataset.i); });

    // ---- per-move completion (photo / walking sessions) ----
    const syncDay = async () => {
      const all = nDone() >= steps.length;
      if (all && !ST.completed[id]) { ST.completed[id] = true; try { await DB.toggleSession(id, true); } catch (e) {} }
      else if (!all && ST.completed[id]) { delete ST.completed[id]; try { await DB.toggleSession(id, false); } catch (e) {} }
    };
    const refreshProg = () => {
      const n = nDone();
      const t = view.querySelector("#wkProgTxt"); if (t) t.textContent = `${n}/${steps.length} moves`;
      const b = view.querySelector("#wkProgBar"); if (b) b.style.width = Math.round(n / steps.length * 100) + "%";
      if (perMove) {
        const complete = n >= steps.length;
        let cta = view.querySelector(".cta-fixed");
        if (complete && !cta) {
          cta = document.createElement("div"); cta.className = "cta-fixed";
          cta.innerHTML = `<button class="btn block" id="markDone">✓ Day complete — start over</button>`;
          view.appendChild(cta); wireMarkDone(cta.querySelector("#markDone"));
        } else if (!complete && cta) { cta.remove(); }
      }
    };
    const setMove = (i, on) => {
      if (on) sd()[i] = true; else delete sd()[i];
      const it = view.querySelector(`.wacc-item[data-item="${i}"]`);
      if (it) {
        it.classList.toggle("done", on);
        const num = it.querySelector(".lnum"); if (num) num.textContent = on ? "✓" : String(i + 1).padStart(2, "0");
        const btn = it.querySelector(".wacc-done"); if (btn) { btn.classList.toggle("is-done", on); btn.textContent = on ? "✓ Done — tap to undo" : "Mark as done"; }
      }
      refreshProg();
    };
    view.querySelectorAll(".wacc-done").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const i = +b.dataset.i, on = !sd()[i];
      setMove(i, on);
      try { await DB.markStep(id, i, on); } catch (err) {}
      await syncDay();
      if (on) {   // auto-open the next move still to do
        let nx = -1; for (let k = 0; k < steps.length; k++) if (!sd()[k]) { nx = k; break; }
        const arr = [...view.querySelectorAll(".wacc-item")];
        arr.forEach(x => x.classList.remove("open"));
        if (nx >= 0) { arr[nx].classList.add("open"); arr[nx].scrollIntoView({ behavior: "smooth", block: "center" }); }
      }
    });

    function wireMarkDone(btn) {
      if (!btn) return;
      btn.onclick = async () => {
        if (hasVideo) { played.clear(); _sessionRunning = true; if (wacc) wacc.classList.add("playing"); btn.textContent = "▶ Playing session…"; playMove(0); }
        else {                                           // perMove: button only shows when complete → start over
          steps.forEach((_, i) => delete sd()[i]);
          try { await DB.clearSteps(id); } catch (e) {}
          if (ST.completed[id]) { delete ST.completed[id]; try { await DB.toggleSession(id, false); } catch (e) {} }
          vWorkout(id);
        }
      };
    }
    wireMarkDone(view.querySelector("#markDone"));
    view.querySelector("#favBtn").onclick = async () => { const on = !ST.favorites[id]; if (on) ST.favorites[id] = true; else delete ST.favorites[id]; await DB.toggleFav(id, on); vWorkout(id); };
  }

  let _nav = 0;             // bumped on every route() — async views bail if it changes mid-load
  let _sessionRunning = false;   // true while a video workout is auto-playing move-by-move
  let _interimTimer = null;      // countdown interval for the "coming up" interstitial
  // ---------- Meals ----------
  let _recipes = null;
  let _mealCat = "all", _mealQ = "";
  let _week = null;         // { startISO, endISO, items:{'date|slot':item}, targets }
  let _selDay = null;       // ISO date currently selected
  let _planSub = "meals";   // meals | nutrition | groceries
  let _grocDays = null;     // Set of ISO dates included in the grocery list
  let _grocTick = {};       // { ingredientName: true } ticked-off items (localStorage per week)
  let _recipeCtx = null;    // { recipe, date, slot } — set when opening a recipe from the plan
  const FIBER_GOAL = { male: 30, female: 25, unknown: 25 };
  const round1 = x => Math.round(x * 10) / 10;
  let _fastTimer = null;    // live fasting interval
  let _fastGoal = 16;       // selected fasting window (hours)
  const FAST_PRESETS = [12, 14, 16, 18, 20, 24];

  function donut(val, max, big, unit) {
    const R = 34, C = 2 * Math.PI * R, pct = max ? Math.max(0, Math.min(1, val / max)) : 0, dash = C * pct;
    return `<svg viewBox="0 0 80 80" class="donut">
      <circle cx="40" cy="40" r="${R}" fill="none" stroke="var(--track)" stroke-width="8"/>
      <circle cx="40" cy="40" r="${R}" fill="none" stroke="var(--primary)" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(1)} ${(C-dash).toFixed(1)}" transform="rotate(-90 40 40)"/>
      <text x="40" y="42" text-anchor="middle" class="dnum2">${big}</text>
      <text x="40" y="54" text-anchor="middle" class="dunit">${unit}</text></svg>`;
  }
  function nutritionHtml(dateISO, dailyKcal) {
    const d = { kcal: 0, fiber: 0, carbs: 0, protein: 0, fat: 0 };
    SLOTS.forEach(slot => {
      const it = _week.items[dateISO + "|" + slot];
      if (it && it.status === "done") { const r = recipeById(it.recipe_id); if (r) { d.kcal += r.kcal||0; d.fiber += r.fiber||0; d.carbs += r.carbs||0; d.protein += r.protein||0; d.fat += r.fat||0; } }
    });
    const kGoal = dailyKcal || 2000;
    const fGoal = FIBER_GOAL[(PROFILE && (PROFILE.gender||"").toLowerCase())] || 25;
    return `<div class="nutri-cards">
      <div class="card nutri">${donut(d.kcal, kGoal, Math.round(d.kcal), "KCAL")}
        <div class="ninfo"><div class="nlabel">CALORIES</div><div class="nval">${Math.round(d.kcal)} of ${kGoal} kcal</div></div></div>
      <div class="card nutri">${donut(d.fiber, fGoal, round1(d.fiber), "G")}
        <div class="ninfo"><div class="nlabel">FIBER</div><div class="nval">${round1(d.fiber)} of ${fGoal} g fiber</div></div></div>
    </div>
    <div class="card nutri-macros"><div><b>${d.carbs}g</b><span>CARBS</span></div><div><b>${d.protein}g</b><span>PROTEIN</span></div><div><b>${d.fat}g</b><span>FAT</span></div></div>
    <p class="nutri-note">Totals count meals you've marked <b>done</b>. Skipped meals aren't included.</p>`;
  }
  const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
  const CAP = s => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- Groceries (smart aggregation) ----------
  function parseQty(str) {
    const m = str.trim().match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)/);
    if (!m) return null;
    const t = m[1];
    if (/\s/.test(t)) { const [a, f] = t.split(/\s+/); const [n, d] = f.split("/"); return +a + (+n) / (+d); }
    if (t.includes("/")) { const [n, d] = t.split("/"); return (+n) / (+d); }
    return parseFloat(t);
  }
  const GUNITS_RE = /\b(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lb|pounds?|g|kg|ml|l|cloves?|slices?|cans?|pinch|handful|sprigs?|stalks?|scoops?|links?|squares?|medium|large|small|pint|whole)\b/gi;
  const GSTOP = new Set("of to taste cut into inch inches pieces piece room temperature at for serving plus more about each or a an the chopped sliced diced minced shredded crumbled drained boneless skinless thinly fresh frozen canned roasted grilled baked trimmed halved peeled cubed toasted rinsed divided packed shelled seeded stemmed torn beaten softened overnight raw cooked ground grated extra virgin low fat nonfat plain unsweetened whole dried juice zest and light coarse kosher sea ripe wheat".split(" "));
  function singular(w) {
    if (/(ss|us|is)$/.test(w)) return w;
    if (w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (/(oes|ses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
    if (w.endsWith("s")) return w.slice(0, -1);
    return w;
  }
  function cleanIngName(str) {
    let s = str.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[\d/.]+/g, " ").replace(/[,;.]/g, " ").replace(/-/g, " ").replace(GUNITS_RE, " ");
    const w = s.split(/\s+/).filter(x => x && !GSTOP.has(x));
    if (w.length) w[w.length - 1] = singular(w[w.length - 1]);   // singularize head noun so "egg"/"eggs" group
    return w.join(" ").trim();
  }
  function normUnit(u) { u = u.toLowerCase();
    if (u.startsWith("cup")) return "cup"; if (u.startsWith("tbsp") || u.startsWith("tablespoon")) return "tbsp";
    if (u.startsWith("tsp") || u.startsWith("teaspoon")) return "tsp"; if (u.startsWith("oz") || u.startsWith("ounce")) return "oz";
    if (u.startsWith("lb") || u.startsWith("pound")) return "lb"; if (u.startsWith("clove")) return "clove";
    if (u.startsWith("slice")) return "slice"; if (u.startsWith("can")) return "can"; return u; }
  function parseAmount(str) {
    const low = str.toLowerCase();
    if (/to taste|for serving|to serve|for garnish/.test(low)) return { basis: "taste", qty: 0 };
    const par = str.match(/\((\d+(?:\.\d+)?)\s*(g|ml|kg|l)\)/i);
    if (par) { let v = parseFloat(par[1]); const u = par[2].toLowerCase();
      if (u === "kg") return { basis: "g", qty: v * 1000 }; if (u === "g") return { basis: "g", qty: v };
      if (u === "l") return { basis: "ml", qty: v * 1000 }; if (u === "ml") return { basis: "ml", qty: v }; }
    const q = parseQty(str);
    const um = low.match(/^[\s\d/.]*\b(cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lb|pounds?|cloves?|slices?|cans?)\b/);
    if (um) return { basis: normUnit(um[1]), qty: q || 1 };
    if (q != null) return { basis: "count", qty: q };
    return { basis: "taste", qty: 0 };
  }
  const trimNum = n => (Math.round(n * 100) / 100).toString();
  function pluralize(name, n) { if (n <= 1) return name; if (/(s|x|sh|ch)$/.test(name)) return name + "es"; if (/[^aeiou]y$/.test(name)) return name.slice(0, -1) + "ies"; return name + "s"; }
  function fmtLine(g) {
    const b = g.buckets, parts = [];
    if (b.g != null) parts.push(b.g >= 1000 ? (b.g / 1000).toFixed(b.g % 1000 ? 1 : 0).replace(/\.0$/, "") + " kg" : Math.round(b.g) + " g");
    if (b.ml != null) parts.push(b.ml >= 1000 ? (b.ml / 1000).toFixed(b.ml % 1000 ? 1 : 0).replace(/\.0$/, "") + " L" : Math.round(b.ml) + " ml");
    ["cup", "tbsp", "tsp", "oz", "lb", "clove", "slice", "can"].forEach(u => { if (b[u] != null) { const n = +trimNum(b[u]); parts.push(n + " " + (n > 1 && ["clove","slice","can","cup"].includes(u) ? u + "s" : u)); } });
    if (b.count != null) { const n = +trimNum(b.count); return { amt: String(n), name: pluralize(g.name, n) }; }
    if (!parts.length && g.taste) return { amt: "", name: g.name + " · to taste" };
    return { amt: parts.join(" + "), name: g.name };
  }
  function buildGroceries(dates) {
    const map = {};
    dates.forEach(d => SLOTS.forEach(slot => {
      const it = _week.items[d + "|" + slot]; if (!it) return;
      const r = recipeById(it.recipe_id); if (!r) return;
      (r.ingredients || []).forEach(ing => {
        const name = cleanIngName(ing); if (!name) return;
        const a = parseAmount(ing);
        const m = map[name] || (map[name] = { name, buckets: {}, taste: false });
        if (a.basis === "taste") m.taste = true;
        else m.buckets[a.basis] = (m.buckets[a.basis] || 0) + a.qty;
      });
    }));
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }
  function grocLines() {
    return buildGroceries([..._grocDays].sort()).map(g => { const f = fmtLine(g); return (f.amt ? f.amt + " " : "") + f.name; });
  }
  function printGroceries() {
    const lines = grocLines(); if (!lines.length) return;
    const w = window.open("", "_blank", "width=620,height=820");
    if (!w) { alert("Please allow pop-ups to print your list."); return; }
    const rows = lines.map(l => `<li><span class="cb"></span>${esc(l)}</li>`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Grocery list — Tai Motion</title>
      <style>body{font-family:Georgia,'Times New Roman',serif;color:var(--ink);padding:36px;max-width:560px;margin:0 auto}
      h1{font-size:24px;font-weight:500;margin:0 0 4px}p{color:var(--muted);margin:0 0 18px;font-size:14px}
      ul{padding:0;margin:0}li{list-style:none;padding:9px 2px;border-bottom:1px solid var(--band-a);font-size:16px}
      .cb{display:inline-block;width:15px;height:15px;border:1.5px solid #b7a894;border-radius:4px;margin-right:12px;vertical-align:-2px}
      @media print{body{padding:16px}}</style></head><body>
      <h1>Tai Motion — Grocery list</h1><p>${_grocDays.size} day${_grocDays.size===1?'':'s'} · ${lines.length} item${lines.length===1?'':'s'}</p>
      <ul>${rows}</ul>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`);
    w.document.close();
  }
  function emailGroceries(to) {
    const lines = grocLines();
    const subject = encodeURIComponent("Your Tai Motion grocery list");
    const body = encodeURIComponent("Grocery list (" + _grocDays.size + " day" + (_grocDays.size === 1 ? "" : "s") + "):\n\n" + lines.map(l => "☐ " + l).join("\n") + "\n\n— Tai Motion");
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`;
  }
  function weekDates() { return Array.from({ length: 7 }, (_, i) => PLAN.isoDate(PLAN.addDays(new Date(_week.startISO + "T00:00:00"), i))); }
  function groceriesHtml() {
    const wd = weekDates();
    if (!_grocDays || ![..._grocDays].every(d => wd.includes(d))) _grocDays = new Set(wd);
    try { _grocTick = JSON.parse(localStorage.getItem("groc_" + _week.startISO) || "{}"); } catch (e) { _grocTick = {}; }
    const chips = wd.map(d => { const dt = new Date(d + "T00:00:00"); const on = _grocDays.has(d);
      return `<button class="groc-day ${on?'on':''}" data-day="${d}"><span class="gd-check">${on?'✓':''}</span>${dt.toLocaleDateString(undefined,{weekday:'short'})} ${dt.getDate()}</button>`; }).join("");
    const list = buildGroceries([..._grocDays].sort());
    const items = list.length ? list.map(g => { const f = fmtLine(g), tk = !!_grocTick[g.name];
      return `<label class="groc-item ${tk?'got':''}"><input type="checkbox" data-name="${esc(g.name)}" ${tk?'checked':''}><span class="gi-amt">${esc(f.amt)}</span><span class="gi-name">${esc(f.name)}</span></label>`; }).join("")
      : `<p class="page-sub">Select at least one day to build your list.</p>`;
    const tools = list.length ? `<div class="groc-tools">
        <button class="groc-btn" id="grocPrint">🖨 Print</button>
        <button class="groc-btn" id="grocEmailBtn">✉ Email list</button>
      </div>
      <div class="groc-email" id="grocEmail" hidden>
        <input id="grocEmailInput" type="email" placeholder="name@example.com" value="${esc(PROFILE && PROFILE.email || "")}">
        <button class="btn" id="grocEmailSend">Send</button>
        <div class="groc-email-msg" id="grocEmailMsg"></div>
      </div>` : "";
    return `<div class="groc"><div class="groc-lbl">Include days</div><div class="groc-days">${chips}</div>
      ${list.length ? `<div class="groc-count">${list.length} item${list.length===1?'':'s'} across ${_grocDays.size} day${_grocDays.size===1?'':'s'}</div>` : ""}
      ${tools}
      <div class="groc-list">${items}</div></div>`;
  }

  function recipeById(id) { return (_recipes || []).find(r => r.id === id); }
  // current weight: logged check-in first, else the value from their quiz
  function curWeightKg() {
    const w = parseFloat(ST.latest.weight); if (w > 0) return w;
    const q = parseFloat(PROFILE && PROFILE.quiz_weight_kg); return q > 0 ? q : null;
  }

  async function ensureWeek(force) {
    const ws = PLAN.weekStartOf(new Date());
    const startISO = PLAN.isoDate(ws), endISO = PLAN.isoDate(PLAN.addDays(ws, 6));
    let hadExisting = false;
    if (!force) {
      const existing = await DB.getPlanItems(startISO, endISO);
      if (existing.length) {
        hadExisting = true;
        const run = await DB.getPlanRun(startISO);
        const placeholder = !run || run.start_weight_kg == null;
        // If the plan was a non-personalized placeholder and we now know a weight, upgrade it.
        if (!(placeholder && curWeightKg() != null)) {
          const items = {}; existing.forEach(it => items[it.plan_date + "|" + it.meal_type] = it);
          return { startISO, endISO, items, targets: run ? { daily: run.daily_kcal, split: run.split || {}, basis: run.start_weight_kg ? "personalized" : "default", goal: run.goal_weight_kg } : { daily: null, split: {}, basis: "default" } };
        }
      }
    }
    const t = PLAN.targets(PROFILE, curWeightKg());
    const gen = PLAN.generateWeek(_recipes, t.split, ws, PROFILE.id || "seed");
    if (force || hadExisting) await DB.deletePlanWeek(startISO, endISO);
    await DB.savePlanRun({ week_start: startISO, start_weight_kg: curWeightKg(), goal_weight_kg: PROFILE.target_weight_kg || null,
      gender: t.gender, age: t.age, height_cm: t.height, activity: 1.35, daily_kcal: t.daily, split: t.split });
    await DB.savePlanItems(gen);
    const items = {}; gen.forEach(it => items[it.plan_date + "|" + it.meal_type] = Object.assign({ status: "pending" }, it));
    return { startISO, endISO, items, targets: { daily: t.daily, split: t.split, basis: t.basis, goal: PROFILE.target_weight_kg, missing: t.missing } };
  }

  async function vMeals(tab) {
    const _n = _nav;
    tab = tab === "library" ? "library" : "plan";
    view.innerHTML = `<h1 class="page">Meal plan</h1><p class="page-sub">Loading&hellip;</p>`;
    _recipes || (_recipes = await DB.recipes());
    if (_n !== _nav) return;
    const tabs = `<div class="tabs"><button data-t="plan" class="${tab==='plan'?'on':''}">Plan</button><button data-t="library" class="${tab==='library'?'on':''}">Library</button></div>`;

    if (tab === "library") {
      view.innerHTML = `<h1 class="page">Meal plan</h1>${tabs}<div class="meal-tools"><input id="mealSearch" class="meal-search" type="search" placeholder="Search recipes or ingredients&hellip;" value="${esc(_mealQ)}"><div class="chips" id="mealCats">${["all","breakfast","lunch","dinner","snack"].map(c=>`<button data-c="${c}" class="chip ${_mealCat===c?'on':''}">${c==='all'?'All':CAP(c)}</button>`).join("")}</div></div><div id="mealResults"></div>`;
      view.querySelectorAll(".tabs button").forEach(b => b.onclick = () => location.hash = "#/meals/" + b.dataset.t);
      const results = view.querySelector("#mealResults");
      const cardHtml = r => `<div class="wcard meal" data-id="${r.id}"><div class="thumb"><img src="${rimg(r,400,260)}" alt=""><span class="b badge beg">${esc(r.meal_type)}</span></div><div class="body"><div class="t">${esc(r.title)}</div><div class="m">${r.minutes} min &middot; ${r.kcal} kcal</div></div></div>`;
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
      let note = "";
      if (needs.length) {
        const parts = [];
        if (needs.includes("weight")) parts.push(`log your current weight in <a href="#/track/weight">Tracking</a>`);
        if (needs.includes("height")) parts.push(`add your height in <a href="#/profile">Profile</a>`);
        note = `<div class="plan-note">To personalize this plan for weight loss, ${parts.join(" and ")}.</div>`;
      }
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
        return `<div class="meal-card" data-id="${r.id}" data-slot="${slot}"><div class="mc-top"><img src="${rimg(r,240,180)}" alt="">
          <div class="mc-body"><span class="badge beg">${CAP(slot)}</span><div class="n">${esc(r.title)}</div>${r.description?`<div class="mc-desc">${esc(r.description)}</div>`:""}<div class="s">${r.minutes} min &middot; ${r.kcal} kcal${it.kcal_target?` &middot; target ~${it.kcal_target}`:""}</div></div></div>${footer}</div>`;
      }).join("");
      const selDate = new Date(_selDay + "T00:00:00");
      const dayLabel = selDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      let subHtml;
      if (_planSub === "nutrition") subHtml = `<h2 class="today-h">${dayLabel}</h2>${nutritionHtml(_selDay, t.daily)}`;
      else if (_planSub === "groceries") subHtml = groceriesHtml();
      else subHtml = `<h2 class="today-h">${dayLabel}</h2>${rows}`;
      const subBtn = (s, label) => `<button class="${_planSub===s?'on':''}" data-s="${s}">${label}</button>`;
      view.innerHTML = `<div class="mealhdr"><h1 class="page" style="margin:0">Meal plan</h1><button class="regen" id="regen">&#8635; Regenerate</button></div>
        ${tabs}
        <div class="target-card"><div class="tc-main">${targetLine}</div><div class="tc-sub">Meals tuned to a gentle, steady deficit. Guidance only, not medical advice.</div></div>
        ${note}
        <div class="daystrip">${strip}</div>
        <div class="subtabs">${subBtn("meals","Meals")}${subBtn("nutrition","Nutrition")}${subBtn("groceries","Groceries")}</div>
        <div id="subview">${subHtml}</div>`;
      view.querySelectorAll(".tabs button").forEach(b => b.onclick = () => location.hash = "#/meals/" + b.dataset.t);
      view.querySelector("#regen").onclick = async () => {
        if (!confirm("Regenerate this week's plan from your current weight? This replaces the current week.")) return;
        view.innerHTML = `<h1 class="page">Meal plan</h1><p class="page-sub">Building your plan&hellip;</p>`;
        _week = await ensureWeek(true); renderPlan();
      };
      view.querySelectorAll(".daychip").forEach(b => b.onclick = () => { _selDay = b.dataset.day; renderPlan(); });
      view.querySelectorAll(".subtabs button").forEach(b => b.onclick = () => { _planSub = b.dataset.s; renderPlan(); });
      if (_planSub === "groceries") {
        view.querySelectorAll(".groc-day").forEach(b => b.onclick = () => { const d = b.dataset.day; _grocDays.has(d) ? _grocDays.delete(d) : _grocDays.add(d); renderPlan(); });
        view.querySelectorAll(".groc-item input").forEach(cb => cb.onchange = () => {
          const n = cb.dataset.name; if (cb.checked) _grocTick[n] = true; else delete _grocTick[n];
          localStorage.setItem("groc_" + _week.startISO, JSON.stringify(_grocTick));
          cb.closest(".groc-item").classList.toggle("got", cb.checked);
        });
        const pb = view.querySelector("#grocPrint"); if (pb) pb.onclick = printGroceries;
        const eb = view.querySelector("#grocEmailBtn"), box = view.querySelector("#grocEmail");
        if (eb) eb.onclick = () => { box.hidden = !box.hidden; if (!box.hidden) view.querySelector("#grocEmailInput").focus(); };
        const es = view.querySelector("#grocEmailSend");
        if (es) es.onclick = () => {
          const inp = view.querySelector("#grocEmailInput"), msg = view.querySelector("#grocEmailMsg");
          const v = inp.value.trim();
          if (!/^\S+@\S+\.\S+$/.test(v)) { msg.textContent = "Please enter a valid email address."; msg.style.color = "var(--accent)"; inp.focus(); return; }
          emailGroceries(v); msg.textContent = "Opening your email app…"; msg.style.color = "var(--muted)";
        };
      }
      if (_planSub === "meals") {
        view.querySelectorAll(".meal-card .mc-top").forEach(el => el.onclick = () => { const c = el.closest(".meal-card"); _recipeCtx = { recipe: c.dataset.id, date: _selDay, slot: c.dataset.slot }; location.hash = "#/recipe/" + c.dataset.id; });
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
    }
    renderPlan();
  }

  // find the plan item (date+slot) this recipe corresponds to, if it's in the current week
  function planItemForRecipe(id, mealType) {
    if (!_week) return null;
    const today = PLAN.isoDate(new Date());
    if (_recipeCtx && _recipeCtx.recipe === id) {
      const it = _week.items[_recipeCtx.date + "|" + _recipeCtx.slot];
      if (it && it.recipe_id === id) return it;
    }
    const matches = Object.values(_week.items).filter(it => it.recipe_id === id && it.meal_type === mealType);
    return matches.find(it => it.plan_date === today) || matches.find(it => it.plan_date === _selDay) || matches[0] || null;
  }
  function recipeActionHtml(it) {
    if (!it) return "";
    if (it.status === "done") return `<div class="ra-state done"><span>&#10003; Completed</span><button data-act="reset">&#8635; Undo</button></div>`;
    if (it.status === "skipped") return `<div class="ra-state skip"><span>&#9655; Skipped</span><button data-act="reset">&#8635; Undo</button></div>`;
    return `<div class="ra-actions"><button class="ra-done" data-act="done">&#10003; Mark complete</button><button class="ra-skip" data-act="skip">&#9655; Skip</button></div>`;
  }

  // ---- Similar recipes: shared-ingredient similarity, weighted by rarity (IDF) ----
  const _STOP = new Set(("a an the of and or with without to into plus more for from in on at as " +
    "tbsp tsp teaspoon teaspoons tablespoon tablespoons cup cups oz ounce ounces g gram grams kg ml l lb lbs pound pounds " +
    "pinch dash clove cloves can cans jar jars package packet stick sticks slice slices piece pieces sprig sprigs handful " +
    "small medium large whole half halves finely thinly freshly fresh ground chopped diced minced sliced grated shredded " +
    "crumbled divided drained rinsed cooked raw boneless skinless extra virgin room temperature cut halved seeded quartered " +
    "peeled toasted plain low reduced free about approx approximately optional taste serve serving servings coarse " +
    "your you it is are size inch cm each per note about").split(/\s+/));
  let _idf = null; const _kwCache = new WeakMap();
  function _kw(rec) {
    if (_kwCache.has(rec)) return _kwCache.get(rec);
    const src = ((rec.title || "") + " " + (rec.ingredients || []).join(" ")).toLowerCase()
      .replace(/\([^)]*\)/g, " ").replace(/[^a-z\s-]/g, " ");
    const set = new Set();
    src.split(/[\s-]+/).forEach(w => { if (w.length >= 3 && !_STOP.has(w)) set.add(w); });
    _kwCache.set(rec, set); return set;
  }
  function similarRecipes(target, all, k) {
    if (!_idf) {
      const df = new Map();
      all.forEach(rec => _kw(rec).forEach(w => df.set(w, (df.get(w) || 0) + 1)));
      const N = all.length; _idf = new Map();
      df.forEach((c, w) => _idf.set(w, Math.log((N + 1) / (c + 1))));   // rarer ingredient => higher weight
    }
    const tset = _kw(target);
    return all.filter(x => x.id !== target.id).map(x => {
      let s = 0;
      _kw(x).forEach(w => { if (tset.has(w)) s += (_idf.get(w) || 0); });      // shared-ingredient score
      if (x.meal_type === target.meal_type) s += 0.6;                          // light nudge, not a filter
      s += 0.5 * Math.max(0, 1 - Math.abs((x.kcal || 0) - (target.kcal || 0)) / 500); // calorie proximity tiebreak
      return { x, s };
    }).sort((a, b) => b.s - a.s).slice(0, k).map(o => o.x);
  }

  async function vRecipe(id) {
    const _n = _nav;
    const recipes = _recipes || (_recipes = await DB.recipes());
    const r = recipes.find(x => x.id === id); if (!r) return notFound();
    if (!_week) { try { _week = await ensureWeek(false); } catch (e) { /* plan optional */ } }
    if (_n !== _nav) return;
    const fav = !!ST.favorites[id];
    const ing = (r.ingredients || []).map(i => `<li>${esc(i)}</li>`).join("");
    const ins = (r.instructions || []).map((s, i) => `<div class="lrow"><span class="lnum">${i+1}</span><span class="ltext"><span class="lt" style="font-weight:600">${esc(s)}</span></span></div>`).join("");
    const similar = similarRecipes(r, recipes, 6).map(x => `<div class="wcard meal" data-id="${x.id}" style="min-width:200px"><div class="thumb"><img src="${rimg(x,400,260)}"><span class="b badge beg">${x.kcal} kcal</span></div><div class="body"><div class="t" style="font-size:15px">${esc(x.title)}</div></div></div>`).join("");
    const planItem = planItemForRecipe(id, r.meal_type);
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/meals'">‹ Meals</button>
      <div class="recipe-hero">
        <div class="rh-img"><img src="${rimg(r,700,700)}" alt=""></div>
        <div class="rh-info">
          <div class="rh-top"><span class="badge beg">${esc(r.meal_type)}</span>
            <button class="favico" id="favBtn" title="Save">${fav?"♥":"♡"}</button></div>
          <h1 class="rh-title">${esc(r.title)}</h1>
          <div class="rh-meta">${r.minutes} min &middot; ${r.kcal} kcal &middot; ${r.servings} serving${r.servings==1?'':'s'}</div>
          <div class="macros rh-macros"><div><b>${r.protein}g</b><span>Protein</span></div><div><b>${r.carbs}g</b><span>Carbs</span></div><div><b>${r.fat}g</b><span>Fat</span></div><div><b>${r.fiber||0}g</b><span>Fiber</span></div></div>
          <div id="recipeAction">${recipeActionHtml(planItem)}</div>
        </div>
      </div>
      ${r.description ? `<p class="recipe-desc">${esc(r.description)}</p>` : ""}
      <div class="section-title"><h2>Ingredients</h2></div><div class="card"><ul class="ing-list">${ing}</ul></div>
      <div class="section-title"><h2>Instructions</h2></div><div class="card listcard">${ins}</div>
      <div class="section-title"><h2>Similar recipes</h2></div><div class="row-scroll">${similar}</div>`;
    view.querySelector("#favBtn").onclick = async () => { const on = !ST.favorites[id]; if (on) ST.favorites[id] = true; else delete ST.favorites[id]; await DB.toggleFav(id, on, "recipe"); vRecipe(id); };
    view.querySelectorAll(".meal").forEach(el => el.onclick = () => { _recipeCtx = null; location.hash = "#/recipe/" + el.dataset.id; });
    // Done / Skip bound to the plan item
    const raEl = view.querySelector("#recipeAction");
    function bindRA() {
      if (!planItem || !raEl) return;
      raEl.querySelectorAll("[data-act]").forEach(b => b.onclick = async () => {
        const status = b.dataset.act === "reset" ? "pending" : b.dataset.act === "done" ? "done" : "skipped";
        planItem.status = status;                    // same object stored in _week.items -> plan list stays in sync
        raEl.innerHTML = recipeActionHtml(planItem); bindRA();
        await DB.setPlanStatus(planItem.plan_date, planItem.meal_type, status);
      });
    }
    bindRA();
  }

  function vTracking() {
    view.innerHTML = `<h1 class="page">Tracking</h1><p class="page-sub">Log and review your daily metrics.</p>
      <div class="track-grid">${C.trackers.map(t => { const last = ST.latest[t.id];
        const sub = t.special === "fasting" ? "Timed fasting tracker"
          : t.special === "self" ? ((ST.latest.mood || ST.latest.stress) ? `Mood: ${esc(ST.latest.mood||"—")} · Stress: ${esc(ST.latest.stress||"—")}` : "Log mood & stress")
          : (last != null ? esc(last) + (t.unit ? " " + t.unit : "") : "No entries yet");
        return `<div class="track-tile" data-m="${t.id}"><div class="ic">${t.icon}</div><div class="tt"><div class="l">${t.label}</div>
        <div class="v">${sub}</div></div><span style="color:var(--muted)">›</span></div>`; }).join("")}</div>`;
    view.querySelectorAll(".track-tile").forEach(t => t.onclick = () => location.hash = "#/track/" + t.dataset.m);
  }

  function vTrack(metric) {
    const t = C.trackers.find(x => x.id === metric); if (!t) return notFound();
    if (t.special === "self") return vSelfAssess();
    if (t.special === "fasting") return vFasting();
    const isWeight = metric === "weight";
    const imp = isWeight && PROFILE && PROFILE.measurement_system === "imperial";
    const wUnit = imp ? "lb" : "kg";
    const toDisp = kg => imp ? Math.round(kg * 2.20462 * 10) / 10 : Math.round(kg * 10) / 10;
    const toKg = d => imp ? d / 2.20462 : d;
    const inpUnit = isWeight ? wUnit : t.unit;
    const input = t.numeric
      ? `<div class="logger"><input id="val" type="number" inputmode="decimal" placeholder="Enter ${t.label.toLowerCase()} (${inpUnit})"></div>`
      : `<div class="moodrow">${["😟","😕","😐","🙂","😄"].map((m,i)=>`<button data-mood="${i+1}">${m}</button>`).join("")}</div>`;
    const hist = ST.history[metric] || [];
    const tgtField = isWeight ? `<label class="fl">Target weight (${wUnit})</label><input id="tgt" class="tin" type="number" inputmode="decimal" value="${PROFILE?.target_weight_kg != null ? toDisp(PROFILE.target_weight_kg) : ""}" placeholder="${imp ? "e.g. 154" : "e.g. 70"}">` : "";
    const trend = (isWeight && hist.length > 1) ? `<div class="sec-label" style="margin:18px 0 8px">TREND</div><div class="card">${trendSvg(hist, PROFILE?.target_weight_kg)}</div>` : "";
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/tracking'">‹ Tracking</button>
      <h1 class="page">${t.icon} ${t.label}</h1>
      ${t.desc ? `<p class="page-sub">${esc(t.desc)}</p>` : ""}
      <div class="card">${input}${tgtField}<button class="btn block" id="save" style="margin-top:14px">Save entry</button></div>
      ${trend}
      <div class="sec-label" style="margin:18px 0 8px">HISTORY</div>
      <div class="hist">${hist.length?hist.map(h=>`<div class="h"><span>${isWeight ? toDisp(parseFloat(h.value)) + " " + wUnit : esc(String(h.value)) + " " + (t.unit||"")}</span><span style="color:var(--muted)">${new Date(h.at).toLocaleString()}</span></div>`).join(""):'<p class="page-sub">No entries yet.</p>'}</div>`;
    let mood = null;
    view.querySelectorAll(".moodrow button").forEach(b => b.onclick = () => { mood = +b.dataset.mood; view.querySelectorAll(".moodrow button").forEach(x=>x.classList.remove("on")); b.classList.add("on"); });
    view.querySelector("#save").onclick = async () => {
      let v = t.numeric ? view.querySelector("#val").value : mood;
      if (t.numeric) { if (!(parseFloat(v) >= 0)) { view.querySelector("#val").focus(); return; } }
      else { if (!v) return; v = ["Very low","Low","Okay","Good","Great"][v-1]; }
      if (isWeight) { const tg = parseFloat(view.querySelector("#tgt").value); if (tg > 0) { const tgKg = Math.round(toKg(tg) * 10) / 10; await DB.updateProfile({ target_weight_kg: tgKg }); if (PROFILE) PROFILE.target_weight_kg = tgKg; } }
      let storeVal = v;
      if (isWeight) storeVal = Math.round(toKg(parseFloat(v)) * 10) / 10;
      await DB.addCheckin(metric, storeVal, isWeight ? "kg" : t.unit);
      (ST.history[metric] = ST.history[metric] || []).unshift({ value: storeVal, at: new Date().toISOString() });
      ST.latest[metric] = storeVal; vTrack(metric);
    };
  }

  // ---------- Self-assessment (mood + stress) ----------
  const MOOD_EMO = ["😟", "😕", "😐", "🙂", "😄"], MOOD_LAB = ["Very low", "Low", "Okay", "Good", "Great"];
  const STRESS_EMO = ["😌", "🙂", "😐", "😧", "😫"], STRESS_LAB = ["Very calm", "Calm", "Neutral", "Tense", "Very tense"];
  function vSelfAssess() {
    let selMood = null, selStress = null;
    const mHist = ST.history.mood || [], sHist = ST.history.stress || [];
    const emojiFor = (labs, emos, val) => { const i = labs.indexOf(val); return i >= 0 ? emos[i] : "•"; };
    const histBlock = (title, hist, labs, emos) => `<div class="sec-label" style="margin:18px 0 8px">${title}</div>` +
      (hist.length ? `<div class="hist">${hist.slice(0, 20).map(h => `<div class="h"><span>${emojiFor(labs, emos, h.value)} ${esc(String(h.value))}</span><span style="color:var(--muted)">${new Date(h.at).toLocaleString()}</span></div>`).join("")}</div>` : '<div class="card"><p class="page-sub" style="margin:0;text-align:center">No entries yet.</p></div>');
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/tracking'">‹ Tracking</button>
      <h1 class="page">🧘 Mood &amp; stress</h1><p class="page-sub">Log how you feel today and look back over time.</p>
      <div class="card">
        <div class="sec-label">HOW IS YOUR MOOD TODAY?</div>
        <div class="moodrow" id="moodRow">${MOOD_EMO.map((m, i) => `<button data-i="${i}" title="${MOOD_LAB[i]}">${m}</button>`).join("")}</div>
        <div class="sec-label" style="margin-top:18px">HOW IS YOUR STRESS TODAY?</div>
        <div class="moodrow" id="stressRow">${STRESS_EMO.map((m, i) => `<button data-i="${i}" title="${STRESS_LAB[i]}">${m}</button>`).join("")}</div>
        <button class="btn block" id="saveSA" style="margin-top:18px">Save entry</button>
      </div>
      ${histBlock("MOOD HISTORY", mHist, MOOD_LAB, MOOD_EMO)}
      ${histBlock("STRESS HISTORY", sHist, STRESS_LAB, STRESS_EMO)}`;
    view.querySelectorAll("#moodRow button").forEach(b => b.onclick = () => { selMood = +b.dataset.i; view.querySelectorAll("#moodRow button").forEach(x => x.classList.toggle("on", x === b)); });
    view.querySelectorAll("#stressRow button").forEach(b => b.onclick = () => { selStress = +b.dataset.i; view.querySelectorAll("#stressRow button").forEach(x => x.classList.toggle("on", x === b)); });
    view.querySelector("#saveSA").onclick = async () => {
      if (selMood == null && selStress == null) return;
      if (selMood != null) { const v = MOOD_LAB[selMood]; await DB.addCheckin("mood", v, ""); (ST.history.mood = ST.history.mood || []).unshift({ value: v, at: new Date().toISOString() }); ST.latest.mood = v; }
      if (selStress != null) { const v = STRESS_LAB[selStress]; await DB.addCheckin("stress", v, ""); (ST.history.stress = ST.history.stress || []).unshift({ value: v, at: new Date().toISOString() }); ST.latest.stress = v; }
      vSelfAssess();
    };
  }

  // ---------- Fasting ----------
  function fmtHM(hoursFloat) { const h = Math.floor(hoursFloat), m = Math.round((hoursFloat - h) * 60); return `${h}h ${m}m`; }
  async function vFasting() {
    const _n = _nav;
    if (_fastTimer) { clearInterval(_fastTimer); _fastTimer = null; }
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/tracking'">‹ Tracking</button><h1 class="page">⏱️ Fasting</h1><p class="page-sub">Loading…</p>`;
    const [active, hist] = await Promise.all([DB.activeFast(), DB.fastingHistory()]);
    if (_n !== _nav) return;
    const histHtml = hist.length ? hist.map(f => {
      const dur = (new Date(f.ended_at) - new Date(f.started_at)) / 3600000;
      const reached = dur >= (f.goal_hours - 0.01);
      return `<div class="fast-h"><span class="fh-ic ${reached ? "ok" : ""}">${reached ? "✓" : "•"}</span>
        <span class="fh-main"><b>${fmtHM(dur)}</b> <small>of ${f.goal_hours}h</small><span class="fh-date">${new Date(f.started_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></span>
        ${reached ? '<span class="fh-goal">GOAL</span>' : ""}<button class="fh-del" data-del="${f.id}" title="Delete">🗑</button></div>`;
    }).join("") : '<div class="card"><p class="page-sub" style="margin:0;text-align:center">No fasts logged yet.</p></div>';
    const bindDel = () => view.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { await DB.deleteFast(b.dataset.del); vFasting(); });

    if (active) {
      const start = new Date(active.started_at), goalEnd = new Date(start.getTime() + active.goal_hours * 3600000);
      view.innerHTML = `<button class="backlink" onclick="location.hash='#/tracking'">‹ Tracking</button><h1 class="page">⏱️ Fasting</h1>
        <div class="card fast-live">
          <div class="fl-k">FASTING NOW · GOAL ${active.goal_hours}h</div>
          <div class="fast-ring" id="fastRing" style="--p:0"><div class="fl-clock" id="fastClock">0h 0m 0s</div></div>
          <div class="fl-times"><div><span>STARTED</span><b>${start.toLocaleString(undefined,{weekday:'short',hour:'2-digit',minute:'2-digit'})}</b></div><div><span>GOAL ENDS</span><b>${goalEnd.toLocaleString(undefined,{weekday:'short',hour:'2-digit',minute:'2-digit'})}</b></div></div>
          <button class="btn block" id="stopFast">Stop fast</button>
        </div>
        <div class="sec-label" style="margin:18px 0 8px">HISTORY</div><div class="fast-hist">${histHtml}</div>`;
      const tick = () => {
        const el = document.getElementById("fastClock"); if (!el) { if (_fastTimer) { clearInterval(_fastTimer); _fastTimer = null; } return; }
        const s = Math.max(0, (Date.now() - start.getTime()) / 1000);
        el.textContent = `${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m ${Math.floor(s%60)}s`;
        const ring = document.getElementById("fastRing"); if (ring) ring.style.setProperty("--p", (Math.min(1, s / 3600 / active.goal_hours) * 100).toFixed(1));
      };
      tick(); _fastTimer = setInterval(tick, 1000);
      view.querySelector("#stopFast").onclick = async () => { if (_fastTimer) { clearInterval(_fastTimer); _fastTimer = null; } await DB.stopFast(active.id); vFasting(); };
      bindDel();
    } else {
      view.innerHTML = `<button class="backlink" onclick="location.hash='#/tracking'">‹ Tracking</button><h1 class="page">⏱️ Fasting</h1>
        <p class="page-sub">Choose a window and begin, or log a fast you already finished.</p>
        <div class="card">
          <div class="sec-label">FASTING WINDOW</div>
          <div class="fast-presets">${FAST_PRESETS.map(h => `<button data-g="${h}" class="${h===_fastGoal?'on':''}">${h}h</button>`).join("")}</div>
          <button class="btn block" id="startFast" style="margin-top:14px">Start ${_fastGoal}h fast</button>
        </div>
        <div class="card" style="margin-top:16px">
          <div class="sec-label">LOG A COMPLETED FAST</div>
          <label class="fl">Started at</label><input id="fStart" class="tin" type="datetime-local">
          <label class="fl">Hours</label><input id="fHours" class="tin" type="number" inputmode="decimal" value="12" min="1" max="48">
          <div style="text-align:right;margin-top:12px"><button class="btn" id="logFast">Save</button></div>
        </div>
        <div class="sec-label" style="margin:18px 0 8px">HISTORY</div><div class="fast-hist">${histHtml}</div>`;
      const fs = view.querySelector("#fStart"); if (fs) { const n = new Date(Date.now() - 12 * 3600000); fs.value = new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
      view.querySelectorAll(".fast-presets button").forEach(b => b.onclick = () => { _fastGoal = +b.dataset.g; view.querySelectorAll(".fast-presets button").forEach(x => x.classList.toggle("on", x === b)); view.querySelector("#startFast").textContent = `Start ${_fastGoal}h fast`; });
      view.querySelector("#startFast").onclick = async () => { await DB.startFast(_fastGoal); vFasting(); };
      view.querySelector("#logFast").onclick = async () => { const st = view.querySelector("#fStart").value, hrs = parseFloat(view.querySelector("#fHours").value); if (!st || !(hrs > 0)) return; await DB.logFast(new Date(st).toISOString(), hrs); vFasting(); };
      bindDel();
    }
  }

  // small trend line for numeric history (newest-first input)
  function trendSvg(hist, target) {
    const pts = hist.slice(0, 12).map(h => parseFloat(h.value)).filter(n => !isNaN(n)).reverse();
    if (pts.length < 2) return "";
    const imp = PROFILE && PROFILE.measurement_system === "imperial";
    const U = imp ? "lb" : "kg";
    const cvW = v => imp ? Math.round(v * 2.20462 * 10) / 10 : Math.round(v * 10) / 10;
    const W = 300, H = 110, pad = 8;
    let lo = Math.min(...pts, target || Infinity), hi = Math.max(...pts, target || -Infinity);
    if (lo === hi) { lo -= 1; hi += 1; } const range = hi - lo;
    const x = i => pad + i * (W - 2 * pad) / (pts.length - 1);
    const y = v => pad + (1 - (v - lo) / range) * (H - 2 * pad);
    const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const tgtLine = (target > 0) ? `<line x1="${pad}" y1="${y(target).toFixed(1)}" x2="${W-pad}" y2="${y(target).toFixed(1)}" stroke="#a9c4b0" stroke-dasharray="4 4"/>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
      <path d="${d} L${x(pts.length-1).toFixed(1)},${H-pad} L${x(0).toFixed(1)},${H-pad} Z" fill="var(--primary-fade)"/>
      ${tgtLine}
      <path d="${d}" fill="none" stroke="var(--primary)" stroke-width="2.5"/>
      <circle cx="${x(0).toFixed(1)}" cy="${y(pts[0]).toFixed(1)}" r="4" fill="var(--primary)"/>
      <circle cx="${x(pts.length-1).toFixed(1)}" cy="${y(pts[pts.length-1]).toFixed(1)}" r="4" fill="var(--primary)"/>
    </svg><div class="chartlabels"><span>Previous: ${cvW(pts[0])} ${U}</span><span>Target ${target>0?cvW(target)+" "+U:"—"}</span><span>Last: ${cvW(pts[pts.length-1])} ${U}</span></div>`;
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
    const _n = _nav;
    const ids = Object.keys(ST.favorites);
    if (!ids.length) {
      view.innerHTML = `<h1 class="page">Favorites</h1><div class="soon"><div class="big">♡</div><p>No favorites yet. Tap the heart on any workout, meal or session to save it here.</p></div>`;
      return;
    }
    const recipes = _recipes || (_recipes = await DB.recipes());
    if (_n !== _nav) return;
    const workouts = DATA.workouts.filter(x => ids.includes(x.id));
    const media = Object.values(DATA.stress).flat().filter(x => ids.includes(x.id));
    const meals = recipes.filter(x => ids.includes(x.id));
    const mediaCard = x => `<div class="wcard" data-media="${x.id}"><div class="thumb"><img src="${img(x.seed,400,260)}"><button class="fav" data-id="${x.id}" data-type="media">♥</button></div><div class="body"><div class="t">${esc(x.title)}</div><div class="m">${x.min} min</div></div></div>`;
    const mealCard = x => `<div class="wcard meal" data-recipe="${x.id}"><div class="thumb"><img src="${rimg(x,400,260)}"><button class="fav" data-id="${x.id}" data-type="recipe">♥</button></div><div class="body"><div class="t">${esc(x.title)}</div><div class="m">${x.minutes} min · ${x.kcal} kcal</div></div></div>`;
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
    const impU = units === "imperial";
    const isGreen = (window.TM ? TM.get() : (document.documentElement.getAttribute("data-theme") || "brown")) === "green";
    let hFt = "", hIn = "";
    if (impU && p.height_cm) { const ti = Math.round(p.height_cm / 2.54); hFt = Math.floor(ti / 12); hIn = ti % 12; }
    view.innerHTML = `
      <h1 class="page">Profile</h1>
      <div class="prof-id"><span class="prof-av">${esc((p.name||p.email||"Y")[0]).toUpperCase()}</span>
        <div><div class="prof-name">${esc(p.name||"Your name")}</div><div class="page-sub" style="margin:0">${esc(p.email||"")}</div></div></div>

      <div class="card" style="margin-top:16px">
        <div class="sec-label">YOUR INFO</div>
        <label class="fl">Name</label><input id="pf-name" class="tin" value="${esc(p.name||"")}">
        <label class="fl">Email address</label><input class="tin" value="${esc(p.email||"")}" disabled>
        ${impU
          ? `<label class="fl">Height</label><div style="display:flex;gap:10px">
               <input id="pf-height-ft" class="tin" type="number" inputmode="numeric" value="${hFt}" placeholder="ft" style="flex:1">
               <input id="pf-height-in" class="tin" type="number" inputmode="numeric" value="${hIn}" placeholder="in" style="flex:1"></div>`
          : `<label class="fl">Height (cm)</label><input id="pf-height" class="tin" type="number" inputmode="decimal" value="${p.height_cm||""}" placeholder="e.g. 165">`}
        <label class="fl">Daily steps goal</label><input id="pf-steps" class="tin" type="number" value="${p.daily_steps_goal||7000}" placeholder="7000">
        <div style="text-align:right;margin-top:14px"><button class="btn" id="pf-save">Save changes</button></div>
        <div id="pf-msg" class="page-sub" style="text-align:right;margin-top:8px"></div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="sec-label">MEASUREMENT SYSTEM</div>
        <div class="seg"><button data-u="metric" class="${units==='metric'?'on':''}">Metric</button><button data-u="imperial" class="${units==='imperial'?'on':''}">Imperial</button></div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="sec-label">APPEARANCE</div>
        <div class="row-toggle">
          <div><div style="font-weight:700">Mint palette</div><div class="page-sub" style="margin:2px 0 0">Switch from the default warm theme to a calm green look.</div></div>
          <button class="tgl ${isGreen?'on':''}" id="pf-theme" role="switch" aria-checked="${isGreen}" aria-label="Mint palette"><span class="knob"></span></button>
        </div>
      </div>

      <div class="card listcard" style="margin-top:16px">
        <a class="lrow" href="#/subscription"><span>Manage subscription</span><span class="chev">›</span></a>
      </div>

      <div class="card listcard" style="margin-top:16px">
        <div class="sec-label" style="padding:18px 18px 0">HELP &amp; LEGAL</div>
        <a class="lrow" href="https://taimotion.com" target="_blank"><span>Privacy Policy</span><span class="chev">›</span></a>
        <a class="lrow" href="https://taimotion.com" target="_blank"><span>Terms of Service</span><span class="chev">›</span></a>
        <a class="lrow" href="mailto:hello@taimotion.com"><span>Support</span><span class="chev">›</span></a>
      </div>

      <div style="text-align:center;margin:26px 0"><button class="logout" id="pf-logout">Logout ⎋</button></div>`;
    // save
    view.querySelector("#pf-save").onclick = async () => {
      const name = view.querySelector("#pf-name").value.trim();
      const steps = parseInt(view.querySelector("#pf-steps").value) || 7000;
      let height_cm = null;
      if (impU) {
        const ft = parseFloat(view.querySelector("#pf-height-ft").value) || 0;
        const inch = parseFloat(view.querySelector("#pf-height-in").value) || 0;
        const totIn = ft * 12 + inch;
        height_cm = totIn > 0 ? Math.round(totIn * 2.54 * 10) / 10 : null;
      } else {
        const heightRaw = parseFloat(view.querySelector("#pf-height").value);
        height_cm = heightRaw > 0 ? heightRaw : null;
      }
      await DB.updateProfile({ name, daily_steps_goal: steps, height_cm });
      PROFILE.name = name; PROFILE.daily_steps_goal = steps; PROFILE.height_cm = height_cm;
      const m = view.querySelector("#pf-msg"); m.style.color = "var(--primary-dark)"; m.textContent = "✓ Saved";
      renderNav("profile");
    };
    view.querySelectorAll(".seg button").forEach(b => b.onclick = async () => {
      const u = b.dataset.u; view.querySelectorAll(".seg button").forEach(x => x.classList.toggle("on", x === b));
      await DB.updateProfile({ measurement_system: u }); PROFILE.measurement_system = u;
      vProfile();
    });
    const tgl = view.querySelector("#pf-theme");
    if (tgl) tgl.onclick = () => {
      const next = tgl.classList.contains("on") ? "brown" : "green";
      if (window.TM) TM.set(next);
      const on = next === "green";
      tgl.classList.toggle("on", on); tgl.setAttribute("aria-checked", on);
    };
    view.querySelector("#pf-logout").onclick = () => AUTH.signOut();
  }

  async function vManageSub() {
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
      </div>
      <div class="card" id="billCard" style="max-width:520px;margin-top:14px"><div class="sec-label">PAYMENT HISTORY</div><p class="page-sub" style="margin:6px 0 0">Loading\u2026</p></div>`;
    const onBtn = view.querySelector("#renew-on"), offBtn = view.querySelector("#renew-off");
    if (offBtn) offBtn.onclick = async () => { if (!confirm("Turn off auto-renewal? You'll keep access until "+renew+".")) return; await DB.setAutoRenew(false); PROFILE.cancel_at_period_end = true; vManageSub(); };
    if (onBtn) onBtn.onclick = async () => { await DB.setAutoRenew(true); PROFILE.cancel_at_period_end = false; vManageSub(); };
    const _n = _nav; try { const pays = await DB.payments(); if (_n === _nav) renderBills(pays); } catch (e) {}
  }
  function payDesc(kind) {
    if (kind === "initial") return "Subscription \u2014 introductory";
    if (kind === "renewal") return "Subscription renewal";
    if (kind && kind.indexOf("upsell:") === 0) {
      const id = kind.slice(7);
      return ({ essential_guides: "Essential Guides bundle", essential_guides_onetime: "Essential Guides bundle", all_guides: "Wellbeing Guides bundle", "guide_joint-mobility": "Joint & Mobility guide", guide_breathing: "Stress-Relief Breathing guide", guide_nutrition: "Weekly Gentle Nutrition guide", guide_desserts: "Sweet & Gentle Desserts guide", guide_sleep: "Better Sleep guide", guide_eating: "Eating Without Guilt guide", guide_aging: "Aging Gracefully guide", vip: "VIP membership" }[id]) || ("Add-on: " + id.replace(/_/g, " "));
    }
    return kind || "Charge";
  }
  function receiptUrl(raw) {
    if (!raw) return null;
    return raw.receipt_url || raw.hosted_invoice_url || raw.invoice_pdf || (raw.charges && raw.charges.data && raw.charges.data[0] && raw.charges.data[0].receipt_url) || null;
  }
  function renderBills(pays) {
    const box = document.getElementById("billCard"); if (!box) return;
    if (!pays.length) { box.innerHTML = '<div class="sec-label">PAYMENT HISTORY</div><p class="page-sub" style="margin:6px 0 0">No charges yet.</p>'; return; }
    const rows = pays.map(p => {
      const d = new Date(p.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      const amt = "$" + Number(p.amount || 0).toFixed(2);
      const paid = p.status === "succeeded";
      const rc = receiptUrl(p.raw);
      return `<div class="bill-row"><div class="bl"><b>${esc(payDesc(p.kind))}</b><small>${d}${rc ? ` \u00B7 <a href="${rc}" target="_blank" rel="noopener">Receipt \u2197</a>` : ""}</small></div>`
        + `<div class="br"><b>${amt}</b><span class="bstat ${paid ? "ok" : ""}">${paid ? "Paid" : esc(p.status || "")}</span></div></div>`;
    }).join("");
    box.innerHTML = '<div class="sec-label">PAYMENT HISTORY</div>' + rows;
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
  const ACADEMY_SECTIONS = ["Foundations & the Daily Habit", "Steady & Strong: Balance", "Move Freely: Joints & Mobility", "Calm Mind, Clear Focus", "Aging Well: Everyday Habits"];
  const ACADEMY_CHIPS = ["Foundations", "Balance", "Mobility", "Calm & Focus", "Aging Well"];
  const ACADEMY_UNLOCK_ALL = false;  // sequential: 1 lesson unlocks per day
  let _acadCat = "all";
  function renderArticle(body) {
    let html = "", inList = false;
    (body || "").split("\n").forEach(raw => {
      const line = raw.trim();
      if (!line) { if (inList) { html += "</ul>"; inList = false; } return; }
      if (line.startsWith("## ")) { if (inList) { html += "</ul>"; inList = false; } html += `<h4 class="art-h">${esc(line.slice(3))}</h4>`; }
      else if (line.startsWith("- ")) { if (!inList) { html += '<ul class="art-ul">'; inList = true; } html += `<li>${esc(line.slice(2))}</li>`; }
      else { if (inList) { html += "</ul>"; inList = false; } html += `<p>${esc(line)}</p>`; }
    });
    if (inList) html += "</ul>";
    return html;
  }
  async function vAcademy() {
    const _n = _nav;
    view.innerHTML = `<h1 class="page">Academy</h1><p class="page-sub">Loading…</p>`;
    const [lessons, prog] = await Promise.all([DB.academyLessons(), DB.lessonProgress()]);
    if (_n !== _nav) return;
    _lessons = lessons;
    const doneCount = lessons.filter(l => prog[l.id]?.done).length;
    const pct = lessons.length ? Math.round(doneCount / lessons.length * 100) : 0;
    const groups = {};
    lessons.forEach((l, i) => { l._unlocked = ACADEMY_UNLOCK_ALL || i === 0 || !!prog[lessons[i - 1].id]?.done; (groups[l.week_number] = groups[l.week_number] || []).push(l); });
    const chips = `<div class="filters">${["all", "1", "2", "3", "4", "5"].map(c => `<button data-c="${c}" class="${_acadCat === c ? "on" : ""}">${c === "all" ? "All" : ACADEMY_CHIPS[c - 1]}</button>`).join("")}</div>`;
    const wks = _acadCat === "all" ? Object.keys(groups).sort((a, b) => a - b) : [_acadCat];
    const sectionsHtml = wks.map(wk => {
      const items = groups[wk] || []; const secDone = items.filter(l => prog[l.id]?.done).length;
      const rows = items.map(l => {
        const done = !!prog[l.id]?.done, locked = !l._unlocked && !done;
        return `<div class="lrow lesson ${locked ? "locked" : ""}" data-id="${l.id}">
          <span class="lnum ${done ? "done" : ""}">${done ? "✓" : l.day_number}</span>
          <span class="ltext"><span class="lt">${esc(l.title)}</span><span class="ls">Day ${l.day_number} · ${l.duration_min} min</span></span>
          <span class="chev">${locked ? "🔒" : "›"}</span></div>`;
      }).join("");
      return `<div class="section-title" style="margin:22px 0 10px"><h2>${esc(ACADEMY_SECTIONS[wk-1] || ("Section " + wk))}</h2><span style="color:var(--muted);font-weight:700">${secDone}/${items.length}</span></div>
        <div class="card listcard">${rows}</div>`;
    }).join("");
    view.innerHTML = `<h1 class="page">Academy</h1><p class="page-sub">A 50-day journey — one gentle lesson a day, across five themes.</p>
      <div class="card"><div class="section-title" style="margin:0 0 8px"><h2>Your progress</h2><span style="color:var(--muted);font-weight:700">${doneCount} of ${lessons.length}</span></div>
        <div class="pbar" style="margin-bottom:0"><i style="width:${pct}%"></i></div></div>
      <div style="margin-top:16px">${chips}</div>
      ${sectionsHtml}`;
    view.querySelectorAll(".filters button").forEach(b => b.onclick = () => { _acadCat = b.dataset.c; vAcademy(); });
    view.querySelectorAll(".lesson:not(.locked)").forEach(el => el.onclick = () => location.hash = "#/lesson/" + el.dataset.id);
  }
  async function vLesson(id) {
    const _n = _nav;
    const list = _lessons || await DB.academyLessons();
    const l = list.find(x => x.id === id); if (!l) return notFound();
    const prog = await DB.lessonProgress(); const taskDone = !!prog[id]?.task;
    if (_n !== _nav) return;
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/academy'">‹ Academy</button>
      <div class="lesson-eyebrow">Day ${l.day_number} · ${esc(ACADEMY_SECTIONS[l.week_number-1] || "")}</div>
      <h1 class="page" style="font-size:26px;margin-top:2px">${esc(l.title)}</h1>
      ${l.excerpt ? `<p class="lesson-lead">${esc(l.excerpt)}</p>` : ""}
      <div class="article">${renderArticle(l.body)}</div>
      <div class="card" style="margin-top:18px"><div class="section-title" style="margin:0 0 8px"><h2>Your task</h2></div>
        <div class="task ${taskDone ? "done" : ""}" id="task"><span class="box">${taskDone ? "✓" : ""}</span><span class="lab">${esc(l.task || "Reflect on today's lesson.")}</span></div>
        <button class="btn block" id="finish" style="margin-top:14px">${prog[id]?.done ? "✓ Completed" : "Mark lesson complete"}</button></div>`;
    let done = taskDone;
    view.querySelector("#task").onclick = () => { done = !done; const t = view.querySelector("#task"); t.classList.toggle("done", done); t.querySelector(".box").textContent = done ? "✓" : ""; };
    view.querySelector("#finish").onclick = async () => { await DB.completeLesson(id, done); view.querySelector("#finish").textContent = "✓ Completed"; };
  }

  // ---------- Challenges ----------
  async function vChallenges(tab) {
    const _n = _nav;
    tab = tab || "all";
    view.innerHTML = `<h1 class="page">Challenges</h1><p class="page-sub">Loading…</p>`;
    const [list, mine] = await Promise.all([DB.challengesList(), DB.myChallenges()]);
    if (_n !== _nav) return;
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
    const _n = _nav;
    const [list, mine] = await Promise.all([DB.challengesList(), DB.myChallenges()]);
    if (_n !== _nav) return;
    const c = list.find(x => x.id === id); if (!c) return notFound();
    const m = mine[id]; const dd = (m && m.days_done) || [];
    const grid = Array.from({ length: c.days }, (_, i) => i + 1).map(d => {
      const done = dd.includes(d);
      return `<button class="daycell ${done ? "done" : ""} ${m ? "" : "preview"}" data-day="${d}">${done ? "✓" : d}</button>`;
    }).join("");
    view.innerHTML = `<button class="backlink" onclick="location.hash='#/challenges'">‹ Challenges</button>
      <div class="info-photo" style="max-width:none;margin:6px 0 14px"><img src="${img(c.cover_seed,1000,440)}" alt=""></div>
      <h1 class="page">${esc(c.title)}</h1><p class="page-sub">${esc(c.subtitle || "")} · ${c.days} days</p>
      <div class="card"><div class="section-title" style="margin:0 0 8px"><h2>About</h2></div><p style="color:var(--ink-soft);margin:0">${esc(c.about || "")}</p></div>
      <div class="section-title"><h2>Day-by-day plan</h2><span id="dayCount" style="color:var(--muted);font-weight:700">${m ? dd.length + "/" + c.days : c.days + " days"}</span></div>
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
        const dc = view.querySelector("#dayCount"); if (dc) dc.textContent = nd.length + "/" + c.days;
      });
    }
  }

  function vSoon(title, icon, msg) { view.innerHTML = `<h1 class="page">${title}</h1><div class="soon"><div class="big">${icon}</div><p>${msg}</p></div>`; }
  function notFound() { view.innerHTML = `<div class="soon"><div class="big">🤷</div><p>Page not found.</p></div>`; }

  function route() {
    if (!DATA) return;
    _nav++;
    if (_interimTimer) { clearInterval(_interimTimer); _interimTimer = null; }
    const _iv = document.getElementById("interim"); if (_iv) _iv.remove();
    _sessionRunning = false;
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
  let _booted = false, _uid = null;
  async function boot() {
    const session = await AUTH.session();
    if (!session) { _booted = false; _uid = null; return renderAuth(); }
    _uid = session.user.id; _booted = true;
    PROFILE = await DB.profile();
    if (!DB.hasAccess(PROFILE)) return renderGate();
    [DATA, ST] = await Promise.all([DB.loadContent(), DB.loadUserState()]);
    if (!location.hash) location.hash = "#/home";
    route();
  }
  window.addEventListener("hashchange", route);
  // Only (re)boot on a genuinely new sign-in or a sign-out. Supabase re-fires SIGNED_IN when the tab
  // regains focus (session re-validation / token refresh); re-booting then would needlessly reload the
  // view and lose the member's place — so we ignore repeat SIGNED_IN for the same user, and TOKEN_REFRESHED.
  SB.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") { _booted = false; _uid = null; boot(); return; }
    if (event === "SIGNED_IN") {
      const uid = session && session.user ? session.user.id : null;
      if (!_booted || uid !== _uid) boot();
    }
  });
  boot();
})();
