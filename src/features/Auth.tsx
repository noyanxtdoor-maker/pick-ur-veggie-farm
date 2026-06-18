import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { User, UserRole } from '../lib/types';
import { Shield, Sparkles, Check, X, Clock, HelpCircle } from 'lucide-react';

interface AuthProps {
  currentUser: User | null;
  setCurrentUser: (u: User | null) => void;
  onRefresh: () => void;
}

export function Auth({ currentUser, setCurrentUser, onRefresh }: AuthProps) {
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [role, setRole] = useState<UserRole>('Employee');
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [usersList, setUsersList] = useState<User[]>([]);
  const [pendingApproval, setPendingApproval] = useState<boolean>(false);

  useEffect(() => {
    loadUsers();
  }, [currentUser]);

  const loadUsers = async () => {
    const list = await db.users.toArray();
    setUsersList(list);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!username.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }

    const cleanUsername = username.trim().toLowerCase();

    if (isLogin) {
      const user = await db.users.get(cleanUsername);
      if (!user || user.passwordHash !== password) {
        setError('Invalid username or password.');
        return;
      }
      if (!user.approved) {
        setPendingApproval(true);
        return;
      }
      setCurrentUser(user);
      localStorage.setItem('puv_logged_user', cleanUsername);
      onRefresh();
    } else {
      // Register
      const existing = await db.users.get(cleanUsername);
      if (existing) {
        setError('Username is already taken.');
        return;
      }

      const newUser: User = {
        username: cleanUsername,
        passwordHash: password,
        role,
        approved: false, // Must be approved by Dev / Owner
        createdAt: new Date().toISOString()
      };

      await db.users.add(newUser);
      setSuccess('Account registered successfully! Please wait for a Developer or Owner to review and approve your application.');
      setPendingApproval(true);
      loadUsers();
    }
  };

  const handleQuickLogin = async (uname: string) => {
    setError('');
    const user = await db.users.get(uname);
    if (user) {
      if (!user.approved) {
        setPendingApproval(true);
        return;
      }
      setCurrentUser(user);
      localStorage.setItem('puv_logged_user', uname);
      onRefresh();
    }
  };

  // Check if a role can appoint another role
  const canAppointRole = (appointingRole: UserRole, targetRole: UserRole): boolean => {
    if (appointingRole === 'Developer') return true;
    if (appointingRole === 'Owner' || appointingRole === 'Co-Owner') {
      return targetRole !== 'Developer' && targetRole !== 'Owner';
    }
    if (appointingRole === 'Admin') {
      return targetRole === 'Operator' || targetRole === 'Employee';
    }
    return false;
  };

  const handleApprove = async (uname: string, approve: boolean) => {
    if (!currentUser) return;
    const targetUser = await db.users.get(uname);
    if (!targetUser) return;

    if (!canAppointRole(currentUser.role, targetUser.role)) {
      alert(`You do not have administrative authority to handle approval for a ${targetUser.role} role.`);
      return;
    }

    if (approve) {
      await db.users.update(uname, { approved: true });
    } else {
      await db.users.delete(uname);
    }
    loadUsers();
    onRefresh();
  };

  const handleChangeRole = async (uname: string, newRole: UserRole) => {
    if (!currentUser) return;
    const targetUser = await db.users.get(uname);
    if (!targetUser) return;

    // Check authority to appoint/modify to this role and from this role
    if (!canAppointRole(currentUser.role, targetUser.role) || !canAppointRole(currentUser.role, newRole)) {
      alert(`You do not have authority to change roles. Only Devs can appoint Owner/Dev, Owners can appoint Admins, etc.`);
      return;
    }

    await db.users.update(uname, { role: newRole });
    loadUsers();
    onRefresh();
  };

  if (pendingApproval) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-farm-bg p-4">
        <div id="pending-card" className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-farm-accent p-8 text-center">
          <div className="mx-auto w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center text-amber-500 mb-6 border border-amber-200">
            <Clock className="w-8 h-8 animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold text-farm-green mb-4">Application Under Review</h2>
          <p className="text-farm-muted leading-relaxed mb-6 text-sm">
            Thank you for signing up to the <strong>Pick Ur Veggie Farm ERP</strong>.
            Your registration is currently <strong>pending approval</strong> by a Developer or Farm Owner.
            Please coordinate directly with the administrators to enable access for your account.
          </p>

          <div className="bg-farm-bg p-4 rounded-xl border border-farm-accent-soft text-left mb-6 text-xs">
            <h4 className="font-semibold text-farm-green mb-1">Registration Details:</h4>
            <div>Username: <span className="font-mono text-farm-ink font-semibold">{username}</span></div>
            <div>Requested Role: <span className="font-semibold px-2 py-0.5 rounded bg-farm-accent-soft text-farm-green text-[10px] uppercase font-bold">{role}</span></div>
          </div>

          <button
            onClick={() => {
              setPendingApproval(false);
              setIsLogin(true);
              setUsername('');
              setPassword('');
            }}
            className="w-full bg-farm-green hover:bg-farm-green-700 text-white font-semibold py-3 px-6 rounded-xl transition duration-200 cursor-pointer"
          >
            Back to Login Screen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-farm-bg font-sans">
      {/* Visual welcome side */}
      <div className="md:w-1/2 bg-farm-green flex flex-col justify-between p-8 md:p-12 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-farm-green-500 via-farm-green to-farm-green opacity-40"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-10 h-10 bg-farm-accent text-farm-green rounded-xl flex items-center justify-center font-bold text-lg shadow-lg">₱</div>
            <div>
              <h1 className="font-bold text-lg tracking-wider">Pick Ur Veggie</h1>
              <p className="text-[10px] tracking-widest text-farm-accent uppercase font-semibold">Agricultural ERP</p>
            </div>
          </div>
          
          <div className="my-auto py-12">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-6">
              Simplifying the <span className="text-farm-accent">numbers</span> of the farm harvest.
            </h2>
            <p className="text-farm-accent-soft text-base md:text-lg leading-relaxed max-w-lg mb-8">
              A robust, <strong>100% offline-first</strong> enterprise manager combining touch-screen weighing Point-of-Sale, real-time consumable and equipment inventories, advanced ledgers, dynamic cash flows, and secure loans tracking.
            </p>
            <div className="flex flex-wrap gap-4 text-xs text-farm-accent">
              <span className="flex items-center gap-1.5"><Shield className="w-4 h-4" /> Role Enforcement</span>
              <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> Auto-sync Accounting</span>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-xs text-farm-accent-soft mt-8 md:mt-0">
          Pick Ur Veggie ERP v1.0.0 &copy; 2026. Made with Developer Precision.
        </div>
      </div>

      {/* Form and Quick switch side */}
      <div className="md:w-1/2 flex flex-col justify-center items-center p-6 md:p-12 bg-farm-bg">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-8">
          <div className="flex gap-4 border-b border-farm-accent-soft pb-4 mb-6">
            <button
              onClick={() => { setIsLogin(true); setError(''); setSuccess(''); }}
              className={`flex-1 pb-2 font-bold text-sm tracking-wide text-center transition cursor-pointer ${isLogin ? 'text-farm-green border-b-2 border-farm-green' : 'text-farm-muted hover:text-farm-green'}`}
            >
              SIGN IN
            </button>
            <button
              onClick={() => { setIsLogin(false); setError(''); setSuccess(''); }}
              className={`flex-1 pb-2 font-bold text-sm tracking-wide text-center transition cursor-pointer ${!isLogin ? 'text-farm-green border-b-2 border-farm-green' : 'text-farm-muted hover:text-farm-green'}`}
            >
              CREATE POS ACCOUNT
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {error && <div className="p-3 text-xs bg-red-50 text-farm-danger rounded-xl border border-red-200">{error}</div>}
            {success && <div className="p-3 text-xs bg-green-50 text-farm-green-700 rounded-xl border border-farm-accent-soft">{success}</div>}

            <div>
              <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. maria"
                className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green focus:ring-2 focus:ring-farm-accent-soft bg-farm-bg/50"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green focus:ring-2 focus:ring-farm-accent-soft bg-farm-bg/50"
              />
            </div>

            {!isLogin && (
              <div>
                <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Select Role Permission</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg/50 text-sm font-semibold"
                >
                  <option value="Employee">Employee (POS, Payouts Review Only)</option>
                  <option value="Operator">Operator (POS, Input Payouts, Ledger entries)</option>
                  <option value="Admin">Admin (POS, Financial Statements, Core Ledgers, Setup)</option>
                  <option value="Co-Owner">Co-Owner (All Access, Edit everything except DEV configurations)</option>
                  <option value="Owner">Owner (All Access, Appoint Admins/Employees)</option>
                </select>
                <p className="text-[10px] text-farm-muted mt-2 leading-relaxed">
                  *Note: Creating an account with higher roles will require strict approval from the current platform owners before logging in.
                </p>
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3.5 px-6 rounded-xl transition duration-200 cursor-pointer shadow-lg shadow-farm-green/10"
            >
              {isLogin ? 'LOG IN TO ERP' : 'REGISTER POS ACCOUNT'}
            </button>
          </form>

          {/* Quick-switch list (Excellent for single-computer testing!) */}
          <div className="mt-8 border-t border-farm-accent-soft pt-6">
            <h4 className="text-xs font-bold text-farm-muted uppercase tracking-wider mb-4 flex items-center justify-between">
              <span>Quick Test Identities:</span>
              <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-farm-accent-soft text-farm-green select-none">Offline Seeding</span>
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() => handleQuickLogin('dev')}
                className="flex items-center justify-between p-2.5 rounded-xl border border-farm-accent-soft hover:border-farm-green hover:bg-farm-accent-soft transition text-left cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-farm-green">dev</div>
                  <div className="text-[9px] text-farm-muted uppercase font-bold">Developer</div>
                </div>
                <div className="w-5 h-5 rounded-full bg-farm-green text-white flex items-center justify-center font-mono">D</div>
              </button>

              <button
                onClick={() => handleQuickLogin('owner')}
                className="flex items-center justify-between p-2.5 rounded-xl border border-farm-accent-soft hover:border-farm-green hover:bg-farm-accent-soft transition text-left cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-farm-green">owner</div>
                  <div className="text-[9px] text-farm-muted uppercase font-bold">Farm Owner</div>
                </div>
                <div className="w-5 h-5 rounded-full bg-farm-green text-white flex items-center justify-center font-mono">O</div>
              </button>

              <button
                onClick={() => handleQuickLogin('admin')}
                className="flex items-center justify-between p-2.5 rounded-xl border border-farm-accent-soft hover:border-farm-green hover:bg-farm-accent-soft transition text-left cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-farm-green">admin</div>
                  <div className="text-[9px] text-farm-muted uppercase font-bold">Administrator</div>
                </div>
                <div className="w-5 h-5 rounded-full bg-farm-green text-white flex items-center justify-center font-mono">A</div>
              </button>

              <button
                onClick={() => handleQuickLogin('employee')}
                className="flex items-center justify-between p-2.5 rounded-xl border border-farm-accent-soft hover:border-farm-green hover:bg-farm-accent-soft transition text-left cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-farm-green">employee</div>
                  <div className="text-[9px] text-farm-muted uppercase font-bold">POS Cashier</div>
                </div>
                <div className="w-5 h-5 rounded-full bg-farm-green text-white flex items-center justify-center font-mono">E</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface UserAdminPanelProps {
  currentUser: User;
}

export function UserAdminPanel({ currentUser }: UserAdminPanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [editingPermissionsUser, setEditingPermissionsUser] = useState<string | null>(null);

  const loadAllUsers = async () => {
    setLoading(true);
    const list = await db.users.toArray();
    setUsers(list);
    setLoading(false);
  };

  useEffect(() => {
    loadAllUsers();
  }, []);

  const canAppointRole = (appointingRole: UserRole, targetRole: UserRole): boolean => {
    if (appointingRole === 'Developer') return true;
    if (appointingRole === 'Owner' || appointingRole === 'Co-Owner') {
      return targetRole !== 'Developer' && targetRole !== 'Owner';
    }
    if (appointingRole === 'Admin') {
      return targetRole === 'Operator' || targetRole === 'Employee';
    }
    return false;
  };

  const handleApprove = async (username: string) => {
    const userToApprove = users.find(u => u.username === username);
    if (!userToApprove) return;

    if (!canAppointRole(currentUser.role, userToApprove.role)) {
      alert(`You do not have the required administrative permissions to approve a '${userToApprove.role}' registration request.`);
      return;
    }

    await db.users.update(username, { approved: true });
    loadAllUsers();
  };

  const handleDisapprove = async (username: string) => {
    const userToReject = users.find(u => u.username === username);
    if (!userToReject) return;

    if (!canAppointRole(currentUser.role, userToReject.role)) {
      alert(`You do not have administrative authority to reject a ${userToReject.role} account.`);
      return;
    }

    if (confirm(`Are you sure you want to completely remove/reject '${username}' registration?`)) {
      await db.users.delete(username);
      loadAllUsers();
    }
  };

  const handleSetRole = async (username: string, newRole: UserRole) => {
    const userToChange = users.find(u => u.username === username);
    if (!userToChange) return;

    if (!canAppointRole(currentUser.role, userToChange.role) || !canAppointRole(currentUser.role, newRole)) {
      alert(`You do not have administrative authority to set roles or change the role to ${newRole}.`);
      return;
    }

    await db.users.update(username, { role: newRole });
    loadAllUsers();
  };

  const handleToggleFeatureAccess = async (username: string, featureId: string, enabled: boolean) => {
    const user = users.find(u => u.username === username);
    if (!user) return;
    const currentCustom = user.customPermissions || {};
    const prevFeature = currentCustom[featureId as keyof typeof currentCustom] || { hasAccess: false, mode: 'view' };
    
    const updatedCustom = {
      ...currentCustom,
      [featureId]: {
        ...prevFeature,
        hasAccess: enabled
      }
    };
    
    await db.users.update(username, { customPermissions: updatedCustom as any });
    loadAllUsers();
  };

  const handleSetFeatureMode = async (username: string, featureId: string, newMode: 'view' | 'edit') => {
    const user = users.find(u => u.username === username);
    if (!user) return;
    const currentCustom = user.customPermissions || {};
    const prevFeature = currentCustom[featureId as keyof typeof currentCustom] || { hasAccess: false, mode: 'view' };
    
    const updatedCustom = {
      ...currentCustom,
      [featureId]: {
        ...prevFeature,
        mode: newMode
      }
    };
    
    await db.users.update(username, { customPermissions: updatedCustom as any });
    loadAllUsers();
  };

  if (loading) {
    return <div className="text-center p-8 text-farm-muted">Loading user accounts...</div>;
  }

  const pending = users.filter(u => !u.approved);
  const active = users.filter(u => u.approved);

  const APP_FEATURES = [
    { id: 'pos', name: 'Weigh POS Terminal', icon: '₱' },
    { id: 'inventory', name: 'Stock Inventories', icon: '📦' },
    { id: 'accounting', name: 'Accounting Ledgers', icon: '📈' },
    { id: 'schedules', name: 'Schedules & Plans', icon: '📅' },
    { id: 'projects', name: 'Projects & Campaigns', icon: '🌿' },
    { id: 'payroll', name: 'Payroll & Salaries', icon: '👥' },
  ];

  return (
    <div className="space-y-6">
      {/* Pending Approval List */}
      <div className="bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-6">
        <h3 className="text-lg font-bold text-farm-green mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-500" />
          <span>Pending Account Approvals</span>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
              {pending.length} New
            </span>
          )}
        </h3>

        {pending.length === 0 ? (
          <p className="text-sm text-farm-muted py-4">No pending registration requests to show.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-farm-accent-soft text-left text-xs text-farm-muted font-bold tracking-wider">
                  <th className="pb-3">Username</th>
                  <th className="pb-3">Requested Role</th>
                  <th className="pb-3">Registered At</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-farm-accent-soft text-sm">
                {pending.map(u => (
                  <tr key={u.username} className="hover:bg-farm-bg/30">
                    <td className="py-3 font-semibold text-farm-ink font-mono">{u.username}</td>
                    <td className="py-3">
                      <span className="px-2 py-0.5 rounded bg-farm-accent-soft text-farm-green text-xs font-semibold">
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 text-xs text-farm-muted">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleApprove(u.username)}
                          disabled={!canAppointRole(currentUser.role, u.role)}
                          className="bg-farm-green hover:bg-farm-green-700 text-white hover:text-white rounded-lg px-3 py-1.5 text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Check className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => handleDisapprove(u.username)}
                          disabled={!canAppointRole(currentUser.role, u.role)}
                          className="bg-red-50 hover:bg-red-100 text-farm-danger rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Active Users Directory */}
      <div className="bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-6">
        <h3 className="text-lg font-bold text-farm-green mb-4">Active POS Users Directory</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-farm-accent-soft text-left text-xs text-farm-muted font-bold tracking-wider">
                <th className="pb-3">Username</th>
                <th className="pb-3">Assigned Role</th>
                <th className="pb-3">Role Authority</th>
                <th className="pb-3">Custom Rights</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-farm-accent-soft text-sm">
              {active.map(u => {
                const permsCount = Object.values(u.customPermissions || {}).filter((p: any) => p && p.hasAccess).length;
                return (
                  <React.Fragment key={u.username}>
                    <tr className="hover:bg-farm-bg/30">
                      <td className="py-3 font-semibold text-farm-ink font-mono flex items-center gap-2">
                        {u.username}
                        {u.username === currentUser.username && (
                          <span className="px-1.5 py-0.5 text-[8px] bg-farm-green text-white font-bold rounded">YOU</span>
                        )}
                      </td>
                      <td className="py-3">
                        {canAppointRole(currentUser.role, u.role) ? (
                          <select
                            value={u.role}
                            onChange={(e) => handleSetRole(u.username, e.target.value as UserRole)}
                            className="p-1 border border-farm-accent-soft rounded bg-farm-bg text-xs font-semibold focus:outline-none"
                          >
                            <option value="Employee">Employee</option>
                            <option value="Operator">Operator</option>
                            <option value="Admin">Admin</option>
                            <option value="Co-Owner">Co-Owner</option>
                            <option value="Owner">Owner</option>
                            <option value="Developer">Developer</option>
                          </select>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-farm-green text-white text-xs font-semibold">
                            {u.role}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-xs text-farm-muted">
                        {u.role === 'Developer' && 'Absolute full rights to all tables'}
                        {u.role === 'Owner' && 'Appoint roles, view and edit accounts & ledgers'}
                        {u.role === 'Co-Owner' && 'Appoint roles, edit POS, ledgers, & payroll'}
                        {u.role === 'Admin' && 'POS access, ledger bookkeeping, print slip outputs'}
                        {u.role === 'Operator' && 'Data entry inputs, POS cashier, view payroll sheets'}
                        {u.role === 'Employee' && 'Enter individual sales only, check pay periods'}
                      </td>
                      <td className="py-3 text-xs">
                        {permsCount > 0 ? (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold">
                            {permsCount} overrides
                          </span>
                        ) : (
                          <span className="text-farm-muted text-stone-400">Default permissions</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => {
                              setEditingPermissionsUser(
                                editingPermissionsUser === u.username ? null : u.username
                              );
                            }}
                            className={`p-1 px-2 rounded text-xs font-semibold border transition cursor-pointer ${editingPermissionsUser === u.username ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-farm-bg text-farm-green hover:bg-farm-accent-soft border-farm-accent'}`}
                          >
                            Set Permissions
                          </button>
                          {u.username !== currentUser.username && (u.role !== 'Developer' || currentUser.role === 'Developer') && (
                            <button
                              onClick={() => handleDisapprove(u.username)}
                              disabled={!canAppointRole(currentUser.role, u.role)}
                              className="p-1 px-2 rounded bg-red-50 hover:bg-red-100 text-farm-danger text-xs font-semibold border border-red-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Permissions Custom override check list row */}
                    {editingPermissionsUser === u.username && (
                      <tr className="bg-farm-bg/40">
                        <td colSpan={5} className="p-4 border-l-4 border-indigo-600 bg-stone-50">
                          <div className="space-y-4">
                            <div>
                              <h4 className="text-sm font-bold text-indigo-900 flex items-center gap-1.5">
                                <span>🔑 Granular Custom Feature Permissions Override:</span>
                                <span className="font-mono text-xs bg-indigo-100 px-1.5 py-0.5 rounded text-indigo-850 font-bold">{u.username}</span>
                              </h4>
                              <p className="text-[11px] text-farm-muted leading-relaxed mt-1">
                                Check individual features below to grant explicit access irrespective of global role. Manage whether this account can perform active additions/modifications or only view read-only components.
                              </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {APP_FEATURES.map(f => {
                                const currentPerm = (u.customPermissions || {})[f.id as keyof typeof u.customPermissions] || { hasAccess: false, mode: 'view' };
                                return (
                                  <div key={f.id} className="p-3 bg-white border border-stone-200 rounded-xl hover:shadow-sm transition flex flex-col justify-between">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-bold text-farm-slate flex items-center gap-1.5">
                                        <span>{f.icon}</span>
                                        <span>{f.name}</span>
                                      </span>
                                      <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={currentPerm.hasAccess}
                                          onChange={(e) => handleToggleFeatureAccess(u.username, f.id, e.target.checked)}
                                          className="sr-only peer"
                                        />
                                        <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                                      </label>
                                    </div>

                                    {currentPerm.hasAccess && (
                                      <div className="mt-2 pt-2 border-t border-stone-100 flex items-center justify-between">
                                        <span className="text-[10px] uppercase font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">Access Enabled</span>
                                        <select
                                          value={currentPerm.mode}
                                          onChange={(e) => handleSetFeatureMode(u.username, f.id, e.target.value as 'view' | 'edit')}
                                          className="text-xs font-semibold p-1 border border-stone-200 rounded bg-stone-50 text-stone-700 outline-none"
                                        >
                                          <option value="view">🔴 View Only</option>
                                          <option value="edit">🟢 Edit &amp; Manage</option>
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            <div className="flex justify-between items-center text-[10px] text-stone-500 bg-stone-100 p-2 rounded-lg">
                              <span>Note: Stored securely in Dexie IndexedDB. Changes take effect on active refresh.</span>
                              <button
                                onClick={() => setEditingPermissionsUser(null)}
                                className="text-indigo-600 hover:underline font-extrabold"
                              >
                                Collapse Panel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

