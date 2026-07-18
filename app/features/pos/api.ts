// POS data-access (M1B A1 seam). Reads: local-first products + finished-goods with derived availability.
// Sale/settle/void/session: MOCK → applied to Dexie (demo, no cloud); real+online → direct rpc (authoritative);
// real+offline → outbox-queued rpc (B5; server-side idempotency/status-idempotency make replays safe).
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE, mockRead, mockUsers} from '../../core/mock/mock';
import {round2} from './money';
import {REPORT_WINDOW_DAYS, type ReportLine, type SalesReport} from './report';
import type {FinishedGood, PosCashSession, PosInvoice, PosInvoiceLine, Product, ProductRemovalRequest} from '../../types/db';

export interface SaleLineInput {
  product_id: string;
  finished_goods_batch_id: string | null; // null = bulk (mock "Skip Weigh")
  name: string; // display snapshot for the local receipt
  weight_kg: number | null; // null = bulk flat-price line
  unit_price: number; // farm ₱/kg (display; server recomputes) — or the negotiated flat ₱ for bulk (server-validated > 0)
  retail_per_kg: number | null; // prevailing retail snapshot for the saved math; null = bulk
}

// Cashier display name for the local slip/journal (prototype postedBy). Self users-row is always RLS-visible.
let ownNameCache: string | null | undefined;
async function currentDisplayName(): Promise<string | null> {
  if (MOCK_MODE) return (await mockUsers())[0]?.display_name ?? 'Demo Owner';
  if (ownNameCache !== undefined) return ownNameCache;
  const {data} = await supabase.auth.getSession();
  const authId = data.session?.user?.id;
  if (!authId) return (ownNameCache = null);
  const {data: row} = await supabase.from('users').select('display_name').eq('auth_user_id', authId).maybeSingle();
  ownNameCache = (row?.display_name as string | undefined) ?? null;
  return ownNameCache;
}

export interface SaleOptions {
  kind?: 'paid' | 'preorder';
  discountRate?: 0 | 0.1; // server-constrained to {0, 0.10} — P2-M2G: now allowed on either sale kind
  deliveryFee?: number;
  note?: string;
  financialAccountId?: string | null; // P2-B2A: where a PAID sale's money lands (null = cash drawer)
  customerName?: string; // P2-M2G: free-text walk-in customer name, printed on the receipt
}

export interface SaleResult {
  invoice: PosInvoice;
  provisional: boolean; // true = queued offline; slip number arrives on sync
}

const online = () => typeof navigator === 'undefined' || navigator.onLine;

export const posApi = {
  async fetchProducts(companyId: string): Promise<Product[]> {
    if (MOCK_MODE) return (await mockRead<Product>('products', companyId)).filter((p) => p.status === 'Active').sort((a, b) => a.name.localeCompare(b.name));
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
    const invoiceLines: PosInvoiceLine[] = lines.map((l) => ({
      product_id: l.product_id, finished_goods_batch_id: l.finished_goods_batch_id, name: l.name,
      weight_kg: l.weight_kg, unit_price: l.unit_price, retail_per_kg: l.retail_per_kg,
      line_total: l.weight_kg === null ? round2(l.unit_price) : round2(l.weight_kg * l.unit_price),
    }));
    const subtotal = round2(invoiceLines.reduce((s, l) => s + l.line_total, 0));
    // prototype math: retailLine per weighed item (bulk retailLine = its flat price); saved includes the pre-order discount
    const retailTotal = round2(invoiceLines.reduce((s, l) => s + (l.weight_kg !== null && l.retail_per_kg != null ? round2(l.weight_kg * l.retail_per_kg) : l.line_total), 0));
    const discount = round2(subtotal * discountRate);
    const total = round2(subtotal - discount + deliveryFee);
    const saved = round2(retailTotal - subtotal + discount);
    const saleType: 'retail' | 'wholesale' = lines.some((l) => l.weight_kg === null) ? 'wholesale' : 'retail';
    if (kind === 'paid' && tenderCash < total) throw new Error('Insufficient cash tendered.');
    const idem = uuidv7();
    const base: PosInvoice = {
      id: idem, company_id: companyId, branch_id: branchId, invoice_number: null,
      lines: invoiceLines, subtotal, discount, delivery_fee: deliveryFee, total,
      retail_total: retailTotal, saved, sale_type: saleType, posted_by: await currentDisplayName(),
      tender_cash: kind === 'paid' ? tenderCash : 0,
      change_amount: kind === 'paid' ? round2(tenderCash - total) : 0,
      note: opts.note ?? null,
      customer_name: opts.customerName?.trim() || null,
      financial_account_id: kind === 'paid' ? (opts.financialAccountId ?? null) : null,
      status: 'PendingSync', created_at: new Date().toISOString(),
    };

    if (MOCK_MODE) {
      const weighed = lines.filter((l): l is SaleLineInput & {weight_kg: number; finished_goods_batch_id: string} => l.weight_kg !== null && l.finished_goods_batch_id !== null);
      for (const l of weighed) {
        const fg = await offlineDB.finishedGoods.get(l.finished_goods_batch_id);
        if (!fg || fg.available < l.weight_kg) throw new Error(`Not enough stock for ${l.name}.`);
      }
      // cost snapshot per line (P2-M4A: mock-mode COGS for the accounting reads; server derives this itself)
      const costed: PosInvoiceLine[] = [];
      for (const l of base.lines) {
        const fg = l.finished_goods_batch_id ? await offlineDB.finishedGoods.get(l.finished_goods_batch_id) : undefined;
        costed.push({...l, cost_per_unit: fg?.cost_per_unit ?? 0});
      }
      base.lines = costed;
      for (const l of weighed) {
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
      p_lines: lines.map((l) => l.weight_kg === null
        ? {product_id: l.product_id, bulk_price: l.unit_price}
        : {product_id: l.product_id, finished_goods_batch_id: l.finished_goods_batch_id, weight_kg: l.weight_kg}),
      p_tender_cash: tenderCash, p_idempotency_key: idem,
      p_sale_kind: kind, p_discount_rate: discountRate, p_delivery_fee: deliveryFee, p_customer_note: opts.note ?? null,
      p_financial_account_id: kind === 'paid' ? (opts.financialAccountId ?? null) : null,
      p_customer_name: base.customer_name,
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

  // M2D reporting read (spec: Phase_2_M2D_Dashboard_Reporting_Spec.md). Canonical member-scoped selects when
  // online; mock/offline fall back to the device cache (labeled source:'device'). Aggregation is summarizeSales().
  async fetchSalesReport(companyId: string): Promise<SalesReport> {
    const fromCache = async (): Promise<SalesReport> => {
      const invs = await offlineDB.posInvoices.where('company_id').equals(companyId).toArray();
      const branches = await offlineDB.branches.where('company_id').equals(companyId).toArray();
      const users = MOCK_MODE ? await mockUsers() : [];
      return {
        sales: invs
          .map((i) => ({
            id: i.id, branch_id: i.branch_id, invoice_number: i.invoice_number, total: i.total,
            // ?? defaults: cache rows written before M2C-b/M2E predate these fields
            discount: i.discount ?? 0, delivery_fee: i.delivery_fee ?? 0, status: i.status,
            sale_type: i.sale_type ?? 'retail', cashier: i.posted_by ?? null,
            created_at: i.created_at,
            lines: i.lines.map((l) => ({name: l.name, weight_kg: l.weight_kg ?? 0, line_total: l.line_total})),
          }))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        branchNames: Object.fromEntries(branches.map((b) => [b.id, b.name])),
        userNames: Object.fromEntries(users.map((u) => [u.id, u.display_name])),
        source: 'device',
      };
    };
    if (MOCK_MODE || !online()) return fromCache();

    const sinceIso = new Date(Date.now() - REPORT_WINDOW_DAYS * 86_400_000).toISOString();
    const [inv, orders, items, prods, brs, us] = await Promise.all([
      supabase.from('invoices')
        .select('id, branch_id, sales_order_id, invoice_number, total, status, created_by, created_at')
        .eq('company_id', companyId)
        .or(`created_at.gte.${sinceIso},status.eq.Unpaid`) // period + ALL open receivables (a balance)
        .order('created_at', {ascending: false}),
      supabase.from('sales_orders').select('id, discount, delivery_fee').eq('company_id', companyId).gte('created_at', sinceIso),
      supabase.from('sales_order_items')
        .select('sales_order_id, product_id, quantity, line_total, is_bulk, description, sales_orders!inner(order_date)')
        .eq('company_id', companyId)
        .gte('sales_orders.order_date', sinceIso),
      supabase.from('products').select('id, name').eq('company_id', companyId), // all statuses: archived names still render
      supabase.from('branches').select('id, name').eq('company_id', companyId),
      supabase.from('users').select('id, display_name'), // users RLS filters rows (self + user.read); never widened here
    ]);
    for (const r of [inv, orders, items, prods, brs]) if (r.error) throw new Error(r.error.message);
    const productName = new Map((prods.data ?? []).map((p) => [p.id as string, p.name as string]));
    const orderMeta = new Map((orders.data ?? []).map((o) => [o.id as string, {discount: Number(o.discount), delivery_fee: Number(o.delivery_fee)}]));
    const linesByOrder = new Map<string, ReportLine[]>();
    const bulkOrders = new Set<string>();
    for (const it of (items.data ?? []) as Array<{sales_order_id: string; product_id: string; quantity: unknown; line_total: unknown; is_bulk: boolean | null; description: string | null}>) {
      const arr = linesByOrder.get(it.sales_order_id) ?? [];
      if (it.is_bulk) bulkOrders.add(it.sales_order_id);
      arr.push({
        name: it.is_bulk ? (it.description ?? 'Bulk Pre-order') : (productName.get(it.product_id) ?? 'Unknown'),
        weight_kg: it.is_bulk ? 0 : Number(it.quantity),
        line_total: Number(it.line_total),
      });
      linesByOrder.set(it.sales_order_id, arr);
    }
    type InvRow = {id: string; branch_id: string; sales_order_id: string; invoice_number: unknown; total: unknown; status: SalesReport['sales'][number]['status']; created_by: string | null; created_at: string};
    return {
      sales: ((inv.data ?? []) as InvRow[]).map((i) => ({
        id: i.id, branch_id: i.branch_id,
        invoice_number: i.invoice_number == null ? null : Number(i.invoice_number),
        total: Number(i.total),
        discount: orderMeta.get(i.sales_order_id)?.discount ?? 0,
        delivery_fee: orderMeta.get(i.sales_order_id)?.delivery_fee ?? 0,
        status: i.status,
        sale_type: (bulkOrders.has(i.sales_order_id) ? 'wholesale' : 'retail') as 'retail' | 'wholesale',
        cashier: i.created_by, created_at: i.created_at,
        lines: linesByOrder.get(i.sales_order_id) ?? [],
      })),
      branchNames: Object.fromEntries((brs.data ?? []).map((b) => [b.id as string, b.name as string])),
      userNames: us.error ? {} : Object.fromEntries((us.data ?? []).map((u) => [u.id as string, u.display_name as string])),
      source: 'canonical',
    };
  },

  // Settle a pre-order (Mark Paid). Returns change. Status-idempotent server-side.
  // P2-B2A: the settlement money can land in a chosen financial account (null = cash drawer).
  async settle(companyId: string, invoice: PosInvoice, cash: number, financialAccountId?: string | null): Promise<number> {
    if (cash < invoice.total) throw new Error('Cash must cover the outstanding total.');
    const change = round2(cash - invoice.total);
    const settled: PosInvoice = {...invoice, status: 'Paid', tender_cash: cash, change_amount: change, financial_account_id: financialAccountId ?? null};
    if (MOCK_MODE) {
      await offlineDB.posInvoices.put(settled);
      return change;
    }
    const payload = {p_invoice_id: invoice.id, p_cash: cash, p_financial_account_id: financialAccountId ?? null};
    if (online()) {
      const {error} = await supabase.rpc('pos_settle_sale', payload);
      if (error) throw new Error(error.message);
    } else {
      await enqueue({companyId, kind: 'pos.settle', request: {type: 'rpc', rpc: 'pos_settle_sale', payload}});
    }
    await offlineDB.posInvoices.put(settled);
    return change;
  },

  // Void (audited reversal; reason mandatory; approval-tier permission enforced server-side).
  async voidSale(companyId: string, invoice: PosInvoice, reason: string): Promise<void> {
    if (!reason.trim()) throw new Error('A void reason is required.');
    if (MOCK_MODE) {
      for (const l of invoice.lines) {
        if (l.weight_kg === null || l.finished_goods_batch_id === null) continue; // bulk lines never moved stock
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

  // ── Crop Pricing Menu (prototype Catalog Manager; product.manage; M2A client write grants) ──
  // Same seam as sales: MOCK → Dexie; real+online → direct PostgREST (authoritative, immediate); real+offline →
  // outbox-queued. Prototype "Delete" maps to Archive (no hard delete; historical sales stay valid).
  async addProduct(companyId: string, name: string, retailPerKg: number): Promise<void> {
    const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'PRODUCT';
    const payload = {company_id: companyId, product_code: code, name: name.trim(), retail_per_kg: retailPerKg};
    if (MOCK_MODE) {
      const now = new Date().toISOString();
      await offlineDB.products.put({id: uuidv7(), ...payload, status: 'Active', created_at: now, updated_at: now});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('products').insert(payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'product.create', request: {type: 'insert', table: 'products', payload}});
  },
  async updateProductPrice(row: Product, retailPerKg: number): Promise<void> {
    if (MOCK_MODE) {
      await offlineDB.products.put({...row, retail_per_kg: retailPerKg, updated_at: new Date().toISOString()});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('products').update({retail_per_kg: retailPerKg}).eq('id', row.id);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: row.company_id, kind: 'product.update', request: {type: 'update', table: 'products', match: {id: row.id, baseUpdatedAt: row.updated_at}, payload: {retail_per_kg: retailPerKg}}});
  },
  // P1O (owner directive 2026-07-17): "Remove" replaces "Archive" in the UI. product.manage holders
  // remove instantly; product.remove-only holders (employee/operator by default) queue a request that
  // needs a product.manage holder's approval. Online-only (governed RPC; no offline queue — same reasoning
  // as the revoke-approval workflow: an approval decision must be made against live, current state).
  async requestProductRemoval(productId: string, reason: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has only one account — there is no separate product manager to approve a removal request.');
    const {error} = await supabase.rpc('request_product_removal', {p_product_id: productId, p_reason: reason});
    if (error) throw new Error(error.message);
  },
  async fetchPendingRemovals(): Promise<ProductRemovalRequest[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.rpc('list_pending_product_removals');
    if (error) throw new Error(error.message);
    return (data ?? []) as ProductRemovalRequest[];
  },
  async approveProductRemoval(requestId: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has no pending removal requests.');
    const {error} = await supabase.rpc('approve_product_removal', {p_request_id: requestId});
    if (error) throw new Error(error.message);
  },
  async rejectProductRemoval(requestId: string, reason: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has no pending removal requests.');
    const {error} = await supabase.rpc('reject_product_removal', {p_request_id: requestId, p_reason: reason});
    if (error) throw new Error(error.message);
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
