// M5B payroll seam (mock mode): hire, cash advance, wage disbursement (gross = days × rate, net after deduction),
// derived advance balance, and — critically — that payroll flows into the mock accounting reconstruction so the
// balance sheet still ties (Assets = Liabilities + Equity). Server-side balanced-posting is proven by
// scripts/guards/payroll-security.sql; this covers the client seam + the mock-ledger integration.
import 'fake-indexeddb/auto';
import {describe, expect, it, beforeAll} from 'vitest';
import {DEMO, seedMockData} from '@/app/core/mock/mock';
import {payrollApi} from '@/app/features/payroll/api';
import {offlineDB} from '@/app/core/offline/db';
import {mockBalanceSheet, mockIncomeStatementMonthly, type MockLedgerInputs} from '@/app/features/accounting/mockLedger';

async function ledgerInputs(): Promise<MockLedgerInputs> {
  return {
    invoices: await offlineDB.posInvoices.where('company_id').equals(DEMO.companyId).toArray(),
    receivings: await offlineDB.purchaseReceivings.where('company_id').equals(DEMO.companyId).toArray(),
    items: await offlineDB.inventoryItems.where('company_id').equals(DEMO.companyId).toArray(),
    categories: await offlineDB.itemCategories.where('company_id').equals(DEMO.companyId).toArray(),
    cashEntries: await offlineDB.cashEntries.where('company_id').equals(DEMO.companyId).toArray(),
    finishedGoods: await offlineDB.finishedGoods.where('company_id').equals(DEMO.companyId).toArray(),
    cashAdvances: await offlineDB.cashAdvances.where('company_id').equals(DEMO.companyId).toArray(),
    wagePayments: await offlineDB.wagePayments.where('company_id').equals(DEMO.companyId).toArray(),
  };
}

describe('payroll (mock mode)', () => {
  beforeAll(async () => {
    await seedMockData();
  });

  it('hires a worker and starts with a cleared advance balance', async () => {
    await payrollApi.hire(DEMO.companyId, {name: 'Juan Dela Cruz', positionId: 'pos-harvester-fixture', dailyRate: 500});
    const emps = await payrollApi.fetchEmployees(DEMO.companyId);
    const juan = emps.find((e) => e.name === 'Juan Dela Cruz')!;
    expect(juan.daily_rate).toBe(500);
    expect(juan.status).toBe('Active');
    expect(juan.advance_balance).toBe(0);
  });

  it('records a cash advance → outstanding balance rises', async () => {
    const juan = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.name === 'Juan Dela Cruz')!;
    await payrollApi.recordAdvance(DEMO.companyId, DEMO.branchA, juan, 500, 'medicine');
    const after = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.id === juan.id)!;
    expect(after.advance_balance).toBe(500);
  });

  it('disburses a wage: gross = days × rate, net after deduction; balance falls by the deduction', async () => {
    const juan = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.name === 'Juan Dela Cruz')!;
    await payrollApi.disburseWage(DEMO.companyId, DEMO.branchA, juan, 'July 1-7', 2, 300, 'harvest');
    const wages = await payrollApi.fetchWages(DEMO.companyId, DEMO.branchA);
    const w = wages.find((x) => x.employee_id === juan.id)!;
    expect(w.gross).toBe(1000); // 2 × 500
    expect(w.ca_deducted).toBe(300);
    expect(w.net).toBe(700);
    const after = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.id === juan.id)!;
    expect(after.advance_balance).toBe(200); // 500 − 300
  });

  it('rejects deduction beyond the outstanding advance and beyond gross', async () => {
    const juan = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.name === 'Juan Dela Cruz')!;
    await expect(payrollApi.disburseWage(DEMO.companyId, DEMO.branchA, juan, 'x', 1, 300, '')).rejects.toThrow(/outstanding advance/i);
    await expect(payrollApi.disburseWage(DEMO.companyId, DEMO.branchA, juan, 'x', 1, 9999, '')).rejects.toThrow(/gross/i);
  });

  it('rejects advances to an inactive worker', async () => {
    await payrollApi.hire(DEMO.companyId, {name: 'Temp Worker', positionId: 'pos-packer-fixture', dailyRate: 450});
    let temp = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.name === 'Temp Worker')!;
    await payrollApi.setActive(temp, false);
    temp = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.id === temp.id)!;
    expect(temp.status).toBe('Inactive');
    await expect(payrollApi.recordAdvance(DEMO.companyId, DEMO.branchA, temp, 100, 'x')).rejects.toThrow(/not active/i);
  });

  it('links / unlinks an app user to a staff record (M5C self-visibility seam)', async () => {
    const juan = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.name === 'Juan Dela Cruz')!;
    expect(juan.user_id ?? null).toBeNull();
    await payrollApi.linkEmployeeUser(juan, DEMO.userId);
    let after = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.id === juan.id)!;
    expect(after.user_id).toBe(DEMO.userId);
    await payrollApi.linkEmployeeUser(after, null);
    after = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.id === juan.id)!;
    expect(after.user_id ?? null).toBeNull();
  });

  it('fetches ONE employee’s advances/wages for the My Payroll view (M5C)', async () => {
    const juan = (await payrollApi.fetchEmployees(DEMO.companyId)).find((e) => e.name === 'Juan Dela Cruz')!;
    const advs = await payrollApi.fetchEmployeeAdvances(DEMO.companyId, juan.id);
    const wages = await payrollApi.fetchEmployeeWages(DEMO.companyId, juan.id);
    expect(advs.length).toBeGreaterThanOrEqual(1);
    expect(advs.every((a) => a.employee_id === juan.id)).toBe(true);
    expect(wages.length).toBeGreaterThanOrEqual(1);
    expect(wages.every((w) => w.employee_id === juan.id)).toBe(true);
  });

  it('payroll flows into the mock accounting: wages hit OpEx and the balance sheet still ties', async () => {
    const inputs = await ledgerInputs();
    const bs = mockBalanceSheet(inputs);
    // advances outstanding 200 shows as an asset; balance sheet ties
    expect(bs.employee_advances).toBe(200);
    expect(Math.round((bs.total_assets - (bs.total_liabilities + bs.total_equity)) * 100)).toBe(0);
    // the ₱1000 gross wage lands in this month's operating expenses
    const now = new Date();
    const rows = mockIncomeStatementMonthly(inputs, now.getFullYear());
    const thisMonth = rows.find((r) => r.month_num === now.getMonth() + 1)!;
    expect(thisMonth.operating_expenses).toBeGreaterThanOrEqual(1000);
  });
});
