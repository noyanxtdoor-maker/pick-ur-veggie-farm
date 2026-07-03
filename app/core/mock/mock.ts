// Mock / offline-dev adapter (M1D requirement: "mock auth adapter if cloud schema unavailable").
// When Supabase is unconfigured (or VITE_USE_MOCK=true) the app runs entirely off seeded local data:
//  • auth is mocked (any credentials sign in),
//  • the permission snapshot grants the full catalog,
//  • reads come from seeded Dexie,
//  • the outbox drains through mockSender, which applies writes to Dexie (so create/edit/archive work locally).
// This lets you start the app, navigate every Module-1 screen, and validate the offline architecture with NO cloud.
import type {Table} from 'dexie';
import {isSupabaseConfigured} from '../supabase/client';
import {offlineDB} from '../offline/db';
import {uuidv7} from '../offline/uuidv7';
import type {OutboxItem} from '../offline/db';
import type {SendResult, Sender} from '../offline/queue';
import type {Branch, Company, FinishedGood, Invitation, Membership, Permission, PermissionKey, Product, Role} from '../../types/db';

export const MOCK_MODE: boolean =
  !isSupabaseConfigured || (import.meta.env.VITE_USE_MOCK as string | undefined) === 'true';

const ALL_KEYS: PermissionKey[] = [
  'user.read', 'membership.read', 'audit.read', 'company.manage', 'branch.manage',
  'role.manage', 'user.invite', 'membership.manage', 'crop.manage',
  'product.manage', 'inventory.opening', 'inventory.adjust', 'pos.sell',
  'pos.settle', 'pos.void', 'cash.session', 'inventory.purchase', 'equipment.manage',
  'accounting.read', 'accounting.manage',
];

// Fixed, valid-format UUIDs so the create forms (which validate ids as uuid) accept the seeded selections.
export const DEMO = {
  companyId: '00000000-0000-7000-8000-000000000001',
  branchA: '00000000-0000-7000-8000-0000000000a1',
  branchB: '00000000-0000-7000-8000-0000000000a2',
  ownerRole: '00000000-0000-7000-8000-0000000000b1',
  workerRole: '00000000-0000-7000-8000-0000000000b2',
  userId: '00000000-0000-7000-8000-0000000000c1',
  authId: '00000000-0000-7000-8000-0000000000d1',
} as const;

export interface MockUser {
  id: string;
  display_name: string;
}

// Idempotent seed of a demo company/branches/roles/permissions/membership/invitation + the permission snapshot.
export async function seedMockData(): Promise<void> {
  if (!MOCK_MODE) return;
  // Always refresh the permission snapshot (heals devices seeded before newer keys existed).
  await offlineDB.meta.put({key: 'perm-snapshot', value: {companyId: DEMO.companyId, keys: ALL_KEYS}});
  if (await offlineDB.companies.get(DEMO.companyId)) return; // data already seeded
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const company: Company = {id: DEMO.companyId, company_code: 'DEMO-CO', name: 'Demo Farm Co.', base_currency_code: 'PHP', status: 'Active', created_at: now, updated_at: now};
  const branches: Branch[] = [
    {id: DEMO.branchA, company_id: DEMO.companyId, branch_code: 'BR-A1', name: 'North Field', status: 'Active', created_at: now, updated_at: now},
    {id: DEMO.branchB, company_id: DEMO.companyId, branch_code: 'BR-A2', name: 'South Field', status: 'Active', created_at: now, updated_at: now},
  ];
  const roles: Role[] = [
    {id: DEMO.ownerRole, company_id: DEMO.companyId, role_key: 'OWNER', description: 'Owner', status: 'Active', created_at: now, updated_at: now},
    {id: DEMO.workerRole, company_id: DEMO.companyId, role_key: 'WORKER', description: 'Field worker', status: 'Active', created_at: now, updated_at: now},
  ];
  const permissions: Permission[] = ALL_KEYS.map((k, i) => ({id: `perm-${i}`, permission_key: k, description: k, status: 'Active'}));
  const memberships: Membership[] = [
    {id: 'demo-mem-1', user_id: DEMO.userId, company_id: DEMO.companyId, branch_id: DEMO.branchA, role_id: DEMO.ownerRole, assignment_status: 'Active', expires_at: null, created_at: now, updated_at: now},
  ];
  const invitations: Invitation[] = [
    {id: 'demo-inv-1', company_id: DEMO.companyId, branch_id: DEMO.branchA, role_id: DEMO.workerRole, email: 'invitee@demo.local', token: 'demo-token', status: 'Pending', invited_by: DEMO.userId, accepted_user_id: null, expires_at: expires, created_at: now, updated_at: now},
  ];

  // POS demo data: a small price book + finished-goods stock in Branch A (weigh-POS is usable offline/demo).
  const products: Product[] = [
    {id: '00000000-0000-7000-8000-0000000000f1', company_id: DEMO.companyId, product_code: 'LETTUCE', name: 'Lettuce', retail_per_kg: 150, status: 'Active', created_at: now, updated_at: now},
    {id: '00000000-0000-7000-8000-0000000000f2', company_id: DEMO.companyId, product_code: 'TOMATO', name: 'Tomato', retail_per_kg: 120, status: 'Active', created_at: now, updated_at: now},
    {id: '00000000-0000-7000-8000-0000000000f3', company_id: DEMO.companyId, product_code: 'CARROT', name: 'Carrots', retail_per_kg: 90, status: 'Active', created_at: now, updated_at: now},
    {id: '00000000-0000-7000-8000-0000000000f4', company_id: DEMO.companyId, product_code: 'KANGKONG', name: 'Kangkong', retail_per_kg: 60, status: 'Active', created_at: now, updated_at: now},
  ];
  const finishedGoods: FinishedGood[] = products.map((p, i) => ({
    id: `00000000-0000-7000-8000-0000000000e${i + 1}`,
    company_id: DEMO.companyId,
    branch_id: DEMO.branchA,
    finished_goods_code: `FG-${p.product_code}`,
    product_id: p.id,
    origin: 'opening_balance',
    unit: 'kg',
    cost_per_unit: Math.round(p.retail_per_kg * 0.4 * 100) / 100,
    status: 'Available',
    created_at: now,
    available: 25,
  }));

  await offlineDB.companies.put(company);
  await offlineDB.branches.bulkPut(branches);
  await offlineDB.roles.bulkPut(roles);
  await offlineDB.permissions.bulkPut(permissions);
  await offlineDB.memberships.bulkPut(memberships);
  await offlineDB.invitations.bulkPut(invitations);
  await offlineDB.products.bulkPut(products);
  await offlineDB.finishedGoods.bulkPut(finishedGoods);
  await offlineDB.meta.bulkPut([
    {key: 'perm-snapshot', value: {companyId: DEMO.companyId, keys: ALL_KEYS}},
    {key: 'active-company', value: DEMO.companyId},
    {key: 'mock-users', value: [{id: DEMO.userId, display_name: 'Demo Owner'}] satisfies MockUser[]},
  ]);
}

export async function mockUsers(): Promise<MockUser[]> {
  const m = await offlineDB.meta.get('mock-users');
  return (m?.value as MockUser[] | undefined) ?? [];
}

// Mock READ adapter: serve a company-scoped list straight from Dexie (no network) in mock/offline-dev mode.
export async function mockRead<T>(serverTable: string, companyId: string): Promise<T[]> {
  const table = TABLE_MAP[serverTable];
  if (!table) return [];
  return (await table.where('company_id').equals(companyId).toArray()) as unknown as T[];
}

type AnyRow = {id: string} & Record<string, unknown>;
const tbl = (t: Table<unknown, string>) => t as unknown as Table<AnyRow, string>;
// Server table name → local Dexie table (note user_branch_roles → memberships). role_permissions has no local
// table (it is derived), so it is intentionally absent → a no-op apply.
const TABLE_MAP: Record<string, Table<AnyRow, string>> = {
  companies: tbl(offlineDB.companies),
  branches: tbl(offlineDB.branches),
  roles: tbl(offlineDB.roles),
  user_branch_roles: tbl(offlineDB.memberships),
  invitations: tbl(offlineDB.invitations),
  crop_categories: tbl(offlineDB.cropCategories),
  crop_varieties: tbl(offlineDB.cropVarieties),
  crop_profiles: tbl(offlineDB.cropProfiles),
  planting_templates: tbl(offlineDB.plantingTemplates),
  products: tbl(offlineDB.products),
  finished_goods_batches: tbl(offlineDB.finishedGoods),
};

// The mock write adapter: the outbox drains into Dexie (the "server" is the local cache). Validates the full
// offline write path end-to-end with no network.
export const mockSender: Sender = async (item: OutboxItem): Promise<SendResult> => {
  const {request} = item;
  const table = request.table ? TABLE_MAP[request.table] : undefined;
  const now = new Date().toISOString();
  if (request.type === 'insert') {
    if (table) await table.put({id: uuidv7(), status: 'Active', created_at: now, updated_at: now, ...request.payload});
    return {ok: true, result: {mock: true}};
  }
  if (request.type === 'update' && table && request.match) {
    const existing = await table.get(request.match.id);
    if (existing) await table.put({...existing, ...request.payload, updated_at: now});
    return {ok: true};
  }
  if (request.type === 'rpc') return {ok: true, result: `mock-token-${uuidv7()}`};
  return {ok: true};
};
