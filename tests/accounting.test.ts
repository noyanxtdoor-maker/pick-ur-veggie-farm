// M4B mock-ledger reconstruction (pure — no IO). Proves the demo/offline approximation is internally consistent:
// balance-sheet identity (Assets = Liabilities + Equity), purchase categorization (utilities/transport/misc ->
// OPERATING_EXPENSES, seeds/substrate/packaging -> RAW_MATERIALS, equipment -> EQUIPMENT), voided cash entries
// excluded, income-statement month bucketing + retail/wholesale split, COGS from line cost snapshots.
// (Server-side balanced-posting correctness is proven by scripts/guards/accounting-security.sql against the real GL.)
import {describe, expect, it} from 'vitest';
import {deriveMockAccountBalances, mockBalanceSheet, mockIncomeStatementMonthly, mockTrialBalance, type MockLedgerInputs} from '../app/features/accounting/mockLedger';
import type {CashEntry, PosInvoice, PurchaseReceiving} from '../app/types/db';

const CO = 'co-1';
const BR = 'br-1';

const cat = (id: string, key: string) => ({id, company_id: CO, category_key: key, name: key, status: 'Active' as const, created_at: '2026-01-01'});
const item = (id: string, categoryId: string, type: 'Consumable' | 'Equipment' = 'Consumable') =>
  ({id, company_id: CO, category_id: categoryId, item_code: id, name: id, inventory_type: type, base_unit: 'pcs', reorder_level: 10, status: 'Active' as const, created_at: '2026-01-01', updated_at: '2026-01-01'});
const receiving = (over: Partial<PurchaseReceiving>): PurchaseReceiving => ({
  id: `r-${Math.random()}`, company_id: CO, branch_id: BR, item_id: 'i-seeds', quantity: 1, total_amount: 100,
  source_type: 'online', source_name: 'Lazada', source_contact: null, received_date: '2026-03-15', created_at: '2026-03-15',
  ...over,
});
const invoice = (over: Partial<PosInvoice>): PosInvoice => ({
  id: `inv-${Math.random()}`, company_id: CO, branch_id: BR, invoice_number: 1, lines: [], subtotal: 100, discount: 0,
  delivery_fee: 0, total: 100, tender_cash: 100, change_amount: 0, note: null, status: 'Paid', created_at: '2026-03-10T10:00:00Z',
  sale_type: 'retail', ...over,
});
const cashEntry = (over: Partial<CashEntry>): CashEntry => ({
  id: `c-${Math.random()}`, company_id: CO, branch_id: BR, entry_date: '2026-03-01', flow: 'in', category: 'Owner Investment',
  description: null, amount: 1000, status: 'Posted', void_reason: null, created_at: '2026-03-01', ...over,
});

const baseCategories = [cat('cat-seeds', 'seeds'), cat('cat-util', 'utilities'), cat('cat-equip', 'equipment')];
const baseItems = [item('i-seeds', 'cat-seeds'), item('i-util', 'cat-util'), item('i-pump', 'cat-equip', 'Equipment')];

function inputs(over: Partial<MockLedgerInputs>): MockLedgerInputs {
  return {invoices: [], receivings: [], items: baseItems, categories: baseCategories, cashEntries: [], finishedGoods: [], ...over};
}

describe('deriveMockAccountBalances', () => {
  it('routes purchases by category: seeds->RAW_MATERIALS, utilities->OPERATING_EXPENSES, equipment->EQUIPMENT', () => {
    const b = deriveMockAccountBalances(inputs({
      receivings: [
        receiving({item_id: 'i-seeds', total_amount: 500}),
        receiving({item_id: 'i-util', total_amount: 200}),
        receiving({item_id: 'i-pump', total_amount: 3500}),
      ],
    }));
    expect(b.RAW_MATERIALS).toBe(500);
    expect(b.OPERATING_EXPENSES).toBe(200);
    expect(b.EQUIPMENT).toBe(3500);
    expect(b.CASH).toBe(-4200); // purchases are cash-paid, no sales yet
  });

  it('excludes Voided invoices from SALES/COGS/AR/CASH', () => {
    const b = deriveMockAccountBalances(inputs({
      invoices: [
        invoice({status: 'Paid', total: 300, tender_cash: 300, change_amount: 0, lines: [{product_id: 'p', finished_goods_batch_id: 'fg', name: 'x', weight_kg: 2, unit_price: 150, line_total: 300, cost_per_unit: 50}]}),
        invoice({status: 'Voided', total: 999, tender_cash: 999, change_amount: 0}),
      ],
    }));
    expect(b.SALES).toBe(300);
    expect(b.COGS).toBe(100); // 2kg * 50
    expect(b.CASH).toBe(300);
  });

  it('AR reflects only Unpaid invoices', () => {
    const b = deriveMockAccountBalances(inputs({
      invoices: [invoice({status: 'Unpaid', total: 263, tender_cash: 0, change_amount: 0}), invoice({status: 'Paid', total: 100})],
    }));
    expect(b.AR).toBe(263);
  });

  it('excludes Voided cash entries from equity/liability accounts', () => {
    const b = deriveMockAccountBalances(inputs({
      cashEntries: [
        cashEntry({category: 'Owner Investment', amount: 5000, status: 'Posted'}),
        cashEntry({category: 'Owner Investment', amount: 999, status: 'Voided'}),
        cashEntry({flow: 'out', category: "Owner's Drawings", amount: 500, status: 'Posted'}),
      ],
    }));
    expect(b.OWNER_EQUITY).toBe(4500); // 5000 - 500, the voided 999 excluded
  });

  it('FG_INVENTORY values current stock at cost', () => {
    const b = deriveMockAccountBalances(inputs({finishedGoods: [{available: 10, cost_per_unit: 40}, {available: 5, cost_per_unit: 20}]}));
    expect(b.FG_INVENTORY).toBe(500); // 10*40 + 5*20
  });
});

describe('mockBalanceSheet', () => {
  it('ties out: Assets = Liabilities + Equity', () => {
    const bs = mockBalanceSheet(inputs({
      invoices: [invoice({status: 'Paid', total: 300, tender_cash: 300, lines: [{product_id: 'p', finished_goods_batch_id: 'fg', name: 'x', weight_kg: 2, unit_price: 150, line_total: 300, cost_per_unit: 50}]})],
      receivings: [receiving({item_id: 'i-seeds', total_amount: 100})],
      cashEntries: [cashEntry({category: 'Owner Investment', amount: 5000}), cashEntry({flow: 'in', category: 'Loan Received', amount: 2000})],
      finishedGoods: [{available: 8, cost_per_unit: 50}],
    }));
    expect(Math.round((bs.total_assets - (bs.total_liabilities + bs.total_equity)) * 100)).toBe(0);
  });

  it('ties out with non-zero Owner\'s Drawings (regression: total_equity must not subtract drawings twice)', () => {
    const bs = mockBalanceSheet(inputs({
      invoices: [invoice({status: 'Paid', total: 300, tender_cash: 300, lines: [{product_id: 'p', finished_goods_batch_id: 'fg', name: 'x', weight_kg: 2, unit_price: 150, line_total: 300, cost_per_unit: 50}]})],
      receivings: [receiving({item_id: 'i-util', total_amount: 150})], // utilities -> OPERATING_EXPENSES, an expense not an asset
      cashEntries: [
        cashEntry({category: 'Owner Investment', amount: 5000}),
        cashEntry({flow: 'out', category: "Owner's Drawings", amount: 1000}),
      ],
      finishedGoods: [{available: 8, cost_per_unit: 50}],
    }));
    // owner_investment(5000 cash + 400 fg [8*50] + 100 cogs = 5500) - drawings(1000) + retained_earnings(300-100-150=50) = 4550
    expect(bs.owner_investment).toBe(5500);
    expect(bs.retained_earnings).toBe(50);
    expect(bs.total_equity).toBe(4550);
    expect(Math.round((bs.total_assets - (bs.total_liabilities + bs.total_equity)) * 100)).toBe(0);
  });
});

describe('mockTrialBalance', () => {
  it('every row is one-sided per its normal balance', () => {
    const rows = mockTrialBalance(inputs({cashEntries: [cashEntry({category: 'Owner Investment', amount: 1000})]}));
    const equityRow = rows.find((r) => r.account_code === 'OWNER_EQUITY')!;
    expect(equityRow.total_credit).toBe(1000);
    expect(equityRow.total_debit).toBe(0);
  });
});

describe('mockIncomeStatementMonthly', () => {
  it('buckets by month and splits retail vs wholesale', () => {
    const rows = mockIncomeStatementMonthly(inputs({
      invoices: [
        invoice({created_at: '2026-03-10T10:00:00Z', sale_type: 'retail', total: 270}),
        invoice({created_at: '2026-03-20T10:00:00Z', sale_type: 'wholesale', total: 500}),
        invoice({created_at: '2026-04-01T10:00:00Z', sale_type: 'retail', total: 90}),
      ],
    }), 2026);
    const march = rows.find((r) => r.month_num === 3)!;
    const april = rows.find((r) => r.month_num === 4)!;
    expect(march.retail_revenue).toBe(270);
    expect(march.wholesale_revenue).toBe(500);
    expect(march.total_revenue).toBe(770);
    expect(april.retail_revenue).toBe(90);
    expect(rows.filter((r) => r.total_revenue === 0)).toHaveLength(10);
  });

  it('routes month-scoped purchases to operating expenses only for the expense categories', () => {
    const rows = mockIncomeStatementMonthly(inputs({
      receivings: [receiving({item_id: 'i-util', total_amount: 300, received_date: '2026-05-05'}), receiving({item_id: 'i-seeds', total_amount: 400, received_date: '2026-05-06'})],
    }), 2026);
    const may = rows.find((r) => r.month_num === 5)!;
    expect(may.operating_expenses).toBe(300); // seeds purchase doesn't hit opex
    expect(may.net_income).toBe(-300);
  });
});
