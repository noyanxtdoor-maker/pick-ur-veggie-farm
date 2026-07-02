// Owner/Admin dashboard (M1C §8.2). Card-based: company status, branch count, members, pending invitations,
// quick actions, recent activity. Each widget gated by its own read permission (A3).
import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {Building2, Mailbox, Plus, ShoppingCart, UserPlus} from 'lucide-react';
import {supabase} from '../core/supabase/client';
import {offlineDB} from '../core/offline/db';
import {usePermissions} from '../core/permissions/permissions';
import {MOCK_MODE} from '../core/mock/mock';
import {ActionTile, Card, PageHeader, StatCard} from '../components/ui';
import {StatusBadge} from '../components/feedback';
import {formatPeso, round2} from '../features/pos/money';

export default function Dashboard() {
  const {companyId, has} = usePermissions();
  const navigate = useNavigate();
  const [members, setMembers] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  const company = useLiveQuery(async () => (companyId ? offlineDB.companies.get(companyId) : undefined), [companyId]);
  const branchCount = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).count() : 0), [companyId], 0);

  // Operational KPIs (prototype Home Dashboard): today's sales from the local sales cache.
  const today = new Date().toISOString().slice(0, 10);
  const todaySales = useLiveQuery(
    async () => (companyId ? offlineDB.posInvoices.where('company_id').equals(companyId).filter((i) => i.created_at.slice(0, 10) === today).toArray() : []),
    [companyId, today],
  );
  const salesVolume = round2((todaySales ?? []).reduce((s, i) => s + i.total, 0));
  const orderCount = (todaySales ?? []).length;
  const pendingSync = (todaySales ?? []).filter((i) => i.status === 'PendingSync').length;
  const topProduct = (() => {
    const m = new Map<string, number>();
    for (const inv of todaySales ?? []) for (const l of inv.lines) m.set(l.name, (m.get(l.name) ?? 0) + l.line_total);
    let best: string | null = null;
    let bestV = 0;
    for (const [k, v] of m) if (v > bestV) {best = k; bestV = v;}
    return best;
  })();

  useEffect(() => {
    if (!companyId) return;
    if (MOCK_MODE) {
      offlineDB.memberships.where('company_id').equals(companyId).count().then(setMembers);
      offlineDB.invitations.where('company_id').equals(companyId).filter((i) => i.status === 'Pending').count().then(setPending);
      return;
    }
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
      <PageHeader title="Home Dashboard" subtitle={company ? `${company.name} · ${company.company_code}` : 'Your farm at a glance'} />

      {/* Operational KPIs first (prototype Home Dashboard) */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Daily Sales Volume" value={formatPeso(salesVolume)} hint={pendingSync > 0 ? `${pendingSync} pending sync` : 'today, this device'} />
        <StatCard label="Market Orders" value={orderCount} hint="sales today" />
        <StatCard label="Top Crop Today" value={topProduct ?? '—'} hint={topProduct ? 'by sales value' : 'no sales yet'} />
        <StatCard label="Branches" value={branchCount ?? 0} hint={company?.base_currency_code} />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Company" value={company ? <StatusBadge status={company.status} /> : '—'} hint={company?.company_code} />
        <StatCard label="Members" value={has('membership.read') ? (members ?? '—') : '—'} hint={has('membership.read') ? undefined : 'No access'} />
        <StatCard label="Pending invites" value={has('user.invite') ? (pending ?? '—') : '—'} hint={has('user.invite') ? undefined : 'No access'} />
      </div>

      <Card>
        <h2 className="mb-3 text-xl font-bold text-farm-green">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ActionTile label="Weigh a Sale" icon={<ShoppingCart size={28} aria-hidden />} disabled={!has('pos.sell')} onClick={() => navigate('/pos')} />
          <ActionTile label="Open Company" icon={<Building2 size={28} aria-hidden />} onClick={() => navigate('/organization/company')} />
          <ActionTile label="Create Branch" icon={<Plus size={28} aria-hidden />} disabled={!has('branch.manage')} onClick={() => navigate('/organization/branches')} />
          <ActionTile label="Invite User" icon={<UserPlus size={28} aria-hidden />} disabled={!has('user.invite')} onClick={() => navigate('/organization/invitations')} />
        </div>
      </Card>

      {!has('membership.read') && !has('user.invite') ? (
        <p className="mt-6 flex items-center gap-2 text-base text-farm-muted"><Mailbox size={18} aria-hidden /> Some widgets are hidden because your role doesn't grant access.</p>
      ) : null}
    </div>
  );
}
