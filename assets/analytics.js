/* Tai Motion APP — first-party engagement analytics (events + session replay).
 * Writes to the isolated log-event function (funnel_events table) + PostHog.
 * Additive & guarded — never touches app data/auth logic.
 * API: window.TM.track(event, props), window.TM.identify(userId), window.TM.sid()
 */
(function () {
  var URL = "https://pixtozeghxwiidpnloih.supabase.co";
  var POSTHOG_KEY = "phc_zP7yVawcZX3iQ3qRfhbvxHxz87wnDnizc66yax7bT83i"; // Monokodas org, US cloud ("Tai Motion" project 525048)
  var POSTHOG_HOST = "https://t.taimotion.com"; // managed reverse proxy → US cloud
  var POSTHOG_UI = "https://us.posthog.com";

  function sid() {
    try {
      var s = localStorage.getItem("tm_sid");
      if (!s) { s = Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem("tm_sid", s); }
      return s;
    } catch (e) { return "nosid"; }
  }
  function send(row) {
    try {
      var body = JSON.stringify({ events: [row] });
      var url = URL + "/functions/v1/log-event";
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
      fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: body, keepalive: true, mode: "cors" });
    } catch (e) {}
  }
  function track(event, props) {
    var row = {
      session_id: sid(), user_id: window.__tm_uid || null, event: String(event),
      props: props || {}, path: (location.pathname + location.hash).slice(0, 300),
      page: "app", fbclid: null, utm: null,
    };
    send(row);
    try { window.dataLayer = window.dataLayer || []; window.dataLayer.push({ event: "tm_" + event, tm_props: row.props }); } catch (e) {}
    try { if (window.posthog && window.posthog.capture) window.posthog.capture(event, props || {}); } catch (e) {}
  }
  function identify(userId, email) {
    if (!userId) return; window.__tm_uid = userId; // log-event rows keep the supabase uid
    // PostHog distinct id is the lowercased email — the funnel identifies the same way at
    // quiz email capture, so pre-purchase and in-app activity merge into one person.
    try { if (window.posthog && window.posthog.identify) window.posthog.identify(String(email || userId).toLowerCase(), { email: email || null, supabase_uid: userId }); } catch (e) {}
  }

  if (POSTHOG_KEY) {
    !function (t, e) { var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) { function g(t, e) { var o = e.split("."); 2 == o.length && (t = t[o[0]], e = o[1]), t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } } (p = t.createElement("script")).type = "text/javascript", p.async = !0, p.src = s.api_host + "/static/array.js", (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r); var u = e; for (void 0 !== a ? u = e[a] = [] : a = "posthog", u.people = u.people || [], u.toString = function (t) { var e = "posthog"; return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e }, u.people.toString = function () { return u.toString(1) + ".people (stub)" }, o = "capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep".split(" "), n = 0; n < o.length; n++) g(u, o[n]); e._i.push([i, s, a]) }, e.__SV = 1) }(document, window.posthog || []);
    try { window.posthog.init(POSTHOG_KEY, { api_host: POSTHOG_HOST, ui_host: POSTHOG_UI, defaults: "2026-05-30", person_profiles: "identified_only", capture_pageview: false }); } catch (e) {}
  }

  // Merge into any existing TM (e.g. the theme manager from config.js) rather than
  // overwriting it — otherwise TM.get/TM.set (theme) would be wiped and Profile breaks.
  window.TM = Object.assign(window.TM || {}, { track: track, identify: identify, sid: sid });
})();
