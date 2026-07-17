// Login / Create POS Account (P1A/P1B; redesigned 2026-07-13 to the owner's mobile/tablet/laptop mockups —
// dark theme, tractor-field hero image, stacked on phone/tablet, split 50/50 on laptop+). Signup no longer
// carries a requested role (owner: redundant — the approver always assigns the real one, C2 §3). Email or
// username accepted at sign-in (see the "EMAIL / USERNAME" label): only email actually authenticates today
// (Supabase Auth has no native username login) — true username resolution is a separate, deliberately
// deferred decision (it would need the app's first-ever anon-reachable RPC, a real change to the "zero
// anon grants" security posture this project tests for). The field accepts either shape now so the UI
// already matches the design; typing a bare username currently surfaces the same "invalid credentials" a
// wrong password would. Email+password via Supabase Auth; self-service reset (B7 §2) + Google OAuth.
// Quick test identities appear in DEMO mode only.
import {useEffect, useState} from 'react';
import {Navigate} from 'react-router-dom';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {Eye, EyeOff, User as UserIcon} from 'lucide-react';
import {useSession} from '../core/auth/session';
import {MOCK_MODE} from '../core/mock/mock';
import {consumeAuthRedirectError} from '../core/supabase/client';
import {Button} from '../components/ui';
import {zodResolver} from '../components/forms';

type Tab = 'signin' | 'signup';

// Email OR username — see the file header on why only email authenticates for now.
const signinSchema = z.object({identifier: z.string().min(1, 'Enter your email or username'), password: z.string().min(1, 'Required')});
// B7 §2: minimum length ≥12, passphrase-friendly (no forced symbol rules)
// P1N (ported from Team B, 2026-07-17): sign-up collects email + password ONLY — no name field.
// The owner picks their own username on the post-approval ChooseUsername onboarding screen instead.
const signupSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(12, 'At least 12 characters — a short sentence works well'),
});
const forgotSchema = z.object({email: z.string().email('Enter a valid email')});
type SigninInput = z.infer<typeof signinSchema>;
type SignupInput = z.infer<typeof signupSchema>;
type ForgotInput = z.infer<typeof forgotSchema>;

const QUICK_IDENTITIES = [
  {name: 'dev', sub: 'DEVELOPER', badge: 'D'},
  {name: 'owner', sub: 'FARM OWNER', badge: 'O'},
  {name: 'admin', sub: 'ADMINISTRATOR', badge: 'A'},
  {name: 'employee', sub: 'POS CASHIER', badge: 'E'},
];

const darkInputCls = 'min-h-12 w-full rounded-xl border border-white/10 bg-white/5 pl-11 pr-11 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-400/40';
const darkLabelCls = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-white/50';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.6l-6.5-5.5C29.6 34.7 26.9 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.3 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.7l6.5 5.5C41.5 36 44 30.5 44 24c0-1.3-.1-2.7-.4-3.5z" />
    </svg>
  );
}

export default function Login() {
  const {signIn, signUp, resetPassword, signInWithGoogle, configured, status} = useSession();
  const [tab, setTab] = useState<Tab>('signin');
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [showSuPw, setShowSuPw] = useState(false);

  const si = useForm<SigninInput>({resolver: zodResolver(signinSchema)});
  const su = useForm<SignupInput>({resolver: zodResolver(signupSchema)});
  const fo = useForm<ForgotInput>({resolver: zodResolver(forgotSchema)});

  // Surface a failed OAuth/redirect-auth round trip (bad/unwhitelisted redirect URL, provider error, a
  // stale or reused link). Supabase encodes the failure as error/error_description on the callback URL,
  // and nothing previously read it, so the browser just landed back here with no session and no
  // explanation ("just refreshes and doesn't let me in"). The value is captured in client.ts at module
  // load — synchronously, before createClient()'s own async URL detection consumes/strips the hash —
  // since a mount-time effect here always lost that race (empirically confirmed: the hash read empty by
  // the time this component's own effect ran).
  useEffect(() => {
    const captured = consumeAuthRedirectError();
    if (captured) {
      setError(captured);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

  const switchTab = (t: Tab) => {setTab(t); setForgot(false); setError(null); setNotice(null);};

  return (
    <div className="flex min-h-screen flex-col bg-[#0c0c0c] lg:flex-row">
      {/* Hero — tractor/field photo. Swap in a real photo at public/login-hero.jpg; this gradient is the
          fallback background (shows through until/unless that file exists). */}
      <div
        className="relative h-[42vh] shrink-0 bg-cover bg-center sm:h-[46vh] lg:h-auto lg:w-1/2"
        style={{backgroundImage: "url('/login-hero.jpg'), linear-gradient(160deg, #f5d98a 0%, #8fae5c 45%, #2f4d2f 100%)"}}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c0c] via-black/10 to-transparent lg:bg-gradient-to-r lg:from-transparent lg:via-transparent lg:to-[#0c0c0c]" />
      </div>

      {/* Auth panel */}
      <div className="relative -mt-8 flex flex-1 flex-col rounded-t-[2rem] bg-[#121212] px-6 pb-8 pt-8 sm:px-10 sm:pt-10 lg:mt-0 lg:w-1/2 lg:rounded-none lg:justify-center lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <span className="text-2xl" aria-hidden>🚜</span>
            <h1 className="text-2xl font-extrabold text-white">Pick Ur Veggie <span className="text-emerald-400">Farm</span></h1>
          </div>

          <div className="mb-6 flex gap-6 border-b border-white/10 text-sm font-bold uppercase tracking-wider">
            <button onClick={() => switchTab('signin')} className={tab === 'signin' ? 'border-b-2 border-emerald-400 pb-3 text-white' : 'pb-3 text-white/40 hover:text-white/70'}>Sign In</button>
            <button onClick={() => switchTab('signup')} className={tab === 'signup' ? 'border-b-2 border-emerald-400 pb-3 text-white' : 'pb-3 text-white/40 hover:text-white/70'}>Create POS Account</button>
          </div>

          {MOCK_MODE ? (
            <p className="mb-4 rounded-lg bg-emerald-400/10 px-3 py-2 text-sm text-emerald-300">
              Demo mode — no cloud needed. Sign in with any email &amp; password to explore the app.
            </p>
          ) : !configured ? (
            <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
            </p>
          ) : null}
          {notice ? <p className="mb-4 rounded-lg bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-300" role="status">{notice}</p> : null}

          {tab === 'signin' && !forgot ? (
            <form className="space-y-4" onSubmit={si.handleSubmit(async (v) => {
              setError(null);
              const res = await signIn(v.identifier, v.password);
              if (res.error) setError(res.error);
            })}>
              <div>
                <label className={darkLabelCls} htmlFor="identifier">Email / Username</label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" aria-hidden />
                  <input id="identifier" autoComplete="username" className={darkInputCls} {...si.register('identifier')} />
                </div>
                {si.formState.errors.identifier ? <p className="mt-1 text-xs text-red-400">{si.formState.errors.identifier.message}</p> : null}
              </div>
              <div>
                <label className={darkLabelCls} htmlFor="password">Password</label>
                <div className="relative">
                  <input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" className={darkInputCls} {...si.register('password')} />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60" aria-label={showPw ? 'Hide password' : 'Show password'}>
                    {showPw ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
                {si.formState.errors.password ? <p className="mt-1 text-xs text-red-400">{si.formState.errors.password.message}</p> : null}
                <button type="button" className="mt-1.5 block text-right text-xs font-semibold text-emerald-400 hover:text-emerald-300" onClick={() => {setForgot(true); setError(null); setNotice(null);}}>Forgot Password?</button>
              </div>
              {error ? <p className="text-sm font-medium text-red-400" role="alert">{error}</p> : null}
              <Button type="submit" className="w-full !bg-emerald-400 !text-[#0c0c0c] hover:!opacity-90" disabled={si.formState.isSubmitting || (!configured && !MOCK_MODE)}>Sign In</Button>
              {!MOCK_MODE ? (
                <button type="button" disabled={!configured}
                  className="flex w-full min-h-12 items-center justify-center gap-2.5 rounded-xl bg-white text-sm font-bold text-[#1f1f1f] hover:bg-white/90 disabled:opacity-50"
                  onClick={async () => {setError(null); const r = await signInWithGoogle(); if (r.error) setError(r.error.includes('not enabled') || r.error.includes('Unsupported') ? 'Google sign-in is not enabled yet — the owner switches it on in the Supabase dashboard (Phase_1_OAuth_Setup.md).' : r.error);}}>
                  <GoogleIcon /> Continue with Google
                </button>
              ) : null}
            </form>
          ) : tab === 'signin' && forgot ? (
            <form className="space-y-4" onSubmit={fo.handleSubmit(async (v) => {
              setError(null);
              const res = await resetPassword(v.email);
              if (res.error) {setError(res.error); return;}
              setForgot(false);
              setNotice('Check your email for the reset link — it opens a page where you set a new password.');
            })}>
              <p className="text-sm text-white/50">Enter your account email and we will send a password-reset link.</p>
              <div>
                <label className={darkLabelCls} htmlFor="fo-email">Email</label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" aria-hidden />
                  <input id="fo-email" type="email" autoComplete="username" className={darkInputCls} {...fo.register('email')} />
                </div>
                {fo.formState.errors.email ? <p className="mt-1 text-xs text-red-400">{fo.formState.errors.email.message}</p> : null}
              </div>
              {error ? <p className="text-sm font-medium text-red-400" role="alert">{error}</p> : null}
              <Button type="submit" className="w-full !bg-emerald-400 !text-[#0c0c0c] hover:!opacity-90" disabled={fo.formState.isSubmitting || (!configured && !MOCK_MODE)}>Send reset link</Button>
              <button type="button" className="w-full text-sm text-white/50 underline" onClick={() => setForgot(false)}>Back to sign in</button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={su.handleSubmit(async (v) => {
              setError(null);
              const res = await signUp(v.email, v.password, '');
              if (res.error) {setError(res.error); return;}
              switchTab('signin');
              setNotice(res.needsConfirmation
                ? 'Almost there — confirm your email via the link we sent, then sign in. An admin will approve your access.'
                : 'Account created. An admin will approve your access shortly.');
            })}>
              <div>
                <label className={darkLabelCls} htmlFor="su-email">Email</label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" aria-hidden />
                  <input id="su-email" type="email" autoComplete="username" className={darkInputCls} {...su.register('email')} />
                </div>
                {su.formState.errors.email ? <p className="mt-1 text-xs text-red-400">{su.formState.errors.email.message}</p> : null}
              </div>
              <div>
                <label className={darkLabelCls} htmlFor="su-password">Password</label>
                <div className="relative">
                  <input id="su-password" type={showSuPw ? 'text' : 'password'} autoComplete="new-password" className={darkInputCls} {...su.register('password')} />
                  <button type="button" onClick={() => setShowSuPw((v) => !v)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60" aria-label={showSuPw ? 'Hide password' : 'Show password'}>
                    {showSuPw ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
                {su.formState.errors.password ? <p className="mt-1 text-xs text-red-400">{su.formState.errors.password.message}</p> : null}
              </div>
              <p className="text-[11px] text-white/40">*Note: a manager reviews every new account and assigns what it can access before it works.</p>
              {error ? <p className="text-sm font-medium text-red-400" role="alert">{error}</p> : null}
              <Button type="submit" className="w-full !bg-emerald-400 !text-[#0c0c0c] hover:!opacity-90" disabled={su.formState.isSubmitting || (!configured && !MOCK_MODE)}>Register POS Account</Button>
              {!MOCK_MODE ? (
                <button type="button" disabled={!configured}
                  className="flex w-full min-h-12 items-center justify-center gap-2.5 rounded-xl bg-white text-sm font-bold text-[#1f1f1f] hover:bg-white/90 disabled:opacity-50"
                  onClick={async () => {setError(null); const r = await signInWithGoogle(); if (r.error) setError(r.error.includes('not enabled') || r.error.includes('Unsupported') ? 'Google sign-in is not enabled yet — the owner switches it on in the Supabase dashboard (Phase_1_OAuth_Setup.md).' : r.error);}}>
                  <GoogleIcon /> Continue with Google
                </button>
              ) : null}
            </form>
          )}

          {/* Quick test identities — DEMO MODE ONLY (any credentials work there) */}
          {MOCK_MODE ? (
            <div className="mt-6 border-t border-white/10 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-white/40">Quick test identities:</span>
                <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-emerald-300">Offline seeding</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_IDENTITIES.map((q) => (
                  <button key={q.name} onClick={async () => {setError(null); await signIn(`${q.name}@demo.local`, 'demo');}}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left hover:border-emerald-400/50">
                    <span>
                      <span className="block text-sm font-bold text-white">{q.name}</span>
                      <span className="block text-[9px] font-black uppercase tracking-wider text-white/40">{q.sub}</span>
                    </span>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-[10px] font-black text-[#0c0c0c]">{q.badge}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs font-bold text-emerald-400">
            <span aria-hidden>🚜</span> Cloud Sync Active
          </p>
          <p className="mt-1 text-center text-[10px] text-white/30">v1.2.4-stable | FarmOps Infrastructure</p>
        </div>
      </div>
    </div>
  );
}
