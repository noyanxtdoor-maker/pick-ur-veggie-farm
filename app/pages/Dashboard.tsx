// Owner/Admin dashboard (M1C §8.2). Card-based: company status, branch count, members, pending invitations,
// quick actions, recent activity. Each widget gated by its own read permission (A3).
import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {Building2, Mailbox, Plus, ShieldPlus, UserPlus} from 'lucide-react';
import {supabase} from '../core/supabase/client';
import {offlineDB} from '../core/offline/db';
import {usePermissions} from '../core/permissions/permissions';
import {ActionTile, Card, PageHeader, StatCard} from '../components/ui';
import {StatusBadge} from '../components/feedback';

export default function Dashboard() {
  const {companyId, has} = usePermissions();
  const navigate = useNavigate();
  const [members, setMembers] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  const company = useLiveQuery(async () => (companyId ? offlineDB.companies.get(companyId) : undefined), [companyId]);
  const branchCount = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).count() : 0), [companyId], 0);

  useEffect(() => {
    if (!companyId) return;
    if (has('membership.read')) {
      supabase.from('user_branch_roles').select('*', {count: 'exact', head: true}).eq('company_id', companyId)
        .then(({count}) => setMembers(count ?? 0)).then(undefined, () => setMembers(null));
    }
    if (has('user.invite')) {
      supabase.from('invitations').select('*', {count: 'exact', head: true}).eq('company_id', companyId).eq('status', 'Pending')
        .then(({count}) => setPending(count ?? 0)).then(undefined, () => setPending(null));
    }
  }, [companyId, has]);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={company ? `${company.name} · ${company.company_code}` : 'Your organization at a glance'} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Company" value={company ? <StatusBadge status={company.status} /> : '—'} hint={company?.base_currency_code} />
        <StatCard label="Branches" value={branchCount ?? 0} />
        <StatCard label="Members" value={has('membership.read') ? (members ?? '—') : '—'} hint={has('membership.read') ? undefined : 'No access'} />
        <StatCard label="Pending invites" value={has('user.invite') ? (pending ?? '—') : '—'} hint={has('user.invite') ? undefined : 'No access'} />
      </div>

      <Card>
        <h2 className="mb-3 text-xl font-bold">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ActionTile label="Open Company" icon={<Building2 size={28} aria-hidden />} onClick={() => navigate('/organization/company')} />
          <ActionTile label="Create Branch" icon={<Plus size={28} aria-hidden />} disabled={!has('branch.manage')} onClick={() => navigate('/organization/branches')} />
          <ActionTile label="Invite User" icon={<UserPlus size={28} aria-hidden />} disabled={!has('user.invite')} onClick={() => navigate('/organization/invitations')} />
          <ActionTile label="Create Role" icon={<ShieldPlus size={28} aria-hidden />} disabled={!has('role.manage')} onClick={() => navigate('/organization/roles')} />
        </div>
      </Card>

      {!has('membership.read') && !has('user.invite') ? (
        <p className="mt-6 flex items-center gap-2 text-base text-slate-500"><Mailbox size={18} aria-hidden /> Some widgets are hidden because your role doesn't grant access.</p>
      ) : null}
    </div>
  );
}
