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
