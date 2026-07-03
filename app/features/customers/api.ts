// Customers & Credit data-access (M1B A1 seam; spec Phase_2_M9A_Customers_Spec.md / backlog B1). Customer master +
// read-only AR standing + non-GL invoice attribution. MOCK → Dexie; online → RPC/PostgREST; offline → outbox.
// Credit-limit ENFORCEMENT in the sale is deferred (money path, pending the cross-vendor review) — see the spec.
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE} from '../../core/mock/mock';
import {round2} from '../pos/money';
import type {Customer, CustomerStanding, PosInvoice} from '../../types/db';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

export interface CustomerInput {
  name: string;
  contact?: string;
  credit_limit?: number | null;
  notes?: string;
}

export interface StatementLine {
  id: string;
  invoice_number: number | null;
  created_at: string;
  total: number;
  status: PosInvoice['status'];
  running_outstanding: number; // cumulative unpaid balance up to and including this row
}
export interface CustomerStatement {
  lines: StatementLine[];
  outstanding: number; // Σ unpaid (final running balance)
}

// Pure: build a statement of account (oldest→newest) with a running outstanding balance. Only 'Unpaid' invoices
// add to the balance; Paid/Voided rows are shown for history but contribute 0. Kept pure for a unit test.
export function computeStatement(invoices: Array<Pick<PosInvoice, 'id' | 'invoice_number' | 'created_at' | 'total' | 'status'>>): CustomerStatement {
  const sorted = [...invoices].sort((a, b) => a.created_at.localeCompare(b.created_at));
  let running = 0;
  const lines: StatementLine[] = sorted.map((i) => {
    if (i.status === 'Unpaid') running = round2(running + i.total);
    return {id: i.id, invoice_number: i.invoice_number, created_at: i.created_at, total: i.total, status: i.status, running_outstanding: running};
  });
  return {lines, outstanding: running};
}

export const customersApi = {
  async fetchCustomers(companyId: string): Promise<Customer[]> {
    if (MOCK_MODE) {
      return (await offlineDB.customers.where('company_id').equals(companyId).toArray()).sort((a, b) => a.name.localeCompare(b.name));
    }
    const {data, error} = await supabase.from('customers').select('*').eq('company_id', companyId).order('name');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Customer[]).map((c) => ({...c, credit_limit: c.credit_limit === null ? null : Number(c.credit_limit)}));
  },

  // Per-customer outstanding receivable + available credit (derived from unpaid invoices — 22.07, never stored).
  async fetchStanding(companyId: string, branchId?: string): Promise<CustomerStanding[]> {
    if (MOCK_MODE) {
      const customers = await offlineDB.customers.where('company_id').equals(companyId).toArray();
      const invoices = await offlineDB.posInvoices.where('company_id').equals(companyId).toArray();
      const scoped = branchId ? invoices.filter((i) => i.branch_id === branchId) : invoices;
      return customers.map((c) => {
        const outstanding = round2(scoped.filter((i) => i.customer_id === c.id && i.status === 'Unpaid').reduce((s, i) => s + i.total, 0));
        return {
          customer_id: c.id, name: c.name, status: c.status, credit_limit: c.credit_limit,
          outstanding_ar: outstanding,
          available_credit: c.credit_limit === null ? null : round2(c.credit_limit - outstanding),
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
    }
    const {data, error} = await supabase.rpc('customer_ar_standing', {p_company: companyId, p_branch_id: branchId ?? null});
    if (error) throw new Error(error.message);
    return ((data ?? []) as CustomerStanding[]).map((r) => ({
      ...r, credit_limit: r.credit_limit === null ? null : Number(r.credit_limit),
      outstanding_ar: Number(r.outstanding_ar), available_credit: r.available_credit === null ? null : Number(r.available_credit),
    }));
  },

  async upsert(companyId: string, id: string | null, input: CustomerInput): Promise<void> {
    if (!input.name.trim()) throw new Error('Customer name is required.');
    const limit = input.credit_limit == null || Number.isNaN(input.credit_limit) ? null : round2(input.credit_limit);
    if (limit !== null && limit < 0) throw new Error('Credit limit cannot be negative.');
    if (MOCK_MODE) {
      const now = new Date().toISOString();
      const existing = id ? await offlineDB.customers.get(id) : undefined;
      await offlineDB.customers.put({
        id: id ?? uuidv7(), company_id: companyId, name: input.name.trim(), contact: input.contact?.trim() || null,
        credit_limit: limit, notes: input.notes?.trim() || null, status: existing?.status ?? 'Active', created_at: existing?.created_at ?? now,
      });
      return;
    }
    const payload = {p_company: companyId, p_id: id, p_name: input.name.trim(), p_contact: input.contact?.trim() || null, p_credit_limit: limit, p_notes: input.notes?.trim() || null};
    if (online()) {
      const {error} = await supabase.rpc('customer_upsert', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'customer.upsert', request: {type: 'rpc', rpc: 'customer_upsert', payload}});
  },

  async setStatus(customer: Customer, status: Customer['status']): Promise<void> {
    if (MOCK_MODE) {
      await offlineDB.customers.put({...customer, status});
      return;
    }
    const payload = {p_customer_id: customer.id, p_status: status};
    if (online()) {
      const {error} = await supabase.rpc('customer_set_status', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: customer.company_id, kind: 'customer.status', request: {type: 'rpc', rpc: 'customer_set_status', payload}});
  },

  // Unpaid credit invoices not yet attributed to a customer (for the assign control).
  async fetchUnassignedCredit(companyId: string, branchId?: string): Promise<PosInvoice[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.posInvoices.where('company_id').equals(companyId).toArray();
      return rows.filter((i) => i.status === 'Unpaid' && !i.customer_id && (!branchId || i.branch_id === branchId)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    let q = supabase.from('invoices').select('*').eq('company_id', companyId).eq('status', 'Unpaid').is('customer_id', null).order('created_at', {ascending: false}).limit(100);
    if (branchId) q = q.eq('branch_id', branchId);
    const {data, error} = await q;
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as PosInvoice[]);
  },

  // Read-only statement of account for one customer (their invoices + running outstanding balance).
  async fetchStatement(companyId: string, customerId: string, branchId?: string): Promise<CustomerStatement> {
    if (MOCK_MODE) {
      const rows = await offlineDB.posInvoices.where('company_id').equals(companyId).toArray();
      const mine = rows.filter((i) => i.customer_id === customerId && (!branchId || i.branch_id === branchId));
      return computeStatement(mine);
    }
    let q = supabase.from('invoices').select('id,invoice_number,created_at,total,status').eq('company_id', companyId).eq('customer_id', customerId).order('created_at');
    if (branchId) q = q.eq('branch_id', branchId);
    const {data, error} = await q;
    if (error) throw new Error(error.message);
    return computeStatement(((data ?? []) as Array<Pick<PosInvoice, 'id' | 'invoice_number' | 'created_at' | 'total' | 'status'>>).map((i) => ({...i, total: Number(i.total)})));
  },

  // Attribution only — tags an invoice with a customer; posts NO journal, changes NO amount.
  async assignInvoice(companyId: string, invoiceId: string, customerId: string): Promise<void> {
    if (MOCK_MODE) {
      const inv = await offlineDB.posInvoices.get(invoiceId);
      if (inv) await offlineDB.posInvoices.put({...inv, customer_id: customerId});
      return;
    }
    const payload = {p_invoice_id: invoiceId, p_customer_id: customerId};
    if (online()) {
      const {error} = await supabase.rpc('pos_assign_invoice_customer', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'customer.assign', request: {type: 'rpc', rpc: 'pos_assign_invoice_customer', payload}});
  },
};
