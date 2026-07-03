// Farm Staff Payroll & Advances (P2-M5B) — prototype-parity: src/features/Payroll.tsx is the workflow authority.
// Roster (live undeducted-advance pill) · Hire · Log Advance · Disburse Wage (gross = days × rate, net preview) ·
// Wage Disbursement Journal. Advances/wages post balanced GL server-side (22.20); the branch selector picks the
// paying branch. All writes via payrollApi (governed functions; B5 offline-queued).
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {HandCoins, Users2, UserPlus, Wallet, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {formatPeso, round2} from '../pos/money';
import {payrollApi} from './api';
import type {CashAdvance, Employee, WagePayment} from '../../types/db';

const POSITIONS = ['Harvester', 'Farm Operator', 'Warehouse Packer', 'Delivery Driver'];

export default function PayrollScreen() {
  const {companyId, has} = usePermissions();
  const {notify} = useToast();
  const canRead = has('payroll.read');
  const canManage = has('payroll.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [advances, setAdvances] = useState<CashAdvance[]>([]);
  const [wages, setWages] = useState<WagePayment[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!companyId || !canRead) return;
    payrollApi.fetchEmployees(companyId).then(setEmployees).catch(() => setEmployees([]));
    if (branchId) {
      payrollApi.fetchAdvances(companyId, branchId).then(setAdvances).catch(() => setAdvances([]));
      payrollApi.fetchWages(companyId, branchId).then(setWages).catch(() => setWages([]));
    }
  }, [companyId, canRead, branchId]);
  useEffect(reload, [reload]);

  const empName = useMemo(() => new Map((employees ?? []).map((e) => [e.id, e.name])), [employees]);

  // ── hire ──
  const [hireOpen, setHireOpen] = useState(false);
  const [hName, setHName] = useState('');
  const [hPos, setHPos] = useState('Harvester');
  const [hRate, setHRate] = useState('550');

  // ── advance ──
  const [advEmp, setAdvEmp] = useState<Employee | null>(null);
  const [advAmt, setAdvAmt] = useState('');
  const [advNote, setAdvNote] = useState('');

  // ── wage ──
  const [wageEmp, setWageEmp] = useState<Employee | null>(null);
  const [wDays, setWDays] = useState('5');
  const [wDed, setWDed] = useState('0');
  const [wPeriod, setWPeriod] = useState('');
  const [wNotes, setWNotes] = useState('');

  const wGross = wageEmp ? round2((parseFloat(wDays) || 0) * wageEmp.daily_rate) : 0;
  const wDedNum = parseFloat(wDed) || 0;
  const wNet = round2(Math.max(0, wGross - wDedNum));

  async function submitHire() {
    if (!companyId) return;
    setBusy(true);
    try {
      await payrollApi.hire(companyId, {name: hName, position: hPos, dailyRate: parseFloat(hRate)});
      notify(`${hName.trim()} hired`);
      setHireOpen(false); setHName(''); setHRate('550');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Hire failed', 'error'); } finally { setBusy(false); }
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
      setWageEmp(null); setWDays('5'); setWDed('0'); setWPeriod(''); setWNotes('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Disbursement failed', 'error'); } finally { setBusy(false); }
  }

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Farm Staff Payroll &amp; Advances" />
        <Card><EmptyState title="Payroll access needed" hint="Your role does not include the payroll.read permission. Ask a manager to grant it." /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Farm Staff Payroll &amp; Advances"
        subtitle="Manage hired workers, dispatch paysheets, and track advances with a live, never-stored balance."
        action={
          <div className="flex items-center gap-2">
            <div className="w-44"><SelectField value={branchId} onChange={setBranchId} placeholder="Paying branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} /></div>
            {canManage ? <Button onClick={() => {setHName(''); setHPos('Harvester'); setHRate('550'); setHireOpen(true);}}><UserPlus size={18} aria-hidden /> Hire Worker</Button> : null}
          </div>
        }
      />

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
                    <td className="py-3 font-semibold text-farm-muted">{e.position}</td>
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
                          {canManage ? <button onClick={() => {setWageEmp(e); setWDays('5'); setWDed(String(e.advance_balance)); setWPeriod(''); setWNotes('');}} className="rounded-lg bg-farm-green px-2.5 py-1 text-xs font-bold text-white hover:bg-farm-green-700">Disburse Wage</button> : null}
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

      {/* Hire modal */}
      <Dialog.Root open={hireOpen} onOpenChange={setHireOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl">
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
                  <SelectField value={hPos} onChange={setHPos} options={POSITIONS.map((p) => ({value: p, label: p}))} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="h-rate">Daily Rate (₱)</label>
                  <input id="h-rate" value={hRate} onChange={(e) => setHRate(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-right text-sm font-bold" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setHireOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitHire()} disabled={busy || !hName.trim() || !(parseFloat(hRate) > 0)}>{busy ? 'Adding…' : 'Add Worker'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Advance modal */}
      <Dialog.Root open={advEmp !== null} onOpenChange={(o) => {if (!o) setAdvEmp(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl">
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
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl">
            <Dialog.Title className="flex items-center gap-2 text-xl font-bold text-farm-green"><Wallet className="h-5 w-5" aria-hidden /> Disburse Wage</Dialog.Title>
            <p className="mb-4 mt-1 text-xs text-farm-muted"><span className="font-bold text-farm-green">{wageEmp?.name}</span> · {formatPeso(wageEmp?.daily_rate ?? 0)}/day</p>
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="w-days">Days Worked</label>
                  <input id="w-days" value={wDays} onChange={(e) => setWDays(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="tabular min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-center text-sm font-bold" />
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
    </div>
  );
}
