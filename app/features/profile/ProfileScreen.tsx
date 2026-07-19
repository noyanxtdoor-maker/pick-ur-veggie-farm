// Profile section (ported from Team B f0249fa, owner parity order 2026-07-16): self-service
// Username + Email + Password for EVERYONE.
// The OTP-guarded password change (SecurityCard) MOVED here from Settings per the same order.
// Username governs via P1L RPC `update_own_username` (server-enforced format + uniqueness + audit).
// Email changes via supabase.auth.updateUser (triggers email-confirmation to the NEW address).
// No permission key needed — this is SELF-service (the caller edits their own identity, always).
import {useEffect, useState} from 'react';
import {UserCircle, AtSign, KeyRound, Save, ShieldCheck, Fingerprint, Trash2, Smartphone} from 'lucide-react';
import {useSession} from '../../core/auth/session';
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {MOCK_MODE} from '../../core/mock/mock';
import {Button, Card, PageHeader} from '../../components/ui';
import {useToast} from '../../components/feedback';
import {mpinApi, biometricApi, type PasskeyListItem} from '../auth/onboarding';
import {mfaApi, type TotpFactor, type TotpEnrollment} from '../auth/mfa';

// P1L's server RPC (update_own_username) force-lowercases and validates ^[a-z0-9_.]{3,30}$ — this client
// check mirrors that exactly (was ^[a-zA-Z0-9_.]$ before, letting uppercase pass validation here only to
// get silently downcased on save, which read as a bug). Owner 2026-07-18: highlight "lowercase" so it's
// not a silent surprise.
const USERNAME_RULES = '3–30 chars: lowercase letters, numbers, dot, or underscore. Unique across the farm.';

function UsernameCard() {
  const {user, updateOwnUsername} = useSession();
  const {notify} = useToast();
  const [current, setCurrent] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (MOCK_MODE) {
        const authId = user?.id;
        const m = authId ? await offlineDB.meta.get(`mock-username-${authId}`) : null;
        const v = (m?.value as string) ?? 'demo_user';
        if (alive) { setCurrent(v); setDraft(v); }
        return;
      }
      const authId = user?.id;
      if (!authId) return;
      const {data} = await supabase.from('users').select('username').eq('auth_user_id', authId).maybeSingle();
      if (alive) { const v = (data?.username as string) ?? ''; setCurrent(v); setDraft(v); }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  async function save() {
    const next = draft.trim();
    if (next === current) { setErr(null); notify('No change — username already set'); return; }
    if (!next || !/^[a-z0-9_.]{3,30}$/.test(next)) { setErr(USERNAME_RULES); return; }
    setBusy(true); setErr(null);
    const r = await updateOwnUsername(next);
    setBusy(false);
    if (r.error) { setErr(r.error); notify(r.error, 'error'); }
    else { setCurrent(next); notify('Username saved'); }
  }

  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><UserCircle className="h-5 w-5" aria-hidden /> Username</h3>
      <p className="mb-3 text-xs text-farm-muted">
        Your login alias — you can sign in with this OR your email. 3–30 chars: <strong className="font-bold text-farm-ink">lowercase</strong> letters, numbers, dot, or underscore. Unique across the farm.
      </p>
      {err ? <p className="mb-2 text-xs font-semibold text-red-700" role="alert">{err}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Username</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.toLowerCase())}
            placeholder="yourname"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm"
          />
        </label>
        <Button variant="secondary" onClick={() => void save()} disabled={busy || draft.trim() === current}>
          {busy ? 'Saving…' : <><Save size={16} aria-hidden /> Save</>}
        </Button>
      </div>
    </Card>
  );
}

function EmailCard() {
  const {user, updateOwnEmail} = useSession();
  const {notify} = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isGoogleOnly = (user?.app_metadata?.providers as string[] | undefined)?.every((p) => p === 'google') ?? false;
  const current = user?.email ?? '';

  useEffect(() => { setDraft(current); }, [current]);

  async function save() {
    const next = draft.trim();
    if (!next) { setErr('Email cannot be empty'); return; }
    if (next === current) { setErr(null); notify('No change — email already set'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { setErr('Enter a valid email address'); return; }
    setBusy(true); setErr(null);
    const r = await updateOwnEmail(next);
    setBusy(false);
    if (r.error) { setErr(r.error); notify(r.error, 'error'); }
    else { notify('Confirmation email sent to the new address — click the link to finish the change.'); }
  }

  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><AtSign className="h-5 w-5" aria-hidden /> Email</h3>
      {isGoogleOnly ? (
        <p className="text-xs text-farm-muted">You sign in with Google, so your email is managed in your Google account — not here.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-farm-muted">
            Changing the email sends a confirmation link to the <strong>new</strong> address. The change
            finishes only after you click that link — the old email keeps working until then.
          </p>
          {err ? <p className="mb-2 text-xs font-semibold text-red-700" role="alert">{err}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block flex-1">
              <span className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Email address</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm"
              />
            </label>
            <Button variant="secondary" onClick={() => void save()} disabled={busy || draft.trim() === current}>
              {busy ? 'Sending…' : <><Save size={16} aria-hidden /> Save</>}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// Moved from SettingsHub (owner 2026-07-15): OTP-guarded password change (ODR-003 re-auth).
function PasswordCard() {
  const {user, requestPasswordOtp, updatePasswordWithOtp} = useSession();
  const {notify} = useToast();
  const [step, setStep] = useState<'idle' | 'otp'>('idle');
  const [otp, setOtp] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isGoogleOnly = (user?.app_metadata?.providers as string[] | undefined)?.every((p) => p === 'google') ?? false;

  async function sendCode() {
    setBusy(true); setErr(null); setMsg(null);
    const r = await requestPasswordOtp();
    if (r.error) setErr(r.error);
    else { setStep('otp'); setMsg(`We emailed a one-time code to ${user?.email ?? 'your address'}. Enter it below with your new password.`); }
    setBusy(false);
  }
  async function save() {
    if (pw.length < 12) return setErr('New password needs at least 12 characters — a short sentence works well.');
    if (pw !== pw2) return setErr('Passwords do not match.');
    setBusy(true); setErr(null);
    const r = await updatePasswordWithOtp(pw, otp.trim());
    if (r.error) setErr(r.error);
    else { setStep('idle'); setOtp(''); setPw(''); setPw2(''); setMsg('Password changed. Use it from your next sign-in.'); notify('Password changed'); }
    setBusy(false);
  }

  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><KeyRound className="h-5 w-5" aria-hidden /> Password</h3>
      {isGoogleOnly ? (
        <p className="text-xs text-farm-muted">You sign in with Google, so there is no app password here — manage your password in your Google account.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-farm-muted">For your protection, changing the password needs a one-time code we email to <strong className="font-mono text-farm-ink">{user?.email ?? 'you'}</strong>.</p>
          {msg ? <p className="mb-2 rounded-lg bg-farm-accent-soft px-3 py-2 text-xs font-semibold text-farm-green" role="status">{msg}</p> : null}
          {err ? <p className="mb-2 text-xs font-semibold text-red-700" role="alert">{err}</p> : null}
          {step === 'idle' ? (
            <Button variant="secondary" onClick={() => void sendCode()} disabled={busy}>{busy ? 'Sending…' : 'Email me a one-time code'}</Button>
          ) : (
            <div className="space-y-2.5">
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="6-digit code from the email" aria-label="One-time code" className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 font-mono text-sm tracking-widest" />
              <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="new-password" placeholder="New password (12+ characters)" aria-label="New password" className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              <input value={pw2} onChange={(e) => setPw2(e.target.value)} type="password" autoComplete="new-password" placeholder="Repeat new password" aria-label="Repeat new password" className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { setStep('idle'); setErr(null); setMsg(null); }} disabled={busy}>Cancel</Button>
                <Button className="flex-1" onClick={() => void save()} disabled={busy || otp.length < 6 || !pw}>{busy ? 'Saving…' : 'Change password'}</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// P1P (owner directive 2026-07-18): self-service MPIN change, same shape as PasswordCard above but
// against change_mpin (requires the CURRENT MPIN — same rate-limited check the lock screen uses,
// see lock.tsx / the P1P migration header for why that matters). Plain numeric inputs rather than
// the bank-style PinPad keypad — Profile is a settings page, not the quick-unlock flow, and matches
// this screen's existing PasswordCard convention.
function MpinCard() {
  const {notify} = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setErr(null); setMsg(null);
    if (current.length !== 6) return setErr('Enter your current 6-digit MPIN.');
    if (next.length !== 6) return setErr('New MPIN must be exactly 6 digits.');
    if (next !== confirm) return setErr('New MPIN entries do not match.');
    setBusy(true);
    try {
      const result = await mpinApi.change(current, next);
      if (result === 'ok') {
        setCurrent(''); setNext(''); setConfirm('');
        setMsg('MPIN changed. Use it next time you unlock.');
        notify('MPIN changed');
      } else if (result === 'wrong') setErr('Current MPIN is incorrect.');
      else if (result === 'locked') setErr('Too many attempts — try again in a bit.');
      else setErr('No MPIN is set on this account yet.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not change MPIN');
    } finally { setBusy(false); }
  }

  if (MOCK_MODE) {
    return (
      <Card>
        <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><ShieldCheck className="h-5 w-5" aria-hidden /> MPIN</h3>
        <p className="text-xs text-farm-muted">Demo mode has no MPIN — this is set up on your first real sign-in.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><ShieldCheck className="h-5 w-5" aria-hidden /> MPIN</h3>
      <p className="mb-3 text-xs text-farm-muted">Your 6-digit quick-unlock PIN for the lock screen. Changing it needs your current MPIN.</p>
      {msg ? <p className="mb-2 rounded-lg bg-farm-accent-soft px-3 py-2 text-xs font-semibold text-farm-green" role="status">{msg}</p> : null}
      {err ? <p className="mb-2 text-xs font-semibold text-red-700" role="alert">{err}</p> : null}
      <div className="space-y-2.5">
        <input value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password" autoComplete="off" placeholder="Current MPIN" aria-label="Current MPIN" className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 font-mono text-sm tracking-widest" />
        <input value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password" autoComplete="off" placeholder="New MPIN (6 digits)" aria-label="New MPIN" className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 font-mono text-sm tracking-widest" />
        <input value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password" autoComplete="off" placeholder="Repeat new MPIN" aria-label="Repeat new MPIN" className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 font-mono text-sm tracking-widest" />
        <Button variant="secondary" onClick={() => void save()} disabled={busy || current.length !== 6 || next.length !== 6 || confirm.length !== 6}>
          {busy ? 'Saving…' : 'Change MPIN'}
        </Button>
      </div>
    </Card>
  );
}

// P1P.2 (owner directive 2026-07-18): self-service passkey management — list what's registered,
// remove any of them, add another (e.g. for a second device). Mirrors MpinCard's shape, including
// the MOCK_MODE early return. Removing a passkey does NOT re-arm the onboarding offer — that's a
// deliberate management action, not "never decided" (see the P1P.2 migration header).
function BiometricCard() {
  const {notify} = useToast();
  const [supported, setSupported] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyListItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try { setPasskeys(await biometricApi.list()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not load your passkeys'); }
  }

  useEffect(() => {
    biometricApi.isSupported().then(setSupported);
    void refresh();
  }, []);

  async function add() {
    setBusy(true); setErr(null);
    const result = await biometricApi.register();
    setBusy(false);
    if (result.status === 'ok') { notify('Passkey added'); void refresh(); return; }
    if (result.status === 'cancelled') return; // quiet — user backed out of the OS prompt
    setErr(result.message);
  }

  async function remove(passkeyId: string) {
    setBusy(true); setErr(null);
    const r = await biometricApi.remove(passkeyId);
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    notify('Passkey removed');
    void refresh();
  }

  if (MOCK_MODE) {
    return (
      <Card>
        <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><Fingerprint className="h-5 w-5" aria-hidden /> Biometric</h3>
        <p className="text-xs text-farm-muted">Demo mode has no biometric flow — this is set up on your first real sign-in.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><Fingerprint className="h-5 w-5" aria-hidden /> Biometric</h3>
      <p className="mb-3 text-xs text-farm-muted">Fingerprint, Face ID, or device PIN for a faster unlock. Optional — your MPIN always works too.</p>
      {err ? <p className="mb-2 text-xs font-semibold text-red-700" role="alert">{err}</p> : null}
      {passkeys === null ? (
        <p className="text-xs text-farm-muted">Loading…</p>
      ) : passkeys.length === 0 ? (
        <p className="mb-3 text-xs text-farm-muted">No passkey set up yet on this account.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-lg border border-farm-accent-soft bg-farm-bg px-3 py-2">
              <div>
                <p className="text-xs font-bold text-farm-ink">{p.friendly_name || 'Passkey'}</p>
                <p className="text-[10px] text-farm-muted">
                  Added {new Date(p.created_at).toLocaleDateString()}
                  {p.last_used_at ? ` · last used ${new Date(p.last_used_at).toLocaleDateString()}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => void remove(p.id)} disabled={busy} className="text-red-700 hover:text-red-900" aria-label={`Remove ${p.friendly_name || 'passkey'}`}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <Button variant="secondary" onClick={() => void add()} disabled={busy}>
          {busy ? 'Waiting for your device…' : 'Add another passkey'}
        </Button>
      ) : (
        <p className="text-[10px] text-farm-muted">This device doesn't support adding a new passkey.</p>
      )}
    </Card>
  );
}

// Two-factor authentication (owner 2026-07-19: "settle the 2 factor login... if not build it"). TOTP
// was already ON at the Supabase project level (owner-confirmed 2026-07-13) but had no in-app
// enrollment screen — the toggle existed with no way for a user to actually turn it on for
// themselves. Mirrors BiometricCard's shape (list/add/remove, MOCK_MODE early return), but adds a
// mid-enrollment step BiometricCard doesn't need: TOTP requires the user to prove they captured the
// QR code correctly (scan it, then type back a live code) before the factor counts as active —
// unlike a passkey ceremony, which the OS confirms in one round trip.
function TwoFactorCard() {
  const {notify} = useToast();
  const [factor, setFactor] = useState<TotpFactor | null | undefined>(undefined);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try { const factors = await mfaApi.listVerifiedFactors(); setFactor(factors[0] ?? null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not load your two-factor status'); }
  }

  useEffect(() => { void refresh(); }, []);

  async function startEnroll() {
    setBusy(true); setErr(null);
    try { setEnrollment(await mfaApi.enroll()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not start enrollment'); }
    setBusy(false);
  }

  async function verifyEnroll() {
    if (!enrollment) return;
    setBusy(true); setErr(null);
    const res = await mfaApi.verifyEnrollment(enrollment.factorId, code);
    setBusy(false);
    if (res.error) { setErr('Incorrect code — try again.'); setCode(''); return; }
    notify('Two-factor authentication enabled');
    setEnrollment(null); setCode('');
    void refresh();
  }

  async function cancelEnroll() {
    if (!enrollment) return;
    setBusy(true);
    await mfaApi.cancelEnrollment(enrollment.factorId);
    setBusy(false);
    setEnrollment(null); setCode(''); setErr(null);
  }

  async function disable() {
    if (!factor) return;
    setBusy(true); setErr(null);
    const res = await mfaApi.unenroll(factor.id);
    setBusy(false);
    if (res.error) { setErr(res.error); return; }
    notify('Two-factor authentication disabled');
    void refresh();
  }

  if (MOCK_MODE) {
    return (
      <Card>
        <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><Smartphone className="h-5 w-5" aria-hidden /> Two-Factor Authentication</h3>
        <p className="text-xs text-farm-muted">Demo mode has no two-factor flow.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold text-farm-green"><Smartphone className="h-5 w-5" aria-hidden /> Two-Factor Authentication</h3>
      <p className="mb-3 text-xs text-farm-muted">Require a code from an authenticator app (Google Authenticator, Authy, etc.) in addition to your password.</p>
      {err ? <p className="mb-2 text-xs font-semibold text-red-700" role="alert">{err}</p> : null}

      {enrollment ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-farm-accent-soft bg-farm-bg p-3 text-center">
            <img src={enrollment.qrCode} alt="Scan this QR code with your authenticator app" className="mx-auto h-40 w-40" />
            <p className="mt-2 text-[10px] text-farm-muted">Can't scan? Enter this key manually:</p>
            <p className="select-all break-all font-mono text-xs text-farm-ink">{enrollment.secret}</p>
          </div>
          <div>
            <label htmlFor="tf-code" className="mb-1 block text-xs font-bold text-farm-ink">Enter the 6-digit code from the app</label>
            <input
              id="tf-code" inputMode="numeric" maxLength={6} value={code}
              onChange={(e) => { setErr(null); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); }}
              className="w-full rounded-lg border border-farm-accent bg-farm-card px-3 py-2 text-center font-mono text-lg tracking-widest text-farm-ink"
              placeholder="000000"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void verifyEnroll()} disabled={busy || code.length !== 6}>Verify &amp; enable</Button>
            <Button variant="secondary" onClick={() => void cancelEnroll()} disabled={busy}>Cancel</Button>
          </div>
        </div>
      ) : factor === undefined ? (
        <p className="text-xs text-farm-muted">Loading…</p>
      ) : factor ? (
        <div className="flex items-center justify-between rounded-lg border border-farm-accent-soft bg-farm-bg px-3 py-2">
          <div>
            <p className="text-xs font-bold text-farm-green">Two-factor authentication is ON</p>
            <p className="text-[10px] text-farm-muted">Enabled {new Date(factor.createdAt).toLocaleDateString()}</p>
          </div>
          <button type="button" onClick={() => void disable()} disabled={busy} className="text-red-700 hover:text-red-900" aria-label="Disable two-factor authentication">
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => void startEnroll()} disabled={busy}>
          {busy ? 'Starting…' : 'Enable Two-Factor Authentication'}
        </Button>
      )}
    </Card>
  );
}

export default function ProfileScreen() {
  const {user} = useSession();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile"
        subtitle="Your own identity: username, email, and password. Everyone gets this — you only edit yourself."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <UsernameCard />
          <EmailCard />
        </div>
        <div className="space-y-6">
          <PasswordCard />
          <MpinCard />
          <BiometricCard />
          <TwoFactorCard />
          <Card>
            <h3 className="mb-2 text-base font-bold text-farm-muted">Session</h3>
            <p className="text-xs text-farm-muted">
              Signed in as <strong className="font-mono text-farm-ink">{user?.email ?? 'operator'}</strong>.
              Sign out + device preferences live in Settings.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
