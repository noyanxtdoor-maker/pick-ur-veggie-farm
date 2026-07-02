// Login (M1B §2). Email + password via Supabase Auth. Offline/unconfigured states are explicit.
import {useState} from 'react';
import {Navigate} from 'react-router-dom';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {Sprout} from 'lucide-react';
import {useSession} from '../core/auth/session';
import {MOCK_MODE} from '../core/mock/mock';
import {Button, Card} from '../components/ui';
import {Field, TextInput, zodResolver} from '../components/forms';

const schema = z.object({email: z.string().email('Enter a valid email'), password: z.string().min(1, 'Required')});
type LoginInput = z.infer<typeof schema>;

export default function Login() {
  const {signIn, configured, status} = useSession();
  const [error, setError] = useState<string | null>(null);
  const {register, handleSubmit, formState: {errors, isSubmitting}} = useForm<LoginInput>({resolver: zodResolver(schema)});

  // Already signed in (or just signed in) → straight to the app.
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

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
        <form
          className="space-y-4"
          onSubmit={handleSubmit(async (v) => {
            setError(null);
            const res = await signIn(v.email, v.password);
            if (res.error) setError(res.error);
          })}
        >
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <TextInput id="email" type="email" autoComplete="username" {...register('email')} />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password?.message}>
            <TextInput id="password" type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          {error ? <p className="text-base font-medium text-red-700" role="alert">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={isSubmitting || (!configured && !MOCK_MODE)}>Sign in</Button>
        </form>
      </Card>
    </div>
  );
}
