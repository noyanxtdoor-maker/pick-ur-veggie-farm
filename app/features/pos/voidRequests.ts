// P2N2 (2026-07-19, owner: "finish and deploy the deferred money path"): void-sale approval queue.
// Mirrors the revoke-request workflow (organization/revoke-requests/revokeRequests.ts): any pos.sell
// holder may FILE a void request; a DIFFERENT pos.void holder must APPROVE/REJECT it (separation of
// duties). The server executes the actual reversal (journal + stock return, B2A-account-aware) on
// approve. Online-only (server-enforced RPCs); no Dexie cache, no offline queue for the decision —
// exactly like Overrides + Invitations + revoke requests.
// MOCK_MODE has exactly one demo user — there is no second person who could ever be the separate
// approver this workflow requires, so simulating it would misrepresent the feature's whole point.
import {supabase} from '../../core/supabase/client';
import {MOCK_MODE} from '../../core/mock/mock';

export interface VoidRequest {
  id: string;
  invoice_id: string;
  invoice_number: number | null;
  branch_id: string;
  branch_name: string;
  requested_by: string;
  requester_name: string;
  reason: string;
  created_at: string;
}

export const voidRequestsApi = {
  async list(): Promise<VoidRequest[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.rpc('list_void_requests');
    if (error) throw new Error(error.message);
    return (data ?? []) as VoidRequest[];
  },
  async approve(requestId: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has no pending void requests.');
    const {error} = await supabase.rpc('approve_void_request', {p_request_id: requestId});
    if (error) throw new Error(error.message);
  },
  async reject(requestId: string, reason: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has no pending void requests.');
    const {error} = await supabase.rpc('reject_void_request', {
      p_request_id: requestId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
  },
};
