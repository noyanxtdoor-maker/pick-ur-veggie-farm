// Route tree (M1C §3) with auth + permission guards. Feature screens are LAZY-loaded (M1B F1) so the initial
// bundle is just the shell + session; modules load on demand. Bootstrap is intentionally absent (operator-only).
import {lazy, type ReactNode} from 'react';
import {createBrowserRouter, Navigate} from 'react-router-dom';
import {useSession} from '../auth/session';
import {usePermissions} from '../permissions/permissions';
import {AppShell, OrganizationLayout} from '../../components/layout/AppShell';
import {Loading} from '../../components/feedback';
import Login from '../../pages/Login';
import ResetPassword from '../../pages/ResetPassword';
import AcceptInvitation from '../../pages/AcceptInvitation';
import Placeholder from '../../pages/Placeholder';
import type {PermissionKey} from '../../types/db';

const Dashboard = lazy(() => import('../../pages/Dashboard'));
const CompanyScreen = lazy(() => import('../../features/organization/company/company'));
const BranchesScreen = lazy(() => import('../../features/organization/branches/branches'));
const RolesScreen = lazy(() => import('../../features/organization/roles/roles'));
const InvitationsScreen = lazy(() => import('../../features/organization/invitations/invitations'));
const MembersScreen = lazy(() => import('../../features/organization/memberships/memberships'));
const ApprovalsScreen = lazy(() => import('../../features/organization/approvals/ApprovalsScreen'));
const PosScreen = lazy(() => import('../../features/pos/PosScreen'));
const InventoryScreen = lazy(() => import('../../features/inventory/InventoryScreen'));
const AccountingScreen = lazy(() => import('../../features/accounting/AccountingScreen'));
const PayrollScreen = lazy(() => import('../../features/payroll/PayrollScreen'));
const SchedulesScreen = lazy(() => import('../../features/scheduling/SchedulesScreen'));
const ProjectsScreen = lazy(() => import('../../features/projects/ProjectsScreen'));
const SettingsScreen = lazy(() => import('../../features/settings/SettingsScreen'));
const OperationsLayout = lazy(() => import('../../features/operations/OperationsLayout'));
const CustomersScreen = lazy(() => import('../../features/customers/CustomersScreen'));
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
  {path: '/auth/reset', element: <ResetPassword />},
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
      {path: 'pos', element: <PosScreen />},
      {
        path: 'organization',
        element: <OrganizationLayout />,
        children: [
          {index: true, element: <Navigate to="approvals" replace />},
          {path: 'approvals', element: <RequirePermission perm="membership.read"><ApprovalsScreen /></RequirePermission>},
          {path: 'company', element: <CompanyScreen />},
          {path: 'branches', element: <BranchesScreen />},
          {path: 'roles', element: <RolesScreen />},
          {path: 'invitations', element: <RequirePermission perm="user.invite"><InvitationsScreen /></RequirePermission>},
          {path: 'members', element: <RequirePermission perm="membership.read"><MembersScreen /></RequirePermission>},
        ],
      },
      {path: 'inventory', element: <InventoryScreen />},
      {path: 'accounting', element: <AccountingScreen />},
      {path: 'customers', element: <CustomersScreen />},
      {path: 'payroll', element: <PayrollScreen />},
      // Operations hub (owner 2026-07-04): Schedules + Crops + Projects under one entry with tabs.
      {
        path: 'operations',
        element: <OperationsLayout />,
        children: [
          {index: true, element: <Navigate to="schedules" replace />},
          {path: 'schedules', element: <SchedulesScreen />},
          {path: 'projects', element: <ProjectsScreen />},
          {
            path: 'crops',
            element: <CropsLayout />,
            children: [
              {index: true, element: <Navigate to="dashboard" replace />},
              {path: 'dashboard', element: <CropDashboard />},
              {path: 'categories', element: <CategoriesScreen />},
              {path: 'varieties', element: <VarietiesScreen />},
              {path: 'profiles', element: <ProfilesScreen />},
              {path: 'templates', element: <TemplatesScreen />},
            ],
          },
        ],
      },
      // Legacy paths → Operations hub (bookmarks/tiles keep working)
      {path: 'schedules', element: <Navigate to="/operations/schedules" replace />},
      {path: 'projects', element: <Navigate to="/operations/projects" replace />},
      {path: 'crops/*', element: <Navigate to="/operations/crops" replace />},
      {path: 'reports', element: <Placeholder title="Reports" />},
      {path: 'settings', element: <SettingsScreen />},
    ],
  },
  {path: '*', element: <Navigate to="/dashboard" replace />},
]);
