// Profile section (ported from Team B f0249fa, owner parity order 2026-07-16): self-service
// Username + Email + Password for EVERYONE.
// The OTP-guarded password change (SecurityCard) MOVED here from Settings per the same order.
// Username governs via P1L RPC `update_own_username` (server-enforced format + uniqueness + audit).
// Email changes via supabase.auth.updateUser (triggers email-confirmation to the NEW address).
// No permission key needed — this is SELF-service (the caller edits their own identity, always).
import {useEffect, useState} from 'react';
import {UserCircle, AtSign, KeyRound, Save} from 'lucide-react';
import {useSession} from '../../core/auth/session';
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {MOCK_MODE} from '../../core/mock/mock';
import {Button, Card, PageHeader} from '../../components/ui';
import {useToast} from '../../components/feedback';

const USERNAME_RULES = '3–30 chars: letters, numbers, dot, or underscore. Case-insensitive unique.';

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
    if (!next || !/^[a-zA-Z0-9_.]{3,30}$/.test(next)) { setErr(USERNAME_RULES); return; }
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
        Your login alias — you can sign in with this OR your email. {USERNAME_RULES}
      </p>
      {err ? <p className="mb-2 text-xs font-semibold text-red-700" role="alert">{err}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Username</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
