// Application shell in the AI Studio prototype's design language (owner decision 2026-06-28: the prototype is the
// visual authority). White sidebar with PV logo + section labels + profile block; header with BRANCH LIVE chip,
// session pill, red sign-out; farm-bg main stage. Tablet-first, ≥56px targets preserved.
import {Suspense, useEffect, useState} from 'react';
import {NavLink, Outlet} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {
  Activity,
  BarChart3,
  ClipboardList,
  CloudOff,
  Contact,
  Landmark,
  Menu,
  Moon,
  Package,
  Users2,
  RefreshCw,
  Settings,
  ShoppingCart,
  Sparkles,
  Sun,
  UserCheck,
  Wifi,
} from 'lucide-react';
import {useSync} from '../../core/offline/sync';
import {usePermissions} from '../../core/permissions/permissions';
import {useSession} from '../../core/auth/session';
import {MOCK_MODE} from '../../core/mock/mock';
import {useDarkToggle, usePref} from '../../core/prefs/prefs';
import {offlineDB} from '../../core/offline/db';
import type {PermissionKey} from '../../types/db';
import {Loading, OfflineBanner} from '../feedback';
import {cn} from '../ui';

// Operations (owner 2026-07-04) folds Schedules & Plans, Crops & Plans, and Project Checklists into one
// entry with Accounting-style tabs — the nav stays short enough for tablets and the future mobile bar.
const CORE_MODULES = [
  {to: '/dashboard', label: 'Home Dashboard', icon: Activity},
  {to: '/pos', label: 'Weigh Point-Of-Sale', icon: ShoppingCart},
  {to: '/inventory', label: 'Stock Inventories', icon: Package},
  {to: '/accounting', label: 'Automated Accounting', icon: Landmark},
  {to: '/customers', label: 'Customers & Credit', icon: Contact},
  {to: '/payroll', label: 'Salaries & Payroll', icon: Users2},
  {to: '/operations', label: 'Operations', icon: ClipboardList},
  {to: '/reports', label: 'Reports', icon: BarChart3},
  {to: '/copilot', label: 'VeggieGenius', icon: Sparkles}, // CAP-VG1: advisory copilot (read-only, C7 §11)
  {to: '/settings', label: 'Settings Hub', icon: Settings},
] as const;

// Mobile bottom bar (owner 2026-07-04): 4 user-customizable shortcut slots + a fixed "More" sheet for
// everything else. Preference is per-device (usePref), validated against the real module list.
const ALL_NAV = [...CORE_MODULES, {to: '/organization', label: 'Approvals & Roles', icon: UserCheck}] as const;
const MOBILE_NAV_DEFAULT = '/dashboard,/pos,/inventory,/operations';

function MobileNav() {
  const [slotsPref, setSlotsPref] = usePref('mobile_nav', MOBILE_NAV_DEFAULT);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const validPaths = ALL_NAV.map((m) => m.to as string);
  const slots = slotsPref.split(',').filter((p) => validPaths.includes(p)).slice(0, 4);
  const slotItems = slots.map((p) => ALL_NAV.find((m) => m.to === p)!);

  const toggleSlot = (to: string) => {
    if (slots.includes(to)) setSlotsPref(slots.filter((s) => s !== to).join(','));
    else if (slots.length < 4) setSlotsPref([...slots, to].join(','));
  };

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-farm-accent-soft bg-farm-card pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Mobile">
        {slotItems.map((m) => {
          const Icon = m.icon;
          return (
            <NavLink
              key={m.to}
              to={m.to}
              onClick={() => setSheetOpen(false)}
              className={({isActive}) =>
                cn('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-bold', isActive ? 'text-farm-green' : 'text-farm-muted')
              }
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="max-w-full truncate">{m.label.split(' ')[0]}</span>
            </NavLink>
          );
        })}
        <button
          onClick={() => {setSheetOpen((o) => !o); setCustomizing(false);}}
          className={cn('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-bold', sheetOpen ? 'text-farm-green' : 'text-farm-muted')}
          aria-expanded={sheetOpen}
          aria-label="More sections"
        >
          <Menu className="h-5 w-5" aria-hidden />
          <span>More</span>
        </button>
      </nav>

      {sheetOpen ? (
        <div className="fixed inset-0 z-30 md:hidden" role="dialog" aria-label="All sections">
          <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setSheetOpen(false)} />
          <div className="absolute inset-x-0 bottom-14 max-h-[70vh] overflow-auto rounded-t-2xl border-t border-farm-accent-soft bg-farm-card p-4 pb-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black text-farm-ink">{customizing ? `Choose your shortcuts (${slots.length}/4)` : 'All sections'}</h3>
              <button onClick={() => setCustomizing((c) => !c)} className="rounded-lg bg-farm-accent-soft px-3 py-1.5 text-[11px] font-bold text-farm-green">
                {customizing ? 'Done' : 'Customize bar'}
              </button>
            </div>
            {customizing ? <p className="mb-3 text-[11px] text-farm-muted">Tap a section to pin or unpin it from your bottom bar. Your choice is saved on this device.</p> : null}
            <div className="grid grid-cols-3 gap-2">
              {ALL_NAV.map((m) => {
                const Icon = m.icon;
                const pinned = slots.includes(m.to);
                if (customizing) {
                  return (
                    <button
                      key={m.to}
                      onClick={() => toggleSlot(m.to)}
                      className={cn('flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-[10px] font-bold', pinned ? 'border-farm-green bg-farm-accent-soft text-farm-green' : 'border-farm-accent-soft text-farm-muted')}
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                      <span>{m.label}</span>
                      {pinned ? <span className="rounded-full bg-farm-green px-1.5 text-[9px] font-black text-white">PINNED</span> : null}
                    </button>
                  );
                }
                return (
                  <NavLink
                    key={m.to}
                    to={m.to}
                    onClick={() => setSheetOpen(false)}
                    className={({isActive}) =>
                      cn('flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-[10px] font-bold', isActive ? 'border-farm-green bg-farm-accent-soft text-farm-green' : 'border-farm-accent-soft text-farm-muted')
                    }
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                    <span>{m.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

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
    <aside className="hidden w-64 flex-col justify-between border-r border-farm-accent-soft bg-farm-card p-5 md:flex">
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
  const [farmName] = usePref('farm_display_name');
  const [terminalId] = usePref('terminal_id', 'Terminal A — Main Gate');
  const [isDark, toggleDark] = useDarkToggle();
  const company = useLiveQuery(async () => (companyId ? offlineDB.companies.get(companyId) : undefined), [companyId]);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-farm-accent-soft bg-farm-card px-4 py-3 md:px-6">
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
          onClick={toggleDark}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-farm-accent-soft bg-farm-bg px-3 font-semibold text-farm-green"
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {isDark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
        </button>
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
        {/* Sign-out removed from the top bar (owner 2026-07-11) — log out from Settings → Session only. */}
      </div>
    </header>
  );
}

// P1A: an authenticated identity with no company membership is "awaiting approval" (C2 §3 — RLS shows
// them nothing anyway; this screen says WHY instead of rendering an empty shell). Real mode only.
function AwaitingApproval() {
  const {signOut, user} = useSession();
  const {refresh} = usePermissions();
  // P1C: auto-detect approval — poll the permission snapshot every 15s and on window-focus. The moment an
  // admin assigns a membership, companyId becomes non-null and AppShell drops this screen automatically
  // (no manual reload). Cheap: one user_branch_roles read per tick, only while unapproved.
  useEffect(() => {
    const t = setInterval(() => void refresh(), 15000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {clearInterval(t); window.removeEventListener('focus', onFocus);};
  }, [refresh]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-farm-bg p-6">
      <div className="w-full max-w-md rounded-2xl bg-farm-card p-8 text-center shadow-xl">
        <h1 className="mb-2 text-xl font-extrabold text-farm-green">Almost in — awaiting approval</h1>
        <p className="mb-1 text-sm text-farm-muted">Your account ({user?.email ?? 'signed in'}) was created successfully.</p>
        <p className="mb-6 text-sm text-farm-muted">An admin now needs to assign you to a branch and role. This screen updates on its own the moment that happens — no need to refresh.</p>
        <div className="flex justify-center gap-2">
          <button onClick={() => void refresh()} className="rounded-xl bg-farm-green px-4 py-2 text-sm font-bold text-white">Check now</button>
          <button onClick={() => void signOut()} className="rounded-xl border border-farm-accent px-4 py-2 text-sm font-bold text-farm-green">Sign out</button>
        </div>
      </div>
    </div>
  );
}

export function AppShell() {
  const {online, pending} = useSync();
  const {companyId, loading} = usePermissions();
  if (!MOCK_MODE && !loading && !companyId) return <AwaitingApproval />;
  return (
    <div className="flex h-screen bg-farm-bg text-farm-ink">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        {!online ? <OfflineBanner pending={pending} /> : null}
        {/* pb-24 on phones clears the fixed bottom nav bar */}
        <main className="flex-1 overflow-auto p-4 pb-24 md:p-8">
          <div className="mx-auto w-full max-w-7xl animate-fade-in">
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      <MobileNav />
    </div>
  );
}

const ORG_TABS: Array<{to: string; label: string; perm?: PermissionKey}> = [
  {to: '/organization/approvals', label: 'Approvals', perm: 'membership.read'}, // B.4 owner-screenshot flow
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
              cn('min-h-12 rounded-xl px-4 py-2 text-lg font-bold', isActive ? 'bg-farm-green text-white' : 'bg-farm-card text-farm-muted hover:bg-farm-accent-soft hover:text-farm-green')
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
