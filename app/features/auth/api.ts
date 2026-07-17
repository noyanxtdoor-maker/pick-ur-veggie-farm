// Auth-lifecycle data access (P1A). The approval queue reads the governed list_pending_users() (server:
// membership.manage-gated); approval itself is the EXISTING membership assignment (p2m1 RLS — nothing new
// to trust). Admin-assisted recovery (B7 §2) sends the standard reset email to the employee's address —
// the admin never sees or sets the password itself.
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {MOCK_MODE} from '../../core/mock/mock';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

export interface PendingUser {
  user_id: string;
  display_name: string | null;
  email: string | null;
  requested_role: string | null; // the sign-up's WISH (P1B) — grants nothing; approver assigns the real role
  created_at: string;
}

// mock: one demo pending signup so the queue UI is exercisable offline; approving it clears the flag.
const MOCK_PENDING: PendingUser = {
  user_id: '00000000-0000-7000-8000-0000000000c9',
  display_name: 'Pending Demo (self-signup)',
  email: 'pending@demo.local',
  requested_role: 'operator',
  created_at: new Date().toISOString(),
};

export const authApi = {
  async listPendingUsers(): Promise<PendingUser[]> {
    if (MOCK_MODE) {
      const approved = (await offlineDB.meta.get('mock-pending-approved'))?.value === true;
      return approved ? [] : [MOCK_PENDING];
    }
    if (!online()) return []; // the queue is a live-admin surface; offline shows empty rather than stale
    const {data, error} = await supabase.rpc('list_pending_users');
    if (error) throw new Error(error.message);
    return (data ?? []) as PendingUser[];
  },

  // mock-only: mark the demo pending user approved (real approval = membership assign, done by the caller)
  async mockMarkApproved(): Promise<void> {
    if (MOCK_MODE) await offlineDB.meta.put({key: 'mock-pending-approved', value: true});
  },

  // Admin-assisted recovery (B7 §2): triggers the same self-service reset email for a member who is locked
  // out. The link lands on /auth/reset; the admin never handles the password.
  async sendRecoveryEmail(email: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has no passwords to reset.');
    const {error} = await supabase.auth.resetPasswordForEmail(email, {redirectTo: `${window.location.origin}/auth/reset`});
    if (error) throw new Error(error.message);
  },

  // P1F: turn away a pending signup — account_status -> Suspended (never a hard-delete; see the migration).
  async rejectPendingUser(userId: string): Promise<void> {
    if (MOCK_MODE) { await offlineDB.meta.put({key: 'mock-pending-approved', value: true}); return; } // demo: just clears the one seeded pending row
    const {error} = await supabase.rpc('reject_pending_user', {p_user_id: userId});
    if (error) throw new Error(error.message);
  },

  // P1F: self-only status read so AwaitingApproval can tell "still pending" apart from "rejected" — both
  // resolve to a NULL companyId, but only Suspended is a rejection.
  async myAccountStatus(): Promise<'Active' | 'Suspended' | null> {
    if (MOCK_MODE) return 'Active';
    const {data, error} = await supabase.rpc('my_account_status');
    if (error) return null;
    return (data as 'Active' | 'Suspended' | null) ?? null;
  },
};
