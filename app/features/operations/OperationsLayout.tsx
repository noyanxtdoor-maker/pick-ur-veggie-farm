// Operations hub (owner 2026-07-04): Schedules & Plans, Crops & Plans, and Project Checklists live under ONE
// nav entry with Accounting-style tabs (sub-tabs stay inside each feature, e.g. Crops' own tab row).
// Pure layout — every screen keeps its own permissions and data seams.
import {NavLink, Outlet} from 'react-router-dom';
import {CalendarDays, FolderKanban, Sprout} from 'lucide-react';
import {cn} from '../../components/ui';

const TABS = [
  {to: 'schedules', label: 'Schedules & Plans', icon: CalendarDays},
  {to: 'crops', label: 'Crops & Plans', icon: Sprout},
  {to: 'projects', label: 'Project Checklists', icon: FolderKanban},
] as const;

export default function OperationsLayout() {
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-farm-accent pb-0.5" role="tablist" aria-label="Operations">
        {TABS.map((t) => {
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
