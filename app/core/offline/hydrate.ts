// Real-mode reference-table hydration. Several screens (POS, Inventory, Approvals) need `branches` in the
// local Dexie cache to pick a default branch — but nothing pulls it down on login, only whichever screen a
// user happens to visit warms it as a side effect (ApprovalsScreen did this ad hoc; Branches screen too).
// A role scoped to just pos.sell has no reason to ever open Approvals or Branches, so on a fresh device
// their cache stays permanently empty and every branch-dependent screen spins forever (found live
// 2026-07-13). Call this once per screen mount instead of duplicating the fetch+bulkPut inline.
import {supabase} from '../supabase/client';
import {offlineDB} from './db';
import {MOCK_MODE} from '../mock/mock';
import type {PosInvoice, PosInvoiceLine} from '../../types/db';

export function hydrateBranches(companyId: string): void {
  if (MOCK_MODE || !(typeof navigator === 'undefined' || navigator.onLine)) return;
  void Promise.resolve(supabase.from('branches').select('*').eq('company_id', companyId))
    .then(({data}) => {if (data) void offlineDB.branches.bulkPut(data as never[]);})
    .catch(() => undefined);
}

// Same gap as hydrateBranches, for the roles table — ApprovalsScreen already carries its own inline
// copy of this exact fetch+bulkPut (found first-cloud-E2E: the approve dialog had zero options).
// MembersScreen's own Assign-role dropdown reads the identical Dexie cache but never populated it —
// on a fresh device that opens Memberships without visiting Roles/Approvals first, the role picker is
// empty and nobody can be assigned a role (found live 2026-07-19, same sync-gap sweep as hydrateInvoices).
export function hydrateRoles(companyId: string): void {
  if (MOCK_MODE || !(typeof navigator === 'undefined' || navigator.onLine)) return;
  void Promise.resolve(supabase.from('roles').select('*').eq('company_id', companyId))
    .then(({data}) => {if (data) void offlineDB.roles.bulkPut(data as never[]);})
    .catch(() => undefined);
}

// Same gap, for the single `companies` row — only the Company settings screen ever writes it, but
// Dashboard/AppShell read it directly for the header name and status badge. Lowest-severity of this
// gap class (cosmetic fallback to a placeholder name, not a blocked workflow) but the same fix shape.
export function hydrateCompany(companyId: string): void {
  if (MOCK_MODE || !(typeof navigator === 'undefined' || navigator.onLine)) return;
  void Promise.resolve(supabase.from('companies').select('*').eq('id', companyId).maybeSingle())
    .then(({data}) => {if (data) void offlineDB.companies.put(data as never);})
    .catch(() => undefined);
}

// Historical Sales Journal (PosScreen) reads directly from the local Dexie cache (posInvoices) — by
// design, recordSale() writes its OWN sale there immediately so a cashier sees their slip instantly
// even offline. But nothing ever pulled OTHER devices'/accounts' invoices INTO that cache. Found live
// (owner report, 2026-07-19): a sale made on one account correctly reached the Dashboard's aggregate
// totals (a real canonical server fetch, posApi.fetchSalesReport) but stayed invisible in the Journal
// table on the SAME screen, which only ever shows what THIS device itself wrote — the exact "sales only
// show on the device where they happened" symptom reported. Same fix shape as hydrateBranches above
// (2026-07-13's fix for the identical class of gap on a different table), reconstructing full PosInvoice
// rows — not reusing fetchSalesReport's summarized SalesReport shape, since the Journal's own Void/
// Settle/Print actions need fields (tender_cash, financial_account_id, customer_id…) that shape omits;
// writing incomplete rows into a money-path cache is the wrong kind of shortcut here.
const HYDRATE_WINDOW_DAYS = 90;
export function hydrateInvoices(companyId: string): void {
  if (MOCK_MODE || !(typeof navigator === 'undefined' || navigator.onLine)) return;
  const sinceIso = new Date(Date.now() - HYDRATE_WINDOW_DAYS * 86_400_000).toISOString();
  void Promise.all([
    supabase.from('invoices')
      .select('id, company_id, branch_id, sales_order_id, invoice_number, total, tender_cash, change_amount, status, created_by, created_at, customer_id, customer_name, financial_account_id')
      .eq('company_id', companyId)
      .or(`created_at.gte.${sinceIso},status.eq.Unpaid`),
    supabase.from('sales_orders').select('id, subtotal, discount, delivery_fee, customer_note').eq('company_id', companyId).gte('created_at', sinceIso),
    supabase.from('sales_order_items')
      .select('sales_order_id, product_id, quantity, unit_price, line_total, is_bulk, description, sales_orders!inner(order_date)')
      .eq('company_id', companyId)
      .gte('sales_orders.order_date', sinceIso),
    supabase.from('products').select('id, name').eq('company_id', companyId),
    supabase.from('users').select('id, display_name'),
  ])
    .then(([inv, orders, items, prods, us]) => {
      if (inv.error || orders.error || items.error || prods.error) return;
      const productName = new Map((prods.data ?? []).map((p) => [p.id as string, p.name as string]));
      const nameById = new Map((us.data ?? []).map((u) => [u.id as string, u.display_name as string]));
      const orderMeta = new Map((orders.data ?? []).map((o) => [
        o.id as string,
        {subtotal: Number(o.subtotal), discount: Number(o.discount), delivery_fee: Number(o.delivery_fee), note: o.customer_note as string | null},
      ]));
      const linesByOrder = new Map<string, PosInvoiceLine[]>();
      const bulkOrders = new Set<string>();
      type ItemRow = {sales_order_id: string; product_id: string; quantity: unknown; unit_price: unknown; line_total: unknown; is_bulk: boolean | null; description: string | null};
      for (const it of (items.data ?? []) as ItemRow[]) {
        const arr = linesByOrder.get(it.sales_order_id) ?? [];
        if (it.is_bulk) bulkOrders.add(it.sales_order_id);
        arr.push({
          product_id: it.product_id, finished_goods_batch_id: null,
          name: it.is_bulk ? (it.description ?? 'Bulk Pre-order') : (productName.get(it.product_id) ?? 'Unknown'),
          weight_kg: it.is_bulk ? null : Number(it.quantity),
          unit_price: Number(it.unit_price),
          line_total: Number(it.line_total),
        });
        linesByOrder.set(it.sales_order_id, arr);
      }
      type InvRow = {id: string; company_id: string; branch_id: string; sales_order_id: string; invoice_number: unknown; total: unknown; tender_cash: unknown; change_amount: unknown; status: PosInvoice['status']; created_by: string | null; created_at: string; customer_id: string | null; customer_name: string | null; financial_account_id: string | null};
      const rows: PosInvoice[] = ((inv.data ?? []) as InvRow[]).map((i) => {
        const meta = orderMeta.get(i.sales_order_id);
        return {
          id: i.id, company_id: i.company_id, branch_id: i.branch_id,
          invoice_number: i.invoice_number == null ? null : Number(i.invoice_number),
          lines: linesByOrder.get(i.sales_order_id) ?? [],
          subtotal: meta?.subtotal ?? Number(i.total),
          discount: meta?.discount ?? 0, delivery_fee: meta?.delivery_fee ?? 0, total: Number(i.total),
          sale_type: bulkOrders.has(i.sales_order_id) ? 'wholesale' : 'retail',
          posted_by: i.created_by ? (nameById.get(i.created_by) ?? null) : null,
          tender_cash: Number(i.tender_cash), change_amount: Number(i.change_amount),
          note: meta?.note ?? null,
          customer_name: i.customer_name, customer_id: i.customer_id,
          financial_account_id: i.financial_account_id,
          status: i.status, created_at: i.created_at,
        };
      });
      if (rows.length) void offlineDB.posInvoices.bulkPut(rows);
    })
    .catch(() => undefined);
}
