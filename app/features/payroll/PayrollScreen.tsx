// Farm Staff Payroll & Advances (P2-M5B/M5C) — prototype-parity: src/features/Payroll.tsx is the workflow
// authority. Roster (live undeducted-advance pill) · Hire · Log Advance · Disburse Wage · Wage Journal ·
// Link App User (M5C). Salary privacy (owner rule 2026-07-04): users WITHOUT payroll.read see ONLY their own
// linked pay record ("My Payroll" self view) — enforced server-side by the M5C RLS; this screen just renders it.
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {HandCoins, History, Link2, ListChecks, Users2, UserPlus, Wallet, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {useSync} from '../../core/offline/sync';
import {usePermissions} from '../../core/permissions/permissions';
import {useSession} from '../../core/auth/session';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {formatPeso, round2} from '../pos/money';
import {payrollApi} from './api';
import {membershipsApi, type MemberRow} from '../organization/memberships/memberships';
import {MOCK_MODE, DEMO} from '../../core/mock/mock';
import type {CashAdvance, Employee, Position, WagePayment} from '../../types/db';

export default function PayrollScreen() {
  const {companyId, has} = usePermissions();
  const {refreshTick} = useSync();
  const {notify} = useToast();
  const canRead = has('payroll.read');
  const canManage = has('payroll.manage');
  const canManagePositions = has('position.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [advances, setAdvances] = useState<CashAdvance[]>([]);
  const [wages, setWages] = useState<WagePayment[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [busy, setBusy] = useState(false);
  const {user} = useSession();

  // Wage history tab (co-owner+ / anyone with payroll.read — the two are non-payroll roles, so this is
  // how they check an employee's history instead of clicking into their own nonexistent pay record).
  const [tab, setTab] = useState<'roster' | 'history'>('roster');
  const [histEmpId, setHistEmpId] = useState('');
  const [histWages, setHistWages] = useState<WagePayment[]>([]);
  const [histAdvances, setHistAdvances] = useState<CashAdvance[]>([]);

  const reload = useCallback(() => {
    if (!companyId || !canRead) return;
    payrollApi.fetchEmployees(companyId).then(setEmployees).catch(() => setEmployees([]));
    payrollApi.fetchPositions(companyId).then(setPositions).catch(() => setPositions([]));
    if (branchId) {
      payrollApi.fetchAdvances(companyId, branchId).then(setAdvances).catch(() => setAdvances([]));
      payrollApi.fetchWages(companyId, branchId).then(setWages).catch(() => setWages([]));
    }
    if (histEmpId) {
      payrollApi.fetchEmployeeWages(companyId, histEmpId).then(setHistWages).catch(() => setHistWages([]));
      payrollApi.fetchEmployeeAdvances(companyId, histEmpId).then(setHistAdvances).catch(() => setHistAdvances([]));
    }
  }, [companyId, canRead, branchId, histEmpId]);
  useEffect(reload, [reload, refreshTick]); // refreshTick: manual sync (top-bar wifi tap)

  const empName = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e.name])), [employees]);
  const positionLabel = useMemo(() => new Map(positions.map((p) => [p.id, p.label])), [positions]);
  const activePositions = useMemo(() => positions.filter((p) => p.active), [positions]);

  useEffect(() => {
    if (!histEmpId && employees && employees.length > 0) setHistEmpId(employees[0]!.id);
  }, [employees, histEmpId]);
  const histEmp = useMemo(() => (employees ?? []).find((e) => e.id === histEmpId) ?? null, [employees, histEmpId]);

  // ── hire ──
  const [hireOpen, setHireOpen] = useState(false);
  const [hName, setHName] = useState('');
  const [hPos, setHPos] = useState('');
  const [hRate, setHRate] = useState('550');
  useEffect(() => {
    if (!hPos && activePositions.length > 0) setHPos(activePositions[0]!.id);
  }, [activePositions, hPos]);

  // ── position management (position.manage — co_owner/owner by default) ──
  const [posManageOpen, setPosManageOpen] = useState(false);
  const [newPosLabel, setNewPosLabel] = useState('');

  // ── advance ──
  const [advEmp, setAdvEmp] = useState<Employee | null>(null);
  const [advAmt, setAdvAmt] = useState('');
  const [advNote, setAdvNote] = useState('');

  // ── wage ──
  const [wageEmp, setWageEmp] = useState<Employee | null>(null);
  // Defaults to a single day (found during the role-sweep, 2026-07-18) — it previously defaulted to
  // '5', so disbursing without touching this field paid 5 days' wage for 1 day worked. Matches the
  // "Full day" quick-pick's own value and the owner's own framing (daily disbursement is the norm).
  const [wDays, setWDays] = useState('1');
  const [wDed, setWDed] = useState('0');
  const [wPeriod, setWPeriod] = useState('');
  const [wNotes, setWNotes] = useState('');

  const wGross = wageEmp ? round2((parseFloat(wDays) || 0) * wageEmp.daily_rate) : 0;
  const wDedNum = parseFloat(wDed) || 0;
  const wNet = round2(Math.max(0, wGross - wDedNum));

  // ── link app user (M5C) — gives a worker self-service visibility of their OWN pay record ──
  const [linkEmp, setLinkEmp] = useState<Employee | null>(null);
  const [linkUserId, setLinkUserId] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  useEffect(() => {
    if (linkEmp && companyId) membershipsApi.fetch(companyId).then(setMembers).catch(() => setMembers([]));
  }, [linkEmp, companyId]);

  async function submitLink(userId: string | null) {
    if (!linkEmp) return;
    setBusy(true);
    try {
      await payrollApi.linkEmployeeUser(linkEmp, userId);
      notify(userId ? `${linkEmp.name} linked — they can now see their own payroll` : `${linkEmp.name} unlinked`);
      setLinkEmp(null); setLinkUserId('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Link failed', 'error'); } finally { setBusy(false); }
  }

  async function submitHire() {
    if (!companyId) return;
    setBusy(true);
    try {
      await payrollApi.hire(companyId, {name: hName, positionId: hPos, dailyRate: parseFloat(hRate)});
      notify(`${hName.trim()} hired`);
      setHireOpen(false); setHName(''); setHRate('550');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Hire failed', 'error'); } finally { setBusy(false); }
  }

  async function submitAddPosition() {
    if (!companyId) return;
    setBusy(true);
    try {
      await payrollApi.addPosition(companyId, newPosLabel, MOCK_MODE ? DEMO.userId : (user?.id ?? ''));
      notify(`"${newPosLabel.trim()}" added`);
      setNewPosLabel('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not add position', 'error'); } finally { setBusy(false); }
  }

  async function togglePosition(p: Position) {
    setBusy(true);
    try {
      await payrollApi.setPositionActive(p, !p.active);
      notify(p.active ? `"${p.label}" deactivated — hidden from new hires` : `"${p.label}" reactivated`);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Update failed', 'error'); } finally { setBusy(false); }
  }

  async function submitAdvance() {
    if (!companyId || !branchId || !advEmp) return;
    setBusy(true);
    try {
      await payrollApi.recordAdvance(companyId, branchId, advEmp, parseFloat(advAmt), advNote);
      notify(`Advance released to ${advEmp.name}`);
      setAdvEmp(null); setAdvAmt(''); setAdvNote('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Advance failed', 'error'); } finally { setBusy(false); }
  }

  async function submitWage() {
    if (!companyId || !branchId || !wageEmp) return;
    setBusy(true);
    try {
      await payrollApi.disburseWage(companyId, branchId, wageEmp, wPeriod, parseFloat(wDays), wDedNum, wNotes);
      notify(`Wage disbursed to ${wageEmp.name} — net ${formatPeso(wNet)}`);
      setWageEmp(null); setWDays('1'); setWDed('0'); setWPeriod(''); setWNotes('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Disbursement failed', 'error'); } finally { setBusy(false); }
  }

  // M5C "My Payroll" self view: without payroll.read, the server's RLS returns ONLY your linked employee
  // row + your own advances/wages — so this view renders whatever comes back, read-only.
  if (!canRead) {
    return <MyPayroll companyId={companyId ?? undefined} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Farm Staff Payroll &amp; Advances"
        subtitle="Manage hired workers, dispatch paysheets, and track advances with a live, never-stored balance."
        action={
          tab === 'roster' ? (
            <div className="flex items-center gap-2">
              <div className="w-44"><SelectField value={branchId} onChange={setBranchId} placeholder="Paying branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} /></div>
              {canManagePositions ? <Button variant="secondary" onClick={() => setPosManageOpen(true)}><ListChecks size={18} aria-hidden /> Positions</Button> : null}
              {canManage ? <Button onClick={() => {setHName(''); setHPos(activePositions[0]?.id ?? ''); setHRate('550'); setHireOpen(true);}}><UserPlus size={18} aria-hidden /> Hire Worker</Button> : null}
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-1.5 border-b border-farm-accent pb-0.5" role="tablist">
        {([['roster', 'Roster & Disbursements', Users2], ['history', 'Wage History', History]] as const).map(([key, label, Icon]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={cn('flex min-h-12 items-center gap-2 rounded-t-xl px-4 text-sm font-bold transition', tab === key ? 'border-x border-t border-farm-accent bg-farm-card text-farm-green' : 'text-farm-muted hover:bg-farm-card/40 hover:text-farm-green')}>
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <div className="animate-fade-in space-y-6">
          <Card>
            <div className="w-64"><SelectField value={histEmpId} onChange={setHistEmpId} placeholder="Pick a worker" options={(employees ?? []).map((e) => ({value: e.id, label: e.name}))} /></div>
          </Card>
          {histEmp ? (
            <>
              <Card className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-lg font-black text-farm-green">{histEmp.name} <span className="font-mono text-xs text-farm-muted">{histEmp.employee_code}</span></p>
                  <p className="text-sm font-semibold text-farm-muted">{histEmp.position_id ? (positionLabel.get(histEmp.position_id) ?? '—') : '—'} · hired {histEmp.date_hired}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase text-farm-muted">Daily rate</p>
                  <p className="tabular text-xl font-black text-farm-green">{formatPeso(histEmp.daily_rate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase text-farm-muted">Advance to repay</p>
                  <p className={cn('tabular text-xl font-black', histEmp.advance_balance > 0 ? 'text-farm-danger' : 'text-farm-green')}>{formatPeso(histEmp.advance_balance)}</p>
                </div>
              </Card>
              <EmployeeHistoryTables wages={histWages} advances={histAdvances} />
            </>
          ) : null}
        </div>
      ) : null}

      {tab === 'roster' ? (
      <>
      <Card>
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-farm-green"><Users2 className="h-5 w-5" aria-hidden /> Active Farm Hands Roster</h3>
        {employees === null ? (
          <Skeleton rows={3} />
        ) : employees.length === 0 ? (
          <EmptyState title="No hired workers yet" hint="Click 'Hire Worker' to add farm hands and start paying wages." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-farm-accent-soft text-left text-xs font-bold tracking-wider text-farm-muted">
                  <th className="pb-3">Worker</th><th className="pb-3">Position</th><th className="pb-3 text-right">Daily Rate</th>
                  <th className="pb-3 text-right">Undeducted Advance</th><th className="pb-3">Hired</th><th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-farm-accent-soft">
                {employees.map((e) => (
                  <tr key={e.id} className={cn('hover:bg-farm-bg/30', e.status !== 'Active' && 'opacity-50')}>
                    <td className="py-3"><span className="font-bold text-farm-green">{e.name}</span> <span className="font-mono text-[10px] text-farm-muted">{e.employee_code}</span></td>
                    <td className="py-3 font-semibold text-farm-muted">{e.position_id ? (positionLabel.get(e.position_id) ?? '—') : '—'}</td>
                    <td className="tabular py-3 text-right font-semibold">{formatPeso(e.daily_rate)}/day</td>
                    <td className="py-3 text-right">
                      {e.advance_balance > 0
                        ? <span className="tabular rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-bold text-farm-danger">{formatPeso(e.advance_balance)}</span>
                        : <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">Cleared</span>}
                    </td>
                    <td className="py-3 font-mono text-xs text-farm-muted">{e.date_hired}</td>
                    <td className="py-3 text-right">
                      {e.status === 'Active' ? (
                        <span className="flex justify-end gap-1.5">
                          {canManage ? <button onClick={() => {setAdvEmp(e); setAdvAmt(''); setAdvNote('');}} className="rounded-lg border border-farm-accent bg-farm-bg px-2.5 py-1 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">Log Advance</button> : null}
                          {canManage ? <button onClick={() => {setWageEmp(e); setWDays('1'); setWDed(String(e.advance_balance)); setWPeriod(''); setWNotes('');}} className="rounded-lg bg-farm-green px-2.5 py-1 text-xs font-bold text-white hover:bg-farm-green-700">Disburse Wage</button> : null}
                          {canManage ? <button onClick={() => {setLinkEmp(e); setLinkUserId(e.user_id ?? '');}} title={e.user_id ? 'Linked to an app user — self-service payroll view enabled' : 'Link to an app user so they can see their own payroll'} className={cn('rounded-lg border px-2 py-1 text-xs font-bold', e.user_id ? 'border-farm-green bg-farm-accent-soft text-farm-green' : 'border-farm-accent bg-farm-bg text-farm-muted hover:text-farm-green')}><Link2 className="inline h-3.5 w-3.5" aria-hidden /></button> : null}
                          {canManage ? <button onClick={async () => {setBusy(true); try {await payrollApi.setActive(e, false); notify(`${e.name} marked resigned`); reload();} catch (err) {notify(err instanceof Error ? err.message : 'Failed', 'error');} finally {setBusy(false);}}} className="rounded-lg px-2 py-1 text-xs font-semibold text-farm-danger hover:bg-red-50">Resign</button> : null}
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-2 text-xs italic text-farm-muted">Resigned{canManage ? <button onClick={async () => {setBusy(true); try {await payrollApi.setActive(e, true); notify(`${e.name} reactivated`); reload();} catch (err) {notify(err instanceof Error ? err.message : 'Failed', 'error');} finally {setBusy(false);}}} className="rounded px-2 py-1 font-bold text-farm-green not-italic hover:bg-farm-accent-soft">Reactivate</button> : null}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {wages.length > 0 ? (
        <Card>
          <h3 className="mb-4 text-base font-extrabold text-farm-green">Staff Wage Disbursement Journal <span className="text-xs font-normal text-farm-muted">({branches?.find((b) => b.id === branchId)?.name})</span></h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-farm-accent-soft text-left font-bold tracking-wider text-farm-muted">
                  <th className="pb-2">Date</th><th className="pb-2">Worker</th><th className="pb-2">Pay Period</th>
                  <th className="pb-2 text-center">Days</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Advance Ded.</th><th className="pb-2 text-right text-farm-green">Net Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-farm-accent-soft font-semibold">
                {wages.map((w) => (
                  <tr key={w.id}>
                    <td className="py-2.5 font-mono">{new Date(w.created_at).toLocaleDateString('en-PH')}</td>
                    <td className="py-2.5 font-bold text-farm-ink">{empName.get(w.employee_id) ?? 'Unknown'}</td>
                    <td className="py-2.5">{w.pay_period}</td>
                    <td className="py-2.5 text-center font-mono">{w.days_worked}</td>
                    <td className="tabular py-2.5 text-right text-farm-muted">{formatPeso(w.gross)}</td>
                    <td className="tabular py-2.5 text-right text-farm-danger">{w.ca_deducted > 0 ? `(${formatPeso(w.ca_deducted).replace('₱', '₱')})` : '—'}</td>
                    <td className="tabular py-2.5 text-right font-black text-farm-green">{formatPeso(w.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      </>
      ) : null}

      {/* Hire modal */}
      <Dialog.Root open={hireOpen} onOpenChange={setHireOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">Hire Farm Hand</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Create a roster profile for daily-wage calculations.</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="h-name">Worker Name</label>
                <input id="h-name" value={hName} onChange={(e) => setHName(e.target.value)} placeholder="e.g. Juan Dela Cruz" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Position</label>
                  <SelectField value={hPos} onChange={setHPos} placeholder="Pick a position" options={activePositions.map((p) => ({value: p.id, label: p.label}))} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="h-rate">Daily Rate (₱)</label>
                  <input id="h-rate" value={hRate} onChange={(e) => setHRate(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-right text-sm font-bold" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setHireOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitHire()} disabled={busy || !hName.trim() || !hPos || !(parseFloat(hRate) > 0)}>{busy ? 'Adding…' : 'Add Worker'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Position management (position.manage — co_owner/owner by default; admin can only select, not manage) */}
      <Dialog.Root open={posManageOpen} onOpenChange={setPosManageOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">Manage Positions</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-4 text-xs text-farm-muted">Deactivating a position hides it from new hires — existing Farm Hands already using it are unaffected.</p>
            <ul className="mb-4 max-h-64 divide-y divide-farm-accent-soft overflow-y-auto">
              {positions.map((p) => (
                <li key={p.id} className={cn('flex items-center justify-between py-2 text-sm', !p.active && 'opacity-50')}>
                  <span className="font-semibold">{p.label}</span>
                  <button onClick={() => void togglePosition(p)} disabled={busy} className={cn('rounded-lg border px-2.5 py-1 text-xs font-bold', p.active ? 'border-red-200 bg-red-50 text-farm-danger hover:bg-red-100' : 'border-farm-accent bg-farm-bg text-farm-green hover:bg-farm-accent-soft')}>
                    {p.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 border-t border-farm-accent-soft pt-4">
              <input value={newPosLabel} onChange={(e) => setNewPosLabel(e.target.value)} placeholder="New position name" className="min-h-12 flex-1 rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              <Button onClick={() => void submitAddPosition()} disabled={busy || !newPosLabel.trim()}>Add</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Advance modal */}
      <Dialog.Root open={advEmp !== null} onOpenChange={(o) => {if (!o) setAdvEmp(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="flex items-center gap-2 text-xl font-bold text-farm-green"><HandCoins className="h-5 w-5" aria-hidden /> Log Cash Advance</Dialog.Title>
            <p className="mb-5 mt-1 text-xs text-farm-muted">Releases cash to <span className="font-bold text-farm-green">{advEmp?.name}</span>. Posts Dr Employee Advances / Cr Cash; the balance clears at the next paysheet.</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="adv-amt">Advance Amount (₱)</label>
                <input id="adv-amt" value={advAmt} onChange={(e) => setAdvAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" className="tabular min-h-14 w-full rounded-xl border border-farm-green px-4 text-right text-2xl font-black outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="adv-note">Reason</label>
                <input id="adv-note" value={advNote} onChange={(e) => setAdvNote(e.target.value)} placeholder="e.g. medicine / fuel" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setAdvEmp(null)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitAdvance()} disabled={busy || !(parseFloat(advAmt) > 0)}>{busy ? 'Releasing…' : 'Release Cash'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Wage modal */}
      <Dialog.Root open={wageEmp !== null} onOpenChange={(o) => {if (!o) setWageEmp(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="flex items-center gap-2 text-xl font-bold text-farm-green"><Wallet className="h-5 w-5" aria-hidden /> Disburse Wage</Dialog.Title>
            <p className="mb-4 mt-1 text-xs text-farm-muted"><span className="font-bold text-farm-green">{wageEmp?.name}</span> · {formatPeso(wageEmp?.daily_rate ?? 0)}/day</p>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-days">Days Worked</label>
                  <input id="w-days" value={wDays} onChange={(e) => setWDays(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-center text-sm font-bold" />
                  {/* owner 2026-07-18: "some will work half day or even just 1hr due to personal reasons or
                      emergency" — the field already accepted any decimal (server: p_days_worked numeric, no
                      integer constraint), it just never said so. Quick-picks make partial days discoverable;
                      typing a custom decimal (e.g. 0.125 for 1hr of an 8hr day) still works. */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {[['1', 'Full day'], ['0.5', 'Half day'], ['0.25', '2 hrs'], ['0.125', '1 hr']].map(([v, label]) => (
                      <button key={v} type="button" onClick={() => setWDays(v)}
                        className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', wDays === v ? 'border-farm-green bg-farm-green text-white' : 'border-farm-accent-soft text-farm-muted hover:bg-farm-accent-soft')}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[9px] text-farm-muted">Or type any amount — e.g. 0.375 for 3 of 8 hours.</p>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-ded">Deduct Advance (₱)</label>
                  <input id="w-ded" value={wDed} onChange={(e) => setWDed(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-center text-sm font-bold text-farm-danger" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-period">Pay Period</label>
                <input id="w-period" value={wPeriod} onChange={(e) => setWPeriod(e.target.value)} placeholder="e.g. July 1-7" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-notes">Notes</label>
                <input id="w-notes" value={wNotes} onChange={(e) => setWNotes(e.target.value)} placeholder="Regular harvesting cycle pay" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div className="space-y-1 rounded-xl border border-farm-accent bg-emerald-50/60 p-3 text-xs">
                <div className="flex justify-between"><span>Gross (days × rate)</span><span className="tabular font-bold">{formatPeso(wGross)}</span></div>
                <div className="flex justify-between text-farm-danger"><span>Deduct advance</span><span className="tabular font-bold">−{formatPeso(wDedNum)}</span></div>
                <div className="flex justify-between border-t border-dashed border-farm-accent pt-1 font-black text-farm-green"><span>NET PAYOUT</span><span className="tabular">{formatPeso(wNet)}</span></div>
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setWageEmp(null)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitWage()} disabled={busy || !(wGross > 0) || wDedNum > wGross}>{busy ? 'Paying…' : 'Confirm & Pay'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Link app user modal (M5C — payroll self-visibility) */}
      <Dialog.Root open={linkEmp !== null} onOpenChange={(o) => {if (!o) setLinkEmp(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="flex items-center justify-center gap-1.5 text-lg font-bold text-farm-green"><Link2 className="h-5 w-5" aria-hidden /> Link App User</Dialog.Title>
            <p className="mb-5 mt-1 text-center text-xs text-farm-muted">
              Connect <strong>{linkEmp?.name}</strong> to their app account so they can see <em>their own</em> pay
              record, advances, and wage history — and nobody else&apos;s. Managers keep full visibility.
            </p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">App user (company member)</label>
                <SelectField value={linkUserId} onChange={setLinkUserId} placeholder="Choose a member…" options={members.map((m) => ({value: m.user_id, label: `${m.userName} — ${m.roleKey} @ ${m.branchName}`}))} />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setLinkEmp(null)} disabled={busy}>Cancel</Button>
              {linkEmp?.user_id ? <Button variant="danger" onClick={() => void submitLink(null)} disabled={busy}>Unlink</Button> : null}
              <Button className="flex-1" onClick={() => void submitLink(linkUserId)} disabled={busy || !linkUserId}>{busy ? 'Linking…' : 'Link User'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// ── M5C "My Payroll" — read-only self view for users WITHOUT payroll.read. The server's RLS is the gate:
// fetches return only the employee row linked to this user (and their advances/wages), or nothing at all.
function MyPayroll({companyId}: {companyId?: string}) {
  const [me, setMe] = useState<Employee | null | undefined>(undefined); // undefined=loading, null=not linked
  const [advances, setAdvances] = useState<CashAdvance[]>([]);
  const [wages, setWages] = useState<WagePayment[]>([]);
  const [myPositionLabel, setMyPositionLabel] = useState<string>('—');

  useEffect(() => {
    if (!companyId) return;
    payrollApi.fetchEmployees(companyId).then(async (rows) => {
      const mine = rows[0] ?? null; // RLS returns at most the caller's own linked row
      setMe(mine);
      if (mine) {
        setAdvances(await payrollApi.fetchEmployeeAdvances(companyId, mine.id).catch(() => []));
        setWages(await payrollApi.fetchEmployeeWages(companyId, mine.id).catch(() => []));
        if (mine.position_id) {
          const positions = await payrollApi.fetchPositions(companyId).catch(() => []);
          setMyPositionLabel(positions.find((p) => p.id === mine.position_id)?.label ?? '—');
        }
      }
    }).catch(() => setMe(null));
  }, [companyId]);

  return (
    <div className="space-y-6">
      <PageHeader title="My Payroll" subtitle="Your own pay record — wages received and cash advances. Only you and payroll managers can see this." />
      {me === undefined ? (
        <Skeleton rows={3} />
      ) : me === null ? (
        <Card><EmptyState title="No staff profile linked yet" hint="Ask a payroll manager to link your app account to your staff record — then your wage history and advance balance appear here." /></Card>
      ) : (
        <>
          <Card className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-lg font-black text-farm-green">{me.name} <span className="font-mono text-xs text-farm-muted">{me.employee_code}</span></p>
              <p className="text-sm font-semibold text-farm-muted">{myPositionLabel} · hired {me.date_hired}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase text-farm-muted">Daily rate</p>
              <p className="tabular text-xl font-black text-farm-green">{formatPeso(me.daily_rate)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase text-farm-muted" title="Total advances minus what was already deducted from your wages — always computed from the records, never stored.">Advance to repay</p>
              <p className={cn('tabular text-xl font-black', me.advance_balance > 0 ? 'text-farm-danger' : 'text-farm-green')}>{formatPeso(me.advance_balance)}</p>
            </div>
          </Card>
          <EmployeeHistoryTables wages={wages} advances={advances} wageTitle="My Wage History" advanceTitle="My Cash Advances" />
        </>
      )}
    </div>
  );
}

// Wage + cash-advance history tables — shared by MyPayroll (self view) and the Wage History tab
// (co-owner+ looking up any employee: co-owner/owner aren't waged themselves, so this is how they
// check what an admin-and-below worker has been paid, per owner directive 2026-07-17).
function EmployeeHistoryTables({wages, advances, wageTitle = 'Wage History', advanceTitle = 'Cash Advances'}: {wages: WagePayment[]; advances: CashAdvance[]; wageTitle?: string; advanceTitle?: string}) {
  return (
    <>
      <Card>
        <h3 className="mb-3 flex items-center gap-2 text-base font-extrabold text-farm-green"><Wallet className="h-4 w-4" aria-hidden /> {wageTitle}</h3>
        {wages.length === 0 ? <p className="py-6 text-center text-xs italic text-farm-muted">No wages recorded yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead><tr className="border-b border-farm-accent-soft text-left text-xs font-bold text-farm-muted"><th className="pb-2">Period</th><th className="pb-2 text-right">Days</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Advance deducted</th><th className="pb-2 text-right">Net received</th></tr></thead>
              <tbody className="divide-y divide-farm-accent-soft">
                {wages.map((w) => (
                  <tr key={w.id}><td className="py-2 font-semibold">{w.pay_period}</td><td className="tabular py-2 text-right">{w.days_worked}</td><td className="tabular py-2 text-right">{formatPeso(w.gross)}</td><td className="tabular py-2 text-right text-farm-danger">−{formatPeso(w.ca_deducted)}</td><td className="tabular py-2 text-right font-black text-farm-green">{formatPeso(w.net)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <h3 className="mb-3 flex items-center gap-2 text-base font-extrabold text-farm-green"><HandCoins className="h-4 w-4" aria-hidden /> {advanceTitle}</h3>
        {advances.length === 0 ? <p className="py-6 text-center text-xs italic text-farm-muted">No cash advances taken.</p> : (
          <ul className="divide-y divide-farm-accent-soft text-sm">
            {advances.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2"><span className="text-farm-muted">{new Date(a.created_at).toLocaleDateString('en-PH')} {a.note ? `— ${a.note}` : ''}</span><span className="tabular font-bold">{formatPeso(a.amount)}</span></li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
