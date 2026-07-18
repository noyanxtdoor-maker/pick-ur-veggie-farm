// P1P (owner directive 2026-07-18): 2-minute auto-lock, banking-app style. Mirrors SyncProvider's
// pattern (app/core/offline/sync.tsx) closely: a ref-based activity timestamp (not React state, so
// a keystroke doesn't cause a re-render), checked on an interval, plus a visibilitychange handler
// that force-checks the instant a backgrounded tab regains focus. This is a client-side OVERLAY, not
// a sign-out — the Supabase session, refresh token, and offline cache all stay fully intact; see the
// migration's own header for why (signOut() does not touch the offline outbox, and a full re-auth on
// every idle timeout would defeat "fast bank-app re-entry", the entire point of this feature).
//
// Same mechanism closes a second gap for free: reopening the app with a still-valid persisted
// session used to skip any MPIN prompt entirely (Login.tsx's `if (authenticated) redirect` has no
// re-check). LockProvider now defaults to LOCKED whenever `status` becomes 'authenticated' via
// silent session rehydration, and UNLOCKED when it becomes 'authenticated' via an actual interactive
// sign-in (see consumeInteractiveSignInFlag in session.tsx) — one component, two cases covered.
//
// Owner decision (2026-07-18, confirmed via AskUserQuestion): if the idle timer fires while the
// device has NO internet signal, do NOT lock — the check is skipped entirely while offline, and only
// resumes once connectivity returns. MOCK_MODE never arms (this is a demo; mpinApi itself no-ops
// there too).
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Lock, Fingerprint} from 'lucide-react';
import {useSession, consumeInteractiveSignInFlag} from '../auth/session';
import {useSync} from '../offline/sync';
import {mpinApi, biometricApi} from '../../features/auth/onboarding';
import {supabase} from '../supabase/client';
import {MOCK_MODE} from '../mock/mock';
import {Card} from '../../components/ui';
import {PinDots, PinPad} from '../../components/PinPad';

const IDLE_MS = 120_000;
const CHECK_INTERVAL_MS = 10_000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

function LockScreen({onUnlock}: {onUnlock: () => void}) {
  const {signOut, user} = useSession();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);

  useEffect(() => {
    let alive = true;
    biometricApi.isSupported().then((v) => { if (alive) setBiometricSupported(v); });
    return () => { alive = false; };
  }, []);

  async function submit(next: string) {
    setError(null);
    setPin(next);
    if (next.length !== 6) return;
    setBusy(true);
    try {
      const result = await mpinApi.verify(next);
      if (result === 'ok') { onUnlock(); return; }
      if (result === 'locked') setError('Too many attempts — locked for a bit. Try again shortly, or sign out below.');
      else if (result === 'no_mpin') setError('No MPIN found on this account — sign out and set one up again from Profile.');
      else setError('Incorrect PIN — try again.');
      setPin('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify your PIN');
      setPin('');
    } finally { setBusy(false); }
  }

  // P1P.2: resumes an already-authenticated, already-locked tab — calls the SDK directly rather
  // than session.tsx's signInWithPasskey() wrapper, deliberately skipping markInteractiveSignIn().
  // See session.tsx's own comment on that wrapper for why: marking it here would leak into the
  // next genuine cold reload of this tab and wrongly skip the lock screen then.
  async function useBiometric() {
    setError(null); setBusy(true);
    const {error: err} = await supabase.auth.signInWithPasskey();
    setBusy(false);
    if (!err) { onUnlock(); return; }
    if ((err as {code?: string}).code === 'ERROR_CEREMONY_ABORTED') return; // user backed out — quiet, not an error
    setError(err.message);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-farm-bg p-6">
      <Card className="w-full max-w-sm text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-farm-green" aria-hidden />
        <h2 className="mb-1 text-xl font-extrabold text-farm-ink">Locked</h2>
        <p className="mb-6 text-sm text-farm-muted">Enter your MPIN to continue{user?.email ? `, ${user.email}` : ''}.</p>
        <div className="mb-6"><PinDots length={6} filled={pin.length} /></div>
        {error ? <p className="mb-4 text-sm font-medium text-farm-danger" role="alert">{error}</p> : null}
        <PinPad value={pin} onChange={(v) => void submit(v)} />
        {biometricSupported ? (
          <button
            type="button"
            onClick={() => void useBiometric()}
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-farm-accent bg-farm-card py-2.5 text-sm font-semibold text-farm-green hover:bg-farm-bg"
          >
            <Fingerprint className="h-4 w-4" aria-hidden /> Use biometric
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={busy}
          className="mt-5 text-xs font-semibold text-farm-muted hover:text-farm-green"
        >
          Not you? Sign out
        </button>
      </Card>
    </div>
  );
}

export function LockProvider({children}: {children: ReactNode}) {
  const {status} = useSession();
  const {online} = useSync();
  const [locked, setLocked] = useState(false);
  const [hasMpin, setHasMpin] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const initializedRef = useRef(false); // have we decided the initial lock state for THIS authenticated+MPIN'd session yet?

  const authed = status === 'authenticated' && !MOCK_MODE;
  // Gate on an actual MPIN existing, not just being authenticated — an awaiting-approval user (no
  // membership yet) and a user mid-onboarding (username chosen, MPIN not yet) both have none, and
  // must never be locked behind a screen they have no way to unlock (verify_mpin would just return
  // 'no_mpin' forever). Poll every check interval ONLY until it's first seen true — an account's
  // MPIN can be changed but never un-set, so there is nothing left to learn once this flips.
  useEffect(() => {
    if (!authed) { setHasMpin(false); return; }
    if (hasMpin) return;
    let alive = true;
    const poll = () => { mpinApi.status().then((s) => { if (alive && s.hasMpin) setHasMpin(true); }).catch(() => undefined); };
    poll();
    const id = window.setInterval(poll, CHECK_INTERVAL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [authed, hasMpin]);

  const armed = authed && hasMpin;

  // Decide the initial lock state exactly once per authenticated+MPIN'd session — interactive
  // sign-in starts unlocked, silent rehydration starts locked.
  useEffect(() => {
    if (!authed) { initializedRef.current = false; setLocked(false); return; }
    if (!armed || initializedRef.current) return;
    initializedRef.current = true;
    setLocked(!consumeInteractiveSignInFlag());
    lastActivityRef.current = Date.now();
  }, [authed, armed]);

  useEffect(() => {
    if (!armed) return;
    const bump = () => { lastActivityRef.current = Date.now(); };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, bump, {passive: true}));
    window.addEventListener('focus', bump);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, bump));
      window.removeEventListener('focus', bump);
    };
  }, [armed]);

  useEffect(() => {
    if (!armed) return;
    const check = () => {
      if (!online) return; // owner's decision: never lock while offline
      if (Date.now() - lastActivityRef.current >= IDLE_MS) setLocked(true);
    };
    const id = window.setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [armed, online]);

  const showLock = useMemo(() => armed && locked, [armed, locked]);

  return (
    <>
      {children}
      {showLock ? <LockScreen onUnlock={() => { setLocked(false); lastActivityRef.current = Date.now(); }} /> : null}
    </>
  );
}
