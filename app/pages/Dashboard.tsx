// Owner/Admin dashboard. M2D (Phase_2_M2D_Dashboard_Reporting_Spec.md): operational sales KPIs, 7-day trend,
// period breakdowns (split/discounts/top products/by branch/by cashier), recent-sales stream — all reads over the
// canonical M2B/M2C objects (or the device cache in mock/offline, honestly labeled). Voided sales are excluded.
// Org widgets (M1C §8.2) remain, each gated by its own read permission (A3).
import {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {Activity, ArrowRight, Building2, Mailbox, Plus, ShoppingCart, TrendingUp, UserPlus} from 'lucide-react';
import {Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {supabase} from '../core/supabase/client';
import {offlineDB} from '../core/offline/db';
import {usePermissions} from '../core/permissions/permissions';
import {MOCK_MODE} from '../core/mock/mock';
import {posApi} from '../features/pos/api';
import {summarizeSales, type PeriodDays, type SalesReport} from '../features/pos/report';
import {ActionTile, Card, cn, PageHeader, StatCard} from '../components/ui';
import {ErrorState, StatusBadge} from '../components/feedback';
import {formatPeso} from '../features/pos/money';

const PERIODS: Array<{days: PeriodDays; label: string}> = [
  {days: 1, label: 'Today'},
  {days: 7, label: '7 days'},
  {days: 30, label: '30 days'},
];

export default function Dashboard() {
  const {companyId, has} = usePermissions();
  const navigate = useNavigate();
  const [members, setMembers] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodDays>(7);

  const company = useLiveQuery(async () => (companyId ? offlineDB.companies.get(companyId) : undefined), [companyId]);
  const branchCount = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).count() : 0), [companyId], 0);

  const loadReport = (cid: string) => {
    setReportError(null);
    posApi.fetchSalesReport(cid).then(setReport).catch((e: Error) => setReportError(e.message));
  };
  useEffect(() => {
    if (companyId) loadReport(companyId);
  }, [companyId]);

  const summary = useMemo(() => (report ? summarizeSales(report.sales, new Date(), period) : null), [report, period]);
  const scopeHint = report?.source === 'canonical' ? 'your branches' : 'this device';
  const cashierLabel = (userId: string | null) =>
    userId === null ? 'This device' : report?.userNames[userId] ?? `Cashier …${userId.slice(-4)}`;
  const recent = (report?.sales ?? []).slice(0, 5);

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

      {/* Operational KPIs (prototype Home Dashboard; voided excluded, receivables = open balance) */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Daily Sales Volume"
          value={formatPeso(summary?.todayVolume ?? 0)}
          hint={summary && summary.todayPendingSync > 0 ? `today · ${scopeHint} · ${summary.todayPendingSync} pending sync` : `today · ${scopeHint}`}
        />
        <StatCard label="Market Orders" value={summary?.todayOrders ?? 0} hint="sales today" />
        <StatCard label="Top Crop Today" value={summary?.topProductToday ?? '—'} hint={summary?.topProductToday ? 'by sales value' : 'no sales yet'} />
        <StatCard
          label="Outstanding Receivables"
          value={formatPeso(summary?.receivablesTotal ?? 0)}
          hint={summary?.receivablesCount ? `${summary.receivablesCount} unpaid pre-order${summary.receivablesCount === 1 ? '' : 's'}` : 'no open pre-orders'}
        />
      </div>

      {reportError ? (
        <Card className="mb-6"><ErrorState message={`Sales report failed: ${reportError}`} onRetry={companyId ? () => loadReport(companyId) : undefined} /></Card>
      ) : (
        <>
          {/* Trend + period breakdowns */}
          <div className="mb-4 grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <h2 className="flex items-center gap-2 text-xl font-bold text-farm-green"><TrendingUp size={20} aria-hidden /> 7-Day Sales Volume Trend</h2>
              <p className="mb-3 text-base text-farm-muted">Daily receipts, {scopeHint}</p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary?.trend7d ?? []} margin={{top: 10, right: 10, left: -10, bottom: 0}}>
                    <defs>
                      <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-farm-green-500)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--color-farm-green)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-farm-accent-soft)" />
                    <XAxis dataKey="day" stroke="var(--color-farm-muted)" fontSize={12} fontWeight="bold" />
                    <YAxis stroke="var(--color-farm-muted)" fontSize={12} fontWeight="bold" />
                    <Tooltip
                      formatter={(v) => formatPeso(Number(Array.isArray(v) ? v[0] : v))}
                      labelFormatter={(_, p) => (p?.[0]?.payload as {date?: string} | undefined)?.date ?? ''}
                      contentStyle={{borderRadius: '12px', border: '1px solid var(--color-farm-accent)', fontSize: '13px', fontWeight: 'bold'}}
                    />
                    <Area type="monotone" dataKey="sales" name="Sales" stroke="var(--color-farm-green)" strokeWidth={2.5} fill="url(#salesFill)" activeDot={{r: 5}} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="lg:col-span-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-xl font-bold text-farm-green">Sales Insights</h2>
                <div className="flex rounded-xl border border-farm-accent bg-farm-bg p-1" role="group" aria-label="Report period">
                  {PERIODS.map((p) => (
                    <button
                      key={p.days}
                      onClick={() => setPeriod(p.days)}
                      aria-pressed={period === p.days}
                      className={cn(
                        'min-h-9 rounded-lg px-3 text-sm font-bold transition-colors',
                        period === p.days ? 'bg-farm-green text-white' : 'text-farm-muted hover:text-farm-green',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <dl className="space-y-2 text-base">
                <div className="flex justify-between"><dt className="text-farm-muted">Paid sales</dt><dd className="font-bold text-farm-ink">{summary?.paid.count ?? 0} · {formatPeso(summary?.paid.total ?? 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-farm-muted">Pre-orders (unpaid)</dt><dd className="font-bold text-farm-ink">{summary?.preorder.count ?? 0} · {formatPeso(summary?.preorder.total ?? 0)}</dd></div>
                {summary && summary.pendingSync.count > 0 ? (
                  <div className="flex justify-between"><dt className="text-farm-muted">Pending sync</dt><dd className="font-bold text-amber-700">{summary.pendingSync.count} · {formatPeso(summary.pendingSync.total)}</dd></div>
                ) : null}
                <div className="flex justify-between"><dt className="text-farm-muted">Discounts given</dt><dd className="font-bold text-farm-ink">{formatPeso(summary?.discountGiven ?? 0)}</dd></div>
                <div className="flex justify-between"><dt className="text-farm-muted">Delivery fees</dt><dd className="font-bold text-farm-ink">{formatPeso(summary?.deliveryFees ?? 0)}</dd></div>
              </dl>
              <h3 className="mb-1 mt-4 text-sm font-black uppercase tracking-wider text-farm-muted">Top vegetables</h3>
              {summary && summary.topProducts.length > 0 ? (
                <ul className="divide-y divide-farm-accent-soft">
                  {summary.topProducts.map((p) => (
                    <li key={p.name} className="flex items-center justify-between py-1.5 text-base">
                      <span className="font-semibold text-farm-ink">{p.name}</span>
                      <span className="text-farm-muted">{p.kg.toFixed(2)} kg · <span className="font-bold text-farm-green">{formatPeso(p.peso)}</span></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-base text-farm-muted">No sales in this period.</p>
              )}
            </Card>
          </div>

          {/* Recent stream + branch/cashier breakdowns */}
          <div className="mb-6 grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-xl font-bold text-farm-green"><Activity size={20} aria-hidden /> Recent Sales</h2>
                <button onClick={() => navigate('/pos')} className="flex items-center gap-1 text-base font-bold text-farm-green hover:underline">
                  View Journal <ArrowRight size={16} aria-hidden />
                </button>
              </div>
              {recent.length > 0 ? (
                <ul className="divide-y divide-dashed divide-farm-accent-soft">
                  {recent.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold text-farm-ink">
                          {s.lines.length > 0 ? s.lines.map((l) => `${l.name} (${l.weight_kg}kg)`).join(', ') : `Slip ${s.invoice_number ?? '(pending)'}`}
                        </p>
                        <p className="text-sm text-farm-muted">Slip #{s.invoice_number ?? '—'} · {new Date(s.created_at).toLocaleString()}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-3">
                        <span className="text-base font-black text-farm-green">{formatPeso(s.total)}</span>
                        <StatusBadge status={s.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-base text-farm-muted">No sales recorded yet — weigh your first sale to see it here.</p>
              )}
            </Card>

            <div className="grid gap-4 lg:col-span-5">
              <Card>
                <h3 className="mb-2 text-sm font-black uppercase tracking-wider text-farm-muted">Sales by branch ({PERIODS.find((p) => p.days === period)?.label})</h3>
                {summary && summary.byBranch.length > 0 ? (
                  <ul className="divide-y divide-farm-accent-soft">
                    {summary.byBranch.map((b) => (
                      <li key={b.branchId} className="flex items-center justify-between py-1.5 text-base">
                        <span className="font-semibold text-farm-ink">{report?.branchNames[b.branchId] ?? `Branch …${b.branchId.slice(-4)}`}</span>
                        <span className="text-farm-muted">{b.orders} · <span className="font-bold text-farm-green">{formatPeso(b.total)}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-base text-farm-muted">No sales in this period.</p>
                )}
              </Card>
              <Card>
                <h3 className="mb-2 text-sm font-black uppercase tracking-wider text-farm-muted">Sales by cashier ({PERIODS.find((p) => p.days === period)?.label})</h3>
                {summary && summary.byCashier.length > 0 ? (
                  <ul className="divide-y divide-farm-accent-soft">
                    {summary.byCashier.map((c) => (
                      <li key={c.userId ?? 'device'} className="flex items-center justify-between py-1.5 text-base">
                        <span className="font-semibold text-farm-ink">{cashierLabel(c.userId)}</span>
                        <span className="text-farm-muted">{c.orders} · <span className="font-bold text-farm-green">{formatPeso(c.total)}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-base text-farm-muted">No sales in this period.</p>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

      {/* Organization widgets (M1C §8.2) */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Company" value={company ? <StatusBadge status={company.status} /> : '—'} hint={company?.company_code} />
        <StatCard label="Branches" value={branchCount ?? 0} hint={company?.base_currency_code} />
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
