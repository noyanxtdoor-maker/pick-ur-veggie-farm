// Crops module sub-navigation (mirrors OrganizationLayout). Crops are member-readable; crop.manage gates writes
// inside each screen, so all tabs are visible to members.
import {NavLink, Outlet} from 'react-router-dom';
import {cn} from '../../components/ui';

const TABS = [
  {to: '/crops/dashboard', label: 'Dashboard'},
  {to: '/crops/categories', label: 'Categories'},
  {to: '/crops/varieties', label: 'Varieties'},
  {to: '/crops/profiles', label: 'Profiles'},
  {to: '/crops/templates', label: 'Templates'},
];

export default function CropsLayout() {
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2 border-b border-slate-200 pb-2" role="tablist" aria-label="Crop Management">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({isActive}) => cn('min-h-12 rounded-xl px-4 py-2 text-lg font-bold', isActive ? 'bg-farm-green text-white' : 'bg-white text-farm-muted hover:bg-farm-accent-soft hover:text-farm-green')}
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
