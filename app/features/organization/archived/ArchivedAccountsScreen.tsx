// Archived accounts (P1G, owner request 2026-07-13: "a tab so we can store them properly and see them
// properly"). Own home for account_status='Archived' identities — the day-to-day directory (Approvals
// tab) never shows them. Never a hard-delete: this is a view + an Unarchive action over the same
// membershipsApi/archive_user_account governed path, membership.manage-gated server-side.
import {useEffect, useState} from 'react';
import {ArchiveRestore} from 'lucide-react';
import {useSync} from '../../../core/offline/sync';
import {usePermissions} from '../../../core/permissions/permissions';
import {Card, PageHeader} from '../../../components/ui';
import {EmptyState, Skeleton, useToast} from '../../../components/feedback';
import {membershipsApi, type MemberRow} from '../memberships/memberships';

export default function ArchivedAccountsScreen() {
  const {companyId, has} = usePermissions();
  const {refreshTick} = useSync();
  const {notify} = useToast();
  const canManage = has('membership.manage');
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    if (!companyId) return;
    membershipsApi.fetch(companyId).then(setRows).catch(() => setRows([]));
  };
  useEffect(reload, [companyId, refreshTick]); // refreshTick: manual sync (top-bar wifi tap)

  async function unarchive(m: MemberRow) {
    setBusy(true);
    try {
      await membershipsApi.unarchiveUser(m.user_id);
      notify(`${m.userName} restored from archive`);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Could not restore', 'error'); } finally { setBusy(false); }
  }

  const archived = (rows ?? []).filter((m) => m.accountStatus === 'Archived');

  return (
    <div className="space-y-6">
      <PageHeader title="Archived Accounts" subtitle="Retired accounts, kept for the record — nothing here was deleted." />
      <Card>
        {!canManage ? (
          <p className="py-4 text-sm text-farm-muted">Only membership managers can view archived accounts.</p>
        ) : rows === null ? (
          <Skeleton rows={3} />
        ) : archived.length === 0 ? (
          <EmptyState title="No archived accounts" hint="Accounts you archive from Approvals & Roles show up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-farm-accent-soft text-left text-xs font-bold tracking-wider text-farm-muted">
                  <th className="pb-3">Username</th><th className="pb-3">Job Title</th><th className="pb-3">Last Role</th>
                  <th className="pb-3">Last Branch</th><th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-farm-accent-soft">
                {archived.map((m) => (
                  <tr key={m.id} className="opacity-70 hover:bg-farm-bg/30">
                    <td className="py-3 font-mono font-bold text-farm-ink">{m.userName}</td>
                    <td className="py-3 text-xs text-farm-muted">{m.jobTitle || '—'}</td>
                    <td className="py-3"><span className="rounded-full bg-farm-accent-soft px-2.5 py-1 text-xs font-bold text-farm-muted">{m.roleKey}</span></td>
                    <td className="py-3 text-xs font-semibold text-farm-muted">{m.branchName}</td>
                    <td className="py-3 text-right">
                      <button onClick={() => void unarchive(m)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-farm-accent bg-farm-bg px-2.5 py-1 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">
                        <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> Unarchive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[11px] text-farm-muted">Unarchiving restores the account to Active — you'll still need to assign it a branch and role separately, same as any new sign-up.</p>
      </Card>
    </div>
  );
}
