// Farm Staff Payroll & Advances (P2-M5B/M5C) — prototype-parity: src/features/Payroll.tsx is the workflow
// authority. Roster (live undeducted-advance pill) · Hire · Log Advance · Disburse Wage · Wage Journal ·
// Link App User (M5C). Salary privacy (owner rule 2026-07-04): users WITHOUT payroll.read see ONLY their own
// linked pay record ("My Payroll" self view) — enforced server-side by the M5C RLS; this screen just renders it.
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {CalendarCheck, CalendarX, FileText, HandCoins, History, Link2, ListChecks, Printer, Timer, Users2, UserPlus, Wallet, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {hydrateBranches} from '../../core/offline/hydrate';
import {useSync} from '../../core/offline/sync';
import {usePermissions} from '../../core/permissions/permissions';
import {useSession} from '../../core/auth/session';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {formatPeso, round2} from '../pos/money';
import {payrollApi, type AttendanceRecord, type LeaveRequest, type LeaveType, type OvertimeRequest, type DisbursementRequest} from './api';
import {membershipsApi, type MemberRow} from '../organization/memberships/memberships';
import {paymentsApi} from '../finance/api';
import {MOCK_MODE, DEMO} from '../../core/mock/mock';
import type {Branch, CashAdvance, Employee, FinancialAccount, Position, WagePayment} from '../../types/db';

export default function PayrollScreen() {
  const {companyId, has} = usePermissions();
  const {refreshTick} = useSync();
  const {notify} = useToast();
  const canRead = has('payroll.read');
  const canManage = has('payroll.manage');
  const canManagePositions = has('position.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  useEffect(() => {if (companyId) hydrateBranches(companyId);}, [companyId]);
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

  // P2PR5: payout-method picker (Cash drawer + this branch's active bank/wallet accounts) — same
  // API PosScreen already uses for the identical picker on a sale.
  const [payAccounts, setPayAccounts] = useState<FinancialAccount[]>([]);
  useEffect(() => {
    if (companyId && branchId) paymentsApi.fetchPickerAccounts(companyId, branchId).then(setPayAccounts).catch(() => setPayAccounts([]));
  }, [companyId, branchId]);

  // Wage history tab (co-owner+ / anyone with payroll.read — the two are non-payroll roles, so this is
  // how they check an employee's history instead of clicking into their own nonexistent pay record).
  const [tab, setTab] = useState<'roster' | 'history' | 'attendance' | 'leave' | 'overtime' | 'disbursements'>('roster');
  const [histEmpId, setHistEmpId] = useState('');
  const [histWages, setHistWages] = useState<WagePayment[]>([]);
  const [histAdvances, setHistAdvances] = useState<CashAdvance[]>([]);

  // ── P2PR1: attendance ──
  const [attnDate, setAttnDate] = useState(new Date().toISOString().slice(0, 10));
  const [attendance, setAttendance] = useState<AttendanceRecord[] | null>(null);

  // ── P2PR2: leave requests ──
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[] | null>(null);

  // ── P2PR3: overtime requests ──
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[] | null>(null);

  // ── P2PR4: disbursement requests ──
  const [disbursementRequests, setDisbursementRequests] = useState<DisbursementRequest[] | null>(null);

  const reload = useCallback(() => {
    if (!companyId || !canRead) return;
    payrollApi.fetchEmployees(companyId).then(setEmployees).catch(() => setEmployees([]));
    payrollApi.fetchPositions(companyId).then(setPositions).catch(() => setPositions([]));
    payrollApi.listLeaveRequests(companyId, null, null, null).then(setLeaveRequests).catch(() => setLeaveRequests([]));
    payrollApi.listOvertimeRequests(companyId, null, null, null).then(setOvertimeRequests).catch(() => setOvertimeRequests([]));
    payrollApi.listDisbursementRequests(companyId, null, null).then(setDisbursementRequests).catch(() => setDisbursementRequests([]));
    if (branchId) {
      payrollApi.fetchAdvances(companyId, branchId).then(setAdvances).catch(() => setAdvances([]));
      payrollApi.fetchWages(companyId, branchId).then(setWages).catch(() => setWages([]));
      const from = new Date(new Date(attnDate).getTime() - 29 * 86400000).toISOString().slice(0, 10);
      payrollApi.listAttendance(companyId, branchId, null, from, attnDate).then(setAttendance).catch(() => setAttendance([]));
    }
    if (histEmpId) {
      payrollApi.fetchEmployeeWages(companyId, histEmpId).then(setHistWages).catch(() => setHistWages([]));
      payrollApi.fetchEmployeeAdvances(companyId, histEmpId).then(setHistAdvances).catch(() => setHistAdvances([]));
    }
  }, [companyId, canRead, branchId, histEmpId, attnDate]);
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
  // Owner ask (2026-07-19): paying an odd amount meant back-solving days = amount / rate by hand —
  // e.g. typing "0.387" to land on a specific peso figure. "By Exact Amount" flips the direction: the
  // owner types the peso amount they actually want to pay, and the equivalent days-worked (still the
  // unit the RPC/audit trail records — B4/M5B never gained a separate "flat amount" concept) is derived
  // silently. No schema change: payroll_disburse_wage already accepts any decimal p_days_worked.
  const [wMode, setWMode] = useState<'days' | 'amount'>('days');
  const [wAmount, setWAmount] = useState('');
  const [wDed, setWDed] = useState('0');
  const [wBonus, setWBonus] = useState('0');
  const [wPeriod, setWPeriod] = useState('');
  const [wNotes, setWNotes] = useState('');
  const [wPayAccountId, setWPayAccountId] = useState(''); // P2PR5: '' = cash drawer

  const wAmountNum = parseFloat(wAmount) || 0;
  // Amount mode shows the typed figure verbatim as the base (exact, no derived-then-rebuilt rounding
  // surprise for the owner) — the days sent to the RPC is solved from it only at submit time. A bonus
  // is always additive on top of the base, shown as its own line so it's never silently folded in.
  const wBaseGross = !wageEmp ? 0 : wMode === 'amount' ? round2(wAmountNum) : round2((parseFloat(wDays) || 0) * wageEmp.daily_rate);
  const wDaysForSubmit = wMode === 'amount' ? (wageEmp && wageEmp.daily_rate > 0 ? wAmountNum / wageEmp.daily_rate : 0) : parseFloat(wDays) || 0;
  const wDedNum = parseFloat(wDed) || 0;
  const wBonusNum = parseFloat(wBonus) || 0;
  const wGross = round2(wBaseGross + wBonusNum);
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

  // P2PR1: mark one employee's attendance for the selected date. Upsert — clicking a different
  // status for the same employee/date corrects the existing record, never creates a duplicate.
  async function markAttendance(employeeId: string, status: AttendanceRecord['status']) {
    if (!branchId) return;
    setBusy(true);
    try {
      await payrollApi.recordAttendance(branchId, employeeId, attnDate, status);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not record attendance', 'error'); } finally { setBusy(false); }
  }

  // ── P2PR2: leave requests — file (manager, on behalf of any employee) ──
  const [leaveFileOpen, setLeaveFileOpen] = useState(false);
  const [lfEmpId, setLfEmpId] = useState('');
  const [lfType, setLfType] = useState<LeaveType>('Vacation');
  const [lfStart, setLfStart] = useState('');
  const [lfEnd, setLfEnd] = useState('');
  const [lfReason, setLfReason] = useState('');
  const LEAVE_TYPES: LeaveType[] = ['Vacation', 'Sick', 'Emergency', 'Maternity', 'Paternity', 'Unpaid', 'Other'];

  async function submitLeaveRequest() {
    if (!branchId || !lfEmpId || !lfStart || !lfEnd) return;
    setBusy(true);
    try {
      await payrollApi.requestLeave(branchId, lfEmpId, lfType, lfStart, lfEnd, lfReason.trim() || null);
      notify('Leave request filed');
      setLeaveFileOpen(false); setLfEmpId(''); setLfType('Vacation'); setLfStart(''); setLfEnd(''); setLfReason('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not file leave request', 'error'); } finally { setBusy(false); }
  }

  // ── P2PR2: leave requests — decide (approve, or reject with a required reason) ──
  const [decidingLeave, setDecidingLeave] = useState<{id: string; approve: boolean} | null>(null);
  const [decideReason, setDecideReason] = useState('');

  async function submitLeaveDecision() {
    if (!decidingLeave) return;
    setBusy(true);
    try {
      await payrollApi.decideLeaveRequest(decidingLeave.id, decidingLeave.approve, decideReason.trim() || null);
      notify(decidingLeave.approve ? 'Leave request approved' : 'Leave request rejected');
      setDecidingLeave(null); setDecideReason('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not decide leave request', 'error'); } finally { setBusy(false); }
  }

  // ── P2PR3: overtime requests — file (manager, on behalf of any employee) ──
  const [otFileOpen, setOtFileOpen] = useState(false);
  const [ofEmpId, setOfEmpId] = useState('');
  const [ofDate, setOfDate] = useState('');
  const [ofHours, setOfHours] = useState('');
  const [ofReason, setOfReason] = useState('');

  async function submitOvertimeRequest() {
    if (!branchId || !ofEmpId || !ofDate || !(parseFloat(ofHours) > 0)) return;
    setBusy(true);
    try {
      await payrollApi.requestOvertime(branchId, ofEmpId, ofDate, parseFloat(ofHours), ofReason.trim() || null);
      notify('Overtime request filed');
      setOtFileOpen(false); setOfEmpId(''); setOfDate(''); setOfHours(''); setOfReason('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not file overtime request', 'error'); } finally { setBusy(false); }
  }

  // ── P2PR3: overtime requests — decide (approve, or reject with a required reason) ──
  const [decidingOvertime, setDecidingOvertime] = useState<{id: string; approve: boolean} | null>(null);
  const [decideOtReason, setDecideOtReason] = useState('');

  async function submitOvertimeDecision() {
    if (!decidingOvertime) return;
    setBusy(true);
    try {
      await payrollApi.decideOvertimeRequest(decidingOvertime.id, decidingOvertime.approve, decideOtReason.trim() || null);
      notify(decidingOvertime.approve ? 'Overtime request approved' : 'Overtime request rejected');
      setDecidingOvertime(null); setDecideOtReason('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not decide overtime request', 'error'); } finally { setBusy(false); }
  }

  // P2PR4: "Disburse Wage" now files a REQUEST (separation of duties — a different payroll.manage
  // holder must approve before cash actually moves), matching the void-approval precedent exactly.
  // payroll_disburse_wage itself is unchanged and still exists server-side, but the app no longer
  // calls it directly from here.
  async function submitWage() {
    if (!branchId || !wageEmp) return;
    setBusy(true);
    try {
      await payrollApi.requestDisbursement(branchId, wageEmp.id, wPeriod, wDaysForSubmit, wDedNum, wNotes, wBonusNum, wPayAccountId || null);
      notify(`Disbursement request filed for ${wageEmp.name} — awaiting a different manager's approval`);
      setWageEmp(null); setWDays('1'); setWMode('days'); setWAmount(''); setWDed('0'); setWBonus('0'); setWPeriod(''); setWNotes(''); setWPayAccountId('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not file disbursement request', 'error'); } finally { setBusy(false); }
  }

  // ── P2PR4: disbursement requests — decide (approve, or reject with a required reason) ──
  const [decidingDisbursement, setDecidingDisbursement] = useState<{id: string; approve: boolean} | null>(null);
  const [decideDisbReason, setDecideDisbReason] = useState('');

  async function submitDisbursementDecision() {
    if (!decidingDisbursement) return;
    setBusy(true);
    try {
      if (decidingDisbursement.approve) {
        await payrollApi.approveDisbursementRequest(decidingDisbursement.id, decideDisbReason.trim() || null);
        notify('Disbursement approved — wage paid');
      } else {
        await payrollApi.rejectDisbursementRequest(decidingDisbursement.id, decideDisbReason.trim());
        notify('Disbursement request rejected');
      }
      setDecidingDisbursement(null); setDecideDisbReason('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not decide disbursement request', 'error'); } finally { setBusy(false); }
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
          ) : tab === 'leave' && canManage ? (
            <Button onClick={() => {setLfEmpId(''); setLfType('Vacation'); setLfStart(''); setLfEnd(''); setLfReason(''); setLeaveFileOpen(true);}}><CalendarX size={18} aria-hidden /> File Leave Request</Button>
          ) : tab === 'overtime' && canManage ? (
            <Button onClick={() => {setOfEmpId(''); setOfDate(''); setOfHours(''); setOfReason(''); setOtFileOpen(true);}}><Timer size={18} aria-hidden /> File Overtime Request</Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-1.5 border-b border-farm-accent pb-0.5" role="tablist">
        {([['roster', 'Roster', Users2], ['attendance', 'Attendance', CalendarCheck], ['leave', 'Leave', CalendarX], ['overtime', 'Overtime', Timer], ['disbursements', 'Disbursements', Wallet], ['history', 'Wage History', History]] as const).map(([key, label, Icon]) => (
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
              <EmployeeHistoryTables wages={histWages} advances={histAdvances} branches={branches}
                employeeName={histEmp.name} employeeCode={histEmp.employee_code}
                positionLabel={histEmp.position_id ? (positionLabel.get(histEmp.position_id) ?? '—') : '—'} />
            </>
          ) : null}
        </div>
      ) : null}

      {tab === 'attendance' ? (
        <div className="animate-fade-in space-y-6">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-lg font-bold text-farm-green"><CalendarCheck className="h-5 w-5" aria-hidden /> Mark Attendance</h3>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="attn-date">Date</label>
                <input id="attn-date" type="date" value={attnDate} onChange={(e) => setAttnDate(e.target.value)} className="min-h-11 rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm font-semibold" />
              </div>
            </div>
            {employees === null ? (
              <Skeleton rows={3} />
            ) : employees.filter((e) => e.status === 'Active').length === 0 ? (
              <EmptyState title="No active workers to mark" hint="Hire a worker from the Roster tab first." />
            ) : (
              <ul className="mt-4 divide-y divide-farm-accent-soft">
                {employees.filter((e) => e.status === 'Active').map((e) => {
                  const today = (attendance ?? []).find((a) => a.employee_id === e.id && a.work_date === attnDate);
                  return (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span className="font-bold text-farm-green">{e.name} <span className="font-mono text-[10px] text-farm-muted">{e.employee_code}</span></span>
                      <div className="flex gap-1.5">
                        {(['Present', 'Half Day', 'Absent'] as const).map((status) => (
                          <button key={status} type="button" disabled={busy} onClick={() => void markAttendance(e.id, status)}
                            className={cn('rounded-full border px-3 py-1 text-xs font-bold transition',
                              today?.status === status
                                ? status === 'Absent' ? 'border-farm-danger bg-farm-danger text-white' : 'border-farm-green bg-farm-green text-white'
                                : 'border-farm-accent-soft text-farm-muted hover:bg-farm-accent-soft')}>
                            {status}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-base font-extrabold text-farm-green">Recent Attendance <span className="text-xs font-normal text-farm-muted">(last 30 days)</span></h3>
            {attendance === null || attendance.length === 0 ? (
              <p className="py-6 text-center text-xs italic text-farm-muted">No attendance recorded in this window yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-farm-accent-soft text-left font-bold tracking-wider text-farm-muted">
                      <th className="pb-2">Date</th><th className="pb-2">Worker</th><th className="pb-2">Status</th><th className="pb-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-farm-accent-soft font-semibold">
                    {[...attendance].sort((a, b) => b.work_date.localeCompare(a.work_date)).map((a) => (
                      <tr key={a.id}>
                        <td className="py-2 font-mono">{a.work_date}</td>
                        <td className="py-2 font-bold text-farm-ink">{a.employee_name}</td>
                        <td className="py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', a.status === 'Absent' ? 'bg-red-50 text-farm-danger' : a.status === 'Half Day' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-800')}>{a.status}</span></td>
                        <td className="py-2 text-farm-muted">{a.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'leave' ? (
        <div className="animate-fade-in space-y-6">
          <Card>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-bold text-farm-green"><CalendarX className="h-5 w-5" aria-hidden /> Pending Leave Requests</h3>
            {leaveRequests === null ? (
              <Skeleton rows={3} />
            ) : leaveRequests.filter((l) => l.status === 'Pending').length === 0 ? (
              <p className="py-6 text-center text-xs italic text-farm-muted">No pending leave requests.</p>
            ) : (
              <ul className="divide-y divide-farm-accent-soft">
                {leaveRequests.filter((l) => l.status === 'Pending').map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-bold text-farm-green">{l.employee_name} <span className="rounded-full bg-farm-accent-soft px-2 py-0.5 text-[10px] font-bold text-farm-green">{l.leave_type}</span></p>
                      <p className="text-xs text-farm-muted">{l.start_date} → {l.end_date}{l.reason ? ` — ${l.reason}` : ''}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setDecidingLeave({id: l.id, approve: true})} className="rounded-lg bg-farm-green px-3 py-1.5 text-xs font-bold text-white hover:bg-farm-green-700">Approve</button>
                      <button onClick={() => setDecidingLeave({id: l.id, approve: false})} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-farm-danger hover:bg-red-100">Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-base font-extrabold text-farm-green">Leave History</h3>
            {leaveRequests === null || leaveRequests.length === 0 ? (
              <p className="py-6 text-center text-xs italic text-farm-muted">No leave requests filed yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-farm-accent-soft text-left font-bold tracking-wider text-farm-muted">
                      <th className="pb-2">Worker</th><th className="pb-2">Type</th><th className="pb-2">Dates</th><th className="pb-2">Status</th><th className="pb-2">Decided By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-farm-accent-soft font-semibold">
                    {[...leaveRequests].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((l) => (
                      <tr key={l.id}>
                        <td className="py-2 font-bold text-farm-ink">{l.employee_name}</td>
                        <td className="py-2">{l.leave_type}</td>
                        <td className="py-2 font-mono">{l.start_date} → {l.end_date}</td>
                        <td className="py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', l.status === 'Rejected' ? 'bg-red-50 text-farm-danger' : l.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-800')}>{l.status}</span></td>
                        <td className="py-2 text-farm-muted">{l.decider_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'overtime' ? (
        <div className="animate-fade-in space-y-6">
          <Card>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-bold text-farm-green"><Timer className="h-5 w-5" aria-hidden /> Pending Overtime Requests</h3>
            {overtimeRequests === null ? (
              <Skeleton rows={3} />
            ) : overtimeRequests.filter((o) => o.status === 'Pending').length === 0 ? (
              <p className="py-6 text-center text-xs italic text-farm-muted">No pending overtime requests.</p>
            ) : (
              <ul className="divide-y divide-farm-accent-soft">
                {overtimeRequests.filter((o) => o.status === 'Pending').map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-bold text-farm-green">{o.employee_name} <span className="rounded-full bg-farm-accent-soft px-2 py-0.5 text-[10px] font-bold text-farm-green">{o.hours}h</span></p>
                      <p className="text-xs text-farm-muted">{o.work_date}{o.reason ? ` — ${o.reason}` : ''}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setDecidingOvertime({id: o.id, approve: true})} className="rounded-lg bg-farm-green px-3 py-1.5 text-xs font-bold text-white hover:bg-farm-green-700">Approve</button>
                      <button onClick={() => setDecidingOvertime({id: o.id, approve: false})} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-farm-danger hover:bg-red-100">Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-base font-extrabold text-farm-green">Overtime History</h3>
            {overtimeRequests === null || overtimeRequests.length === 0 ? (
              <p className="py-6 text-center text-xs italic text-farm-muted">No overtime requests filed yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-farm-accent-soft text-left font-bold tracking-wider text-farm-muted">
                      <th className="pb-2">Worker</th><th className="pb-2">Date</th><th className="pb-2 text-right">Hours</th><th className="pb-2">Status</th><th className="pb-2">Decided By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-farm-accent-soft font-semibold">
                    {[...overtimeRequests].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((o) => (
                      <tr key={o.id}>
                        <td className="py-2 font-bold text-farm-ink">{o.employee_name}</td>
                        <td className="py-2 font-mono">{o.work_date}</td>
                        <td className="tabular py-2 text-right">{o.hours}h</td>
                        <td className="py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', o.status === 'Rejected' ? 'bg-red-50 text-farm-danger' : o.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-800')}>{o.status}</span></td>
                        <td className="py-2 text-farm-muted">{o.decider_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'disbursements' ? (
        <div className="animate-fade-in space-y-6">
          <Card>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-bold text-farm-green"><Wallet className="h-5 w-5" aria-hidden /> Pending Disbursement Requests</h3>
            <p className="mb-3 text-xs text-farm-muted">File a request from an employee&apos;s row on the Roster tab. A <em>different</em> payroll manager must approve here before cash actually moves.</p>
            {disbursementRequests === null ? (
              <Skeleton rows={3} />
            ) : disbursementRequests.filter((d) => d.status === 'Pending').length === 0 ? (
              <p className="py-6 text-center text-xs italic text-farm-muted">No pending disbursement requests.</p>
            ) : (
              <ul className="divide-y divide-farm-accent-soft">
                {disbursementRequests.filter((d) => d.status === 'Pending').map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-bold text-farm-green">{d.employee_name} <span className="text-xs font-normal text-farm-muted">— filed by {d.requester_name}</span></p>
                      <p className="text-xs text-farm-muted">{d.pay_period} · {d.days_worked} day(s) · {d.account_name ? `${d.account_name}${d.account_provider ? ` (${d.account_provider})` : ''}` : 'Cash'}{d.bonus_amount > 0 ? ` · +${formatPeso(d.bonus_amount)} bonus` : ''}{d.ca_deduction > 0 ? ` · −${formatPeso(d.ca_deduction)} advance` : ''}{d.notes ? ` — ${d.notes}` : ''}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setDecidingDisbursement({id: d.id, approve: true})} className="rounded-lg bg-farm-green px-3 py-1.5 text-xs font-bold text-white hover:bg-farm-green-700">Approve</button>
                      <button onClick={() => setDecidingDisbursement({id: d.id, approve: false})} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-farm-danger hover:bg-red-100">Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-base font-extrabold text-farm-green">Disbursement Request History</h3>
            {disbursementRequests === null || disbursementRequests.length === 0 ? (
              <p className="py-6 text-center text-xs italic text-farm-muted">No disbursement requests filed yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-farm-accent-soft text-left font-bold tracking-wider text-farm-muted">
                      <th className="pb-2">Worker</th><th className="pb-2">Pay Period</th><th className="pb-2">Method</th><th className="pb-2">Filed By</th><th className="pb-2">Status</th><th className="pb-2">Decided By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-farm-accent-soft font-semibold">
                    {[...disbursementRequests].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((d) => (
                      <tr key={d.id}>
                        <td className="py-2 font-bold text-farm-ink">{d.employee_name}</td>
                        <td className="py-2">{d.pay_period}</td>
                        <td className="py-2 text-farm-muted">{d.account_name ?? 'Cash'}</td>
                        <td className="py-2 text-farm-muted">{d.requester_name}</td>
                        <td className="py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', d.status === 'Rejected' ? 'bg-red-50 text-farm-danger' : d.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-800')}>{d.status}</span></td>
                        <td className="py-2 text-farm-muted">{d.decider_name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
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
                          {canManage ? <button onClick={() => {setWageEmp(e); setWDays('1'); setWMode('days'); setWAmount(''); setWDed(String(e.advance_balance)); setWBonus('0'); setWPeriod(''); setWNotes(''); setWPayAccountId('');}} className="rounded-lg bg-farm-green px-2.5 py-1 text-xs font-bold text-white hover:bg-farm-green-700">Request Disbursement</button> : null}
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
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="flex items-center gap-2 text-xl font-bold text-farm-green"><Wallet className="h-5 w-5" aria-hidden /> Request Wage Disbursement</Dialog.Title>
            <p className="mb-4 mt-1 text-xs text-farm-muted"><span className="font-bold text-farm-green">{wageEmp?.name}</span> · {formatPeso(wageEmp?.daily_rate ?? 0)}/day · a different payroll manager must approve before this is paid</p>
            <div className="space-y-4 text-sm">
              <div className="flex gap-1.5 rounded-lg bg-farm-bg p-1">
                {([['days', 'By Days Worked'], ['amount', 'By Exact Amount']] as const).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => setWMode(m)}
                    className={cn('flex-1 rounded-md py-1.5 text-xs font-bold', wMode === m ? 'bg-farm-green text-white' : 'text-farm-muted hover:bg-farm-accent-soft')}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {wMode === 'days' ? (
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
                ) : (
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-amount">Wage Amount (₱)</label>
                    <input id="w-amount" value={wAmount} onChange={(e) => setWAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="e.g. 550" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-center text-sm font-bold" />
                    <p className="mt-1 text-[9px] text-farm-muted">Type the exact peso amount to pay — no days math needed.</p>
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-ded">Deduct Advance (₱)</label>
                  <input id="w-ded" value={wDed} onChange={(e) => setWDed(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-center text-sm font-bold text-farm-danger" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-bonus">Bonus / Incentive (₱)</label>
                  <input id="w-bonus" value={wBonus} onChange={(e) => setWBonus(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-center text-sm font-bold text-farm-green" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-period">Pay Period</label>
                <input id="w-period" value={wPeriod} onChange={(e) => setWPeriod(e.target.value)} placeholder="e.g. July 1-7" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              {payAccounts.length > 0 ? (
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Payout Method</label>
                  <SelectField value={wPayAccountId} onChange={setWPayAccountId}
                    options={[{value: '', label: 'Cash (drawer)'}, ...payAccounts.map((a) => ({value: a.id, label: `${a.name}${a.provider ? ` · ${a.provider}` : ''}`}))]} />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-notes">Notes</label>
                <input id="w-notes" value={wNotes} onChange={(e) => setWNotes(e.target.value)} placeholder="Regular harvesting cycle pay" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div className="space-y-1 rounded-xl border border-farm-accent bg-emerald-50/60 p-3 text-xs">
                <div className="flex justify-between"><span>{wMode === 'amount' ? 'Base amount' : 'Days × rate'}</span><span className="tabular font-bold">{formatPeso(wBaseGross)}</span></div>
                {wBonusNum > 0 ? <div className="flex justify-between text-farm-green"><span>+ Bonus</span><span className="tabular font-bold">+{formatPeso(wBonusNum)}</span></div> : null}
                <div className="flex justify-between text-farm-danger"><span>Deduct advance</span><span className="tabular font-bold">−{formatPeso(wDedNum)}</span></div>
                <div className="flex justify-between border-t border-dashed border-farm-accent pt-1 font-black text-farm-green"><span>PROJECTED NET PAYOUT</span><span className="tabular">{formatPeso(wNet)}</span></div>
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setWageEmp(null)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitWage()} disabled={busy || !(wGross > 0) || wDedNum > wGross}>{busy ? 'Filing…' : 'File Disbursement Request'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Decide disbursement request modal — approve (executes the payment) or reject (reason required) */}
      <Dialog.Root open={decidingDisbursement !== null} onOpenChange={(o) => {if (!o) {setDecidingDisbursement(null); setDecideDisbReason('');}}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="flex items-center gap-2 text-xl font-bold text-farm-green">
              <Wallet className="h-5 w-5" aria-hidden /> {decidingDisbursement?.approve ? 'Approve' : 'Reject'} Disbursement Request
            </Dialog.Title>
            <p className="mb-4 mt-1 text-xs text-farm-muted">{decidingDisbursement?.approve ? 'Approving pays the wage immediately. A payroll manager other than the requester must decide — enforced server-side.' : 'A reason is required to reject.'}</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="decide-disb-reason">{decidingDisbursement?.approve ? 'Note (optional)' : 'Reason'}</label>
                <input id="decide-disb-reason" value={decideDisbReason} onChange={(e) => setDecideDisbReason(e.target.value)} placeholder={decidingDisbursement?.approve ? 'e.g. looks correct' : 'e.g. wrong pay period, refile'} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => {setDecidingDisbursement(null); setDecideDisbReason('');}} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitDisbursementDecision()} disabled={busy || (decidingDisbursement?.approve === false && !decideDisbReason.trim())}>
                {busy ? 'Saving…' : decidingDisbursement?.approve ? 'Approve & Pay' : 'Reject'}
              </Button>
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

      {/* File Leave Request modal (P2PR2) */}
      <Dialog.Root open={leaveFileOpen} onOpenChange={setLeaveFileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">File Leave Request</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Files on the worker&apos;s behalf. An overlapping Pending or Approved request for the same worker is not allowed.</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Worker</label>
                <SelectField value={lfEmpId} onChange={setLfEmpId} placeholder="Pick a worker" options={(employees ?? []).filter((e) => e.status === 'Active').map((e) => ({value: e.id, label: e.name}))} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Leave Type</label>
                <SelectField value={lfType} onChange={(v) => setLfType(v as LeaveType)} options={LEAVE_TYPES.map((t) => ({value: t, label: t}))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="lf-start">Start Date</label>
                  <input id="lf-start" type="date" value={lfStart} onChange={(e) => setLfStart(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="lf-end">End Date</label>
                  <input id="lf-end" type="date" value={lfEnd} onChange={(e) => setLfEnd(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="lf-reason">Reason (optional)</label>
                <input id="lf-reason" value={lfReason} onChange={(e) => setLfReason(e.target.value)} placeholder="e.g. family event" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setLeaveFileOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitLeaveRequest()} disabled={busy || !lfEmpId || !lfStart || !lfEnd}>{busy ? 'Filing…' : 'File Request'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Decide leave request modal — approve (note optional) or reject (reason required) */}
      <Dialog.Root open={decidingLeave !== null} onOpenChange={(o) => {if (!o) {setDecidingLeave(null); setDecideReason('');}}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="flex items-center gap-2 text-xl font-bold text-farm-green">
              <CalendarX className="h-5 w-5" aria-hidden /> {decidingLeave?.approve ? 'Approve' : 'Reject'} Leave Request
            </Dialog.Title>
            <p className="mb-4 mt-1 text-xs text-farm-muted">{decidingLeave?.approve ? 'A payroll manager other than the beneficiary must decide — this is enforced server-side.' : 'A reason is required to reject.'}</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="decide-reason">{decidingLeave?.approve ? 'Note (optional)' : 'Reason'}</label>
                <input id="decide-reason" value={decideReason} onChange={(e) => setDecideReason(e.target.value)} placeholder={decidingLeave?.approve ? 'e.g. cover arranged' : 'e.g. short-staffed that week'} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => {setDecidingLeave(null); setDecideReason('');}} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitLeaveDecision()} disabled={busy || (decidingLeave?.approve === false && !decideReason.trim())}>
                {busy ? 'Saving…' : decidingLeave?.approve ? 'Approve' : 'Reject'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* File Overtime Request modal (P2PR3) */}
      <Dialog.Root open={otFileOpen} onOpenChange={setOtFileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">File Overtime Request</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Files on the worker&apos;s behalf. A second request for the same worker on the same date is not allowed.</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Worker</label>
                <SelectField value={ofEmpId} onChange={setOfEmpId} placeholder="Pick a worker" options={(employees ?? []).filter((e) => e.status === 'Active').map((e) => ({value: e.id, label: e.name}))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="of-date">Date</label>
                  <input id="of-date" type="date" value={ofDate} onChange={(e) => setOfDate(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="of-hours">Hours</label>
                  <input id="of-hours" value={ofHours} onChange={(e) => setOfHours(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="e.g. 2.5" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-center text-sm font-bold" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="of-reason">Reason (optional)</label>
                <input id="of-reason" value={ofReason} onChange={(e) => setOfReason(e.target.value)} placeholder="e.g. harvest push" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setOtFileOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitOvertimeRequest()} disabled={busy || !ofEmpId || !ofDate || !(parseFloat(ofHours) > 0)}>{busy ? 'Filing…' : 'File Request'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Decide overtime request modal — approve (note optional) or reject (reason required) */}
      <Dialog.Root open={decidingOvertime !== null} onOpenChange={(o) => {if (!o) {setDecidingOvertime(null); setDecideOtReason('');}}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="flex items-center gap-2 text-xl font-bold text-farm-green">
              <Timer className="h-5 w-5" aria-hidden /> {decidingOvertime?.approve ? 'Approve' : 'Reject'} Overtime Request
            </Dialog.Title>
            <p className="mb-4 mt-1 text-xs text-farm-muted">{decidingOvertime?.approve ? 'A payroll manager other than the beneficiary must decide — this is enforced server-side.' : 'A reason is required to reject.'}</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="decide-ot-reason">{decidingOvertime?.approve ? 'Note (optional)' : 'Reason'}</label>
                <input id="decide-ot-reason" value={decideOtReason} onChange={(e) => setDecideOtReason(e.target.value)} placeholder={decidingOvertime?.approve ? 'e.g. approved, extra harvest day' : 'e.g. not authorized in advance'} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => {setDecidingOvertime(null); setDecideOtReason('');}} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitOvertimeDecision()} disabled={busy || (decidingOvertime?.approve === false && !decideOtReason.trim())}>
                {busy ? 'Saving…' : decidingOvertime?.approve ? 'Approve' : 'Reject'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// ── M5C "My Payroll" — read-only self view for users WITHOUT payroll.read. The server's RLS is the gate:
// fetches return only the employee row linked to this user (and their advances/wages), or nothing at all.
// P2PR2 extends this with self-service leave filing — the one write a plain linked worker can make
// with zero payroll permission (payroll_request_leave's self path), matching 21.08's "employee submits
// a leave request" and the guard's own HAPPY2 self-service assertion.
function MyPayroll({companyId}: {companyId?: string}) {
  const {notify} = useToast();
  const [me, setMe] = useState<Employee | null | undefined>(undefined); // undefined=loading, null=not linked
  const [advances, setAdvances] = useState<CashAdvance[]>([]);
  const [wages, setWages] = useState<WagePayment[]>([]);
  const [myPositionLabel, setMyPositionLabel] = useState<string>('—');
  const [myLeave, setMyLeave] = useState<LeaveRequest[]>([]);
  const [myOvertime, setMyOvertime] = useState<OvertimeRequest[]>([]);

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  useEffect(() => {if (companyId) hydrateBranches(companyId);}, [companyId]);

  const reloadMyLeave = useCallback(() => {
    if (companyId) payrollApi.listLeaveRequests(companyId, null, null, null).then(setMyLeave).catch(() => setMyLeave([]));
  }, [companyId]);
  const reloadMyOvertime = useCallback(() => {
    if (companyId) payrollApi.listOvertimeRequests(companyId, null, null, null).then(setMyOvertime).catch(() => setMyOvertime([]));
  }, [companyId]);

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
        reloadMyLeave();
        reloadMyOvertime();
      }
    }).catch(() => setMe(null));
  }, [companyId, reloadMyLeave, reloadMyOvertime]);

  // ── self-service leave filing ──
  const [reqOpen, setReqOpen] = useState(false);
  const [reqBranchId, setReqBranchId] = useState('');
  const [reqType, setReqType] = useState<LeaveType>('Vacation');
  const [reqStart, setReqStart] = useState('');
  const [reqEnd, setReqEnd] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const LEAVE_TYPES: LeaveType[] = ['Vacation', 'Sick', 'Emergency', 'Maternity', 'Paternity', 'Unpaid', 'Other'];

  async function submitMyLeaveRequest() {
    if (!me || !reqBranchId || !reqStart || !reqEnd) return;
    setReqBusy(true);
    try {
      await payrollApi.requestLeave(reqBranchId, me.id, reqType, reqStart, reqEnd, reqReason.trim() || null);
      notify('Leave request filed');
      setReqOpen(false); setReqType('Vacation'); setReqStart(''); setReqEnd(''); setReqReason('');
      reloadMyLeave();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not file leave request', 'error'); } finally { setReqBusy(false); }
  }

  // ── self-service overtime filing ──
  const [otReqOpen, setOtReqOpen] = useState(false);
  const [otReqBranchId, setOtReqBranchId] = useState('');
  const [otReqDate, setOtReqDate] = useState('');
  const [otReqHours, setOtReqHours] = useState('');
  const [otReqReason, setOtReqReason] = useState('');
  const [otReqBusy, setOtReqBusy] = useState(false);

  async function submitMyOvertimeRequest() {
    if (!me || !otReqBranchId || !otReqDate || !(parseFloat(otReqHours) > 0)) return;
    setOtReqBusy(true);
    try {
      await payrollApi.requestOvertime(otReqBranchId, me.id, otReqDate, parseFloat(otReqHours), otReqReason.trim() || null);
      notify('Overtime request filed');
      setOtReqOpen(false); setOtReqDate(''); setOtReqHours(''); setOtReqReason('');
      reloadMyOvertime();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not file overtime request', 'error'); } finally { setOtReqBusy(false); }
  }

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

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-extrabold text-farm-green"><CalendarX className="h-4 w-4" aria-hidden /> My Leave Requests</h3>
              <Button onClick={() => {setReqBranchId(branches?.[0]?.id ?? ''); setReqType('Vacation'); setReqStart(''); setReqEnd(''); setReqReason(''); setReqOpen(true);}}>Request Leave</Button>
            </div>
            {myLeave.length === 0 ? (
              <p className="py-6 text-center text-xs italic text-farm-muted">No leave requests filed yet.</p>
            ) : (
              <ul className="divide-y divide-farm-accent-soft text-sm">
                {myLeave.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <span className="font-bold text-farm-green">{l.leave_type}</span>{' '}
                      <span className="font-mono text-xs text-farm-muted">{l.start_date} → {l.end_date}</span>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', l.status === 'Rejected' ? 'bg-red-50 text-farm-danger' : l.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-800')}>{l.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-extrabold text-farm-green"><Timer className="h-4 w-4" aria-hidden /> My Overtime Requests</h3>
              <Button onClick={() => {setOtReqBranchId(branches?.[0]?.id ?? ''); setOtReqDate(''); setOtReqHours(''); setOtReqReason(''); setOtReqOpen(true);}}>Request Overtime</Button>
            </div>
            {myOvertime.length === 0 ? (
              <p className="py-6 text-center text-xs italic text-farm-muted">No overtime requests filed yet.</p>
            ) : (
              <ul className="divide-y divide-farm-accent-soft text-sm">
                {myOvertime.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <span className="font-bold text-farm-green">{o.hours}h</span>{' '}
                      <span className="font-mono text-xs text-farm-muted">{o.work_date}</span>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', o.status === 'Rejected' ? 'bg-red-50 text-farm-danger' : o.status === 'Pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-800')}>{o.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <EmployeeHistoryTables wages={wages} advances={advances} wageTitle="My Wage History" advanceTitle="My Cash Advances"
            branches={branches} employeeName={me.name} employeeCode={me.employee_code} positionLabel={myPositionLabel} />
        </>
      )}

      {/* Self-service overtime request modal */}
      <Dialog.Root open={otReqOpen} onOpenChange={setOtReqOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">Request Overtime</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Files under your own name — a payroll manager (not you) will decide it.</p>
            <div className="space-y-4 text-sm">
              {(branches?.length ?? 0) > 1 ? (
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Branch</label>
                  <SelectField value={otReqBranchId} onChange={setOtReqBranchId} options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} />
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="my-of-date">Date</label>
                  <input id="my-of-date" type="date" value={otReqDate} onChange={(e) => setOtReqDate(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="my-of-hours">Hours</label>
                  <input id="my-of-hours" value={otReqHours} onChange={(e) => setOtReqHours(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="e.g. 2.5" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-center text-sm font-bold" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="my-of-reason">Reason (optional)</label>
                <input id="my-of-reason" value={otReqReason} onChange={(e) => setOtReqReason(e.target.value)} placeholder="e.g. harvest push" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setOtReqOpen(false)} disabled={otReqBusy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitMyOvertimeRequest()} disabled={otReqBusy || !otReqBranchId || !otReqDate || !(parseFloat(otReqHours) > 0)}>{otReqBusy ? 'Filing…' : 'File Request'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Self-service leave request modal */}
      <Dialog.Root open={reqOpen} onOpenChange={setReqOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">Request Leave</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Files under your own name — a payroll manager (not you) will decide it.</p>
            <div className="space-y-4 text-sm">
              {(branches?.length ?? 0) > 1 ? (
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Branch</label>
                  <SelectField value={reqBranchId} onChange={setReqBranchId} options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Leave Type</label>
                <SelectField value={reqType} onChange={(v) => setReqType(v as LeaveType)} options={LEAVE_TYPES.map((t) => ({value: t, label: t}))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="my-lf-start">Start Date</label>
                  <input id="my-lf-start" type="date" value={reqStart} onChange={(e) => setReqStart(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="my-lf-end">End Date</label>
                  <input id="my-lf-end" type="date" value={reqEnd} onChange={(e) => setReqEnd(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="my-lf-reason">Reason (optional)</label>
                <input id="my-lf-reason" value={reqReason} onChange={(e) => setReqReason(e.target.value)} placeholder="e.g. family event" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setReqOpen(false)} disabled={reqBusy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitMyLeaveRequest()} disabled={reqBusy || !reqBranchId || !reqStart || !reqEnd}>{reqBusy ? 'Filing…' : 'File Request'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// Wage + cash-advance history tables — shared by MyPayroll (self view) and the Wage History tab
// (co-owner+ looking up any employee: co-owner/owner aren't waged themselves, so this is how they
// check what an admin-and-below worker has been paid, per owner directive 2026-07-17).
function EmployeeHistoryTables({wages, advances, wageTitle = 'Wage History', advanceTitle = 'Cash Advances', branches, employeeName, employeeCode, positionLabel}: {
  wages: WagePayment[]; advances: CashAdvance[]; wageTitle?: string; advanceTitle?: string;
  branches?: Branch[]; employeeName: string; employeeCode: string; positionLabel: string;
}) {
  const [payslipWage, setPayslipWage] = useState<WagePayment | null>(null);
  return (
    <>
      <Card>
        <h3 className="mb-3 flex items-center gap-2 text-base font-extrabold text-farm-green"><Wallet className="h-4 w-4" aria-hidden /> {wageTitle}</h3>
        {wages.length === 0 ? <p className="py-6 text-center text-xs italic text-farm-muted">No wages recorded yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead><tr className="border-b border-farm-accent-soft text-left text-xs font-bold text-farm-muted"><th className="pb-2">Period</th><th className="pb-2 text-right">Days</th><th className="pb-2 text-right">Gross</th><th className="pb-2 text-right">Advance deducted</th><th className="pb-2 text-right">Net received</th><th className="pb-2 text-right">Payslip</th></tr></thead>
              <tbody className="divide-y divide-farm-accent-soft">
                {wages.map((w) => (
                  <tr key={w.id}>
                    <td className="py-2 font-semibold">{w.pay_period}</td>
                    <td className="tabular py-2 text-right">{w.days_worked}</td>
                    <td className="tabular py-2 text-right">{formatPeso(w.gross)}</td>
                    <td className="tabular py-2 text-right text-farm-danger">−{formatPeso(w.ca_deducted)}</td>
                    <td className="tabular py-2 text-right font-black text-farm-green">{formatPeso(w.net)}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => setPayslipWage(w)} className="inline-flex items-center gap-1 rounded-lg border border-farm-accent-soft px-2 py-1 text-[10px] font-bold text-farm-green hover:bg-farm-accent-soft" aria-label={`View payslip for ${w.pay_period}`}>
                        <FileText className="h-3 w-3" aria-hidden /> View
                      </button>
                    </td>
                  </tr>
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

      <Dialog.Root open={payslipWage !== null} onOpenChange={(o) => {if (!o) setPayslipWage(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-farm-card p-6 shadow-xl">
            {payslipWage ? (
              <>
                <div id="payslip-print" className="space-y-4 text-sm text-farm-ink">
                  <div className="text-center">
                    <p className="text-xs font-bold uppercase tracking-widest text-farm-muted">PickUrVeggie Farm</p>
                    <p className="text-[11px] text-farm-muted">{branches?.find((b) => b.id === payslipWage.branch_id)?.name ?? 'Branch'}</p>
                    <h3 className="mt-1 text-lg font-black text-farm-green">Payslip</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-y border-dashed border-farm-accent-soft py-3 text-xs">
                    <div><p className="font-bold uppercase text-farm-muted">Employee</p><p className="font-semibold">{employeeName} <span className="font-mono text-farm-muted">{employeeCode}</span></p></div>
                    <div><p className="font-bold uppercase text-farm-muted">Position</p><p className="font-semibold">{positionLabel}</p></div>
                    <div><p className="font-bold uppercase text-farm-muted">Pay Period</p><p className="font-semibold">{payslipWage.pay_period}</p></div>
                    <div><p className="font-bold uppercase text-farm-muted">Date Paid</p><p className="font-semibold">{new Date(payslipWage.created_at).toLocaleDateString('en-PH', {year: 'numeric', month: 'short', day: 'numeric'})}</p></div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between"><span>{payslipWage.days_worked} day(s) × {formatPeso(payslipWage.daily_rate)}</span><span className="tabular font-semibold">{formatPeso(round2(payslipWage.gross - payslipWage.bonus_amount))}</span></div>
                    {payslipWage.bonus_amount > 0 ? <div className="flex justify-between text-farm-green"><span>+ Bonus / Incentive</span><span className="tabular font-semibold">+{formatPeso(payslipWage.bonus_amount)}</span></div> : null}
                    <div className="flex justify-between border-t border-farm-accent-soft pt-1.5 font-bold"><span>Gross Pay</span><span className="tabular">{formatPeso(payslipWage.gross)}</span></div>
                    {payslipWage.ca_deducted > 0 ? <div className="flex justify-between text-farm-danger"><span>− Cash Advance Deduction</span><span className="tabular font-semibold">−{formatPeso(payslipWage.ca_deducted)}</span></div> : null}
                    <div className="flex justify-between rounded-lg bg-emerald-50/60 px-2 py-2 text-base font-black text-farm-green"><span>NET PAY</span><span className="tabular">{formatPeso(payslipWage.net)}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-dashed border-farm-accent-soft pt-3 text-xs">
                    <div><p className="font-bold uppercase text-farm-muted">Payment Method</p><p className="font-semibold">{payslipWage.financial_accounts ? `${payslipWage.financial_accounts.name}${payslipWage.financial_accounts.provider ? ` (${payslipWage.financial_accounts.provider})` : ''}` : payslipWage.financial_account_id ? 'Digital / Bank Account' : 'Cash'}</p></div>
                    <div><p className="font-bold uppercase text-farm-muted">Recorded By</p><p className="font-semibold">{payslipWage.creator?.username ?? '—'}</p></div>
                  </div>
                  {payslipWage.notes ? <p className="border-t border-dashed border-farm-accent-soft pt-3 text-xs text-farm-muted"><span className="font-bold uppercase">Notes</span> — {payslipWage.notes}</p> : null}
                  <p className="pt-2 text-center text-[9px] text-farm-muted">Generated from PickUrVeggie ERP payroll records — not a legal government payslip form.</p>
                </div>
                <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
                  <Button variant="secondary" onClick={() => setPayslipWage(null)}>Close</Button>
                  <Button className="flex-1" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</Button>
                </div>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
