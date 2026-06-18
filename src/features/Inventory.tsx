import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { Expense, Equipment, User } from '../lib/types';
import { formatPeso } from '../lib/money';
import { todayISO } from '../lib/dates';
import { Package, Hammer, Plus, ShoppingBag, ShieldAlert, Sparkles, Check, X, AlertTriangle, FileText, ClipboardList, RefreshCw } from 'lucide-react';

interface InventoryProps {
  currentUser: User;
  onRefresh: () => void;
}

export function Inventory({ currentUser, onRefresh }: InventoryProps) {
  const [activeSubTab, setActiveSubTab] = useState<'consumables' | 'equipment'>('consumables');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [equipments, setEquipment] = useState<Equipment[]>([]);

  // Consumable Alert Limit State
  const [lowStockLimit, setLowStockLimit] = useState<number>(10);

  // New Material Purchase Form State
  const [showAddExpense, setShowAddExpense] = useState<boolean>(false);
  const [expenseDate, setExpenseDate] = useState<string>(todayISO());
  const [expenseCategory, setExpenseCategory] = useState<string>('Seeds/Seedlings');
  const [expenseDesc, setExpenseDesc] = useState<string>('');
  const [expenseAmount, setExpenseAmount] = useState<string>('');
  const [expensePcs, setExpensePcs] = useState<string>('1');
  const [sourceType, setSourceType] = useState<'online' | 'physical'>('online');
  const [sourceName, setSourceName] = useState<string>('Lazada'); // Lazada, Shopee, TikTok OR Custom Physical supplier
  const [sourceWho, setSourceWho] = useState<string>(''); // supplier contact name / store seller
  const [itemType, setItemType] = useState<'Consumables' | 'Equipment'>('Consumables');

  // Equipment Checklist Evaluation State
  const [activeEquipForChecklist, setActiveEquipForChecklist] = useState<Equipment | null>(null);
  const [checkWorking, setCheckWorking] = useState<boolean>(true);
  const [checkNeedsMaint, setCheckNeedsMaint] = useState<boolean>(false);
  const [checkNotes, setCheckNotes] = useState<string>('');
  const [inspectorName, setInspectorName] = useState<string>(currentUser.username);

  // Manual stock audit adjustment states
  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);
  const [auditCategory, setAuditCategory] = useState<string>('Seeds/Seedlings');
  const [auditQty, setAuditQty] = useState<string>('');
  const [auditReason, setAuditReason] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const listExpenses = await db.expenses.toArray();
    setExpenses(listExpenses);

    const listEquipment = await db.equipment.toArray();
    setEquipment(listEquipment);
  };

  const stampChange = async () => {
    await db.meta.put({ key: 'lastChange', value: new Date().toISOString() });
    onRefresh();
  };

  // Extract past item descriptions & categories for autocomplete suggestions
  const pastItemSuggestions: Expense[] = Array.from(
    new Map<string, Expense>(
      expenses
        .filter(e => e.equipmentType === 'Consumables' || e.category !== 'Equipment Purchase')
        .map(e => [e.description?.toLowerCase().trim() || '', e])
    ).values()
  ).filter(e => e.description) as any;

  // Add Item to active inventory
  const handleAddNewPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseDesc.trim() || !expenseAmount || !expensePcs) {
      alert('Please fill out descriptions, counts, and amounts.');
      return;
    }

    const amt = parseFloat(expenseAmount);
    const count = parseInt(expensePcs);
    if (isNaN(amt) || amt <= 0 || isNaN(count) || count <= 0) {
      alert('Amounts and counts must be larger than zero.');
      return;
    }

    const uniqueId = `exp_${Date.now()}`;

    // Add to Expenses table
    const newExpense: Expense = {
      id: uniqueId,
      date: expenseDate,
      category: expenseCategory as any,
      description: expenseDesc.trim(),
      amount: amt,
      pcs: count,
      sourceType,
      sourceName: sourceType === 'online' ? sourceName : (sourceName || 'Local Supplier'),
      sourceWho: sourceWho.trim() || 'General Seller',
      equipmentType: itemType
    };

    await db.expenses.add(newExpense);

    // If it's Equipment, also automatically save record in the explicit Equipment Checklist Tracker table
    if (itemType === 'Equipment') {
      const newEquip: Equipment = {
        id: `equip_${Date.now()}`,
        name: expenseDesc.trim(),
        purchaseDate: expenseDate,
        cost: amt,
        working: true,
        notes: `Purchased from ${sourceType === 'online' ? sourceName : (sourceWho || 'Local Supplier')}`,
        lastChecklistDate: expenseDate,
        monthlyChecklist: []
      };
      await db.equipment.add(newEquip);
    }

    await stampChange();
    loadData();

    // Reset Form
    setExpenseDesc('');
    setExpenseAmount('');
    setExpensePcs('1');
    setSourceWho('');
    setShowAddExpense(false);
  };

  // Submit Manual Stock Audit Adjustment
  const handleSaveAuditAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(auditQty);
    if (isNaN(qty) || qty === 0) {
      alert('Adjustment units must be a valid non-zero integer (e.g. -5 to reduce, 10 to add).');
      return;
    }
    if (!auditReason.trim()) {
      alert('Please fill in a brief verification remark for manual auditing.');
      return;
    }

    const newAdj: Expense = {
      id: `adj_${Date.now()}`,
      date: todayISO(),
      category: auditCategory as any,
      description: `Audit Adjustment: ${auditReason.trim()}`,
      amount: 0, // system audit adjustments carry zero catalog acquisition costs
      pcs: qty,
      sourceType: 'physical',
      sourceName: 'Local Audit Desk',
      sourceWho: currentUser.username,
      equipmentType: 'Consumables'
    };

    await db.expenses.add(newAdj);
    await stampChange();
    loadData();

    // Reset Form
    setShowAuditModal(false);
    setAuditQty('');
    setAuditReason('');
  };

  // Submit Checklist Evaluation for a specific equipment
  const handleSaveEquipmentChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEquipForChecklist) return;

    const checklistItem = {
      working: checkWorking,
      needsMaintenance: checkNeedsMaint,
      maintenancePerformedBy: inspectorName.trim() || currentUser.username,
      checkedDate: todayISO(),
      notes: checkNotes.trim() || 'Routine check concluded successfully.'
    };

    const updatedChecklist = [...(activeEquipForChecklist.monthlyChecklist || []), checklistItem];

    await db.equipment.update(activeEquipForChecklist.id, {
      working: checkWorking,
      lastChecklistDate: todayISO(),
      monthlyChecklist: updatedChecklist
    });

    await stampChange();
    loadData();
    setActiveEquipForChecklist(null);
    setCheckNotes('');
  };

  // Compute live counts of Consumables directly from expenses/purchases
  const getConsumableStocks = () => {
    const counts: Record<string, { totalPcs: number; cost: number; lastBuy: string; sourceType: string; sourceName: string }> = {};

    expenses
      .filter(e => e.equipmentType === 'Consumables' || e.category !== 'Equipment Purchase') // filter equipment purchase expenses
      .forEach(e => {
        const key = e.category || 'Seeds/Seedlings';
        if (key === 'Equipment Purchase') return; // skip
        if (!counts[key]) {
          counts[key] = { totalPcs: 0, cost: 0, lastBuy: e.date, sourceType: e.sourceType, sourceName: e.sourceName };
        }
        counts[key].totalPcs += Number(e.pcs || 1);
        counts[key].cost += Number(e.amount);
        if (e.date > counts[key].lastBuy) {
          counts[key].lastBuy = e.date;
          counts[key].sourceType = e.sourceType;
          counts[key].sourceName = e.sourceName;
        }
      });

    return counts;
  };

  const stocks = getConsumableStocks();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-farm-green flex items-center gap-2">
            <Package className="w-7 h-7" />
            <span>Farm Inventory Control</span>
          </h2>
          <p className="text-xs text-farm-muted leading-relaxed">
            Automatic tracking of consumables and heavy machinery inputs. Syncs in real-time as purchase receipts are booked.
          </p>
        </div>

        {currentUser.role !== 'Employee' && (
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={() => {
                setExpenseDate(todayISO());
                setItemType('Consumables');
                setExpenseCategory('Seeds/Seedlings');
                setShowAddExpense(true);
              }}
              className="bg-farm-green hover:bg-farm-green-700 text-white font-bold h-11 px-5 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer text-xs uppercase tracking-wider shadow-sm"
            >
              <Plus className="w-4 h-4" /> Add Material/Expense Purchase
            </button>
            <button
              onClick={() => {
                setAuditCategory('Seeds/Seedlings');
                setAuditQty('');
                setAuditReason('');
                setShowAuditModal(true);
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11 px-5 rounded-xl flex items-center justify-center gap-1.5 transition cursor-pointer text-xs uppercase tracking-wider shadow-sm"
            >
              <RefreshCw className="w-4 h-4 animate-spin-slow" /> Manual Stock Adjustment
            </button>
          </div>
        )}
      </div>

      {/* Main Tab toggler */}
      <div className="flex gap-2 border-b border-farm-accent pb-[2px]">
        <button
          onClick={() => setActiveSubTab('consumables')}
          className={`px-6 py-2.5 font-bold text-sm tracking-wide rounded-t-xl transition cursor-pointer flex items-center gap-2 ${activeSubTab === 'consumables' ? 'bg-white border-l border-t border-r border-farm-accent text-farm-green' : 'text-farm-muted hover:text-farm-green hover:bg-white/40'}`}
        >
          <ShoppingBag className="w-4 h-4 text-farm-green" />
          <span>Consumables &amp; Seed Stocks</span>
        </button>
        <button
          onClick={() => setActiveSubTab('equipment')}
          className={`px-6 py-2.5 font-bold text-sm tracking-wide rounded-t-xl transition cursor-pointer flex items-center gap-2 ${activeSubTab === 'equipment' ? 'bg-white border-l border-t border-r border-farm-accent text-farm-green' : 'text-farm-muted hover:text-farm-green hover:bg-white/40'}`}
        >
          <Hammer className="w-4 h-4 text-farm-green" />
          <span>Heavy Equipment &amp; Spades</span>
        </button>
      </div>

      {/* CONSUMABLES VIEW */}
      {activeSubTab === 'consumables' && (
        <div className="space-y-6 animate-fade-in">
          {/* Warn Banner if low on stock */}
          {Object.entries(stocks).some(([_, val]) => val.totalPcs <= lowStockLimit) && (
            <div className="p-4 bg-red-50 rounded-2xl border border-red-200 text-farm-danger text-xs font-bold leading-relaxed flex items-start gap-2.5 animate-pulse">
              <ShieldAlert className="w-5 h-5 flex-shrink-0 text-farm-danger" />
              <div>
                <h4 className="font-extrabold uppercase mb-1">Restock Warnings Active</h4>
                <p className="font-semibold text-red-900 text-xs">
                  One or more consumable materials are below your alert limit ({lowStockLimit} units). Procure seeds, nutrients, or packaging quickly.
                </p>
              </div>
            </div>
          )}

          {/* Consumables Inventory cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(stocks).map(([category, details]) => {
              const isLow = details.totalPcs <= lowStockLimit;
              return (
                <div key={category} className={`bg-white rounded-2xl shadow-md p-6 border transition ${isLow ? 'border-red-300 ring-4 ring-red-55 animate-pulse' : 'border-farm-accent-soft hover:shadow-lg'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <span className="text-xs font-bold text-farm-muted uppercase tracking-wide">{category}</span>
                    {isLow ? (
                      <span className="p-1 px-2.5 text-[9px] bg-red-100 text-farm-danger font-black rounded-full uppercase flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Critical Stock
                      </span>
                    ) : (
                      <span className="p-1 px-2.5 text-[9px] bg-emerald-100 text-emerald-800 font-bold rounded-full uppercase">
                        Sufficient
                      </span>
                    )}
                  </div>

                  <div className="mb-4">
                    <div className="text-4xl font-black text-farm-green tabular">{details.totalPcs} <span className="text-sm font-bold text-farm-muted uppercase">pcs/units</span></div>
                    <div className="text-xs text-farm-muted mt-1 leading-normal">Cumulative expense value: <span className="font-bold text-farm-green">{formatPeso(details.cost)}</span></div>
                  </div>

                  <div className="border-t border-farm-accent-soft pt-3 mt-4 text-[10px] tracking-wide text-farm-muted space-y-1">
                    <div>Last Restocked Date: <span className="font-semibold font-mono text-farm-ink">{details.lastBuy}</span></div>
                    <div>Source: <span className="font-semibold text-farm-ink uppercase bg-farm-bg px-1.5 py-0.5 rounded">{details.sourceType === 'online' ? `Online (${details.sourceName})` : `Supplier (${details.sourceName})`}</span></div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-farm-accent-soft flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setExpenseDate(todayISO());
                        setItemType('Consumables');
                        setExpenseCategory(category);
                        
                        // Grab the latest logged expense for this category to auto-fill description & vendors
                        const matchingExps = expenses.filter(e => e.category === category);
                        if (matchingExps.length > 0) {
                          const latest = matchingExps[matchingExps.length - 1];
                          setExpenseDesc(latest.description || '');
                          if (latest.sourceType) setSourceType(latest.sourceType);
                          if (latest.sourceName) setSourceName(latest.sourceName);
                          if (latest.sourceWho) setSourceWho(latest.sourceWho);
                        } else {
                          setExpenseDesc('');
                        }
                        
                        setExpenseAmount('');
                        setExpensePcs('1');
                        setShowAddExpense(true);
                      }}
                      className="text-[10px] uppercase font-bold text-farm-green bg-farm-accent-soft hover:bg-farm-green hover:text-white px-3 py-1.5 rounded-lg transition shadow-xs flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Quick Restock
                    </button>
                  </div>
                </div>
              );
            })}
            {Object.keys(stocks).length === 0 && (
              <div className="col-span-full bg-white border border-farm-accent-soft shadow-md rounded-2xl text-center py-20 text-farm-muted flex flex-col items-center justify-center p-6">
                <FileText className="w-12 h-12 text-farm-accent mb-3" />
                <p className="text-sm font-semibold text-farm-green">No consumable material logs available.</p>
                <p className="text-xs text-farm-muted mt-1">Input seeds or nutrients expenses to start tracking real-time stock levels.</p>
              </div>
            )}
          </div>

          {/* Config Limit controller */}
          <div className="max-w-xs bg-white p-4 rounded-xl border border-farm-accent-soft">
            <label className="block text-xs font-bold text-farm-muted uppercase mb-1.5">Configure Low-Stock Limit:</label>
            <input
              type="number"
              value={lowStockLimit}
              onChange={(e) => setLowStockLimit(parseInt(e.target.value) || 0)}
              className="w-full text-center font-black p-2 border border-farm-accent rounded-lg bg-farm-bg"
            />
          </div>
        </div>
      )}

      {/* EQUIPMENT CHECKLIST VIEW */}
      {activeSubTab === 'equipment' && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-farm-green flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-farm-green" />
                <span>Heavy Equipment Catalog &amp; Checklist</span>
              </h3>
              <span className="text-[10px] text-farm-muted">Tracks active condition checks</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-farm-accent-soft text-left text-xs text-farm-muted font-bold tracking-wider">
                    <th className="pb-3 text-center">Status</th>
                    <th className="pb-3">Equipment Name</th>
                    <th className="pb-3">Purchase Date</th>
                    <th className="pb-3 text-right">Cost</th>
                    <th className="pb-3">Last Checked</th>
                    <th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-farm-accent-soft text-sm">
                  {equipments.map(e => (
                    <tr key={e.id} className="hover:bg-farm-bg/30">
                      <td className="py-3 text-center">
                        {e.working ? (
                          <span className="p-1 px-2.5 text-[10px] bg-farm-accent-soft text-farm-green font-bold rounded-full">OPERATIONAL</span>
                        ) : (
                          <span className="p-1 px-2.5 text-[10px] bg-red-100 text-farm-danger font-bold rounded-full">OUT OF ORDER</span>
                        )}
                      </td>
                      <td className="py-3 font-bold text-farm-green">{e.name}</td>
                      <td className="py-3 text-xs num">{e.purchaseDate}</td>
                      <td className="py-3 text-right font-black tabular">{formatPeso(e.cost)}</td>
                      <td className="py-3 text-xs text-farm-muted font-mono">{e.lastChecklistDate || 'Never'}</td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => {
                            setActiveEquipForChecklist(e);
                            setCheckWorking(e.working);
                            setCheckNeedsMaint(false);
                            setCheckNotes('');
                            setInspectorName(currentUser.username);
                          }}
                          disabled={currentUser.role === 'Employee'}
                          className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green text-xs border border-farm-accent px-3 py-1.5 rounded-lg font-black transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Fill Checklist
                        </button>
                      </td>
                    </tr>
                  ))}
                  {equipments.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-farm-muted italic">
                        No equipment registered. Purchase pumps or spades and mark them as Equipment above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Performance History lists */}
          {equipments.some(e => e.monthlyChecklist && e.monthlyChecklist.length > 0) && (
            <div className="bg-white rounded-2xl shadow-xl border border-farm-accent-soft p-6">
              <h3 className="text-base font-extrabold text-farm-green mb-4">Inspection History Log Book</h3>
              <div className="space-y-4">
                {equipments.map(e => {
                  if (!e.monthlyChecklist || e.monthlyChecklist.length === 0) return null;
                  return (
                    <div key={e.id} className="border-l-4 border-farm-green pl-4 space-y-2 py-1">
                      <div className="font-bold text-farm-green text-sm flex items-center gap-2">
                        <span>{e.name}</span>
                        <span className="text-[10px] bg-farm-bg px-2 py-0.5 rounded text-farm-muted font-normal font-sans">history count: {e.monthlyChecklist.length}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-farm-muted">
                        {e.monthlyChecklist.map((ch, idx) => (
                          <div key={idx} className="p-3 bg-farm-bg/50 border border-farm-accent-soft rounded-lg space-y-1">
                            <div className="flex justify-between items-center text-[10px] font-bold">
                              <span>Date: {ch.checkedDate}</span>
                              <span className="text-farm-green font-mono uppercase bg-farm-accent-soft px-1 text-[9px]">checked by: {ch.maintenancePerformedBy}</span>
                            </div>
                            <div className="flex gap-2 my-0.5">
                              {ch.working ? (
                                <span className="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-1.5 rounded">Operational</span>
                              ) : (
                                <span className="text-[9px] bg-red-100 text-farm-danger font-bold px-1.5 rounded">Stopped Working</span>
                              )}
                              {ch.needsMaintenance && (
                                <span className="text-[9px] bg-amber-100 text-farm-warn font-bold px-1.5 rounded">Required fixing</span>
                              )}
                            </div>
                            {ch.notes && <div className="italic text-farm-ink font-semibold">" {ch.notes} "</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* New Purchase Modal Dialog */}
      {showAddExpense && (
        <div className="overlay show select-none">
          <div className="modal max-w-lg">
            <div className="p-6">
              <h3 className="text-xl font-bold text-farm-green text-center">Add Materials Purchase</h3>
              <p className="text-xs text-farm-muted text-center mb-6">Logs as a cost transaction in accounting and material value in inventory levels.</p>

              <form onSubmit={handleAddNewPurchase} className="space-y-4 text-xs font-semibold text-farm-ink">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Purchase Date</label>
                    <input
                      type="date"
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Material Classification</label>
                    <select
                      value={itemType}
                      onChange={(e) => {
                        const type = e.target.value as 'Consumables' | 'Equipment';
                        setItemType(type);
                        setExpenseCategory(type === 'Consumables' ? 'Seeds/Seedlings' : 'Equipment Purchase');
                      }}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                    >
                      <option value="Consumables">Consumables (Seeds, nutrients, packaging)</option>
                      <option value="Equipment">Equipment (Pumps, machinery, tools)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Consumable Category</label>
                    {itemType === 'Consumables' ? (
                      <select
                        value={expenseCategory}
                        onChange={(e) => setExpenseCategory(e.target.value)}
                        className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                      >
                        <option value="Seeds/Seedlings">Seeds / Seedlings</option>
                        <option value="Substrate & Nutrients">Substrate &amp; Nutrients</option>
                        <option value="Packaging">Packaging materials</option>
                        <option value="Water/Electricity">Electricity utilities</option>
                        <option value="Transport">Delivery &amp; Courier diesel</option>
                        <option value="Miscellaneous">Other farm spending</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value="Equipment Purchase"
                        disabled
                        className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg opacity-70"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Quantity Purchased (pcs/units)</label>
                    <input
                      type="number"
                      min="1"
                      value={expensePcs}
                      onChange={(e) => setExpensePcs(e.target.value)}
                      className="w-full px-3 py-2 border border-farm-accent-soft rounded-xl focus:outline-none focus:border-farm-green bg-farm-bg/50 text-sm font-semibold"
                    />
                  </div>
                </div>

                 <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Item Description / Item name</label>
                  <input
                    type="text"
                    value={expenseDesc}
                    onChange={(e) => setExpenseDesc(e.target.value)}
                    placeholder="e.g. F1 organic eggplant seeds pack or Submersible Pump"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                  />
                  {pastItemSuggestions.length > 0 && (
                    <div className="mt-2 space-y-1 select-none">
                      <span className="text-[9px] uppercase font-bold text-farm-muted block">Frequent Descriptions (Click to dynamic auto-fill):</span>
                      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-stone-50 rounded-xl border border-stone-200">
                        {pastItemSuggestions.slice(0, 8).map((sugg, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              setExpenseDesc(sugg.description || '');
                              setExpenseCategory(sugg.category || 'Seeds/Seedlings');
                              if (sugg.sourceType) setSourceType(sugg.sourceType);
                              if (sugg.sourceName) setSourceName(sugg.sourceName);
                              if (sugg.sourceWho) setSourceWho(sugg.sourceWho);
                            }}
                            className="bg-white hover:bg-farm-accent-soft border border-stone-200 hover:border-farm-green text-[10px] px-2.5 py-1.5 rounded-lg font-bold text-stone-700 cursor-pointer shadow-xs transition"
                          >
                            🌱 {sugg.description}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Purchase Location</label>
                    <select
                      value={sourceType}
                      onChange={(e) => {
                        const t = e.target.value as 'online' | 'physical';
                        setSourceType(t);
                        setSourceName(t === 'online' ? 'Lazada' : '');
                      }}
                      className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg/50 text-sm font-semibold"
                    >
                      <option value="online">Online eCommerce Platforms</option>
                      <option value="physical">Physical Dealer / Supplier Store</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Source / Platform Name</label>
                    {sourceType === 'online' ? (
                      <select
                        value={sourceName}
                        onChange={(e) => setSourceName(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg/50 text-sm font-semibold"
                      >
                        <option value="Lazada">Lazada Philippines</option>
                        <option value="Shopee">Shopee Philippines</option>
                        <option value="TikTok">TikTok Shop Philippines</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={sourceName}
                        onChange={(e) => setSourceName(e.target.value)}
                        placeholder="e.g. Agri-Supply Co. Malolos"
                        className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Supplier / Broker Contact Who</label>
                    <input
                      type="text"
                      value={sourceWho}
                      onChange={(e) => setSourceWho(e.target.value)}
                      placeholder="e.g. Aling Sandra / Makati Store"
                      className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Purchase Total Price (₱)</label>
                    <input
                      type="text"
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm font-bold text-right"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setShowAddExpense(false)}
                    className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl transition cursor-pointer flex-1"
                  >
                    Save &amp; Log Purchase
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Equipment Checklist Evaluation Modal */}
      {activeEquipForChecklist && (
        <div className="overlay show select-none">
          <div className="modal max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-bold text-farm-green text-center">Equipment Condition Checklist</h3>
              <p className="text-xs text-farm-muted text-center mb-6">Perform a routine diagnostic evaluation for: <span className="underline font-bold">{activeEquipForChecklist.name}</span></p>

              <form onSubmit={handleSaveEquipmentChecklist} className="space-y-4 text-xs font-semibold text-farm-ink">
                <div className="bg-farm-bg p-3 rounded-xl border border-farm-accent-soft flex items-center justify-between">
                  <span>Registered Cost:</span>
                  <span className="font-extrabold text-farm-green">{formatPeso(activeEquipForChecklist.cost)}</span>
                </div>

                <div className="grid grid-cols-2 gap-4 text-center">
                  <button
                    type="button"
                    onClick={() => setCheckWorking(true)}
                    className={`py-3 px-4 rounded-xl border font-bold cursor-pointer transition select-none ${checkWorking ? 'bg-farm-green text-white border-transparent' : 'bg-farm-bg text-farm-muted border-transparent'}`}
                  >
                    Working / Operational
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheckWorking(false)}
                    className={`py-3 px-4 rounded-xl border font-bold cursor-pointer transition select-none ${!checkWorking ? 'bg-farm-danger text-white border-transparent' : 'bg-farm-bg text-farm-muted border-transparent'}`}
                  >
                    Out of Order / Broken
                  </button>
                </div>

                <div className="flex items-center gap-2 bg-farm-bg p-3 rounded-xl">
                  <input
                    type="checkbox"
                    id="needsMaintBox"
                    checked={checkNeedsMaint}
                    onChange={(e) => setCheckNeedsMaint(e.target.checked)}
                    className="w-4 h-4 rounded border-farm-accent text-farm-green accent-farm-green cursor-pointer"
                  />
                  <label htmlFor="needsMaintBox" className="text-xs font-bold text-farm-green cursor-pointer">
                    Flag as 'Requires Maintenance / Servicing'
                  </label>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Diagnosing Inspector / Technician</label>
                  <input
                    type="text"
                    value={inspectorName}
                    onChange={(e) => setInspectorName(e.target.value)}
                    placeholder="Enter inspector name..."
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Inspecting Status Remarks</label>
                  <textarea
                    value={checkNotes}
                    onChange={(e) => setCheckNotes(e.target.value)}
                    placeholder="e.g. Cleared cylinder filters, running well with no leaks."
                    className="w-full text-sm p-3 rounded-xl border border-farm-accent-soft h-24 focus:outline-none bg-farm-bg"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setActiveEquipForChecklist(null)}
                    className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl cursor-pointer"
                  >
                    Cancel Check-In
                  </button>
                  <button
                    type="submit"
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl flex-1 cursor-pointer"
                  >
                    LOG PERFORMANCE CHECK
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Manual Stock Audit Adjustment Modal */}
      {showAuditModal && (
        <div className="overlay show select-none">
          <div className="modal max-w-md">
            <div className="p-6">
              <h3 className="text-lg font-bold text-indigo-950 text-center flex items-center justify-center gap-1.5">
                <RefreshCw className="w-5 h-5 text-indigo-600 animate-spin-slow" />
                <span>Manual Stock Audit Adjustment</span>
              </h3>
              <p className="text-xs text-farm-muted text-center mb-6">
                Directly adjust stock counts without altering acquisition logs. Adjustments register as audit records inside live ledger columns.
              </p>

              <form onSubmit={handleSaveAuditAdjustment} className="space-y-4 text-xs font-semibold text-farm-ink">
                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Consumable Material Category</label>
                  <select
                    value={auditCategory}
                    onChange={(e) => setAuditCategory(e.target.value)}
                    className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                  >
                    <option value="Seeds/Seedlings">Seeds / Seedlings</option>
                    <option value="Substrate & Nutrients">Substrate &amp; Nutrients</option>
                    <option value="Packaging">Packaging materials</option>
                    <option value="Water/Electricity">Electricity utilities</option>
                    <option value="Transport">Delivery &amp; Courier diesel</option>
                    <option value="Miscellaneous">Other farm spending</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">
                    Adjustment Offset (Quantity)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. -5 to subtract, 10 to add to stock"
                    value={auditQty}
                    onChange={(e) => setAuditQty(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-indigo-600 bg-farm-bg text-sm"
                  />
                  <p className="text-[10px] font-normal text-stone-500 mt-1">
                    Use negative numbers to mark spillage, damage, or theft. Use positive numbers to record excess counts found.
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">
                    Auditing Verification Remarks
                  </label>
                  <textarea
                    value={auditReason}
                    onChange={(e) => setAuditReason(e.target.value)}
                    placeholder="e.g. Cleared 5 packs spoiled substrate bags due to moisture exposure."
                    className="w-full text-sm p-3 rounded-xl border border-farm-accent-soft h-24 focus:outline-none bg-farm-bg"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setShowAuditModal(false)}
                    className="bg-farm-bg hover:bg-farm-accent-soft text-stone-600 font-semibold py-3 px-6 rounded-xl cursor-pointer"
                  >
                    Cancel Audit
                  </button>
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl flex-1 cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <span>COMMIT AUDIT CORRECTION</span>
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
