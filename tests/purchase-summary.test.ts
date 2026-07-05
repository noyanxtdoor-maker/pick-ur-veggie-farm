// Purchase Summary (B-report) — pure aggregation over receivings: totals by category + by source, % shares,
// and period filtering. No DB/GL; the data comes from receivings the app records at each purchase.
import {describe, expect, it} from 'vitest';
import {purchaseSummary, filterByPeriod} from '@/app/features/inventory/purchaseSummary';
import type {InventoryItem, ItemCategory, PurchaseReceiving} from '@/app/types/db';

const cat = (id: string, key: string, name: string): ItemCategory =>
  ({id, company_id: 'c', category_key: key, name} as ItemCategory);
const item = (id: string, category_id: string): Omit<InventoryItem, 'available'> =>
  ({id, company_id: 'c', branch_id: 'b', category_id, name: id, base_unit: 'kg', reorder_level: 0, inventory_type: 'Consumable', status: 'Active', created_at: '', updated_at: ''} as unknown as Omit<InventoryItem, 'available'>);
const recv = (item_id: string, total: number, qty: number, source_type: 'online' | 'physical', source_name: string, date: string): PurchaseReceiving =>
  ({id: `${item_id}-${date}`, company_id: 'c', branch_id: 'b', item_id, quantity: qty, total_amount: total, source_type, source_name, source_contact: null, received_date: date, created_at: ''});

const cats = new Map([cat('cat-seed', 'seeds', 'Seeds/Seedlings'), cat('cat-fert', 'fertilizer', 'Fertilizer')].map((c) => [c.id, c]));
const items = new Map([item('seed1', 'cat-seed'), item('fert1', 'cat-fert')].map((i) => [i.id, i]));
const receivings: PurchaseReceiving[] = [
  recv('seed1', 1000, 5, 'online', 'Lazada', '2026-07-01'),
  recv('fert1', 3000, 10, 'online', 'Shopee', '2026-07-03'),
  recv('seed1', 1000, 5, 'physical', 'Bogo Agrivet', '2026-06-20'),
];

describe('purchaseSummary', () => {
  const s = purchaseSummary(receivings, items, cats);

  it('totals overall spend and line count', () => {
    expect(s.total).toBe(5000);
    expect(s.count).toBe(3);
  });

  it('groups by category, sorted by spend, with % shares summing ~100', () => {
    expect(s.byCategory.map((r) => r.label)).toEqual(['Fertilizer', 'Seeds/Seedlings']);
    expect(s.byCategory.find((r) => r.label === 'Seeds/Seedlings')).toMatchObject({total: 2000, count: 2, qty: 10});
    expect(s.byCategory.find((r) => r.label === 'Fertilizer')).toMatchObject({total: 3000, count: 1});
    expect(Math.round(s.byCategory.reduce((a, r) => a + r.pct, 0))).toBe(100);
  });

  it('groups by source and labels online sources', () => {
    expect(s.bySource.find((r) => r.label === 'Shopee (online)')).toMatchObject({total: 3000});
    expect(s.bySource.find((r) => r.label === 'Lazada (online)')).toMatchObject({total: 1000});
    expect(s.bySource.find((r) => r.label === 'Bogo Agrivet')).toMatchObject({total: 1000});
  });
});

describe('filterByPeriod', () => {
  it('keeps receivings within the inclusive date window', () => {
    expect(filterByPeriod(receivings, '2026-07-01', '2026-07-31')).toHaveLength(2); // drops the June one
    expect(filterByPeriod(receivings, '', '')).toHaveLength(3); // unbounded = all
    expect(purchaseSummary(filterByPeriod(receivings, '2026-07-01', '2026-07-31'), items, cats).total).toBe(4000);
  });
});
