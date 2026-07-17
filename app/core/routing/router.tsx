// Route tree (M1C §3) with auth + permission guards. Feature screens are LAZY-loaded (M1B F1) so the initial
// bundle is just the shell + session; modules load on demand. Bootstrap is intentionally absent (operator-only).
import {lazy, useEffect, useState, type ReactNode} from 'react';
import {createBrowserRouter, Navigate} from 'react-router-dom';
import {useSession} from '../auth/session';
import {usePermissions} from '../permissions/permissions';
import {usernameOnboardingApi} from '../../features/auth/onboarding';
import {AppShell, OrganizationLayout} from '../../components/layout/AppShell';
import {Loading} from '../../components/feedback';
import Login from '../../pages/Login';
import ResetPassword from '../../pages/ResetPassword';
import ChooseUsername from '../../pages/ChooseUsername';
import Placeholder from '../../pages/Placeholder';
import type {PermissionKey} from '../../types/db';

const Dashboard = lazy(() => import('../../pages/Dashboard'));
const CompanyScreen = lazy(() => import('../../features/organization/company/company'));
const BranchesScreen = lazy(() => import('../../features/organization/branches/branches'));
const RolesScreen = lazy(() => import('../../features/organization/roles/roles'));
const MembersScreen = lazy(() => import('../../features/organization/memberships/memberships'));
const ArchivedAccountsScreen = lazy(() => import('../../features/organization/archived/ArchivedAccountsScreen'));
const ApprovalsScreen = lazy(() => import('../../features/organization/approvals/ApprovalsScreen'));
const PosScreen = lazy(() => import('../../features/pos/PosScreen'));
const InventoryScreen = lazy(() => import('../../features/inventory/InventoryScreen'));
const AccountingScreen = lazy(() => import('../../features/accounting/AccountingScreen'));
const PayrollScreen = lazy(() => import('../../features/payroll/PayrollScreen'));
const SchedulesScreen = lazy(() => import('../../features/scheduling/SchedulesScreen'));
const ProjectsScreen = lazy(() => import('../../features/projects/ProjectsScreen'));
const SettingsScreen = lazy(() => import('../../features/settings/SettingsScreen'));
const ProfileScreen = lazy(() => import('../../features/profile/ProfileScreen'));
const CopilotPanel = lazy(() => import('../../features/copilot/CopilotPanel'));
const OperationsLayout = lazy(() => import('../../features/operations/OperationsLayout'));
const CustomersScreen = lazy(() => import('../../features/customers/CustomersScreen'));

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

// P1N (ported from Team B, 2026-07-17): post-approval username onboarding gate. An authenticated,
// APPROVED user with public.users.username_chosen_at IS NULL is redirected to /onboarding/username
// before reaching the main app. One-time-only (set_chosen_username raises on re-entry). MOCK_MODE
// skips the gate (demo has no real approval flow). The check is best-effort — if the RPC errors
// (offline, edge), we do NOT block the app: fail-open to the requested route (the server still
// enforces on actual writes).
function RequireUsernameOnboarding({children}: {children: ReactNode}) {
  const {status} = useSession();
  const [gate, setGate] = useState<'loading' | 'needed' | 'ok'>('loading');
  useEffect(() => {
    let alive = true;
    if (status !== 'authenticated') { if (alive) setGate('ok'); return; }
    usernameOnboardingApi.needsOnboarding()
      .then((need) => { if (alive) setGate(need ? 'needed' : 'ok'); })
      .catch(() => { if (alive) setGate('ok'); }); // fail-open on RPC error
    return () => { alive = false; };
  }, [status]);
  if (status === 'loading' || gate === 'loading') return <Loading label="Checking your account…" />;
  if (gate === 'needed') return <Navigate to="/onboarding/username" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {path: '/login', element: <Login />},
  {path: '/auth/reset', element: <ResetPassword />},
  {path: '/onboarding/username', element: <RequireAuth><ChooseUsername /></RequireAuth>},
  {
    path: '/',
    element: (
      <RequireAuth>
        <RequireUsernameOnboarding>
          <AppShell />
        </RequireUsernameOnboarding>
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
          {path: 'approvals', element: <RequirePermission perm="membership.approve"><ApprovalsScreen /></RequirePermission>},
          {path: 'company', element: <CompanyScreen />},
          {path: 'branches', element: <BranchesScreen />},
          {path: 'roles', element: <RolesScreen />},
          {path: 'members', element: <RequirePermission perm="membership.read"><MembersScreen /></RequirePermission>},
          {path: 'archived', element: <RequirePermission perm="membership.read"><ArchivedAccountsScreen /></RequirePermission>},
        ],
      },
      {path: 'inventory', element: <InventoryScreen />},
      {path: 'accounting', element: <AccountingScreen />},
      {path: 'customers', element: <CustomersScreen />},
      {path: 'payroll', element: <PayrollScreen />},
      // Operations hub (owner 2026-07-04): Schedules + Projects under one entry with tabs.
      // Crops & Plans deleted entirely 2026-07-17 (owner: "actually delete the crop & plan tab").
      // Offline Dexie crop_* tables + types + mock seeders deliberately RETAINED — purging them would
      // force an offline migration risk on installed on-device Dexie DBs; the dead tables are harmless.
      {
        path: 'operations',
        element: <OperationsLayout />,
        children: [
          {index: true, element: <Navigate to="schedules" replace />},
          {path: 'schedules', element: <SchedulesScreen />},
          {path: 'projects', element: <ProjectsScreen />},
        ],
      },
      // Legacy paths → Operations hub (bookmarks/tiles keep working)
      {path: 'schedules', element: <Navigate to="/operations/schedules" replace />},
      {path: 'projects', element: <Navigate to="/operations/projects" replace />},
      {path: 'crops/*', element: <Navigate to="/dashboard" replace />},
      {path: 'reports', element: <Placeholder title="Reports" />},
      {path: 'settings', element: <SettingsScreen />},
      // Profile (ported from Team B, owner parity order 2026-07-16): self-service username/email/password
      // for EVERYONE (no permission gate — self, not governed admin action). OTP password change moved here.
      {path: 'profile', element: <ProfileScreen />},
      {path: 'copilot', element: <CopilotPanel />}, // CAP-VG1: advisory only; copilot.use DB gate arrives with step 5
    ],
  },
  {path: '*', element: <Navigate to="/dashboard" replace />},
]);
