// Login / Create account / Forgot password (M1B §2 + P1A auth module). Email+password via Supabase Auth;
// self-signup creates an ERP identity that awaits approval (zero memberships, C2 §3); "Forgot password"
// emails a recovery link that lands on /auth/reset (B7 §2 self-service reset). Google OAuth is scaffolded —
// it works once the owner enables the provider (docs/28_Enterprise_Architecture_Audit/Phase_1_OAuth_Setup.md).
import {useState} from 'react';
import {Navigate} from 'react-router-dom';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {Sprout} from 'lucide-react';
import {useSession} from '../core/auth/session';
import {MOCK_MODE} from '../core/mock/mock';
import {Button, Card} from '../components/ui';
import {Field, TextInput, zodResolver} from '../components/forms';

type Mode = 'signin' | 'signup' | 'forgot';

const signinSchema = z.object({email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Required')});
// B7 §2: minimum length ≥12, passphrase-friendly (no forced symbol rules)
const signupSchema = z.object({
  displayName: z.string().min(2, 'Enter your name'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(12, 'At least 12 characters — a short sentence works well'),
});
const forgotSchema = z.object({email: z.string().email('Enter a valid email')});
type SigninInput = z.infer<typeof signinSchema>;
type SignupInput = z.infer<typeof signupSchema>;
type ForgotInput = z.infer<typeof forgotSchema>;

export default function Login() {
  const {signIn, signUp, resetPassword, signInWithGoogle, configured, status} = useSession();
  const [mode, setMode] = useState<Mode>('signin');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const si = useForm<SigninInput>({resolver: zodResolver(signinSchema)});
  const su = useForm<SignupInput>({resolver: zodResolver(signupSchema)});
  const fo = useForm<ForgotInput>({resolver: zodResolver(forgotSchema)});

  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

  const switchMode = (m: Mode) => {setMode(m); setError(null); setNotice(null);};

  return (
    <div className="flex min-h-screen items-center justify-center bg-farm-bg p-6">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2 text-2xl font-extrabold text-farm-green">
          <Sprout aria-hidden /> PickUrVeggie ERP
        </div>
        {MOCK_MODE ? (
          <p className="mb-4 rounded-lg bg-farm-accent-soft px-3 py-2 text-base text-farm-green">
            Demo mode — no cloud needed. Sign in with any email &amp; password to explore the app.
          </p>
        ) : !configured ? (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-900">
            Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
          </p>
        ) : null}
        {notice ? <p className="mb-4 rounded-lg bg-farm-accent-soft px-3 py-2 text-sm font-semibold text-farm-green" role="status">{notice}</p> : null}

        {mode === 'signin' ? (
          <form className="space-y-4" onSubmit={si.handleSubmit(async (v) => {
            setError(null);
            const res = await signIn(v.email, v.password);
            if (res.error) setError(res.error);
          })}>
            <Field label="Email" htmlFor="email" error={si.formState.errors.email?.message}>
              <TextInput id="email" type="email" autoComplete="username" {...si.register('email')} />
            </Field>
            <Field label="Password" htmlFor="password" error={si.formState.errors.password?.message}>
              <TextInput id="password" type="password" autoComplete="current-password" {...si.register('password')} />
            </Field>
            {error ? <p className="text-base font-medium text-red-700" role="alert">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={si.formState.isSubmitting || (!configured && !MOCK_MODE)}>Sign in</Button>
            {!MOCK_MODE ? (
              <Button type="button" variant="secondary" className="w-full" disabled={!configured}
                onClick={async () => {setError(null); const r = await signInWithGoogle(); if (r.error) setError(r.error.includes('not enabled') || r.error.includes('Unsupported') ? 'Google sign-in is not enabled yet — the owner can switch it on in the Supabase dashboard (see Phase_1_OAuth_Setup.md).' : r.error);}}>
                Continue with Google
              </Button>
            ) : null}
            <div className="flex justify-between text-sm">
              <button type="button" className="font-bold text-farm-green underline" onClick={() => switchMode('signup')}>Create account</button>
              <button type="button" className="text-farm-muted underline" onClick={() => switchMode('forgot')}>Forgot password?</button>
            </div>
          </form>
        ) : mode === 'signup' ? (
          <form className="space-y-4" onSubmit={su.handleSubmit(async (v) => {
            setError(null);
            const res = await signUp(v.email, v.password, v.displayName);
            if (res.error) {setError(res.error); return;}
            if (res.needsConfirmation) {
              switchMode('signin');
              setNotice('Almost there — confirm your email via the link we sent, then sign in. An admin will approve your access.');
            } else {
              setNotice('Account created. An admin will approve your access shortly.');
            }
          })}>
            <p className="rounded-lg bg-farm-accent-soft/60 px-3 py-2 text-xs font-semibold text-farm-green">
              After signing up, an admin reviews and approves your access — you will not see farm data until then.
            </p>
            <Field label="Your name" htmlFor="su-name" error={su.formState.errors.displayName?.message}>
              <TextInput id="su-name" autoComplete="name" {...su.register('displayName')} />
            </Field>
            <Field label="Email" htmlFor="su-email" error={su.formState.errors.email?.message}>
              <TextInput id="su-email" type="email" autoComplete="username" {...su.register('email')} />
            </Field>
            <Field label="Password" htmlFor="su-password" error={su.formState.errors.password?.message}>
              <TextInput id="su-password" type="password" autoComplete="new-password" {...su.register('password')} />
            </Field>
            {error ? <p className="text-base font-medium text-red-700" role="alert">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={su.formState.isSubmitting || (!configured && !MOCK_MODE)}>Create account</Button>
            <button type="button" className="w-full text-sm text-farm-muted underline" onClick={() => switchMode('signin')}>Back to sign in</button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={fo.handleSubmit(async (v) => {
            setError(null);
            const res = await resetPassword(v.email);
            if (res.error) {setError(res.error); return;}
            switchMode('signin');
            setNotice('Check your email for the reset link — it opens a page where you set a new password.');
          })}>
            <p className="text-sm text-farm-muted">Enter your account email and we will send a password-reset link.</p>
            <Field label="Email" htmlFor="fo-email" error={fo.formState.errors.email?.message}>
              <TextInput id="fo-email" type="email" autoComplete="username" {...fo.register('email')} />
            </Field>
            {error ? <p className="text-base font-medium text-red-700" role="alert">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={fo.formState.isSubmitting || (!configured && !MOCK_MODE)}>Send reset link</Button>
            <button type="button" className="w-full text-sm text-farm-muted underline" onClick={() => switchMode('signin')}>Back to sign in</button>
          </form>
        )}
      </Card>
    </div>
  );
}
