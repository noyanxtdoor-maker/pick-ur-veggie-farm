// Verifies the weigh-POS sale flow in mock/offline-dev mode: seeded price book + stock, sale decrements
// availability, produces a slip-numbered invoice, and rejects oversell / insufficient cash. (Server-side money,
// idempotency, and posting integrity are proven by scripts/guards/pos-security.sql — this covers the client seam.)
import 'fake-indexeddb/auto';
import {describe, expect, it, beforeAll} from 'vitest';
import {offlineDB} from '@/app/core/offline/db';
import {DEMO, seedMockData} from '@/app/core/mock/mock';
import {posApi} from '@/app/features/pos/api';
import {lineTotal, round2, formatPeso} from '@/app/features/pos/money';

describe('weigh-POS (mock mode)', () => {
  beforeAll(async () => {
    await seedMockData();
  });

  it('money helpers round half-up to 2dp and format pesos', () => {
    expect(round2(55.485)).toBe(55.49);
    expect(lineTotal(2, 150)).toBe(300);
    expect(formatPeso(1234.5)).toBe('₱1,234.50');
  });

  it('seeds a sellable price book + branch stock', async () => {
    const products = await posApi.fetchProducts(DEMO.companyId);
    expect(products.length).toBeGreaterThanOrEqual(4);
    const stock = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    expect(stock.length).toBeGreaterThanOrEqual(4);
    expect(stock[0]!.available).toBeGreaterThan(0);
  });

  it('records a sale: stock decremented, slip-numbered invoice, correct change', async () => {
    const products = await posApi.fetchProducts(DEMO.companyId);
    const lettuce = products.find((p) => p.product_code === 'LETTUCE')!;
    const stockBefore = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    const batch = stockBefore.find((f) => f.product_id === lettuce.id)!;

    const {invoice, provisional} = await posApi.recordSale(DEMO.companyId, DEMO.branchA, [
      {product_id: lettuce.id, finished_goods_batch_id: batch.id, name: lettuce.name, weight_kg: 2, unit_price: lettuce.retail_per_kg},
    ], 500);

    expect(provisional).toBe(false);
    expect(invoice.invoice_number).not.toBeNull();
    expect(invoice.total).toBe(300); // 2kg × ₱150
    expect(invoice.change_amount).toBe(200);
    const stockAfter = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    expect(stockAfter.find((f) => f.id === batch.id)!.available).toBe(batch.available - 2);
    expect(await offlineDB.posInvoices.get(invoice.id)).toBeDefined();
  });

  it('rejects oversell and insufficient cash', async () => {
    const products = await posApi.fetchProducts(DEMO.companyId);
    const p = products[0]!;
    const stock = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    const batch = stock.find((f) => f.product_id === p.id)!;
    await expect(posApi.recordSale(DEMO.companyId, DEMO.branchA, [
      {product_id: p.id, finished_goods_batch_id: batch.id, name: p.name, weight_kg: 9999, unit_price: p.retail_per_kg},
    ], 9_999_999)).rejects.toThrow(/stock/i);
    await expect(posApi.recordSale(DEMO.companyId, DEMO.branchA, [
      {product_id: p.id, finished_goods_batch_id: batch.id, name: p.name, weight_kg: 1, unit_price: p.retail_per_kg},
    ], 1)).rejects.toThrow(/cash/i);
  });
});
