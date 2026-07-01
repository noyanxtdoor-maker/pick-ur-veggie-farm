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
  | 'pos.sell';

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
  name: string;
  weight_kg: number;
  unit_price: number;
  line_total: number;
}

// Local cache/mock render of a sale (the server truth is sales_orders + invoices, 20.17).
export interface PosInvoice {
  id: string;
  company_id: string;
  branch_id: string;
  invoice_number: number | null; // null = pending sync (provisional receipt)
  lines: PosInvoiceLine[];
  total: number;
  tender_cash: number;
  change_amount: number;
  status: 'Paid' | 'PendingSync';
  created_at: string;
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
