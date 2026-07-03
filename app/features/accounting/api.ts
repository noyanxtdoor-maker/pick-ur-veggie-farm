// Accounting data-access (M1B A1 seam; spec Phase_2_M4_Accounting_Module_Spec.md). Cash-entry writes: MOCK ->
// Dexie; real+online -> governed rpc; real+offline -> outbox-queued (B5). Statement READS: MOCK -> recomputed
// from local caches (mockLedger.ts, demo-only approximation); real -> the audited GL-truth SQL functions
// (requires connectivity — back-office reporting is not part of B5's offline write guarantee).
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE} from '../../core/mock/mock';
import {round2} from '../pos/money';
import {deriveMockAccountBalances, mockBalanceSheet, mockIncomeStatementMonthly, mockTrialBalance} from './mockLedger';
import type {BalanceSheet, CashEntry, CashEntryCategory, CashFlowDirection, IncomeStatementMonth, TrialBalanceRow} from '../../types/db';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

async function mockInputs(companyId: string, branchId?: string) {
  const [invoices, receivings, items, categories, cashEntries, finishedGoods, cashAdvances, wagePayments] = await Promise.all([
    offlineDB.posInvoices.where('company_id').equals(companyId).toArray(),
    offlineDB.purchaseReceivings.where('company_id').equals(companyId).toArray(),
    offlineDB.inventoryItems.where('company_id').equals(companyId).toArray(),
    offlineDB.itemCategories.where('company_id').equals(companyId).toArray(),
    offlineDB.cashEntries.where('company_id').equals(companyId).toArray(),
    offlineDB.finishedGoods.where('company_id').equals(companyId).toArray(),
    offlineDB.cashAdvances.where('company_id').equals(companyId).toArray(),
    offlineDB.wagePayments.where('company_id').equals(companyId).toArray(),
  ]);
  const scope = (branchId: string | undefined) => <T extends {branch_id: string}>(rows: T[]) => (branchId ? rows.filter((r) => r.branch_id === branchId) : rows);
  const s = scope(branchId);
  return {invoices: s(invoices), receivings: s(receivings), items, categories, cashEntries: s(cashEntries), finishedGoods: s(finishedGoods), cashAdvances: s(cashAdvances), wagePayments: s(wagePayments)};
}

export const accountingApi = {
  async fetchCashEntries(companyId: string, branchId: string): Promise<CashEntry[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.cashEntries.where('company_id').equals(companyId).filter((c) => c.branch_id === branchId).toArray();
      return rows.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
    }
    const {data, error} = await supabase.from('cash_entries').select('*').eq('company_id', companyId).eq('branch_id', branchId).order('entry_date', {ascending: false}).limit(300);
    if (error) throw new Error(error.message);
    return ((data ?? []) as CashEntry[]).map((c) => ({...c, amount: Number(c.amount)}));
  },

  async recordCashEntry(companyId: string, branchId: string, entryDate: string, flow: CashFlowDirection, category: CashEntryCategory, description: string, amount: number): Promise<void> {
    if (!(amount > 0)) throw new Error('Amount must be greater than ₱0.');
    const idem = uuidv7();
    if (MOCK_MODE) {
      await offlineDB.cashEntries.put({
        id: idem, company_id: companyId, branch_id: branchId, entry_date: entryDate, flow, category,
        description: description.trim() || null, amount: round2(amount), status: 'Posted', void_reason: null,
        created_at: new Date().toISOString(),
      });
      return;
    }
    const payload = {p_branch_id: branchId, p_entry_date: entryDate, p_flow: flow, p_category: category, p_description: description.trim() || null, p_amount: round2(amount), p_idempotency_key: idem};
    if (online()) {
      const {error} = await supabase.rpc('record_cash_entry', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'accounting.cash_entry', request: {type: 'rpc', rpc: 'record_cash_entry', payload}});
  },

  async voidCashEntry(companyId: string, entry: CashEntry, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error('A void reason is required.');
    if (MOCK_MODE) {
      await offlineDB.cashEntries.put({...entry, status: 'Voided', void_reason: reason.trim()});
      return;
    }
    const payload = {p_cash_entry_id: entry.id, p_reason: reason.trim()};
    if (online()) {
      const {error} = await supabase.rpc('void_cash_entry', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'accounting.void_cash_entry', request: {type: 'rpc', rpc: 'void_cash_entry', payload}});
  },

  async trialBalance(companyId: string, branchId?: string): Promise<TrialBalanceRow[]> {
    if (MOCK_MODE) return mockTrialBalance(await mockInputs(companyId, branchId));
    const {data, error} = await supabase.rpc('trial_balance', {p_company: companyId, p_branch_id: branchId ?? null});
    if (error) throw new Error(error.message);
    return ((data ?? []) as TrialBalanceRow[]).map((r) => ({...r, total_debit: Number(r.total_debit), total_credit: Number(r.total_credit)}));
  },

  async incomeStatementMonthly(companyId: string, year: number, branchId?: string): Promise<IncomeStatementMonth[]> {
    if (MOCK_MODE) return mockIncomeStatementMonthly(await mockInputs(companyId, branchId), year);
    const {data, error} = await supabase.rpc('income_statement_monthly', {p_company: companyId, p_branch_id: branchId ?? null, p_year: year});
    if (error) throw new Error(error.message);
    return ((data ?? []) as IncomeStatementMonth[]).map((r) => ({
      ...r, retail_revenue: Number(r.retail_revenue), wholesale_revenue: Number(r.wholesale_revenue), total_revenue: Number(r.total_revenue),
      cogs: Number(r.cogs), gross_profit: Number(r.gross_profit), shrinkage: Number(r.shrinkage),
      operating_expenses: Number(r.operating_expenses), total_opex: Number(r.total_opex), net_income: Number(r.net_income),
    }));
  },

  async balanceSheet(companyId: string, branchId?: string): Promise<BalanceSheet> {
    if (MOCK_MODE) return mockBalanceSheet(await mockInputs(companyId, branchId));
    const {data, error} = await supabase.rpc('balance_sheet', {p_company: companyId, p_branch_id: branchId ?? null});
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!row) throw new Error('No balance sheet data returned.');
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as unknown as BalanceSheet;
  },

  // internal export for tests only
  _deriveMockAccountBalances: deriveMockAccountBalances,
};
