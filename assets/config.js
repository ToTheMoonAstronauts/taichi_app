/* Theme: default = brown. ?t=g -> green, ?t=b -> brown.
 * Persists via a cookie on .taimotion.com (shared with the funnel domain) + localStorage,
 * so a green/brown journey started on taimotion.com carries into the app. */
(function () {
  try {
    const readCookie = () => { const m = document.cookie.match(/(?:^|;\s*)tm_theme=(green|brown)/); return m ? m[1] : null; };
    const writeCookie = (v) => {
      const base = "; path=/; max-age=31536000; samesite=lax";
      document.cookie = "tm_theme=" + v + base;
      if (/taimotion\.com$/.test(location.hostname)) document.cookie = "tm_theme=" + v + "; domain=.taimotion.com" + base;
    };
    const p = new URLSearchParams(location.search).get("t");
    let theme;
    if (p === "g" || p === "b") {
      theme = p === "g" ? "green" : "brown";
      writeCookie(theme);
      try { localStorage.setItem("tm_theme", theme); } catch (e) {}
    } else {
      theme = readCookie() || (() => { try { return localStorage.getItem("tm_theme"); } catch (e) { return null; } })() || "green";
    }
    document.documentElement.setAttribute("data-theme", theme);
    const applyLogo = (t) => document.querySelectorAll("img.logo").forEach(i => i.setAttribute("src", t === "green" ? "assets/logo.webp" : "assets/logo2.webp"));
    const apply = (t) => applyLogo(t);
    if (document.readyState !== "loading") apply(theme);
    else document.addEventListener("DOMContentLoaded", () => apply(document.documentElement.getAttribute("data-theme")));
    // Expose a setter so in-app UI (Profile toggle) can flip the palette live.
    window.TM = {
      get: () => document.documentElement.getAttribute("data-theme") || "green",
      set: (t) => {
        t = t === "green" ? "green" : "brown";
        writeCookie(t);
        try { localStorage.setItem("tm_theme", t); } catch (e) {}
        document.documentElement.setAttribute("data-theme", t);
        applyLogo(t);
        return t;
      }
    };
  } catch (e) {}
})();

/* Supabase client + auth helpers for the app. Loaded after the supabase-js UMD bundle. */
window.SUPA = {
  url: "https://pixtozeghxwiidpnloih.supabase.co",
  // publishable/anon key — safe for the browser; RLS protects data.
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpeHRvemVnaHh3aWlkcG5sb2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzgzNzgsImV4cCI6MjA5ODMxNDM3OH0.hJzlERAwXkbK8wV7R-NTcfa1YQ-TTk8R9nCM0Qdtblg",
};
window.SB = window.supabase.createClient(window.SUPA.url, window.SUPA.key, {
  // implicit flow: tokens arrive in the URL hash. Required for server-generated magic links
  // (admin.generateLink) which have no client-side PKCE verifier in localStorage.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
});
window.AUTH = {
  async session() { const { data } = await SB.auth.getSession(); return data.session; },
  async signIn(email) {
    return SB.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  },
  async signOut() { await SB.auth.signOut(); location.reload(); },
};
