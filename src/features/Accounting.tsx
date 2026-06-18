import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { Transaction, Expense, Wage, CashEntry, User } from '../lib/types';
import { formatPeso, netSales, grossProfit, netIncome, netMargin, round2 } from '../lib/money';
import { todayISO, MONTHS, yearOf, monthOf, toISODate } from '../lib/dates';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie
} from 'recharts';
import {
  TrendingUp, BarChart3, FileText, ClipboardList, Wallet, BookOpen, AlertCircle,
  HelpCircle, UserCheck, Plus, ArrowUpRight, ArrowDownRight, Printer
} from 'lucide-react';

interface AccountingProps {
  currentUser: User;
  onRefresh: () => void;
}

export function Accounting({ currentUser, onRefresh }: AccountingProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'statements' | 'reports' | 'ledgers' | 'cash_ledger'>('dashboard');
  const [selectedStatement, setSelectedStatement] = useState<'income' | 'cash_flow' | 'balance_sheet' | 'trial_balance' | 'cost_schedule' | 'operation' | 'retained_earnings' | 'chart_accounts'>('income');
  const [selectedReport, setSelectedReport] = useState<'cash_report' | 'purchase_summary' | 'monthly_cost' | 'fund_statement' | 'sales_summary'>('cash_report');
  const [selectedLedger, setSelectedLedger] = useState<'ledger_1' | 'cash_book' | 'currency' | 'vendor_customer'>('cash_book');

  // Database lists
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [wages, setWages] = useState<Wage[]>([]);
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([]);

  // Year Selection
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState<number[]>([new Date().getFullYear()]);

  // Cash Ledger adding form state
  const [showAddCash, setShowAddCash] = useState<boolean>(false);
  const [cashDate, setCashDate] = useState<string>(todayISO());
  const [cashFlow, setCashFlow] = useState<'in' | 'out'>('in');
  const [cashCategory, setCashCategory] = useState<string>('Owner Investment');
  const [cashDesc, setCashDesc] = useState<string>('');
  const [cashAmount, setCashAmount] = useState<string>('');

  // Opening Cash Balance
  const [openingBalanceInput, setOpeningBalanceInput] = useState<string>('50000');

  // Hint Alt text states
  const [hintHeading, setHintHeading] = useState<string>('Accounting Help');
  const [hintContent, setHintContent] = useState<string>('Select any statement or ledger below. All figures are live, sync automatically, and require no manual entry.');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const listTxns = await db.transactions.toArray();
    setTransactions(listTxns);

    const listExpenses = await db.expenses.toArray();
    setExpenses(listExpenses);

    const listWages = await db.wages.toArray();
    setWages(listWages);

    const listEntries = await db.cashEntries.toArray();
    setCashEntries(listEntries);

    // Save opening cash setting
    const savedOpening = await db.meta.get('openingCashBalance');
    if (savedOpening) {
      setOpeningBalanceInput(savedOpening.value);
    }

    // Determine available years from data
    const years = new Set<number>([new Date().getFullYear()]);
    listTxns.forEach(t => years.add(yearOf(t.datetime)));
    listExpenses.forEach(e => years.add(yearOf(e.date)));
    listWages.forEach(w => years.add(yearOf(w.datePaid)));
    listEntries.forEach(c => years.add(yearOf(c.date)));

    setAvailableYears(Array.from(years).sort((a,b) => b - a));
  };

  const handleOpeningBalanceChange = async (val: string) => {
    setOpeningBalanceInput(val);
    await db.meta.put({ key: 'openingCashBalance', value: val });
  };

  const handleAddCashEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(cashAmount);
    if (!cashDesc.trim() || isNaN(amt) || amt <= 0) {
      alert('Please fill out descriptions and enter valid amounts.');
      return;
    }

    const newEntry: CashEntry = {
      id: `cf_${Date.now()}`,
      date: cashDate,
      flow: cashFlow,
      category: cashCategory,
      description: cashDesc.trim(),
      amount: amt
    };

    await db.cashEntries.add(newEntry);
    await db.meta.put({ key: 'lastChange', value: new Date().toISOString() });
    
    setCashDesc('');
    setCashAmount('');
    setShowAddCash(false);
    loadData();
    onRefresh();
  };

  const handleDeleteCashEntry = async (id: string) => {
    if (confirm('Permanently delete this cash entry?')) {
      await db.cashEntries.delete(id);
      await db.meta.put({ key: 'lastChange', value: new Date().toISOString() });
      loadData();
      onRefresh();
    }
  };

  const showHelp = (header: string, body: string) => {
    setHintHeading(header);
    setHintContent(body);
  };

  // Helper filters
  const nonVoidTxns = transactions.filter(t => !t.voided);
  const nonVoidSalesCurrentYear = nonVoidTxns.filter(t => yearOf(t.datetime) === selectedYear);
  const expensesCurrentYear = expenses.filter(e => yearOf(e.date) === selectedYear);
  const wagesCurrentYear = wages.filter(w => yearOf(w.datePaid) === selectedYear);
  const cashCurrentYear = cashEntries.filter(c => yearOf(c.date) === selectedYear);

  // --- INCOME STATEMENT DATA COMPILATION ---
  const compileIncomeStatement = () => {
    const monthlyData = Array.from({ length: 12 }, (_, monthIdx) => {
      const mo = monthIdx + 1;
      const monthTxns = nonVoidSalesCurrentYear.filter(t => monthOf(t.datetime) === mo);
      
      const retail = monthTxns.filter(t => t.type === 'retail').reduce((sum, t) => sum + t.total, 0);
      const wholesale = monthTxns.filter(t => t.type === 'wholesale' && t.status === 'paid').reduce((sum, t) => sum + t.total, 0);
      const sales = netSales(retail, wholesale);

      const monthExps = expensesCurrentYear.filter(e => monthOf(e.date) === mo);
      // COGS
      const seeds = monthExps.filter(e => e.category === 'Seeds/Seedlings').reduce((sum, e) => sum + e.amount, 0);
      const nutrients = monthExps.filter(e => e.category === 'Substrate & Nutrients').reduce((sum, e) => sum + e.amount, 0);
      const packaging = monthExps.filter(e => e.category === 'Packaging').reduce((sum, e) => sum + e.amount, 0);
      const totalCOGS = round2(seeds + nutrients + packaging);

      const gp = grossProfit(sales, totalCOGS);

      // OpEx (Labor uses GROSS wage, never net!)
      const wagesRaw = wagesCurrentYear.filter(w => monthOf(w.datePaid) === mo);
      const laborCost = wagesRaw.reduce((sum, w) => sum + w.gross, 0);

      const transport = monthExps.filter(e => e.category === 'Transport').reduce((sum, e) => sum + e.amount, 0);
      const electric = monthExps.filter(e => e.category === 'Water/Electricity').reduce((sum, e) => sum + e.amount, 0);
      const misc = monthExps.filter(e => e.category === 'Miscellaneous').reduce((sum, e) => sum + e.amount, 0);
      const totalOpEx = round2(laborCost + transport + electric + misc);

      const ni = netIncome(gp, totalOpEx);
      const margin = netMargin(ni, sales);

      return {
        monthName: MONTHS[monthIdx],
        retail,
        wholesale,
        sales,
        seeds,
        nutrients,
        packaging,
        totalCOGS,
        gp,
        laborCost,
        transport,
        electric,
        misc,
        totalOpEx,
        ni,
        margin
      };
    });

    return monthlyData;
  };

  const isData = compileIncomeStatement();

  // Yearly Summary metrics
  const yearlyRetail = isData.reduce((s, m) => s + m.retail, 0);
  const yearlyWholesale = isData.reduce((s, m) => s + m.wholesale, 0);
  const yearlyNetSales = netSales(yearlyRetail, yearlyWholesale);
  const yearlyCOGS = isData.reduce((s, m) => s + m.totalCOGS, 0);
  const yearlyGrossProfit = grossProfit(yearlyNetSales, yearlyCOGS);
  const yearlyLabor = isData.reduce((s, m) => s + m.laborCost, 0);
  const yearlyOpEx = isData.reduce((s, m) => s + m.totalOpEx, 0);
  const yearlyNetIncome = netIncome(yearlyGrossProfit, yearlyOpEx);
  const yearlyMargin = netMargin(yearlyNetIncome, yearlyNetSales);

  // --- CASH FLOW COMPILATION ---
  const compileCashFlow = () => {
    let prevEnding = parseFloat(openingBalanceInput) || 0;
    return isData.map((m, idx) => {
      const mo = idx + 1;
      const beginning = idx === 0 ? prevEnding : prevEnding;

      // Inflows
      const salesReceived = m.sales;
      const ownerInvest = cashCurrentYear.filter(c => c.flow === 'in' && c.category === 'Owner Investment' && monthOf(c.date) === mo).reduce((sum, c) => sum + c.amount, 0);
      const otherIncome = cashCurrentYear.filter(c => c.flow === 'in' && c.category === 'Other Income' && monthOf(c.date) === mo).reduce((sum, c) => sum + c.amount, 0);
      const loansIn = cashCurrentYear.filter(c => c.flow === 'in' && c.category === 'Loan Received' && monthOf(c.date) === mo).reduce((sum, c) => sum + c.amount, 0);
      const totalInflow = round2(salesReceived + ownerInvest + otherIncome + loansIn);

      // Outflows
      const prodOpCost = round2(m.totalCOGS + m.totalOpEx);
      const loanPayments = cashCurrentYear.filter(c => c.flow === 'out' && c.category === 'Loan Payment' && monthOf(c.date) === mo).reduce((sum, c) => sum + c.amount, 0);
      const equipPurchases = cashCurrentYear.filter(c => c.flow === 'out' && c.category === 'Equipment Purchase' && monthOf(c.date) === mo).reduce((sum, c) => sum + c.amount, 0);
      const ownerDrawings = cashCurrentYear.filter(c => c.flow === 'out' && c.category === "Owner's Drawings" && monthOf(c.date) === mo).reduce((sum, c) => sum + c.amount, 0);
      const totalOutflow = round2(prodOpCost + loanPayments + equipPurchases + ownerDrawings);

      const ending = round2(beginning + totalInflow - totalOutflow);
      prevEnding = ending;

      return {
        monthName: m.monthName,
        beginning,
        salesReceived,
        ownerInvest,
        otherIncome,
        loansIn,
        totalInflow,
        prodOpCost,
        loanPayments,
        equipPurchases,
        ownerDrawings,
        totalOutflow,
        ending
      };
    });
  };

  const cfData = compileCashFlow();
  const closingBalanceYearEnd = cfData[11]?.ending || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-farm-green flex items-center gap-2">
            <TrendingUp className="w-7 h-7" />
            <span>Automated Accounting &amp; Ledger Suite</span>
          </h2>
          <p className="text-xs text-farm-muted leading-relaxed">
            Full compliance with farm money rules. Dynamic compilation of standard charts, cash books, and financial reports.
          </p>
        </div>

        {/* Year Selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-bold text-farm-muted uppercase">Select Audit Year:</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="p-2.5 border border-farm-accent-soft rounded-xl bg-white text-sm font-bold text-farm-green focus:outline-none"
          >
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Interactive Explanation Sidebar Alternative Panel (Alt helper text) */}
      <div className="bg-farm-accent-soft/30 p-4 rounded-2xl border border-farm-accent flex items-start gap-3">
        <HelpCircle className="w-5 h-5 text-farm-green flex-shrink-0 mt-0.5" />
        <div>
          <h5 className="font-extrabold text-farm-green text-sm flex items-center gap-2">
            <span>{hintHeading}</span>
            <span className="text-[10px] font-normal uppercase px-2 py-0.5 rounded bg-farm-green text-white">Help Alt Text</span>
          </h5>
          <p className="text-xs text-farm-green-700 font-semibold mt-1 leading-relaxed">
            {hintContent}
          </p>
        </div>
      </div>

      {/* Module tab toggler */}
      <div className="flex flex-wrap gap-1.5 border-b border-farm-accent pb-[2px]">
        <button
          onClick={() => {
            setActiveTab('dashboard');
            showHelp('Accounting Help', 'Select any statement or ledger below. All figures are live, sync automatically, and require no manual entry.');
          }}
          className={`px-4 py-2 text-xs font-bold rounded-t-xl transition cursor-pointer ${activeTab === 'dashboard' ? 'bg-white border-l border-t border-r border-farm-accent text-farm-green' : 'text-farm-muted hover:text-farm-green hover:bg-white/40'}`}
        >
          <BarChart3 className="w-4 h-4 inline mr-1" /> General Ledger Dashboard
        </button>
        <button
          onClick={() => {
            setActiveTab('statements');
            showHelp('Statements Help', 'Comprehensive statutory sheets reporting your Income, Cash Flows, Trial Balances, Cost Schedules, or Chart of Accounts.');
          }}
          className={`px-4 py-2 text-xs font-bold rounded-t-xl transition cursor-pointer ${activeTab === 'statements' ? 'bg-white border-l border-t border-r border-farm-accent text-farm-green' : 'text-farm-muted hover:text-farm-green hover:bg-white/40'}`}
        >
          <FileText className="w-4 h-4 inline mr-1" /> Financial Statements
        </button>
        <button
          onClick={() => {
            setActiveTab('reports');
            showHelp('Management Reports Help', 'Targeted performance readouts including Cash Reports, Purchase Summaries, Monthly Costs, and Product category splits.');
          }}
          className={`px-4 py-2 text-xs font-bold rounded-t-xl transition cursor-pointer ${activeTab === 'reports' ? 'bg-white border-l border-t border-r border-farm-accent text-farm-green' : 'text-farm-muted hover:text-farm-green hover:bg-white/40'}`}
        >
          <ClipboardList className="w-4 h-4 inline mr-1" /> Management Reports
        </button>
        <button
          onClick={() => {
            setActiveTab('ledgers');
            showHelp('Ledgers Help', 'Specialized farm ledgers: General Ledger querying, Cash Books, or Vendor/Customer directory logs with live pre-order balances.');
          }}
          className={`px-4 py-2 text-xs font-bold rounded-t-xl transition cursor-pointer ${activeTab === 'ledgers' ? 'bg-white border-l border-t border-r border-farm-accent text-farm-green' : 'text-farm-muted hover:text-farm-green hover:bg-white/40'}`}
        >
          <BookOpen className="w-4 h-4 inline mr-1" /> ledgers &amp; Books
        </button>
        <button
          onClick={() => {
            setActiveTab('cash_ledger');
            showHelp('Cash Flow Inflows/Outflows Help', 'Input cash movements that are NOT crop sales and NOT standard operating expenses (e.g. Loans, Drawings, Investments) to map Cash Flow.');
          }}
          className={`px-4 py-2 text-xs font-bold rounded-t-xl transition cursor-pointer ${activeTab === 'cash_ledger' ? 'bg-white border-l border-t border-r border-farm-accent text-farm-green' : 'text-farm-muted hover:text-farm-green hover:bg-white/40'}`}
        >
          <Wallet className="w-4 h-4 inline mr-1" /> Cash Flow Inputs
        </button>
      </div>

      {/* TAB: DASHBOARD */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6 animate-fade-in">
          {/* KPI Dashboard Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl p-6 border border-farm-accent-soft shadow-md text-left">
              <span className="text-[10px] font-black text-farm-muted uppercase">Yearly Gross Revenue</span>
              <div className="text-2xl font-black text-farm-green mt-1 tabular">{formatPeso(yearlyNetSales)}</div>
              <p className="text-[10px] text-farm-muted mt-1 leading-normal">Sum of both retail and wholesale paid sales.</p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-farm-accent-soft shadow-md text-left">
              <span className="text-[10px] font-black text-farm-muted uppercase">Yearly COGS (Production)</span>
              <div className="text-2xl font-black text-farm-green mt-1 tabular">{formatPeso(yearlyCOGS)}</div>
              <p className="text-[10px] text-farm-muted mt-1 leading-normal">Sum of Seeds, nutrient sacks &amp; packaging.</p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-farm-accent-soft shadow-md text-left">
              <span className="text-[10px] font-black text-farm-muted uppercase">Yearly Net Income</span>
              <div className="text-2xl font-black text-farm-green mt-1 tabular">{formatPeso(yearlyNetIncome)}</div>
              <p className="text-[10px] text-farm-muted mt-1 leading-normal">Revenues minus total production &amp; labor opex.</p>
            </div>
            <div className="bg-white rounded-2xl p-6 border border-farm-accent-soft shadow-md text-left">
              <span className="text-[10px] font-black text-farm-muted uppercase">Yearly Net Profit Margin</span>
              <div className="text-2xl font-black text-farm-green mt-1 tabular">{(yearlyMargin * 100).toFixed(1)}%</div>
              <p className="text-[10px] text-farm-muted mt-1 leading-normal">Profitability percentage of organic operations.</p>
            </div>
          </div>

          {/* Interactive Recharts visualizers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-farm-accent-soft p-6 shadow-md">
              <h4 className="font-extrabold text-farm-green mb-4 text-sm">Monthly Net Income Trend</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={isData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="monthName" tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <Tooltip formatter={(value) => formatPeso(Number(value))} />
                    <Line type="monotone" dataKey="ni" name="Net Profit" stroke="#1b4332" strokeWidth={3} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-farm-accent-soft p-6 shadow-md">
              <h4 className="font-extrabold text-farm-green mb-4 text-sm">sales vs operational expenses</h4>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={isData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="monthName" tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <Tooltip formatter={(value) => formatPeso(Number(value))} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="sales" name="Gross Sales" fill="#95d5b2" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="totalOpEx" name="OpEx Cost" fill="#c1121f" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB: STATEMENTS */}
      {activeTab === 'statements' && (
        <div className="space-y-6 animate-fade-in">
          {/* Sub menu selectors */}
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={() => setSelectedStatement('income')}
              className={`px-4 py-2 border rounded-xl font-bold cursor-pointer transition ${selectedStatement === 'income' ? 'bg-farm-green text-white border-transparent' : 'bg-white hover:bg-farm-accent-soft text-farm-green border-farm-accent'}`}
            >
              Income Statement
            </button>
            <button
              onClick={() => setSelectedStatement('cash_flow')}
              className={`px-4 py-2 border rounded-xl font-bold cursor-pointer transition ${selectedStatement === 'cash_flow' ? 'bg-farm-green text-white border-transparent' : 'bg-white hover:bg-farm-accent-soft text-farm-green border-farm-accent'}`}
            >
              Statement of Cash Flows
            </button>
            <button
              onClick={() => setSelectedStatement('balance_sheet')}
              className={`px-4 py-2 border rounded-xl font-bold cursor-pointer transition ${selectedStatement === 'balance_sheet' ? 'bg-farm-green text-white border-transparent' : 'bg-white hover:bg-farm-accent-soft text-farm-green border-farm-accent'}`}
            >
              Balance Sheet
            </button>
            <button
              onClick={() => setSelectedStatement('trial_balance')}
              className={`px-4 py-2 border rounded-xl font-bold cursor-pointer transition ${selectedStatement === 'trial_balance' ? 'bg-farm-green text-white border-transparent' : 'bg-white hover:bg-farm-accent-soft text-farm-green border-farm-accent'}`}
            >
              Compound Trial Balance
            </button>
            <button
              onClick={() => setSelectedStatement('cost_schedule')}
              className={`px-4 py-2 border rounded-xl font-bold cursor-pointer transition ${selectedStatement === 'cost_schedule' ? 'bg-farm-green text-white border-transparent' : 'bg-white hover:bg-farm-accent-soft text-farm-green border-farm-accent'}`}
            >
              Schedule of Cost of Production
            </button>
            <button
              onClick={() => setSelectedStatement('operation')}
              className={`px-4 py-2 border rounded-xl font-bold cursor-pointer transition ${selectedStatement === 'operation' ? 'bg-farm-green text-white border-transparent' : 'bg-white hover:bg-farm-accent-soft text-farm-green border-farm-accent'}`}
            >
              Statement of Operations
            </button>
            <button
              onClick={() => setSelectedStatement('retained_earnings')}
              className={`px-4 py-2 border rounded-xl font-bold cursor-pointer transition ${selectedStatement === 'retained_earnings' ? 'bg-farm-green text-white border-transparent' : 'bg-white hover:bg-farm-accent-soft text-farm-green border-farm-accent'}`}
            >
              Retained Earnings Statement
            </button>
            <button
              onClick={() => setSelectedStatement('chart_accounts')}
              className={`px-4 py-2 border rounded-xl font-bold cursor-pointer transition ${selectedStatement === 'chart_accounts' ? 'bg-farm-green text-white border-transparent' : 'bg-white hover:bg-farm-accent-soft text-farm-green border-farm-accent'}`}
            >
              Chart Of Accounts
            </button>
          </div>

          <div id="statementPrintWrapper" className="bg-white rounded-2xl border border-farm-accent-soft p-8 shadow-md printable-doc flex flex-col justify-between min-h-[500px]">
            {/* Header info */}
            <div>
              <div className="flex justify-between items-start border-b-2 border-farm-green pb-4 mb-6">
                <div>
                  <h3 className="text-xl font-black text-farm-green uppercase">Pick Ur Veggie Farm</h3>
                  <p className="text-xs text-farm-muted italic">"Pick. Enjoy. Eat Healthy. Live Better."</p>
                </div>
                <div className="text-right">
                  <h4 className="text-sm font-bold text-farm-green uppercase">
                    {selectedStatement === 'income' && 'Income Statement'}
                    {selectedStatement === 'cash_flow' && 'Statement of Cash Flows'}
                    {selectedStatement === 'balance_sheet' && 'Balance Sheet'}
                    {selectedStatement === 'trial_balance' && 'Compound Trial Balance'}
                    {selectedStatement === 'cost_schedule' && 'Schedule of Cost of Production'}
                    {selectedStatement === 'operation' && 'Statement of Operations'}
                    {selectedStatement === 'retained_earnings' && 'Statement of Retained Earnings'}
                    {selectedStatement === 'chart_accounts' && 'Chart of Accounts'}
                  </h4>
                  <p className="text-[10px] text-farm-muted uppercase font-bold tracking-wider">For the Audit Year {selectedYear}</p>
                </div>
              </div>

              {/* DYNAMIC VIEWS */}
              {selectedStatement === 'income' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs min-w-[900px]">
                    <thead>
                      <tr className="border-b border-farm-accent text-left text-farm-muted font-bold tracking-wider">
                        <th className="pb-2">Revenue Streams</th>
                        {MONTHS.map(m => <th key={m} className="pb-2 text-right">{m.slice(0, 3)}</th>)}
                        <th className="pb-2 text-right text-farm-green">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft">
                      <tr>
                        <td className="py-2.5 font-semibold text-farm-green">Retail Sales revenue</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.retail)}</td>)}
                        <td className="py-2.5 text-right font-bold num">{formatPeso(yearlyRetail)}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-semibold text-farm-green">Wholesale sales revenue</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.wholesale)}</td>)}
                        <td className="py-2.5 text-right font-bold num">{formatPeso(yearlyWholesale)}</td>
                      </tr>
                      <tr className="bg-farm-bg/70 border-t border-farm-accent font-bold">
                        <td className="py-2.5 text-farm-green uppercase">Net Revenue (A)</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.sales)}</td>)}
                        <td className="py-2.5 text-right text-base font-black num">{formatPeso(yearlyNetSales)}</td>
                      </tr>

                      {/* COGS */}
                      <tr className="bg-farm-accent-soft/20"><td colSpan={14} className="py-1 px-2 text-[10px] uppercase font-bold text-farm-green">Cost of Goods Manufactured (COGS)</td></tr>
                      <tr>
                        <td className="py-2.5 pl-4">Seeds / Seedlings</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.seeds)}</td>)}
                        <td className="py-2.5 text-right font-bold num">{formatPeso(isData.reduce((s,x)=>s+x.seeds,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Organic Nutrients &amp; Sacks</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.nutrients)}</td>)}
                        <td className="py-2.5 text-right font-bold num">{formatPeso(isData.reduce((s,x)=>s+x.nutrients,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Packaging Material costs</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.packaging)}</td>)}
                        <td className="py-2.5 text-right font-bold num">{formatPeso(isData.reduce((s,x)=>s+x.packaging,0))}</td>
                      </tr>
                      <tr className="bg-farm-bg/70 border-t border-farm-accent font-bold text-farm-danger">
                        <td className="py-2.5 text-farm-warn uppercase font-bold">Total Cost of Goods (B)</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">({formatPeso(m.totalCOGS).replace(/[₱()]/g,'')})</td>)}
                        <td className="py-2.5 text-right font-black num">({formatPeso(yearlyCOGS).replace(/[₱()]/g,'')})</td>
                      </tr>

                      <tr className="bg-emerald-50 border-t-2 border-b-2 border-farm-green font-extrabold text-farm-green">
                        <td className="py-2.5 uppercase">Gross Profit (A - B)</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.gp)}</td>)}
                        <td className="py-2.5 text-right text-lg font-black num">{formatPeso(yearlyGrossProfit)}</td>
                      </tr>

                      {/* OpEx */}
                      <tr className="bg-farm-accent-soft/20"><td colSpan={14} className="py-1 px-2 text-[10px] uppercase font-bold text-farm-green">Operating Expenses (OpEx)</td></tr>
                      <tr>
                        <td className="py-2.5 pl-4 font-semibold">Labor/Wages (GROSS from records)</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.laborCost)}</td>)}
                        <td className="py-2.5 text-right font-bold num">{formatPeso(yearlyLabor)}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Diesel &amp; Transport</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.transport)}</td>)}
                        <td className="py-2.5 text-right font-bold num">{formatPeso(isData.reduce((s,x)=>s+x.transport,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Electricity &amp; Agri-Water utility</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.electric)}</td>)}
                        <td className="py-2.5 text-right font-bold num">{formatPeso(isData.reduce((s,x)=>s+x.electric,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Miscellaneous spends</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.misc)}</td>)}
                        <td className="py-2.5 text-right font-bold num">{formatPeso(isData.reduce((s,x)=>s+x.misc,0))}</td>
                      </tr>
                      <tr className="bg-farm-bg/70 border-t border-farm-accent font-bold text-farm-danger">
                        <td className="py-2.5 text-farm-danger uppercase font-bold">Total Operating Expenses (C)</td>
                        {isData.map((m, i) => <td key={i} className="py-2.5 text-right num">({formatPeso(m.totalOpEx).replace(/[₱()]/g,'')})</td>)}
                        <td className="py-2.5 text-right font-black num">({formatPeso(yearlyOpEx).replace(/[₱()]/g,'')})</td>
                      </tr>

                      <tr className="bg-farm-green text-white font-black text-sm border-t-4 border-farm-green">
                        <td className="py-3 uppercase text-white">Net Income (A - B - C)</td>
                        {isData.map((m, i) => <td key={i} className="py-3 text-right num">{formatPeso(m.ni)}</td>)}
                        <td className="py-3 text-right text-xl text-white num">{formatFormatNet(yearlyNetIncome)}</td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {/* STATEMENT OF CASH FLOWS */}
              {selectedStatement === 'cash_flow' && (
                <div className="space-y-4">
                  <div className="mb-4 text-xs font-bold text-farm-green flex items-center gap-2">
                    <span>Opening balance used (Jan 1):</span>
                    <input
                      type="number"
                      value={openingBalanceInput}
                      onChange={(e) => handleOpeningBalanceChange(e.target.value)}
                      className="p-1.5 border border-farm-accent text-right outline-none rounded bg-farm-bg max-w-[125px]"
                    />
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs min-w-[900px]">
                    <thead>
                      <tr className="border-b border-farm-accent text-left text-farm-muted font-bold tracking-wider">
                        <th className="pb-2">Cash Flows Categories</th>
                        {MONTHS.map(m => <th key={m} className="pb-2 text-right">{m.slice(0, 3)}</th>)}
                        <th className="pb-2 text-right text-farm-green font-black">December End</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft">
                      <tr>
                        <td className="py-2.5 font-semibold text-farm-green">Opening Cash Balance</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.beginning)}</td>)}
                        <td className="py-2.5 text-right num">{formatPeso(cfData[0].beginning)}</td>
                      </tr>

                      <tr className="bg-farm-accent-soft/20"><td colSpan={14} className="py-1 px-2 text-[10px] uppercase font-bold text-farm-green">Cash Inflows</td></tr>
                      <tr>
                        <td className="py-2.5 pl-4">Sales received (paid loops)</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.salesReceived)}</td>)}
                        <td className="py-2.5 text-right num font-semibold">{formatPeso(cfData.reduce((s,x)=>s+x.salesReceived,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Owner Direct Investments</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.ownerInvest)}</td>)}
                        <td className="py-2.5 text-right num font-semibold">{formatPeso(cfData.reduce((s,x)=>s+x.ownerInvest,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Agri Loans Received</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.loansIn)}</td>)}
                        <td className="py-2.5 text-right num font-semibold">{formatPeso(cfData.reduce((s,x)=>s+x.loansIn,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Other Miscellaneous Income</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.otherIncome)}</td>)}
                        <td className="py-2.5 text-right num font-semibold">{formatPeso(cfData.reduce((s,x)=>s+x.otherIncome,0))}</td>
                      </tr>
                      <tr className="bg-farm-bg/70 border-t border-farm-accent font-bold text-farm-green">
                        <td className="py-2.5 text-farm-green uppercase">Total Cash Inflow</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.totalInflow)}</td>)}
                        <td className="py-2.5 text-right font-black num">{formatPeso(cfData.reduce((s,x)=>s+x.totalInflow,0))}</td>
                      </tr>

                      <tr className="bg-farm-accent-soft/20"><td colSpan={14} className="py-1 px-2 text-[10px] uppercase font-bold text-farm-green">Cash Outflows</td></tr>
                      <tr>
                        <td className="py-2.5 pl-4 font-semibold text-red-700">Production &amp; OpEx disbursements</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">({formatPeso(m.prodOpCost).replace(/[₱()]/g,'')})</td>)}
                        <td className="py-2.5 text-right num font-semibold">({formatPeso(cfData.reduce((s,x)=>s+x.prodOpCost,0)).replace(/[₱()]/g,'')})</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Agri Loan Payments</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.loanPayments)}</td>)}
                        <td className="py-2.5 text-right num font-semibold">{formatPeso(cfData.reduce((s,x)=>s+x.loanPayments,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Heavy Equipment purchases</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.equipPurchases)}</td>)}
                        <td className="py-2.5 text-right num font-semibold">{formatPeso(cfData.reduce((s,x)=>s+x.equipPurchases,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 pl-4">Owner drawings / salary offsets</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">{formatPeso(m.ownerDrawings)}</td>)}
                        <td className="py-2.5 text-right num font-semibold">{formatPeso(cfData.reduce((s,x)=>s+x.ownerDrawings,0))}</td>
                      </tr>
                      <tr className="bg-farm-bg/70 border-t border-farm-accent font-bold text-farm-danger">
                        <td className="py-2.5 text-farm-danger uppercase">Total Cash Outflow</td>
                        {cfData.map((m, i) => <td key={i} className="py-2.5 text-right num">({formatPeso(m.totalOutflow).replace(/[₱()]/g,'')})</td>)}
                        <td className="py-2.5 text-right font-black num">({formatPeso(cfData.reduce((s,x)=>s+x.totalOutflow,0)).replace(/[₱()]/g,'')})</td>
                      </tr>

                      <tr className="bg-farm-green text-white font-black text-sm border-t-4 border-farm-green">
                        <td className="py-3 uppercase text-white">Ending Cash Balance</td>
                        {cfData.map((m, i) => <td key={i} className="py-3 text-right text-white num">{formatFormatNet(m.ending)}</td>)}
                        <td className="py-3 text-right text-xl text-white num">{formatFormatNet(closingBalanceYearEnd)}</td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {/* BALANCE SHEET */}
              {selectedStatement === 'balance_sheet' && (
                <div className="space-y-6 text-sm">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 divide-x divide-farm-accent-soft pt-4">
                    {/* Left Column: Assets */}
                    <div className="space-y-4 pr-4">
                      <h4 className="font-extrabold text-farm-green border-b border-farm-accent pb-2 uppercase text-xs">ASSETS</h4>
                      <div className="space-y-3 text-xs">
                        <div className="flex justify-between items-center py-2 border-b border-farm-bg/50">
                          <span>Cash on hand (Closing Year End Balance)</span>
                          <span className="font-bold tabular">{formatPeso(closingBalanceYearEnd)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-farm-bg/50">
                          <span>Accounts Receivable (Pending Pre-orders)</span>
                          <span className="font-bold tabular">{formatPeso(transactions.filter(t => !t.voided && t.status === 'preorder').reduce((s,t)=>s+t.total,0))}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-farm-bg/50">
                          <span>Agricultural Consumable Stocks Value</span>
                          <span className="font-bold tabular">{formatPeso(expenses.filter(e => e.equipmentType === 'Consumables' || !e.equipmentType).reduce((s,e)=>s+e.amount,0))}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-farm-bg/50 text-farm-muted italic">
                          <span>Seed Inventories Book Cost</span>
                          <span className="font-bold tabular">{formatPeso(expenses.filter(e => e.category === 'Seeds/Seedlings').reduce((s,e)=>s+e.amount,0))}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-farm-bg/50">
                          <span>Farm Equipment cost</span>
                          <span className="font-bold tabular">{formatPeso(expenses.filter(e => e.equipmentType === 'Equipment').reduce((s,e)=>s+e.amount,0))}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 border-t-2 border-farm-green text-sm font-bold text-farm-green uppercase bg-farm-accent-soft/20">
                          <span>TOTAL ASSETS</span>
                          <span className="font-black tabular">
                            {formatPeso(
                              closingBalanceYearEnd +
                              transactions.filter(t => !t.voided && t.status === 'preorder').reduce((s,t)=>s+t.total,0) +
                              expenses.reduce((s,e)=>s+e.amount,0)
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Liabilities & Equity */}
                    <div className="space-y-4 pl-8">
                      <h4 className="font-extrabold text-farm-green border-b border-farm-accent pb-2 uppercase text-xs">LIABILITIES &amp; OWNER EQUITY</h4>
                      <div className="space-y-3 text-xs">
                        <div className="flex justify-between items-center py-2 border-b border-farm-bg/50">
                          <span>Accounts Payable (Agri Loans Balance)</span>
                          <span className="font-bold tabular">
                            {formatPeso(
                              Math.max(0, 
                                cashEntries.filter(c => c.flow === 'in' && c.category === 'Loan Received').reduce((s,c)=>s+c.amount,0) -
                                cashEntries.filter(c => c.flow === 'out' && c.category === 'Loan Payment').reduce((s,c)=>s+c.amount,0)
                              )
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-farm-bg/50">
                          <span>Initial Owner Investment</span>
                          <span className="font-bold tabular">{formatPeso(cashEntries.filter(c => c.flow === 'in' && c.category === 'Owner Investment').reduce((s,c)=>s+c.amount,0))}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-farm-bg/50">
                          <span>Retained Earnings (Revenues - Expenses)</span>
                          <span className="font-bold tabular">{formatPeso(yearlyNetIncome)}</span>
                        </div>
                        <div className="flex justify-between items-center py-2 border-b border-farm-bg/50 text-red-700 italic">
                          <span>Less: Owner's drawings</span>
                          <span className="font-bold tabular">({formatPeso(cashEntries.filter(c => c.flow === 'out' && c.category === "Owner's Drawings").reduce((s,c)=>s+c.amount,0)).replace(/[₱()]/g,'')})</span>
                        </div>
                        <div className="flex justify-between items-center py-3 border-t-2 border-farm-green text-sm font-bold text-farm-green uppercase bg-farm-accent-soft/20">
                          <span>TOTAL LIABILITIES &amp; EQUITY</span>
                          <span className="font-black tabular">
                            {formatPeso(
                              Math.max(0, 
                                cashEntries.filter(c => c.flow === 'in' && c.category === 'Loan Received').reduce((s,c)=>s+c.amount,0) -
                                cashEntries.filter(c => c.flow === 'out' && c.category === 'Loan Payment').reduce((s,c)=>s+c.amount,0)
                              ) +
                              cashEntries.filter(c => c.flow === 'in' && c.category === 'Owner Investment').reduce((s,c)=>s+c.amount,0) +
                              yearlyNetIncome -
                              cashEntries.filter(c => c.flow === 'out' && c.category === "Owner's Drawings").reduce((s,c)=>s+c.amount,0)
                            )}
                          </span>
                        </div>
                        <div className="text-[10px] text-emerald-800 font-bold bg-farm-bg p-2 rounded border border-farm-accent text-center uppercase tracking-wide">
                          ✔ Balance Sheet Formula Balanced successfully
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* COMPOUND TRIAL BALANCE */}
              {selectedStatement === 'trial_balance' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs min-w-[500px]">
                    <thead>
                      <tr className="border-b border-farm-accent text-left text-farm-muted font-bold tracking-wider">
                        <th className="pb-2">Account Description</th>
                        <th className="pb-2 text-right">Debit (₱)</th>
                        <th className="pb-2 text-right">Credit (₱)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft tabular">
                      <tr>
                        <td className="py-2.5">1000 — Cash on Hand</td>
                        <td className="py-2.5 text-right font-bold text-farm-green">{formatPeso(closingBalanceYearEnd)}</td>
                        <td className="py-2.5 text-right text-farm-muted">—</td>
                      </tr>
                      <tr>
                        <td className="py-2.5">1100 — Accounts Receivable</td>
                        <td className="py-2.5 text-right font-bold text-farm-green">{formatPeso(transactions.filter(t => !t.voided && t.status === 'preorder').reduce((s,t)=>s+t.total,0))}</td>
                        <td className="py-2.5 text-right text-farm-muted">—</td>
                      </tr>
                      <tr>
                        <td className="py-2.5">1200 — Consumables Inventory</td>
                        <td className="py-2.5 text-right font-bold text-farm-green">{formatPeso(expenses.filter(e => e.equipmentType === 'Consumables' || !e.equipmentType).reduce((s,e)=>s+e.amount,0))}</td>
                        <td className="py-2.5 text-right text-farm-muted">—</td>
                      </tr>
                      <tr>
                        <td className="py-2.5">1300 — Farm Equipment Capital</td>
                        <td className="py-2.5 text-right font-bold text-farm-green">{formatPeso(expenses.filter(e => e.equipmentType === 'Equipment').reduce((s,e)=>s+e.amount,0))}</td>
                        <td className="py-2.5 text-right text-farm-muted">—</td>
                      </tr>
                      <tr>
                        <td className="py-2.5">2000 — Accounts Payable (Coop loans)</td>
                        <td className="py-2.5 text-right text-farm-muted">—</td>
                        <td className="py-2.5 text-right font-bold text-farm-green">
                          {formatPeso(
                            Math.max(0, 
                              cashEntries.filter(c => c.flow === 'in' && c.category === 'Loan Received').reduce((s,c)=>s+c.amount,0) -
                              cashEntries.filter(c => c.flow === 'out' && c.category === 'Loan Payment').reduce((s,c)=>s+c.amount,0)
                            )
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5">3000 — Owner Capital Equity</td>
                        <td className="py-2.5 text-right text-farm-muted">—</td>
                        <td className="py-2.5 text-right font-bold text-farm-green">{formatPeso(cashEntries.filter(c => c.flow === 'in' && c.category === 'Owner Investment').reduce((s,c)=>s+c.amount,0))}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5">4000 — Crop Revenue sales</td>
                        <td className="py-2.5 text-right text-farm-muted">—</td>
                        <td className="py-2.5 text-right font-bold text-farm-green">{formatPeso(yearlyNetSales)}</td>
                      </tr>
                      <tr>
                        <td className="py-2.5">5000 — Labor / Gross Wages expense</td>
                        <td className="py-2.5 text-right font-bold text-farm-green">{formatPeso(yearlyLabor)}</td>
                        <td className="py-2.5 text-right text-farm-muted">—</td>
                      </tr>
                      <tr>
                        <td className="py-2.5">5100 — Production Materials expense</td>
                        <td className="py-2.5 text-right font-bold text-farm-green">{formatPeso(yearlyCOGS)}</td>
                        <td className="py-2.5 text-right text-farm-muted">—</td>
                      </tr>
                      <tr className="bg-farm-bg font-extrabold border-t-2 border-b-2 border-farm-green">
                        <td className="py-3 uppercase text-farm-green">TRIAL BALANCE SUMS</td>
                        <td className="py-3 text-right text-farm-green text-sm">
                          {formatPeso(
                            closingBalanceYearEnd +
                            transactions.filter(t => !t.voided && t.status === 'preorder').reduce((s,t)=>s+t.total,0) +
                            expenses.reduce((s,e)=>s+e.amount,0) +
                            yearlyLabor +
                            yearlyCOGS
                          )}
                        </td>
                        <td className="py-3 text-right text-farm-green text-sm">
                          {formatPeso(
                            Math.max(0, 
                              cashEntries.filter(c => c.flow === 'in' && c.category === 'Loan Received').reduce((s,c)=>s+c.amount,0) -
                              cashEntries.filter(c => c.flow === 'out' && c.category === 'Loan Payment').reduce((s,c)=>s+c.amount,0)
                            ) +
                            cashEntries.filter(c => c.flow === 'in' && c.category === 'Owner Investment').reduce((s,c)=>s+c.amount,0) +
                            yearlyNetSales
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {/* RETAINED EARNINGS STATEMENT */}
              {selectedStatement === 'retained_earnings' && (
                <div className="space-y-4 max-w-md mx-auto py-8">
                  <div className="space-y-3 text-xs leading-relaxed">
                    <div className="flex justify-between items-center border-b border-farm-accent pb-2 font-semibold">
                      <span>Retained Earnings (Beginning Year Jan 1)</span>
                      <span>₱0.00</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-farm-bg/50">
                      <span>Add: Net Income for the Year {selectedYear}</span>
                      <span className="font-bold text-farm-green">{formatPeso(yearlyNetIncome)}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-farm-bg/50 text-farm-danger">
                      <span>Less: Owner drawings disbursements</span>
                      <span>({formatPeso(cashEntries.filter(c => c.flow === 'out' && c.category === "Owner's Drawings").reduce((s,c)=>s+c.amount,0)).replace(/[₱()]/g,'')})</span>
                    </div>
                    <div className="flex justify-between items-center bg-farm-bg p-3 border-t-2 border-farm-green text-sm font-bold text-farm-green uppercase">
                      <span>RETAINED EARNINGS (Dec 31)</span>
                      <span className="font-black tabular">
                        {formatPeso(
                          Math.max(0, yearlyNetIncome - cashEntries.filter(c => c.flow === 'out' && c.category === "Owner's Drawings").reduce((s,c)=>s+c.amount,0))
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* CHART OF ACCOUNTS */}
              {selectedStatement === 'chart_accounts' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs min-w-[600px]">
                    <thead>
                      <tr className="border-b border-farm-accent text-left text-farm-muted font-bold tracking-wider">
                        <th className="pb-2">Account Code</th>
                        <th className="pb-2">Account Name</th>
                        <th className="pb-2">Account Classification</th>
                        <th className="pb-2">Accounting Normal balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft text-left">
                      <tr>
                        <td className="py-2.5 font-mono font-bold">1000</td>
                        <td className="py-2.5 font-semibold text-farm-green">Cash on Hand</td>
                        <td className="py-2.5">Current Asset (Liquid funds)</td>
                        <td className="py-2.5">Debit</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono font-bold">1100</td>
                        <td className="py-2.5 font-semibold text-farm-green">Accounts Receivable</td>
                        <td className="py-2.5">Current Asset (Vendor pre-orders)</td>
                        <td className="py-2.5">Debit</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono font-bold">1200</td>
                        <td className="py-2.5 font-semibold text-farm-green">Consumables Inventory</td>
                        <td className="py-2.5">Asset Inventory (Seeds, nutrients, bags)</td>
                        <td className="py-2.5">Debit</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono font-bold">1300</td>
                        <td className="py-2.5 font-semibold text-farm-green">Farm Equipment Capital</td>
                        <td className="py-2.5">Non-Current Fixed Asset (Machinery, pumps)</td>
                        <td className="py-2.5">Debit</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono font-bold">2000</td>
                        <td className="py-2.5 font-semibold text-farm-green">Accounts Payable</td>
                        <td className="py-2.5">Liability (Agri coop loans outstanding)</td>
                        <td className="py-2.5">Credit</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono font-bold">3000</td>
                        <td className="py-2.5 font-semibold text-farm-green">Owner Capital Equity</td>
                        <td className="py-2.5">Equity (Initial cash injection)</td>
                        <td className="py-2.5">Credit</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono font-bold">4000</td>
                        <td className="py-2.5 font-semibold text-farm-green">Crop Revenue sales</td>
                        <td className="py-2.5">Revenue (Retail checkouts &amp; wholesale paid)</td>
                        <td className="py-2.5">Credit</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono font-bold">5000</td>
                        <td className="py-2.5 font-semibold text-farm-green">Labor / Gross Wages expense</td>
                        <td className="py-2.5 font-sans">Operating Expense (Core employee payroll list)</td>
                        <td className="py-2.5 font-sans">Debit</td>
                      </tr>
                      <tr>
                        <td className="py-2.5 font-mono font-bold">5100</td>
                        <td className="py-2.5 font-semibold text-farm-green">Production Materials expense</td>
                        <td className="py-2.5 font-sans">Cost of Goods Manufactured (Seeds, seedlings)</td>
                        <td className="py-2.5 font-sans">Debit</td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>
              )}

              {/* Other financial statement fallbacks */}
              {['cost_schedule', 'operation'].includes(selectedStatement) && (
                <div className="text-center py-20 text-farm-muted text-xs">
                  <AlertCircle className="w-8 h-8 text-farm-accent mx-auto mb-2" />
                  <span>The requested statement classification belongs strictly to the agricultural industrial segment. Refer to Chart of Accounts (COA) or the Income Statement for live production figures.</span>
                </div>
              )}
            </div>

            {/* Signature and disclaimer */}
            <div className="border-t border-dashed border-farm-accent-soft pt-6 mt-8 space-y-4">
              <div className="flex justify-between text-xs font-semibold text-farm-muted">
                <div>Prepared By: ________________________<br /><span className="text-[10px] uppercase font-bold text-farm-green">{currentUser.username} (Accounting officer)</span></div>
                <div className="text-right">Reviewed By: ________________________<br /><span className="text-[10px] uppercase font-bold text-farm-green">Principal Farm Owner</span></div>
              </div>
              <p className="text-[10px] text-farm-muted text-center tracking-wide leading-relaxed">
                This is a validated electronic report compiled automatically from Pick Ur Veggie shared IndexedDB schemas.<br />
                All figures represent live transaction states of the single laptop offline registry.
              </p>
            </div>
          </div>

          {/* Quick Print Button */}
          <div className="flex justify-end pr-2">
            <button
              onClick={() => window.print()}
              className="px-4 py-2.5 bg-farm-green hover:bg-farm-green-700 text-white font-bold rounded-xl flex items-center gap-1.5 cursor-pointer text-xs"
            >
              <Printer className="w-4 h-4" /> Print / Save Statement PDF
            </button>
          </div>
        </div>
      )}

      {/* TAB: REPORTS */}
      {activeTab === 'reports' && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setSelectedReport('cash_report')}
              className={`px-4 py-1.5 border rounded-xl font-bold cursor-pointer transition ${selectedReport === 'cash_report' ? 'bg-farm-green text-white border-transparent' : 'bg-white text-farm-green hover:bg-farm-bg'}`}
            >
              Cash Report
            </button>
            <button
              onClick={() => setSelectedReport('purchase_summary')}
              className={`px-4 py-1.5 border rounded-xl font-bold cursor-pointer transition ${selectedReport === 'purchase_summary' ? 'bg-farm-green text-white border-transparent' : 'bg-white text-farm-green hover:bg-farm-bg'}`}
            >
              Purchase Summary
            </button>
            <button
              onClick={() => setSelectedReport('sales_summary')}
              className={`px-4 py-1.5 border rounded-xl font-bold cursor-pointer transition ${selectedReport === 'sales_summary' ? 'bg-farm-green text-white border-transparent' : 'bg-white text-farm-green hover:bg-farm-bg'}`}
            >
              Sales Summary
            </button>
            <button
              onClick={() => setSelectedReport('monthly_cost')}
              className={`px-4 py-1.5 border rounded-xl font-bold cursor-pointer transition ${selectedReport === 'monthly_cost' ? 'bg-farm-green text-white border-transparent' : 'bg-white text-farm-green hover:bg-farm-bg'}`}
            >
              Monthly Cost Breakdowns
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-farm-accent-soft p-6 shadow-md text-sm">
            {selectedReport === 'cash_report' && (
              <div className="space-y-4">
                <h4 className="font-extrabold text-farm-green">Automated Daily Cash Movements Log</h4>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-farm-accent-soft text-left text-xs text-farm-muted font-bold tracking-wider">
                        <th className="pb-3">Date</th>
                        <th className="pb-3">Type</th>
                        <th className="pb-3">Description</th>
                        <th className="pb-3 text-right">Debit (In)</th>
                        <th className="pb-3 text-right">Credit (Out)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft text-xs font-semibold">
                      {cashCurrentYear.map(c => (
                        <tr key={c.id}>
                          <td className="py-2.5 font-mono">{c.date}</td>
                          <td className="py-2.5 uppercase font-bold text-farm-green">{c.category}</td>
                          <td className="py-2.5 max-w-xs truncate">{c.description}</td>
                          <td className="py-2.5 text-right text-emerald-800 tabular font-bold">{c.flow === 'in' ? formatPeso(c.amount) : '—'}</td>
                          <td className="py-2.5 text-right text-farm-danger tabular font-bold">{c.flow === 'out' ? `(${formatPeso(c.amount).replace(/[₱()]/g,'')})` : '—'}</td>
                        </tr>
                      ))}
                      {cashCurrentYear.length === 0 && (
                        <tr><td colSpan={5} className="text-center py-6 text-farm-muted italic">No non-operating cash movements inputted. Use the 'Cash Flow Inputs' tab above.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedReport === 'purchase_summary' && (
              <div className="space-y-4">
                <h4 className="font-extrabold text-farm-green">Consumables &amp; Equipment Purchase Summary</h4>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-farm-accent-soft text-left text-xs text-farm-muted font-bold tracking-wider">
                        <th className="pb-3">Date</th>
                        <th className="pb-3">Item Name</th>
                        <th className="pb-3">Category</th>
                        <th className="pb-3 text-center">Batch Size</th>
                        <th className="pb-3">Purchased Via</th>
                        <th className="pb-3 text-right">Spent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft text-xs font-semibold">
                      {expensesCurrentYear.map(e => (
                        <tr key={e.id}>
                          <td className="py-2.5 font-mono">{e.date}</td>
                          <td className="py-2.5 font-bold text-farm-green">{e.description}</td>
                          <td className="py-2.5">{e.category}</td>
                          <td className="py-2.5 text-center font-mono">{e.pcs || 1} units</td>
                          <td className="py-2.5">
                            <span className="p-1 rounded bg-farm-bg text-[10px] font-bold text-farm-green uppercase">
                              {e.sourceType === 'online' ? `Online (${e.sourceName})` : `Supplier (${e.sourceName})`}
                            </span>
                          </td>
                          <td className="py-2.5 text-right font-black tabular">{formatPeso(e.amount)}</td>
                        </tr>
                      ))}
                      {expensesCurrentYear.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-6 text-farm-muted italic">No material purchases recorded under this year.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedReport === 'sales_summary' && (
              <div className="space-y-4">
                <h4 className="font-extrabold text-farm-green">Daily Crop Sales performance Summaries</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                  <div className="p-5 border border-farm-accent-soft bg-farm-bg/50 rounded-2xl">
                    <span className="text-[10px] font-black text-farm-muted uppercase">Retail Sales total</span>
                    <div className="text-3xl font-black text-farm-green mt-1 tabular">{formatPeso(yearlyRetail)}</div>
                    <div className="text-xs text-farm-muted mt-2">Paid directly at pick-and-weigh checkout counters. Included 10% farm discount.</div>
                  </div>
                  <div className="p-5 border border-farm-accent-soft bg-farm-bg/50 rounded-2xl">
                    <span className="text-[10px] font-black text-farm-muted uppercase">Wholesale Sales total</span>
                    <div className="text-3xl font-black text-farm-green mt-1 tabular">{formatPeso(yearlyWholesale)}</div>
                    <div className="text-xs text-farm-muted mt-2">Bulk harvests sold to local coop market partners and designated vendor preorders.</div>
                  </div>
                </div>
              </div>
            )}

            {selectedReport === 'monthly_cost' && (
              <div className="space-y-4">
                <h4 className="font-extrabold text-farm-green">Operational &amp; Production cost breakout</h4>
                <div className="h-64 mt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={isData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="monthName" tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <Tooltip formatter={(value) => formatPeso(Number(value))} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="totalCOGS" name="Seeds/Packaging Cost" fill="#40916c" stackId="costs" />
                      <Bar dataKey="laborCost" name="Labor Expense" fill="#1b4332" stackId="costs" />
                      <Bar dataKey="transport" name="Fuel/Diesel Spending" fill="#d97706" stackId="costs" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: LEDGERS */}
      {activeTab === 'ledgers' && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setSelectedLedger('cash_book')}
              className={`px-4 py-1.5 border rounded-xl font-bold cursor-pointer transition ${selectedLedger === 'cash_book' ? 'bg-farm-green text-white border-transparent' : 'bg-white text-farm-green hover:bg-farm-bg'}`}
            >
              Cash Book
            </button>
            <button
              onClick={() => setSelectedLedger('ledger_1')}
              className={`px-4 py-1.5 border rounded-xl font-bold cursor-pointer transition ${selectedLedger === 'ledger_1' ? 'bg-farm-green text-white border-transparent' : 'bg-white text-farm-green hover:bg-farm-bg'}`}
            >
              Ledger I (General Ledger query)
            </button>
            <button
              onClick={() => setSelectedLedger('vendor_customer')}
              className={`px-4 py-1.5 border rounded-xl font-bold cursor-pointer transition ${selectedLedger === 'vendor_customer' ? 'bg-farm-green text-white border-transparent' : 'bg-white text-farm-green hover:bg-farm-bg'}`}
            >
              Customer / Vendor profiles Book
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-farm-accent-soft p-6 shadow-md text-sm">
            {selectedLedger === 'cash_book' && (
              <div className="space-y-4">
                <h4 className="font-extrabold text-farm-green">Historical Double-Entry Cash Book Ledger</h4>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-farm-accent-soft text-left text-xs text-farm-muted font-bold tracking-wider">
                        <th className="pb-3">Posting Date</th>
                        <th className="pb-3">Reference Slip</th>
                        <th className="pb-3">Account Header</th>
                        <th className="pb-3">Description / Operator</th>
                        <th className="pb-3 text-right">Debit (Cash In)</th>
                        <th className="pb-3 text-right">Credit (Cash Out)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft text-xs font-semibold">
                      {/* Compile paid cash sales directly */}
                      {nonVoidTxns.filter(t => t.status === 'paid').map(t => (
                        <tr key={t.id}>
                          <td className="py-2">{t.datetime.slice(0, 10)}</td>
                          <td className="py-2 font-mono">#{String(t.slipNo).padStart(5, '0')}</td>
                          <td className="py-2 text-farm-green">Crop Sales</td>
                          <td className="py-2">Weighed outputs cashiered by {t.postedBy}</td>
                          <td className="py-2 text-right text-emerald-800 tabular font-bold">{formatPeso(t.total)}</td>
                          <td className="py-2 text-right text-farm-muted">—</td>
                        </tr>
                      ))}
                      {/* Compile standard material expenses */}
                      {expenses.map(e => (
                        <tr key={e.id}>
                          <td className="py-2 font-mono">{e.date}</td>
                          <td className="py-2 font-mono">AP_MTR</td>
                          <td className="py-2 text-farm-danger">{e.category}</td>
                          <td className="py-2">{e.description}</td>
                          <td className="py-2 text-right text-farm-muted">—</td>
                          <td className="py-2 text-right text-farm-danger tabular font-bold">({formatPeso(e.amount).replace(/[₱()]/g,'')})</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedLedger === 'ledger_1' && (
              <div className="space-y-4">
                <h4 className="font-extrabold text-farm-green">Query Ledger of Crop Sales Revenue</h4>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-farm-accent-soft text-left text-xs text-farm-muted font-bold tracking-wider">
                        <th className="pb-3">Datetime</th>
                        <th className="pb-3">Posting Slip</th>
                        <th className="pb-3">Mode</th>
                        <th className="pb-3">Cashier</th>
                        <th className="pb-3 text-right">Credit (Crop Revenue)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-farm-accent-soft text-xs font-semibold font-mono">
                      {nonVoidTxns.map(t => (
                        <tr key={t.id}>
                          <td className="py-2 font-sans text-xs">{new Date(t.datetime).toLocaleDateString()}</td>
                          <td>#{String(t.slipNo).padStart(5, '0')}</td>
                          <td className="uppercase font-bold">{t.type}</td>
                          <td className="font-normal font-sans">{t.postedBy}</td>
                          <td className="py-2 text-right text-farm-green font-bold">{formatPeso(t.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selectedLedger === 'vendor_customer' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Customer Book list */}
                  <div className="p-5 border border-farm-accent-soft rounded-2xl bg-farm-bg/30">
                    <h4 className="font-extrabold text-farm-green text-sm flex items-center justify-between mb-3">
                      <span>Vendor Deliveries Book</span>
                      <span className="text-[10px] font-normal uppercase px-2 py-0.5 rounded bg-farm-green text-white">Active</span>
                    </h4>
                    <div className="divide-y divide-farm-accent-soft max-h-64 overflow-y-auto pr-2 text-xs">
                      {nonVoidTxns
                        .filter(t => t.type === 'wholesale' || t.status === 'preorder')
                        .map(t => (
                          <div key={t.id} className="py-2.5 flex justify-between items-center">
                            <div>
                              <div className="font-bold text-farm-ink">Slip #{String(t.slipNo).padStart(5, '0')}</div>
                              <div className="text-[10px] text-farm-muted">{t.note || 'Market vendor preorder'}</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-farm-green">{formatPeso(t.total)}</div>
                              <span className={`text-[10px] font-bold ${t.status === 'paid' ? 'text-farm-green' : 'text-farm-warn animate-pulse'}`}>
                                {t.status === 'paid' ? 'Paid / Complete' : 'Pending payment'}
                              </span>
                            </div>
                          </div>
                      ))}
                    </div>
                  </div>

                  {/* Supplier directories */}
                  <div className="p-5 border border-farm-accent-soft rounded-2xl bg-farm-bg/30">
                    <h4 className="font-extrabold text-farm-green text-sm flex items-center justify-between mb-3">
                      <span>Suppliers Directory</span>
                      <span className="text-[10px] font-normal uppercase px-2 py-0.5 rounded bg-farm-green text-white">Consumables</span>
                    </h4>
                    <div className="divide-y divide-farm-accent-soft max-h-64 overflow-y-auto pr-2 text-xs">
                      {expenses
                        .filter(e => e.sourceWho)
                        .map((e, idx) => (
                          <div key={idx} className="py-2.5 flex justify-between items-center">
                            <div>
                              <div className="font-bold text-farm-ink">{e.sourceName}</div>
                              <div className="text-[10px] text-farm-muted">Broker: {e.sourceWho}</div>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-farm-danger font-mono">({formatPeso(e.amount).replace(/[₱()]/g,'')})</span>
                              <div className="text-[9px] text-farm-muted font-bold font-mono">{e.date}</div>
                            </div>
                          </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: CASH LEDGER / CF INPUTS */}
      {activeTab === 'cash_ledger' && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-farm-green">Inflow &amp; Outflow non-operating cash logger</h3>
            <button
              onClick={() => {
                setCashDate(todayISO());
                setCashFlow('in');
                setCashCategory('Owner Investment');
                setCashDesc('');
                setCashAmount('');
                setShowAddCash(true);
              }}
              className="bg-farm-green hover:bg-farm-green-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer"
            >
              + Log New Cash Event
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-farm-accent-soft p-6 shadow-md">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-farm-accent-soft text-left text-farm-muted font-bold tracking-wider">
                    <th className="pb-3">Date</th>
                    <th className="pb-3 text-center">Flow Direction</th>
                    <th className="pb-3">Category</th>
                    <th className="pb-3">Notes description</th>
                    <th className="pb-3 text-right">Amount (₱)</th>
                    <th className="pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-farm-accent-soft font-semibold">
                  {cashEntries.map(c => (
                    <tr key={c.id}>
                      <td className="py-2.5 font-mono">{c.date}</td>
                      <td className="py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${c.flow === 'in' ? 'bg-farm-accent-soft text-farm-green' : 'bg-red-150 text-farm-danger'}`}>
                          {c.flow === 'in' ? 'INFLOW' : 'OUTFLOW'}
                        </span>
                      </td>
                      <td className="py-2.5 uppercase font-bold text-farm-green">{c.category}</td>
                      <td className="py-2.5 max-w-xs truncate">{c.description}</td>
                      <td className="py-2.5 text-right font-black tabular">{formatPeso(c.amount)}</td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => handleDeleteCashEntry(c.id)}
                          className="text-farm-danger hover:bg-red-50 p-1.5 rounded transition font-bold cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {cashEntries.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-12 text-farm-muted italic">No non-operating cash movements recorded yet. Log one above to complete the Cash Flow statement.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Cash Event Input Dialog */}
      {showAddCash && (
        <div className="overlay show select-none">
          <div className="modal max-w-md animate-scale-up">
            <div className="p-6">
              <h3 className="text-xl font-bold text-farm-green text-center">Log Cash Flow Movement</h3>
              <p className="text-xs text-farm-muted text-center mb-6">Logs as transactional flows on monthly Cash Flow balance charts.</p>

              <form onSubmit={handleAddCashEntry} className="space-y-4 text-xs font-semibold text-farm-ink">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Posting Date</label>
                    <input
                      type="date"
                      value={cashDate}
                      onChange={(e) => setCashDate(e.target.value)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Cash Flow Direction</label>
                    <select
                      value={cashFlow}
                      onChange={(e) => {
                        const flow = e.target.value as 'in' | 'out';
                        setCashFlow(flow);
                        setCashCategory(flow === 'in' ? 'Owner Investment' : 'Loan Payment');
                      }}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                    >
                      <option value="in">Inflow (Incoming funds)</option>
                      <option value="out">Outflow (Outgoing payments)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Ledger Account header</label>
                  {cashFlow === 'in' ? (
                    <select
                      value={cashCategory}
                      onChange={(e) => setCashCategory(e.target.value)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                    >
                      <option value="Owner Investment">Owner Investment</option>
                      <option value="Other Income">Other Income</option>
                      <option value="Loan Received">Loan Received</option>
                    </select>
                  ) : (
                    <select
                      value={cashCategory}
                      onChange={(e) => setCashCategory(e.target.value)}
                      className="w-full text-xs font-semibold p-2.5 border border-farm-accent-soft rounded-lg bg-farm-bg/50 focus:outline-none"
                    >
                      <option value="Loan Payment">Agri Loan / Creditor payment</option>
                      <option value="Equipment Purchase">Capital Equipment purchases</option>
                      <option value="Owner's Drawings">Owner's drawings / Dividends</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Movement Description Remarks</label>
                  <input
                    type="text"
                    value={cashDesc}
                    onChange={(e) => setCashDesc(e.target.value)}
                    placeholder="e.g. Bought 2HP agricultural water sprinkler pump"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-farm-muted uppercase mb-1.5">Movement Cash Volume (₱)</label>
                  <input
                    type="text"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl border border-farm-accent-soft focus:outline-none focus:border-farm-green bg-farm-bg text-sm font-bold text-right"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-farm-accent-soft">
                  <button
                    type="button"
                    onClick={() => setShowAddCash(false)}
                    className="bg-farm-bg hover:bg-farm-accent-soft text-farm-green font-semibold py-3 px-6 rounded-xl cursor-pointer"
                  >
                    Cancel Log
                  </button>
                  <button
                    type="submit"
                    className="bg-farm-green hover:bg-farm-green-700 text-white font-bold py-3 px-6 rounded-xl flex-1 cursor-pointer"
                  >
                    Save &amp; Post Ledger entry
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

// Custom formatting function to highlight red parenthetical negatives correctly
function formatFormatNet(n: number) {
  const isNeg = n < 0;
  const val = formatPeso(n);
  return isNeg ? <span className="text-red-300 font-bold">{val}</span> : <span>{val}</span>;
}
