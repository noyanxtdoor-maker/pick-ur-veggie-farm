// Global state surfaces (M1C §4): loading / empty / error / offline + status & sync badges + toasts + boundary.
import {Component, createContext, useCallback, useContext, useMemo, useState, type ReactNode, type ErrorInfo} from 'react';
import {AlertTriangle, CloudOff, Inbox, Loader2, RefreshCw} from 'lucide-react';
import {cn} from './ui';

export function Loading({label = 'Loading…'}: {label?: string}) {
  return (
    <div className="flex items-center gap-3 p-8 text-lg text-slate-600" role="status" aria-live="polite">
      <Loader2 className="animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function Skeleton({rows = 4}: {rows?: number}) {
  return (
    <div className="space-y-3 p-4" aria-hidden>
      {Array.from({length: rows}).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  );
}

export function EmptyState({title, hint, action}: {title: string; hint?: string; action?: ReactNode}) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center">
      <Inbox className="text-slate-400" size={40} aria-hidden />
      <p className="text-xl font-semibold text-slate-700">{title}</p>
      {hint ? <p className="max-w-md text-base text-slate-500">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({message, onRetry}: {message: string; onRetry?: () => void}) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center" role="alert">
      <AlertTriangle className="text-red-500" size={40} aria-hidden />
      <p className="text-xl font-semibold text-slate-800">Something went wrong</p>
      <p className="max-w-md text-base text-slate-600">{message}</p>
      {onRetry ? (
        <button onClick={onRetry} className="inline-flex min-h-14 items-center gap-2 rounded-xl border border-slate-300 px-5 text-lg font-semibold">
          <RefreshCw size={18} aria-hidden /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function OfflineBanner({pending}: {pending: number}) {
  return (
    <div className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-base font-medium text-amber-900" role="status">
      <CloudOff size={18} aria-hidden />
      Working offline — {pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} will sync when you reconnect.` : 'reads come from your device cache.'}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  Active: 'bg-emerald-100 text-emerald-900',
  Accepted: 'bg-emerald-100 text-emerald-900',
  Pending: 'bg-blue-100 text-blue-900',
  Suspended: 'bg-amber-100 text-amber-900',
  Archived: 'bg-slate-200 text-slate-700',
  Deprecated: 'bg-slate-200 text-slate-700',
  Expired: 'bg-red-100 text-red-900',
  Revoked: 'bg-red-100 text-red-900',
};

export function StatusBadge({status}: {status: string}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold', STATUS_COLOR[status] ?? 'bg-slate-100 text-slate-700')}>
      <span className="h-2 w-2 rounded-full bg-current opacity-70" aria-hidden />
      {status}
    </span>
  );
}

export function SyncBadge({state}: {state: 'Pending' | 'Uploading' | 'Completed' | 'Failed' | 'Blocked'}) {
  const map: Record<string, string> = {
    Pending: 'bg-blue-100 text-blue-900',
    Uploading: 'bg-blue-100 text-blue-900',
    Completed: 'bg-emerald-100 text-emerald-900',
    Failed: 'bg-amber-100 text-amber-900',
    Blocked: 'bg-red-100 text-red-900',
  };
  return <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', map[state])}>{state}</span>;
}

// ── Toast ──────────────────────────────────────────────────────────────────
interface Toast {id: string; message: string; kind: 'success' | 'error'}
const ToastCtx = createContext<{notify: (message: string, kind?: 'success' | 'error') => void} | null>(null);

export function ToastProvider({children}: {children: ReactNode}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, {id, message, kind}]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const value = useMemo(() => ({notify}), [notify]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn('rounded-xl px-4 py-3 text-base font-semibold text-white shadow-lg', t.kind === 'success' ? 'bg-emerald-700' : 'bg-red-700')} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast must be used within <ToastProvider>');
  return v;
}

// ── Error boundary ───────────────────────────────────────────────────────────
interface BoundaryState {
  error: Error | null;
}
export class ErrorBoundary extends Component<{children: ReactNode}, BoundaryState> {
  override state: BoundaryState = {error: null};
  static getDerivedStateFromError(error: Error): BoundaryState {
    return {error};
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error boundary:', error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return <ErrorState message={this.state.error.message} onRetry={() => this.setState({error: null})} />;
    }
    return this.props.children;
  }
}
