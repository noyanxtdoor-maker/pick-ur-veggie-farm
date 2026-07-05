// Approvals Admin (owner review 2026-07-04, plan Phase B.4) — the owner's screenshot flow over the REAL engine:
// a Pending Account Approvals panel (self-signup queue lands with the cloud/auth phase — recorded, not faked)
// and an Active Users Directory: per-member role dropdown (appointment-hierarchy guidance), role-authority
// description, revoke/reactivate. Server gates are UNCHANGED: membership.manage RLS authorizes every write;
// role_id is immutable by design, so a role change = expire the old assignment + insert a new one (history
// preserved, both audited). Per-user permission overrides are deliberately NOT here — permissions stay
// role-based (edit them in the Roles tab); a per-user override table would mean evolving the locked Phase-1
// has_permission resolver, which is a gated auth-domain change.
import {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {useLiveQuery} from 'dexie-react-hooks';
import {Clock3, ShieldCheck, UserCog} from 'lucide-react';
import {offlineDB} from '../../../core/offline/db';
import {usePermissions} from '../../../core/permissions/permissions';
import {useSync} from '../../../core/offline/sync';
import {Card, PageHeader, cn} from '../../../components/ui';
import {EmptyState, Skeleton, StatusBadge, useToast} from '../../../components/feedback';
import {SelectField, ConfirmDialog} from '../../../components/overlay';
import {membershipsApi, type MemberRow} from '../memberships/memberships';
import {MOCK_MODE, DEMO} from '../../../core/mock/mock';

// The owner's 5-tier model. Unknown/custom role keys rank as admin-tier. Client-side GUIDANCE only —
// the server's membership.manage RLS is the real gate (true hierarchy enforcement ships with the
// cloud-phase registration queue).
const RANK: Record<string, number> = {developer: 5, dev: 5, owner: 4, co_owner: 3, 'co-owner': 3, admin: 2, operator: 1, employee: 0, worker: 0};
const rankOf = (key: string) => RANK[key.toLowerCase()] ?? 2;

const ROLE_AUTHORITY: Record<string, string> = {
  developer: 'Absolute full rights to all tables',
  dev: 'Absolute full rights to all tables',
  owner: 'Appoint roles, view and edit accounts & ledgers',
  co_owner: 'All access — edit everything except developer configurations',
  admin: 'POS, financial statements, core ledgers, setup',
  operator: 'Data entry inputs, POS cashier, view payroll sheets',
  employee: 'Enter individual sales only, check own pay',
  worker: 'Enter individual sales only, check own pay',
};

export default function ApprovalsScreen() {
  const {companyId, has} = usePermissions();
  const {notify} = useToast();
  const {triggerSync} = useSync();
  const canManage = has('membership.manage');

  const roles = useLiveQuery(async () => (companyId ? offlineDB.roles.where('company_id').equals(companyId).filter((r) => r.status === 'Active').toArray() : []), [companyId]);
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<MemberRow | null>(null);

  const reload = () => {if (companyId) membershipsApi.fetch(companyId).then(setRows).catch(() => setRows([]));};
  useEffect(reload, [companyId]);

  // My rank (mock: known demo identity; real: unknown → no client cap, the server still gates writes).
  const myUserId = MOCK_MODE ? DEMO.userId : null;
  const myRank = useMemo(() => {
    if (!myUserId || !rows) return null;
    const mine = rows.filter((r) => r.user_id === myUserId && r.assignment_status === 'Active');
    return mine.length ? Math.max(...mine.map((r) => rankOf(r.roleKey))) : null;
  }, [rows, myUserId]);

  const assignableRoles = useMemo(() => {
    const list = roles ?? [];
    if (myRank === null) return list;
    return list.filter((r) => rankOf(r.role_key) < myRank); // you appoint BELOW your tier, never peers/above
  }, [roles, myRank]);

  async function changeRole(m: MemberRow, newRoleId: string) {
    if (!companyId || newRoleId === m.role_id) return;
    setBusy(true);
    try {
      // role_id is immutable by design → expire the old assignment, insert the new one (history + audit kept)
      await membershipsApi.update(m, {assignment_status: 'Expired', expires_at: null});
      await membershipsApi.assign(companyId, {user_id: m.user_id, branch_id: m.branch_id, role_id: newRoleId});
      await triggerSync();
      notify(`${m.userName} reassigned`);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Reassignment failed', 'error'); } finally { setBusy(false); }
  }

  async function setStatus(m: MemberRow, status: 'Active' | 'Expired') {
    setBusy(true);
    try {
      await membershipsApi.update(m, {assignment_status: status, expires_at: null});
      await triggerSync();
      notify(status === 'Expired' ? `${m.userName}'s access revoked` : `${m.userName} reactivated`);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Update failed', 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Approvals Admin" subtitle="Review who can enter the app and what each role is allowed to do." />

      {/* Pending Account Approvals — the self-signup queue ships with the cloud/auth phase (recorded design) */}
      <Card>
        <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-farm-warn"><Clock3 className="h-5 w-5" aria-hidden /> Pending Account Approvals</h3>
        <p className="py-4 text-sm text-farm-muted">No pending registration requests to show.</p>
        <p className="text-[11px] text-farm-muted">Self-signup with a role choice (and the “please wait while we review your application” flow) arrives with the cloud phase — new members join via <Link to="/organization/invitations" className="font-bold text-farm-green underline">Invitations</Link> for now.</p>
      </Card>

      {/* Active users directory */}
      <Card>
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-farm-green"><UserCog className="h-5 w-5" aria-hidden /> Active POS Users Directory</h3>
        {rows === null ? (
          <Skeleton rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState title="No members yet" hint="Assign members from the Members tab or send an invitation." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-farm-accent-soft text-left text-xs font-bold tracking-wider text-farm-muted">
                  <th className="pb-3">Username</th><th className="pb-3">Assigned Role</th><th className="pb-3">Role Authority</th>
                  <th className="pb-3">Branch</th><th className="pb-3">Status</th><th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-farm-accent-soft">
                {rows.map((m) => {
                  const isMe = myUserId !== null && m.user_id === myUserId;
                  return (
                    <tr key={m.id} className={cn('hover:bg-farm-bg/30', m.assignment_status !== 'Active' && 'opacity-50')}>
                      <td className="py-3 font-mono font-bold text-farm-ink">{m.userName} {isMe ? <span className="rounded bg-farm-green px-1.5 py-0.5 text-[9px] font-black text-white">YOU</span> : null}</td>
                      <td className="py-3">
                        {canManage && !isMe && m.assignment_status === 'Active' ? (
                          <div className="w-36"><SelectField value={m.role_id} onChange={(v) => void changeRole(m, v)} options={[{value: m.role_id, label: m.roleKey}, ...assignableRoles.filter((r) => r.id !== m.role_id).map((r) => ({value: r.id, label: r.role_key}))]} /></div>
                        ) : (
                          <span className="rounded-full bg-farm-accent-soft px-2.5 py-1 text-xs font-bold text-farm-green">{m.roleKey}</span>
                        )}
                      </td>
                      <td className="py-3 text-xs text-farm-muted">{ROLE_AUTHORITY[m.roleKey.toLowerCase()] ?? 'Custom role — permissions set in the Roles tab'}</td>
                      <td className="py-3 text-xs font-semibold text-farm-muted">{m.branchName}</td>
                      <td className="py-3"><StatusBadge status={m.assignment_status} /></td>
                      <td className="py-3 text-right">
                        <span className="flex justify-end gap-1.5">
                          <Link to="/organization/roles" className="rounded-lg border border-farm-accent bg-farm-bg px-2.5 py-1 text-xs font-bold text-farm-green hover:bg-farm-accent-soft" title="Permissions are set per ROLE — edit what this role can do">Set Permissions</Link>
                          {canManage && !isMe ? (
                            m.assignment_status === 'Active'
                              ? <button onClick={() => setRevokeTarget(m)} disabled={busy} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-farm-danger hover:bg-red-100">Revoke</button>
                              : <button onClick={() => void setStatus(m, 'Active')} disabled={busy} className="rounded-lg px-2.5 py-1 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">Reactivate</button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-farm-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-farm-green" aria-hidden />
          You can only appoint roles below your own tier. Every change is server-checked and audited; permissions themselves are edited per role in the Roles tab.
        </p>
      </Card>

      <ConfirmDialog
        open={revokeTarget !== null}
        title={revokeTarget ? `Revoke ${revokeTarget.userName}'s access?` : ''}
        description="Their assignment becomes Expired and they lose access immediately. You can reactivate later — nothing is deleted."
        confirmLabel="Revoke access"
        danger
        onCancel={() => setRevokeTarget(null)}
        onConfirm={async () => {if (revokeTarget) await setStatus(revokeTarget, 'Expired'); setRevokeTarget(null);}}
      />
    </div>
  );
}
