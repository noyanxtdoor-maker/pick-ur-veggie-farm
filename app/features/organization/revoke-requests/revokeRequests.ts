// P1M (ported from Team B, 2026-07-17): revoke-account approval workflow. Mirrors the P1A self-signup
// approval queue: any membership.manage holder (co_owner/owner) may QUEUE a revoke; a DIFFERENT
// membership.manage holder must APPROVE/REJECT it (separation of duties). The server executes the
// actual revoke (memberships -> Expired, audited) on approve. Online-only (server-enforced RPCs); no
// Dexie cache, no offline queue — exactly like Overrides + Invitations.
// MOCK_MODE has exactly one demo user (DEMO.userId) — there is no second person who could ever be the
// separate approver this workflow requires, so simulating it would misrepresent the feature's whole
// point. Write actions are honestly unavailable in the demo, matching this repo's existing
// demo-mode-has-no-X convention (e.g. session.tsx's password/email actions).
import {supabase} from '../../../core/supabase/client';
import {MOCK_MODE} from '../../../core/mock/mock';

export interface RevokeRequest {
  id: string;
  target_user_id: string;
  target_name: string;
  requested_by: string;
  requester_name: string;
  reason: string;
  created_at: string;
}

export const revokeRequestsApi = {
  async list(): Promise<RevokeRequest[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.rpc('list_revoke_requests');
    if (error) throw new Error(error.message);
    return (data ?? []) as RevokeRequest[];
  },
  async request(targetUserId: string, reason: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has only one account — there is no second owner/co_owner to approve a revoke.');
    const {error} = await supabase.rpc('request_revoke', {
      p_target_user_id: targetUserId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
  },
  async approve(requestId: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has no pending revoke requests.');
    const {error} = await supabase.rpc('approve_revoke_request', {p_request_id: requestId});
    if (error) throw new Error(error.message);
  },
  async reject(requestId: string, reason: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has no pending revoke requests.');
    const {error} = await supabase.rpc('reject_revoke_request', {
      p_request_id: requestId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
  },
};
