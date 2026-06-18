import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { Employee, CashAdvance, Wage, User } from '../lib/types';
import { formatPeso } from '../lib/money';
import { todayISO } from '../lib/dates';
import { Users2, Plus, Sparkles, AlertCircle, Ban, Trash2, Wallet, HandCoins, UserPlus, CheckCircle } from 'lucide-react';

interface PayrollProps {
  currentUser: User;
  onRefresh: () => void;
}

export function Payroll({ currentUser, onRefresh }: PayrollProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [advances, setAdvances] = useState<CashAdvance[]>([]);
  const [wages, setWages] = useState<Wage[]>([]);

  // Add Employee form
  const [showAddEmp, setShowAddEmp] = useState<boolean>(false);
  const [empName, setEmpName] = useState<string>('');
  const [empPos, setEmpPos] = useState<string>('Harvester');
  const [empRate, setEmpRate] = useState<string>('550');

  // Log Cash Advance state
  const [activeEmpForCA, setActiveEmpForCA] = useState<Employee | null>(null);
  const [caAmount, setCaAmount] = useState<string>('');
  const [caNote, setCaNote] = useState<string>('');

  // Pay Wages state
  const [activeEmpForWages, setActiveEmpForWages] = useState<Employee | null>(null);
  const [payPeriod, setPayPeriod] = useState<string>('June 1 - 7');
  const [daysWorked, setDaysWorked] = useState<string>('5');
  const [customCADeduction, setCustomCADeduction] = useState<string>('0');
  const [wageNotes, setWageNotes] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const listEmp = await db.employees.toArray();
    let filteredEmp = listEmp;
    if (currentUser.role === 'Employee') {
      filteredEmp = listEmp.filter(e => 
        e.name.toLowerCase().includes(currentUser.username.toLowerCase()) || 
        currentUser.username.toLowerCase().includes(e.name.toLowerCase())
      );
      // Support fallback if they don't have an explicit entry in employees table
      if (filteredEmp.length === 0) {
        filteredEmp = [{
          id: 'E_SELF',
          name: currentUser.username.toUpperCase(),
          position: 'Farm Caretaker / Employee',
          dailyRate: 550,
          dateHired: '2025-01-01',
          active: true
        }];
      }
    }
    setEmployees(filteredEmp);

    const listAdv = await db.cashAdvances.toArray();
    const finalAdv = currentUser.role === 'Employee' 
      ? listAdv.filter(adv => filteredEmp.some(e => e.id === adv.employeeId))
      : listAdv;
    setAdvances(finalAdv);

    const listWages = await db.wages.toArray();
    const finalWages = currentUser.role === 'Employee'
      ? listWages.filter(w => filteredEmp.some(e => e.id === w.employeeId))
      : listWages;
    setWages(finalWages);
  };

  const stampChange = async () => {
    await db.meta.put({ key: 'lastChange', value: new Date().toISOString() });
    onRefresh();
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empName.trim() || !empRate) {
      alert('Please fill employee name and basic daily rate.');
      return;
    }

    const rate = parseFloat(empRate);
    if (isNaN(rate) || rate <= 0) {
      alert('Daily rate must be a valid number greater than zero.');
      return;
    }

    const newEmp: Employee = {
      id: `E${String(Date.now()).slice(-5)}`,
      name: empName.trim(),
      position: empPos,
      dailyRate: rate,
      dateHired: todayISO(),
      active: true
    };

    await db.employees.add(newEmp);
    await stampChange();
    loadData();

    setEmpName('');
    setShowAddEmp(false);
  };

  const handleLogCashAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEmpForCA) return;

    const amt = parseFloat(caAmount);
    if (isNaN(amt) || amt <= 0) {
      alert('Please input a valid advance amount.');
      return;
    }

    const newCA: CashAdvance = {
      id: `ca_${Date.now()}`,
      date: todayISO(),
      employeeId: activeEmpForCA.id,
      amount: amt,
      note: caNote.trim() || 'Urgent cash advances requested'
    };

    await db.cashAdvances.add(newCA);
    await stampChange();
    loadData();

    // Reset Form
    setActiveEmpForCA(null);
    setCaAmount('');
    setCaNote('');
  };

  const handlePayWagesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEmpForWages) return;

    const days = parseFloat(daysWorked);
    const caDed = parseFloat(customCADeduction);

    if (isNaN(days) || days <= 0) {
      alert('Days worked must be defined.');
      return;
    }

    const gross = days * activeEmpForWages.dailyRate;
    const net = gross - (isNaN(caDed) ? 0 : caDed);

    if (net < 0) {
      alert('Deductions cannot exceed gross wage value!');
      return;
    }

    const newWage: Wage = {
      id: `wage_${Date.now()}`,
      employeeId: activeEmpForWages.id,
      payPeriod: payPeriod.trim() || 'Default Cycle',
      datePaid: todayISO(),
      daysWorked: days,
      dailyRate: activeEmpForWages.dailyRate,
      gross,
      caDeducted: isNaN(caDed) ? 0 : caDed,
      net,
      notes: wageNotes.trim() || 'Paid regular cycle wage'
    };

    await db.wages.add(newWage);
    await stampChange();
    loadData();

    // Reset Form
    setActiveEmpForWages(null);
    setDaysWorked('5');
    setCustomCADeduction('0');
    setWageNotes('');
  };

  // Live calculation of Cash Advance limit per employee:
  // "never stored" on DB - dynamically calculated by summing all advances and subtracting all documented wage ca deductions
  const getLiveAdvanceBalance = (empId: string) => {
    const totalAdv = advances.filter(a => a.employeeId === empId).reduce((s, a) => s + a.amount, 0);
    const totalDeducted = wages.filter(w => w.employeeId === empId).reduce((s, w) => s + w.caDeducted, 0);
    return Math.max(0, totalAdv - totalDeducted);
  };

  const handleToggleEmployeeActive = async (id: string, active: boolean) => {
    await db.employees.update(id, { active: !active });
    await stampChange();
    loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-farm-green flex items-center gap-2">
            <Users2 className="w-7 h-7" />
            <span>Farm Staff Payroll &amp; Advances</span>
          </h2>
          <p className="text-xs text-farm-muted leading-relaxed">
            Manage hired farm workers, dispatch paysheets, and track outstanding cash advances with dynamic, un-stored live balance checking.
          </p>
        </div>

        {currentUser.role !== 'Employee' && (
          <button
            onClick={() => setShowAddEmp(true)}
            className="bg-farm-green hover:bg-farm-green-700 text-white font-bold h-11 px-6 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer text-sm shadow-md"
          >
            <UserPlus className="w-5 h-5" /> Hire New Worker
          </button>
        )}
      </div>

      {/* Monday.com layout table of workers */}
      <div className="bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-6">
        <h3 className="text-lg font-bold text-farm-green mb-4">Active Farm Hands roster</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-farm-accent-soft text-left text-farm-muted font-bold tracking-wider">
                <th className="pb-3">Worker ID</th>
                <th className="pb-3">Name</th>
                <th className="pb-3">Position / Duty</th>
                <th className="pb-3 text-right">Daily Rate (₱)</th>
                <th className="pb-3 text-right">Undeducted advances</th>
                <th className="pb-3">Hiring Date</th>
                <th className="pb-3 text-right">Payroll Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-farm-accent-soft text-sm">
              {employees.map(emp => {
                const liveCA = getLiveAdvanceBalance(emp.id);
                return (
                  <tr key={emp.id} className={`hover:bg-farm-bg/30 ${!emp.active ? 'opacity-50 line-through' : ''}`}>
                    <td className="py-3 font-mono font-bold text-farm-ink">{emp.id}</td>
                    <td className="py-3 font-bold text-farm-green">{emp.name}</td>
                    <td className="py-3 font-semibold text-farm-muted">{emp.position}</td>
                    <td className="py-3 text-right font-semibold tabular">{formatPeso(emp.dailyRate)} / day</td>
                    <td className="py-3 text-right font-black tabular">
                      {liveCA > 0 ? (
                        <span className="text-farm-danger font-mono bg-red-50 p-1 px-2.5 rounded-full border border-red-150 animate-pulse">
                          {formatPeso(liveCA)}
                        </span>
                      ) : (
                        <span className="text-emerald-800 bg-emerald-50 p-1 px-2.5 rounded-full font-bold">Cleared</span>
                      )}
                    </td>
                    <td className="py-3 text-xs num">{emp.dateHired}</td>
                    <td className="py-3 text-right">
                      {emp.active ? (
                        <div className="flex justify-end gap-2 text-xs">
                          <button
                            onClick={() => {
                              setActiveEmpForCA(emp);
                              setCaAmount('');
                              setCaNote('');
                            }}
                            disabled={currentUser.role === 'Employee'}
                            className="bg-farm-bg hover:bg-farm-accent-soft border border-farm-accent font-bold px-3 py-1.5 rounded-lg text-farm-green transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Log Advance
                          </button>
                          <button
                            onClick={() => {
                              setActiveEmpForWages(emp);
                              setPayPeriod('June 1-7');
                              setDaysWorked('5');
                              setCustomCADeduction(String(liveCA));
                              setWageNotes('');
                            }}
                            disabled={currentUser.role === 'Employee'}
                            className="bg-farm-green hover:bg-farm-green-700 text-white font-bold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            Disburse Wage
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-farm-muted">Resigned / Inactive</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {employees.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 italic text-farm-muted">
                    No hired employees registered. Clock 'Hire New Worker' above to populate the ledger.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Wage historical ledgers */}
      {wages.length > 0 && (
        <div className="bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-6">
          <h3 className="text-base font-extrabold text-farm-green mb-4">Staff Wage Disbursement Journal</h3>
          <div className="overflow-x-auto text-xs">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-farm-accent-soft text-left text-farm-muted font-bold">
                  <th className="pb-2">Disbursed Date</th>
                  <th className="pb-2">Worker</th>
                  <th className="pb-2">Pay Period</th>
                  <th className="pb-2 text-center">Days worked</th>
                  <th className="pb-2 text-right">Gross Wage</th>
                  <th className="pb-2 text-right">Deducted advances</th>
                  <th className="pb-2 text-right text-farm-green font-bold">Net payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-farm-accent-soft text-left font-semibold">
                {wages.map(w => {
                  const workerName = employees.find(e => e.id === w.employeeId)?.name || 'Unknown Staff';
                  return (
                    <tr key={w.id}>
                      <td className="py-2.5 font-mono">{w.datePaid}</td>
                      <td className="py-2.5 font-bold text-farm-ink">{workerName}</td>
                      <td className="py-2.5">{w.payPeriod}</td>
                      <td className="py-2.5 text-center font-mono">{w.daysWorked} days</td>
                      <td className="py-2.5 text-right font-mono text-farm-muted">{formatPeso(w.gross)}</td>
                      <td className="py-2.5 text-right text-red-700 font-mono">({formatPeso(w.caDeducted).replace(/[₱()]/g,'')})</td>
                      <td className="py-2.5 text-right font-black text-farm-green font-mono tabular">{formatPeso(w.net)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hire Modal */}
      {showAddEmp && (
        <div className="overlay show select-none">
          <div className="modal max-w-sm animate-scale-up">
            <div className="p-6">
              <h3 className="text-xl font-bold text-farm-green text-center">Hire Farm Hand</h3>
              <p className="text-xs text-farm-muted text-center mb-6">Create a POS roster profile for daily wages calculations.</p>

              <form onSubmit={handleAddEmployee} className="space-y-4 text-xs font-semibold text-farm-ink">
                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Worker Name</label>
                  <input
                    type="text"
                    value={empName}
                    onChange={(e) => setEmpName(e.target.value)}
                    placeholder="e.g. Juan Dela Cruz"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Duty / Position</label>
                    <select
                      value={empPos}
                      onChange={(e) => setEmpPos(e.target.value)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                    >
                      <option value="Harvester">Harvester harvester</option>
                      <option value="Farm Operator">Farm Operator</option>
                      <option value="Packer">Warehouse Packer</option>
                      <option value="Driver">Delivery Driver</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Daily Rate (₱)</label>
                    <input
                      type="number"
                      value={empRate}
                      onChange={(e) => setEmpRate(e.target.value)}
                      className="w-full px-3 py-2 border border-farm-accent-soft rounded-xl focus:outline-none focus:border-farm-green bg-farm-bg text-sm font-bold text-right"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setShowAddEmp(false)}
                    className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl flex-1 cursor-pointer"
                  >
                    Add Worker
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Log Cash Advance overlay */}
      {activeEmpForCA && (
        <div className="overlay show select-none">
          <div className="modal max-w-sm animate-scale-up">
            <div className="p-6">
              <h3 className="text-xl font-bold text-farm-green text-center">Log Cash Advance</h3>
              <p className="text-xs text-farm-muted text-center mb-6">Dispensing short advance cash variables. Balance is computed dynamically upon paysheet deductions.</p>

              <form onSubmit={handleLogCashAdvance} className="space-y-4 text-xs font-semibold text-farm-ink">
                <div className="p-3 bg-farm-bg rounded-xl border border-farm-accent-soft flex justify-between items-center text-sm font-bold">
                  <span>Borrower:</span>
                  <span className="text-farm-green underline">{activeEmpForCA.name}</span>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Advance Cash Amount (₱)</label>
                  <input
                    type="number"
                    value={caAmount}
                    onChange={(e) => setCaAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm font-bold text-right font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Advance Reason Note</label>
                  <input
                    type="text"
                    value={caNote}
                    onChange={(e) => setCaNote(e.target.value)}
                    placeholder="e.g. Purchase household medicine / fuel backup"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setActiveEmpForCA(null)}
                    className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl flex-1 cursor-pointer"
                  >
                    Release cash
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Pay Wages Modal */}
      {activeEmpForWages && (
        <div className="overlay show select-none">
          <div className="modal max-w-sm animate-scale-up">
            <div className="p-6">
              <h3 className="text-xl font-bold text-farm-green text-center">Calculate &amp; Disburse Wages</h3>
              <p className="text-xs text-farm-muted text-center mb-6">Generate official salary paysheet ledger entries.</p>

              <form onSubmit={handlePayWagesSubmit} className="space-y-4 text-xs font-semibold text-farm-ink">
                <div className="p-3 bg-farm-bg rounded-xl border border-farm-accent-soft space-y-1">
                  <div className="flex justify-between font-bold text-xs"><span>Staff Name:</span><span className="text-farm-green">{activeEmpForWages.name}</span></div>
                  <div className="flex justify-between text-xs"><span>Duty Rate:</span><span className="font-mono">{formatPeso(activeEmpForWages.dailyRate)} / day</span></div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Days Worked</label>
                    <input
                      type="number"
                      step="0.5"
                      value={daysWorked}
                      onChange={(e) => setDaysWorked(e.target.value)}
                      className="w-full px-3 py-2 border border-farm-accent-soft rounded-xl focus:outline-none focus:border-farm-green bg-farm-bg/50 text-sm font-bold text-center"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Subtract Cash Advance</label>
                    <input
                      type="number"
                      value={customCADeduction}
                      onChange={(e) => setCustomCADeduction(e.target.value)}
                      className="w-full px-3 py-2 border border-farm-accent-soft rounded-xl focus:outline-none focus:border-farm-green bg-farm-bg/55 text-sm font-bold text-center text-red-700"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Wage Cycle period</label>
                  <input
                    type="text"
                    value={payPeriod}
                    onChange={(e) => setPayPeriod(e.target.value)}
                    placeholder="e.g. June 1-7"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Disbursement Notes</label>
                  <input
                    type="text"
                    value={wageNotes}
                    onChange={(e) => setWageNotes(e.target.value)}
                    placeholder="Regular harvesting cycle pay"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm font-bold"
                  />
                </div>

                <div className="p-3 bg-emerald-50 rounded-xl border border-farm-accent flex flex-col gap-1 text-xs">
                  <div className="flex justify-between"><span>Gross Earned (days × rate):</span><span className="font-mono font-bold">{formatPeso(Number(daysWorked) * activeEmpForWages.dailyRate)}</span></div>
                  <div className="flex justify-between text-farm-danger"><span>Deduct Cash Advance:</span><span className="font-mono font-bold">-{formatPeso(Number(customCADeduction))}</span></div>
                  <div className="flex justify-between border-t border-dashed border-farm-accent pt-1 font-black text-farm-green">
                    <span>FINAL NET PAYOUT:</span>
                    <span className="font-mono text-sm underline">{formatPeso(Math.max(0, (Number(daysWorked) * activeEmpForWages.dailyRate) - Number(customCADeduction)))}</span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setActiveEmpForWages(null)}
                    className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl cursor-pointer"
                  >
                    Cancel Payout
                  </button>
                  <button
                    type="submit"
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl flex-1 cursor-pointer"
                  >
                    Confirm &amp; Pay Wages
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
