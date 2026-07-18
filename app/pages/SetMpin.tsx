// P1P (owner directive 2026-07-18): mandatory MPIN onboarding step — "Approval Screen -> Set
// Username -> Set MPIN Required -> Set Fingerprint biometrics (optional)", banking-app style.
// Reached via the RequireOnboarding router gate once username is chosen but no MPIN exists yet
// (onboarding_next_step() === 'mpin'). Two-stage: enter 6 digits, then repeat them to confirm —
// mismatches are always caught client-side; format/trivial-PIN rejection is server-side (set_mpin),
// mirrored here only as early feedback. After success, the user is sent to /dashboard (same as
// ChooseUsername.tsx — onboarding_next_step() will report null next time since MPIN is now set).
import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {ShieldCheck} from 'lucide-react';
import {Card} from '../components/ui';
import {PinDots, PinPad} from '../components/PinPad';
import {mpinApi} from '../features/auth/onboarding';

const TRIVIAL = new Set(['123456', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '000000', '654321']);

export default function SetMpin() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const value = stage === 'enter' ? pin : confirm;

  function onChange(next: string) {
    setError(null);
    if (stage === 'enter') {
      setPin(next);
      if (next.length === 6) {
        if (TRIVIAL.has(next)) { setError('That PIN is too easy to guess — choose a less common 6 digits.'); setPin(''); return; }
        setStage('confirm');
      }
      return;
    }
    setConfirm(next);
    if (next.length === 6) void submit(next);
  }

  async function submit(confirmed: string) {
    if (confirmed !== pin) {
      setError('PINs did not match — try again.');
      setConfirm('');
      return;
    }
    setBusy(true); setError(null);
    try {
      await mpinApi.set(pin);
      navigate('/dashboard', {replace: true});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set your MPIN');
      setStage('enter'); setPin(''); setConfirm('');
    } finally { setBusy(false); }
  }

  function backToStart() {
    setStage('enter'); setPin(''); setConfirm(''); setError(null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-farm-bg p-6">
      <Card className="w-full max-w-sm">
        <div className="mb-2 flex items-center gap-2 text-2xl font-extrabold text-farm-green">
          <ShieldCheck aria-hidden /> Set your MPIN
        </div>
        <p className="mb-6 text-sm text-farm-muted">
          {stage === 'enter'
            ? 'Choose a 6-digit PIN — like a banking app. You will use this (or biometrics, once set up) for a quick unlock instead of retyping your password every time.'
            : 'Enter the same 6 digits again to confirm.'}
        </p>

        <div className="mb-6">
          <PinDots length={6} filled={value.length} />
        </div>

        {error ? <p className="mb-4 text-center text-sm font-medium text-farm-danger" role="alert">{error}</p> : null}

        <PinPad value={value} onChange={onChange} />

        <div className="mt-4 flex items-center justify-between">
          {stage === 'confirm' ? (
            <button type="button" onClick={backToStart} className="text-xs font-semibold text-farm-muted hover:text-farm-green" disabled={busy}>
              Start over
            </button>
          ) : <span />}
          {busy ? <span className="text-xs font-semibold text-farm-muted">Saving…</span> : null}
        </div>
      </Card>
    </div>
  );
}
