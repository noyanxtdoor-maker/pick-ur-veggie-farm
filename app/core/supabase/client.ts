// Supabase client — the ONLY place @supabase/supabase-js is constructed. Ships the ANON key only
// (M1B §2 / hardening A3/S1): the service_role key is never bundled. The bootstrap function is
// service_role-only and is therefore unreachable from this client by construction.
import {createClient, type SupabaseClient} from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Capture any OAuth/redirect-auth error BEFORE createClient() below runs — its internal URL detection
// (detectSessionInUrl) consumes and strips error/error_description from the hash/query asynchronously
// during its own init, so a later `useEffect` in Login.tsx always finds it already gone (empirically
// confirmed 2026-07-17: the hash read "" by the time a mount effect ran, even though it was present a
// moment earlier). This module-level read runs synchronously at import time, before that async init has
// a chance to fire, so it reliably wins the race. Read once; Login.tsx consumes and clears it.
function captureAuthRedirectError(): string | null {
  if (typeof window === 'undefined') return null;
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(window.location.search);
  const description = hashParams.get('error_description') ?? queryParams.get('error_description');
  const code = hashParams.get('error') ?? queryParams.get('error');
  if (!description && !code) return null;
  return (description ?? code ?? 'Sign-in failed — please try again.').replace(/\+/g, ' ');
}
export let capturedAuthRedirectError: string | null = captureAuthRedirectError();
export function consumeAuthRedirectError(): string | null {
  const v = capturedAuthRedirectError;
  capturedAuthRedirectError = null;
  return v;
}

// Persist the session (offline session lifecycle — M1B S2) and auto-refresh when online.
// detectSessionInUrl must be true: it's what lets the client pick up the OAuth `?code=` (Google
// sign-in redirect) and the recovery token in a password-reset email link and turn either into a
// session. `/accept?token=…` uses its own `token` query param, not `code`, so it never collides.
// flowType 'pkce' is explicit (2026-07-17 Google-OAuth-bug fix): without it supabase-js defaults to
// the legacy 'implicit' flow, which puts tokens in the URL *hash* rather than a `?code=` query param —
// the comment above always assumed `?code=`, so the default silently didn't match. PKCE is Supabase's
// current recommendation for SPAs and is what this client was written to expect.
export const supabase: SupabaseClient = createClient(url ?? 'http://localhost', anonKey ?? 'anon-placeholder', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    // P1P.2: passkey methods (auth.registerPasskey/signInWithPasskey/passkey.*) throw at call time
    // unless this is set — required even though Supabase's own passkey feature is out of beta.
    experimental: { passkey: true },
  },
});
