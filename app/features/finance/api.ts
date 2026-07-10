// Digital-payments data access (P2-B2A / backlog B2; spec Phase_2_B2_Digital_Payments_Reconciliation_Spec.md).
// financial_accounts is a thin registry keyed to a COA Asset code — balances are ALWAYS derived, never stored
// (20.24). MOCK/offline derive from paid local invoices + local transfers; online reads the server's
// journal-derived financial_account_balances(). All writes are governed RPCs (finance.account.manage RLS).
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE} from '../../core/mock/mock';
import type {FinancialAccount, FinancialTransfer} from '../../types/db';

const online = () => typeof navigator === 'undefined' || navigator.onLine;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface AccountWithBalance extends FinancialAccount {
  balance: number;
}

export interface AccountInput {
  name: string;
  account_type: FinancialAccount['account_type'];
  coa_code: string;
  provider?: string | null;
  account_number?: string | null;
}

// Derive balances from the local cache: paid invoices land in their account (null = the CASH drawer row),
// transfers move between accounts. Mirrors the server's journal-derived sum for the flows the app performs.
async function deriveLocalBalances(companyId: string, accounts: FinancialAccount[]): Promise<AccountWithBalance[]> {
  const invoices = await offlineDB.posInvoices.where('company_id').equals(companyId).toArray();
  const transfers = await offlineDB.financialTransfers.where('company_id').equals(companyId).toArray();
  return accounts.map((a) => {
    const isCashRow = a.coa_code === 'CASH';
    let bal = 0;
    for (const inv of invoices) {
      if (inv.status !== 'Paid' || inv.branch_id !== a.branch_id) continue;
      const target = inv.financial_account_id ?? null;
      if ((isCashRow && target === null) || target === a.id) bal += inv.total;
    }
    for (const t of transfers) {
      if (t.to_account_id === a.id) bal += t.amount;
      if (t.from_account_id === a.id) bal -= t.amount;
    }
    return {...a, balance: round2(bal)};
  });
}

export const paymentsApi = {
  // Registry + derived balances. Server: financial_account_balances (finance.account.read).
  async fetchAccounts(companyId: string, branchId?: string): Promise<AccountWithBalance[]> {
    if (MOCK_MODE || !online()) {
      const rows = await offlineDB.financialAccounts.where('company_id').equals(companyId)
        .filter((a) => !branchId || a.branch_id === branchId).toArray();
      return deriveLocalBalances(companyId, rows);
    }
    const {data, error} = await supabase.rpc('financial_account_balances', {p_company: companyId, p_branch_id: branchId ?? null});
    if (error) throw new Error(error.message);
    type Row = {account_id: string; branch_id: string; name: string; account_type: FinancialAccount['account_type']; provider: string | null; account_number: string | null; coa_code: string; status: FinancialAccount['status']; balance: unknown};
    const now = new Date().toISOString();
    const out: AccountWithBalance[] = ((data ?? []) as Row[]).map((r) => ({
      id: r.account_id, company_id: companyId, branch_id: r.branch_id, name: r.name, account_type: r.account_type,
      provider: r.provider, account_number: r.account_number, coa_code: r.coa_code, status: r.status,
      created_at: now, updated_at: now, balance: Number(r.balance ?? 0),
    }));
    await offlineDB.financialAccounts.bulkPut(out.map(({balance: _b, ...a}) => a));
    return out;
  },

  // Active accounts of one branch — the POS payment-method picker list (drawer is the implicit null option).
  async fetchPickerAccounts(companyId: string, branchId: string): Promise<FinancialAccount[]> {
    const all = await this.fetchAccounts(companyId, branchId).catch(() => [] as AccountWithBalance[]);
    return all.filter((a) => a.status === 'Active' && a.coa_code !== 'CASH');
  },

  // Governed create/edit (finance.account.manage). Editing changes display metadata only (code immutable).
  async upsertAccount(companyId: string, branchId: string, input: AccountInput, accountId?: string): Promise<void> {
    if (!input.name.trim()) throw new Error('Account name is required.');
    if (!accountId && !/^[A-Z][A-Z0-9_]{2,30}$/.test(input.coa_code)) {
      throw new Error('Code must be 3-31 chars of A-Z, 0-9, _ (e.g. WALLET_GCASH).');
    }
    if (MOCK_MODE) {
      const now = new Date().toISOString();
      if (accountId) {
        const existing = await offlineDB.financialAccounts.get(accountId);
        if (!existing) throw new Error('Account not found.');
        await offlineDB.financialAccounts.put({...existing, name: input.name.trim(), provider: input.provider ?? null, account_number: input.account_number ?? null, updated_at: now});
        return;
      }
      const dup = await offlineDB.financialAccounts.where('company_id').equals(companyId)
        .filter((a) => a.branch_id === branchId && a.coa_code === input.coa_code).first();
      if (dup) throw new Error('That code is already used in this branch.');
      await offlineDB.financialAccounts.put({
        id: uuidv7(), company_id: companyId, branch_id: branchId, name: input.name.trim(),
        account_type: input.account_type, provider: input.provider ?? null,
        account_number: input.account_number ?? null, coa_code: input.coa_code, status: 'Active',
        created_at: now, updated_at: now,
      });
      return;
    }
    const payload = {
      p_branch_id: branchId, p_name: input.name.trim(), p_account_type: input.account_type,
      p_coa_code: input.coa_code, p_provider: input.provider ?? null,
      p_account_number: input.account_number ?? null, p_account_id: accountId ?? null,
    };
    if (online()) {
      const {error} = await supabase.rpc('financial_account_upsert', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'finance.account', request: {type: 'rpc', rpc: 'financial_account_upsert', payload}});
  },

  async setAccountStatus(companyId: string, account: FinancialAccount, status: FinancialAccount['status']): Promise<void> {
    if (MOCK_MODE) {
      await offlineDB.financialAccounts.put({...account, status, updated_at: new Date().toISOString()});
      return;
    }
    const payload = {p_account_id: account.id, p_status: status};
    if (online()) {
      const {error} = await supabase.rpc('financial_account_set_status', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'finance.account_status', request: {type: 'rpc', rpc: 'financial_account_set_status', payload}});
  },

  // Register the branch cash drawer (idempotent; server fn inherits the manage gate).
  async ensureCash(companyId: string, branchId: string): Promise<void> {
    if (MOCK_MODE) {
      const existing = await offlineDB.financialAccounts.where('company_id').equals(companyId)
        .filter((a) => a.branch_id === branchId && a.coa_code === 'CASH').first();
      if (existing) return;
      const now = new Date().toISOString();
      await offlineDB.financialAccounts.put({
        id: uuidv7(), company_id: companyId, branch_id: branchId, name: 'Cash on Hand',
        account_type: 'Cash', provider: null, account_number: null, coa_code: 'CASH', status: 'Active',
        created_at: now, updated_at: now,
      });
      return;
    }
    if (online()) {
      const {error} = await supabase.rpc('financial_ensure_cash', {p_branch_id: branchId});
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'finance.ensure_cash', request: {type: 'rpc', rpc: 'financial_ensure_cash', payload: {p_branch_id: branchId}}});
  },

  // Dr {to} / Cr {from}, no P&L (22.10). Same branch; idempotent server-side by key.
  async transfer(companyId: string, from: FinancialAccount, to: FinancialAccount, amount: number, note?: string): Promise<void> {
    if (amount <= 0) throw new Error('Amount must be greater than zero.');
    if (from.id === to.id) throw new Error('Pick two different accounts.');
    if (from.branch_id !== to.branch_id) throw new Error('Both accounts must belong to the same branch.');
    const key = uuidv7();
    if (MOCK_MODE) {
      const balances = await deriveLocalBalances(companyId, [from]);
      if ((balances[0]?.balance ?? 0) < amount) throw new Error(`${from.name} only has ₱${balances[0]?.balance ?? 0}.`);
      const t: FinancialTransfer = {
        id: key, company_id: companyId, branch_id: from.branch_id, from_account_id: from.id,
        to_account_id: to.id, amount: round2(amount), note: note?.trim() || null, created_at: new Date().toISOString(),
      };
      await offlineDB.financialTransfers.put(t);
      return;
    }
    const payload = {p_from_account_id: from.id, p_to_account_id: to.id, p_amount: round2(amount), p_idempotency_key: key, p_note: note?.trim() || null};
    if (online()) {
      const {error} = await supabase.rpc('financial_account_transfer', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'finance.transfer', request: {type: 'rpc', rpc: 'financial_account_transfer', payload}});
  },
};
