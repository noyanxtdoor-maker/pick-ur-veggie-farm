// M3B client-seam behavior in mock mode: categories seeded, purchase creates item + stock + receiving (+asset for
// equipment), adjustment enforces reason/stock, low-stock counting. (Server money/FIFO/GL integrity is proven by
// scripts/guards/inventory-security.sql — this covers the app seam.)
import 'fake-indexeddb/auto';
import {describe, expect, it, beforeAll} from 'vitest';
import {DEMO, seedMockData} from '@/app/core/mock/mock';
import {inventoryApi} from '@/app/features/inventory/api';

describe('materials inventory (mock mode)', () => {
  beforeAll(async () => {
    await seedMockData();
  });

  it('seeds the prototype category set on first read', async () => {
    const cats = await inventoryApi.fetchCategories(DEMO.companyId);
    expect(cats.map((c) => c.category_key).sort()).toEqual(['equipment', 'misc', 'packaging', 'seeds', 'substrate', 'transport', 'utilities']);
  });

  it('purchase creates the item, receiving, and branch stock (find-or-create on repeat)', async () => {
    await inventoryApi.recordPurchase(DEMO.companyId, DEMO.branchA, {
      categoryKey: 'substrate', itemName: 'Calcium Nitrate', isEquipment: false,
      quantity: 10, totalCost: 800, sourceType: 'online', sourceName: 'Lazada', purchaseDate: '2026-07-01',
    });
    await inventoryApi.recordPurchase(DEMO.companyId, DEMO.branchA, {
      categoryKey: 'substrate', itemName: 'calcium nitrate', isEquipment: false, // case-insensitive match
      quantity: 20, totalCost: 1000, sourceType: 'physical', sourceName: 'Agri-Supply', purchaseDate: '2026-07-02',
    });
    const items = await inventoryApi.fetchItems(DEMO.companyId, DEMO.branchA);
    const caln = items.filter((i) => i.name.toLowerCase() === 'calcium nitrate');
    expect(caln).toHaveLength(1); // find-or-create, no duplicate item
    expect(caln[0]!.available).toBe(30);
    const recvs = await inventoryApi.fetchReceivings(DEMO.companyId, DEMO.branchA);
    expect(recvs).toHaveLength(2);
    // other branch has no stock (branch-scoped balances)
    const itemsB = await inventoryApi.fetchItems(DEMO.companyId, DEMO.branchB);
    expect(itemsB.find((i) => i.id === caln[0]!.id)!.available).toBe(0);
  });

  it('equipment purchase auto-registers the asset; checklist updates condition + history', async () => {
    await inventoryApi.recordPurchase(DEMO.companyId, DEMO.branchA, {
      categoryKey: 'equipment', itemName: 'Submersible Pump', isEquipment: true,
      quantity: 1, totalCost: 3500, sourceType: 'physical', sourceName: 'Agri-Supply', purchaseDate: '2026-07-02',
    });
    let assets = await inventoryApi.fetchEquipment(DEMO.companyId, DEMO.branchA);
    const pump = assets.find((a) => a.name === 'Submersible Pump')!;
    expect(pump.condition).toBe('Good');
    expect(pump.purchase_cost).toBe(3500);

    await inventoryApi.logCheck(DEMO.companyId, pump, true, true, 'Demo Owner', 'filter wearing out');
    assets = await inventoryApi.fetchEquipment(DEMO.companyId, DEMO.branchA);
    expect(assets.find((a) => a.id === pump.id)!.condition).toBe('Needs Maintenance');
    const logs = await inventoryApi.fetchEquipmentLogs(DEMO.companyId);
    expect(logs.filter((l) => l.equipment_id === pump.id)).toHaveLength(1);
    await expect(inventoryApi.logCheck(DEMO.companyId, pump, true, false, '  ', '')).rejects.toThrow(/inspector/i);
  });

  it('adjustment: reason mandatory, cannot exceed stock, ± math correct', async () => {
    const items = await inventoryApi.fetchItems(DEMO.companyId, DEMO.branchA);
    const caln = items.find((i) => i.name.toLowerCase() === 'calcium nitrate')!;
    await expect(inventoryApi.adjust(DEMO.companyId, DEMO.branchA, caln, -5, '  ')).rejects.toThrow(/reason/i);
    await expect(inventoryApi.adjust(DEMO.companyId, DEMO.branchA, caln, -9999, 'oops')).rejects.toThrow(/stock/i);
    expect(await inventoryApi.adjust(DEMO.companyId, DEMO.branchA, caln, -15, 'spoiled by moisture')).toBe(15);
    expect(await inventoryApi.adjust(DEMO.companyId, DEMO.branchA, caln, 5, 'excess found')).toBe(20);
  });

  it('low-stock counting: consumables only (equipment excluded), respects reorder levels', async () => {
    // Calcium Nitrate at 20 with reorder_level 10 → not low; the pump (Equipment, qty 1) must NOT count
    expect(await inventoryApi.lowStockCount(DEMO.companyId, [DEMO.branchA, DEMO.branchB])).toBe(0);
    await inventoryApi.setLowStockLimit(DEMO.companyId, 25);
    expect(await inventoryApi.lowStockCount(DEMO.companyId, [DEMO.branchA, DEMO.branchB])).toBe(1); // Calcium (20 ≤ 25)
  });
});
