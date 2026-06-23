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

// The permission keys in the catalog after M6 seed + P2-M1 + P2-M2 (M1C §1; crop.manage added by P2-M2).
export type PermissionKey =
  | 'user.read'
  | 'membership.read'
  | 'audit.read'
  | 'company.manage'
  | 'branch.manage'
  | 'role.manage'
  | 'user.invite'
  | 'membership.manage'
  | 'crop.manage';

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
