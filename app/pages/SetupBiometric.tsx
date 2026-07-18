// P1P.2 (owner directive 2026-07-18): optional biometric onboarding step — "Set Fingerprint
// biometrics (optional)", the final step of "Approval Screen -> Set Username -> Set MPIN Required
// -> Set Fingerprint biometrics (optional)". Reached via the RequireOnboarding router gate once
// MPIN is set but the offer hasn't been shown/decided yet (onboarding_next_step() === 'biometric_offer').
// Unlike username/MPIN, this step is skippable — the owner's own words: "some workers dont have
// that advcance phone that has biometrics so maybe an MPIN will be okay for them." Being shown the
// offer and deciding (either "set up now" or "skip") marks it seen via dismissOffer(); navigating
// away without deciding (closing the tab) does not, so they're re-offered next time.
import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Fingerprint} from 'lucide-react';
import {Button, Card} from '../components/ui';
import {biometricApi} from '../features/auth/onboarding';

export default function SetupBiometric() {
  const navigate = useNavigate();
  const [supported, setSupported] = useState<'checking' | boolean>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    biometricApi.isSupported().then((v) => { if (alive) setSupported(v); });
    return () => { alive = false; };
  }, []);

  async function finish() {
    await biometricApi.dismissOffer();
    navigate('/dashboard', {replace: true});
  }

  async function setUp() {
    setBusy(true); setError(null);
    const result = await biometricApi.register();
    setBusy(false);
    if (result.status === 'ok') { void finish(); return; }
    if (result.status === 'cancelled') return; // quiet — user backed out of the OS prompt, not an error
    setError(result.message);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-farm-bg p-6">
      <Card className="w-full max-w-sm text-center">
        <div className="mb-2 flex items-center justify-center gap-2 text-2xl font-extrabold text-farm-green">
          <Fingerprint aria-hidden /> Biometric unlock
        </div>

        {supported === 'checking' ? (
          <p className="text-sm text-farm-muted">Checking your device…</p>
        ) : supported ? (
          <>
            <p className="mb-6 text-sm text-farm-muted">
              Optional — use your fingerprint, Face ID, or device PIN for a faster unlock instead of
              typing your MPIN. You can always add or remove this later in Profile.
            </p>
            {error ? <p className="mb-4 text-sm font-medium text-farm-danger" role="alert">{error}</p> : null}
            <div className="space-y-2.5">
              <Button className="w-full" onClick={() => void setUp()} disabled={busy}>
                {busy ? 'Waiting for your device…' : 'Set up biometric unlock'}
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => void finish()} disabled={busy}>
                Skip for now
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-farm-muted">
              Your device doesn't support biometric sign-in — that's OK, your MPIN alone works great.
            </p>
            <Button className="w-full" onClick={() => void finish()}>Continue</Button>
          </>
        )}
      </Card>
    </div>
  );
}
