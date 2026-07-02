// Verifies the weigh-POS sale flow in mock/offline-dev mode: seeded price book + stock, FARM pricing (P2-M2E:
// charged = retail × 0.90, mock parity), bulk wholesale lines, sale decrements availability, slip-numbered
// invoice, and rejects oversell / insufficient cash. (Server-side money, idempotency, and posting integrity are
// proven by scripts/guards/pos-security.sql — this covers the client seam.)
import 'fake-indexeddb/auto';
import {describe, expect, it, beforeAll} from 'vitest';
import {offlineDB} from '@/app/core/offline/db';
import {DEMO, seedMockData} from '@/app/core/mock/mock';
import {posApi, type SaleLineInput} from '@/app/features/pos/api';
import {farmPerKg, lineTotal, retailLine, round2, formatPeso} from '@/app/features/pos/money';

const weighedLine = (p: {id: string; name: string; retail_per_kg: number}, batchId: string, kg: number): SaleLineInput => ({
  product_id: p.id, finished_goods_batch_id: batchId, name: p.name,
  weight_kg: kg, unit_price: farmPerKg(p.retail_per_kg), retail_per_kg: p.retail_per_kg,
});

describe('weigh-POS (mock mode)', () => {
  beforeAll(async () => {
    await seedMockData();
  });

  it('money helpers: prototype farm pricing, rounding, peso format', () => {
    expect(round2(55.485)).toBe(55.49);
    expect(farmPerKg(150)).toBe(135); // retail × (1 − 0.10)
    expect(lineTotal(2, farmPerKg(150))).toBe(270);
    expect(retailLine(2, 150)).toBe(300);
    expect(formatPeso(1234.5)).toBe('₱1,234.50');
  });

  it('seeds a sellable price book + branch stock', async () => {
    const products = await posApi.fetchProducts(DEMO.companyId);
    expect(products.length).toBeGreaterThanOrEqual(4);
    const stock = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    expect(stock.length).toBeGreaterThanOrEqual(4);
    expect(stock[0]!.available).toBeGreaterThan(0);
  });

  it('records a FARM-priced sale: 2kg @ retail 150 charges 270; saved 30; stock decremented', async () => {
    const products = await posApi.fetchProducts(DEMO.companyId);
    const lettuce = products.find((p) => p.product_code === 'LETTUCE')!;
    const stockBefore = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    const batch = stockBefore.find((f) => f.product_id === lettuce.id)!;

    const {invoice, provisional} = await posApi.recordSale(DEMO.companyId, DEMO.branchA, [weighedLine(lettuce, batch.id, 2)], 500);

    expect(provisional).toBe(false);
    expect(invoice.invoice_number).not.toBeNull();
    expect(invoice.total).toBe(270); // 2kg × ₱135 farm (NOT retail 300)
    expect(invoice.retail_total).toBe(300);
    expect(invoice.saved).toBe(30);
    expect(invoice.sale_type).toBe('retail');
    expect(invoice.posted_by).toBe('Demo Owner');
    expect(invoice.change_amount).toBe(230);
    const stockAfter = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    expect(stockAfter.find((f) => f.id === batch.id)!.available).toBe(batch.available - 2);
    expect(await offlineDB.posInvoices.get(invoice.id)).toBeDefined();
  });

  it('bulk (Skip Weigh) line: flat price, wholesale type, no stock movement', async () => {
    const products = await posApi.fetchProducts(DEMO.companyId);
    const tomato = products.find((p) => p.product_code === 'TOMATO')!;
    const stockBefore = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    const batch = stockBefore.find((f) => f.product_id === tomato.id)!;

    const {invoice} = await posApi.recordSale(DEMO.companyId, DEMO.branchA, [
      {product_id: tomato.id, finished_goods_batch_id: null, name: `${tomato.name} (Bulk Pre-order)`, weight_kg: null, unit_price: 500, retail_per_kg: null},
    ], 500);
    expect(invoice.total).toBe(500);
    expect(invoice.sale_type).toBe('wholesale');
    expect(invoice.saved).toBe(0);
    const stockAfter = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    expect(stockAfter.find((f) => f.id === batch.id)!.available).toBe(batch.available); // bulk never touches stock
  });

  it('preorder discount stacks on the farm subtotal; settle → Paid with change; void → stock restored', async () => {
    const products = await posApi.fetchProducts(DEMO.companyId);
    const lettuce = products.find((p) => p.product_code === 'LETTUCE')!;
    const stock = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    const batch = stock.find((f) => f.product_id === lettuce.id)!;
    const availBefore = batch.available;

    // preorder: 2kg → farm 270 − 10% (27) + ₱20 fee = 263, no cash taken (mock stacking formula)
    const {invoice} = await posApi.recordSale(DEMO.companyId, DEMO.branchA, [weighedLine(lettuce, batch.id, 2)], 0,
      {kind: 'preorder', discountRate: 0.1, deliveryFee: 20, note: 'Deliver to market'});
    expect(invoice.status).toBe('Unpaid');
    expect(invoice.discount).toBe(27);
    expect(invoice.delivery_fee).toBe(20);
    expect(invoice.total).toBe(263);
    expect(invoice.saved).toBe(57); // retail 300 − farm 270 + preorder discount 27 (prototype finalSaved)
    expect(invoice.tender_cash).toBe(0);
    const midStock = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    expect(midStock.find((f) => f.id === batch.id)!.available).toBe(availBefore - 2); // stock leaves on preorder too

    // settle (Mark Paid)
    const change = await posApi.settle(DEMO.companyId, invoice, 500);
    expect(change).toBe(237);
    const settled = (await offlineDB.posInvoices.get(invoice.id))!;
    expect(settled.status).toBe('Paid');

    // void → stock restored
    await posApi.voidSale(DEMO.companyId, settled, 'test reversal');
    expect((await offlineDB.posInvoices.get(invoice.id))!.status).toBe('Voided');
    const afterStock = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    expect(afterStock.find((f) => f.id === batch.id)!.available).toBe(availBefore);
    // void without reason rejected
    await expect(posApi.voidSale(DEMO.companyId, settled, '  ')).rejects.toThrow(/reason/i);
  });

  it('price book management: add / reprice / archive (archive drops it from the grid)', async () => {
    await posApi.addProduct(DEMO.companyId, 'Red Cherry Tomatoes', 200);
    let products = await posApi.fetchProducts(DEMO.companyId);
    const cherry = products.find((p) => p.name === 'Red Cherry Tomatoes')!;
    expect(cherry).toBeDefined();
    expect(cherry.retail_per_kg).toBe(200);

    await posApi.updateProductPrice(cherry, 220);
    products = await posApi.fetchProducts(DEMO.companyId);
    expect(products.find((p) => p.id === cherry.id)!.retail_per_kg).toBe(220);

    await posApi.archiveProduct({...cherry, retail_per_kg: 220});
    products = await posApi.fetchProducts(DEMO.companyId);
    expect(products.find((p) => p.id === cherry.id)).toBeUndefined(); // Active-only grid
  });

  it('rejects oversell and insufficient cash', async () => {
    const products = await posApi.fetchProducts(DEMO.companyId);
    const p = products[0]!;
    const stock = await posApi.fetchStock(DEMO.companyId, DEMO.branchA);
    const batch = stock.find((f) => f.product_id === p.id)!;
    await expect(posApi.recordSale(DEMO.companyId, DEMO.branchA, [weighedLine(p, batch.id, 9999)], 9_999_999)).rejects.toThrow(/stock/i);
    await expect(posApi.recordSale(DEMO.companyId, DEMO.branchA, [weighedLine(p, batch.id, 1)], 1)).rejects.toThrow(/cash/i);
  });
});
