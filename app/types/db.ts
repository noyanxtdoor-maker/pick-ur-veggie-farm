// V3 row types — mirror the locked Phase-1 + Module-1A schema (M1–M6, P2-M1 `a26b667`).
// Source of truth is the database; these are the typed client view. Enums match the DB CHECKs exactly.

export type CompanyStatus = 'Active' | 'Suspended' | 'Archived';
export type BranchStatus = 'Active' | 'Suspended' | 'Archived';
export type RoleStatus = 'Active' | 'Deprecated';
export type PermissionStatus = 'Active' | 'Deprecated';
export type AccountStatus = 'Active' | 'Suspended';
// user_branch_roles.assignment_status is ONLY these two (M3) — there is NO "Suspended" (M1C gap G3).
export type AssignmentStatus = 'Active' | 'Expired';
export type InvitationStatus = 'Pending' | 'Accepted' | 'Revoked' | 'Expired';

export interface Company {
  id: string;
  company_code: string; // immutable identifier
  name: string;
  base_currency_code: string; // immutable, default 'PHP'
  status: CompanyStatus; // service_role-only — not owner-editable
  created_at: string;
  updated_at: string;
}

export interface Branch {
  id: string;
  company_id: string;
  branch_code: string; // immutable after create
  name: string;
  status: BranchStatus;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  company_id: string;
  role_key: string; // immutable after create
  description: string;
  status: RoleStatus;
  created_at: string;
  updated_at: string;
}

export interface Permission {
  id: string;
  permission_key: string;
  description: string;
  status: PermissionStatus;
}

export interface RolePermission {
  id: string;
  company_id: string;
  role_id: string;
  permission_id: string;
  created_at: string; // immutable mapping (no update/delete — M1C gap G1)
}

export interface Membership {
  id: string;
  user_id: string;
  company_id: string;
  branch_id: string;
  role_id: string;
  assignment_status: AssignmentStatus;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppUser {
  id: string;
  auth_user_id: string;
  display_name: string;
  account_status: AccountStatus;
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  company_id: string;
  branch_id: string;
  role_id: string;
  email: string | null;
  token: string;
  status: InvitationStatus;
  invited_by: string;
  accepted_user_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// The permission keys in the catalog after M6 seed + P2-M1 + P2-M2 + P2-M2A/M2B.
export type PermissionKey =
  | 'user.read'
  | 'membership.read'
  | 'audit.read'
  | 'company.manage'
  | 'branch.manage'
  | 'role.manage'
  | 'user.invite'
  | 'membership.manage'
  | 'crop.manage'
  | 'product.manage'
  | 'inventory.opening'
  | 'inventory.adjust'
  | 'pos.sell'
  | 'pos.settle'
  | 'pos.void'
  | 'cash.session'
  | 'inventory.purchase'
  | 'equipment.manage';

// ── POS / Finished-Goods spine (P2-M2A/M2B) ──
export interface Product {
  id: string;
  company_id: string;
  product_code: string; // immutable after create
  name: string;
  retail_per_kg: number; // NUMERIC on the server; the selling price (server is price authority)
  status: 'Active' | 'Archived';
  created_at: string;
  updated_at: string;
}

export interface FinishedGood {
  id: string;
  company_id: string;
  branch_id: string;
  finished_goods_code: string;
  product_id: string;
  origin: 'opening_balance' | 'field_harvest';
  unit: string;
  cost_per_unit: number;
  status: 'Available' | 'Reserved' | 'Sold' | 'Expired';
  created_at: string;
  // client-side augmentation: derived availability (server: fg_available(); mock: maintained locally)
  available: number;
}

export interface PosInvoiceLine {
  product_id: string;
  finished_goods_batch_id: string | null; // null = bulk line; lets mock-mode void restore stock
  name: string;
  weight_kg: number | null; // null = bulk flat-price line (mock "Skip Weigh", P2-M2E)
  unit_price: number; // farm ₱/kg for weighed lines; the negotiated flat ₱ for bulk
  retail_per_kg?: number | null; // prevailing retail snapshot (saved = retail − farm); null/absent = bulk or legacy row
  line_total: number;
}

// Local cache/mock render of a sale (the server truth is sales_orders + invoices, 20.17).
// P2-M2E fields are optional: cache rows written by earlier milestones lack them (reads default them).
export interface PosInvoice {
  id: string;
  company_id: string;
  branch_id: string;
  invoice_number: number | null; // null = pending sync (provisional receipt)
  lines: PosInvoiceLine[];
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  retail_total?: number; // Σ weight × retail (prototype retailTotal)
  saved?: number; // retail_total − subtotal + pre-order discount (prototype "Farm Discount Saved")
  sale_type?: 'retail' | 'wholesale'; // wholesale = any bulk line (prototype Transaction.type)
  posted_by?: string | null; // cashier display-name snapshot (prototype postedBy)
  tender_cash: number;
  change_amount: number;
  note: string | null;
  status: 'Paid' | 'Unpaid' | 'Voided' | 'PendingSync';
  created_at: string;
}

// Local view of the branch cash session (server truth = cash_sessions, 22.09).
export interface PosCashSession {
  id: string;
  branch_id: string;
  opening_cash: number;
  opened_at: string;
  status: 'Open' | 'Closed';
}

// ── Materials & Equipment Inventory (P2-M3A/M3B) — identity in the master, balances DERIVED (20.09). ──
export interface ItemCategory {
  id: string;
  company_id: string;
  category_key: string; // seeds|substrate|packaging|utilities|transport|misc|equipment (mock set)
  name: string;
  status: 'Active' | 'Archived';
  created_at: string;
}

export interface InventoryItem {
  id: string;
  company_id: string;
  category_id: string;
  item_code: string;
  name: string;
  inventory_type: 'Consumable' | 'Equipment';
  base_unit: string; // 'pcs' (mock; unit conversion deferred)
  reorder_level: number; // the mock's low-stock limit (per item; default 10)
  status: 'Active' | 'Inactive' | 'Archived';
  created_at: string;
  updated_at: string;
  // client-side augmentation for the selected branch (server: material_available(); mock: materialStock)
  available: number;
}

export interface PurchaseReceiving {
  id: string;
  company_id: string;
  branch_id: string;
  item_id: string;
  quantity: number;
  total_amount: number;
  source_type: 'online' | 'physical';
  source_name: string;
  source_contact: string | null;
  received_date: string; // date
  created_at: string;
}

export interface EquipmentAsset {
  id: string;
  company_id: string;
  branch_id: string;
  asset_code: string;
  name: string;
  purchase_date: string | null;
  purchase_cost: number;
  condition: 'Good' | 'Needs Maintenance' | 'Broken' | 'Retired';
  created_at: string;
  updated_at: string;
}

export interface EquipmentLog {
  id: string;
  company_id: string;
  equipment_id: string;
  working: boolean;
  needs_maintenance: boolean;
  performed_by_name: string;
  performed_date: string;
  notes: string | null;
}

// ── Crop Management (P2-M2) — status is Active|Archived (no hard delete). ──
export type CropStatus = 'Active' | 'Archived';

export interface CropCategory {
  id: string;
  company_id: string;
  category_code: string; // immutable after create
  name: string;
  description: string | null;
  status: CropStatus;
  created_at: string;
  updated_at: string;
}

export interface CropVariety {
  id: string;
  company_id: string;
  category_id: string;
  variety_code: string; // immutable after create
  name: string;
  description: string | null;
  status: CropStatus;
  created_at: string;
  updated_at: string;
}

export interface CropProfile {
  id: string;
  company_id: string;
  variety_id: string;
  profile_code: string; // immutable after create
  name: string;
  growth_duration_days: number | null; // integer days (not float)
  notes: string | null;
  status: CropStatus;
  created_at: string;
  updated_at: string;
}

export interface PlantingTemplate {
  id: string;
  company_id: string;
  branch_id: string; // branch-owned (is_branch_member)
  profile_id: string;
  template_code: string; // immutable after create
  name: string;
  season: string | null;
  planned_quantity: number; // integer count
  notes: string | null;
  status: CropStatus;
  created_at: string;
  updated_at: string;
}
