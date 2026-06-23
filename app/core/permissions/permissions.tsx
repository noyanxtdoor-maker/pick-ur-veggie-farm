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
  // Own active memberships (RLS returns own rows) → companies + roles.
  const {data: memberships, error: mErr} = await supabase
    .from('user_branch_roles')
    .select('company_id, role_id, assignment_status')
    .eq('assignment_status', 'Active');
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
