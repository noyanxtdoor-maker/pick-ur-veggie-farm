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
import type {Branch, Company, Employee, FinishedGood, Invitation, Membership, PosInvoice, Permission, PermissionKey, Product, Role} from '../../types/db';

export const MOCK_MODE: boolean =
  !isSupabaseConfigured || (import.meta.env.VITE_USE_MOCK as string | undefined) === 'true';

// Owner report (2026-07-21): this list had drifted behind types/db.ts's PermissionKey union — 9 keys
// added by later features (P1C3/P1D/P1O/P2N2.1/P2-M3B/T3.1/P2PO1) were never added here, so the demo
// owner identity silently couldn't reach Approvals, Vendors, or a handful of other screens in mock
// mode. Keep this in sync with PermissionKey — the mock owner should always hold the full catalog.
const ALL_KEYS: PermissionKey[] = [
  'user.read', 'membership.read', 'audit.read', 'company.manage', 'branch.manage',
  'role.manage', 'user.invite', 'membership.manage', 'membership.approve', 'crop.manage',
  'product.manage', 'product.remove', 'inventory.opening', 'inventory.adjust', 'pos.sell',
  'pos.settle', 'pos.void', 'pos.void.self', 'cash.session', 'inventory.purchase', 'inventory.reports.read', 'equipment.manage',
  'accounting.read', 'accounting.manage', 'payroll.read', 'payroll.manage',
  'schedule.read', 'schedule.manage', 'project.read', 'project.manage',
  'customer.read', 'customer.manage', 'schedule.read_private',
  'finance.account.read', 'finance.account.manage', 'position.manage', 'job_title.manage',
  'vendor.read', 'vendor.manage', 'purchase_order.request',
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

  const company: Company = {id: DEMO.companyId, company_code: 'DEMO-CO', name: 'Demo Farm Co.', base_currency_code: 'PHP', tax_rate: 0, status: 'Active', created_at: now, updated_at: now};
  const branches: Branch[] = [
    {id: DEMO.branchA, company_id: DEMO.companyId, branch_code: 'BR-A1', name: 'North Field', status: 'Active', created_at: now, updated_at: now},
    {id: DEMO.branchB, company_id: DEMO.companyId, branch_code: 'BR-A2', name: 'South Field', status: 'Active', created_at: now, updated_at: now},
  ];
  const coOwnerRole = '00000000-0000-7000-8000-0000000000b3';
  const adminRole = '00000000-0000-7000-8000-0000000000b4';
  const roles: Role[] = [
    {id: DEMO.ownerRole, company_id: DEMO.companyId, role_key: 'OWNER', description: 'Owner', status: 'Active', rank: 50, created_at: now, updated_at: now},
    {id: coOwnerRole, company_id: DEMO.companyId, role_key: 'CO_OWNER', description: 'Co-Owner', status: 'Active', rank: 40, created_at: now, updated_at: now},
    {id: adminRole, company_id: DEMO.companyId, role_key: 'ADMIN', description: 'Administrator', status: 'Active', rank: 30, created_at: now, updated_at: now},
    {id: DEMO.workerRole, company_id: DEMO.companyId, role_key: 'WORKER', description: 'Field worker', status: 'Active', rank: 10, created_at: now, updated_at: now},
  ];
  const permissions: Permission[] = ALL_KEYS.map((k, i) => ({id: `perm-${i}`, permission_key: k, description: k, status: 'Active'}));
  // Extra demo members (owner report 2026-07-21: "confirm one card per member") — a realistic spread of
  // roles and statuses so the Approvals card list, role-reassign dropdown, and Revoke/Reactivate/Archive
  // actions all have something real to show, not just the single seeded owner.
  const coOwnerUserId = '00000000-0000-7000-8000-0000000000c2';
  const adminUserId = '00000000-0000-7000-8000-0000000000c3';
  const revokedUserId = '00000000-0000-7000-8000-0000000000c4';
  const memberships: Membership[] = [
    {id: 'demo-mem-1', user_id: DEMO.userId, company_id: DEMO.companyId, branch_id: DEMO.branchA, role_id: DEMO.ownerRole, assignment_status: 'Active', expires_at: null, created_at: now, updated_at: now},
    {id: 'demo-mem-2', user_id: coOwnerUserId, company_id: DEMO.companyId, branch_id: DEMO.branchA, role_id: coOwnerRole, assignment_status: 'Active', expires_at: null, created_at: now, updated_at: now},
    {id: 'demo-mem-3', user_id: adminUserId, company_id: DEMO.companyId, branch_id: DEMO.branchB, role_id: adminRole, assignment_status: 'Active', expires_at: null, created_at: now, updated_at: now},
    {id: 'demo-mem-4', user_id: revokedUserId, company_id: DEMO.companyId, branch_id: DEMO.branchA, role_id: DEMO.workerRole, assignment_status: 'Expired', expires_at: now, created_at: now, updated_at: now},
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

  // Owner report (2026-07-21): "create a mockup data ... every possible situation/scenario" — a 7-day
  // spread of sales in every status the app actually renders (Paid retail, Voided, Unpaid pre-order,
  // wholesale/bulk), so the Dashboard/POS journal/reports read like a real working farm, not an empty
  // demo shell. day(n) = n days ago at a plausible market hour.
  const day = (daysAgo: number, hour: number, min: number): string => {
    const d = new Date(Date.now() - daysAgo * 86_400_000);
    d.setHours(hour, min, 0, 0);
    return d.toISOString();
  };
  const line = (p: Product, kg: number): PosInvoice['lines'][number] => ({
    product_id: p.id, finished_goods_batch_id: `00000000-0000-7000-8000-0000000000e${products.indexOf(p) + 1}`,
    name: p.name, weight_kg: kg, unit_price: Math.round(p.retail_per_kg * 0.9 * 100) / 100, retail_per_kg: p.retail_per_kg,
    line_total: Math.round(kg * p.retail_per_kg * 0.9 * 100) / 100, cost_per_unit: Math.round(p.retail_per_kg * 0.4 * 100) / 100,
  });
  const [lettuce, tomato, carrot, kangkong] = products as [Product, Product, Product, Product];
  const posInvoices: PosInvoice[] = [
    {id: '00000000-0000-7000-8000-0000000000g1', company_id: DEMO.companyId, branch_id: DEMO.branchA, invoice_number: 1,
      lines: [line(lettuce, 3)], subtotal: 405, discount: 0, delivery_fee: 0, total: 405, retail_total: 450, saved: 45,
      sale_type: 'retail', posted_by: 'Demo Owner', tender_cash: 500, change_amount: 95, note: null, customer_name: null,
      status: 'Paid', created_at: day(6, 8, 12)},
    {id: '00000000-0000-7000-8000-0000000000g2', company_id: DEMO.companyId, branch_id: DEMO.branchA, invoice_number: 2,
      lines: [line(tomato, 5)], subtotal: 540, discount: 0, delivery_fee: 0, total: 540, retail_total: 600, saved: 60,
      sale_type: 'retail', posted_by: 'Arlie Gomez', tender_cash: 540, change_amount: 0, note: null, customer_name: 'Aling Rosa',
      status: 'Paid', created_at: day(5, 9, 30)},
    {id: '00000000-0000-7000-8000-0000000000g3', company_id: DEMO.companyId, branch_id: DEMO.branchA, invoice_number: 3,
      lines: [line(carrot, 2)], subtotal: 162, discount: 0, delivery_fee: 0, total: 162, retail_total: 180, saved: 18,
      sale_type: 'retail', posted_by: 'Demo Owner', tender_cash: 200, change_amount: 38, note: 'Cancelled by customer',
      customer_name: null, status: 'Voided', created_at: day(4, 14, 5)},
    {id: '00000000-0000-7000-8000-0000000000g4', company_id: DEMO.companyId, branch_id: DEMO.branchB, invoice_number: 4,
      lines: [line(kangkong, 8), line(lettuce, 2)], subtotal: 702, discount: 70.2, delivery_fee: 50, total: 681.8,
      retail_total: 780, saved: 148.2, sale_type: 'retail', posted_by: 'Maria Santos', tender_cash: 0, change_amount: 0,
      note: 'Pre-order for Saturday market', customer_name: 'Mang Tomas Sari-Sari', status: 'Unpaid', created_at: day(3, 7, 40)},
    {id: '00000000-0000-7000-8000-0000000000g5', company_id: DEMO.companyId, branch_id: DEMO.branchA, invoice_number: 5,
      lines: [{...line(lettuce, 0), weight_kg: null, unit_price: 380, line_total: 380}], subtotal: 380, discount: 0,
      delivery_fee: 0, total: 380, sale_type: 'wholesale', posted_by: 'Demo Owner', tender_cash: 400, change_amount: 20,
      note: 'Bulk crate — Skip Weigh', customer_name: null, status: 'Paid', created_at: day(2, 6, 55)},
    {id: '00000000-0000-7000-8000-0000000000g6', company_id: DEMO.companyId, branch_id: DEMO.branchA, invoice_number: 6,
      lines: [line(tomato, 4)], subtotal: 432, discount: 0, delivery_fee: 0, total: 432, retail_total: 480, saved: 48,
      sale_type: 'retail', posted_by: 'Arlie Gomez', tender_cash: 500, change_amount: 68, note: null, customer_name: null,
      status: 'Paid', created_at: day(1, 10, 15)},
    {id: '00000000-0000-7000-8000-0000000000g7', company_id: DEMO.companyId, branch_id: DEMO.branchB, invoice_number: 7,
      lines: [line(carrot, 6)], subtotal: 486, discount: 0, delivery_fee: 0, total: 486, retail_total: 540, saved: 54,
      sale_type: 'retail', posted_by: 'Maria Santos', tender_cash: 500, change_amount: 14, note: null, customer_name: null,
      status: 'Paid', created_at: day(0, 7, 20)},
    {id: '00000000-0000-7000-8000-0000000000g8', company_id: DEMO.companyId, branch_id: DEMO.branchA, invoice_number: 8,
      lines: [line(kangkong, 3)], subtotal: 162, discount: 0, delivery_fee: 0, total: 162, retail_total: 180, saved: 18,
      sale_type: 'retail', posted_by: 'Demo Owner', tender_cash: 200, change_amount: 38, note: null, customer_name: null,
      status: 'Paid', created_at: day(0, 8, 45)},
  ];

  // Demo payroll roster (feeds Salaries & Payroll with something real — two workers, one with an
  // outstanding advance so the roster's pill + the Disburse Wage deduction preview both have data).
  const workerPosition = '00000000-0000-7000-8000-0000000000i1';
  const employees: Employee[] = [
    {id: '00000000-0000-7000-8000-0000000000h1', company_id: DEMO.companyId, employee_code: 'EMP-0001', name: 'Ricardo Dela Cruz',
      position_id: workerPosition, daily_rate: 550, date_hired: day(120, 0, 0).slice(0, 10), status: 'Active', user_id: null,
      created_at: now, updated_at: now, advance_balance: 500},
    {id: '00000000-0000-7000-8000-0000000000h2', company_id: DEMO.companyId, employee_code: 'EMP-0002', name: 'Josefina Reyes',
      position_id: workerPosition, daily_rate: 600, date_hired: day(45, 0, 0).slice(0, 10), status: 'Active', user_id: null,
      created_at: now, updated_at: now, advance_balance: 0},
  ];

  await offlineDB.companies.put(company);
  await offlineDB.branches.bulkPut(branches);
  await offlineDB.roles.bulkPut(roles);
  await offlineDB.permissions.bulkPut(permissions);
  await offlineDB.memberships.bulkPut(memberships);
  await offlineDB.invitations.bulkPut(invitations);
  await offlineDB.products.bulkPut(products);
  await offlineDB.finishedGoods.bulkPut(finishedGoods);
  await offlineDB.posInvoices.bulkPut(posInvoices);
  await offlineDB.employees.bulkPut(employees);
  await offlineDB.meta.bulkPut([
    {key: 'perm-snapshot', value: {companyId: DEMO.companyId, keys: ALL_KEYS}},
    {key: 'active-company', value: DEMO.companyId},
    {key: 'mock-users', value: [
      {id: DEMO.userId, display_name: 'Demo Owner'},
      {id: coOwnerUserId, display_name: 'Arlie Gomez'},
      {id: adminUserId, display_name: 'Maria Santos'},
      {id: revokedUserId, display_name: 'J. Dela Cruz'},
    ] satisfies MockUser[]},
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
