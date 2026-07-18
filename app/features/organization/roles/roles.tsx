// Roles (M1C §8.5). List + detail. Create role + edit description/status. Default permissions were
// historically ADD-ONLY (G1: "permissions are IMMUTABLE — there is no remove"); P1C4 (2026-07-17,
// owner: "make it editable and so i can change its default access, the system is same the one we made
// today") reverses that for the nav-shaped tree — see RoleAccessDialog below and roleAccess.ts for the
// full reasoning. The raw permission_key list stays visible read-only here for exact-key transparency;
// edits now go through the Access dialog, not a flat add-only dropdown.
import {useEffect, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {useLiveQuery} from 'dexie-react-hooks';
import {Plus} from 'lucide-react';
import {supabase} from '../../../core/supabase/client';
import {offlineDB} from '../../../core/offline/db';
import {enqueue} from '../../../core/offline/queue';
import {usePermissions} from '../../../core/permissions/permissions';
import {useSync} from '../../../core/offline/sync';
import {MOCK_MODE, mockRead} from '../../../core/mock/mock';
import type {Role} from '../../../types/db';
import {roleCreateSchema, roleEditSchema, type RoleCreateInput, type RoleEditInput} from '../../../schemas/organization';
import {Button, Card, PageHeader, cn} from '../../../components/ui';
import {Field, ReadOnlyField, TextInput, zodResolver} from '../../../components/forms';
import {SelectField} from '../../../components/overlay';
import {EmptyState, Skeleton, StatusBadge, useToast} from '../../../components/feedback';
import {AccessDialog} from '../overrides/AccessDialog';
import {roleAccessApi} from './roleAccess';

interface RolePerm {permission_id: string; key: string; description: string}

const rolesApi = {
  async fetch(companyId: string): Promise<Role[]> {
    if (MOCK_MODE) return mockRead<Role>('roles', companyId);
    const {data, error} = await supabase.from('roles').select('*').eq('company_id', companyId).order('role_key');
    if (error) throw new Error(error.message);
    return (data ?? []) as Role[];
  },
  async rolePerms(roleId: string): Promise<RolePerm[]> {
    if (MOCK_MODE) return []; // role_permissions are not cached locally in demo mode
    const {data, error} = await supabase.from('role_permissions').select('permission_id, permissions(permission_key, description)').eq('role_id', roleId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{permission_id: string; permissions: {permission_key: string; description: string} | {permission_key: string; description: string}[] | null}>;
    return rows.map((r) => {
      const p = Array.isArray(r.permissions) ? r.permissions[0] : r.permissions;
      return {permission_id: r.permission_id, key: p?.permission_key ?? '', description: p?.description ?? ''};
    });
  },
  create(companyId: string, input: RoleCreateInput) {
    return enqueue({companyId, kind: 'role.create', request: {type: 'insert', table: 'roles', payload: {company_id: companyId, ...input}}});
  },
  update(role: Role, input: RoleEditInput) {
    return enqueue({companyId: role.company_id, kind: 'role.update', request: {type: 'update', table: 'roles', match: {id: role.id, baseUpdatedAt: role.updated_at}, payload: input}});
  },
};

export default function RolesScreen() {
  const {companyId, has} = usePermissions();
  const {triggerSync} = useSync();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [loaded, setLoaded] = useState(false);
  const canManage = has('role.manage');
  const roles = useLiveQuery(async () => (companyId ? offlineDB.roles.where('company_id').equals(companyId).toArray() : []), [companyId]);

  useEffect(() => {
    if (!companyId) return;
    rolesApi.fetch(companyId).then((r) => offlineDB.roles.bulkPut(r)).catch(() => undefined).finally(() => setLoaded(true));
  }, [companyId]);

  // Found during the role-sweep (2026-07-18): editing a role's description/status/default-access is
  // capped server-side to roles the actor strictly outranks (roles_update_manage /
  // role_permissions_insert_manage — same §2.5 rule as membership actions), but this screen only
  // checked role.manage — a co_owner saw live-looking Save/Edit-default-access controls on the owner
  // role that would fail (or, for a future non-owner peer tier, silently no-op) server-side. Mirrors
  // ApprovalsScreen's outranksRow pattern: my own highest active rank in this company, computed once
  // roles are loaded (roles carry .rank already, so no extra role lookup needed).
  const [myRank, setMyRank] = useState<number | null>(null);
  useEffect(() => {
    if (MOCK_MODE) { setMyRank(50); return; } // demo identity always holds the seeded OWNER role
    if (!companyId || !roles) { setMyRank(null); return; }
    let alive = true;
    (async () => {
      const {data: me} = await supabase.rpc('current_app_user_id');
      if (!me) { if (alive) setMyRank(null); return; }
      const {data} = await supabase.from('user_branch_roles').select('role_id')
        .eq('user_id', me).eq('company_id', companyId).eq('assignment_status', 'Active');
      if (!alive) return;
      const roleIds = new Set((data ?? []).map((r: {role_id: string}) => r.role_id));
      const ranks = roles.filter((r) => roleIds.has(r.id)).map((r) => r.rank);
      setMyRank(ranks.length ? Math.max(...ranks) : null);
    })();
    return () => { alive = false; };
  }, [companyId, roles]);

  const current = selected && selected !== 'new' ? roles?.find((r) => r.id === selected) : undefined;

  return (
    <div>
      <PageHeader title="Roles" subtitle="Roles and their permissions" action={canManage ? <Button onClick={() => setSelected('new')}><Plus size={20} aria-hidden /> New role</Button> : undefined} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          {!loaded && !roles?.length ? (
            <Skeleton />
          ) : roles && roles.length === 0 ? (
            <EmptyState title="No roles yet" hint="The Owner role is created at bootstrap. Add roles to delegate work." />
          ) : (
            <ul className="divide-y divide-farm-accent-soft">
              {roles?.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelected(r.id)} className={cn('flex min-h-16 w-full items-center justify-between px-2 text-left', selected === r.id && 'bg-farm-accent-soft')}>
                    <span><span className="block text-lg font-semibold text-farm-ink">{r.role_key}</span><span className="text-base text-farm-muted">{r.description}</span></span>
                    <StatusBadge status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div>
          {selected === 'new' ? (
            <CreateRole companyId={companyId} onDone={() => {setSelected(null); triggerSync();}} />
          ) : current ? (
            <RoleDetail role={current} canManage={canManage && myRank !== null && current.rank < myRank} onChanged={triggerSync} />
          ) : (
            <Card><p className="p-4 text-lg text-farm-muted">Select a role, or create one.</p></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateRole({companyId, onDone}: {companyId: string | null; onDone: () => void}) {
  const {notify} = useToast();
  const {register, handleSubmit, formState: {errors, isSubmitting}} = useForm<RoleCreateInput>({resolver: zodResolver(roleCreateSchema)});
  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">New role</h2>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {if (companyId) {await rolesApi.create(companyId, v); notify('Role queued'); onDone();}})}>
        <Field label="Role key" htmlFor="rkey" error={errors.role_key?.message}><TextInput id="rkey" placeholder="WORKER" autoCapitalize="characters" {...register('role_key')} /></Field>
        <Field label="Description" htmlFor="rdesc" error={errors.description?.message}><TextInput id="rdesc" placeholder="Field worker" {...register('description')} /></Field>
        <Button type="submit" disabled={isSubmitting}>Create role</Button>
      </form>
    </Card>
  );
}

function RoleDetail({role, canManage, onChanged}: {role: Role; canManage: boolean; onChanged: () => void}) {
  const {notify} = useToast();
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<RoleEditInput>({resolver: zodResolver(roleEditSchema), defaultValues: {description: role.description, status: role.status}});
  const [perms, setPerms] = useState<RolePerm[] | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);

  const reloadPerms = () => {rolesApi.rolePerms(role.id).then(setPerms).catch(() => setPerms([]));};
  useEffect(reloadPerms, [role.id]);

  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">{role.role_key}</h2>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {await rolesApi.update(role, v); notify('Role update queued'); onChanged();})}>
        <ReadOnlyField label="Role key" value={role.role_key} />
        <Field label="Description" htmlFor="ed" error={errors.description?.message}><TextInput id="ed" disabled={!canManage} {...register('description')} /></Field>
        <Field label="Status" error={errors.status?.message}>
          <Controller control={control} name="status" render={({field}) => (
            <SelectField value={field.value} onChange={field.onChange} options={[{value: 'Active', label: 'Active'}, {value: 'Deprecated', label: 'Deprecated'}]} />
          )} />
        </Field>
        <Button type="submit" disabled={!canManage || isSubmitting}>Save</Button>
      </form>

      <div className="mt-6 border-t border-farm-accent-soft pt-4">
        <h3 className="mb-2 text-xl font-bold">Permissions</h3>
        {perms === null ? (
          <p className="text-base text-farm-muted">Loading… (connect to view permissions)</p>
        ) : perms.length === 0 ? (
          <p className="text-base text-farm-muted">No permissions granted yet.</p>
        ) : (
          <ul className="mb-3 space-y-1">
            {perms.map((p) => (
              <li key={p.permission_id} className="rounded-lg bg-farm-bg px-3 py-2"><span className="font-semibold">{p.key}</span> <span className="text-farm-muted">— {p.description}</span></li>
            ))}
          </ul>
        )}
        {/* P1C4 (2026-07-17): default access is now editable both ways (add AND remove) — the old
            add-only dropdown + "cannot be removed" copy is retired. Removing a key here takes
            IMMEDIATE effect on every member currently holding this role, not just future ones. */}
        {canManage ? (
          <>
            <p className="mb-3 text-[11px] text-farm-muted">
              Changes here affect every member holding this role right away — this is the role's shared default, not a per-person exception.
            </p>
            <Button variant="secondary" onClick={() => setAccessOpen(true)}>Edit default access</Button>
          </>
        ) : null}
      </div>

      {canManage ? (
        <AccessDialog
          title={`Default access — ${role.role_key}`}
          subtitle="Each section gets a tier. This sets what EVERY member holding this role gets by default — individual exceptions are still set per-person from Approvals & Roles."
          open={accessOpen}
          onClose={() => {setAccessOpen(false); reloadPerms(); onChanged();}}
          getTier={(leaf) => roleAccessApi.tier(role.company_id, role.id, leaf)}
          applyTier={(leaf, target) => roleAccessApi.apply(role.company_id, role.id, leaf, target)}
          savedMessage={(n) => n > 0 ? `Updated ${n} section${n === 1 ? '' : 's'} of ${role.role_key}'s default access` : 'No changes to save'}
        />
      ) : null}
    </Card>
  );
}
