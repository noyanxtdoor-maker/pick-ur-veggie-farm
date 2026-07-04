// Shared UI primitives (shadcn-style: Tailwind + owned components). Sized to M1B field tokens:
// primary target ≥ 56px (min-h-14), body ≥ 18px (text-lg), ≥ medium weight, high contrast (U2).
import type {ButtonHTMLAttributes, ReactNode} from 'react';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-farm-green text-white hover:bg-farm-green-700 focus-visible:ring-farm-green-500',
  secondary: 'bg-farm-bg text-farm-green border border-farm-accent hover:bg-farm-accent-soft focus-visible:ring-farm-accent',
  danger: 'bg-farm-danger text-white hover:bg-red-600 focus-visible:ring-red-400',
  ghost: 'bg-transparent text-farm-muted hover:bg-farm-accent-soft hover:text-farm-green focus-visible:ring-farm-accent',
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
  return <div className={cn('rounded-2xl border border-farm-accent-soft bg-farm-card p-5 shadow-sm', className)}>{children}</div>;
}

export function StatCard({label, value, hint}: {label: string; value: ReactNode; hint?: string}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-black uppercase tracking-wider text-farm-muted">{label}</span>
      <span className="tabular text-4xl font-black text-farm-ink">{value}</span>
      {hint ? <span className="text-base text-farm-muted">{hint}</span> : null}
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
        'flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border border-farm-accent bg-farm-accent-soft p-4',
        'text-lg font-bold text-farm-green transition-colors hover:bg-farm-accent/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-farm-green-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {icon ? <span className="text-farm-green">{icon}</span> : null}
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}

export function PageHeader({title, subtitle, action}: {title: string; subtitle?: string; action?: ReactNode}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-black text-farm-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-lg text-farm-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
