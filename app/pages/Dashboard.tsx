// Owner/Admin dashboard. M2D (Phase_2_M2D_Dashboard_Reporting_Spec.md): operational sales KPIs, 7-day trend,
// period breakdowns (split/discounts/top products/by branch/by cashier), recent-sales stream — all reads over the
// canonical M2B/M2C objects (or the device cache in mock/offline, honestly labeled). Voided sales are excluded.
// Org widgets (M1C §8.2) remain, each gated by its own read permission (A3).
import {useEffect, useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {Activity, ArrowRight, Building2, ClipboardList, Mailbox, Plus, ShoppingCart, TrendingUp, UserPlus, Wallet} from 'lucide-react';
import {Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {supabase} from '../core/supabase/client';
import {offlineDB} from '../core/offline/db';
import {hydrateBranches, hydrateCompany} from '../core/offline/hydrate';
import {useRealtimeRefresh} from '../core/offline/realtime';
import {useSync} from '../core/offline/sync';
import {usePermissions} from '../core/permissions/permissions';
import {MOCK_MODE} from '../core/mock/mock';
import {posApi} from '../features/pos/api';
import {inventoryApi} from '../features/inventory/api';
import {authApi} from '../features/auth/api';
import {payrollApi} from '../features/payroll/api';
import {projectsApi} from '../features/projects/api';
import {summarizeSales, type PeriodDays, type SalesReport} from '../features/pos/report';
import {ActionTile, Card, cn, PageHeader, StatCard} from '../components/ui';
import {EmptyState, ErrorState, StatusBadge} from '../components/feedback';
import {formatPeso} from '../features/pos/money';
import type {Employee, Project, WagePayment} from '../types/db';

const PERIODS: Array<{days: PeriodDays; label: string}> = [
  {days: 1, label: 'Today'},
  {days: 7, label: '7 days'},
  {days: 30, label: '30 days'},
];

export default function Dashboard() {
  const {companyId, has} = usePermissions();
  const {refreshTick} = useSync();
  const navigate = useNavigate();
  const [members, setMembers] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodDays>(7);

  useEffect(() => {if (companyId) hydrateBranches(companyId);}, [companyId]);
  useEffect(() => {if (companyId) hydrateCompany(companyId);}, [companyId]);
  const company = useLiveQuery(async () => (companyId ? offlineDB.companies.get(companyId) : undefined), [companyId]);
  const branchCount = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).count() : 0), [companyId], 0);

  // Low-Stock tile (M3B — the prototype KPI reserved in M2D): materials at/below their reorder level.
  const [lowStock, setLowStock] = useState<number | null>(null);
  useEffect(() => {
    if (!companyId) return;
    offlineDB.branches.where('company_id').equals(companyId).toArray()
      .then((bs) => inventoryApi.lowStockCount(companyId, bs.map((b) => b.id)))
      .then(setLowStock)
      .catch(() => setLowStock(null));
  }, [companyId]);

  // Owner directive (2026-07-19): a branch member with no accounting.read (Employee tier, by default)
  // was seeing full branch revenue/receivables/discounts and every cashier's sales history below —
  // the underlying RLS is branch-membership-gated, not role-gated, so nothing stopped it client-side.
  // accounting.read is this app's existing "can see money" signal (already gates the Accounting module
  // + the POS journal's CSV export) — reusing it here keeps this permission-driven, not a hardcoded
  // role name, so it tracks whatever the owner has actually granted via the Roles tab. Below that gate,
  // the dashboard shows only what's genuinely theirs to see: stock alerts, their own pay record, and
  // the branch's active projects — never branch-wide money.
  const canSeeFinancials = has('accounting.read');
  const canSeeAnyPayroll = has('payroll.read'); // mirrors PayrollScreen's MyPayroll gate — only render "my wage" when RLS actually narrows fetchEmployees() to just this user's own linked row
  const [myEmployee, setMyEmployee] = useState<Employee | null | undefined>(undefined); // undefined=loading, null=not linked
  const [myWages, setMyWages] = useState<WagePayment[]>([]);
  const [activeProjects, setActiveProjects] = useState<Project[] | null>(null);
  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  useEffect(() => {
    if (!companyId || canSeeFinancials) return;
    if (!canSeeAnyPayroll) {
      payrollApi.fetchEmployees(companyId).then(async (rows) => {
        const mine = rows[0] ?? null; // RLS returns at most the caller's own linked row when payroll.read is absent
        setMyEmployee(mine);
        if (mine) setMyWages(await payrollApi.fetchEmployeeWages(companyId, mine.id).catch(() => []));
      }).catch(() => setMyEmployee(null));
    }
  }, [companyId, canSeeFinancials, canSeeAnyPayroll]);
  useEffect(() => {
    if (!companyId || canSeeFinancials || !branches || branches.length === 0) return;
    Promise.all(branches.map((b) => projectsApi.fetchProjects(companyId, b.id)))
      .then((rows) => setActiveProjects(rows.flat().filter((p) => p.status === 'In Progress')))
      .catch(() => setActiveProjects([]));
  }, [companyId, canSeeFinancials, branches]);

  const loadReport = (cid: string) => {
    setReportError(null);
    posApi.fetchSalesReport(cid).then(setReport).catch((e: Error) => setReportError(e.message));
  };
  useEffect(() => {
    if (companyId) loadReport(companyId);
  }, [companyId, refreshTick]); // refreshTick: manual sync (top-bar wifi tap)
  useRealtimeRefresh([{table: 'invoices'}], companyId, () => {if (companyId) loadReport(companyId);}); // P1K: a sale made on another device shows up here without a manual refresh

  const summary = useMemo(() => (report ? summarizeSales(report.sales, new Date(), period) : null), [report, period]);
  const scopeHint = report?.source === 'canonical' ? 'your branches' : 'this device';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // cashier is a user id in canonical mode (resolved via userNames under user.read) or a display-name snapshot from the device cache
  const cashierLabel = (cashier: string | null) =>
    cashier === null ? 'This device' : report?.userNames[cashier] ?? (UUID_RE.test(cashier) ? `Cashier …${cashier.slice(-4)}` : cashier);
  const recent = (report?.sales ?? []).slice(0, 5);

  useEffect(() => {
    if (!companyId) return;
    if (MOCK_MODE) {
      offlineDB.memberships.where('company_id').equals(companyId).count().then(setMembers);
      authApi.listPendingUsers().then((rows) => setPending(rows.length));
      return;
    }
    if (has('membership.read')) {
      supabase.from('user_branch_roles').select('*', {count: 'exact', head: true}).eq('company_id', companyId)
        .then(({count}) => setMembers(count ?? 0)).then(undefined, () => setMembers(null));
      authApi.listPendingUsers().then((rows) => setPending(rows.length)).catch(() => setPending(null));
    }
  }, [companyId, has, refreshTick]); // refreshTick: manual sync (top-bar wifi tap)

  return (
    <div>
      <PageHeader title="Home Dashboard" subtitle={company ? `${company.name} · ${company.company_code}` : 'Your farm at a glance'} />

      {/* Operational KPIs (prototype Home Dashboard; voided excluded, receivables = open balance) —
          revenue/receivables are accounting.read-gated (below); Low Stock stays visible either way,
          it's operational, not financial. */}
      <div className={cn('mb-4 grid gap-4', canSeeFinancials ? 'sm:grid-cols-2 xl:grid-cols-5' : 'sm:grid-cols-2')}>
        {canSeeFinancials ? (
          <>
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
          </>
        ) : null}
        <button onClick={() => navigate('/inventory')} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-farm-green-500">
          <StatCard
            label="Low Stock Alerts"
            value={<span className={lowStock ? 'text-farm-danger' : undefined}>{lowStock ?? '—'}</span>}
            hint={lowStock ? 'materials need reorder restock' : 'all materials sufficient'}
          />
        </button>
      </div>

      {!canSeeFinancials ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-6">
            <h2 className="mb-3 flex items-center gap-2 text-xl font-bold text-farm-green"><Wallet size={20} aria-hidden /> My Pay</h2>
            {myEmployee === undefined ? (
              <p className="text-base text-farm-muted">Loading…</p>
            ) : myEmployee === null ? (
              <EmptyState title="No staff profile linked yet" hint="Ask a manager to link your app account to your staff record — your wage history appears here once they do." />
            ) : (
              <>
                <dl className="mb-3 grid grid-cols-2 gap-3 text-base">
                  <div><dt className="text-farm-muted">Daily rate</dt><dd className="tabular text-xl font-black text-farm-green">{formatPeso(myEmployee.daily_rate)}</dd></div>
                  <div><dt className="text-farm-muted">Advance to repay</dt><dd className={cn('tabular text-xl font-black', myEmployee.advance_balance > 0 ? 'text-farm-danger' : 'text-farm-green')}>{formatPeso(myEmployee.advance_balance)}</dd></div>
                </dl>
                <h3 className="mb-1 text-sm font-black uppercase tracking-wider text-farm-muted">Recent wage payments</h3>
                {myWages.length > 0 ? (
                  <ul className="divide-y divide-farm-accent-soft">
                    {myWages.slice(0, 5).map((w) => (
                      <li key={w.id} className="flex items-center justify-between py-1.5 text-base">
                        <span className="font-semibold text-farm-ink">{w.pay_period}</span>
                        <span className="text-farm-muted">{new Date(w.created_at).toLocaleDateString('en-PH')} · <span className="font-bold text-farm-green">{formatPeso(w.net)}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-2 text-base text-farm-muted">No wage payments recorded yet.</p>
                )}
              </>
            )}
          </Card>
          <Card className="lg:col-span-6">
            <h2 className="mb-3 flex items-center gap-2 text-xl font-bold text-farm-green"><ClipboardList size={20} aria-hidden /> Active Projects</h2>
            {activeProjects === null ? (
              <p className="text-base text-farm-muted">Loading…</p>
            ) : activeProjects.length > 0 ? (
              <ul className="divide-y divide-farm-accent-soft">
                {activeProjects.map((p) => (
                  <li key={p.id} className="py-1.5 text-base">
                    <span className="font-semibold text-farm-ink">{p.name}</span>
                    {p.end_date ? <span className="ml-2 text-farm-muted">due {new Date(p.end_date).toLocaleDateString('en-PH')}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-base text-farm-muted">No active projects right now.</p>
            )}
          </Card>
        </div>
      ) : reportError ? (
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
                <div className="flex justify-between"><dt className="text-farm-muted">Retail / Wholesale</dt><dd className="font-bold text-farm-ink">{formatPeso(summary?.retail.total ?? 0)} / {formatPeso(summary?.wholesale.total ?? 0)}</dd></div>
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
                      <li key={c.cashier ?? 'device'} className="flex items-center justify-between py-1.5 text-base">
                        <span className="font-semibold text-farm-ink">{cashierLabel(c.cashier)}</span>
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

      {/* Organization widgets (M1C §8.2) — admin+ only (ported from Team B, owner 2026-07-16: the
          owner's own pasted screenshot named this entire block, Quick actions included, as "must
          not be visible to operator and below"). membership.read is the cleanest admin+ proxy —
          per the P1C 5-tier seed, employee/operator do not hold it, admin+ does. Operators keep
          full POS access via the main nav sidebar regardless; this only removes the dashboard
          shortcut duplicate. */}
      {has('membership.read') ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Company" value={company ? <StatusBadge status={company.status} /> : '—'} hint={company?.company_code} />
            <StatCard label="Branches" value={branchCount ?? 0} hint={company?.base_currency_code} />
            <StatCard label="Members" value={members ?? '—'} />
            <StatCard label="Pending approvals" value={pending ?? '—'} />
          </div>

          <Card>
            <h2 className="mb-3 text-xl font-bold text-farm-green">Quick actions</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <ActionTile label="Weigh a Sale" icon={<ShoppingCart size={28} aria-hidden />} disabled={!has('pos.sell')} onClick={() => navigate('/pos')} />
              <ActionTile label="Open Company" icon={<Building2 size={28} aria-hidden />} onClick={() => navigate('/organization/company')} />
              <ActionTile label="Create Branch" icon={<Plus size={28} aria-hidden />} disabled={!has('branch.manage')} onClick={() => navigate('/organization/branches')} />
              <ActionTile label="Review Approvals" icon={<UserPlus size={28} aria-hidden />} disabled={!has('membership.read')} onClick={() => navigate('/organization/approvals')} />
            </div>
          </Card>
        </>
      ) : null}

      {!has('membership.read') && !has('user.invite') ? (
        <p className="mt-6 flex items-center gap-2 text-base text-farm-muted"><Mailbox size={18} aria-hidden /> Some widgets are hidden because your role doesn't grant access.</p>
      ) : null}
    </div>
  );
}
