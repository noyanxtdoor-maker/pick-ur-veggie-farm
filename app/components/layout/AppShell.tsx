// Application shell in the AI Studio prototype's design language (owner decision 2026-06-28: the prototype is the
// visual authority). White sidebar with PV logo + section labels + profile block; header with BRANCH LIVE chip,
// session pill, red sign-out; farm-bg main stage. Tablet-first, ≥56px targets preserved.
import {Suspense} from 'react';
import {NavLink, Outlet} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {
  Activity,
  BarChart3,
  CalendarDays,
  ClipboardList,
  CloudOff,
  Contact,
  FolderKanban,
  Landmark,
  LogOut,
  Package,
  Users2,
  RefreshCw,
  Settings,
  ShoppingCart,
  Sparkles,
  Sprout,
  UserCheck,
  Wifi,
} from 'lucide-react';
import {useSync} from '../../core/offline/sync';
import {usePermissions} from '../../core/permissions/permissions';
import {useSession} from '../../core/auth/session';
import {usePref} from '../../core/prefs/prefs';
import {offlineDB} from '../../core/offline/db';
import type {PermissionKey} from '../../types/db';
import {Loading, OfflineBanner} from '../feedback';
import {cn} from '../ui';

const CORE_MODULES = [
  {to: '/dashboard', label: 'Home Dashboard', icon: Activity},
  {to: '/pos', label: 'Weigh Point-Of-Sale', icon: ShoppingCart},
  {to: '/inventory', label: 'Stock Inventories', icon: Package},
  {to: '/accounting', label: 'Automated Accounting', icon: Landmark},
  {to: '/customers', label: 'Customers & Credit', icon: Contact},
  {to: '/payroll', label: 'Salaries & Payroll', icon: Users2},
  {to: '/schedules', label: 'Schedules & Plans', icon: CalendarDays},
  {to: '/projects', label: 'Project Checklists', icon: FolderKanban},
  {to: '/crops', label: 'Crops & Plans', icon: Sprout},
  {to: '/operations', label: 'Operations', icon: ClipboardList},
  {to: '/reports', label: 'Reports', icon: BarChart3},
  {to: '/settings', label: 'Settings Hub', icon: Settings},
] as const;

function navClass(isActive: boolean): string {
  return cn(
    'flex min-h-12 w-full items-center gap-2.5 rounded-xl p-3 text-left text-sm font-bold transition-colors select-none',
    isActive
      ? 'border border-farm-accent/40 bg-farm-accent-soft text-farm-green shadow-sm'
      : 'text-farm-muted hover:bg-farm-bg/60 hover:text-farm-green',
  );
}

function NavRail() {
  const {user} = useSession();
  const name = (user?.email ?? 'operator').split('@')[0] ?? 'operator';
  return (
    <aside className="hidden w-64 flex-col justify-between border-r border-farm-accent-soft bg-white p-5 md:flex">
      <div className="space-y-5">
        <div className="flex items-center gap-3 border-b border-farm-accent-soft pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-farm-green text-sm font-black text-white shadow-sm">PV</div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-farm-ink">PickUrVeggie</h1>
            <p className="mt-0.5 text-[10px] font-bold uppercase leading-none tracking-wider text-farm-green">ERP Suite</p>
          </div>
        </div>
        <nav className="space-y-1.5" aria-label="Main">
          <span className="block border-b border-farm-bg px-3 pb-1 text-[10px] font-black uppercase tracking-wider text-farm-muted">Core Operational Features</span>
          {CORE_MODULES.map((m) => {
            const Icon = m.icon;
            return (
              <NavLink key={m.to} to={m.to} className={({isActive}) => navClass(isActive)}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden /> {m.label}
              </NavLink>
            );
          })}
          <span className="block border-b border-farm-bg px-3 pb-1 pt-4 text-[10px] font-black uppercase tracking-wider text-farm-muted">User Administration</span>
          <NavLink to="/organization" className={({isActive}) => navClass(isActive)}>
            <UserCheck className="h-4 w-4 shrink-0" aria-hidden /> Approvals &amp; Roles
          </NavLink>
        </nav>
      </div>
      <div className="space-y-3 border-t border-farm-accent-soft pt-4">
        <div className="flex items-center gap-3 p-1">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-farm-green text-xs font-extrabold uppercase text-white shadow-sm">{name.slice(0, 2)}</div>
          <div className="min-w-0">
            <p className="truncate text-xs font-black text-farm-ink">{name}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase leading-none tracking-widest text-farm-green">Farm Access</p>
          </div>
        </div>
        <div className="space-y-1 border-t border-farm-accent-soft/50 pt-2 text-center text-[10px] text-farm-muted">
          <div className="flex items-center justify-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-farm-green" aria-hidden />
            <span className="font-bold">Offline Local Mode</span>
          </div>
          <p className="font-semibold leading-relaxed">Stored on local device index until synchronized.</p>
        </div>
      </div>
    </aside>
  );
}

function TopBar() {
  const {online, pending, syncing, triggerSync} = useSync();
  const {companyId} = usePermissions();
  const {signOut} = useSession();
  const [farmName] = usePref('farm_display_name');
  const [terminalId] = usePref('terminal_id', 'Terminal A — Main Gate');
  const company = useLiveQuery(async () => (companyId ? offlineDB.companies.get(companyId) : undefined), [companyId]);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-farm-accent-soft bg-white px-4 py-3 md:px-6">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-black leading-tight text-farm-ink md:text-lg">
          <span>{farmName || company?.name || 'PickUrVeggie'}</span>
          <span className="whitespace-nowrap rounded-full border border-farm-accent/40 bg-farm-accent-soft px-1.5 py-0.5 text-[9px] font-bold text-farm-green">
            {online ? 'BRANCH LIVE' : 'OFFLINE MODE'}
          </span>
        </h2>
        <p className="hidden text-xs text-farm-muted md:block">PickUrVeggie Regional Enterprise Platform {online ? '(Synchronized)' : '(Local)'}</p>
      </div>
      <div className="flex items-center gap-2 text-xs md:gap-3">
        <button
          onClick={triggerSync}
          className={cn('inline-flex min-h-12 items-center gap-2 rounded-xl border border-farm-accent-soft bg-farm-bg px-3 font-semibold', online ? 'text-farm-green' : 'text-farm-warn')}
          title={online ? 'Online — tap to sync' : 'Offline'}
        >
          {online ? <Wifi size={18} aria-hidden /> : <CloudOff size={18} aria-hidden />}
          {syncing ? <RefreshCw size={16} className="animate-spin" aria-hidden /> : null}
          {pending > 0 ? <span className="rounded-full bg-amber-200 px-2 text-amber-900">{pending}</span> : null}
        </button>
        <div className="hidden min-h-12 items-center gap-2 rounded-xl border border-farm-accent-soft bg-farm-bg px-3 font-semibold text-farm-ink md:inline-flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-farm-green" aria-hidden />
          <span>Station: <strong className="font-mono text-farm-green">{terminalId}</strong></span>
        </div>
        <button
          onClick={() => void signOut()}
          className="inline-flex min-h-12 items-center gap-1.5 rounded-xl bg-red-500 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-600"
        >
          <LogOut size={16} aria-hidden /> <span>Sign Out</span>
        </button>
      </div>
    </header>
  );
}

export function AppShell() {
  const {online, pending} = useSync();
  return (
    <div className="flex h-screen bg-farm-bg text-farm-ink">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        {!online ? <OfflineBanner pending={pending} /> : null}
        <main className="flex-1 overflow-auto p-4 md:p-8">
          <div className="mx-auto w-full max-w-7xl animate-fade-in">
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

const ORG_TABS: Array<{to: string; label: string; perm?: PermissionKey}> = [
  {to: '/organization/company', label: 'Company'},
  {to: '/organization/branches', label: 'Branches'},
  {to: '/organization/roles', label: 'Roles'},
  {to: '/organization/invitations', label: 'Invitations', perm: 'user.invite'},
  {to: '/organization/members', label: 'Members', perm: 'membership.read'},
];

export function OrganizationLayout() {
  const {has} = usePermissions();
  const tabs = ORG_TABS.filter((t) => !t.perm || has(t.perm));
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2 border-b border-farm-accent-soft pb-2" role="tablist" aria-label="Organization">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({isActive}) =>
              cn('min-h-12 rounded-xl px-4 py-2 text-lg font-bold', isActive ? 'bg-farm-green text-white' : 'bg-white text-farm-muted hover:bg-farm-accent-soft hover:text-farm-green')
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
