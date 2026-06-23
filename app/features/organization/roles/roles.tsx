// Roles (M1C §8.5). List + detail. Create role + edit description/status + ADD permissions (role.manage).
// G1: permissions are IMMUTABLE — there is no remove. The UI says so and offers the deprecate-and-recreate path.
import {useEffect, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {useLiveQuery} from 'dexie-react-hooks';
import {Plus} from 'lucide-react';
import {supabase} from '../../../core/supabase/client';
import {offlineDB} from '../../../core/offline/db';
import {enqueue} from '../../../core/offline/queue';
import {usePermissions} from '../../../core/permissions/permissions';
import {useSync} from '../../../core/offline/sync';
import type {Permission, Role} from '../../../types/db';
import {roleCreateSchema, roleEditSchema, type RoleCreateInput, type RoleEditInput} from '../../../schemas/organization';
import {Button, Card, PageHeader, cn} from '../../../components/ui';
import {Field, ReadOnlyField, TextInput, zodResolver} from '../../../components/forms';
import {SelectField, ConfirmDialog} from '../../../components/overlay';
import {EmptyState, Skeleton, StatusBadge, useToast} from '../../../components/feedback';

interface RolePerm {permission_id: string; key: string; description: string}

const rolesApi = {
  async fetch(companyId: string): Promise<Role[]> {
    const {data, error} = await supabase.from('roles').select('*').eq('company_id', companyId).order('role_key');
    if (error) throw new Error(error.message);
    return (data ?? []) as Role[];
  },
  async catalog(): Promise<Permission[]> {
    const {data, error} = await supabase.from('permissions').select('*').eq('status', 'Active').order('permission_key');
    if (error) throw new Error(error.message);
    return (data ?? []) as Permission[];
  },
  async rolePerms(roleId: string): Promise<RolePerm[]> {
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
  addPermission(role: Role, permissionId: string) {
    return enqueue({companyId: role.company_id, kind: 'role.addPermission', request: {type: 'insert', table: 'role_permissions', payload: {company_id: role.company_id, role_id: role.id, permission_id: permissionId}}});
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
            <ul className="divide-y divide-slate-100">
              {roles?.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelected(r.id)} className={cn('flex min-h-16 w-full items-center justify-between px-2 text-left', selected === r.id && 'bg-emerald-50')}>
                    <span><span className="block text-lg font-semibold text-slate-800">{r.role_key}</span><span className="text-base text-slate-500">{r.description}</span></span>
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
            <RoleDetail role={current} canManage={canManage} onChanged={triggerSync} />
          ) : (
            <Card><p className="p-4 text-lg text-slate-500">Select a role, or create one.</p></Card>
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
  const [catalog, setCatalog] = useState<Permission[]>([]);
  const [toAdd, setToAdd] = useState<string | undefined>(undefined);
  const [confirmAdd, setConfirmAdd] = useState<Permission | null>(null);

  useEffect(() => {
    rolesApi.rolePerms(role.id).then(setPerms).catch(() => setPerms([]));
    rolesApi.catalog().then(setCatalog).catch(() => setCatalog([]));
  }, [role.id]);

  const owned = new Set((perms ?? []).map((p) => p.key));
  const addable = catalog.filter((c) => !owned.has(c.permission_key));

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

      <div className="mt-6 border-t border-slate-200 pt-4">
        <h3 className="mb-2 text-xl font-bold">Permissions</h3>
        {perms === null ? (
          <p className="text-base text-slate-500">Loading… (connect to view permissions)</p>
        ) : perms.length === 0 ? (
          <p className="text-base text-slate-500">No permissions granted yet.</p>
        ) : (
          <ul className="mb-3 space-y-1">
            {perms.map((p) => (
              <li key={p.permission_id} className="rounded-lg bg-slate-50 px-3 py-2"><span className="font-semibold">{p.key}</span> <span className="text-slate-500">— {p.description}</span></li>
            ))}
          </ul>
        )}
        {/* G1 — immutable mapping: add only, never remove. */}
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-900">
          Permissions cannot be removed from an existing role. Create a new role if a different permission set is needed.
        </p>
        {canManage && addable.length > 0 ? (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <SelectField value={toAdd} onChange={setToAdd} placeholder="Add a permission…" options={addable.map((c) => ({value: c.id, label: `${c.permission_key} — ${c.description}`}))} />
            </div>
            <Button variant="secondary" disabled={!toAdd} onClick={() => {const p = catalog.find((c) => c.id === toAdd); if (p) setConfirmAdd(p);}}>Add</Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmAdd !== null}
        title="Add permission to role?"
        description={confirmAdd ? `Grant "${confirmAdd.permission_key}" to ${role.role_key}. This cannot be undone (permissions are not removable).` : ''}
        confirmLabel="Add permission"
        onCancel={() => setConfirmAdd(null)}
        onConfirm={async () => {
          if (confirmAdd) {await rolesApi.addPermission(role, confirmAdd.id); notify('Permission add queued'); setToAdd(undefined);}
          setConfirmAdd(null);
          onChanged();
        }}
      />
    </Card>
  );
}
