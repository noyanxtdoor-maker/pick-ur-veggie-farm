// Operations hub (owner 2026-07-04): Schedules & Plans and Project Checklists live under ONE nav
// entry with Accounting-style tabs. Crops & Plans deleted entirely 2026-07-17 (owner: "actually
// delete the crop & plan tab") — see the router for the retirement note on the offline cache.
// P1C3 (2026-07-17): tabs are now permission-gated (previously unconditional — a real gap flagged
// during the Section Access redesign). Own-visibility check stays synchronous has(), mirroring
// OrganizationLayout's existing ORG_TABS pattern in AppShell.tsx — no RPC involved (the async
// user_key_tier resolver is reserved for the Access dialog inspecting a DIFFERENT user).
import {NavLink, Outlet} from 'react-router-dom';
import {CalendarDays, FolderKanban} from 'lucide-react';
import {cn} from '../../components/ui';
import {usePermissions} from '../../core/permissions/permissions';
import type {PermissionKey} from '../../types/db';

const TABS: Array<{to: string; label: string; icon: typeof CalendarDays; perms: readonly PermissionKey[]}> = [
  {to: 'schedules', label: 'Schedules & Plans', icon: CalendarDays, perms: ['schedule.read', 'schedule.manage']},
  {to: 'projects', label: 'Project Checklists', icon: FolderKanban, perms: ['project.read', 'project.manage']},
];

export default function OperationsLayout() {
  const {has} = usePermissions();
  const tabs = TABS.filter((t) => t.perms.some(has));
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-farm-accent pb-0.5" role="tablist" aria-label="Operations">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={({isActive}) =>
                cn(
                  'flex min-h-12 items-center gap-2 rounded-t-xl px-4 text-sm font-bold transition',
                  isActive ? 'border-x border-t border-farm-accent bg-farm-card text-farm-green' : 'text-farm-muted hover:bg-farm-card/40 hover:text-farm-green',
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden /> {t.label}
            </NavLink>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}
