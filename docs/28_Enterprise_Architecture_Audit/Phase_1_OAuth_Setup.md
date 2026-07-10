# Phase 1 — Google OAuth Setup (owner click-path)

**Type:** Owner infrastructure click-path · **Date:** 2026-07-10 · **Authority:** B7 §1–§2, C2 §3, CLAUDE.md §6
Phase-1 row ("OAuth + email auth"). The APP side is already shipped (P1A): the "Continue with Google" button on
the login screen calls `signInWithOAuth({provider: 'google'})` and shows a friendly notice until the provider is
enabled. A Google sign-in creates the auth identity → the P1A trigger creates the ERP identity → the account
waits in the Approvals queue like any email signup (C2 §3 — identity never grants data access).

## Owner steps (once, ~10 minutes)

1. **Google Cloud Console** (console.cloud.google.com) → create/pick a project → *APIs & Services →
   OAuth consent screen*: External · app name "PickUrVeggie ERP" · your support email → save.
2. *APIs & Services → Credentials → Create credentials → OAuth client ID* → type **Web application**:
   - Authorized JavaScript origins: `https://<your-hosted-domain>` (and `http://localhost:3000` for dev).
   - Authorized redirect URI: `https://aqhxhamdwmhcwxmebqbo.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client secret**.
3. **Supabase dashboard** → project `aqhxhamdwmhcwxmebqbo` → *Authentication → Sign In / Up → Providers →
   Google* → toggle ON → paste Client ID + Client secret → Save.
4. Test: open the app → Sign in → **Continue with Google**. First-time Google users land in
   *Organization → Approvals* as pending sign-ups.

Nothing else changes: RLS/permissions gate all data; Google only replaces the password step.
