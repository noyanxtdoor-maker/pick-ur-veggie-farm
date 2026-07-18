// P1C3 (2026-07-17): the "Section Access" panel — supersedes P1C2's flat 8-module grouping with a
// tree shaped around the REAL nav bar (owner: "Sections are the 'Home Dashboard', Weigh POS, and
// everything is in the nav bar"). Reads the current tier via the new user_key_tier(company, user,
// read_key, manage_key) resolver, parameterized directly on key names rather than the permissions.module
// column P1C2 used — needed because membership.manage now serves as the manage key for THREE different
// tabs (Approvals/Members/Archived) at once, which a single-module-column lookup can't represent.
// Writes still go through the proven set_user_permission_override RPC, one call per key — unchanged.
//
// Excluded from this tree (owner-confirmed 2026-07-17): Home Dashboard, VeggieGenius, Settings Hub, My
// Profile — self-service/advisory, stay always-visible, no permission keys introduced for them.
// Section-level Visible/Not-Visible for multi-tab sections (Operations; Approvals & Roles) is DERIVED
// from whether any child tab is visible — a pure client-side expand/collapse, not written to the DB.
import {supabase} from '../../../core/supabase/client';
import {MOCK_MODE} from '../../../core/mock/mock';

export type AccessTier = 'none' | 'view' | 'manage';

export interface AccessLeaf {
  key: string;
  label: string;
  readKey: string | null;
  manageKey: string | null; // null only for Reports — a placeholder page with nothing to "manage"
}

export interface AccessSection {
  key: string;
  label: string;
  leaf?: AccessLeaf; // sections without tabs are themselves a single leaf
  tabs?: AccessLeaf[]; // sections with tabs (Operations; Approvals & Roles)
  alwaysVisible?: boolean; // Payroll only: the nav link never actually disappears
  noneLabel?: string; // Payroll only: relabel the 'none' state "Self Only" instead of "Not Visible"
}

// Curated key-pairs per nav node — see docs/handoffs-for-team-b for the full design rationale
// (P1C3). Reuses existing catalog keys everywhere except membership.approve (new, P1C3).
export const SECTION_TREE: AccessSection[] = [
  {key: 'pos', label: 'Weigh Point-Of-Sale', leaf: {key: 'pos', label: 'Weigh Point-Of-Sale', readKey: 'pos.sell', manageKey: 'product.manage'}},
  {
    key: 'inventory', label: 'Stock Inventories',
    tabs: [
      {key: 'inv_consumables', label: 'Consumables & Seed Stocks', readKey: 'inventory.adjust', manageKey: 'inventory.purchase'},
      {key: 'inv_equipment', label: 'Heavy Equipment & Spades', readKey: null, manageKey: 'equipment.manage'},
      {key: 'inv_purchases', label: 'Purchase Summary', readKey: 'inventory.reports.read', manageKey: null},
      {key: 'inv_usage', label: 'Usage History', readKey: null, manageKey: 'inventory.adjust'},
    ],
  },
  {key: 'accounting', label: 'Automated Accounting', leaf: {key: 'accounting', label: 'Automated Accounting', readKey: 'accounting.read', manageKey: 'accounting.manage'}},
  {key: 'customers', label: 'Customers & Credit', leaf: {key: 'customers', label: 'Customers & Credit', readKey: 'customer.read', manageKey: 'customer.manage'}},
  {
    key: 'payroll', label: 'Salaries & Payroll', alwaysVisible: true, noneLabel: 'Self Only',
    leaf: {key: 'payroll', label: 'Salaries & Payroll', readKey: 'payroll.read', manageKey: 'payroll.manage'},
  },
  {
    key: 'operations', label: 'Operations',
    tabs: [
      {key: 'schedules', label: 'Schedules', readKey: 'schedule.read', manageKey: 'schedule.manage'},
      {key: 'projects', label: 'Projects', readKey: 'project.read', manageKey: 'project.manage'},
    ],
  },
  {key: 'reports', label: 'Reports', leaf: {key: 'reports', label: 'Reports', readKey: 'accounting.read', manageKey: null}},
  {
    key: 'organization', label: 'Approvals & Roles',
    tabs: [
      {key: 'org_approvals', label: 'Approvals', readKey: 'membership.approve', manageKey: 'membership.manage'},
      {key: 'org_company', label: 'Company', readKey: null, manageKey: 'company.manage'},
      {key: 'org_branches', label: 'Branches', readKey: null, manageKey: 'branch.manage'},
      {key: 'org_roles', label: 'Roles', readKey: null, manageKey: 'role.manage'},
      {key: 'org_members', label: 'Members', readKey: null, manageKey: 'membership.manage'},
      {key: 'org_archived', label: 'Archived', readKey: null, manageKey: 'membership.manage'},
    ],
  },
];

/** Which tiers are actually selectable for a leaf, given which keys it has. */
export function tiersFor(leaf: AccessLeaf): AccessTier[] {
  if (leaf.readKey && leaf.manageKey) return ['none', 'view', 'manage'];
  if (leaf.manageKey) return ['none', 'manage'];
  return ['none', 'view']; // readKey only (Reports) — nothing to "manage"
}

export const accessApi = {
  /** Static tree — no DB round-trip needed for structure (unlike P1C2's DB-queried module catalog). */
  catalog(): AccessSection[] {
    return SECTION_TREE;
  },

  /** Read the current tier for a (user, leaf) pair via the resolver. */
  async tier(p_company_id: string, p_user_id: string, leaf: AccessLeaf): Promise<AccessTier> {
    if (MOCK_MODE) return 'none';
    const {data, error} = await supabase.rpc('user_key_tier', {
      p_company_id, p_user_id, p_read_key: leaf.readKey, p_manage_key: leaf.manageKey,
    });
    if (error) throw new Error(error.message);
    return (data ?? 'none') as AccessTier;
  },

  /**
   * Apply a target tier to a (user, leaf) pair via set_user_permission_override, one call per key.
   *
   *   target = manage: grant the manage key + grant the read key (if any), so the user also sees .read records.
   *   target = view:  grant the read key (if any) + DENY the manage key (if any) — deny enforces "no manage actions".
   *   target = none:  DENY both keys (if present) — P1C3 fix: the P1C2 version cleared the override
   *                   instead (effect: null), which does nothing for a role-derived grant (nearly
   *                   everyone, since every node has baseline role coverage) — "Not Visible" was
   *                   therefore unreachable for anyone whose role already granted access. Denying
   *                   explicitly suppresses the role grant, matching what "Not Visible" actually promises.
   */
  async apply(p_company_id: string, p_user_id: string, leaf: AccessLeaf, target: AccessTier): Promise<void> {
    if (MOCK_MODE) return;
    const {readKey, manageKey} = leaf;
    const errors: string[] = [];
    if (readKey) {
      const readEffect = target === 'none' ? 'deny' : 'grant';
      const {error} = await supabase.rpc('set_user_permission_override', {p_company_id, p_user_id, p_permission_key: readKey, p_effect: readEffect});
      if (error) errors.push(error.message);
    }
    if (manageKey) {
      const manageEffect: 'grant' | 'deny' = target === 'manage' ? 'grant' : 'deny';
      const {error} = await supabase.rpc('set_user_permission_override', {p_company_id, p_user_id, p_permission_key: manageKey, p_effect: manageEffect});
      if (error) errors.push(error.message);
    }
    if (errors.length > 0) throw new Error(errors.join('; '));
  },
};
