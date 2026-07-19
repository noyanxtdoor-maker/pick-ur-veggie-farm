// T3.1 (2026-07-19): client API for vendor master + cost schedule + vendor ledger (AP).
// Ported from Repo B (GLM Version) and adapted: companyId comes from the caller (usePermissions()),
// not a raw user_branch_roles lookup; writes go through the online()/enqueue() offline-queue pattern
// matching every other ...Api.ts write in this repo (see customersApi). All writes go through the
// proven SECURITY DEFINER RPCs (vendor_upsert, cost_schedule_upsert, vendor_invoice_record,
// vendor_payment_record, vendor_ap_standing).
import {supabase} from '../../core/supabase/client';
import {enqueue} from '../../core/offline/queue';
import {MOCK_MODE} from '../../core/mock/mock';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

export interface Vendor {
  id: string;
  company_id: string;
  vendor_code: string;
  name: string;
  contact: string | null;
  address: string | null;
  tax_id: string | null;
  payment_terms: string | null;
  notes: string | null;
  status: 'Active' | 'Archived';
  created_at: string;
}

export interface VendorAPStanding {
  vendor_id: string;
  name: string;
  status: 'Active' | 'Archived';
  total_invoiced: number;
  total_paid: number;
  outstanding_ap: number;
}

export interface CostScheduleRow {
  id: string;
  company_id: string;
  vendor_id: string;
  product_id: string;
  unit_cost: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  created_at: string;
}

export interface VendorInvoiceLineInput {
  product_id?: string | null;
  description?: string;
  quantity: number;
  unit_cost: number;
  expense_account_id: string;
  cost_schedule_id?: string | null;
}

export interface VendorPaymentAllocation {
  vendor_invoice_id: string;
  amount: number;
}

export const vendorsApi = {
  async list(companyId: string): Promise<Vendor[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.from('vendors').select('*').eq('company_id', companyId).order('name');
    if (error) throw new Error(error.message);
    return (data ?? []) as Vendor[];
  },

  async standing(companyId: string, vendorId: string | null = null): Promise<VendorAPStanding[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.rpc('vendor_ap_standing', {p_company: companyId, p_vendor_id: vendorId});
    if (error) throw new Error(error.message);
    return ((data ?? []) as VendorAPStanding[]).map((r) => ({...r, total_invoiced: Number(r.total_invoiced), total_paid: Number(r.total_paid), outstanding_ap: Number(r.outstanding_ap)}));
  },

  async upsert(companyId: string, id: string | null, code: string, name: string, contact: string | null = null,
               address: string | null = null, taxId: string | null = null,
               paymentTerms: string | null = null, notes: string | null = null): Promise<void> {
    if (!name.trim()) throw new Error('Vendor name is required.');
    if (MOCK_MODE) return;
    const payload = {p_company: companyId, p_id: id, p_vendor_code: code, p_name: name.trim(), p_contact: contact, p_address: address, p_tax_id: taxId, p_payment_terms: paymentTerms, p_notes: notes};
    if (online()) {
      const {error} = await supabase.rpc('vendor_upsert', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'vendor.upsert', request: {type: 'rpc', rpc: 'vendor_upsert', payload}});
  },

  // The write side (upsertCostSchedule below) has existed since the T3.1 port; this read was the
  // missing half — nothing ever listed existing rate-card rows, so the report/UI had nothing to show.
  async listCostSchedule(companyId: string): Promise<CostScheduleRow[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.from('cost_schedule').select('*').eq('company_id', companyId).order('effective_from', {ascending: false});
    if (error) throw new Error(error.message);
    return ((data ?? []) as CostScheduleRow[]).map((r) => ({...r, unit_cost: Number(r.unit_cost)}));
  },

  async upsertCostSchedule(companyId: string, id: string | null, vendorId: string, productId: string,
                            unitCost: number, effectiveFrom: string,
                            effectiveTo: string | null = null, notes: string | null = null): Promise<void> {
    if (MOCK_MODE) return;
    const payload = {p_company: companyId, p_id: id, p_vendor_id: vendorId, p_product_id: productId, p_unit_cost: unitCost, p_effective_from: effectiveFrom, p_effective_to: effectiveTo, p_notes: notes};
    if (online()) {
      const {error} = await supabase.rpc('cost_schedule_upsert', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'vendor.cost_schedule.upsert', request: {type: 'rpc', rpc: 'cost_schedule_upsert', payload}});
  },

  async recordInvoice(companyId: string, branchId: string, vendorId: string, invoiceNumber: string,
                       invoiceDate: string, dueDate: string | null,
                       lines: VendorInvoiceLineInput[], notes: string | null = null): Promise<void> {
    if (!invoiceNumber.trim()) throw new Error('Invoice number is required.');
    if (lines.length === 0) throw new Error('At least one line is required.');
    if (MOCK_MODE) return;
    const payload = {p_company: companyId, p_branch_id: branchId, p_vendor_id: vendorId, p_invoice_number: invoiceNumber.trim(), p_invoice_date: invoiceDate, p_due_date: dueDate, p_lines: lines as never, p_notes: notes};
    if (online()) {
      const {error} = await supabase.rpc('vendor_invoice_record', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'vendor.invoice.record', request: {type: 'rpc', rpc: 'vendor_invoice_record', payload}});
  },

  async recordPayment(companyId: string, branchId: string, vendorId: string, paymentDate: string,
                       amount: number, allocations: VendorPaymentAllocation[],
                       method = 'Cash', reference: string | null = null,
                       notes: string | null = null): Promise<void> {
    if (amount <= 0) throw new Error('Amount must be greater than zero.');
    if (MOCK_MODE) return;
    const payload = {p_company: companyId, p_branch_id: branchId, p_vendor_id: vendorId, p_payment_date: paymentDate, p_amount: amount, p_allocations: allocations as never, p_method: method, p_reference: reference, p_notes: notes};
    if (online()) {
      const {error} = await supabase.rpc('vendor_payment_record', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'vendor.payment.record', request: {type: 'rpc', rpc: 'vendor_payment_record', payload}});
  },
};
