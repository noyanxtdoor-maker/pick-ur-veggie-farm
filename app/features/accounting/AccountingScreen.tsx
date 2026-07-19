// Automated Accounting & Ledger Suite (P2-M4B) — prototype-parity: src/features/Accounting.tsx is the workflow
// authority. Unlike the mock (which recomputes from raw source tables), every figure here reads the REAL posted
// GL (spec Phase_2_M4_Accounting_Module_Spec.md §1) — trial_balance/income_statement_monthly/balance_sheet.
// Tabs: Dashboard (KPIs + trend charts) · Financial Statements (Income Statement/Balance Sheet/Trial Balance/
// Chart of Accounts) · Cash Ledger (log/void non-operating movements). Statement of Cash Flows, Cost Schedule,
// Statement of Operations, Retained Earnings tab, Management Reports, and the GL/vendor ledgers are deferred
// (spec §2 table) — not silently dropped.
import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {AlertCircle, BarChart3, BookOpen, FileText, HelpCircle, Landmark, PieChart, Plus, TrendingUp, Wallet, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {hydrateBranches} from '../../core/offline/hydrate';
import {useSync} from '../../core/offline/sync';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader, StatCard, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {AccountsTab} from './AccountsTab';
import {useLiveQuery} from 'dexie-react-hooks';
import {formatPeso, round2} from '../pos/money';
import {accountingApi} from './api';
import {accountBreakdown, equityRollforward} from './reports';
import type {BalanceSheet, CashEntry, CashEntryCategory, CashFlowDirection, CashFlowLine, IncomeStatementMonth, TrialBalanceRow} from '../../types/db';

const todayISO = () => new Date().toISOString().slice(0, 10);
type Tab = 'dashboard' | 'statements' | 'reports' | 'accounts' | 'cash_ledger';
type Statement = 'income' | 'balance_sheet' | 'cash_flow' | 'trial_balance' | 'chart_accounts';

// Plain-language "what is this?" for each statement (owner ask: a non-accountant should understand every screen).
const STATEMENT_HELP: Record<Statement, string> = {
  income: 'Did the farm earn or lose money over a period? Sales minus what it cost to grow and run the farm. A positive Net Income means profit.',
  balance_sheet: 'A snapshot on one day of what the farm OWNS (cash, stock, equipment) versus what it OWES (loans) — the difference is the owner’s equity. The two sides always match.',
  cash_flow: 'Where cash actually came in and went out — from daily operations, from buying equipment, and from owner money or loans. Ends at your real cash on hand.',
  trial_balance: 'A behind-the-scenes self-check: every account’s debits and credits. The two totals must be equal — that proves the books are balanced and nothing is broken. You rarely need to read it.',
  chart_accounts: 'Simply the list of “money buckets” the farm uses (Cash, Sales, Cost of Goods, Wages…). It’s a directory, not a report.',
};

const IN_CATEGORIES: CashEntryCategory[] = ['Owner Investment', 'Other Income', 'Loan Received'];
const OUT_CATEGORIES: CashEntryCategory[] = ['Loan Payment', "Owner's Drawings"];

export default function AccountingScreen() {
  const {companyId, has} = usePermissions();
  const {refreshTick} = useSync();
  const {notify} = useToast();
  const canRead = has('accounting.read');
  const canManage = has('accounting.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  useEffect(() => {if (companyId) hydrateBranches(companyId);}, [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined); // for the Cash Ledger (writes need a branch)
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);
  const [statementBranch, setStatementBranch] = useState<string>('all'); // statements are company-wide by default (spec §2)

  const [tab, setTab] = useState<Tab>('dashboard');
  const [statement, setStatement] = useState<Statement>('income');
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);

  const [months, setMonths] = useState<IncomeStatementMonth[] | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null);
  const [cashFlow, setCashFlow] = useState<CashFlowLine[] | null>(null);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[] | null>(null);
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const branchFilter = statementBranch === 'all' ? undefined : statementBranch;

  const reload = useCallback(() => {
    if (!companyId || !canRead) return;
    setLoadError(null);
    accountingApi.incomeStatementMonthly(companyId, year, branchFilter).then(setMonths).catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load'));
    accountingApi.balanceSheet(companyId, branchFilter).then(setBalanceSheet).catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load'));
    accountingApi.cashFlowStatement(companyId, branchFilter, year).then(setCashFlow).catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load'));
    accountingApi.trialBalance(companyId, branchFilter).then(setTrialBalance).catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load'));
    if (branchId) accountingApi.fetchCashEntries(companyId, branchId).then(setCashEntries).catch(() => setCashEntries([]));
  }, [companyId, canRead, year, branchFilter, branchId]);
  useEffect(reload, [reload, refreshTick]); // refreshTick: manual sync (top-bar wifi tap) re-fetches this screen

  // ── cash entry log modal ──
  const [logOpen, setLogOpen] = useState(false);
  const [cDate, setCDate] = useState(todayISO());
  const [cFlow, setCFlow] = useState<CashFlowDirection>('in');
  const [cCategory, setCCategory] = useState<CashEntryCategory>('Owner Investment');
  const [cDesc, setCDesc] = useState('');
  const [cAmount, setCAmount] = useState('');
  const [voidTarget, setVoidTarget] = useState<CashEntry | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const yearlyTotals = useMemo(() => {
    const rows = months ?? [];
    return {
      revenue: round2(rows.reduce((s, m) => s + m.total_revenue, 0)),
      cogs: round2(rows.reduce((s, m) => s + m.cogs, 0)),
      netIncome: round2(rows.reduce((s, m) => s + m.net_income, 0)),
    };
  }, [months]);
  const netMargin = yearlyTotals.revenue === 0 ? 0 : yearlyTotals.netIncome / yearlyTotals.revenue;

  // Management reports (M4C) — composed from the already-loaded GL reads; honour the statement branch filter.
  const expenseBreakdown = useMemo(() => accountBreakdown(trialBalance ?? [], 'Expense'), [trialBalance]);
  const revenueBreakdown = useMemo(() => accountBreakdown(trialBalance ?? [], 'Revenue'), [trialBalance]);
  const equity = useMemo(() => (balanceSheet ? equityRollforward(balanceSheet) : null), [balanceSheet]);

  async function submitCashEntry() {
    if (!companyId || !branchId) return;
    const amt = parseFloat(cAmount);
    if (!(amt > 0)) return notify('Enter an amount greater than ₱0.', 'error');
    setBusy(true);
    try {
      await accountingApi.recordCashEntry(companyId, branchId, cDate, cFlow, cCategory, cDesc, amt);
      notify('Cash movement logged');
      setLogOpen(false); setCDesc(''); setCAmount('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Failed to log cash movement', 'error'); } finally { setBusy(false); }
  }

  async function submitVoid() {
    if (!companyId || !voidTarget) return;
    setBusy(true);
    try {
      await accountingApi.voidCashEntry(companyId, voidTarget, voidReason);
      notify('Cash entry voided');
      setVoidTarget(null); setVoidReason('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Void failed', 'error'); } finally { setBusy(false); }
  }

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Automated Accounting &amp; Ledger Suite" />
        <Card><EmptyState title="Accounting access needed" hint="Your role does not include the accounting.read permission. Ask a manager to grant it." /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automated Accounting &amp; Ledger Suite"
        subtitle="Dynamic statements compiled live from the posted general ledger — no manual entry."
        action={
          <div className="w-40">
            <SelectField value={String(year)} onChange={(v) => setYear(Number(v))} options={Array.from({length: 4}, (_, i) => new Date().getFullYear() - i).map((y) => ({value: String(y), label: `Audit Year ${y}`}))} />
          </div>
        }
      />

      <Card className="flex items-start gap-3 border-farm-accent bg-farm-accent-soft/30">
        <HelpCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-farm-green" aria-hidden />
        <p className="text-sm font-semibold text-farm-green-700">
          {tab === 'dashboard' ? 'Company-wide KPIs compiled from every posted sale, purchase, and cash movement — live and always balanced.' : null}
          {tab === 'statements' ? 'Statutory statements read directly from the balanced general ledger. Filter by branch or view the whole company.' : null}
          {tab === 'reports' ? 'Management reports composed live from the same posted ledger — where the money goes, where it comes from, and how equity has changed.' : null}
          {tab === 'accounts' ? 'Every place the farm keeps money — drawer, bank, GCash/Maya — with balances derived live from the ledger. Sales can land in any account; transfers move money between them with no income or expense.' : null}
          {tab === 'cash_ledger' ? "Log cash movements that are NOT crop sales and NOT standard purchases — Owner Investment, Loans, Drawings — to complete the equity and liability picture." : null}
        </p>
      </Card>

      <div className="flex flex-wrap gap-1.5 border-b border-farm-accent pb-0.5" role="tablist">
        {([
          ['dashboard', 'General Ledger Dashboard', BarChart3],
          ['statements', 'Financial Statements', FileText],
          ['reports', 'Management Reports', PieChart],
          ['accounts', 'Cash & Accounts', Landmark],
          ['cash_ledger', 'Cash Flow Inputs', Wallet],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={cn('flex min-h-12 items-center gap-2 rounded-t-xl px-4 text-sm font-bold transition', tab === key ? 'border-x border-t border-farm-accent bg-farm-card text-farm-green' : 'text-farm-muted hover:bg-farm-card/40 hover:text-farm-green')}>
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {loadError ? <Card className="border-farm-danger"><p className="text-sm font-semibold text-farm-danger">{loadError}</p></Card> : null}

      {tab === 'dashboard' ? (
        <div className="animate-fade-in space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <StatCard label="Yearly Gross Revenue" value={formatPeso(yearlyTotals.revenue)} hint="Retail + wholesale, net of voids" />
            <StatCard label="Yearly COGS" value={formatPeso(yearlyTotals.cogs)} hint="Finished-goods cost released at sale" />
            <StatCard label="Yearly Net Income" value={formatPeso(yearlyTotals.netIncome)} hint="Revenue less COGS, shrinkage &amp; opex" />
            <StatCard label="Yearly Net Margin" value={`${(netMargin * 100).toFixed(1)}%`} hint="Net income ÷ revenue" />
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <h4 className="mb-4 flex items-center gap-2 text-sm font-extrabold text-farm-green"><TrendingUp className="h-4 w-4" aria-hidden /> Monthly Net Income Trend</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={months ?? []}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month_name" tick={{fontSize: 10}} />
                    <YAxis tick={{fontSize: 10}} />
                    <Tooltip formatter={(v) => formatPeso(Number(Array.isArray(v) ? v[0] : v))} />
                    <Line type="monotone" dataKey="net_income" name="Net Income" stroke="var(--color-farm-green)" strokeWidth={3} dot={{r: 4}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <h4 className="mb-4 text-sm font-extrabold text-farm-green">Sales vs Operating Expenses</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months ?? []}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="month_name" tick={{fontSize: 10}} />
                    <YAxis tick={{fontSize: 10}} />
                    <Tooltip formatter={(v) => formatPeso(Number(Array.isArray(v) ? v[0] : v))} />
                    <Legend wrapperStyle={{fontSize: 10}} />
                    <Bar dataKey="total_revenue" name="Gross Sales" fill="var(--color-farm-accent)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="total_opex" name="OpEx + Shrinkage" fill="var(--color-farm-danger)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </div>
      ) : tab === 'statements' ? (
        <div className="animate-fade-in space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2 text-sm">
              {([['income', 'Income Statement'], ['balance_sheet', 'Balance Sheet'], ['cash_flow', 'Cash Flows'], ['trial_balance', 'Compound Trial Balance'], ['chart_accounts', 'Chart of Accounts']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setStatement(key)} className={cn('rounded-xl border px-4 py-2 font-bold transition', statement === key ? 'border-transparent bg-farm-green text-white' : 'border-farm-accent bg-farm-card text-farm-green hover:bg-farm-accent-soft')}>
                  {label}
                </button>
              ))}
            </div>
            <div className="w-48">
              <SelectField value={statementBranch} onChange={setStatementBranch} options={[{value: 'all', label: 'All Branches'}, ...(branches ?? []).map((b) => ({value: b.id, label: b.name}))]} />
            </div>
          </div>

          <Card className="min-h-[420px]">
            <div className="mb-6 flex items-start justify-between border-b-2 border-farm-green pb-4">
              <div>
                <h3 className="text-xl font-black uppercase text-farm-green">Pick Ur Veggie Farm</h3>
                <p className="text-xs italic text-farm-muted">"Pick. Enjoy. Eat Healthy. Live Better."</p>
              </div>
              <div className="text-right">
                <h4 className="text-sm font-bold uppercase text-farm-green">
                  {statement === 'income' && 'Income Statement'}
                  {statement === 'balance_sheet' && 'Balance Sheet'}
                  {statement === 'cash_flow' && 'Statement of Cash Flows'}
                  {statement === 'trial_balance' && 'Compound Trial Balance'}
                  {statement === 'chart_accounts' && 'Chart of Accounts'}
                </h4>
                <p className="text-[11px] font-bold uppercase tracking-wider text-farm-muted">For the Audit Year {year}</p>
              </div>
            </div>

            {/* Plain-language "what is this?" caption (owner ask: a non-accountant should understand every statement) */}
            <p className="mb-5 flex items-start gap-2 rounded-xl border border-farm-accent-soft bg-farm-bg/50 p-3 text-xs leading-relaxed text-farm-muted">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-farm-green" aria-hidden />
              <span><strong className="text-farm-green">What is this?</strong> {STATEMENT_HELP[statement]}</span>
            </p>

            {statement === 'income' ? (
              months === null ? <Skeleton rows={4} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-farm-accent text-left font-bold tracking-wider text-farm-muted">
                        <th className="pb-2">Month</th><th className="pb-2 text-right">Retail</th><th className="pb-2 text-right">Wholesale</th>
                        <th className="pb-2 text-right">Revenue</th><th className="pb-2 text-right">COGS</th><th className="pb-2 text-right">Gross Profit</th>
                        <th className="pb-2 text-right">OpEx</th><th className="pb-2 text-right font-black text-farm-green">Net Income</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft">
                      {months.map((m) => (
                        <tr key={m.month_num}>
                          <td className="py-2 font-bold">{m.month_name}</td>
                          <td className="tabular py-2 text-right">{formatPeso(m.retail_revenue)}</td>
                          <td className="tabular py-2 text-right">{formatPeso(m.wholesale_revenue)}</td>
                          <td className="tabular py-2 text-right font-bold">{formatPeso(m.total_revenue)}</td>
                          <td className="tabular py-2 text-right">{formatPeso(m.cogs)}</td>
                          <td className="tabular py-2 text-right">{formatPeso(m.gross_profit)}</td>
                          <td className="tabular py-2 text-right">{formatPeso(m.total_opex)}</td>
                          <td className={cn('tabular py-2 text-right font-black', m.net_income < 0 ? 'text-farm-danger' : 'text-farm-green')}>{formatPeso(m.net_income)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-farm-green font-black">
                        <td className="pt-2">TOTAL</td><td /><td />
                        <td className="tabular pt-2 text-right">{formatPeso(yearlyTotals.revenue)}</td>
                        <td className="tabular pt-2 text-right">{formatPeso(yearlyTotals.cogs)}</td><td />
                        <td />
                        <td className={cn('tabular pt-2 text-right', yearlyTotals.netIncome < 0 ? 'text-farm-danger' : 'text-farm-green')}>{formatPeso(yearlyTotals.netIncome)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            ) : statement === 'balance_sheet' ? (
              balanceSheet === null ? <Skeleton rows={4} /> : (
                <div className="grid grid-cols-1 gap-8 text-sm md:grid-cols-2">
                  <div>
                    <h5 className="mb-2 border-b border-farm-accent-soft pb-1 text-xs font-black uppercase tracking-wider text-farm-green">Assets</h5>
                    <dl className="space-y-1.5">
                      <Row label="Cash" value={balanceSheet.cash} />
                      <Row label="Accounts Receivable" value={balanceSheet.accounts_receivable} />
                      <Row label="Raw Materials Inventory" value={balanceSheet.raw_materials} />
                      <Row label="Finished Goods Inventory" value={balanceSheet.finished_goods} />
                      <Row label="Equipment" value={balanceSheet.equipment} />
                      <Row label="Employee Advances" value={balanceSheet.employee_advances} />
                      <Row label="Total Assets" value={balanceSheet.total_assets} bold />
                    </dl>
                  </div>
                  <div>
                    <h5 className="mb-2 border-b border-farm-accent-soft pb-1 text-xs font-black uppercase tracking-wider text-farm-green">Liabilities &amp; Equity</h5>
                    <dl className="space-y-1.5">
                      <Row label="Loans Payable" value={balanceSheet.loans_payable} />
                      <Row label="Total Liabilities" value={balanceSheet.total_liabilities} bold />
                      <Row label="Owner Investment" value={balanceSheet.owner_investment} />
                      <Row label="Owner's Drawings" value={-balanceSheet.owners_drawings} />
                      <Row label="Retained Earnings" value={balanceSheet.retained_earnings} />
                      <Row label="Total Equity" value={balanceSheet.total_equity} bold />
                      <Row label="Liabilities + Equity" value={round2(balanceSheet.total_liabilities + balanceSheet.total_equity)} bold />
                    </dl>
                  </div>
                </div>
              )
            ) : statement === 'cash_flow' ? (
              cashFlow === null ? <Skeleton rows={4} /> : <CashFlowView lines={cashFlow} />
            ) : statement === 'trial_balance' ? (
              trialBalance === null ? <Skeleton rows={4} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-farm-accent text-left font-bold tracking-wider text-farm-muted">
                        <th className="pb-2">Code</th><th className="pb-2">Account</th><th className="pb-2">Type</th>
                        <th className="pb-2 text-right">Debit</th><th className="pb-2 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft">
                      {trialBalance.map((r) => (
                        <tr key={r.account_code}>
                          <td className="py-2 font-mono">{r.account_code}</td>
                          <td className="py-2 font-bold">{r.account_name}</td>
                          <td className="py-2 text-farm-muted">{r.account_type}</td>
                          <td className="tabular py-2 text-right">{r.total_debit > 0 ? formatPeso(r.total_debit) : '—'}</td>
                          <td className="tabular py-2 text-right">{r.total_credit > 0 ? formatPeso(r.total_credit) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-farm-green font-black">
                        <td colSpan={3} className="pt-2">TOTAL (proves the ledger balances)</td>
                        <td className="tabular pt-2 text-right">{formatPeso(round2(trialBalance.reduce((s, r) => s + r.total_debit, 0)))}</td>
                        <td className="tabular pt-2 text-right">{formatPeso(round2(trialBalance.reduce((s, r) => s + r.total_credit, 0)))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )
            ) : (
              trialBalance === null ? <Skeleton rows={4} /> : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-farm-accent text-left font-bold tracking-wider text-farm-muted">
                        <th className="pb-2">Code</th><th className="pb-2">Account</th><th className="pb-2">Type</th><th className="pb-2">Normal Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft">
                      {trialBalance.map((r) => (
                        <tr key={r.account_code}><td className="py-2 font-mono">{r.account_code}</td><td className="py-2 font-bold">{r.account_name}</td><td className="py-2 text-farm-muted">{r.account_type}</td><td className="py-2 uppercase text-farm-muted">{r.normal_balance}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </Card>
        </div>
      ) : tab === 'reports' ? (
        <div className="animate-fade-in space-y-6">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="w-48">
              <SelectField value={statementBranch} onChange={setStatementBranch} options={[{value: 'all', label: 'All Branches'}, ...(branches ?? []).map((b) => ({value: b.id, label: b.name}))]} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BreakdownCard title="Where the money goes" subtitle="Expenses by ledger account" icon={<PieChart className="h-4 w-4" aria-hidden />} loading={trialBalance === null} breakdown={expenseBreakdown} tone="danger" />
            <BreakdownCard title="Where the money comes from" subtitle="Revenue by ledger account" icon={<TrendingUp className="h-4 w-4" aria-hidden />} loading={trialBalance === null} breakdown={revenueBreakdown} tone="green" />
          </div>
          <Card>
            <h4 className="mb-1 flex items-center gap-2 text-sm font-extrabold text-farm-green"><BookOpen className="h-4 w-4" aria-hidden /> Statement of Changes in Equity</h4>
            <p className="mb-4 text-xs text-farm-muted">How owner’s equity moved — contributed capital plus accumulated earnings, less drawings.</p>
            {equity === null ? <Skeleton rows={3} /> : (
              <dl className="mx-auto max-w-xl space-y-1.5 text-sm">
                {equity.lines.map((l) => (
                  <div key={l.label} className={cn('flex justify-between border-b border-dashed border-farm-accent-soft pb-1', l.kind === 'total' && 'border-farm-green border-solid border-b-2 pt-1 font-black')}>
                    <dt className={cn('text-farm-muted', l.kind === 'total' && 'text-farm-ink')}>{l.label}</dt>
                    <dd className={cn('tabular font-bold', l.kind === 'less' && 'text-farm-danger', l.kind === 'total' && 'text-farm-green')}>{l.kind === 'less' ? `(${formatPeso(l.amount)})` : formatPeso(l.amount)}</dd>
                  </div>
                ))}
                {!equity.ties ? <p className="pt-2 text-xs font-bold text-farm-danger">⚠ Roll-forward does not tie to the balance sheet total — investigate the ledger.</p> : null}
              </dl>
            )}
          </Card>
        </div>
      ) : tab === 'accounts' ? (
        <div className="animate-fade-in">
          <AccountsTab branchId={branchId ?? null} />
        </div>
      ) : (
        <div className="animate-fade-in space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-farm-green">Inflow &amp; Outflow non-operating cash logger</h3>
            <div className="flex items-center gap-2">
              <div className="w-48"><SelectField value={branchId} onChange={setBranchId} placeholder="Branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} /></div>
              {canManage ? <Button onClick={() => {setCDate(todayISO()); setCFlow('in'); setCCategory('Owner Investment'); setCDesc(''); setCAmount(''); setLogOpen(true);}}><Plus size={18} aria-hidden /> Log New Cash Event</Button> : null}
            </div>
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-farm-accent-soft text-left font-bold tracking-wider text-farm-muted">
                    <th className="pb-3">Date</th><th className="pb-3 text-center">Flow</th><th className="pb-3">Category</th>
                    <th className="pb-3">Notes</th><th className="pb-3 text-right">Amount</th><th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-farm-accent-soft font-semibold">
                  {cashEntries.map((c) => (
                    <tr key={c.id} className={cn(c.status === 'Voided' && 'text-farm-muted line-through')}>
                      <td className="py-2.5 font-mono">{c.entry_date}</td>
                      <td className="py-2.5 text-center"><span className={cn('rounded px-2 py-0.5 text-[10px] font-bold uppercase', c.flow === 'in' ? 'bg-farm-accent-soft text-farm-green' : 'bg-red-100 text-farm-danger')}>{c.flow === 'in' ? 'Inflow' : 'Outflow'}</span></td>
                      <td className="py-2.5 font-bold uppercase text-farm-green">{c.category}</td>
                      <td className="max-w-xs truncate py-2.5">{c.description}</td>
                      <td className="tabular py-2.5 text-right font-black">{formatPeso(c.amount)}</td>
                      <td className="py-2.5 text-right">
                        {c.status === 'Posted' && canManage ? <button onClick={() => {setVoidTarget(c); setVoidReason('');}} className="rounded p-1.5 font-bold text-farm-danger transition hover:bg-red-50">Void</button> : c.status === 'Voided' ? <span className="text-[10px] italic">{c.void_reason}</span> : null}
                      </td>
                    </tr>
                  ))}
                  {cashEntries.length === 0 ? <tr><td colSpan={6} className="py-12 text-center italic text-farm-muted">No non-operating cash movements recorded yet. Log one above to complete the equity &amp; liability picture.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Log cash movement modal (prototype parity) */}
      <Dialog.Root open={logOpen} onOpenChange={setLogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">Log Cash Flow Movement</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Posts a balanced journal entry immediately — this is a real ledger movement, not a note.</p>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="cash-date">Posting Date</label>
                  <input id="cash-date" type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg p-2 text-sm font-semibold" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Direction</label>
                  <SelectField value={cFlow} onChange={(v) => {const f = v as CashFlowDirection; setCFlow(f); setCCategory(f === 'in' ? 'Owner Investment' : 'Loan Payment');}} options={[{value: 'in', label: 'Inflow (incoming funds)'}, {value: 'out', label: 'Outflow (outgoing payments)'}]} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Ledger Account Header</label>
                <SelectField value={cCategory} onChange={(v) => setCCategory(v as CashEntryCategory)} options={(cFlow === 'in' ? IN_CATEGORIES : OUT_CATEGORIES).map((c) => ({value: c, label: c}))} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="cash-desc">Movement Description</label>
                <input id="cash-desc" value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="e.g. Initial capital from owner savings" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="cash-amt">Amount (₱)</label>
                <input id="cash-amt" value={cAmount} onChange={(e) => setCAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" className="tabular min-h-14 w-full rounded-xl border border-farm-green px-4 text-right text-2xl font-black outline-none" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setLogOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitCashEntry()} disabled={busy || !branchId || !(parseFloat(cAmount) > 0)}>{busy ? 'Posting…' : 'Post Movement'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Void confirmation (22.24 — reversal, never a delete) */}
      {voidTarget ? (
        <Card className="animate-fade-in border-farm-danger">
          <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-farm-danger"><AlertCircle className="h-5 w-5" aria-hidden /> Void {voidTarget.category} — {formatPeso(voidTarget.amount)}?</h3>
          <p className="mb-3 text-sm text-farm-muted">This posts a reversing journal entry. The original record is preserved in history (never deleted).</p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason (required)…" aria-label="Void reason" className="min-h-12 flex-1 rounded-lg border border-farm-accent px-3 text-sm" />
            <Button variant="secondary" onClick={() => {setVoidTarget(null); setVoidReason('');}} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={() => void submitVoid()} disabled={busy || !voidReason.trim()}>{busy ? 'Voiding…' : 'Void Entry'}</Button>
          </div>
        </Card>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-farm-muted"><BookOpen size={14} aria-hidden /> Cost Schedule and the vendor AP ledger live on the Vendors &amp; AP screen; the per-customer AR ledger is the "View statement" action on the Customers &amp; Credit screen.</p>
    </div>
  );
}

function CashFlowView({lines}: {lines: CashFlowLine[]}) {
  const opening = lines.find((l) => l.line_label === 'Opening cash balance')?.amount ?? 0;
  const closing = lines.find((l) => l.line_label === 'Closing cash balance')?.amount ?? 0;
  const activities = (['Operating', 'Investing', 'Financing'] as const).map((act) => {
    const items = lines.filter((l) => l.activity === act);
    return {act, items, subtotal: round2(items.reduce((s, l) => s + l.amount, 0))};
  }).filter((a) => a.items.length > 0);
  const netChange = round2(activities.reduce((s, a) => s + a.subtotal, 0));
  const ties = round2(opening + netChange) === round2(closing);
  const SECTION_LABEL: Record<string, string> = {Operating: 'Operating Activities', Investing: 'Investing Activities', Financing: 'Financing Activities'};

  return (
    <div className="mx-auto max-w-xl space-y-4 text-sm">
      {activities.map(({act, items, subtotal}) => (
        <div key={act}>
          <h5 className="mb-1 text-xs font-black uppercase tracking-wider text-farm-green">{SECTION_LABEL[act]}</h5>
          <dl className="space-y-1">
            {items.map((l) => (
              <div key={l.line_label} className="flex justify-between border-b border-dashed border-farm-accent-soft pb-1">
                <dt className="text-farm-muted">{l.line_label}</dt>
                <dd className={cn('tabular font-bold', l.amount < 0 && 'text-farm-danger')}>{l.amount < 0 ? `(${formatPeso(Math.abs(l.amount))})` : formatPeso(l.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between pt-0.5 font-black">
              <dt>Net cash from {act.toLowerCase()}</dt>
              <dd className={cn('tabular', subtotal < 0 ? 'text-farm-danger' : 'text-farm-green')}>{subtotal < 0 ? `(${formatPeso(Math.abs(subtotal))})` : formatPeso(subtotal)}</dd>
            </div>
          </dl>
        </div>
      ))}
      <dl className="space-y-1 border-t-2 border-farm-green pt-2">
        <div className="flex justify-between font-black"><dt>Net change in cash</dt><dd className={cn('tabular', netChange < 0 ? 'text-farm-danger' : 'text-farm-green')}>{netChange < 0 ? `(${formatPeso(Math.abs(netChange))})` : formatPeso(netChange)}</dd></div>
        <div className="flex justify-between text-farm-muted"><dt>Opening cash balance</dt><dd className="tabular">{formatPeso(opening)}</dd></div>
        <div className="flex justify-between font-black text-farm-green"><dt>Closing cash balance</dt><dd className="tabular">{formatPeso(closing)}</dd></div>
      </dl>
      {!ties ? <p className="text-xs font-bold text-farm-danger">⚠ Cash flow does not reconcile to the closing cash balance — investigate the ledger.</p> : null}
      {activities.length === 0 ? <p className="py-8 text-center italic text-farm-muted">No cash movements posted yet.</p> : null}
    </div>
  );
}

function BreakdownCard({title, subtitle, icon, loading, breakdown, tone}: {title: string; subtitle: string; icon: ReactNode; loading: boolean; breakdown: {lines: {code: string; name: string; amount: number; pct: number}[]; total: number}; tone: 'green' | 'danger'}) {
  const bar = tone === 'danger' ? 'bg-farm-danger' : 'bg-farm-green';
  return (
    <Card>
      <h4 className="flex items-center gap-2 text-sm font-extrabold text-farm-green">{icon} {title}</h4>
      <p className="mb-4 text-xs text-farm-muted">{subtitle}</p>
      {loading ? <Skeleton rows={3} /> : breakdown.lines.length === 0 ? (
        <p className="py-8 text-center text-xs italic text-farm-muted">Nothing posted yet.</p>
      ) : (
        <div className="space-y-2.5">
          {breakdown.lines.map((l) => (
            <div key={l.code}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-bold text-farm-ink">{l.name}</span>
                <span className="tabular font-bold text-farm-green">{formatPeso(l.amount)} <span className="text-[10px] font-semibold text-farm-muted">{l.pct.toFixed(1)}%</span></span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-farm-accent-soft"><div className={cn('h-full rounded-full', bar)} style={{width: `${Math.min(l.pct, 100)}%`}} /></div>
            </div>
          ))}
          <div className="flex justify-between border-t-2 border-farm-green pt-2 text-sm font-black">
            <span>Total</span><span className="tabular text-farm-green">{formatPeso(breakdown.total)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({label, value, bold}: {label: string; value: number; bold?: boolean}) {
  return (
    <div className={cn('flex justify-between border-b border-dashed border-farm-accent-soft pb-1', bold && 'border-farm-green border-solid border-b-2 pt-1 font-black')}>
      <dt className={cn('text-farm-muted', bold && 'text-farm-ink')}>{label}</dt>
      <dd className={cn('tabular font-bold', value < 0 && 'text-farm-danger', bold && 'text-farm-green')}>{formatPeso(value)}</dd>
    </div>
  );
}
