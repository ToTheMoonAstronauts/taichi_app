/* Theme: default = brown. ?t=g -> green, ?t=b -> brown. Choice persists. */
(function () {
  try {
    const t = new URLSearchParams(location.search).get("t");
    if (t === "g") localStorage.setItem("tm_theme", "green");
    else if (t === "b") localStorage.setItem("tm_theme", "brown");
    const theme = localStorage.getItem("tm_theme") === "green" ? "green" : "brown";
    document.documentElement.setAttribute("data-theme", theme);
    const applyLogo = () => document.querySelectorAll("img.logo").forEach(i => i.setAttribute("src", theme === "green" ? "assets/logo.webp" : "assets/logo2.webp"));
    if (document.readyState !== "loading") applyLogo();
    else document.addEventListener("DOMContentLoaded", applyLogo);
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
