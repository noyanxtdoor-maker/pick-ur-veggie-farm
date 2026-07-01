// Local-first store (B5 §4) + the durable write-ahead outbox (M1B O1). IndexedDB via Dexie.
// Cache holds only authorized-branch data the user has read (scoped); the outbox holds unsynced writes.
import Dexie, {type Table} from 'dexie';
import type {Branch, Company, CropCategory, CropProfile, CropVariety, FinishedGood, Invitation, Membership, Permission, PlantingTemplate, PosInvoice, Product, Role} from '../../types/db';

export type OutboxState = 'Pending' | 'Uploading' | 'Completed' | 'Failed' | 'Blocked';

// Transport-agnostic write description (M1B A1 — the api layer interprets it; the queue never imports supabase).
export interface SyncRequest {
  type: 'insert' | 'update' | 'rpc';
  table?: string;
  rpc?: string;
  payload: Record<string, unknown>;
  // optimistic-concurrency base for updates (M1B C1) — server compares before applying.
  match?: {id: string; baseUpdatedAt?: string};
}

export interface OutboxItem {
  id: string; // local id (uuidv7), primary key
  idempotencyKey: string; // uuidv7, unique — the dedup key (B5 §2)
  companyId: string;
  kind: string; // e.g. 'branch.create' — for display/audit
  request: SyncRequest;
  state: OutboxState;
  attempts: number;
  lastError: string | null;
  result: unknown; // server-returned authoritative result once Completed
  createdAt: number;
  updatedAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export class OfflineDB extends Dexie {
  outbox!: Table<OutboxItem, string>;
  companies!: Table<Company, string>;
  branches!: Table<Branch, string>;
  roles!: Table<Role, string>;
  permissions!: Table<Permission, string>;
  memberships!: Table<Membership, string>;
  invitations!: Table<Invitation, string>;
  cropCategories!: Table<CropCategory, string>;
  cropVarieties!: Table<CropVariety, string>;
  cropProfiles!: Table<CropProfile, string>;
  plantingTemplates!: Table<PlantingTemplate, string>;
  products!: Table<Product, string>;
  finishedGoods!: Table<FinishedGood, string>;
  posInvoices!: Table<PosInvoice, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'PickUrVeggieV3') {
    super(name);
    this.version(1).stores({
      // &idempotencyKey = unique; [state+createdAt] for ordered draining; createdAt for FIFO.
      outbox: 'id, &idempotencyKey, state, createdAt, companyId',
      companies: 'id, company_code',
      branches: 'id, company_id, status',
      roles: 'id, company_id, status',
      permissions: 'id, permission_key',
      memberships: 'id, company_id, user_id, assignment_status',
      invitations: 'id, company_id, status',
      meta: 'key',
    });
    // P2-M2 crop tables (additive version — scoped/indexed reads, M1B F2).
    this.version(2).stores({
      cropCategories: 'id, company_id, status',
      cropVarieties: 'id, company_id, category_id, status',
      cropProfiles: 'id, company_id, variety_id, status',
      plantingTemplates: 'id, company_id, branch_id, profile_id, status',
    });
    // P2-M2A/M2B POS tables (additive): price book, finished-goods stock cache, local invoice cache.
    this.version(3).stores({
      products: 'id, company_id, status',
      finishedGoods: 'id, company_id, branch_id, product_id, status',
      posInvoices: 'id, company_id, branch_id, created_at',
    });
  }
}

export const offlineDB = new OfflineDB();

// Purge all scoped/cached data (M1B S1 — on logout, revocation, or company switch). Outbox is preserved
// only for the same company; everything else is server-re-derivable.
export async function purgeCache(db: OfflineDB = offlineDB): Promise<void> {
  const tables = [db.companies, db.branches, db.roles, db.permissions, db.memberships, db.invitations, db.cropCategories, db.cropVarieties, db.cropProfiles, db.plantingTemplates, db.products, db.finishedGoods, db.posInvoices, db.meta];
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
  });
}
