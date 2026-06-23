// Shared UI primitives (shadcn-style: Tailwind + owned components). Sized to M1B field tokens:
// primary target ≥ 56px (min-h-14), body ≥ 18px (text-lg), ≥ medium weight, high contrast (U2).
import type {ButtonHTMLAttributes, ReactNode} from 'react';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:ring-emerald-600',
  secondary: 'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 focus-visible:ring-red-600',
  ghost: 'bg-transparent text-slate-800 hover:bg-slate-100 focus-visible:ring-slate-400',
};

export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: {variant?: Variant} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex min-h-14 items-center justify-center gap-2 rounded-xl px-5 text-lg font-semibold',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Card({className, children}: {className?: string; children: ReactNode}) {
  return <div className={cn('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm', className)}>{children}</div>;
}

export function StatCard({label, value, hint}: {label: string; value: ReactNode; hint?: string}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-4xl font-bold text-slate-900">{value}</span>
      {hint ? <span className="text-base text-slate-600">{hint}</span> : null}
    </Card>
  );
}

export function ActionTile({
  label,
  icon,
  onClick,
  disabled,
}: {label: string; icon?: ReactNode; onClick?: () => void; disabled?: boolean}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4',
        'text-lg font-semibold text-emerald-900 transition-colors hover:bg-emerald-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {icon ? <span className="text-emerald-700">{icon}</span> : null}
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}

export function PageHeader({title, subtitle, action}: {title: string; subtitle?: string; action?: ReactNode}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-lg text-slate-600">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
