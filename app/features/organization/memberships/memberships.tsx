// Memberships (M1C §8.7). List company members; assign a role to a user; edit status + expiry (membership.manage).
// G3: the DB enum is Active|Expired ONLY — there is no "Suspended". The "suspend" intent maps to Expired.
import {useEffect, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {useLiveQuery} from 'dexie-react-hooks';
import {Plus} from 'lucide-react';
import {supabase} from '../../../core/supabase/client';
import {offlineDB} from '../../../core/offline/db';
import {enqueue} from '../../../core/offline/queue';
import {usePermissions} from '../../../core/permissions/permissions';
import {useSync} from '../../../core/offline/sync';
import {MOCK_MODE, mockUsers} from '../../../core/mock/mock';
import type {Membership} from '../../../types/db';
import {membershipAssignSchema, membershipEditSchema, type MembershipAssignInput, type MembershipEditInput} from '../../../schemas/organization';
import {Button, Card, PageHeader, cn} from '../../../components/ui';
import {Field, TextInput, zodResolver} from '../../../components/forms';
import {SelectField, ConfirmDialog} from '../../../components/overlay';
import {EmptyState, Skeleton, StatusBadge, useToast} from '../../../components/feedback';

export interface MemberRow extends Membership {
  userName: string;
  branchName: string;
  roleKey: string;
}

export const membershipsApi = {
  async fetch(companyId: string): Promise<MemberRow[]> {
    if (MOCK_MODE) {
      const [mems, brs, rls, users] = await Promise.all([
        offlineDB.memberships.where('company_id').equals(companyId).toArray(),
        offlineDB.branches.where('company_id').equals(companyId).toArray(),
        offlineDB.roles.where('company_id').equals(companyId).toArray(),
        mockUsers(),
      ]);
      const bm = new Map(brs.map((b) => [b.id, b.name]));
      const rm = new Map(rls.map((r) => [r.id, r.role_key]));
      const um = new Map(users.map((u) => [u.id, u.display_name]));
      return mems.map((m) => ({...m, userName: um.get(m.user_id) ?? '(demo user)', branchName: bm.get(m.branch_id) ?? m.branch_id, roleKey: rm.get(m.role_id) ?? m.role_id}));
    }
    const {data, error} = await supabase
      .from('user_branch_roles')
      .select('*, users(display_name), branches(name), roles(role_key)')
      .eq('company_id', companyId);
    if (error) throw new Error(error.message);
    type Row = Membership & {users: {display_name: string} | null; branches: {name: string} | null; roles: {role_key: string} | null};
    return ((data ?? []) as Row[]).map((r) => ({
      ...r,
      userName: r.users?.display_name ?? '(unknown)',
      branchName: r.branches?.name ?? r.branch_id,
      roleKey: r.roles?.role_key ?? r.role_id,
    }));
  },
  async users(): Promise<Array<{id: string; display_name: string}>> {
    if (MOCK_MODE) return mockUsers();
    const {data, error} = await supabase.from('users').select('id, display_name');
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{id: string; display_name: string}>;
  },
  assign(companyId: string, input: MembershipAssignInput) {
    return enqueue({companyId, kind: 'membership.assign', request: {type: 'insert', table: 'user_branch_roles', payload: {company_id: companyId, ...input}}});
  },
  update(m: Membership, input: MembershipEditInput) {
    return enqueue({companyId: m.company_id, kind: 'membership.update', request: {type: 'update', table: 'user_branch_roles', match: {id: m.id, baseUpdatedAt: m.updated_at}, payload: input}});
  },
};

export default function MembersScreen() {
  const {companyId, has} = usePermissions();
  const {triggerSync} = useSync();
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const canManage = has('membership.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).toArray() : []), [companyId]);
  const roles = useLiveQuery(async () => (companyId ? offlineDB.roles.where('company_id').equals(companyId).toArray() : []), [companyId]);

  const reload = () => {if (companyId) membershipsApi.fetch(companyId).then(setRows).catch(() => setRows([]));};
  useEffect(reload, [companyId]);

  const current = selected && selected !== 'new' ? rows?.find((r) => r.id === selected) : undefined;

  return (
    <div>
      <PageHeader title="Members" subtitle="People and their roles in your company" action={canManage ? <Button onClick={() => setSelected('new')}><Plus size={20} aria-hidden /> Assign</Button> : undefined} />
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          {rows === null ? (
            <Skeleton />
          ) : rows.length === 0 ? (
            <EmptyState title="No members yet" hint="Assign a role to a user, or invite someone new from the Invitations tab." />
          ) : (
            <ul className="divide-y divide-farm-accent-soft">
              {rows.map((m) => (
                <li key={m.id}>
                  <button onClick={() => setSelected(m.id)} className={cn('flex min-h-16 w-full items-center justify-between px-2 text-left', selected === m.id && 'bg-farm-accent-soft')}>
                    <span>
                      <span className="block text-lg font-semibold text-farm-ink">{m.userName}</span>
                      <span className="text-base text-farm-muted">{m.roleKey} · {m.branchName}{m.expires_at ? ` · expires ${new Date(m.expires_at).toLocaleDateString()}` : ''}</span>
                    </span>
                    <StatusBadge status={m.assignment_status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div>
          {selected === 'new' ? (
            <AssignMembership companyId={companyId} branchOpts={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} roleOpts={(roles ?? []).map((r) => ({value: r.id, label: r.role_key}))} onDone={() => {setSelected(null); triggerSync(); reload();}} />
          ) : current ? (
            <EditMembership member={current} canManage={canManage} onDone={() => {triggerSync(); reload();}} />
          ) : (
            <Card><p className="p-4 text-lg text-farm-muted">Select a member, or assign a new one.</p></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignMembership({companyId, branchOpts, roleOpts, onDone}: {companyId: string | null; branchOpts: Array<{value: string; label: string}>; roleOpts: Array<{value: string; label: string}>; onDone: () => void}) {
  const {notify} = useToast();
  const [users, setUsers] = useState<Array<{value: string; label: string}>>([]);
  const {handleSubmit, control, formState: {errors, isSubmitting}} = useForm<MembershipAssignInput>({resolver: zodResolver(membershipAssignSchema)});
  useEffect(() => {membershipsApi.users().then((u) => setUsers(u.map((x) => ({value: x.id, label: x.display_name})))).catch(() => setUsers([]));}, []);
  return (
    <Card>
      <h2 className="mb-4 text-2xl font-bold">Assign membership</h2>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {if (companyId) {await membershipsApi.assign(companyId, v); notify('Membership queued'); onDone();}})}>
        <Field label="User" error={errors.user_id?.message}><Controller control={control} name="user_id" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} placeholder="Select user" options={users} />)} /></Field>
        <Field label="Branch" error={errors.branch_id?.message}><Controller control={control} name="branch_id" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} placeholder="Select branch" options={branchOpts} />)} /></Field>
        <Field label="Role" error={errors.role_id?.message}><Controller control={control} name="role_id" render={({field}) => (<SelectField value={field.value} onChange={field.onChange} placeholder="Select role" options={roleOpts} />)} /></Field>
        <Button type="submit" disabled={isSubmitting}>Assign</Button>
      </form>
    </Card>
  );
}

function EditMembership({member, canManage, onDone}: {member: MemberRow; canManage: boolean; onDone: () => void}) {
  const {notify} = useToast();
  const {register, handleSubmit, control, formState: {errors, isSubmitting}} = useForm<MembershipEditInput>({
    resolver: zodResolver(membershipEditSchema),
    defaultValues: {assignment_status: member.assignment_status, expires_at: member.expires_at},
  });
  const [confirm, setConfirm] = useState<MembershipEditInput | null>(null);
  return (
    <Card>
      <h2 className="mb-1 text-2xl font-bold">{member.userName}</h2>
      <p className="mb-4 text-base text-farm-muted">{member.roleKey} · {member.branchName}</p>
      <form className="space-y-4" onSubmit={handleSubmit((v) => setConfirm(v))}>
        <Field label="Status" error={errors.assignment_status?.message}>
          {/* G3 — Active | Expired only (no "Suspended"). Setting Expired removes access. */}
          <Controller control={control} name="assignment_status" render={({field}) => (
            <SelectField value={field.value} onChange={field.onChange} options={[{value: 'Active', label: 'Active'}, {value: 'Expired', label: 'Expired (removes access)'}]} />
          )} />
        </Field>
        <Field label="Expiry date (optional)" htmlFor="exp" error={errors.expires_at?.message}>
          <Controller control={control} name="expires_at" render={({field}) => (
            <TextInput id="exp" type="date" value={field.value ? field.value.slice(0, 10) : ''} onChange={(e) => field.onChange(e.target.value ? e.target.value : null)} />
          )} />
        </Field>
        <Button type="submit" disabled={!canManage || isSubmitting}>Save</Button>
        {!canManage ? <p className="text-base text-farm-muted">Needs membership.manage to edit.</p> : null}
      </form>
      <ConfirmDialog
        open={confirm !== null}
        title="Update membership?"
        description={confirm?.assignment_status === 'Expired' ? 'Setting Expired immediately removes this access.' : 'Apply the membership change.'}
        confirmLabel="Save"
        danger={confirm?.assignment_status === 'Expired'}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {if (confirm) {await membershipsApi.update(member, confirm); notify('Membership update queued');} setConfirm(null); onDone();}}
      />
    </Card>
  );
}
