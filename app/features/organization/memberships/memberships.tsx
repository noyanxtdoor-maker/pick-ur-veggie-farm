// Memberships (M1C §8.7). List company members; assign a role to a user; edit status + expiry (membership.manage).
// G3: the DB enum is Active|Expired ONLY — there is no "Suspended". The "suspend" intent maps to Expired.
import {useEffect, useState} from 'react';
import {Controller, useForm} from 'react-hook-form';
import {useLiveQuery} from 'dexie-react-hooks';
import {Plus} from 'lucide-react';
import {supabase} from '../../../core/supabase/client';
import {offlineDB} from '../../../core/offline/db';
import {enqueue} from '../../../core/offline/queue';
import {hydrateBranches, hydrateRoles} from '../../../core/offline/hydrate';
import {usePermissions} from '../../../core/permissions/permissions';
import {useSync} from '../../../core/offline/sync';
import {MOCK_MODE, mockUsers} from '../../../core/mock/mock';
import {uuidv7} from '../../../core/offline/uuidv7';
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
  jobTitle: string | null; // P1D §Part3: purely descriptive, edited via membershipsApi.setJobTitle
  accountStatus: 'Active' | 'Suspended' | 'Archived'; // P1G: account-level, distinct from assignment_status
}

// Directory dedupe (ported from Team B 8c4447a, owner 2026-07-16 parity order — fixes the "role change
// creates a new account" bug): role_id is immutable by design → a role change expires the old assignment
// + inserts a new one (audit history preserved, reversal-by-addition). That left the directory showing
// BOTH the Expired old row AND the Active new row for the same user → looked like a new account.
// Fix the display, not the write: one row per user — Active membership preferred, else the most
// recent Expired (so the "Reactivate" action on the Approvals screen still has a row to flip).
// The full audit trail stays in the DB untouched.
function dedupeByUser<T extends MemberRow>(rows: T[]): T[] {
  const byUser = new Map<string, T>();
  for (const r of rows) {
    const prev = byUser.get(r.user_id);
    if (!prev) { byUser.set(r.user_id, r); continue; }
    // Active beats Expired; within the same status, newer wins (updated_at desc, fallback created_at).
    const rActive = r.assignment_status === 'Active';
    const pActive = prev.assignment_status === 'Active';
    if (rActive && !pActive) { byUser.set(r.user_id, r); continue; }
    if (pActive && !rActive) continue;
    const rTime = String(r.updated_at ?? r.created_at ?? '');
    const pTime = String(prev.updated_at ?? prev.created_at ?? '');
    if (rTime > pTime) byUser.set(r.user_id, r);
  }
  return [...byUser.values()];
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
      return dedupeByUser(mems.map((m) => ({...m, userName: um.get(m.user_id) ?? '(demo user)', branchName: bm.get(m.branch_id) ?? m.branch_id, roleKey: rm.get(m.role_id) ?? m.role_id, jobTitle: null, accountStatus: 'Active' as const})));
    }
    const {data, error} = await supabase
      .from('user_branch_roles')
      .select('*, users(display_name, job_title, account_status), branches(name), roles(role_key)')
      .eq('company_id', companyId);
    if (error) throw new Error(error.message);
    type Row = Membership & {users: {display_name: string; job_title: string | null; account_status: 'Active' | 'Suspended' | 'Archived'} | null; branches: {name: string} | null; roles: {role_key: string} | null};
    return dedupeByUser(((data ?? []) as Row[]).map((r) => ({
      ...r,
      userName: r.users?.display_name ?? '(unknown)',
      branchName: r.branches?.name ?? r.branch_id,
      roleKey: r.roles?.role_key ?? r.role_id,
      jobTitle: r.users?.job_title ?? null,
      accountStatus: r.users?.account_status ?? 'Active',
    })));
  },
  // P1D §Part3: purely descriptive — job_title.manage required server-side (admin-tier and above by
  // default). No payroll/reporting logic keyed to it.
  async setJobTitle(userId: string, jobTitle: string): Promise<void> {
    if (MOCK_MODE) return; // mock users are curated demo fixtures — not editable here
    const {error} = await supabase.from('users').update({job_title: jobTitle.trim() || null}).eq('id', userId);
    if (error) throw new Error(error.message);
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

  // P1D §Part1: the one governed entry point for approving a pending sign-up OR reassigning an existing
  // member — atomically links (or exempts) payroll for an eligible role. ONLINE ONLY (like invite_user —
  // not idempotent-safe for outbox retry: a retried call after a partial network failure could double-
  // create the Farm Hand record).
  async assignWithPayroll(companyId: string, input: {
    userId: string; branchId: string; roleId: string;
    employeeName?: string; positionId?: string; dailyRate?: number; exempt?: boolean;
  }): Promise<void> {
    if (MOCK_MODE) {
      const now = new Date().toISOString();
      const existing = await offlineDB.memberships.where('company_id').equals(companyId).filter((r) => r.user_id === input.userId && r.assignment_status === 'Active').first();
      if (existing) await offlineDB.memberships.put({...existing, assignment_status: 'Expired', updated_at: now});
      await offlineDB.memberships.put({id: uuidv7(), user_id: input.userId, company_id: companyId, branch_id: input.branchId, role_id: input.roleId, assignment_status: 'Active', expires_at: null, created_at: now, updated_at: now});
      if (input.employeeName && input.positionId && input.dailyRate) {
        await offlineDB.employees.put({id: uuidv7(), company_id: companyId, employee_code: `EMP-${uuidv7().slice(-6).toUpperCase()}`, name: input.employeeName, position_id: input.positionId, daily_rate: input.dailyRate, date_hired: now.slice(0, 10), status: 'Active', user_id: input.userId, created_at: now, updated_at: now});
      } else if (input.exempt) {
        await offlineDB.meta.put({key: `payroll-exempt-${input.userId}`, value: true}); // mock has no users.payroll_exempt column; tracked separately for demo purposes
      }
      return;
    }
    const {error} = await supabase.rpc('assign_membership_with_payroll', {
      p_company_id: companyId, p_target_user_id: input.userId, p_branch_id: input.branchId, p_role_id: input.roleId,
      // `|| null`, not `?? null`: for a non-payroll-eligible role (co_owner/owner) the Position field never
      // renders, so positionId stays '' (its initial state) rather than undefined — `''` is a defined value
      // so `??` lets it through, and Postgres then fails casting an empty string to `uuid` (found live
      // 2026-07-13: "invalid input syntax for type uuid"). `||` also catches the empty-string case.
      p_employee_name: input.employeeName ?? null, p_position_id: input.positionId || null, p_daily_rate: input.dailyRate ?? null,
      p_exempt: input.exempt ?? false,
    });
    if (error) throw new Error(error.message);
  },

  async unlinkedPayrollEligible(companyId: string): Promise<Array<{user_id: string; display_name: string; role_key: string}>> {
    if (MOCK_MODE) return []; // mock demo data is small/curated — the backfill banner isn't exercised in mock
    const {data, error} = await supabase.rpc('list_unlinked_payroll_eligible', {p_company_id: companyId});
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{user_id: string; display_name: string; role_key: string}>;
  },

  // P1G: retire a fully-revoked account (never a hard-delete — see the migration). Requires the target
  // already hold zero active memberships anywhere (revoke first, archive second).
  async archiveUser(userId: string): Promise<void> {
    if (MOCK_MODE) return; // mock has no account_status lifecycle to exercise here
    const {error} = await supabase.rpc('archive_user_account', {p_user_id: userId});
    if (error) throw new Error(error.message);
  },
  async unarchiveUser(userId: string): Promise<void> {
    if (MOCK_MODE) return;
    const {error} = await supabase.rpc('unarchive_user_account', {p_user_id: userId});
    if (error) throw new Error(error.message);
  },
};

export default function MembersScreen() {
  const {companyId, has} = usePermissions();
  const {triggerSync, refreshTick} = useSync();
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const canManage = has('membership.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).toArray() : []), [companyId]);
  const roles = useLiveQuery(async () => (companyId ? offlineDB.roles.where('company_id').equals(companyId).toArray() : []), [companyId]);

  const reload = () => {
    if (!companyId) return;
    membershipsApi.fetch(companyId).then(setRows).catch(() => setRows([]));
    // Fresh device landing directly on Memberships (never visited Branches/Roles/Approvals first): the
    // Assign-role dialog's branch/role dropdowns read this same Dexie cache — hydrate it here too, same
    // gap class as ApprovalsScreen's own hydrateBranches call (found live 2026-07-19).
    hydrateBranches(companyId);
    hydrateRoles(companyId);
  };
  useEffect(reload, [companyId, refreshTick]); // refreshTick: manual sync (top-bar wifi tap)

  const current = selected && selected !== 'new' ? rows?.find((r) => r.id === selected) : undefined;

  return (
    <div>
      <PageHeader title="Members" subtitle="People and their roles in your company" action={canManage ? <Button onClick={() => setSelected('new')}><Plus size={20} aria-hidden /> Assign</Button> : undefined} />
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          {rows === null ? (
            <Skeleton />
          ) : rows.length === 0 ? (
            <EmptyState title="No members yet" hint="Assign a role to a user, or wait for them to sign up and approve them in Approvals." />
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
      <h2 className="mb-4 text-xl font-bold sm:text-2xl">Assign membership</h2>
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
      <h2 className="mb-1 text-xl font-bold sm:text-2xl">{member.userName}</h2>
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
