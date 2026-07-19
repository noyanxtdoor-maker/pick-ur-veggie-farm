// Post-sign-in TOTP challenge. Reached via the router's RequireMfaChallenge gate whenever the
// session is AAL1 but the account has a verified TOTP factor (i.e. the primary sign-in — password,
// Google, or passkey — only proved identity, not possession of the second factor yet). Mirrors
// SetMpin.tsx's shape (same PinPad/PinDots components, same light Card layout) since both are a
// "enter a 6-digit code before you can proceed" screen — deliberately NOT Login.tsx's dark theme,
// since this isn't the sign-in form, it's a step gating an already-authenticated session.
import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {ShieldCheck} from 'lucide-react';
import {Card} from '../components/ui';
import {PinDots, PinPad} from '../components/PinPad';
import {mfaApi} from '../features/auth/mfa';
import {useSession} from '../core/auth/session';

export default function MfaChallenge() {
  const navigate = useNavigate();
  const {signOut} = useSession();
  const [factorId, setFactorId] = useState<string | null | 'loading'>('loading');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    mfaApi.needsChallenge().then((r) => { if (alive) setFactorId(r.factorId); });
    return () => { alive = false; };
  }, []);

  async function submit(fullCode: string) {
    if (!factorId || factorId === 'loading') return;
    setBusy(true); setError(null);
    const res = await mfaApi.verifyChallenge(factorId, fullCode);
    setBusy(false);
    if (res.error) { setError('Incorrect code — try again.'); setCode(''); return; }
    navigate('/dashboard', {replace: true});
  }

  function onChange(next: string) {
    setError(null);
    setCode(next);
    if (next.length === 6) void submit(next);
  }

  if (factorId === 'loading') return <div className="flex min-h-screen items-center justify-center bg-farm-bg" />;

  // The gate only sends users here when a verified factor exists, but the account's factor could have
  // been removed from another device between the redirect decision and this mount — don't strand them.
  if (!factorId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-farm-bg p-6">
        <Card className="w-full max-w-sm text-center">
          <p className="mb-4 text-sm text-farm-muted">Your two-factor setup changed — sign in again to continue.</p>
          <button type="button" onClick={() => void signOut()} className="text-sm font-semibold text-farm-green hover:underline">Sign out</button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-farm-bg p-6">
      <Card className="w-full max-w-sm">
        <div className="mb-2 flex items-center gap-2 text-2xl font-extrabold text-farm-green">
          <ShieldCheck aria-hidden /> Enter your 2FA code
        </div>
        <p className="mb-6 text-sm text-farm-muted">Open your authenticator app and enter the current 6-digit code.</p>
        <div className="mb-6"><PinDots length={6} filled={code.length} /></div>
        {error ? <p className="mb-4 text-center text-sm font-medium text-farm-danger" role="alert">{error}</p> : null}
        {busy ? <p className="mb-4 text-center text-xs font-semibold text-farm-muted">Checking…</p> : null}
        <PinPad value={code} onChange={onChange} />
        <button type="button" onClick={() => void signOut()} className="mt-4 w-full text-center text-xs font-semibold text-farm-muted hover:text-farm-green">
          Not you? Sign out
        </button>
      </Card>
    </div>
  );
}
