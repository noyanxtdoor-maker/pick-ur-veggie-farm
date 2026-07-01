// POS data-access (M1B A1 seam). Reads: local-first products + finished-goods with derived availability.
// Sale: MOCK → applied to Dexie (demo, no cloud); real+online → direct rpc pos_record_sale (authoritative slip now);
// real+offline → enqueued rpc in the write-ahead outbox (B5; the payload's idempotency key dedups server-side, so
// the drain commits the sale exactly once and the receipt stays provisional until sync).
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE, mockRead} from '../../core/mock/mock';
import {round2} from './money';
import type {FinishedGood, PosInvoice, PosInvoiceLine, Product} from '../../types/db';

export interface SaleLineInput {
  product_id: string;
  finished_goods_batch_id: string;
  name: string; // display snapshot for the local receipt
  weight_kg: number;
  unit_price: number; // display; server recomputes
}

export interface SaleResult {
  invoice: PosInvoice;
  provisional: boolean; // true = queued offline; slip number arrives on sync
}

export const posApi = {
  async fetchProducts(companyId: string): Promise<Product[]> {
    if (MOCK_MODE) return mockRead<Product>('products', companyId);
    const {data, error} = await supabase.from('products').select('*').eq('company_id', companyId).eq('status', 'Active').order('name');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Product[]).map((p) => ({...p, retail_per_kg: Number(p.retail_per_kg)}));
  },

  // Finished goods with derived availability. Mock: the seeded/maintained `available`. Real: fg_available() per batch
  // (fine at farm scale — a handful of batches per branch).
  async fetchStock(companyId: string, branchId: string): Promise<FinishedGood[]> {
    if (MOCK_MODE) {
      const all = await mockRead<FinishedGood>('finished_goods_batches', companyId);
      return all.filter((f) => f.branch_id === branchId && f.status === 'Available');
    }
    const {data, error} = await supabase.from('finished_goods_batches').select('*').eq('company_id', companyId).eq('branch_id', branchId).eq('status', 'Available').order('created_at');
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Omit<FinishedGood, 'available'>>;
    const out: FinishedGood[] = [];
    for (const r of rows) {
      const {data: avail, error: e2} = await supabase.rpc('fg_available', {p_batch_id: r.id});
      if (e2) throw new Error(e2.message);
      out.push({...r, cost_per_unit: Number(r.cost_per_unit), available: Number(avail ?? 0)});
    }
    return out;
  },

  async recordSale(companyId: string, branchId: string, lines: SaleLineInput[], tenderCash: number): Promise<SaleResult> {
    const total = round2(lines.reduce((s, l) => s + round2(l.weight_kg * l.unit_price), 0));
    if (tenderCash < total) throw new Error('Insufficient cash tendered.');
    const idem = uuidv7();
    const invoiceLines: PosInvoiceLine[] = lines.map((l) => ({
      product_id: l.product_id, name: l.name, weight_kg: l.weight_kg, unit_price: l.unit_price, line_total: round2(l.weight_kg * l.unit_price),
    }));
    const base: PosInvoice = {
      id: idem, company_id: companyId, branch_id: branchId, invoice_number: null,
      lines: invoiceLines, total, tender_cash: tenderCash, change_amount: round2(tenderCash - total),
      status: 'PendingSync', created_at: new Date().toISOString(),
    };

    if (MOCK_MODE) {
      // Demo: enforce availability + decrement locally, assign a local slip number.
      for (const l of lines) {
        const fg = await offlineDB.finishedGoods.get(l.finished_goods_batch_id);
        if (!fg || fg.available < l.weight_kg) throw new Error(`Not enough stock for ${l.name}.`);
      }
      for (const l of lines) {
        const fg = (await offlineDB.finishedGoods.get(l.finished_goods_batch_id))!;
        await offlineDB.finishedGoods.put({...fg, available: round2(fg.available - l.weight_kg)});
      }
      const seq = ((await offlineDB.meta.get('pos-slip-seq'))?.value as number | undefined) ?? 101;
      await offlineDB.meta.put({key: 'pos-slip-seq', value: seq + 1});
      const inv: PosInvoice = {...base, invoice_number: seq, status: 'Paid'};
      await offlineDB.posInvoices.put(inv);
      return {invoice: inv, provisional: false};
    }

    const payload = {p_branch_id: branchId, p_lines: lines.map((l) => ({product_id: l.product_id, finished_goods_batch_id: l.finished_goods_batch_id, weight_kg: l.weight_kg})), p_tender_cash: tenderCash, p_idempotency_key: idem};

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const {data, error} = await supabase.rpc('pos_record_sale', payload);
      if (error) throw new Error(error.message);
      const invoiceId = data as string;
      const {data: invRow} = await supabase.from('invoices').select('invoice_number, total, tender_cash, change_amount').eq('id', invoiceId).maybeSingle();
      const inv: PosInvoice = {
        ...base, id: invoiceId, status: 'Paid',
        invoice_number: invRow ? Number(invRow.invoice_number) : null,
        total: invRow ? Number(invRow.total) : total,
        tender_cash: invRow ? Number(invRow.tender_cash) : tenderCash,
        change_amount: invRow ? Number(invRow.change_amount) : base.change_amount,
      };
      await offlineDB.posInvoices.put(inv);
      return {invoice: inv, provisional: false};
    }

    // Offline: write-ahead enqueue (O1) — the rpc replays idempotently on reconnect; receipt is provisional.
    await enqueue({companyId, kind: 'pos.sale', request: {type: 'rpc', rpc: 'pos_record_sale', payload}});
    await offlineDB.posInvoices.put(base);
    return {invoice: base, provisional: true};
  },
};
