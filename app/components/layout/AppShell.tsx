// Application shell in the AI Studio prototype's design language (owner decision 2026-06-28: the prototype is the
// visual authority). White sidebar with PV logo + section labels + profile block; header with BRANCH LIVE chip,
// session pill, red sign-out; farm-bg main stage. Tablet-first, ≥56px targets preserved.
import {Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {NavLink, Outlet} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {
  Activity,
  AlertTriangle,
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
  UserCircle,
} from 'lucide-react';
import {useSync} from '../../core/offline/sync';
import {usePermissions} from '../../core/permissions/permissions';
import {useSession} from '../../core/auth/session';
import {authApi} from '../../features/auth/api';
import {MOCK_MODE} from '../../core/mock/mock';
import {useDarkToggle, usePref} from '../../core/prefs/prefs';
import {offlineDB, type OutboxItem} from '../../core/offline/db';
import {hydrateCompany} from '../../core/offline/hydrate';
import {blockedItems, retryBlocked} from '../../core/offline/queue';
import type {PermissionKey} from '../../types/db';
import {Loading, OfflineBanner} from '../feedback';
import {cn} from '../ui';

// Operations (owner 2026-07-04) folds Schedules & Plans, Crops & Plans, and Project Checklists into one
// entry with Accounting-style tabs — the nav stays short enough for tablets and the future mobile bar.
// `perms`: any ONE of these grants visibility (undefined/empty = always visible to any signed-in member).
// Payroll/Operations/Reports/Copilot/Settings stay unconditional: Payroll always has the M5C "My Payroll"
// self-view even without payroll.read; Operations' Crops tab is member-readable regardless of role;
// Reports is a placeholder; Copilot is informational-tier per CAP-VG1 §1; Settings is personal.
const CORE_MODULES = [
  {to: '/dashboard', label: 'Home Dashboard', icon: Activity, perms: undefined},
  {to: '/pos', label: 'Weigh Point-Of-Sale', icon: ShoppingCart, perms: ['pos.sell']},
  {to: '/inventory', label: 'Stock Inventories', icon: Package, perms: ['inventory.purchase', 'inventory.adjust', 'equipment.manage']},
  {to: '/accounting', label: 'Automated Accounting', icon: Landmark, perms: ['accounting.read']},
  {to: '/customers', label: 'Customers & Credit', icon: Contact, perms: ['customer.read']},
  {to: '/payroll', label: 'Salaries & Payroll', icon: Users2, perms: undefined},
  {to: '/operations', label: 'Operations', icon: ClipboardList, perms: undefined},
  {to: '/reports', label: 'Reports', icon: BarChart3, perms: ['accounting.read']}, // ported from Team B, owner 2026-07-16: admin+ only
  {to: '/copilot', label: 'VeggieGenius', icon: Sparkles, perms: undefined}, // CAP-VG1: advisory copilot (read-only, C7 §11)
  {to: '/settings', label: 'Settings Hub', icon: Settings, perms: undefined},
  {to: '/profile', label: 'My Profile', icon: UserCircle, perms: undefined}, // P1L (ported from Team B): self-service username/email/password
] as const satisfies ReadonlyArray<{to: string; label: string; icon: typeof Activity; perms: readonly PermissionKey[] | undefined}>;

// P1C3: perms match "at least one org tab is actually reachable" — see ORG_TABS below. Dropped bare
// membership.read (was letting someone with only that key see a link to zero reachable tabs, since no
// org tab is gated on membership.read anymore); added membership.approve (the Approvals tab's new gate).
const ORG_LINK = {
  to: '/organization', label: 'Approvals & Roles', icon: UserCheck,
  perms: ['membership.approve', 'membership.manage', 'company.manage', 'branch.manage', 'role.manage'],
} as const satisfies {to: string; label: string; icon: typeof UserCheck; perms: readonly PermissionKey[]};

function visibleNav<T extends {perms?: readonly PermissionKey[]}>(items: readonly T[], has: (k: PermissionKey) => boolean): T[] {
  return items.filter((m) => !m.perms || m.perms.length === 0 || m.perms.some(has));
}

// Mobile bottom bar (owner 2026-07-04): 5 user-customizable shortcut slots (was 4 — freed a slot when
// the "More" trigger moved into the top bar, 2026-07-18) + a sheet for everything else, now opened from
// the top bar instead of a bottom-bar button. Preference is per-device (usePref), validated against the
// real module list. `sheetOpen`/`setSheetOpen` are owned by AppShell so the top bar's trigger and this
// sheet share one source of truth despite living in visually separate DOM subtrees.
const ALL_NAV = [...CORE_MODULES, ORG_LINK] as const;
const MOBILE_NAV_DEFAULT = '/dashboard,/pos,/inventory,/operations,/payroll';
const MOBILE_NAV_SLOTS = 5;

function MobileNav({sheetOpen, setSheetOpen}: {sheetOpen: boolean; setSheetOpen: (v: boolean) => void}) {
  const {has} = usePermissions();
  const [slotsPref, setSlotsPref] = usePref('mobile_nav', MOBILE_NAV_DEFAULT);
  const [customizing, setCustomizing] = useState(false);
  useEffect(() => setCustomizing(false), [sheetOpen]); // fresh "All sections" view each time the sheet opens, mirrors the old open-button's reset
  const nav = visibleNav(ALL_NAV, has);
  const validPaths = nav.map((m) => m.to as string);
  const slots = slotsPref.split(',').filter((p) => validPaths.includes(p)).slice(0, MOBILE_NAV_SLOTS);
  const slotItems = slots.map((p) => nav.find((m) => m.to === p)!);

  const toggleSlot = (to: string) => {
    if (slots.includes(to)) setSlotsPref(slots.filter((s) => s !== to).join(','));
    else if (slots.length < MOBILE_NAV_SLOTS) setSlotsPref([...slots, to].join(','));
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
      </nav>

      {sheetOpen ? (
        <div className="fixed inset-0 z-30 md:hidden" role="dialog" aria-label="All sections">
          <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setSheetOpen(false)} />
          <div className="absolute inset-x-0 bottom-14 max-h-[70vh] overflow-auto rounded-t-2xl border-t border-farm-accent-soft bg-farm-card p-4 pb-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black text-farm-ink">{customizing ? `Choose your shortcuts (${slots.length}/${MOBILE_NAV_SLOTS})` : 'All sections'}</h3>
              <button onClick={() => setCustomizing((c) => !c)} className="rounded-lg bg-farm-accent-soft px-3 py-1.5 text-[11px] font-bold text-farm-green">
                {customizing ? 'Done' : 'Customize bar'}
              </button>
            </div>
            {customizing ? <p className="mb-3 text-[11px] text-farm-muted">Tap a section to pin or unpin it from your bottom bar. Your choice is saved on this device.</p> : null}
            <div className="grid grid-cols-3 gap-2">
              {nav.map((m) => {
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
  const {has} = usePermissions();
  const name = (user?.email ?? 'operator').split('@')[0] ?? 'operator';
  const modules = visibleNav(CORE_MODULES, has);
  const showOrgLink = ORG_LINK.perms.some(has);
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
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <NavLink key={m.to} to={m.to} className={({isActive}) => navClass(isActive)}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden /> {m.label}
              </NavLink>
            );
          })}
          {showOrgLink ? (
            <>
              <span className="block border-b border-farm-bg px-3 pb-1 pt-4 text-[10px] font-black uppercase tracking-wider text-farm-muted">User Administration</span>
              <NavLink to="/organization" className={({isActive}) => navClass(isActive)}>
                <UserCheck className="h-4 w-4 shrink-0" aria-hidden /> Approvals &amp; Roles
              </NavLink>
            </>
          ) : null}
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

function TopBar({sheetOpen, setSheetOpen}: {sheetOpen: boolean; setSheetOpen: (v: boolean) => void}) {
  const {online, pending, blocked, syncing, manualSync} = useSync();
  const {companyId} = usePermissions();
  const [farmName] = usePref('farm_display_name');
  const [terminalId] = usePref('terminal_id', 'Terminal A — Main Gate');
  const [isDark, toggleDark] = useDarkToggle();
  const company = useLiveQuery(async () => (companyId ? offlineDB.companies.get(companyId) : undefined), [companyId]);
  useEffect(() => {if (companyId) hydrateCompany(companyId);}, [companyId]);

  // Found live (2026-07-19, owner report — a sale on one device never showed up anywhere else): the
  // outbox queue already tracked permanently-rejected items as 'Blocked' and kept them (never silently
  // dropped, B5 §7), but nothing ever showed a Blocked item to anyone — the "pending" badge deliberately
  // excludes them (pending = still in flight; blocked = needs a human). The record wasn't lost, just
  // invisible on the one device that has it. This panel is that missing half: visible whenever this
  // device is holding a Blocked item, listing the actual server error, with a Retry that re-queues it.
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [issues, setIssues] = useState<OutboxItem[]>([]);
  const loadIssues = useCallback(() => { blockedItems().then(setIssues).catch(() => setIssues([])); }, []);
  useEffect(() => { if (issuesOpen) loadIssues(); }, [issuesOpen, loadIssues]);
  useEffect(() => { loadIssues(); }, [blocked, loadIssues]); // keep the count-driving list fresh as items resolve

  // Local UI-only sync flag (ported from Team B, owner 2026-07-16): the owner reported the Sync
  // button "doesn't animate, glitches on tap." Root cause: useSync()'s `syncing` flag toggles with
  // the raw outbox-drain timing (which can finish in <50ms), so a tap could flip state mid-render —
  // the "glitch." The fix decouples the VISUAL spin from the outbox flag: a local `uiSyncing`
  // state, always ≥700ms, drives the icon + the full-screen overlay.
  const [uiSyncing, setUiSyncing] = useState(false);
  const syncTimeout = useRef<number | null>(null);
  const handleSyncClick = useCallback(() => {
    if (uiSyncing) return; // ignore taps during spin (prevents restart-glitch)
    setUiSyncing(true);
    manualSync();
    if (syncTimeout.current) window.clearTimeout(syncTimeout.current);
    syncTimeout.current = window.setTimeout(() => setUiSyncing(false), 700);
  }, [uiSyncing, manualSync]);
  useEffect(() => () => { if (syncTimeout.current) window.clearTimeout(syncTimeout.current); }, []);
  const showSync = uiSyncing || syncing;

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
          onClick={handleSyncClick}
          disabled={uiSyncing}
          className={cn('inline-flex min-h-12 items-center gap-2 rounded-xl border border-farm-accent-soft bg-farm-bg px-3 font-semibold transition', online ? 'text-farm-green hover:bg-farm-accent-soft' : 'text-farm-warn', uiSyncing && 'cursor-progress opacity-80')}
          title={showSync ? 'Syncing…' : online ? 'Tap to sync — refreshes this screen and sends any queued changes' : 'Offline'}
          aria-label={online ? 'Sync now' : 'Offline'}
          aria-busy={showSync || undefined}
        >
          {online ? <RefreshCw size={18} className={showSync ? 'animate-spin' : ''} aria-hidden /> : <CloudOff size={18} aria-hidden />}
          {showSync ? <span className="text-xs">Syncing…</span> : null}
          {pending > 0 ? <span className="rounded-full bg-amber-200 px-2 text-amber-900">{pending}</span> : null}
        </button>
        {blocked > 0 ? (
          <button
            onClick={() => setIssuesOpen(true)}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 font-semibold text-farm-danger"
            title={`${blocked} change${blocked === 1 ? '' : 's'} on this device couldn't sync — tap to review`}
          >
            <AlertTriangle size={18} aria-hidden />
            <span className="rounded-full bg-red-200 px-2 text-red-900">{blocked}</span>
          </button>
        ) : null}
        {/* Profile + "More sections" (mobile only, 2026-07-18): moved up from the bottom bar per owner
            request — frees a 5th customizable slot down there (now defaulted to Payroll) and keeps
            these two reachable without opening the sheet first. Desktop/tablet already has both (the
            NavRail's own Profile link, and every section visible directly) — no need to duplicate them
            in the top bar there, confirmed with the owner (four buttons is fine once the view is wide
            enough to space them out). */}
        <NavLink to="/profile" className="flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-farm-accent-soft bg-farm-bg text-farm-green md:hidden" title="My Profile" aria-label="My Profile">
          <UserCircle size={18} aria-hidden />
        </NavLink>
        <button
          onClick={() => setSheetOpen(!sheetOpen)}
          className={cn('flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-farm-accent-soft bg-farm-bg md:hidden', sheetOpen ? 'text-farm-green' : 'text-farm-muted')}
          aria-expanded={sheetOpen}
          aria-label="More sections"
          title="More sections"
        >
          <Menu size={18} aria-hidden />
        </button>
        <div className="hidden min-h-12 items-center gap-2 rounded-xl border border-farm-accent-soft bg-farm-bg px-3 font-semibold text-farm-ink md:inline-flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-farm-green" aria-hidden />
          <span>Station: <strong className="font-mono text-farm-green">{terminalId}</strong></span>
        </div>
        {/* Sign-out removed from the top bar (owner 2026-07-11) — log out from Settings → Session only. */}
      </div>
      {/* Full-screen sync overlay (ported from Team B, owner directive 2026-07-16): "we want a
          perfect animation for sync the whole screen" — a subtle top-edge shimmer + faint backdrop
          sweep that paints whenever uiSyncing is true (min 700ms). pointer-events-none so users can
          still tap while it animates. */}
      {uiSyncing ? (
        <div
          aria-live="polite"
          aria-busy="true"
          className="syncoverlay pointer-events-none fixed inset-0 z-40 overflow-hidden"
          role="status"
        >
          <span className="syncoverlay__shimmer" />
          <span className="syncoverlay__label">Syncing…</span>
        </div>
      ) : null}

      {issuesOpen ? (
        <div className="fixed inset-0 z-40" role="dialog" aria-label="Sync issues on this device">
          <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setIssuesOpen(false)} />
          <div className="absolute inset-x-4 top-20 mx-auto max-h-[70vh] max-w-lg overflow-auto rounded-2xl border border-farm-accent-soft bg-farm-card p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-black text-farm-ink"><AlertTriangle size={16} className="text-farm-danger" aria-hidden /> Sync issues on this device</h3>
              <button onClick={() => setIssuesOpen(false)} className="rounded-lg bg-farm-accent-soft px-3 py-1.5 text-[11px] font-bold text-farm-green">Close</button>
            </div>
            <p className="mb-3 text-[11px] text-farm-muted">
              These changes were made on this device but the server rejected them — nothing was lost, but they will
              never reach anyone else until you retry (or ask for help if the same error keeps happening).
            </p>
            {issues.length === 0 ? (
              <p className="py-4 text-center text-sm text-farm-muted">No issues right now.</p>
            ) : (
              <ul className="space-y-2">
                {issues.map((item) => (
                  <li key={item.id} className="rounded-xl border border-red-200 bg-red-50 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs font-bold capitalize text-farm-ink">{item.kind.replace(/[._]/g, ' ')}</span>
                      <span className="text-[10px] text-farm-muted">{new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mb-2 text-[11px] text-farm-danger">{item.lastError || 'No error detail recorded.'}</p>
                    <button
                      onClick={() => { void retryBlocked(item.id).then(() => { loadIssues(); manualSync(); }); }}
                      className="rounded-lg bg-farm-green px-2.5 py-1 text-[11px] font-bold text-white hover:bg-farm-green-700"
                    >
                      Retry now
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}

// P1A: an authenticated identity with no company membership is "awaiting approval" (C2 §3 — RLS shows
// them nothing anyway; this screen says WHY instead of rendering an empty shell). Real mode only.
// P1F: a companyId of null covers two very different situations — still pending, or rejected
// (account_status Suspended, see the P1F migration) — current_app_user_id() resolves NULL for both by
// design (B1 §3), so my_account_status() is the one self-only signal that can tell them apart.
function AwaitingApproval() {
  const {signOut, user} = useSession();
  const {refresh} = usePermissions();
  const [status, setStatus] = useState<'Active' | 'Suspended' | null>(null);
  useEffect(() => {
    void authApi.myAccountStatus().then(setStatus);
  }, []);
  // Only poll/auto-detect while genuinely still pending — a rejected account will never self-heal, so
  // polling would just be wasted reads (and could flicker the wrong screen if a stale 'Active' lingered).
  useEffect(() => {
    if (status === 'Suspended') return;
    const t = setInterval(() => void refresh(), 15000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {clearInterval(t); window.removeEventListener('focus', onFocus);};
  }, [refresh, status]);

  if (status === 'Suspended') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-farm-bg p-6">
        <div className="w-full max-w-md rounded-2xl bg-farm-card p-8 text-center shadow-xl">
          <h1 className="mb-2 text-xl font-extrabold text-farm-danger">Registration not approved</h1>
          <p className="mb-1 text-sm text-farm-muted">Your account ({user?.email ?? 'signed in'}) was reviewed and was not approved for access.</p>
          <p className="mb-6 text-sm text-farm-muted">If you believe this is a mistake, contact the farm's management directly.</p>
          <div className="flex justify-center">
            <button onClick={() => void signOut()} className="rounded-xl border border-farm-accent px-4 py-2 text-sm font-bold text-farm-green">Sign out</button>
          </div>
        </div>
      </div>
    );
  }

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
  // Owned here, not inside TopBar or MobileNav individually — the "More sections" trigger (top bar)
  // and the sheet it opens (bottom-anchored, alongside the mobile nav) live in separate DOM subtrees
  // but must share one boolean.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  // Real-mode gate (ported from Team B, owner directive 2026-07-16): no company membership means
  // AwaitingApproval, AND we must NOT flash the dashboard for ~0.5s before that decision resolves.
  // `loading` flips false a moment after a cached snapshot is read from Dexie, and <Outlet/> could
  // paint during that gap before AwaitingApproval below ever ran — a real visible peek of the
  // privileged dashboard for an un-approved user. Fix: while loading=true, render <Loading/> (the
  // gate is undecided); only once loading=false do we decide AwaitingApproval vs the real shell.
  // The dashboard <Outlet/> never mounts until companyId is non-null — zero peek.
  if (!MOCK_MODE && loading) return <Loading />;
  if (!MOCK_MODE && !loading && !companyId) return <AwaitingApproval />;
  return (
    <div className="flex h-screen bg-farm-bg text-farm-ink">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar sheetOpen={mobileSheetOpen} setSheetOpen={setMobileSheetOpen} />
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
      <MobileNav sheetOpen={mobileSheetOpen} setSheetOpen={setMobileSheetOpen} />
    </div>
  );
}

// P1C3: each tab now gated on the SAME key that governs its capability, not a shared blanket
// membership.read — this is what makes "admin only sees Approvals by default" real (admin holds
// membership.approve but none of company.manage/branch.manage/role.manage/membership.manage).
// Members/Archived deliberately use membership.manage, not membership.read, for the same reason.
const ORG_TABS: Array<{to: string; label: string; perm?: PermissionKey}> = [
  {to: '/organization/approvals', label: 'Approvals', perm: 'membership.approve'}, // B.4 owner-screenshot flow
  {to: '/organization/company', label: 'Company', perm: 'company.manage'},
  {to: '/organization/branches', label: 'Branches', perm: 'branch.manage'},
  {to: '/organization/roles', label: 'Roles', perm: 'role.manage'},
  {to: '/organization/members', label: 'Members', perm: 'membership.manage'},
  {to: '/organization/archived', label: 'Archived', perm: 'membership.manage'},
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
