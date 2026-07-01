// Tablet-first shell (M1B U1): persistent LEFT navigation rail (no bottom nav), top bar with the
// offline/sync indicator + user menu, and a permission-aware Organization sub-navigation.
import {Suspense} from 'react';
import {NavLink, Outlet} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {
  BarChart3,
  Building2,
  ClipboardList,
  CloudOff,
  LayoutDashboard,
  LogOut,
  Package,
  RefreshCw,
  Settings,
  ShoppingCart,
  Sprout,
  Wifi,
} from 'lucide-react';
import {useSync} from '../../core/offline/sync';
import {usePermissions} from '../../core/permissions/permissions';
import {useSession} from '../../core/auth/session';
import {offlineDB} from '../../core/offline/db';
import type {PermissionKey} from '../../types/db';
import {Loading, OfflineBanner} from '../feedback';
import {cn} from '../ui';

const MODULES = [
  {to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard},
  {to: '/pos', label: 'Weigh POS', icon: ShoppingCart},
  {to: '/organization', label: 'Organization', icon: Building2},
  {to: '/crops', label: 'Crops', icon: Sprout},
  {to: '/inventory', label: 'Inventory', icon: Package},
  {to: '/operations', label: 'Operations', icon: ClipboardList},
  {to: '/reports', label: 'Reports', icon: BarChart3},
  {to: '/settings', label: 'Settings', icon: Settings},
] as const;

function NavRail() {
  return (
    <nav aria-label="Main" className="flex w-44 flex-col gap-1 border-r border-slate-200 bg-white p-2">
      <div className="px-3 py-4 text-lg font-extrabold tracking-tight text-emerald-800">PickUrVeggie</div>
      {MODULES.map((m) => {
        const Icon = m.icon;
        return (
          <NavLink
            key={m.to}
            to={m.to}
            className={({isActive}) =>
              cn(
                'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-2 text-sm font-semibold',
                isActive ? 'bg-emerald-100 text-emerald-900' : 'text-slate-600 hover:bg-slate-100',
              )
            }
          >
            <Icon size={26} aria-hidden />
            <span>{m.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

function TopBar() {
  const {online, pending, syncing, triggerSync} = useSync();
  const {companyId} = usePermissions();
  const {signOut} = useSession();
  const company = useLiveQuery(async () => (companyId ? offlineDB.companies.get(companyId) : undefined), [companyId]);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
      <div className="text-lg font-semibold text-slate-800">
        {company?.name ?? 'Organization'}{' '}
        {company ? <span className="text-base font-normal text-slate-500">· {company.company_code}</span> : null}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={triggerSync}
          className={cn(
            'inline-flex min-h-12 items-center gap-2 rounded-xl px-3 text-base font-semibold',
            online ? 'text-emerald-800' : 'text-amber-800',
          )}
          title={online ? 'Online — tap to sync' : 'Offline'}
        >
          {online ? <Wifi size={20} aria-hidden /> : <CloudOff size={20} aria-hidden />}
          {syncing ? <RefreshCw size={18} className="animate-spin" aria-hidden /> : null}
          {pending > 0 ? <span className="rounded-full bg-amber-200 px-2 text-sm text-amber-900">{pending}</span> : null}
        </button>
        <button onClick={() => void signOut()} className="inline-flex min-h-12 items-center gap-2 rounded-xl px-3 text-base font-semibold text-slate-600 hover:bg-slate-100">
          <LogOut size={20} aria-hidden /> Sign out
        </button>
      </div>
    </header>
  );
}

export function AppShell() {
  const {online, pending} = useSync();
  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      <NavRail />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        {!online ? <OfflineBanner pending={pending} /> : null}
        <main className="flex-1 overflow-auto p-6">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
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
      <div className="mb-5 flex flex-wrap gap-2 border-b border-slate-200 pb-2" role="tablist" aria-label="Organization">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({isActive}) =>
              cn(
                'min-h-12 rounded-xl px-4 py-2 text-lg font-semibold',
                isActive ? 'bg-emerald-700 text-white' : 'bg-white text-slate-700 hover:bg-slate-100',
              )
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
