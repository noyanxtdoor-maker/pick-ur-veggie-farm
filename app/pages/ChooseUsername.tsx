// P1N (ported from Team B, 2026-07-17): post-approval username onboarding screen — game/bank-style.
// Owner directive (relayed via the ported commit): "once approved they will be taken to another
// screen where they will choose their own username, you know like in a game or banking apps
// whatever. once they decided their username they can now use the app."
//
// Reached via the RequireUsernameOnboarding router gate: an authenticated, approved user with
// public.users.username_chosen_at IS NULL is redirected here from every app route. One-time-only —
// set_chosen_username raises if already chosen, so re-entry after success is a no-op. Validation
// mirrors the server (^[a-z0-9_.]{3,30}$); the server is the real gate, this is UX + early feedback.
// After success, the user is sent to /dashboard.
import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {UserCircle2, Check, Sparkles} from 'lucide-react';
import {Button, Card} from '../components/ui';
import {Field, TextInput, zodResolver} from '../components/forms';
import {usernameOnboardingApi} from '../features/auth/onboarding';

const USERNAME_REGEX = /^[a-z0-9_.]{3,30}$/;
const schema = z.object({
  username: z.string()
    .trim()
    .toLowerCase()
    .min(3, 'At least 3 characters')
    .max(30, 'At most 30 characters')
    .regex(USERNAME_REGEX, 'Letters, numbers, dot, or underscore only'),
});
type Input = z.infer<typeof schema>;

const SUGGESTIONS = ['farm.hand', 'cashier.pro', 'field.team', 'harvest.crew', 'veggie.node'];

export default function ChooseUsername() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState(false);
  const {register, handleSubmit, watch, setValue, formState: {errors}} = useForm<Input>({resolver: zodResolver(schema)});
  const value = watch('username') ?? '';

  async function submit(v: Input) {
    setError(null); setTaken(false); setBusy(true);
    try {
      await usernameOnboardingApi.choose(v.username);
      // success → main app
      navigate('/dashboard', {replace: true});
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not set username';
      if (/taken|unique/i.test(msg)) setTaken(true);
      else setError(msg);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-farm-bg p-6">
      <Card className="w-full max-w-md">
        <div className="mb-2 flex items-center gap-2 text-2xl font-extrabold text-farm-green">
          <Sparkles aria-hidden /> Choose your username
        </div>
        <p className="mb-6 text-sm text-farm-muted">
          Your account is approved — welcome aboard. Pick a username you will sign in with from now on.
          You can change it later in Profile, but this is the one you will use day to day.
        </p>

        <form className="space-y-4" onSubmit={handleSubmit(submit)}>
          <Field label="Your username" error={errors.username?.message ?? (taken ? 'That username is taken — try another.' : undefined)}>
            <div className="relative">
              <UserCircle2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-farm-muted" aria-hidden />
              <TextInput
                {...register('username')}
                autoComplete="username"
                placeholder="e.g. maria.farm"
                className="pl-10"
                spellCheck={false}
                autoCapitalize="off"
              />
            </div>
          </Field>

          {value && USERNAME_REGEX.test(value) && !taken ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-farm-green">
              <Check className="h-4 w-4" aria-hidden /> "{value}" is valid.
            </p>
          ) : null}
          {error && !taken ? <p className="text-sm font-medium text-farm-danger" role="alert">{error}</p> : null}

          <Button type="submit" className="w-full" disabled={busy || !USERNAME_REGEX.test(value)}>
            {busy ? 'Saving…' : 'Start using the app'}
          </Button>
        </form>

        <div className="mt-6 border-t border-farm-accent-soft pt-4">
          <p className="mb-2 text-xs font-semibold uppercase text-farm-muted">Need inspiration?</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => {setValue('username', s, {shouldValidate: true}); setTaken(false);}}
                className="rounded-full border border-farm-accent-soft bg-farm-bg px-3 py-1 text-xs font-semibold text-farm-green hover:bg-farm-accent-soft">
                {s}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-farm-muted">3–30 characters: letters, numbers, dot, or underscore. Must be unique across the farm.</p>
        </div>
      </Card>
    </div>
  );
}
