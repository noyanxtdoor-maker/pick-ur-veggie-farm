// Set a new password (P1 self-service reset, B7 §2). The emailed recovery link lands here — supabase-js
// picks the recovery token out of the URL and establishes a temporary session, so updateUser() works.
// Without that session (link expired / opened cold) we say so instead of failing silently.
import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {KeyRound} from 'lucide-react';
import {useSession} from '../core/auth/session';
import {Button, Card} from '../components/ui';
import {Field, TextInput, zodResolver} from '../components/forms';

const schema = z.object({
  password: z.string().min(12, 'At least 12 characters — a short sentence works well'),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, {message: 'Passwords do not match', path: ['confirm']});
type Input = z.infer<typeof schema>;

export default function ResetPassword() {
  const {updatePassword, status} = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {register, handleSubmit, formState: {errors, isSubmitting}} = useForm<Input>({resolver: zodResolver(schema)});
  // PKCE (2026-07-17 Google-OAuth-bug fix) ties the recovery code to the browser that requested it —
  // opening the emailed link on a different device/browser leaves `?code=` unconsumed in the URL with no
  // session ever materializing, which looks identical to a dead link unless we check for it explicitly.
  const wrongDevice = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('code');

  return (
    <div className="flex min-h-screen items-center justify-center bg-farm-bg p-6">
      <Card className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2 text-2xl font-extrabold text-farm-green">
          <KeyRound aria-hidden /> Set a new password
        </div>
        {done ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-farm-accent-soft px-3 py-2 text-sm font-semibold text-farm-green" role="status">
              Password updated. Sign in with it from now on.
            </p>
            <Button className="w-full" onClick={() => void navigate('/login')}>Go to sign in</Button>
          </div>
        ) : (
          <>
            {status !== 'authenticated' ? (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {wrongDevice
                  ? 'This reset link only works in the same browser/device you requested it from. Open the email and tap the link there, or request a fresh one from the sign-in page on this device.'
                  : 'This page works via the link in your reset email. If you landed here without one (or the link expired), request a fresh link from the sign-in page.'}
              </p>
            ) : null}
            <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
              setError(null);
              const res = await updatePassword(v.password);
              if (res.error) {setError(res.error); return;}
              setDone(true);
            })}>
              <Field label="New password" htmlFor="rp-password" error={errors.password?.message}>
                <TextInput id="rp-password" type="password" autoComplete="new-password" {...register('password')} />
              </Field>
              <Field label="Repeat it" htmlFor="rp-confirm" error={errors.confirm?.message}>
                <TextInput id="rp-confirm" type="password" autoComplete="new-password" {...register('confirm')} />
              </Field>
              {error ? <p className="text-base font-medium text-red-700" role="alert">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={isSubmitting || status !== 'authenticated'}>Save new password</Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
