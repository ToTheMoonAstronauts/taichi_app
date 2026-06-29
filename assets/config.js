/* Supabase client + auth helpers for the app. Loaded after the supabase-js UMD bundle. */
window.SUPA = {
  url: "https://pixtozeghxwiidpnloih.supabase.co",
  // publishable/anon key — safe for the browser; RLS protects data.
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpeHRvemVnaHh3aWlkcG5sb2loIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzgzNzgsImV4cCI6MjA5ODMxNDM3OH0.hJzlERAwXkbK8wV7R-NTcfa1YQ-TTk8R9nCM0Qdtblg",
};
window.SB = window.supabase.createClient(window.SUPA.url, window.SUPA.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});
window.AUTH = {
  async session() { const { data } = await SB.auth.getSession(); return data.session; },
  async signIn(email) {
    return SB.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  },
  async signOut() { await SB.auth.signOut(); location.reload(); },
};
