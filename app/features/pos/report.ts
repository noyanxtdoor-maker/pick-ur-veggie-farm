// M2D dashboard/reporting aggregation (pure — no IO; unit-tested). Spec: Phase_2_M2D_Dashboard_Reporting_Spec.md.
// Rows are normalized sales from either source (canonical selects or the device cache). Voided invoices are
// excluded from every metric; outstanding receivables are a BALANCE (all Unpaid rows), not period-scoped.
import {round2} from './money';

export interface ReportLine {
  name: string;
  weight_kg: number;
  line_total: number;
}

export interface ReportSale {
  id: string;
  branch_id: string;
  invoice_number: number | null;
  total: number;
  discount: number;
  delivery_fee: number;
  status: 'Paid' | 'Unpaid' | 'Voided' | 'PendingSync';
  sale_type: 'retail' | 'wholesale'; // wholesale = any bulk (Skip Weigh) line — prototype Transaction.type
  cashier: string | null; // canonical: created_by user id; device cache: posted_by display name; null = unknown
  created_at: string;
  lines: ReportLine[];
}

export interface SalesReport {
  sales: ReportSale[]; // newest first; the last REPORT_WINDOW_DAYS plus ALL Unpaid (receivables balance)
  branchNames: Record<string, string>;
  userNames: Record<string, string>; // only rows the user may read (users RLS: self + user.read)
  source: 'canonical' | 'device'; // device = mock/offline fallback (sales recorded on this device only)
}

// ponytail: fixed 30-day fetch window aggregated client-side (spec §1: ~50–300 sales/day/branch);
// the upgrade path when volumes hurt is a read-only SQL reporting function (additive migration).
export const REPORT_WINDOW_DAYS = 30;

export type PeriodDays = 1 | 7 | 30;

export interface SalesSummary {
  todayVolume: number;
  todayOrders: number;
  todayPendingSync: number;
  topProductToday: string | null;
  receivablesTotal: number;
  receivablesCount: number;
  trend7d: Array<{day: string; date: string; sales: number; orders: number}>;
  paid: {count: number; total: number};
  preorder: {count: number; total: number};
  pendingSync: {count: number; total: number};
  retail: {count: number; total: number};
  wholesale: {count: number; total: number};
  discountGiven: number;
  deliveryFees: number;
  topProducts: Array<{name: string; peso: number; kg: number}>;
  byBranch: Array<{branchId: string; orders: number; total: number}>;
  byCashier: Array<{cashier: string | null; orders: number; total: number}>;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Local-calendar day (the farm's day, not the UTC day — PH is UTC+8).
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function topProducts(rows: ReportSale[], limit = 5): Array<{name: string; peso: number; kg: number}> {
  const m = new Map<string, {peso: number; kg: number}>();
  for (const s of rows)
    for (const l of s.lines) {
      const g = m.get(l.name) ?? {peso: 0, kg: 0};
      m.set(l.name, {peso: round2(g.peso + l.line_total), kg: round2(g.kg + l.weight_kg)});
    }
  return [...m].map(([name, g]) => ({name, ...g})).sort((a, b) => b.peso - a.peso).slice(0, limit);
}

export function summarizeSales(sales: ReportSale[], now: Date, periodDays: PeriodDays): SalesSummary {
  const live = sales.filter((s) => s.status !== 'Voided');
  const today = localDate(now);
  const todaySales = live.filter((s) => localDate(new Date(s.created_at)) === today);
  const unpaid = live.filter((s) => s.status === 'Unpaid');

  const since = new Date(now);
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (periodDays - 1));
  const period = live.filter((s) => new Date(s.created_at) >= since);

  const sum = (rows: ReportSale[]) => ({count: rows.length, total: round2(rows.reduce((a, s) => a + s.total, 0))});
  const split = (st: ReportSale['status']) => sum(period.filter((s) => s.status === st));

  // 7 local-day buckets ending today (prototype chart; honest zeros — no demo backfill).
  const trend7d = Array.from({length: 7}, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const key = localDate(d);
    const rows = live.filter((s) => localDate(new Date(s.created_at)) === key);
    return {day: DAY_NAMES[d.getDay()], date: key, sales: round2(rows.reduce((a, s) => a + s.total, 0)), orders: rows.length};
  });

  const group = (key: (s: ReportSale) => string | null) => {
    const m = new Map<string | null, {orders: number; total: number}>();
    for (const s of period) {
      const g = m.get(key(s)) ?? {orders: 0, total: 0};
      m.set(key(s), {orders: g.orders + 1, total: round2(g.total + s.total)});
    }
    return m;
  };

  return {
    todayVolume: round2(todaySales.reduce((a, s) => a + s.total, 0)),
    todayOrders: todaySales.length,
    todayPendingSync: todaySales.filter((s) => s.status === 'PendingSync').length,
    topProductToday: topProducts(todaySales)[0]?.name ?? null,
    receivablesTotal: round2(unpaid.reduce((a, s) => a + s.total, 0)),
    receivablesCount: unpaid.length,
    trend7d,
    paid: split('Paid'),
    preorder: split('Unpaid'),
    pendingSync: split('PendingSync'),
    retail: sum(period.filter((s) => s.sale_type !== 'wholesale')),
    wholesale: sum(period.filter((s) => s.sale_type === 'wholesale')),
    discountGiven: round2(period.reduce((a, s) => a + s.discount, 0)),
    deliveryFees: round2(period.reduce((a, s) => a + s.delivery_fee, 0)),
    topProducts: topProducts(period),
    byBranch: [...group((s) => s.branch_id)].map(([branchId, g]) => ({branchId: branchId as string, ...g})).sort((a, b) => b.total - a.total),
    byCashier: [...group((s) => s.cashier)].map(([cashier, g]) => ({cashier, ...g})).sort((a, b) => b.total - a.total),
  };
}
