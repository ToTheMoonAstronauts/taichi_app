/* Meal-plan engine — calorie targets + weekly generation.
 * Targets: Mifflin-St Jeor BMR x light activity, minus a MODERATE deficit (~500 kcal/day,
 * ~0.5 kg/week), clamped to safe floors and to <=25% below maintenance. Not medical advice.
 */
window.PLAN = (function () {
  const ACTIVITY = 1.35;               // lightly active (chair-based seniors)
  const DEFICIT = 500;                 // moderate ~0.5 kg/week
  const FLOOR = { male: 1400, female: 1200, unknown: 1300 };
  const SPLIT = { breakfast: 0.25, lunch: 0.35, dinner: 0.30, snack: 0.10 };
  const DEFAULT_HEIGHT = { male: 175, female: 162, unknown: 168 };

  function ageFromBand(band) {
    if (!band) return 55;
    const n = String(band).match(/\d+/g);
    if (!n) return 55;
    if (n.length >= 2) return Math.round((+n[0] + +n[1]) / 2);
    return +n[0] + 4;
  }
  const round10 = (x) => Math.round(x / 10) * 10;

  // profile: {gender, age_band, height_cm, target_weight_kg}; currentWeight in kg
  function targets(profile, currentWeight) {
    const p = profile || {};
    const missing = [];
    let g = (p.gender || "").toLowerCase();
    if (g !== "male" && g !== "female") { g = "unknown"; missing.push("gender"); }
    const age = ageFromBand(p.age_band);
    if (!p.age_band) missing.push("age");
    let h = parseFloat(p.height_cm);
    if (!(h > 0)) { h = DEFAULT_HEIGHT[g]; missing.push("height"); }
    let w = parseFloat(currentWeight);
    const goal = parseFloat(p.target_weight_kg);
    if (!(w > 0)) { missing.push("weight"); }

    // If we don't know current weight we can't personalize — return a gentle default.
    if (!(w > 0)) {
      const daily = 1500;
      return { daily, split: perMeal(daily), basis: "default", missing, maintenance: 1900, deficit: 0, age, gender: g, height: h };
    }
    const s = g === "male" ? 5 : g === "female" ? -161 : -78;
    const bmr = 10 * w + 6.25 * h - 5 * age + s;
    const tdee = bmr * ACTIVITY;
    let daily;
    let atGoal = goal > 0 && w <= goal + 0.5;   // already at/below goal -> maintain
    if (atGoal) {
      daily = tdee;
    } else {
      daily = tdee - DEFICIT;
      daily = Math.max(daily, tdee * 0.75, FLOOR[g]);   // cap deficit, respect floor
    }
    daily = round10(daily);
    return {
      daily, split: perMeal(daily), basis: "personalized", missing,
      maintenance: round10(tdee), deficit: atGoal ? 0 : Math.round(tdee - daily),
      age, gender: g, height: h, atGoal,
    };
  }
  function perMeal(daily) {
    const b = round10(daily * SPLIT.breakfast);
    const l = round10(daily * SPLIT.lunch);
    const d = round10(daily * SPLIT.dinner);
    return { breakfast: b, lunch: l, dinner: d, snack: daily - b - l - d }; // remainder -> exact sum
  }

  // deterministic RNG so a given user+week always yields the same plan
  function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // Local calendar date (YYYY-MM-DD) — NOT UTC, so week/day math matches the user's timezone.
  function isoDate(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${da}`;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

  // recipes: full list; split: per-meal kcal targets; weekStart: Date (Mon..). seed: user id.
  function generateWeek(recipes, split, weekStart, seed) {
    const byType = { breakfast: [], lunch: [], dinner: [], snack: [] };
    recipes.forEach(r => { if (byType[r.meal_type]) byType[r.meal_type].push(r); });
    const rnd = mulberry32(hash(seed + "|" + isoDate(weekStart)));
    const recent = { breakfast: [], lunch: [], dinner: [], snack: [] };
    const items = [];
    for (let day = 0; day < 7; day++) {
      const date = isoDate(addDays(weekStart, day));
      for (const slot of ["breakfast", "lunch", "dinner", "snack"]) {
        const pool = byType[slot];
        if (!pool || !pool.length) continue;
        const tgt = split[slot] || 0;
        // rank by closeness to target, drop recently used, keep a small pool for variety
        let ranked = pool.slice().sort((a, b) => Math.abs((a.kcal || 0) - tgt) - Math.abs((b.kcal || 0) - tgt));
        let avail = ranked.filter(r => !recent[slot].includes(r.id));
        if (avail.length < 6) avail = ranked;           // ran out — allow reuse
        const topN = avail.slice(0, Math.min(12, avail.length));
        const pick = topN[Math.floor(rnd() * topN.length)];
        recent[slot].push(pick.id); if (recent[slot].length > 4) recent[slot].shift();
        items.push({ plan_date: date, meal_type: slot, recipe_id: pick.id, kcal_target: tgt });
      }
    }
    return items;
  }

  // Monday of the week containing `d`
  function weekStartOf(d) {
    const x = new Date(d); const day = (x.getDay() + 6) % 7; // Mon=0
    x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x;
  }

  return { targets, generateWeek, weekStartOf, isoDate, addDays, ageFromBand };
})();
