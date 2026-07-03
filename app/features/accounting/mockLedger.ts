// Mock/offline-device ledger reconstruction (P2-M4A). MOCK MODE has no real Postgres GL to query, so these pure
// functions recompute the SAME figures the SQL functions (trial_balance/income_statement_monthly/balance_sheet)
// derive from journal_lines — from the other local Dexie caches that already exist (posInvoices, purchaseReceivings,
// finishedGoods, cashEntries). This is a DEMO-ONLY approximation for the offline/no-cloud device view; the audited
// source of truth is the real GL, proven balanced by scripts/guards/accounting-security.sql. Mock SHRINKAGE is
// always 0 — mock-mode inventory adjustments don't track a cost basis (recorded limitation, not silently faked).
import {round2} from '../pos/money';
import type {CashAdvance, InventoryItem, ItemCategory, PosInvoice, PurchaseReceiving, WagePayment} from '../../types/db';
import type {BalanceSheet, CashEntry, CashFlowLine, IncomeStatementMonth, TrialBalanceRow} from '../../types/db';

export interface MockLedgerInputs {
  invoices: PosInvoice[];
  receivings: PurchaseReceiving[];
  items: Array<Omit<InventoryItem, 'available'>>;
  categories: ItemCategory[];
  cashEntries: CashEntry[];
  finishedGoods: Array<{available: number; cost_per_unit: number}>;
  cashAdvances: CashAdvance[]; // P2-M5A
  wagePayments: WagePayment[]; // P2-M5A
}

const EXPENSE_CATEGORY_KEYS = new Set(['utilities', 'transport', 'misc']);

function purchaseAccount(r: PurchaseReceiving, items: Map<string, Omit<InventoryItem, 'available'>>, categories: Map<string, ItemCategory>): 'RAW_MATERIALS' | 'OPERATING_EXPENSES' | 'EQUIPMENT' {
  const item = items.get(r.item_id);
  if (item?.inventory_type === 'Equipment') return 'EQUIPMENT';
  const cat = item ? categories.get(item.category_id) : undefined;
  return cat && EXPENSE_CATEGORY_KEYS.has(cat.category_key) ? 'OPERATING_EXPENSES' : 'RAW_MATERIALS';
}

const sum = (rows: Array<{amount: number}>) => round2(rows.reduce((s, r) => s + r.amount, 0));

// Account balances as of "now" (mock has no historical as-of-date filter — the whole local cache is "current").
export function deriveMockAccountBalances(input: MockLedgerInputs): Record<string, number> {
  const live = input.invoices.filter((i) => i.status === 'Paid' || i.status === 'Unpaid');
  const paid = input.invoices.filter((i) => i.status === 'Paid');
  const unpaid = input.invoices.filter((i) => i.status === 'Unpaid');
  const itemsById = new Map(input.items.map((i) => [i.id, i]));
  const categoriesById = new Map(input.categories.map((c) => [c.id, c]));
  const posted = input.cashEntries.filter((c) => c.status === 'Posted');
  const byCat = (cat: CashEntry['category']) => sum(posted.filter((c) => c.category === cat));

  const cashFromSales = round2(paid.reduce((s, i) => s + i.tender_cash - i.change_amount, 0));
  const cashFromPurchases = round2(input.receivings.reduce((s, r) => s + r.total_amount, 0));
  const cashIn = round2(byCat('Owner Investment') + byCat('Other Income') + byCat('Loan Received'));
  const cashOut = round2(byCat('Loan Payment') + byCat("Owner's Drawings"));

  let rawMaterials = 0, operatingExpenses = 0, equipment = 0;
  for (const r of input.receivings) {
    const acct = purchaseAccount(r, itemsById, categoriesById);
    if (acct === 'RAW_MATERIALS') rawMaterials = round2(rawMaterials + r.total_amount);
    else if (acct === 'OPERATING_EXPENSES') operatingExpenses = round2(operatingExpenses + r.total_amount);
    else equipment = round2(equipment + r.total_amount);
  }

  const sales = round2(live.reduce((s, i) => s + i.total, 0));
  const cogs = round2(live.reduce((s, i) => s + i.lines.reduce((ls, l) => ls + (l.weight_kg ?? 0) * (l.cost_per_unit ?? 0), 0), 0));
  const fgInventory = round2(input.finishedGoods.reduce((s, f) => s + f.available * f.cost_per_unit, 0));
  const ar = round2(unpaid.reduce((s, i) => s + i.total, 0));

  // P2-M5A payroll: advance = Dr Employee Advances/Cr Cash; wage = Dr Wages/Cr Cash(net)/Cr Employee Advances(ded).
  const advTotal = round2(input.cashAdvances.reduce((s, a) => s + a.amount, 0));
  const wagesGross = round2(input.wagePayments.reduce((s, w) => s + w.gross, 0));
  const wagesNet = round2(input.wagePayments.reduce((s, w) => s + w.net, 0));
  const wagesDeducted = round2(input.wagePayments.reduce((s, w) => s + w.ca_deducted, 0));
  const employeeAdvances = round2(advTotal - wagesDeducted); // outstanding = Σ advances − Σ deductions
  const payrollCashOut = round2(advTotal + wagesNet);

  return {
    CASH: round2(cashFromSales - cashFromPurchases + cashIn - cashOut - payrollCashOut),
    AR: ar,
    RAW_MATERIALS: rawMaterials,
    FG_INVENTORY: fgInventory,
    EQUIPMENT: equipment,
    EMPLOYEE_ADVANCES: employeeAdvances,
    SALES: sales,
    COGS: cogs,
    SHRINKAGE: 0, // ponytail: mock adjustments carry no cost basis; add if mock-mode audit fidelity is ever required
    OPERATING_EXPENSES: operatingExpenses,
    WAGES_EXPENSE: wagesGross,
    // spec §3.1 parity: opening finished-goods stock is a capital contribution in kind (Cr OWNER_EQUITY server-side)
    // for the ORIGINAL opening qty×cost — COGS releases only ever debit FG_INVENTORY, never OWNER_EQUITY, so the
    // original contribution = current remaining value + everything already released as COGS (every mock FG batch
    // is opening-origin; no other stock-creation path exists yet in the app).
    OWNER_EQUITY: round2(byCat('Owner Investment') - byCat("Owner's Drawings") + fgInventory + cogs),
    LOANS_PAYABLE: round2(byCat('Loan Received') - byCat('Loan Payment')),
    OTHER_INCOME: byCat('Other Income'),
  };
}

const COA_META: Array<{code: string; name: string; type: TrialBalanceRow['account_type']; normal: 'debit' | 'credit'}> = [
  {code: 'CASH', name: 'Cash on Hand', type: 'Asset', normal: 'debit'},
  {code: 'AR', name: 'Accounts Receivable', type: 'Asset', normal: 'debit'},
  {code: 'RAW_MATERIALS', name: 'Raw Materials Inventory', type: 'Asset', normal: 'debit'},
  {code: 'FG_INVENTORY', name: 'Finished Goods Inventory', type: 'Asset', normal: 'debit'},
  {code: 'EQUIPMENT', name: 'Equipment Assets', type: 'Asset', normal: 'debit'},
  {code: 'LOANS_PAYABLE', name: 'Loans Payable', type: 'Liability', normal: 'credit'},
  {code: 'OWNER_EQUITY', name: "Owner's Equity", type: 'Equity', normal: 'credit'},
  {code: 'SALES', name: 'Sales Revenue', type: 'Revenue', normal: 'credit'},
  {code: 'OTHER_INCOME', name: 'Other Income', type: 'Revenue', normal: 'credit'},
  {code: 'COGS', name: 'Cost of Goods Sold', type: 'Expense', normal: 'debit'},
  {code: 'SHRINKAGE', name: 'Inventory Shrinkage', type: 'Expense', normal: 'debit'},
  {code: 'OPERATING_EXPENSES', name: 'Operating Expenses', type: 'Expense', normal: 'debit'},
  {code: 'WAGES_EXPENSE', name: 'Labor & Wages Expense', type: 'Expense', normal: 'debit'},
  {code: 'EMPLOYEE_ADVANCES', name: 'Employee Cash Advances', type: 'Asset', normal: 'debit'},
];

export function mockTrialBalance(input: MockLedgerInputs): TrialBalanceRow[] {
  const bal = deriveMockAccountBalances(input);
  return COA_META.map((m) => {
    const v = bal[m.code] ?? 0;
    // debit-normal accounts hold their balance as a debit total; credit-normal as a credit total (mirrors the SQL
    // trial_balance, which sums raw debit/credit columns — this reconstruction only has the NET, so it renders as
    // one-sided per account, which is the correct trial-balance presentation for a net-balance view).
    return {
      account_code: m.code, account_name: m.name, account_type: m.type, normal_balance: m.normal,
      total_debit: m.normal === 'debit' ? Math.max(0, v) : Math.max(0, -v),
      total_credit: m.normal === 'credit' ? Math.max(0, v) : Math.max(0, -v),
    };
  });
}

export function mockBalanceSheet(input: MockLedgerInputs): BalanceSheet {
  const b = deriveMockAccountBalances(input);
  const totalAssets = round2(b.CASH! + b.AR! + b.RAW_MATERIALS! + b.FG_INVENTORY! + b.EQUIPMENT! + b.EMPLOYEE_ADVANCES!);
  const netIncomeCum = round2(b.SALES! + b.OTHER_INCOME! - b.COGS! - b.SHRINKAGE! - b.OPERATING_EXPENSES! - b.WAGES_EXPENSE!);
  const posted = input.cashEntries.filter((c) => c.status === 'Posted');
  // opening finished-goods value (current + already-released-as-COGS) is folded into the displayed Owner
  // Investment figure — see the OWNER_EQUITY comment in deriveMockAccountBalances (spec §3.1 parity).
  const investment = round2(sum(posted.filter((c) => c.category === 'Owner Investment')) + b.FG_INVENTORY! + b.COGS!);
  const drawings = sum(posted.filter((c) => c.category === "Owner's Drawings"));
  // Retained Earnings is PURE net income here — Drawings is subtracted exactly once, in total_equity below, never
  // inside retained earnings too (a prior version double-subtracted it; only visible once drawings is non-zero).
  return {
    cash: b.CASH!, accounts_receivable: b.AR!, raw_materials: b.RAW_MATERIALS!, finished_goods: b.FG_INVENTORY!, equipment: b.EQUIPMENT!,
    employee_advances: b.EMPLOYEE_ADVANCES!, total_assets: totalAssets,
    loans_payable: b.LOANS_PAYABLE!, total_liabilities: b.LOANS_PAYABLE!,
    owner_investment: investment, owners_drawings: drawings, retained_earnings: netIncomeCum,
    total_equity: round2(investment - drawings + netIncomeCum),
  };
}

// Statement of Cash Flows (P2-M4D) — mirrors the SQL cash_flow_statement classification, reconstructed from the
// same raw caches. Mock is all-time (no as-of/year filter, like the balances above), so Opening = 0 and Closing =
// the derived CASH balance. Ties by construction: Operating + Investing + Financing = Closing (verified in tests).
export function mockCashFlowStatement(input: MockLedgerInputs): CashFlowLine[] {
  const itemsById = new Map(input.items.map((i) => [i.id, i]));
  const categoriesById = new Map(input.categories.map((c) => [c.id, c]));
  const posted = input.cashEntries.filter((c) => c.status === 'Posted');
  const byCat = (cat: CashEntry['category']) => sum(posted.filter((c) => c.category === cat));

  const receiptsFromCustomers = round2(input.invoices.filter((i) => i.status === 'Paid').reduce((s, i) => s + i.tender_cash - i.change_amount, 0));
  let supplierCash = 0, equipmentCash = 0;
  for (const r of input.receivings) {
    if (purchaseAccount(r, itemsById, categoriesById) === 'EQUIPMENT') equipmentCash = round2(equipmentCash + r.total_amount);
    else supplierCash = round2(supplierCash + r.total_amount);
  }
  const payrollCashOut = round2(input.cashAdvances.reduce((s, a) => s + a.amount, 0) + input.wagePayments.reduce((s, w) => s + w.net, 0));
  const ownerNet = round2(byCat('Owner Investment') - byCat("Owner's Drawings"));
  const loanNet = round2(byCat('Loan Received') - byCat('Loan Payment'));

  const operating = round2(receiptsFromCustomers - supplierCash - payrollCashOut + byCat('Other Income'));
  const investing = round2(-equipmentCash);
  const financing = round2(ownerNet + loanNet);
  const net = round2(operating + investing + financing);

  const lines: CashFlowLine[] = [];
  const push = (activity: CashFlowLine['activity'], line_label: string, amount: number, sort_order: number) => {
    if (round2(amount) !== 0) lines.push({activity, line_label, amount: round2(amount), sort_order});
  };
  push('Operating', 'Receipts from customers', receiptsFromCustomers, 1);
  push('Operating', 'Payments to suppliers', -supplierCash, 1);
  push('Operating', 'Payments to employees', -payrollCashOut, 1);
  push('Operating', 'Other operating receipts', byCat('Other Income'), 1);
  push('Investing', 'Equipment purchases', -equipmentCash, 2);
  push('Financing', 'Owner investment / drawings', ownerNet, 3);
  push('Financing', 'Loan proceeds / repayments', loanNet, 3);
  lines.push({activity: 'Reconciliation', line_label: 'Opening cash balance', amount: 0, sort_order: 10});
  lines.push({activity: 'Reconciliation', line_label: 'Closing cash balance', amount: net, sort_order: 11});
  return lines;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function mockIncomeStatementMonthly(input: MockLedgerInputs, year: number): IncomeStatementMonth[] {
  const itemsById = new Map(input.items.map((i) => [i.id, i]));
  const categoriesById = new Map(input.categories.map((c) => [c.id, c]));
  const live = input.invoices.filter((i) => (i.status === 'Paid' || i.status === 'Unpaid') && new Date(i.created_at).getFullYear() === year);
  const yearReceivings = input.receivings.filter((r) => new Date(r.received_date).getFullYear() === year);
  const yearWages = input.wagePayments.filter((w) => new Date(w.created_at).getFullYear() === year);

  return Array.from({length: 12}, (_, idx) => {
    const mo = idx + 1;
    const monthInvoices = live.filter((i) => new Date(i.created_at).getMonth() + 1 === mo);
    const retailRevenue = round2(monthInvoices.filter((i) => (i.sale_type ?? 'retail') === 'retail').reduce((s, i) => s + i.total, 0));
    const wholesaleRevenue = round2(monthInvoices.filter((i) => i.sale_type === 'wholesale').reduce((s, i) => s + i.total, 0));
    const cogs = round2(monthInvoices.reduce((s, i) => s + i.lines.reduce((ls, l) => ls + (l.weight_kg ?? 0) * (l.cost_per_unit ?? 0), 0), 0));

    const monthReceivings = yearReceivings.filter((r) => new Date(r.received_date).getMonth() + 1 === mo);
    let operatingExpenses = 0;
    for (const r of monthReceivings) {
      if (purchaseAccount(r, itemsById, categoriesById) === 'OPERATING_EXPENSES') operatingExpenses = round2(operatingExpenses + r.total_amount);
    }
    // P2-M5A: wages fold into OpEx (matches income_statement_monthly), bucketed by disbursement month
    operatingExpenses = round2(operatingExpenses + yearWages.filter((w) => new Date(w.created_at).getMonth() + 1 === mo).reduce((s, w) => s + w.gross, 0));
    const shrinkage = 0; // mock adjustments carry no cost basis (see deriveMockAccountBalances note)

    const totalRevenue = round2(retailRevenue + wholesaleRevenue);
    const grossProfit = round2(totalRevenue - cogs);
    const totalOpex = round2(shrinkage + operatingExpenses);
    return {
      month_num: mo, month_name: MONTH_NAMES[idx]!,
      retail_revenue: retailRevenue, wholesale_revenue: wholesaleRevenue, total_revenue: totalRevenue,
      cogs, gross_profit: grossProfit,
      shrinkage, operating_expenses: operatingExpenses, total_opex: totalOpex,
      net_income: round2(grossProfit - totalOpex),
    };
  });
}
