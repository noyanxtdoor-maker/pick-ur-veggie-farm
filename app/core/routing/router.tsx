// Route tree (M1C §3) with auth + permission guards. Feature screens are LAZY-loaded (M1B F1) so the initial
// bundle is just the shell + session; modules load on demand. Bootstrap is intentionally absent (operator-only).
import {lazy, type ReactNode} from 'react';
import {createBrowserRouter, Navigate} from 'react-router-dom';
import {useSession} from '../auth/session';
import {usePermissions} from '../permissions/permissions';
import {AppShell, OrganizationLayout} from '../../components/layout/AppShell';
import {Loading} from '../../components/feedback';
import Login from '../../pages/Login';
import AcceptInvitation from '../../pages/AcceptInvitation';
import Placeholder from '../../pages/Placeholder';
import type {PermissionKey} from '../../types/db';

const Dashboard = lazy(() => import('../../pages/Dashboard'));
const CompanyScreen = lazy(() => import('../../features/organization/company/company'));
const BranchesScreen = lazy(() => import('../../features/organization/branches/branches'));
const RolesScreen = lazy(() => import('../../features/organization/roles/roles'));
const InvitationsScreen = lazy(() => import('../../features/organization/invitations/invitations'));
const MembersScreen = lazy(() => import('../../features/organization/memberships/memberships'));
const CropsLayout = lazy(() => import('../../features/crops/CropsLayout'));
const CropDashboard = lazy(() => import('../../features/crops/CropDashboard'));
const CategoriesScreen = lazy(() => import('../../features/crops/CategoriesScreen'));
const VarietiesScreen = lazy(() => import('../../features/crops/VarietiesScreen'));
const ProfilesScreen = lazy(() => import('../../features/crops/ProfilesScreen'));
const TemplatesScreen = lazy(() => import('../../features/crops/TemplatesScreen'));

function RequireAuth({children}: {children: ReactNode}) {
  const {status} = useSession();
  if (status === 'loading') return <Loading label="Starting…" />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequirePermission({perm, children}: {perm: PermissionKey; children: ReactNode}) {
  const {loading, has} = usePermissions();
  if (loading) return <Loading />;
  if (!has(perm)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {path: '/login', element: <Login />},
  {path: '/accept', element: <RequireAuth><AcceptInvitation /></RequireAuth>},
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      {index: true, element: <Navigate to="/dashboard" replace />},
      {path: 'dashboard', element: <Dashboard />},
      {
        path: 'organization',
        element: <OrganizationLayout />,
        children: [
          {index: true, element: <Navigate to="company" replace />},
          {path: 'company', element: <CompanyScreen />},
          {path: 'branches', element: <BranchesScreen />},
          {path: 'roles', element: <RolesScreen />},
          {path: 'invitations', element: <RequirePermission perm="user.invite"><InvitationsScreen /></RequirePermission>},
          {path: 'members', element: <RequirePermission perm="membership.read"><MembersScreen /></RequirePermission>},
        ],
      },
      {
        path: 'crops',
        element: <CropsLayout />,
        children: [
          {index: true, element: <Navigate to="/crops/dashboard" replace />},
          {path: 'dashboard', element: <CropDashboard />},
          {path: 'categories', element: <CategoriesScreen />},
          {path: 'varieties', element: <VarietiesScreen />},
          {path: 'profiles', element: <ProfilesScreen />},
          {path: 'templates', element: <TemplatesScreen />},
        ],
      },
      {path: 'inventory', element: <Placeholder title="Inventory" />},
      {path: 'operations', element: <Placeholder title="Operations" />},
      {path: 'reports', element: <Placeholder title="Reports" />},
      {path: 'settings', element: <Placeholder title="Settings" />},
    ],
  },
  {path: '*', element: <Navigate to="/dashboard" replace />},
]);
