/* Mock content for the Tai Chi members' app (v1).
 * Replace with Supabase queries later (tables: programs, sessions, exercises, media_sessions...).
 * Media uses free Lorem Picsum placeholders (deterministic by seed) until real video/images are added.
 */
const IMG = (seed, w = 600, h = 400) => `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;

window.CONTENT = {
  img: IMG,

  // Exercise library, grouped by category. `locked` items show an unlock rule.
  categories: ["Tai Chi", "Tai Chi Chair", "Yoga", "Mobility", "Bands", "Breathing"],

  workouts: [
    // Tai Chi (standing, gentle)
    { id: "tc1", cat: "Tai Chi", title: "Soothing Step Rhythm", level: "Beginner", min: 5, focus: "Mobility & lower body", seed: "taichi-step" },
    { id: "tc2", cat: "Tai Chi", title: "Graceful Leg Balance", level: "Beginner", min: 6, focus: "Lower body & balance", seed: "taichi-balance" },
    { id: "tc3", cat: "Tai Chi", title: "Upper Rhythm Flow", level: "Intermediate", min: 7, focus: "Mobility & upper body", seed: "taichi-flow" },
    { id: "tc4", cat: "Tai Chi", title: "Sunrise Leg Ease", level: "Advanced", min: 8, focus: "Strength & balance", seed: "taichi-sunrise", locked: "Complete 4 workouts to unlock" },

    // Tai Chi Chair (seated — primary for our audience)
    { id: "cc1", cat: "Tai Chi Chair", title: "Calm Chair Flex", level: "Beginner", min: 5, focus: "Stretching & chair-supported", seed: "chair-flex" },
    { id: "cc2", cat: "Tai Chi Chair", title: "Seated Strength Lift", level: "Beginner", min: 6, focus: "Upper body & strength", seed: "chair-strength" },
    { id: "cc3", cat: "Tai Chi Chair", title: "Gentle Dawn Movement", level: "Beginner", min: 10, focus: "Mobility & chair-supported", seed: "chair-dawn" },
    { id: "cc4", cat: "Tai Chi Chair", title: "Gentle Core Rise", level: "Beginner", min: 7, focus: "Core & obliques", seed: "chair-core" },

    { id: "yg1", cat: "Yoga", title: "Chair Yoga Unwind", level: "Beginner", min: 6, focus: "Flexibility", seed: "yoga-unwind" },
    { id: "yg2", cat: "Yoga", title: "Morning Gentle Stretch", level: "Beginner", min: 7, focus: "Mobility", seed: "yoga-morning" },

    { id: "mo1", cat: "Mobility", title: "Easy Joint Mobility", level: "Beginner", min: 5, focus: "Joints", seed: "mobility-joints" },
    { id: "mo2", cat: "Mobility", title: "Stand Steady Drills", level: "Intermediate", min: 6, focus: "Balance", seed: "mobility-steady" },

    { id: "bd1", cat: "Bands", title: "Light Band Toning", level: "Beginner", min: 6, focus: "Strength", seed: "bands-tone" },

    { id: "br1", cat: "Breathing", title: "Calm Breath Basics", level: "Beginner", min: 4, focus: "Relaxation", seed: "breath-calm" },
  ],

  // Today's ordered plan (sequence of single movements)
  planToday: [
    { id: "p1", title: "Seated warm-up breathing", level: "Beginner", min: 2, seed: "plan-warmup" },
    { id: "p2", title: "Chair torso twists", level: "Beginner", min: 3, seed: "plan-twist" },
    { id: "p3", title: "Seated weight shifts", level: "Beginner", min: 3, seed: "plan-shift" },
    { id: "p4", title: "Parting the wild horse's mane (seated)", level: "Beginner", min: 4, seed: "plan-horse" },
    { id: "p5", title: "Gentle arm raises", level: "Beginner", min: 3, seed: "plan-arms" },
    { id: "p6", title: "Cool-down breathing", level: "Beginner", min: 2, seed: "plan-cooldown" },
  ],

  // Stress release media library
  stress: {
    Meditations: [
      { id: "m1", title: "Soothing Calm", min: 5, seed: "med-calm" },
      { id: "m2", title: "Balancing the Body & Mind", min: 6, seed: "med-balance" },
      { id: "m3", title: "Tuning Into Your Body", min: 5, seed: "med-tune" },
      { id: "m4", title: "Calm Waters Visualization", min: 4, seed: "med-waters" },
      { id: "m5", title: "Golden Hour Relaxation", min: 4, seed: "med-golden" },
      { id: "m6", title: "Nature's Embrace", min: 5, seed: "med-nature" },
    ],
    Breathing: [
      { id: "b1", title: "4-7-8 Calming Breath", min: 4, seed: "br-478" },
      { id: "b2", title: "Box Breathing", min: 5, seed: "br-box" },
      { id: "b3", title: "Seated Deep Breathing", min: 6, seed: "br-deep" },
    ],
    Yoga: [
      { id: "y1", title: "Gentle Seated Yoga", min: 7, seed: "yg-seated" },
      { id: "y2", title: "Evening Wind-down", min: 8, seed: "yg-evening" },
    ],
  },

  // Home: today's tasks
  tasks: [
    { id: "t1", label: "Complete today's session" },
    { id: "t2", label: "Log your water intake" },
    { id: "t3", label: "Do a calming breath session" },
    { id: "t4", label: "Add a quick mood check-in" },
  ],

  // Tracking metrics
  trackers: [
    { id: "weight", label: "Weight", unit: "kg", icon: "⚖️", numeric: true },
    { id: "water",  label: "Water intake", unit: "glasses", icon: "💧", numeric: true },
    { id: "steps",  label: "Steps", unit: "steps", icon: "👣", numeric: true },
    { id: "balance",label: "Balance check-in", unit: "/10", icon: "🤸", numeric: true, desc: "How steady you feel on your feet today, from 1 (very wobbly) to 10 (rock steady). Try it after a balance exercise like standing on one leg — a simple way to watch your stability improve over time." },
    { id: "mood",   label: "Mood & stress", unit: "", icon: "🧘", numeric: false, special: "self" },
    { id: "fasting",label: "Fasting", unit: "", icon: "⏱️", special: "fasting" },
  ],
};
