// Purchase Summary (owner review 2026-07-04 — the ecount "Purchase Summary" management report). Pure
// aggregation over the receivings the app already records at each purchase — "everything automated, no
// manual re-entry". Groups spend by category and by source (Lazada/Shopee/TikTok/physical store), so the
// owner can see WHAT was bought and WHERE the money went, per period. No GL touch; read-only.
import {round2} from '../pos/money';
import type {InventoryItem, ItemCategory, PurchaseReceiving} from '../../types/db';

export interface SummaryRow {
  key: string;
  label: string;
  total: number;
  count: number; // number of receiving lines
  qty: number; // total units/pcs purchased
  pct: number; // share of grand total, 0–100
}
export interface PurchaseSummary {
  byCategory: SummaryRow[];
  bySource: SummaryRow[];
  total: number;
  count: number;
}

type Item = Omit<InventoryItem, 'available'>;

function rows(
  receivings: PurchaseReceiving[],
  keyFor: (r: PurchaseReceiving) => {key: string; label: string},
  total: number,
): SummaryRow[] {
  const m = new Map<string, SummaryRow>();
  for (const r of receivings) {
    const {key, label} = keyFor(r);
    const row = m.get(key) ?? {key, label, total: 0, count: 0, qty: 0, pct: 0};
    row.total = round2(row.total + r.total_amount);
    row.count += 1;
    row.qty = round2(row.qty + r.quantity);
    m.set(key, row);
  }
  return Array.from(m.values())
    .map((row) => ({...row, pct: total > 0 ? round2((row.total / total) * 100) : 0}))
    .sort((a, b) => b.total - a.total);
}

/** Summarise purchases by category and by source over the given receivings (already period/branch-filtered). */
export function purchaseSummary(
  receivings: PurchaseReceiving[],
  itemsById: Map<string, Item>,
  categoriesById: Map<string, ItemCategory>,
): PurchaseSummary {
  const total = round2(receivings.reduce((s, r) => s + r.total_amount, 0));
  return {
    total,
    count: receivings.length,
    byCategory: rows(receivings, (r) => {
      const cat = categoriesById.get(itemsById.get(r.item_id)?.category_id ?? '');
      return {key: cat?.category_key ?? 'unknown', label: cat?.name ?? 'Uncategorised'};
    }, total),
    bySource: rows(receivings, (r) => ({
      key: `${r.source_type}:${r.source_name}`,
      label: `${r.source_name}${r.source_type === 'online' ? ' (online)' : ''}`,
    }), total),
  };
}

/** Keep only receivings on/after `from` and on/before `to` (yyyy-mm-dd; empty = unbounded). */
export function filterByPeriod(receivings: PurchaseReceiving[], from: string, to: string): PurchaseReceiving[] {
  return receivings.filter((r) => (!from || r.received_date >= from) && (!to || r.received_date <= to));
}
