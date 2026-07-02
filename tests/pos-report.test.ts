// M2D aggregation behavior (pure — no IO). Proves: voided exclusion, receivables-as-balance, period scoping,
// 7-day bucketing with honest zeros, top-product ranking, split classification, branch/cashier grouping.
import {describe, expect, it} from 'vitest';
import {summarizeSales, type ReportSale} from '../app/features/pos/report';

// Local noon avoids timezone day-boundary flakes; helpers build sales N days back at 10:00 local.
const NOW = new Date('2026-07-02T12:00:00');
const daysAgo = (n: number): string => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
};

let seq = 0;
const sale = (over: Partial<ReportSale>): ReportSale => ({
  id: `s-${++seq}`,
  branch_id: 'br-1',
  invoice_number: seq,
  total: 100,
  discount: 0,
  delivery_fee: 0,
  status: 'Paid',
  created_by: 'u1',
  created_at: daysAgo(0),
  lines: [],
  ...over,
});

describe('summarizeSales', () => {
  it('excludes Voided sales from every metric', () => {
    const s = summarizeSales(
      [
        sale({total: 100, lines: [{name: 'Lettuce', weight_kg: 1, line_total: 100}]}),
        sale({total: 999, status: 'Voided', lines: [{name: 'Gold', weight_kg: 9, line_total: 999}]}),
      ],
      NOW, 7,
    );
    expect(s.todayVolume).toBe(100);
    expect(s.todayOrders).toBe(1);
    expect(s.paid).toEqual({count: 1, total: 100});
    expect(s.trend7d[6].sales).toBe(100);
    expect(s.topProducts.map((p) => p.name)).toEqual(['Lettuce']);
  });

  it('treats receivables as a balance: all Unpaid count, even outside the period', () => {
    const s = summarizeSales(
      [sale({status: 'Unpaid', total: 290, created_at: daysAgo(20)}), sale({status: 'Unpaid', total: 10})],
      NOW, 7,
    );
    expect(s.receivablesTotal).toBe(300);
    expect(s.receivablesCount).toBe(2);
    expect(s.preorder).toEqual({count: 1, total: 10}); // period split stays 7-day-scoped
  });

  it('scopes period metrics: 10-day-old sale is out of 7d, in 30d', () => {
    const rows = [sale({total: 50, discount: 5, delivery_fee: 2, created_at: daysAgo(10)}), sale({total: 100})];
    const week = summarizeSales(rows, NOW, 7);
    expect(week.paid).toEqual({count: 1, total: 100});
    expect(week.discountGiven).toBe(0);
    const month = summarizeSales(rows, NOW, 30);
    expect(month.paid).toEqual({count: 2, total: 150});
    expect(month.discountGiven).toBe(5);
    expect(month.deliveryFees).toBe(2);
    const today = summarizeSales(rows, NOW, 1);
    expect(today.paid).toEqual({count: 1, total: 100});
  });

  it('builds 7 local-day trend buckets with honest zeros', () => {
    const s = summarizeSales([sale({total: 40, created_at: daysAgo(2)}), sale({total: 60, created_at: daysAgo(2)})], NOW, 7);
    expect(s.trend7d).toHaveLength(7);
    expect(s.trend7d[4]).toMatchObject({sales: 100, orders: 2}); // index 4 = 2 days ago
    expect(s.trend7d.filter((b) => b.sales === 0)).toHaveLength(6);
    expect(s.trend7d[6].date).toBe('2026-07-02');
  });

  it('ranks top products by peso and aggregates kg across sales', () => {
    const s = summarizeSales(
      [
        sale({lines: [{name: 'Tomato', weight_kg: 1, line_total: 120}, {name: 'Lettuce', weight_kg: 0.5, line_total: 75}]}),
        sale({lines: [{name: 'Lettuce', weight_kg: 1, line_total: 150}]}),
      ],
      NOW, 7,
    );
    expect(s.topProducts[0]).toEqual({name: 'Lettuce', peso: 225, kg: 1.5});
    expect(s.topProducts[1]).toEqual({name: 'Tomato', peso: 120, kg: 1});
    expect(s.topProductToday).toBe('Lettuce');
  });

  it('classifies the split: Paid, Unpaid (pre-order), PendingSync', () => {
    const s = summarizeSales(
      [sale({status: 'Paid', total: 100}), sale({status: 'Unpaid', total: 200}), sale({status: 'PendingSync', total: 50})],
      NOW, 7,
    );
    expect(s.paid).toEqual({count: 1, total: 100});
    expect(s.preorder).toEqual({count: 1, total: 200});
    expect(s.pendingSync).toEqual({count: 1, total: 50});
    expect(s.todayVolume).toBe(350); // pending-sync sales still count as recorded revenue today
  });

  it('groups by branch and cashier, sorted by total desc, null cashier preserved', () => {
    const s = summarizeSales(
      [
        sale({branch_id: 'br-1', created_by: 'u1', total: 100}),
        sale({branch_id: 'br-2', created_by: null, total: 300}),
        sale({branch_id: 'br-1', created_by: 'u1', total: 50}),
      ],
      NOW, 7,
    );
    expect(s.byBranch).toEqual([
      {branchId: 'br-2', orders: 1, total: 300},
      {branchId: 'br-1', orders: 2, total: 150},
    ]);
    expect(s.byCashier).toEqual([
      {userId: null, orders: 1, total: 300},
      {userId: 'u1', orders: 2, total: 150},
    ]);
  });
});
