/* Data layer — Supabase reads/writes (RLS-scoped). Falls back to CONTENT mock if a read fails,
 * so the UI still renders during setup. Plan/tasks are per-day UI state kept in localStorage.
 */
window.DB = (function () {
  const C = window.CONTENT;
  const dayKey = (k) => "tc_" + k + "_" + new Date().toISOString().slice(0, 10);

  async function profile() {
    const { data } = await SB.from("users").select("*").maybeSingle();
    if (data) {
      // Fall back to the member's quiz answers for anything not set on their profile yet.
      try {
        const { data: q } = await SB.from("quiz_sessions")
          .select("name,weight_kg,height_cm,goal_weight_kg,gender,age_band")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (q) {
          if (data.height_cm == null) data.height_cm = q.height_cm;
          if (data.target_weight_kg == null) data.target_weight_kg = q.goal_weight_kg;
          if (!data.name) data.name = q.name;
          if (!data.gender) data.gender = q.gender;
          if (!data.age_band) data.age_band = q.age_band;
          data.quiz_weight_kg = q.weight_kg;   // used as current-weight fallback until they log one
        }
      } catch (e) { /* quiz optional */ }
    }
    return data;
  }
  function hasAccess(u) {
    if (!u) return false;
    if (u.subscription_status !== "active" && u.subscription_status !== "trialing") return false;
    if (u.current_period_end && new Date(u.current_period_end) < new Date()) return false;
    return true;
  }

  async function loadContent() {
    try {
      const [{ data: sess }, { data: media }] = await Promise.all([
        SB.from("sessions").select("*").eq("is_published", true).order("sort"),
        SB.from("media_sessions").select("*").eq("is_published", true).order("sort"),
      ]);
      const workouts = (sess || []).map(s => ({
        id: s.id, cat: s.category, title: s.title, level: s.level,
        min: s.duration_min, focus: s.focus, seed: s.thumb_seed, locked: s.unlock_rule,
        steps: s.steps || [],
      }));
      // Overlay refreshed Tai Chi Walking step content (static file so new moves +
      // per-move flow ship together as one batch, not via the shared DB).
      try {
        const wr = await fetch("assets/walking/steps.json?v=1", { cache: "no-cache" });
        if (wr.ok) { const wov = await wr.json(); workouts.forEach(w => { if (wov[w.id]) w.steps = wov[w.id]; }); }
      } catch (e) { /* keep DB steps */ }
      const categories = [...new Set(workouts.map(w => w.cat))];
      const stress = {};
      (media || []).forEach(m => { (stress[m.kind] = stress[m.kind] || []).push({ id: m.id, title: m.title, min: m.duration_min, seed: m.thumb_seed }); });
      // derive a simple daily plan from the first chair/standing sessions
      const plan = workouts.slice(0, 6).map(w => ({ id: "plan_" + w.id, title: w.title, level: w.level, min: w.min, seed: w.seed }));
      if (!workouts.length) throw new Error("empty");
      return { workouts, categories, stress, plan };
    } catch (e) {
      return { workouts: C.workouts, categories: C.categories, stress: C.stress,
        plan: C.planToday.map(p => ({ ...p })) };
    }
  }

  async function loadUserState() {
    const state = { completed: {}, favorites: {}, latest: {}, history: {}, owned: {}, stepDone: {} };
    try {
      const [{ data: prog }, { data: favs }, { data: checks }, { data: pays }, { data: stepRows }] = await Promise.all([
        SB.from("user_session_progress").select("session_id"),
        SB.from("favorites").select("item_type,item_id"),
        SB.from("progress_checkins").select("metric,value,text_value,recorded_at").order("recorded_at", { ascending: false }),
        SB.from("payments").select("kind"),
        SB.from("user_session_step_progress").select("session_id,step_index"),
      ]);
      (prog || []).forEach(p => state.completed[p.session_id] = true);
      (stepRows || []).forEach(r => { (state.stepDone[r.session_id] = state.stepDone[r.session_id] || {})[r.step_index] = true; });
      (pays || []).forEach(p => { if (p.kind && p.kind.indexOf("upsell:") === 0) state.owned[p.kind.slice(7)] = true; });
      (favs || []).forEach(f => state.favorites[f.item_id] = true);
      (checks || []).forEach(c => {
        (state.history[c.metric] = state.history[c.metric] || []).push({ value: c.text_value ?? c.value, at: c.recorded_at });
        if (state.latest[c.metric] === undefined) state.latest[c.metric] = c.text_value ?? c.value;
      });
    } catch (e) { /* leave empty */ }
    return state;
  }

  async function payments() {
    const { data } = await SB.from("payments").select("id,kind,amount,currency,status,created_at,raw").order("created_at", { ascending: false });
    return data || [];
  }
  return {
    profile, hasAccess, loadContent, loadUserState, payments,
    // mutations
    async toggleSession(id, on) {
      if (on) { const u = (await SB.auth.getUser()).data.user; await SB.from("user_session_progress").insert({ user_id: u.id, session_id: id, status: "completed" }); }
      else await SB.from("user_session_progress").delete().eq("session_id", id);
    },
    async markStep(sessionId, idx, on) {
      const u = (await SB.auth.getUser()).data.user;
      if (on) await SB.from("user_session_step_progress").upsert({ user_id: u.id, session_id: sessionId, step_index: idx }, { onConflict: "user_id,session_id,step_index" });
      else await SB.from("user_session_step_progress").delete().eq("session_id", sessionId).eq("step_index", idx);
    },
    async clearSteps(sessionId) { await SB.from("user_session_step_progress").delete().eq("session_id", sessionId); },
    async toggleFav(id, on, type = "session") {
      if (on) { const u = (await SB.auth.getUser()).data.user; await SB.from("favorites").insert({ user_id: u.id, item_type: type, item_id: id }); }
      else await SB.from("favorites").delete().eq("item_id", id);
    },
    async addCheckin(metric, value, unit) {
      const u = (await SB.auth.getUser()).data.user;
      const numeric = typeof value === "number" || (!isNaN(parseFloat(value)) && metric !== "mood");
      await SB.from("progress_checkins").insert({
        user_id: u.id, metric, unit: unit || null,
        value: numeric ? parseFloat(value) : null, text_value: numeric ? null : String(value),
      });
    },
    // ----- Fasting -----
    async activeFast() { const { data } = await SB.from("fasting_logs").select("*").eq("status", "active").order("started_at", { ascending: false }).limit(1); return (data && data[0]) || null; },
    async startFast(goalHours) { const u = (await SB.auth.getUser()).data.user; const { data } = await SB.from("fasting_logs").insert({ user_id: u.id, started_at: new Date().toISOString(), goal_hours: goalHours, status: "active" }).select().single(); return data; },
    async stopFast(id) { await SB.from("fasting_logs").update({ ended_at: new Date().toISOString(), status: "completed" }).eq("id", id); },
    async logFast(startedAtISO, hours) { const u = (await SB.auth.getUser()).data.user; const end = new Date(new Date(startedAtISO).getTime() + hours * 3600 * 1000).toISOString(); await SB.from("fasting_logs").insert({ user_id: u.id, started_at: startedAtISO, ended_at: end, goal_hours: hours, status: "completed" }); },
    async fastingHistory() { const { data } = await SB.from("fasting_logs").select("*").eq("status", "completed").order("started_at", { ascending: false }).limit(50); return data || []; },
    async deleteFast(id) { await SB.from("fasting_logs").delete().eq("id", id); },
    // ----- Meals -----
    async recipes() { const { data } = await SB.from("recipes").select("*").eq("is_published", true).order("sort"); return data || []; },
    // ----- Academy -----
    async academyLessons() { const { data } = await SB.from("lessons").select("*").eq("is_published", true).order("sort"); return data || []; },
    async lessonProgress() { const { data } = await SB.from("user_lesson_progress").select("lesson_id,task_done"); const m = {}; (data || []).forEach(r => m[r.lesson_id] = { done: true, task: r.task_done }); return m; },
    async completeLesson(id, taskDone) { const u = (await SB.auth.getUser()).data.user; await SB.from("user_lesson_progress").upsert({ user_id: u.id, lesson_id: id, task_done: !!taskDone, completed_at: new Date().toISOString() }, { onConflict: "user_id,lesson_id" }); },
    // ----- Challenges -----
    async challengesList() { const { data } = await SB.from("challenges").select("*").eq("is_published", true).order("sort"); return data || []; },
    async myChallenges() { const { data } = await SB.from("user_challenges").select("*"); const m = {}; (data || []).forEach(r => m[r.challenge_id] = r); return m; },
    async startChallenge(cid) { const u = (await SB.auth.getUser()).data.user; await SB.from("user_challenges").upsert({ user_id: u.id, challenge_id: cid, status: "active", start_date: new Date().toISOString().slice(0, 10) }, { onConflict: "user_id,challenge_id" }); },
    async toggleChallengeDay(cid, day) { const { data } = await SB.from("user_challenges").select("id,days_done").eq("challenge_id", cid).maybeSingle(); if (!data) return []; let dd = data.days_done || []; dd = dd.includes(day) ? dd.filter(d => d !== day) : [...dd, day]; await SB.from("user_challenges").update({ days_done: dd }).eq("id", data.id); return dd; },

    async updateProfile(fields) {
      const u = (await SB.auth.getUser()).data.user;
      await SB.from("users").update(fields).eq("id", u.id);
    },
    // ----- Meal plan -----
    async getPlanItems(startISO, endISO) {
      const { data } = await SB.from("meal_plan_items").select("*")
        .gte("plan_date", startISO).lte("plan_date", endISO);
      return data || [];
    },
    async getPlanRun(weekStartISO) {
      const { data } = await SB.from("meal_plan_runs").select("*").eq("week_start", weekStartISO).maybeSingle();
      return data;
    },
    async savePlanRun(run) {
      const u = (await SB.auth.getUser()).data.user;
      await SB.from("meal_plan_runs").upsert({ ...run, user_id: u.id }, { onConflict: "user_id,week_start" });
    },
    async savePlanItems(items) {
      const u = (await SB.auth.getUser()).data.user;
      const rows = items.map(it => ({ ...it, user_id: u.id }));
      await SB.from("meal_plan_items").upsert(rows, { onConflict: "user_id,plan_date,meal_type" });
    },
    async deletePlanWeek(startISO, endISO) {
      await SB.from("meal_plan_items").delete().gte("plan_date", startISO).lte("plan_date", endISO);
    },
    async setPlanStatus(dateISO, mealType, status) {
      await SB.from("meal_plan_items").update({ status }).eq("plan_date", dateISO).eq("meal_type", mealType);
    },
    async changePlanRecipe(dateISO, mealType, recipeId) {
      await SB.from("meal_plan_items").update({ recipe_id: recipeId, status: "pending" }).eq("plan_date", dateISO).eq("meal_type", mealType);
    },
    async setAutoRenew(on) {
      // Billing columns are service-role-only (Plan 1 guard + subscriptions RLS); route through
      // the set-auto-renew edge fn, which updates Stripe -> webhook syncs users/subscriptions.
      const { data: { session } } = await SB.auth.getSession();
      const r = await fetch(SUPA.url + "/functions/v1/set-auto-renew", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token, "apikey": SUPA.key },
        body: JSON.stringify({ on }),
      });
      return r.ok;
    },
    // per-day UI state (tasks + plan checklist)
    dayGet(k) { try { return JSON.parse(localStorage.getItem(dayKey(k))) || {}; } catch { return {}; } },
    dayToggle(k, id) { const o = this.dayGet(k); o[id] ? delete o[id] : (o[id] = true); localStorage.setItem(dayKey(k), JSON.stringify(o)); return o; },
    daySet(k, obj) { localStorage.setItem(dayKey(k), JSON.stringify(obj)); return obj; },
  };
})();
