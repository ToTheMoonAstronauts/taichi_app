/* Data layer — Supabase reads/writes (RLS-scoped). Falls back to CONTENT mock if a read fails,
 * so the UI still renders during setup. Plan/tasks are per-day UI state kept in localStorage.
 */
window.DB = (function () {
  const C = window.CONTENT;
  const dayKey = (k) => "tc_" + k + "_" + new Date().toISOString().slice(0, 10);

  async function profile() {
    const { data } = await SB.from("users").select("*").maybeSingle();
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
    const state = { completed: {}, favorites: {}, latest: {}, history: {} };
    try {
      const [{ data: prog }, { data: favs }, { data: checks }] = await Promise.all([
        SB.from("user_session_progress").select("session_id"),
        SB.from("favorites").select("item_type,item_id"),
        SB.from("progress_checkins").select("metric,value,text_value,recorded_at").order("recorded_at", { ascending: false }),
      ]);
      (prog || []).forEach(p => state.completed[p.session_id] = true);
      (favs || []).forEach(f => state.favorites[f.item_id] = true);
      (checks || []).forEach(c => {
        (state.history[c.metric] = state.history[c.metric] || []).push({ value: c.text_value ?? c.value, at: c.recorded_at });
        if (state.latest[c.metric] === undefined) state.latest[c.metric] = c.text_value ?? c.value;
      });
    } catch (e) { /* leave empty */ }
    return state;
  }

  return {
    profile, hasAccess, loadContent, loadUserState,
    // mutations
    async toggleSession(id, on) {
      if (on) { const u = (await SB.auth.getUser()).data.user; await SB.from("user_session_progress").insert({ user_id: u.id, session_id: id, status: "completed" }); }
      else await SB.from("user_session_progress").delete().eq("session_id", id);
    },
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
    async setAutoRenew(on) {
      const u = (await SB.auth.getUser()).data.user;
      await SB.from("users").update({ cancel_at_period_end: !on }).eq("id", u.id);
      await SB.from("subscriptions").update({ cancel_at_period_end: !on }).eq("user_id", u.id);
    },
    // per-day UI state (tasks + plan checklist)
    dayGet(k) { try { return JSON.parse(localStorage.getItem(dayKey(k))) || {}; } catch { return {}; } },
    dayToggle(k, id) { const o = this.dayGet(k); o[id] ? delete o[id] : (o[id] = true); localStorage.setItem(dayKey(k), JSON.stringify(o)); return o; },
    daySet(k, obj) { localStorage.setItem(dayKey(k), JSON.stringify(obj)); return obj; },
  };
})();
