// P1C4 (2026-07-17): the Roles tab's "default access" editor — reuses the exact SECTION_TREE and
// AccessDialog UI from P1C3's per-user Access panel, but reads/writes a ROLE's own `role_permissions`
// membership instead of a per-user override. Unlike per-user overrides (grant/deny, one person),
// removing a key here takes IMMEDIATE effect on every member currently holding that role — a real,
// deliberate reversal of role_permissions' prior "immutable, additive-only" design (see the P1C4
// migration header for the full reasoning). Additions still go through the existing governed
// `enqueue`-based insert path (role_permissions_insert_manage RLS policy, unchanged); removals go
// through the new `remove_role_permission` RPC (the only DELETE path — no bare DELETE RLS policy).
import {supabase} from '../../../core/supabase/client';
import {enqueue} from '../../../core/offline/queue';
import {MOCK_MODE} from '../../../core/mock/mock';
import type {AccessTier, AccessLeaf} from '../overrides/access';

export const roleAccessApi = {
  /** Read-only: does this role directly hold the read/manage key? No override concept for roles. */
  async tier(p_company_id: string, p_role_id: string, leaf: AccessLeaf): Promise<AccessTier> {
    if (MOCK_MODE) return 'none';
    const {data, error} = await supabase
      .from('role_permissions')
      .select('permissions(permission_key)')
      .eq('company_id', p_company_id)
      .eq('role_id', p_role_id);
    if (error) throw new Error(error.message);
    const keys = new Set<string>();
    for (const row of (data ?? []) as Array<{permissions: {permission_key: string} | {permission_key: string}[] | null}>) {
      const p = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions;
      if (p) keys.add(p.permission_key);
    }
    if (leaf.manageKey && keys.has(leaf.manageKey)) return 'manage';
    if (leaf.readKey && keys.has(leaf.readKey)) return 'view';
    return 'none';
  },

  /**
   * Apply a target tier to a (role, leaf) pair. Unlike accessApi.apply() (per-user grant/deny
   * override), this directly adds or removes rows from role_permissions:
   *
   *   target = manage: ensure the manage key is present (add if absent) + ensure the read key is
   *                     present too, if the leaf has one (manage implies read for the visual model).
   *   target = view:   ensure the read key is present (add if absent) + ensure the manage key is
   *                     ABSENT (remove if present).
   *   target = none:   ensure BOTH keys are absent (remove if present).
   */
  async apply(p_company_id: string, p_role_id: string, leaf: AccessLeaf, target: AccessTier): Promise<void> {
    if (MOCK_MODE) return;
    const wantManage = target === 'manage';
    const wantRead = target === 'manage' || target === 'view';
    const errors: string[] = [];
    if (leaf.manageKey) {
      try { await setMembership(p_company_id, p_role_id, leaf.manageKey, wantManage); }
      catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    }
    if (leaf.readKey) {
      try { await setMembership(p_company_id, p_role_id, leaf.readKey, wantRead); }
      catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    }
    if (errors.length > 0) throw new Error(errors.join('; '));
  },
};

async function setMembership(companyId: string, roleId: string, permissionKey: string, want: boolean): Promise<void> {
  const {data: perm, error: pErr} = await supabase.from('permissions').select('id').eq('permission_key', permissionKey).single();
  if (pErr) throw new Error(pErr.message);
  const {data: existing, error: eErr} = await supabase
    .from('role_permissions')
    .select('permission_id')
    .eq('company_id', companyId).eq('role_id', roleId).eq('permission_id', perm.id)
    .maybeSingle();
  if (eErr) throw new Error(eErr.message);
  const has = existing !== null;
  if (want && !has) {
    await enqueue({companyId, kind: 'role.addPermission', request: {type: 'insert', table: 'role_permissions', payload: {company_id: companyId, role_id: roleId, permission_id: perm.id}}});
  } else if (!want && has) {
    const {error} = await supabase.rpc('remove_role_permission', {p_company_id: companyId, p_role_id: roleId, p_permission_key: permissionKey});
    if (error) throw new Error(error.message);
  }
}
