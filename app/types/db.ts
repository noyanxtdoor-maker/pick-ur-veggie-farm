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
  tax_rate: number; // P2S1: company-wide sales/VAT tax rate (%), company.manage-editable, server-synced
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
  rank: number; // P1C: 0-100 authority tier (0=custom/unranked, 10=employee..50=owner). Governed data, never derived from role_key.
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
  username: string | null; // P1J: auto-generated login alias, never an authorization input
  account_status: AccountStatus;
  job_title: string | null; // P1D: purely descriptive, editable by job_title.manage holders only, no payroll link
  payroll_exempt: boolean; // P1D: true once an admin marks this account as not requiring a payroll link
  created_at: string;
  updated_at: string;
}

// P1C §2.4: server-enforced per-user permission override. Written only via the set_user_permission_override
// RPC (rank-checked, audited); never written directly by the client.
export type OverrideEffect = 'grant' | 'deny';

export interface UserPermissionOverride {
  id: string;
  company_id: string;
  user_id: string;
  permission_id: string;
  effect: OverrideEffect;
  created_by: string;
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
  | 'product.remove' // P1O: request-only removal tier (employee/operator default) — needs product.manage approval
  | 'inventory.opening'
  | 'inventory.adjust'
  | 'pos.sell'
  | 'pos.settle'
  | 'pos.void'
  | 'pos.void.self' // P2N2.1: approve own void request below admin rank — admin+ already can via rank
  | 'cash.session'
  | 'inventory.purchase'
  | 'equipment.manage'
  | 'accounting.read'
  | 'accounting.manage'
  | 'payroll.read'
  | 'payroll.manage'
  | 'schedule.read'
  | 'schedule.manage'
  | 'schedule.read_private' // P2-M6C: see Management-tier calendar entries (meetings/investor plans)
  | 'project.read'
  | 'project.manage'
  | 'customer.read'
  | 'customer.manage'
  | 'finance.account.read' // P2-B2A: view financial accounts + derived balances
  | 'finance.account.manage' // P2-B2A: create/edit accounts + transfer between them
  | 'position.manage' // P1D: add/rename/deactivate the Farm Hand position picklist (co_owner/owner by default)
  | 'job_title.manage' // P1D: set another company member's descriptive job title (admin+ by default)
  | 'membership.approve' // P1C3: approve/reject pending sign-ups only — the lighter tier below membership.manage (admin by default)
  | 'inventory.reports.read' // P2-M3B: view the Stock Inventories "Purchase Summary" tab (admin+ default) — does not gate buying stock
  | 'vendor.read' // T3.1: view vendors, cost schedules, and AP standing
  | 'vendor.manage' // T3.1: create/edit vendors, cost schedules, and post AP invoices/payments
  | 'purchase_order.request'; // P2PO1: request a stock purchase for approval — employee default; inventory.purchase holders decide

// ── Digital payments (P2-B2A / backlog B2, 20.24 + 22.10) ──
// Thin registry keyed to a chart_of_accounts Asset code. NO stored balance anywhere —
// `balance` on reads is DERIVED from journal_lines (server) or paid invoices + transfers (mock).
export interface FinancialAccount {
  id: string;
  company_id: string;
  branch_id: string;
  name: string;
  account_type: 'Cash' | 'Bank' | 'Digital Wallet';
  provider: string | null;
  account_number: string | null;
  coa_code: string;
  status: 'Active' | 'Archived';
  created_at: string;
  updated_at: string;
}

export interface FinancialTransfer {
  id: string;
  company_id: string;
  branch_id: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  note: string | null;
  created_at: string;
}

// ── VeggieGenius Copilot (CAP-VG1 v1) — CLIENT-ONLY chat history (spec §3: "the answer is not stored"
// server-side; no sync, no audit surface, no money path). Field is `chatRole`, NOT `role` — chat message
// roles are not auth roles, and the no-role-name-auth static guard must stay clean (lesson ported from
// Repo B's build, owner-authorized lane).
export interface CopilotMessage {
  id: string;
  chatRole: 'user' | 'assistant';
  content: string;
  timestamp: number; // epoch ms
  grounded?: boolean;
  model?: string; // assistant messages: which local model answered
  offline?: boolean; // true = offline-degrade fallback (no model involved)
}

// ── Customers & Credit (P2-M9A / backlog B1) ──
export interface Customer {
  id: string;
  company_id: string;
  name: string;
  contact: string | null;
  credit_limit: number | null; // null = no explicit limit
  notes: string | null;
  status: 'Active' | 'Archived';
  created_at: string;
}

export interface CustomerStanding {
  customer_id: string;
  name: string;
  status: 'Active' | 'Archived';
  credit_limit: number | null;
  outstanding_ar: number; // Σ unpaid invoice totals (derived)
  available_credit: number | null; // credit_limit − outstanding, null when no limit
}

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

// P1O: pending product-removal queue row, shaped by list_pending_product_removals() (server-joined names).
export interface ProductRemovalRequest {
  id: string;
  product_id: string;
  product_name: string;
  requested_by: string;
  requester_name: string;
  reason: string;
  created_at: string;
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
  cost_per_unit?: number; // batch cost at sale time (P2-M4A, mock-mode COGS for the accounting reads); 0/absent for bulk lines
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
  customer_name?: string | null; // P2-M2G: free-text walk-in customer name, printed on the receipt
  customer_id?: string | null; // P2-M9A: optional customer attribution (credit sales)
  financial_account_id?: string | null; // P2-B2A: where the money landed (null = cash drawer)
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
  base_unit: string; // the unit STOCK is tracked in (e.g. 'kg'); settable at creation (P2U1), immutable after
  purchase_unit: string | null; // P2U1: the unit this item is normally BOUGHT in (e.g. 'sack'), for the Buy Stock calculator
  unit_conversion_factor: number | null; // P2U1: how many base_units equal one purchase_unit (e.g. 50)
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
  source_type: 'online' | 'physical' | 'vendor';
  source_name: string;
  source_contact: string | null;
  vendor_id: string | null; // T3.2: set when source_type='vendor' — links back to the vendor master
  bought_by: string | null; // P2M3B.1: who physically made the purchase, distinct from received_by (who recorded it)
  received_date: string; // date
  created_at: string;
}

// Append-only ledger row (P2-M2A/M3A, 20.09) — server-derived balances read from this; movements are
// never edited/deleted. actor_user_id resolves to a display name client-side via membershipsApi.
export interface InventoryMovement {
  id: string;
  company_id: string;
  branch_id: string;
  item_id: string | null;
  movement_type: 'PurchaseReceiving' | 'AdjustmentIncrease' | 'AdjustmentDecrease' | string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  reason: string | null;
  actor_user_id: string | null;
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
  useful_life_months: number | null; // P2ED1: straight-line depreciation period; null = not configured
  salvage_value: number; // P2ED1: estimated residual value at end of useful_life_months
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

// ── Accounting (P2-M4A/M4B) — non-operating cash movements + statements READ from the real GL. ──
export type CashFlowDirection = 'in' | 'out';
export type CashEntryCategory = 'Owner Investment' | 'Other Income' | 'Loan Received' | 'Loan Payment' | "Owner's Drawings";

export interface CashEntry {
  id: string;
  company_id: string;
  branch_id: string;
  entry_date: string; // yyyy-mm-dd
  flow: CashFlowDirection;
  category: CashEntryCategory;
  description: string | null;
  amount: number;
  status: 'Posted' | 'Voided';
  void_reason: string | null;
  created_at: string;
}

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';
  normal_balance: 'debit' | 'credit';
  total_debit: number;
  total_credit: number;
}

export interface IncomeStatementMonth {
  month_num: number;
  month_name: string;
  retail_revenue: number;
  wholesale_revenue: number;
  total_revenue: number;
  cogs: number;
  gross_profit: number;
  shrinkage: number;
  operating_expenses: number;
  total_opex: number;
  net_income: number;
}

export interface CashFlowLine {
  activity: 'Operating' | 'Investing' | 'Financing' | 'Reconciliation';
  line_label: string;
  amount: number;
  sort_order: number;
}

export interface BalanceSheet {
  cash: number;
  accounts_receivable: number;
  raw_materials: number;
  finished_goods: number;
  equipment: number;
  employee_advances: number; // P2-M5A: outstanding employee cash advances (asset)
  total_assets: number;
  loans_payable: number;
  total_liabilities: number;
  owner_investment: number;
  owners_drawings: number;
  retained_earnings: number;
  total_equity: number;
}

// ── Payroll (P2-M5A/M5B) — daily-wage staff, cash advances, wage disbursements. ──
export interface Position {
  id: string;
  company_id: string;
  label: string;
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Employee {
  id: string;
  company_id: string;
  employee_code: string; // immutable after create
  name: string;
  position_id: string | null; // P1D: managed reference into positions — null only for pre-P1D legacy rows with no seed match
  daily_rate: number;
  date_hired: string; // date
  status: 'Active' | 'Inactive';
  user_id: string | null; // P2-M5C: linked app user (payroll self-visibility); set only via payroll_link_employee_user
  created_at: string;
  updated_at: string;
  // client-side augmentation: derived outstanding advance (server: employee_advance_balance(); mock: computed)
  advance_balance: number;
}

export interface CashAdvance {
  id: string;
  company_id: string;
  branch_id: string;
  employee_id: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export interface WagePayment {
  id: string;
  company_id: string;
  branch_id: string;
  employee_id: string;
  pay_period: string;
  days_worked: number;
  daily_rate: number;
  gross: number;
  ca_deducted: number;
  net: number;
  bonus_amount: number; // T3.3: optional bonus/incentive already folded into gross — tracked separately for audit-trail honesty
  notes: string | null;
  created_at: string;
}

// ── Scheduling / Calendar (P2-M6A/M6B) — branch-owned farm calendar (20.19). No GL. ──
export type CalendarEventType = 'Planting' | 'Fertigation' | 'Harvest' | 'Maintenance' | 'Delivery' | 'Meeting' | 'Inspection' | 'Training' | 'Deadline' | 'Project';

export interface CalendarEvent {
  id: string;
  company_id: string;
  branch_id: string;
  event_type: CalendarEventType;
  title: string;
  description: string | null;
  event_date: string; // yyyy-mm-dd
  priority: 'Low' | 'Normal' | 'High' | 'Critical';
  status: 'Scheduled' | 'In Progress' | 'Completed' | 'Cancelled' | 'Overdue';
  visibility: 'General' | 'Management'; // P2-M6C: Management = needs schedule.read_private (meetings hidden from staff)
  start_time: string | null; // P2-M6D: 'HH:MM[:SS]' time-of-day for the day view; null = all-day
  end_time: string | null;
  project_id: string | null; // reserved (Projects module M7)
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Projects (P2-M7A/M7B) — checklist board (branch-owned). No GL. ──
export interface ProjectTask {
  id: string;
  company_id: string;
  project_id: string;
  text: string;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
  position: number;
  created_at: string;
}

export interface Project {
  id: string;
  company_id: string;
  branch_id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  status: 'Planning' | 'In Progress' | 'Completed' | 'On Hold';
  visibility: 'Public' | 'Restricted';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  tasks: ProjectTask[]; // client-side augmentation (joined checklist)
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
