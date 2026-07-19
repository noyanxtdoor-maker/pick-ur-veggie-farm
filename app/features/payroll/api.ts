// Payroll data-access (M1B A1 seam; spec Phase_2_M5_Payroll_Module_Spec.md). Reads: roster (+DERIVED advance
// balance), advances, wage journal. Writes: employee master via RLS (mock→Dexie / online→PostgREST / offline→
// outbox); advances + wages via governed rpc (mock→Dexie / online→rpc / offline→outbox-queued). GL truth is the
// server; mock reconstructs the same figures locally.
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE} from '../../core/mock/mock';
import {round2} from '../pos/money';
import type {CashAdvance, Employee, Position, WagePayment} from '../../types/db';

const online = () => typeof navigator === 'undefined' || navigator.onLine;
const todayISO = () => new Date().toISOString().slice(0, 10);

// Derived outstanding advance (Σ advances − Σ wage deductions) — mirrors employee_advance_balance() / the mock.
async function mockAdvanceBalance(companyId: string, employeeId: string): Promise<number> {
  const advs = await offlineDB.cashAdvances.where('company_id').equals(companyId).filter((a) => a.employee_id === employeeId).toArray();
  const wages = await offlineDB.wagePayments.where('company_id').equals(companyId).filter((w) => w.employee_id === employeeId).toArray();
  return round2(advs.reduce((s, a) => s + a.amount, 0) - wages.reduce((s, w) => s + w.ca_deducted, 0));
}

export interface HireInput {
  name: string;
  positionId: string;
  dailyRate: number;
}

// P2PR1: one row per (employee, work_date). Real-mode only — a governed attendance record has no
// mock/offline equivalent (the mock doesn't model per-day attendance at all).
export interface AttendanceRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  status: 'Present' | 'Half Day' | 'Absent';
  clock_in: string | null;
  clock_out: string | null;
  notes: string | null;
}

export const payrollApi = {
  async fetchPositions(companyId: string): Promise<Position[]> {
    if (MOCK_MODE) return offlineDB.positions.where('company_id').equals(companyId).toArray();
    const {data, error} = await supabase.from('positions').select('*').eq('company_id', companyId).order('label');
    if (error) throw new Error(error.message);
    return (data ?? []) as Position[];
  },

  async addPosition(companyId: string, label: string, createdBy: string): Promise<void> {
    if (!label.trim()) throw new Error('Position name is required.');
    if (MOCK_MODE) {
      const now = new Date().toISOString();
      await offlineDB.positions.put({id: uuidv7(), company_id: companyId, label: label.trim(), active: true, created_by: createdBy, created_at: now, updated_at: now});
      return;
    }
    // created_by is server-derived (never client-supplied — see positions_normalize_and_check trigger).
    const {error} = await supabase.from('positions').insert({company_id: companyId, label: label.trim()});
    if (error) throw new Error(error.message);
  },

  async setPositionActive(position: Position, active: boolean): Promise<void> {
    if (MOCK_MODE) {
      await offlineDB.positions.put({...position, active, updated_at: new Date().toISOString()});
      return;
    }
    const {error} = await supabase.from('positions').update({active}).eq('id', position.id);
    if (error) throw new Error(error.message);
  },

  async fetchEmployees(companyId: string): Promise<Employee[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.employees.where('company_id').equals(companyId).toArray();
      const out: Employee[] = [];
      for (const r of rows) out.push({...r, advance_balance: await mockAdvanceBalance(companyId, r.id)});
      return out.sort((a, b) => Number(b.status === 'Active') - Number(a.status === 'Active') || a.name.localeCompare(b.name));
    }
    const {data, error} = await supabase.from('employees').select('*').eq('company_id', companyId).order('name');
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Omit<Employee, 'advance_balance'>>;
    const out: Employee[] = [];
    for (const r of rows) {
      const {data: bal, error: e2} = await supabase.rpc('employee_advance_balance', {p_employee_id: r.id});
      if (e2) throw new Error(e2.message);
      out.push({...r, daily_rate: Number(r.daily_rate), advance_balance: Number(bal ?? 0)});
    }
    return out.sort((a, b) => Number(b.status === 'Active') - Number(a.status === 'Active') || a.name.localeCompare(b.name));
  },

  async hire(companyId: string, input: HireInput): Promise<void> {
    if (!input.name.trim()) throw new Error('Worker name is required.');
    if (!input.positionId) throw new Error('Position is required.');
    if (!(input.dailyRate > 0)) throw new Error('Daily rate must be greater than ₱0.');
    const code = `EMP-${uuidv7().slice(-6).toUpperCase()}`;
    const payload = {company_id: companyId, employee_code: code, name: input.name.trim(), position_id: input.positionId, daily_rate: round2(input.dailyRate), date_hired: todayISO()};
    if (MOCK_MODE) {
      const now = new Date().toISOString();
      await offlineDB.employees.put({id: uuidv7(), ...payload, status: 'Active', user_id: null, created_at: now, updated_at: now});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('employees').insert(payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'payroll.hire', request: {type: 'insert', table: 'employees', payload}});
  },

  async setActive(employee: Employee, active: boolean): Promise<void> {
    const status = active ? 'Active' : 'Inactive';
    if (MOCK_MODE) {
      const {advance_balance: _drop, ...row} = employee;
      await offlineDB.employees.put({...row, status, updated_at: new Date().toISOString()});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('employees').update({status}).eq('id', employee.id);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: employee.company_id, kind: 'payroll.employee.update', request: {type: 'update', table: 'employees', match: {id: employee.id, baseUpdatedAt: employee.updated_at}, payload: {status}}});
  },

  // P2-M5C self view: one employee's advances/wages across ALL branches (your pay follows you).
  // Real mode relies on the self-visibility RLS to authorize the rows; mock filters locally.
  async fetchEmployeeAdvances(companyId: string, employeeId: string): Promise<CashAdvance[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.cashAdvances.where('company_id').equals(companyId).filter((a) => a.employee_id === employeeId).toArray();
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    const {data, error} = await supabase.from('cash_advances').select('*').eq('company_id', companyId).eq('employee_id', employeeId).order('created_at', {ascending: false}).limit(300);
    if (error) throw new Error(error.message);
    return ((data ?? []) as CashAdvance[]).map((a) => ({...a, amount: Number(a.amount)}));
  },

  async fetchEmployeeWages(companyId: string, employeeId: string): Promise<WagePayment[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.wagePayments.where('company_id').equals(companyId).filter((w) => w.employee_id === employeeId).toArray();
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    const {data, error} = await supabase.from('wage_payments').select('*').eq('company_id', companyId).eq('employee_id', employeeId).order('created_at', {ascending: false}).limit(300);
    if (error) throw new Error(error.message);
    return ((data ?? []) as WagePayment[]).map((w) => ({...w, days_worked: Number(w.days_worked), daily_rate: Number(w.daily_rate), gross: Number(w.gross), ca_deducted: Number(w.ca_deducted), net: Number(w.net), bonus_amount: Number(w.bonus_amount)}));
  },

  // P2-M5C: link/unlink a staff record to an app user (payroll self-visibility). Governed rpc; audited server-side.
  async linkEmployeeUser(employee: Employee, userId: string | null): Promise<void> {
    if (MOCK_MODE) {
      const {advance_balance: _drop, ...row} = employee;
      await offlineDB.employees.put({...row, user_id: userId, updated_at: new Date().toISOString()});
      return;
    }
    const payload = {p_employee_id: employee.id, p_user_id: userId};
    if (online()) {
      const {error} = await supabase.rpc('payroll_link_employee_user', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: employee.company_id, kind: 'payroll.link_user', request: {type: 'rpc', rpc: 'payroll_link_employee_user', payload}});
  },

  async fetchAdvances(companyId: string, branchId: string): Promise<CashAdvance[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.cashAdvances.where('company_id').equals(companyId).filter((a) => a.branch_id === branchId).toArray();
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    const {data, error} = await supabase.from('cash_advances').select('*').eq('company_id', companyId).eq('branch_id', branchId).order('created_at', {ascending: false}).limit(300);
    if (error) throw new Error(error.message);
    return ((data ?? []) as CashAdvance[]).map((a) => ({...a, amount: Number(a.amount)}));
  },

  async recordAdvance(companyId: string, branchId: string, employee: Employee, amount: number, note: string): Promise<void> {
    if (!(amount > 0)) throw new Error('Advance amount must be greater than ₱0.');
    if (employee.status !== 'Active') throw new Error('Employee is not active.');
    const idem = uuidv7();
    if (MOCK_MODE) {
      await offlineDB.cashAdvances.put({id: idem, company_id: companyId, branch_id: branchId, employee_id: employee.id, amount: round2(amount), note: note.trim() || null, created_at: new Date().toISOString()});
      return;
    }
    const payload = {p_branch_id: branchId, p_employee_id: employee.id, p_amount: round2(amount), p_note: note.trim() || null, p_idempotency_key: idem};
    if (online()) {
      const {error} = await supabase.rpc('payroll_record_cash_advance', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'payroll.advance', request: {type: 'rpc', rpc: 'payroll_record_cash_advance', payload}});
  },

  async fetchWages(companyId: string, branchId: string): Promise<WagePayment[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.wagePayments.where('company_id').equals(companyId).filter((w) => w.branch_id === branchId).toArray();
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    const {data, error} = await supabase.from('wage_payments').select('*').eq('company_id', companyId).eq('branch_id', branchId).order('created_at', {ascending: false}).limit(300);
    if (error) throw new Error(error.message);
    return ((data ?? []) as WagePayment[]).map((w) => ({...w, days_worked: Number(w.days_worked), daily_rate: Number(w.daily_rate), gross: Number(w.gross), ca_deducted: Number(w.ca_deducted), net: Number(w.net), bonus_amount: Number(w.bonus_amount)}));
  },

  // Disburse a wage: gross = days × rate + optional bonus (server recomputes; mock mirrors). Returns nothing (caller reloads).
  async disburseWage(companyId: string, branchId: string, employee: Employee, payPeriod: string, daysWorked: number, caDeduction: number, notes: string, bonusAmount = 0): Promise<void> {
    if (!(daysWorked > 0)) throw new Error('Days worked must be greater than 0.');
    if (caDeduction < 0) throw new Error('Deduction cannot be negative.');
    if (bonusAmount < 0) throw new Error('Bonus cannot be negative.');
    const bonus = round2(bonusAmount);
    const gross = round2(round2(daysWorked * employee.daily_rate) + bonus);
    if (caDeduction > gross) throw new Error('Deduction exceeds the gross wage.');
    const idem = uuidv7();
    if (MOCK_MODE) {
      const outstanding = await mockAdvanceBalance(companyId, employee.id);
      if (caDeduction > outstanding) throw new Error(`Deduction exceeds the outstanding advance (₱${outstanding}).`);
      await offlineDB.wagePayments.put({
        id: idem, company_id: companyId, branch_id: branchId, employee_id: employee.id,
        pay_period: payPeriod.trim() || 'Cycle', days_worked: daysWorked, daily_rate: employee.daily_rate,
        gross, ca_deducted: round2(caDeduction), net: round2(gross - caDeduction), bonus_amount: bonus, notes: notes.trim() || null,
        created_at: new Date().toISOString(),
      });
      return;
    }
    const payload = {p_branch_id: branchId, p_employee_id: employee.id, p_pay_period: payPeriod.trim() || 'Cycle', p_days_worked: daysWorked, p_ca_deduction: round2(caDeduction), p_notes: notes.trim() || null, p_idempotency_key: idem, p_bonus_amount: bonus};
    if (online()) {
      const {error} = await supabase.rpc('payroll_disburse_wage', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'payroll.wage', request: {type: 'rpc', rpc: 'payroll_disburse_wage', payload}});
  },

  // P2PR1: record or correct one employee's attendance for one work_date (upsert). payroll.manage-gated.
  async recordAttendance(branchId: string, employeeId: string, workDate: string, status: AttendanceRecord['status'], notes: string | null = null): Promise<void> {
    if (MOCK_MODE) throw new Error('Attendance tracking is not available in demo mode.');
    const {error} = await supabase.rpc('payroll_record_attendance', {
      p_branch_id: branchId, p_employee_id: employeeId, p_work_date: workDate, p_status: status, p_notes: notes,
    });
    if (error) throw new Error(error.message);
  },

  // Read attendance for a branch (optionally one employee / date range). payroll.read+branch-member,
  // or an employee viewing their own linked record.
  async listAttendance(companyId: string, branchId: string, employeeId: string | null = null, from: string | null = null, to: string | null = null): Promise<AttendanceRecord[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.rpc('list_attendance', {p_company: companyId, p_branch_id: branchId, p_employee_id: employeeId, p_from: from, p_to: to});
    if (error) throw new Error(error.message);
    return (data ?? []) as AttendanceRecord[];
  },
};
