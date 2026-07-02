// POS data-access (M1B A1 seam). Reads: local-first products + finished-goods with derived availability.
// Sale/settle/void/session: MOCK → applied to Dexie (demo, no cloud); real+online → direct rpc (authoritative);
// real+offline → outbox-queued rpc (B5; server-side idempotency/status-idempotency make replays safe).
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE, mockRead} from '../../core/mock/mock';
import {round2} from './money';
import type {FinishedGood, PosCashSession, PosInvoice, PosInvoiceLine, Product} from '../../types/db';

export interface SaleLineInput {
  product_id: string;
  finished_goods_batch_id: string;
  name: string; // display snapshot for the local receipt
  weight_kg: number;
  unit_price: number; // display; server recomputes
}

export interface SaleOptions {
  kind?: 'paid' | 'preorder';
  discountRate?: 0 | 0.1; // server-constrained to {0, 0.10}
  deliveryFee?: number;
  note?: string;
}

export interface SaleResult {
  invoice: PosInvoice;
  provisional: boolean; // true = queued offline; slip number arrives on sync
}

const online = () => typeof navigator === 'undefined' || navigator.onLine;

export const posApi = {
  async fetchProducts(companyId: string): Promise<Product[]> {
    if (MOCK_MODE) return mockRead<Product>('products', companyId);
    const {data, error} = await supabase.from('products').select('*').eq('company_id', companyId).eq('status', 'Active').order('name');
    if (error) throw new Error(error.message);
    return ((data ?? []) as Product[]).map((p) => ({...p, retail_per_kg: Number(p.retail_per_kg)}));
  },

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

  async recordSale(companyId: string, branchId: string, lines: SaleLineInput[], tenderCash: number, opts: SaleOptions = {}): Promise<SaleResult> {
    const kind = opts.kind ?? 'paid';
    const discountRate = opts.discountRate ?? 0;
    const deliveryFee = round2(opts.deliveryFee ?? 0);
    const subtotal = round2(lines.reduce((s, l) => s + round2(l.weight_kg * l.unit_price), 0));
    const discount = round2(subtotal * discountRate);
    const total = round2(subtotal - discount + deliveryFee);
    if (kind === 'paid' && tenderCash < total) throw new Error('Insufficient cash tendered.');
    const idem = uuidv7();
    const invoiceLines: PosInvoiceLine[] = lines.map((l) => ({
      product_id: l.product_id, finished_goods_batch_id: l.finished_goods_batch_id, name: l.name,
      weight_kg: l.weight_kg, unit_price: l.unit_price, line_total: round2(l.weight_kg * l.unit_price),
    }));
    const base: PosInvoice = {
      id: idem, company_id: companyId, branch_id: branchId, invoice_number: null,
      lines: invoiceLines, subtotal, discount, delivery_fee: deliveryFee, total,
      tender_cash: kind === 'paid' ? tenderCash : 0,
      change_amount: kind === 'paid' ? round2(tenderCash - total) : 0,
      note: opts.note ?? null,
      status: 'PendingSync', created_at: new Date().toISOString(),
    };

    if (MOCK_MODE) {
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
      const inv: PosInvoice = {...base, invoice_number: seq, status: kind === 'paid' ? 'Paid' : 'Unpaid'};
      await offlineDB.posInvoices.put(inv);
      return {invoice: inv, provisional: false};
    }

    const payload = {
      p_branch_id: branchId,
      p_lines: lines.map((l) => ({product_id: l.product_id, finished_goods_batch_id: l.finished_goods_batch_id, weight_kg: l.weight_kg})),
      p_tender_cash: tenderCash, p_idempotency_key: idem,
      p_sale_kind: kind, p_discount_rate: discountRate, p_delivery_fee: deliveryFee, p_customer_note: opts.note ?? null,
    };

    if (online()) {
      const {data, error} = await supabase.rpc('pos_record_sale', payload);
      if (error) throw new Error(error.message);
      const invoiceId = data as string;
      const {data: invRow} = await supabase.from('invoices').select('invoice_number, total, tender_cash, change_amount, status').eq('id', invoiceId).maybeSingle();
      const inv: PosInvoice = {
        ...base, id: invoiceId,
        status: (invRow?.status as PosInvoice['status'] | undefined) ?? (kind === 'paid' ? 'Paid' : 'Unpaid'),
        invoice_number: invRow ? Number(invRow.invoice_number) : null,
        total: invRow ? Number(invRow.total) : total,
        tender_cash: invRow ? Number(invRow.tender_cash) : base.tender_cash,
        change_amount: invRow ? Number(invRow.change_amount) : base.change_amount,
      };
      await offlineDB.posInvoices.put(inv);
      return {invoice: inv, provisional: false};
    }

    await enqueue({companyId, kind: 'pos.sale', request: {type: 'rpc', rpc: 'pos_record_sale', payload}});
    await offlineDB.posInvoices.put(base);
    return {invoice: base, provisional: true};
  },

  // Settle a pre-order (Mark Paid). Returns change. Status-idempotent server-side.
  async settle(companyId: string, invoice: PosInvoice, cash: number): Promise<number> {
    if (cash < invoice.total) throw new Error('Cash must cover the outstanding total.');
    const change = round2(cash - invoice.total);
    if (MOCK_MODE) {
      await offlineDB.posInvoices.put({...invoice, status: 'Paid', tender_cash: cash, change_amount: change});
      return change;
    }
    const payload = {p_invoice_id: invoice.id, p_cash: cash};
    if (online()) {
      const {error} = await supabase.rpc('pos_settle_sale', payload);
      if (error) throw new Error(error.message);
    } else {
      await enqueue({companyId, kind: 'pos.settle', request: {type: 'rpc', rpc: 'pos_settle_sale', payload}});
    }
    await offlineDB.posInvoices.put({...invoice, status: 'Paid', tender_cash: cash, change_amount: change});
    return change;
  },

  // Void (audited reversal; reason mandatory; approval-tier permission enforced server-side).
  async voidSale(companyId: string, invoice: PosInvoice, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error('A void reason is required.');
    if (MOCK_MODE) {
      for (const l of invoice.lines) {
        const fg = await offlineDB.finishedGoods.get(l.finished_goods_batch_id);
        if (fg) await offlineDB.finishedGoods.put({...fg, available: round2(fg.available + l.weight_kg)});
      }
      await offlineDB.posInvoices.put({...invoice, status: 'Voided'});
      return;
    }
    const payload = {p_invoice_id: invoice.id, p_reason: reason};
    if (online()) {
      const {error} = await supabase.rpc('pos_void_sale', payload);
      if (error) throw new Error(error.message);
    } else {
      await enqueue({companyId, kind: 'pos.void', request: {type: 'rpc', rpc: 'pos_void_sale', payload}});
    }
    await offlineDB.posInvoices.put({...invoice, status: 'Voided'});
  },

  // Cash session (22.09): current Open session for a branch, open, close (returns variance).
  async currentSession(branchId: string): Promise<PosCashSession | null> {
    if (MOCK_MODE) {
      const s = (await offlineDB.meta.get(`mock-session-${branchId}`))?.value as PosCashSession | undefined;
      return s && s.status === 'Open' ? s : null;
    }
    const {data, error} = await supabase.from('cash_sessions').select('id, branch_id, opening_cash, opened_at, status').eq('branch_id', branchId).eq('status', 'Open').maybeSingle();
    if (error) throw new Error(error.message);
    return data ? ({...data, opening_cash: Number(data.opening_cash)} as PosCashSession) : null;
  },

  async openSession(branchId: string, openingCash: number): Promise<PosCashSession> {
    if (MOCK_MODE) {
      const s: PosCashSession = {id: uuidv7(), branch_id: branchId, opening_cash: openingCash, opened_at: new Date().toISOString(), status: 'Open'};
      await offlineDB.meta.put({key: `mock-session-${branchId}`, value: s});
      await offlineDB.meta.put({key: `mock-session-${branchId}-cash`, value: 0}); // net cash taken while open
      return s;
    }
    const {data, error} = await supabase.rpc('cash_open_session', {p_branch_id: branchId, p_opening_cash: openingCash});
    if (error) throw new Error(error.message);
    return {id: data as string, branch_id: branchId, opening_cash: openingCash, opened_at: new Date().toISOString(), status: 'Open'};
  },

  async closeSession(session: PosCashSession, countedCash: number, reason?: string): Promise<number> {
    if (MOCK_MODE) {
      // expected = opening + net cash of Paid invoices in this branch since open (mirrors the server derivation)
      const invs = await offlineDB.posInvoices.where('branch_id').equals(session.branch_id).toArray();
      const expected = round2(session.opening_cash + invs
        .filter((i) => i.status === 'Paid' && i.created_at >= session.opened_at)
        .reduce((s, i) => s + i.tender_cash - i.change_amount, 0));
      const variance = round2(countedCash - expected);
      if (variance !== 0 && !(reason ?? '').trim()) throw new Error(`Variance of ${variance} requires a reason.`);
      await offlineDB.meta.put({key: `mock-session-${session.branch_id}`, value: {...session, status: 'Closed'}});
      return variance;
    }
    const {data, error} = await supabase.rpc('cash_close_session', {p_session_id: session.id, p_counted_cash: countedCash, p_variance_reason: reason ?? null});
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  },
};
