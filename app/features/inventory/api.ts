// Materials & Equipment inventory data-access (M1B A1 seam; spec Phase_2_M3_Inventory_Module_Spec.md).
// Reads: categories/items (+DERIVED per-branch balance), receivings (cards + autocomplete), equipment + logs.
// Writes: MOCK → applied to Dexie (demo, no cloud); real+online → governed rpc (authoritative);
// real+offline → outbox-queued rpc (B5; server idempotency makes replays safe).
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE} from '../../core/mock/mock';
import {round2} from '../pos/money';
import type {EquipmentAsset, EquipmentLog, InventoryItem, InventoryMovement, ItemCategory, PurchaseReceiving} from '../../types/db';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

// The mock's category set (mirror of inventory_ensure_categories).
const CATEGORY_SEED: Array<{key: string; name: string}> = [
  {key: 'seeds', name: 'Seeds/Seedlings'},
  {key: 'substrate', name: 'Substrate & Nutrients'},
  {key: 'packaging', name: 'Packaging'},
  {key: 'utilities', name: 'Water/Electricity'},
  {key: 'transport', name: 'Transport'},
  {key: 'misc', name: 'Miscellaneous'},
  {key: 'equipment', name: 'Equipment'},
];

async function mockEnsureCategories(companyId: string): Promise<void> {
  const have = await offlineDB.itemCategories.where('company_id').equals(companyId).count();
  if (have >= CATEGORY_SEED.length) return;
  const now = new Date().toISOString();
  for (const c of CATEGORY_SEED) {
    const exists = await offlineDB.itemCategories.where('company_id').equals(companyId).filter((r) => r.category_key === c.key).first();
    if (!exists) await offlineDB.itemCategories.put({id: uuidv7(), company_id: companyId, category_key: c.key, name: c.name, status: 'Active', created_at: now});
  }
}

const stockKey = (itemId: string, branchId: string) => `${itemId}:${branchId}`;

async function mockStock(companyId: string, itemId: string, branchId: string): Promise<number> {
  return (await offlineDB.materialStock.get(stockKey(itemId, branchId)))?.available ?? 0;
}

async function mockBumpStock(companyId: string, itemId: string, branchId: string, delta: number): Promise<number> {
  const key = stockKey(itemId, branchId);
  const next = round2((await mockStock(companyId, itemId, branchId)) + delta);
  await offlineDB.materialStock.put({id: key, company_id: companyId, branch_id: branchId, item_id: itemId, available: next});
  return next;
}

export interface PurchaseInput {
  categoryKey: string;
  itemName: string;
  isEquipment: boolean;
  quantity: number;
  totalCost: number;
  sourceType: 'online' | 'physical' | 'vendor';
  sourceName: string;
  sourceContact?: string;
  vendorId?: string | null; // T3.2: set when sourceType='vendor' — server snapshots name/contact from the vendor master
  boughtBy?: string; // P2M3B.1: who physically made the purchase, distinct from who recorded it
  purchaseDate: string; // yyyy-mm-dd
  baseUnit?: string; // P2U1: only applied when the item is first created — ignored on later purchases of the same item
  purchaseOrderRequestId?: string | null; // P2PO1: fulfills an Approved purchase-order request; must resolve to the same item
}

// P2PO1: a queued stock-purchase request. Real-mode only — a request→approve/reject workflow is a
// governed authorization flow, not something the offline demo mock needs to replicate.
export interface PurchaseOrderRequest {
  id: string;
  branch_id: string;
  branch_name: string;
  item_id: string;
  item_name: string;
  quantity: number;
  estimated_unit_cost: number;
  vendor_id: string | null;
  vendor_name: string | null;
  requested_by?: string;
  requester_name?: string;
  status?: 'Pending' | 'Approved' | 'Rejected' | 'Fulfilled';
  decided_by?: string | null;
  decider_name?: string | null;
  decision_notes?: string | null;
  notes: string | null;
  created_at: string;
}

export const inventoryApi = {
  async fetchCategories(companyId: string): Promise<ItemCategory[]> {
    if (MOCK_MODE) {
      await mockEnsureCategories(companyId);
      return offlineDB.itemCategories.where('company_id').equals(companyId).toArray();
    }
    if (online()) await supabase.rpc('inventory_ensure_categories', {p_company: companyId}); // idempotent seed
    const {data, error} = await supabase.from('item_categories').select('*').eq('company_id', companyId).order('name');
    if (error) throw new Error(error.message);
    return (data ?? []) as ItemCategory[];
  },

  async fetchItems(companyId: string, branchId: string): Promise<InventoryItem[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.inventoryItems.where('company_id').equals(companyId).filter((i) => i.status === 'Active').toArray();
      const out: InventoryItem[] = [];
      for (const r of rows) out.push({...r, available: await mockStock(companyId, r.id, branchId)});
      return out;
    }
    const {data, error} = await supabase.from('inventory_items').select('*').eq('company_id', companyId).eq('status', 'Active').order('name');
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<Omit<InventoryItem, 'available'>>;
    const out: InventoryItem[] = [];
    for (const r of rows) {
      const {data: avail, error: e2} = await supabase.rpc('material_available', {p_item_id: r.id, p_branch_id: branchId});
      if (e2) throw new Error(e2.message);
      out.push({...r, reorder_level: Number(r.reorder_level), available: Number(avail ?? 0)});
    }
    return out;
  },

  async fetchReceivings(companyId: string, branchId: string): Promise<PurchaseReceiving[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.purchaseReceivings.where('company_id').equals(companyId).filter((r) => r.branch_id === branchId).toArray();
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    const {data, error} = await supabase.from('purchase_receivings').select('*')
      .eq('company_id', companyId).eq('branch_id', branchId).order('created_at', {ascending: false}).limit(300);
    if (error) throw new Error(error.message);
    return ((data ?? []) as PurchaseReceiving[]).map((r) => ({...r, quantity: Number(r.quantity), total_amount: Number(r.total_amount)}));
  },

  async recordPurchase(companyId: string, branchId: string, input: PurchaseInput): Promise<void> {
    if (input.quantity <= 0 || input.totalCost <= 0) throw new Error('Amounts and counts must be larger than zero.');
    if (!input.itemName.trim()) throw new Error('Item description is required.');
    const idem = uuidv7();
    if (MOCK_MODE) {
      await mockEnsureCategories(companyId);
      const key = input.isEquipment ? 'equipment' : input.categoryKey;
      const cat = (await offlineDB.itemCategories.where('company_id').equals(companyId).filter((c) => c.category_key === key).first())!;
      let item = await offlineDB.inventoryItems.where('company_id').equals(companyId)
        .filter((i) => i.category_id === cat.id && i.name.toLowerCase() === input.itemName.trim().toLowerCase()).first();
      const now = new Date().toISOString();
      if (!item) {
        item = {
          id: uuidv7(), company_id: companyId, category_id: cat.id,
          item_code: `${key.toUpperCase()}-${uuidv7().slice(-8)}`, name: input.itemName.trim(),
          inventory_type: input.isEquipment ? 'Equipment' : 'Consumable', base_unit: input.baseUnit?.trim() || 'pcs',
          purchase_unit: null, unit_conversion_factor: null,
          reorder_level: 10, status: 'Active', created_at: now, updated_at: now,
        };
        await offlineDB.inventoryItems.put(item);
      }
      await offlineDB.purchaseReceivings.put({
        id: idem, company_id: companyId, branch_id: branchId, item_id: item.id,
        quantity: input.quantity, total_amount: round2(input.totalCost),
        source_type: input.sourceType, source_name: input.sourceName.trim() || 'Local Supplier',
        source_contact: input.sourceContact?.trim() || null, vendor_id: input.vendorId ?? null,
        bought_by: input.boughtBy?.trim() || null,
        received_date: input.purchaseDate, created_at: now,
      });
      await mockBumpStock(companyId, item.id, branchId, input.quantity);
      if (input.isEquipment) {
        await offlineDB.equipmentAssets.put({
          id: uuidv7(), company_id: companyId, branch_id: branchId, asset_code: `EQ-${uuidv7().slice(-8)}`,
          name: input.itemName.trim(), purchase_date: input.purchaseDate, purchase_cost: round2(input.totalCost),
          condition: 'Good', created_at: now, updated_at: now,
        });
      }
      return;
    }
    const payload = {
      p_branch_id: branchId, p_category_key: input.categoryKey, p_item_name: input.itemName.trim(),
      p_is_equipment: input.isEquipment, p_quantity: input.quantity, p_total_cost: round2(input.totalCost),
      p_source_type: input.sourceType, p_source_name: input.sourceName.trim() || 'Local Supplier',
      p_source_contact: input.sourceContact?.trim() || null, p_purchase_date: input.purchaseDate,
      p_idempotency_key: idem, p_vendor_id: input.vendorId ?? null, p_bought_by: input.boughtBy?.trim() || null,
      p_base_unit: input.baseUnit?.trim() || null,
      p_purchase_order_request_id: input.purchaseOrderRequestId ?? null,
    };
    if (online()) {
      const {error} = await supabase.rpc('inventory_record_purchase', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'inventory.purchase', request: {type: 'rpc', rpc: 'inventory_record_purchase', payload}});
  },

  // P2M3B.1: edit who physically made a past purchase (owner: "make that column editable").
  async setBoughtBy(companyId: string, receivingId: string, boughtBy: string): Promise<void> {
    const payload = {p_receiving_id: receivingId, p_bought_by: boughtBy.trim() || null};
    if (MOCK_MODE) {
      const row = await offlineDB.purchaseReceivings.get(receivingId);
      if (row) await offlineDB.purchaseReceivings.put({...row, bought_by: boughtBy.trim() || null});
      return;
    }
    if (online()) {
      const {error} = await supabase.rpc('inventory_set_purchase_bought_by', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'inventory.setBoughtBy', request: {type: 'rpc', rpc: 'inventory_set_purchase_bought_by', payload}});
  },

  // P2U1: define/edit the Buy Stock unit-conversion calculator ("1 sack = 50 kg"). Never touches
  // the stock ledger — purely a client-side convenience for entering a purchase quantity in whatever
  // unit the owner actually counts in at the register.
  async setUnitConversion(companyId: string, itemId: string, purchaseUnit: string, conversionFactor: number | null): Promise<void> {
    if (conversionFactor !== null && conversionFactor <= 0) throw new Error('Conversion factor must be greater than zero.');
    const payload = {p_item_id: itemId, p_purchase_unit: purchaseUnit.trim() || null, p_conversion_factor: conversionFactor};
    if (MOCK_MODE) {
      const row = await offlineDB.inventoryItems.get(itemId);
      if (row) await offlineDB.inventoryItems.put({...row, purchase_unit: purchaseUnit.trim() || null, unit_conversion_factor: conversionFactor});
      return;
    }
    if (online()) {
      const {error} = await supabase.rpc('inventory_set_unit_conversion', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'inventory.setUnitConversion', request: {type: 'rpc', rpc: 'inventory_set_unit_conversion', payload}});
  },

  // ± adjustment; reason mandatory (20.09). Returns the new balance when known (mock/online).
  async adjust(companyId: string, branchId: string, item: InventoryItem, qtyDelta: number, reason: string): Promise<number | null> {
    if (!reason.trim()) throw new Error('An adjustment reason is required.');
    if (!qtyDelta) throw new Error('Adjustment must be a non-zero quantity.');
    if (MOCK_MODE) {
      const cur = await mockStock(companyId, item.id, branchId);
      if (qtyDelta < 0 && cur < -qtyDelta) throw new Error(`Adjustment exceeds available stock (${cur}).`);
      return mockBumpStock(companyId, item.id, branchId, qtyDelta);
    }
    const payload = {p_branch_id: branchId, p_item_id: item.id, p_qty_delta: qtyDelta, p_reason: reason.trim(), p_idempotency_key: uuidv7()};
    if (online()) {
      const {data, error} = await supabase.rpc('inventory_adjust_material', payload);
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    }
    await enqueue({companyId, kind: 'inventory.adjust', request: {type: 'rpc', rpc: 'inventory_adjust_material', payload}});
    return null;
  },

  // Usage/adjustment history (owner directive 2026-07-17: what was used, when, by whom). The mock only
  // tracks a derived balance (materialStock), not the append-only ledger, so this is real-mode only.
  async fetchMovements(companyId: string, branchId: string): Promise<InventoryMovement[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.from('inventory_movements').select('*')
      .eq('company_id', companyId).eq('branch_id', branchId).order('created_at', {ascending: false}).limit(300);
    if (error) throw new Error(error.message);
    return ((data ?? []) as InventoryMovement[]).map((m) => ({...m, quantity: Number(m.quantity), unit_cost: Number(m.unit_cost), total_cost: Number(m.total_cost)}));
  },

  // Bulk-apply the mock's single "low-stock limit" to every item (per-item reorder_level stays the canonical field).
  async setLowStockLimit(companyId: string, level: number): Promise<void> {
    if (level < 0) throw new Error('Limit must be >= 0.');
    if (MOCK_MODE) {
      await offlineDB.inventoryItems.where('company_id').equals(companyId).modify({reorder_level: level});
      return;
    }
    const {error} = await supabase.from('inventory_items').update({reorder_level: level}).eq('company_id', companyId);
    if (error) throw new Error(error.message);
  },

  async fetchEquipment(companyId: string, branchId: string): Promise<EquipmentAsset[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.equipmentAssets.where('company_id').equals(companyId).filter((a) => a.branch_id === branchId).toArray();
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    const {data, error} = await supabase.from('equipment_assets').select('*').eq('company_id', companyId).eq('branch_id', branchId).order('name');
    if (error) throw new Error(error.message);
    return ((data ?? []) as EquipmentAsset[]).map((a) => ({...a, purchase_cost: Number(a.purchase_cost)}));
  },

  async fetchEquipmentLogs(companyId: string): Promise<EquipmentLog[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.equipmentLogs.where('company_id').equals(companyId).toArray();
      return rows.sort((a, b) => b.performed_date.localeCompare(a.performed_date));
    }
    const {data, error} = await supabase.from('equipment_maintenance_logs').select('*').eq('company_id', companyId).order('performed_date', {ascending: false}).limit(300);
    if (error) throw new Error(error.message);
    return (data ?? []) as EquipmentLog[];
  },

  async logCheck(companyId: string, asset: EquipmentAsset, working: boolean, needsMaintenance: boolean, inspector: string, notes: string): Promise<void> {
    if (!inspector.trim()) throw new Error('Inspector name is required.');
    const condition: EquipmentAsset['condition'] = !working ? 'Broken' : needsMaintenance ? 'Needs Maintenance' : 'Good';
    if (MOCK_MODE) {
      const now = new Date().toISOString();
      await offlineDB.equipmentLogs.put({
        id: uuidv7(), company_id: companyId, equipment_id: asset.id, working,
        needs_maintenance: needsMaintenance, performed_by_name: inspector.trim(), performed_date: now,
        notes: notes.trim() || null,
      });
      await offlineDB.equipmentAssets.put({...asset, condition, updated_at: now});
      return;
    }
    const payload = {p_asset_id: asset.id, p_working: working, p_needs_maintenance: needsMaintenance, p_inspector: inspector.trim(), p_notes: notes.trim() || null};
    if (online()) {
      const {error} = await supabase.rpc('equipment_log_check', payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'equipment.check', request: {type: 'rpc', rpc: 'equipment_log_check', payload}});
  },

  // Dashboard Low-Stock tile: count items whose TOTAL balance across the member's branches ≤ reorder_level.
  // ponytail: per-item×branch derivation calls at farm scale; a SQL aggregate function when volumes hurt.
  async lowStockCount(companyId: string, branchIds: string[]): Promise<number> {
    if (branchIds.length === 0) return 0;
    if (MOCK_MODE) {
      const items = await offlineDB.inventoryItems.where('company_id').equals(companyId).filter((i) => i.status === 'Active' && i.inventory_type === 'Consumable').toArray();
      let low = 0;
      for (const it of items) {
        let total = 0;
        for (const b of branchIds) total += await mockStock(companyId, it.id, b);
        if (total <= it.reorder_level) low++;
      }
      return low;
    }
    const {data, error} = await supabase.from('inventory_items').select('id, reorder_level').eq('company_id', companyId).eq('status', 'Active').eq('inventory_type', 'Consumable');
    if (error) throw new Error(error.message);
    let low = 0;
    for (const it of (data ?? []) as Array<{id: string; reorder_level: unknown}>) {
      let total = 0;
      for (const b of branchIds) {
        const {data: avail} = await supabase.rpc('material_available', {p_item_id: it.id, p_branch_id: b});
        total += Number(avail ?? 0);
      }
      if (total <= Number(it.reorder_level)) low++;
    }
    return low;
  },

  // P2PO1: queue a stock-purchase request for approval. purchase_order.request OR inventory.purchase
  // required server-side. Real-mode only (see PurchaseOrderRequest comment).
  async requestPurchaseOrder(branchId: string, itemId: string, quantity: number, estimatedUnitCost: number, vendorId: string | null = null, notes: string | null = null): Promise<string> {
    if (quantity <= 0) throw new Error('Quantity must be greater than zero.');
    if (estimatedUnitCost < 0) throw new Error('Estimated unit cost cannot be negative.');
    if (MOCK_MODE) throw new Error('Purchase-order requests are not available in demo mode.');
    const {data, error} = await supabase.rpc('request_purchase_order', {
      p_branch_id: branchId, p_item_id: itemId, p_quantity: quantity, p_estimated_unit_cost: estimatedUnitCost,
      p_vendor_id: vendorId, p_notes: notes,
    });
    if (error) throw new Error(error.message);
    return data as string;
  },

  // inventory.purchase-gated approval queue.
  async listPendingPurchaseOrderRequests(): Promise<PurchaseOrderRequest[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.rpc('list_pending_purchase_order_requests');
    if (error) throw new Error(error.message);
    return ((data ?? []) as PurchaseOrderRequest[]).map((r) => ({...r, quantity: Number(r.quantity), estimated_unit_cost: Number(r.estimated_unit_cost)}));
  },

  // inventory.purchase-gated "ready to buy" queue — Approved, not yet Fulfilled.
  async listApprovedPurchaseOrderRequests(): Promise<PurchaseOrderRequest[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.rpc('list_approved_purchase_order_requests');
    if (error) throw new Error(error.message);
    return ((data ?? []) as PurchaseOrderRequest[]).map((r) => ({...r, quantity: Number(r.quantity), estimated_unit_cost: Number(r.estimated_unit_cost)}));
  },

  // Self-view: the caller's own requests, any status.
  async listMyPurchaseOrderRequests(companyId: string): Promise<PurchaseOrderRequest[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.rpc('list_my_purchase_order_requests', {p_company: companyId});
    if (error) throw new Error(error.message);
    return ((data ?? []) as PurchaseOrderRequest[]).map((r) => ({...r, quantity: Number(r.quantity), estimated_unit_cost: Number(r.estimated_unit_cost)}));
  },

  async approvePurchaseOrderRequest(requestId: string, notes: string | null = null): Promise<void> {
    const {error} = await supabase.rpc('approve_purchase_order_request', {p_request_id: requestId, p_notes: notes});
    if (error) throw new Error(error.message);
  },

  async rejectPurchaseOrderRequest(requestId: string, notes: string): Promise<void> {
    if (!notes.trim()) throw new Error('A reason is required.');
    const {error} = await supabase.rpc('reject_purchase_order_request', {p_request_id: requestId, p_notes: notes.trim()});
    if (error) throw new Error(error.message);
  },
};
