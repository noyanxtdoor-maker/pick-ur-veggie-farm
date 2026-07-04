// Form primitives (M1B §6): Zod↔RHF resolver (hand-written — no extra dep), labelled Field, and ReadOnlyField
// for immutable identifiers (shows the lock so immutability is visible, not a surprise error — M1C §6).
import {forwardRef, type InputHTMLAttributes, type ReactNode} from 'react';
import {Lock} from 'lucide-react';
import type {Resolver} from 'react-hook-form';
import type {ZodType} from 'zod';
import {cn} from './ui';

// Minimal RHF resolver backed by Zod (B5 §5 provisional validation reuses the same schema).
export function zodResolver<T extends Record<string, unknown>>(schema: ZodType<T>): Resolver<T> {
  return (async (values: T) => {
    const result = schema.safeParse(values);
    if (result.success) return {values: result.data, errors: {}};
    const errors: Record<string, {type: string; message: string}> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !errors[key]) {
        errors[key] = {type: String(issue.code), message: issue.message};
      }
    }
    return {values: {} as T, errors};
  }) as unknown as Resolver<T>;
}

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-base font-semibold text-farm-ink">
        {label}
      </label>
      {children}
      {error ? <span className="text-base font-medium text-red-700" role="alert">{error}</span> : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({className, ...rest}, ref) {
    return (
      <input
        ref={ref}
        {...rest}
        className={cn(
          'min-h-14 w-full rounded-xl border border-farm-accent bg-farm-card px-4 text-lg text-farm-ink',
          'placeholder:text-farm-muted focus:outline-none focus:ring-2 focus:ring-farm-green-500',
          className,
        )}
      />
    );
  },
);

export function ReadOnlyField({label, value, note}: {label: string; value: string; note?: string}) {
  return (
    <Field label={label}>
      <div className="flex min-h-14 items-center justify-between rounded-xl border border-farm-accent-soft bg-farm-bg px-4 text-lg text-farm-muted">
        <span>{value}</span>
        <span className="flex items-center gap-1.5 text-sm text-farm-muted" title={note ?? 'Set at creation — cannot be changed'}>
          <Lock size={16} aria-hidden /> {note ?? 'Locked'}
        </span>
      </div>
    </Field>
  );
}
