// Approvals Admin (owner review 2026-07-04, plan Phase B.4; P1C hardening 2026-07-12) — the owner's screenshot
// flow over the REAL engine: a Pending Account Approvals panel (self-signup queue), an Active Users Directory
// (per-member role dropdown, role-authority description, revoke/reactivate, per-user module access), and the
// server-enforced rank ladder. All writes stay governed: membership.manage + P1C rank checks authorize every
// role/membership change (server RLS is the real gate — the client rank filter below is guidance only); role_id
// is immutable by design, so a role change = expire the old assignment + insert a new one (history preserved,
// both audited). Per-user permission overrides (§2.4) are server-enforced via user_permission_overrides +
// set_user_permission_override — surfaced through the Section Access panel, see AccessDialog
// (P1C2, Item C, 2026-07-17: merges the old per-role "Set Permissions" link + per-key "Overrides" dialog
// into ONE button — owner: "reduce the buttons on the Active POS User Directory").
import {useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {Briefcase, Clock3, ShieldCheck, UserCog, X} from 'lucide-react';
import {offlineDB} from '../../../core/offline/db';
import {hydrateBranches} from '../../../core/offline/hydrate';
import {useRealtimeRefresh} from '../../../core/offline/realtime';
import {supabase} from '../../../core/supabase/client';
import {usePermissions} from '../../../core/permissions/permissions';
import {useSync} from '../../../core/offline/sync';
import {Button, Card, PageHeader, cn} from '../../../components/ui';
import {EmptyState, Skeleton, StatusBadge, useToast} from '../../../components/feedback';
import {SelectField, ConfirmDialog} from '../../../components/overlay';
import {membershipsApi, type MemberRow} from '../memberships/memberships';
import {authApi, type PendingUser} from '../../auth/api';
import {payrollApi} from '../../payroll/api';
import {AccessDialog} from '../overrides/AccessDialog';
import {accessApi} from '../overrides/access';
import {revokeRequestsApi, type RevokeRequest} from '../revoke-requests/revokeRequests';
import {MOCK_MODE, DEMO} from '../../../core/mock/mock';

// P1D §Part1: rank<40 (below co_owner) = a role that implies paid work — approving/assigning it requires
// either linking a Farm Hand payroll record or an explicit exemption (owner spec 2026-07-12).
const PAYROLL_ELIGIBLE_RANK_CEILING = 40;

// Unifies "approving a brand-new pending sign-up" and "reassigning an existing member's role" into one
// flow, since both need the same payroll-link check and the same dialog.
type AssignTarget =
  | {mode: 'approve'; userId: string; displayName: string}
  | {mode: 'reassign'; member: MemberRow; newRoleId: string};

// P1C: rank comes from the real roles.rank column (server-authoritative, 0-100) — not a guessed
// role-name lookup. Client-side GUIDANCE only, same as before; the server's rank-checked RLS (P1C) is
// the real gate. Previously this used a hardcoded role-name table that could silently drift from the
// server's actual rank values (found live 2026-07-12) — now it can't, since it reads the same column.

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
  const {triggerSync, refreshTick} = useSync();
  const canManage = has('membership.manage');
  // P1C3: the lighter tier — can approve/reject pending sign-ups, but NOT Revoke/Archive/Access/
  // Reassign (those stay on canManage, unchanged). manage implies approve (co_owner/owner hold both
  // via the full-catalog seed grant); the OR only matters for a per-user override that grants
  // membership.manage without also granting membership.approve.
  const canApprove = has('membership.approve') || canManage;
  const canManageJobTitle = has('job_title.manage');
  const [jobTitleTarget, setJobTitleTarget] = useState<MemberRow | null>(null);
  const [jobTitleValue, setJobTitleValue] = useState('');

  async function saveJobTitle() {
    if (!jobTitleTarget) return;
    setBusy(true);
    try {
      await membershipsApi.setJobTitle(jobTitleTarget.user_id, jobTitleValue);
      notify(`${jobTitleTarget.userName}'s title updated`);
      setJobTitleTarget(null);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not update title', 'error'); } finally { setBusy(false); }
  }

  const roles = useLiveQuery(async () => (companyId ? offlineDB.roles.where('company_id').equals(companyId).filter((r) => r.status === 'Active').toArray() : []), [companyId]);
  // P1C: rank comes from the real roles.rank column (server-authoritative) — declared early since several
  // handlers below (openReassign, selectedRoleEligible) need it during render, not just inside callbacks.
  const roleRankById = useMemo(() => new Map((roles ?? []).map((r) => [r.id, r.rank])), [roles]);
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<MemberRow | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [rejectTarget, setRejectTarget] = useState<PendingUser | null>(null);
  const [accessTarget, setAccessTarget] = useState<MemberRow | null>(null);

  // P1A: the self-signup approval queue (server: list_pending_users, membership.manage-gated)
  const [pending, setPending] = useState<PendingUser[] | null>(null);
  // P1M (ported from Team B, 2026-07-17): the revoke-approval queue (server: list_revoke_requests,
  // membership.manage-gated). Any co_owner/owner may REQUEST a revoke; a DIFFERENT co_owner/owner must
  // APPROVE/REJECT it (separation of duties). The box only renders when this queue is non-empty.
  const [revokeReqs, setRevokeReqs] = useState<RevokeRequest[] | null>(null);
  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);

  // P1D §Part1: the unified approve/reassign dialog — see AssignTarget above.
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [apBranch, setApBranch] = useState('');
  const [apRole, setApRole] = useState('');
  const [payName, setPayName] = useState('');
  const [payPositionId, setPayPositionId] = useState('');
  const [payRate, setPayRate] = useState('');
  const [payExempt, setPayExempt] = useState(false);
  const [positions, setPositions] = useState<Array<{id: string; label: string}>>([]);
  const [unlinkedEligible, setUnlinkedEligible] = useState<Set<string>>(new Set());

  const reload = () => {
    if (!companyId) return;
    membershipsApi.fetch(companyId).then(setRows).catch(() => setRows([]));
    if (canApprove) authApi.listPendingUsers().then(setPending).catch(() => setPending([]));
    if (canManage) revokeRequestsApi.list().then(setRevokeReqs).catch(() => setRevokeReqs([]));
    // P1C3: positions + unlinked-eligible move to canApprove too — an approve-tier admin approving
    // someone into a payroll-eligible role needs the position dropdown populated, or the approve
    // dialog is uncompletable for a waged role.
    if (canApprove) payrollApi.fetchPositions(companyId).then(setPositions).catch(() => setPositions([]));
    if (canApprove) membershipsApi.unlinkedPayrollEligible(companyId).then((rows) => setUnlinkedEligible(new Set(rows.map((r) => r.user_id)))).catch(() => setUnlinkedEligible(new Set()));
    // Real mode on a fresh device: the branch/role dropdowns read the Dexie cache, which is empty until the
    // Branches/Roles screens have been visited — hydrate it here so approval works standalone (found by the
    // first live-cloud E2E: the approve dialog had zero options). Branches hydration is now shared with
    // every other branch-dependent screen (POS/Inventory/Dashboard hit the same gap, found 2026-07-13).
    hydrateBranches(companyId);
    if (!MOCK_MODE && (typeof navigator === 'undefined' || navigator.onLine)) {
      void Promise.resolve(supabase.from('roles').select('*').eq('company_id', companyId))
        .then(({data}) => {if (data) void offlineDB.roles.bulkPut(data as never[]);}).catch(() => undefined);
    }
  };
  useEffect(reload, [companyId, canManage, canApprove, refreshTick]); // refreshTick: manual sync (top-bar wifi tap)
  useRealtimeRefresh([{table: 'user_branch_roles'}, {table: 'users', scoped: false}], companyId, reload); // P1K: another session's approve/revoke/archive/reject/archive shows up here without a manual refresh (users has no company_id — a pending signup has no company yet, C2 §3)

  function closeAssignDialog() {
    setAssignTarget(null); setApBranch(''); setApRole('');
    setPayName(''); setPayPositionId(''); setPayRate(''); setPayExempt(false);
  }

  function openApprove(p: PendingUser) {
    setAssignTarget({mode: 'approve', userId: p.user_id, displayName: p.display_name ?? 'New member'});
    setApBranch(''); setApRole('');
    setPayName(p.display_name ?? ''); setPayPositionId(''); setPayRate(''); setPayExempt(false);
  }

  function openPayrollSetup(m: MemberRow) {
    // From the backfill banner: same role, just filling in the payroll link that's missing.
    setAssignTarget({mode: 'reassign', member: m, newRoleId: m.role_id});
    setApBranch(m.branch_id); setApRole(m.role_id);
    setPayName(m.userName); setPayPositionId(''); setPayRate(''); setPayExempt(false);
  }

  function openReassign(m: MemberRow, newRoleId: string) {
    if (!newRoleId || newRoleId === m.role_id) return;
    const roleRank = roleRankById.get(newRoleId) ?? 0;
    // Interrupt with the payroll dialog whenever the TARGET role is payroll-eligible — regardless of
    // whether the member's CURRENT role happens to appear in list_unlinked_payroll_eligible (that list
    // only tracks members already sitting in an eligible role with no link; it says nothing about someone
    // being moved INTO an eligible role for the first time, e.g. from co_owner down to admin). Gating on
    // it here meant that exact case bypassed the dialog and committed silently with exempt hardcoded
    // false — guaranteed server rejection with no way for the approver to supply payroll info or opt out
    // (found live 2026-07-13). The server already no-ops the payroll block harmlessly when the member
    // turns out to already have an employee record, so always showing the dialog here is safe.
    if (roleRank < PAYROLL_ELIGIBLE_RANK_CEILING) {
      setAssignTarget({mode: 'reassign', member: m, newRoleId});
      setApBranch(m.branch_id); setApRole(newRoleId);
      setPayName(m.userName); setPayPositionId(''); setPayRate(''); setPayExempt(false);
    } else {
      void commitAssign({mode: 'reassign', member: m, newRoleId}, m.branch_id, newRoleId, undefined, undefined, undefined, false);
    }
  }

  const selectedRoleEligible = (roleRankById.get(apRole) ?? 0) < PAYROLL_ELIGIBLE_RANK_CEILING;
  const payrollFieldsComplete = payExempt || (payName.trim() && payPositionId && parseFloat(payRate) > 0);

  async function commitAssign(
    target: AssignTarget, branchId: string, roleId: string,
    employeeName?: string, positionId?: string, dailyRate?: number, exempt?: boolean,
  ) {
    if (!companyId || !branchId || !roleId) return;
    setBusy(true);
    try {
      const userId = target.mode === 'approve' ? target.userId : target.member.user_id;
      await membershipsApi.assignWithPayroll(companyId, {userId, branchId, roleId, employeeName, positionId, dailyRate, exempt});
      if (target.mode === 'approve') await authApi.mockMarkApproved(); // no-op outside demo mode
      await triggerSync();
      const name = target.mode === 'approve' ? target.displayName : target.member.userName;
      notify(target.mode === 'approve' ? `${name} approved — they now see the assigned branch` : `${name} reassigned`);
      closeAssignDialog();
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : (target.mode === 'approve' ? 'Approval failed' : 'Reassignment failed'), 'error'); } finally { setBusy(false); }
  }

  async function submitAssignDialog() {
    if (!assignTarget) return;
    const rate = parseFloat(payRate);
    await commitAssign(assignTarget, apBranch, apRole, payExempt ? undefined : payName, payExempt ? undefined : payPositionId, payExempt ? undefined : rate, payExempt);
  }

  // P1F: turn away a pending signup (account_status -> Suspended; never a hard-delete — see the migration).
  async function reject() {
    if (!rejectTarget) return;
    setBusy(true);
    try {
      await authApi.rejectPendingUser(rejectTarget.user_id);
      notify(`${rejectTarget.display_name ?? 'Sign-up'} rejected`);
      setRejectTarget(null);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not reject', 'error'); } finally { setBusy(false); }
  }

  // Admin-assisted recovery (B7 §2): send the standard reset email — the admin never touches the password.
  async function sendRecovery(email: string | null, name: string) {
    if (!email) return notify('No email on file for this member.', 'error');
    setBusy(true);
    try { await authApi.sendRecoveryEmail(email); notify(`Recovery email sent to ${name}`); }
    catch (e) { notify(e instanceof Error ? e.message : 'Failed to send', 'error'); } finally { setBusy(false); }
  }

  // My own ERP user id — needed to hide self-actions (Revoke/Access) on my own row. Mock: the known demo
  // identity. Real: current_app_user_id() (the same resolver the server uses) — display-only, the server
  // still gates every write regardless of what this button shows.
  const [realUserId, setRealUserId] = useState<string | null>(null);
  useEffect(() => {
    if (MOCK_MODE) return;
    void Promise.resolve(supabase.rpc('current_app_user_id'))
      .then(({data, error}) => {if (!error) setRealUserId((data as string | null) ?? null);})
      .catch(() => undefined);
    // Re-resolved whenever the member list changes (a proxy for "session/company context settled") so a
    // transient failure or a race with session hydration on first paint self-heals instead of leaving
    // realUserId permanently null (which silently hid self-actions on the admin's own row — found live).
  }, [rows]);
  const myUserId = MOCK_MODE ? DEMO.userId : realUserId;
  const myRank = useMemo(() => {
    if (!myUserId || !rows) return null;
    const mine = rows.filter((r) => r.user_id === myUserId && r.assignment_status === 'Active');
    return mine.length ? Math.max(...mine.map((r) => roleRankById.get(r.role_id) ?? 0)) : null;
  }, [rows, myUserId, roleRankById]);

  const assignableRoles = useMemo(() => {
    const list = roles ?? [];
    if (myRank === null) return list;
    return list.filter((r) => r.rank < myRank); // you appoint BELOW your tier, never peers/above
  }, [roles, myRank]);

  async function setStatus(m: MemberRow, status: 'Active' | 'Expired') {
    setBusy(true);
    try {
      await membershipsApi.update(m, {assignment_status: status, expires_at: null});
      await triggerSync();
      notify(status === 'Expired' ? `${m.userName}'s access revoked` : `${m.userName} reactivated`);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Update failed', 'error'); } finally { setBusy(false); }
  }

  // P1M, evolved P1M.2 (2026-07-17, owner: "only the owner role can revoke without any approval from
  // any tier, but co-owner and below must need approval from owner or co-owner"): for a co_owner (or
  // any other membership.manage holder below owner), this still only QUEUES a request — a different
  // owner/co_owner must approve it from the "Pending Revoke Approvals" box (separation of duties). For
  // the owner tier, the SAME RPC executes the revoke immediately server-side (myRank===50 here is
  // purely for the toast copy — the server independently enforces which path actually runs).
  async function requestRevoke(m: MemberRow, reason: string) {
    setBusy(true);
    try {
      await revokeRequestsApi.request(m.user_id, reason);
      notify(myRank === 50
        ? `${m.userName}'s access has been revoked`
        : `Revoke request queued for ${m.userName} — another owner/co_owner must approve it`);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Request failed', 'error'); } finally { setBusy(false); }
  }
  async function approveRevoke(req: RevokeRequest) {
    setBusy(true);
    try {
      await revokeRequestsApi.approve(req.id);
      await triggerSync();
      notify(`${req.target_name}'s access revoked (request approved)`);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Approve failed', 'error'); } finally { setBusy(false); }
  }
  async function rejectRevoke(req: RevokeRequest) {
    setBusy(true);
    try {
      await revokeRequestsApi.reject(req.id, 'Not approved at this time');
      notify('Revoke request rejected');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Reject failed', 'error'); } finally { setBusy(false); }
  }

  // P1G/P1G.1: retire an account so it drops off the day-to-day directory — auto-revokes any access it
  // still holds in the same call; never a hard-delete. Unarchiving lives in its own "Archived" tab.
  const [archiveTarget, setArchiveTarget] = useState<MemberRow | null>(null);
  async function archive() {
    if (!archiveTarget) return;
    setBusy(true);
    try {
      await membershipsApi.archiveUser(archiveTarget.user_id);
      notify(`${archiveTarget.userName} archived`);
      setArchiveTarget(null);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not archive', 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Approvals Admin" subtitle="Review who can enter the app and what each role is allowed to do." />

      {/* Pending Account Approvals — LIVE self-signup queue (P1A: list_pending_users, P1C3: gated on the
          lighter membership.approve OR membership.manage — approving a signup no longer requires full
          manage). A signup is an Active identity with zero memberships — blind until approved here (C2 §3). */}
      <Card>
        <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-farm-warn"><Clock3 className="h-5 w-5" aria-hidden /> Pending Account Approvals</h3>
        {!canApprove ? (
          <p className="py-4 text-sm text-farm-muted">Only approvers can review sign-ups.</p>
        ) : pending === null ? (
          <Skeleton rows={1} />
        ) : pending.length === 0 ? (
          <p className="py-4 text-sm text-farm-muted">No pending registration requests. New members appear here once they sign up.</p>
        ) : (
          <ul className="divide-y divide-farm-accent-soft">
            {pending.map((p) => (
              <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold text-farm-ink">
                    {p.display_name ?? 'New member'}
                    {p.requested_role ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-900" title="What they ASKED for at sign-up — you still choose the actual role">wants: {p.requested_role}</span> : null}
                  </p>
                  <p className="text-xs text-farm-muted">{p.email ?? 'no email'} · signed up {new Date(p.created_at).toLocaleDateString('en-PH', {month: 'short', day: 'numeric'})}</p>
                </div>
                <span className="flex gap-1.5">
                  <button onClick={() => openApprove(p)} disabled={busy}
                    className="rounded-lg bg-farm-green px-3 py-1.5 text-xs font-bold text-white hover:opacity-90">
                    Review &amp; approve
                  </button>
                  <button onClick={() => setRejectTarget(p)} disabled={busy}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-farm-danger hover:bg-red-100">
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-farm-muted">A sign-up sees no farm data until you approve it with a branch and role — approval is the same governed assignment the Members tab uses.</p>
      </Card>

      {/* P1M (ported from Team B, 2026-07-17): the Pending Revoke Approvals box — mirrors Pending
          Account Approvals. Renders ONLY when revokeReqs has rows (owner spec: "only appear when
          there's a pending revoke"). Owner directive 2026-07-17: kept directly below Pending Account
          Approvals so the two "Pending X Approvals" cards stay adjacent, above the directory table. */}
      {canManage && revokeReqs != null && revokeReqs.length > 0 ? (
        <Card>
          <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-farm-warn"><Clock3 className="h-5 w-5" aria-hidden /> Pending Revoke Approvals</h3>
          <p className="mb-3 text-xs text-farm-muted">A co_owner/owner queued these revoke requests. A DIFFERENT co_owner/owner must approve or reject each — you cannot approve your own request. Approving immediately sets the account's memberships to Expired.</p>
          <ul className="divide-y divide-farm-accent-soft">
            {revokeReqs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-bold text-farm-ink">{r.target_name}</p>
                  <p className="text-xs text-farm-muted">
                    Requested by {r.requester_name} · {new Date(r.created_at).toLocaleDateString('en-PH', {month: 'short', day: 'numeric'})}
                  </p>
                  <p className="mt-0.5 text-xs italic text-farm-muted">"{r.reason}"</p>
                </div>
                <span className="flex gap-1.5">
                  <button onClick={() => void approveRevoke(r)} disabled={busy}
                    className="rounded-lg bg-farm-danger px-3 py-1.5 text-xs font-bold text-white hover:opacity-90">
                    Approve revoke
                  </button>
                  <button onClick={() => void rejectRevoke(r)} disabled={busy}
                    className="rounded-lg border border-farm-accent bg-farm-bg px-3 py-1.5 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* P1D §Part1 backfill banner — existing eligible accounts with no payroll link and not exempt.
          Never blocks their current access; a per-row CTA opens the same payroll-setup dialog. */}
      {canManage && rows && unlinkedEligible.size > 0 ? (
        <Card>
          <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-farm-warn"><Briefcase className="h-5 w-5" aria-hidden /> Payroll setup needed</h3>
          <p className="mb-3 text-xs text-farm-muted">These accounts hold a waged role but have no linked Farm Hand pay record yet. Their app access is unaffected — this is just a reminder.</p>
          <ul className="divide-y divide-farm-accent-soft">
            {rows.filter((m) => unlinkedEligible.has(m.user_id) && m.assignment_status === 'Active').map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2.5">
                <span className="text-sm font-bold text-farm-ink">{m.userName} <span className="font-normal text-farm-muted">— {m.roleKey}</span></span>
                <button onClick={() => openPayrollSetup(m)} disabled={busy} className="rounded-lg border border-farm-accent bg-farm-bg px-2.5 py-1 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">Set up payroll</button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Admin-assisted password recovery (B7 §2): sends the standard reset email — you never see the password. */}
      {canManage && !MOCK_MODE ? (
        <Card>
          <h3 className="mb-2 text-base font-bold text-farm-green">Help a member who is locked out</h3>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {e.preventDefault(); const f = new FormData(e.currentTarget); void sendRecovery(String(f.get('email') || '') || null, String(f.get('email') || ''));}}>
            <input name="email" type="email" required placeholder="member@email.com" className="min-h-11 flex-1 rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" aria-label="Member email" />
            <button type="submit" disabled={busy} className="rounded-lg border border-farm-accent px-3 py-2 text-sm font-bold text-farm-green hover:bg-farm-accent-soft">Send reset email</button>
          </form>
          <p className="mt-1.5 text-[11px] text-farm-muted">They get the same self-service reset link — you never see or set their password.</p>
        </Card>
      ) : null}

      {/* Unified approve/reassign dialog: pick branch (approve only) + role, then payroll setup if the
          role is waged (P1D §Part1) — creates/links the Farm Hand record atomically with the membership. */}
      <Dialog.Root open={assignTarget !== null} onOpenChange={(o) => {if (!o) closeAssignDialog();}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">
                {assignTarget?.mode === 'approve' ? `Approve ${assignTarget.displayName}` : `Reassign ${assignTarget?.member.userName ?? 'member'}`}
              </Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-4 text-xs text-farm-muted">
              {assignTarget?.mode === 'approve' ? 'Choose where they work and what they may do. This creates their first membership — access starts immediately.' : 'Waged roles need a linked payroll record before this takes effect.'}
            </p>
            <div className="space-y-4 text-sm">
              {assignTarget?.mode === 'approve' ? (
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Branch</label>
                  <SelectField value={apBranch} onChange={setApBranch} placeholder="Pick a branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Role</label>
                <SelectField value={apRole} onChange={setApRole} placeholder="Pick a role" options={assignableRoles.map((r) => ({value: r.id, label: r.role_key}))} />
              </div>

              {selectedRoleEligible ? (
                <div className="space-y-3 rounded-xl border border-farm-accent bg-farm-bg/60 p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-farm-warn"><Briefcase className="h-3.5 w-3.5" aria-hidden /> This role is waged — link a Farm Hand payroll record</p>
                  {!payExempt ? (
                    <>
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Worker Name</label>
                        <input value={payName} onChange={(e) => setPayName(e.target.value)} className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-card px-3 text-sm" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Position</label>
                        <SelectField value={payPositionId} onChange={setPayPositionId} placeholder="Pick a position" options={positions.map((p) => ({value: p.id, label: p.label}))} />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Daily Rate (₱)</label>
                        <input value={payRate} onChange={(e) => setPayRate(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="tabular min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-card px-3 text-right text-sm font-bold" />
                      </div>
                    </>
                  ) : null}
                  <label className="flex items-center gap-2 text-xs text-farm-muted">
                    <input type="checkbox" checked={payExempt} onChange={(e) => setPayExempt(e.target.checked)} className="h-4 w-4" />
                    This account does not require payroll (test/service accounts)
                  </label>
                </div>
              ) : null}
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={closeAssignDialog} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submitAssignDialog()} disabled={busy || !apBranch || !apRole || (selectedRoleEligible && !payrollFieldsComplete)}>
                {busy ? 'Saving…' : assignTarget?.mode === 'approve' ? 'Approve access' : 'Save reassignment'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Active users directory — archived accounts live in their own "Archived" tab, not here. */}
      <Card>
        <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-farm-green"><UserCog className="h-5 w-5" aria-hidden /> Active POS Users Directory</h3>
        {rows === null ? (
          <Skeleton rows={3} />
        ) : rows.filter((m) => m.accountStatus !== 'Archived').length === 0 ? (
          <EmptyState title="No members yet" hint="Assign members from the Members tab or send an invitation." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-farm-accent-soft text-left text-xs font-bold tracking-wider text-farm-muted">
                  <th className="pb-3">Username</th><th className="pb-3">Job Title</th><th className="pb-3">Assigned Role</th><th className="pb-3">Role Authority</th>
                  <th className="pb-3">Branch</th><th className="pb-3">Status</th><th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-farm-accent-soft">
                {rows.filter((m) => m.accountStatus !== 'Archived').map((m) => {
                  const isMe = myUserId !== null && m.user_id === myUserId;
                  return (
                    <tr key={m.id} className={cn('hover:bg-farm-bg/30', m.assignment_status !== 'Active' && 'opacity-50')}>
                      <td className="py-3 font-mono font-bold text-farm-ink">{m.userName} {isMe ? <span className="rounded bg-farm-green px-1.5 py-0.5 text-[9px] font-black text-white">YOU</span> : null}</td>
                      <td className="py-3 text-xs text-farm-muted">
                        {canManageJobTitle ? (
                          <button onClick={() => {setJobTitleTarget(m); setJobTitleValue(m.jobTitle ?? '');}} className="rounded-lg border border-dashed border-farm-accent-soft px-2 py-1 text-left hover:border-farm-accent hover:text-farm-green">{m.jobTitle || 'Set title…'}</button>
                        ) : (m.jobTitle || '—')}
                      </td>
                      <td className="py-3">
                        {canManage && !isMe && m.assignment_status === 'Active' ? (
                          <div className="w-36"><SelectField value={m.role_id} onChange={(v) => openReassign(m, v)} options={[{value: m.role_id, label: m.roleKey}, ...assignableRoles.filter((r) => r.id !== m.role_id).map((r) => ({value: r.id, label: r.role_key}))]} /></div>
                        ) : (
                          <span className="rounded-full bg-farm-accent-soft px-2.5 py-1 text-xs font-bold text-farm-green">{m.roleKey}</span>
                        )}
                      </td>
                      <td className="py-3 text-xs text-farm-muted">{ROLE_AUTHORITY[m.roleKey.toLowerCase()] ?? 'Custom role — permissions set in the Roles tab'}</td>
                      <td className="py-3 text-xs font-semibold text-farm-muted">{m.branchName}</td>
                      <td className="py-3"><StatusBadge status={m.assignment_status} /></td>
                      <td className="py-3 text-right">
                        <span className="flex justify-end gap-1.5">
                          {canManage && !isMe ? (
                            <button onClick={() => setAccessTarget(m)} disabled={busy} className="rounded-lg border border-farm-accent bg-farm-bg px-2.5 py-1 text-xs font-bold text-farm-green hover:bg-farm-accent-soft" title="Set what this person can see and do, per section">Access</button>
                          ) : null}
                          {canManage && !isMe ? (
                            m.assignment_status === 'Active'
                              ? <button onClick={() => setRevokeTarget(m)} disabled={busy} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-farm-danger hover:bg-red-100">Revoke</button>
                              : <button onClick={() => void setStatus(m, 'Active')} disabled={busy} className="rounded-lg px-2.5 py-1 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">Reactivate</button>
                          ) : null}
                          {canManage && !isMe ? (
                            <button onClick={() => setArchiveTarget(m)} disabled={busy} className="rounded-lg border border-farm-accent-soft bg-farm-bg px-2.5 py-1 text-xs font-bold text-farm-muted hover:bg-farm-accent-soft" title="Retire this account — revokes any access it still has and hides it from the directory; nothing is deleted">Archive</button>
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

      {/* P1M (ported from Team B, 2026-07-17): Revoke is now a REQUEST — not a unilateral action. A
          co_owner/owner queues it here with a reason; a DIFFERENT co_owner/owner approves it from the
          "Pending Revoke Approvals" box below (separation of duties). The server enforces both gates
          (membership.manage + approver != requester) — see scripts/guards/p1m-revoke-approval-security.sql. */}
      <Dialog.Root open={revokeTarget !== null} onOpenChange={(o) => {if (!o) {setRevokeTarget(null); setRevokeReason('');}}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="mb-2 text-lg font-bold text-farm-danger">
              {revokeTarget ? `${myRank === 50 ? 'Revoke' : 'Request revoke for'} ${revokeTarget.userName}?` : ''}
            </Dialog.Title>
            <Dialog.Description className="mb-4 text-sm text-farm-muted">
              {myRank === 50
                ? 'As owner, this revokes access immediately — no approval needed.'
                : 'This queues a revoke request. Another owner/co_owner must approve it — you cannot approve your own request. Their access stays until then.'}
            </Dialog.Description>
            <textarea
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              placeholder="Reason for revoke (required) — e.g. end of contract, role change"
              rows={3}
              className="min-h-20 w-full resize-none rounded-lg border border-farm-accent-soft bg-farm-bg px-3 py-2 text-sm"
              aria-label="Reason for revoke"
            />
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => {setRevokeTarget(null); setRevokeReason('');}} disabled={busy}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={busy || revokeReason.trim().length < 3}
                onClick={() => {const r = revokeTarget; const reason = revokeReason; setRevokeTarget(null); setRevokeReason(''); if (r) void requestRevoke(r, reason);}}
              >
                {busy ? (myRank === 50 ? 'Revoking…' : 'Queuing…') : myRank === 50 ? 'Revoke access' : 'Queue revoke request'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={archiveTarget !== null}
        title={archiveTarget ? `Archive ${archiveTarget.userName}?` : ''}
        description={archiveTarget?.assignment_status === 'Active'
          ? 'This revokes their access right now AND retires the account in one step — they will no longer be able to sign in. You can unarchive later, which restores the account (not the role — you’d reassign that separately). Nothing is deleted.'
          : 'This retires the account so it drops off the day-to-day directory. You can unarchive later. Nothing is deleted.'}
        confirmLabel="Archive account"
        danger
        onCancel={() => setArchiveTarget(null)}
        onConfirm={archive}
      />

      <ConfirmDialog
        open={rejectTarget !== null}
        title={rejectTarget ? `Reject ${rejectTarget.display_name ?? 'this sign-up'}?` : ''}
        description="They will see a clear rejection screen if they sign back in, and can never be approved without you undoing this first. Their sign-up record is kept, not deleted, so anyone they may have interacted with still has a complete history."
        confirmLabel="Reject sign-up"
        danger
        onCancel={() => setRejectTarget(null)}
        onConfirm={reject}
      />

      {companyId && accessTarget ? (
        <AccessDialog
          title={`Access — ${accessTarget.userName}`}
          open={accessTarget !== null}
          onClose={() => setAccessTarget(null)}
          getTier={(leaf) => accessApi.tier(companyId, accessTarget.user_id, leaf)}
          applyTier={(leaf, target) => accessApi.apply(companyId, accessTarget.user_id, leaf, target)}
          savedMessage={(n) => n > 0 ? `Updated ${n} section${n === 1 ? '' : 's'} for ${accessTarget.userName}` : 'No changes to save'}
        />
      ) : null}

      {/* P1D §Part3: job title — purely descriptive, no payroll/reporting logic keyed to it. */}
      <Dialog.Root open={jobTitleTarget !== null} onOpenChange={(o) => {if (!o) setJobTitleTarget(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-xs -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <Dialog.Title className="mb-4 text-lg font-bold text-farm-green">{jobTitleTarget?.userName}'s job title</Dialog.Title>
            <input
              value={jobTitleValue}
              onChange={(e) => setJobTitleValue(e.target.value)}
              placeholder="e.g. Field Supervisor"
              className="min-h-11 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm"
            />
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setJobTitleTarget(null)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void saveJobTitle()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
