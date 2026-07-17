// Permission snapshot (M1B A3/S2). DISPLAY-ONLY cosmetic gating — the server (RLS + resolver) is the real
// boundary. Derives the active company + the user's effective permission keys from readable membership/role
// data, caches them in IndexedDB for offline, and exposes has(key). Never trusted for authorization.
import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import {supabase} from '../supabase/client';
import {offlineDB} from '../offline/db';
import {useSession} from '../auth/session';
import {MOCK_MODE} from '../mock/mock';
import type {PermissionKey} from '../../types/db';

interface PermissionValue {
  loading: boolean;
  companyId: string | null;
  keys: ReadonlySet<string>;
  has: (key: PermissionKey) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PermissionValue | null>(null);

async function loadSnapshot(): Promise<{companyId: string | null; keys: string[]}> {
  // P1C3 fix: user_branch_roles RLS is TWO permissive policies OR'd together — "own row" AND "any row
  // in the company if you hold membership.read" (M4 §user_branch_roles_select_admin). Without an
  // explicit user_id filter, anyone holding membership.read (admin+) had their OWN active-memberships
  // query return EVERY visible member's row, unioning in every other member's role_permissions too —
  // found live during the P1C3 redesign: an admin's client-side has() snapshot silently included the
  // owner's full catalog. Same shape of bug on user_permission_overrides below (own-row OR
  // membership.manage-holder-sees-all), fixed the same way.
  const {data: me, error: idErr} = await supabase.rpc('current_app_user_id');
  if (idErr) throw new Error(idErr.message);
  if (!me) return {companyId: null, keys: []};
  const {data: memberships, error: mErr} = await supabase
    .from('user_branch_roles')
    .select('company_id, role_id, assignment_status')
    .eq('assignment_status', 'Active')
    .eq('user_id', me);
  if (mErr) throw new Error(mErr.message);
  const rows = (memberships ?? []) as Array<{company_id: string; role_id: string}>;
  if (rows.length === 0) return {companyId: null, keys: []};

  // Pick the stored active company if still valid, else the first.
  const stored = (await offlineDB.meta.get('active-company'))?.value as string | undefined;
  const companyIds = Array.from(new Set(rows.map((r) => r.company_id)));
  const companyId = stored && companyIds.includes(stored) ? stored : companyIds[0]!;

  const roleIds = Array.from(new Set(rows.filter((r) => r.company_id === companyId).map((r) => r.role_id)));
  const {data: rps, error: rErr} = await supabase
    .from('role_permissions')
    .select('permissions(permission_key)')
    .in('role_id', roleIds);
  if (rErr) throw new Error(rErr.message);
  const keys = new Set<string>();
  for (const rp of (rps ?? []) as Array<{permissions: {permission_key: string} | {permission_key: string}[] | null}>) {
    const p = rp.permissions;
    if (Array.isArray(p)) p.forEach((x) => keys.add(x.permission_key));
    else if (p) keys.add(p.permission_key);
  }

  // P1C §2.4: fold in this user's own per-user overrides — deny removes a role-granted key, grant adds
  // one the role lacks. Server (has_permission) is still the real boundary; this only keeps the
  // DISPLAY-ONLY client cache from disagreeing with what the server allows. P1C3 fix: same own-row-OR-
  // membership.manage-holder-sees-all RLS shape as above — explicit user_id filter required, or a
  // membership.manage holder's snapshot would fold in every OTHER member's overrides too.
  const {data: overrides, error: oErr} = await supabase
    .from('user_permission_overrides')
    .select('effect, permissions(permission_key)')
    .eq('company_id', companyId)
    .eq('user_id', me);
  if (!oErr) {
    for (const o of (overrides ?? []) as Array<{effect: 'grant' | 'deny'; permissions: {permission_key: string} | {permission_key: string}[] | null}>) {
      const p = Array.isArray(o.permissions) ? o.permissions[0] : o.permissions;
      if (!p) continue;
      if (o.effect === 'deny') keys.delete(p.permission_key);
      else keys.add(p.permission_key);
    }
  }

  return {companyId, keys: Array.from(keys)};
}

export function PermissionProvider({children}: {children: ReactNode}) {
  const {status} = useSession();
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    if (MOCK_MODE) {
      const snap = (await offlineDB.meta.get('perm-snapshot'))?.value as {companyId: string | null; keys: string[]} | undefined;
      setCompanyId(snap?.companyId ?? null);
      setKeys(new Set(snap?.keys ?? []));
      setLoading(false);
      return;
    }
    try {
      const snap = await loadSnapshot();
      setCompanyId(snap.companyId);
      setKeys(new Set(snap.keys));
      await offlineDB.meta.put({key: 'perm-snapshot', value: snap});
      if (snap.companyId) await offlineDB.meta.put({key: 'active-company', value: snap.companyId});
    } catch {
      // Offline / transient → fall back to the last cached snapshot (S2 display-only).
      const cached = (await offlineDB.meta.get('perm-snapshot'))?.value as {companyId: string | null; keys: string[]} | undefined;
      if (cached) {
        setCompanyId(cached.companyId);
        setKeys(new Set(cached.keys));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') void refresh();
    else if (status === 'anonymous') {
      setKeys(new Set());
      setCompanyId(null);
      setLoading(false);
    }
  }, [status, refresh]);

  const value = useMemo<PermissionValue>(
    () => ({loading, companyId, keys, has: (k) => keys.has(k), refresh}),
    [loading, companyId, keys, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePermissions(): PermissionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePermissions must be used within <PermissionProvider>');
  return v;
}
