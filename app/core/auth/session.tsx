// Session provider (M1B §2, S2). Offline-tolerant: getSession() reads persisted storage WITHOUT network, so
// startup never hangs offline and an expired access token does not log the user out — the app keeps working on
// cache and queues writes; supabase-js refreshes when online; a dead refresh token fires SIGNED_OUT → re-auth.
import {createContext, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import type {Session, User} from '@supabase/supabase-js';
import {supabase, isSupabaseConfigured} from '../supabase/client';
import {offlineDB, purgeCache} from '../offline/db';
import {DEMO, MOCK_MODE} from '../mock/mock';

// A minimal stand-in session for mock/offline-dev mode (no cloud auth).
const MOCK_SESSION = {access_token: 'mock', token_type: 'bearer', user: {id: DEMO.authId}} as unknown as Session;

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionValue {
  status: SessionStatus;
  session: Session | null;
  user: User | null;
  authUserId: string | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<{error: string | null}>;
  // P1A self-signup: creates the auth identity; the DB trigger creates the ERP identity (Active, zero
  // memberships = awaiting approval, C2 §3). requestedRole is a WISH in metadata — the queue shows it,
  // the approver assigns the real role. needsConfirmation = email-confirm is on and no session yet.
  signUp: (email: string, password: string, displayName: string, requestedRole?: string) => Promise<{error: string | null; needsConfirmation: boolean}>;
  // P1 self-service reset (B7 §2): emails a recovery link that lands on /auth/reset.
  resetPassword: (email: string) => Promise<{error: string | null}>;
  updatePassword: (newPassword: string) => Promise<{error: string | null}>;
  // P1 OTP-guarded password change (ODR-003 sensitive-action re-auth): requestOtp emails a 6-digit code;
  // updatePassword then carries it as the nonce.
  requestPasswordOtp: () => Promise<{error: string | null}>;
  updatePasswordWithOtp: (newPassword: string, otp: string) => Promise<{error: string | null}>;
  signInWithGoogle: () => Promise<{error: string | null}>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({children}: {children: ReactNode}) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let active = true;
    // Mock/offline-dev mode: derive auth state from local storage; no cloud call.
    if (MOCK_MODE) {
      offlineDB.meta.get('mock-auth').then((m) => {
        if (!active) return;
        const authed = m?.value === true;
        setSession(authed ? MOCK_SESSION : null);
        setStatus(authed ? 'authenticated' : 'anonymous');
      });
      return () => {active = false;};
    }
    // Reads local storage only — resolves even with no internet (S2: no hang on offline startup).
    supabase.auth.getSession().then(({data}) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? 'authenticated' : 'anonymous');
    });
    const {data: sub} = supabase.auth.onAuthStateChange((_event, s) => {
      if (!active) return;
      setSession(s);
      setStatus(s ? 'authenticated' : 'anonymous');
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      authUserId: session?.user?.id ?? null,
      configured: isSupabaseConfigured,
      signIn: async (email, password) => {
        if (MOCK_MODE) {
          await offlineDB.meta.put({key: 'mock-auth', value: true});
          setSession(MOCK_SESSION);
          setStatus('authenticated');
          return {error: null};
        }
        const {error} = await supabase.auth.signInWithPassword({email, password});
        return {error: error ? error.message : null};
      },
      signUp: async (email, password, displayName, requestedRole) => {
        if (MOCK_MODE) {
          // demo mode has no cloud identities — signing up just signs you in
          await offlineDB.meta.put({key: 'mock-auth', value: true});
          setSession(MOCK_SESSION);
          setStatus('authenticated');
          return {error: null, needsConfirmation: false};
        }
        const {data, error} = await supabase.auth.signUp({
          email, password,
          options: {data: {display_name: displayName, requested_role: requestedRole ?? null}, emailRedirectTo: `${window.location.origin}/login`},
        });
        if (error) return {error: error.message, needsConfirmation: false};
        return {error: null, needsConfirmation: !data.session};
      },
      resetPassword: async (email) => {
        if (MOCK_MODE) return {error: 'Demo mode has no passwords — just sign in with anything.'};
        const {error} = await supabase.auth.resetPasswordForEmail(email, {redirectTo: `${window.location.origin}/auth/reset`});
        return {error: error ? error.message : null};
      },
      updatePassword: async (newPassword) => {
        if (MOCK_MODE) return {error: 'Demo mode has no passwords.'};
        const {error} = await supabase.auth.updateUser({password: newPassword});
        return {error: error ? error.message : null};
      },
      requestPasswordOtp: async () => {
        if (MOCK_MODE) return {error: 'Demo mode has no passwords.'};
        const {error} = await supabase.auth.reauthenticate(); // emails a one-time code (nonce)
        return {error: error ? error.message : null};
      },
      updatePasswordWithOtp: async (newPassword, otp) => {
        if (MOCK_MODE) return {error: 'Demo mode has no passwords.'};
        const {error} = await supabase.auth.updateUser({password: newPassword, nonce: otp});
        return {error: error ? error.message : null};
      },
      signInWithGoogle: async () => {
        if (MOCK_MODE) return {error: 'Demo mode — just sign in with any email & password.'};
        const {error} = await supabase.auth.signInWithOAuth({provider: 'google', options: {redirectTo: `${window.location.origin}/dashboard`}});
        return {error: error ? error.message : null};
      },
      signOut: async () => {
        if (MOCK_MODE) {
          await offlineDB.meta.put({key: 'mock-auth', value: false}); // keep seeded demo data so re-login works
          setSession(null);
          setStatus('anonymous');
          return;
        }
        await supabase.auth.signOut();
        await purgeCache(); // S1 — purge scoped cache on logout.
      },
    }),
    [status, session],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within <SessionProvider>');
  return v;
}
