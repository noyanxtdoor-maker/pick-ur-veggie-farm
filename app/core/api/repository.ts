// Data-access seam (M1B A1): the api layer is the ONLY caller of supabase-js; UI never touches it directly.
// Provides the outbox Sender (maps a queued write onto PostgREST with honest error classification) and a
// read wrapper. Whether a call is PostgREST/RPC/(future Edge Function) stays hidden behind this seam.
import {supabase} from '../supabase/client';
import type {OutboxItem} from '../offline/db';
import type {SendResult, Sender} from '../offline/queue';

export interface PgError {
  code?: string;
  message: string;
}

// SQLSTATEs that are PERMANENT (→ Blocked, needs review — never retried): RLS/permission, FK, check, not-null.
const PERMANENT = new Set(['42501', '23503', '23514', '23502', '22P02', '23001']);

function classify(error: PgError, isInsert: boolean): SendResult {
  // A retried natural-key insert that already landed → the unique constraint IS the dedup (at-most-once).
  if (isInsert && error.code === '23505') return {ok: true, result: {dedup: true}};
  if (error.code && PERMANENT.has(error.code)) return {ok: false, retryable: false, error: error.message};
  // No code → network/transport failure → retry (B5 §10).
  return {ok: false, retryable: Boolean(!error.code) || error.code === 'PGRST301', error: error.message};
}

// The Sender used by the outbox in the real app. Only naturally-idempotent writes are queued (config
// updates + natural-key creates). Non-idempotent RPCs (invite_user) are NOT queued — they run online only.
export const supabaseSender: Sender = async (item: OutboxItem): Promise<SendResult> => {
  const {request} = item;
  try {
    if (request.type === 'insert') {
      const {error} = await supabase.from(request.table!).insert(request.payload);
      if (error) return classify(error, true);
      return {ok: true, result: {inserted: true}};
    }
    if (request.type === 'update') {
      const id = request.match?.id;
      if (!id) return {ok: false, retryable: false, error: 'update missing id'};
      let q = supabase.from(request.table!).update(request.payload).eq('id', id);
      // Optimistic concurrency (M1B C1): only apply if the row is unchanged since we read it.
      if (request.match?.baseUpdatedAt) q = q.eq('updated_at', request.match.baseUpdatedAt);
      const {data, error} = await q.select();
      if (error) return classify(error, false);
      if (!data || data.length === 0) {
        // 0 rows → the row changed on the server (or RLS hid it): surface as a conflict, never silent (C1).
        // reason: 'conflict' — the frozen baseUpdatedAt can never match again, so "Retry now" would be
        // guaranteed to fail forever; the UI needs this to point the user at re-applying instead of retrying.
        return {ok: false, retryable: false, error: 'This record changed on the server. Review before re-applying.', reason: 'conflict'};
      }
      return {ok: true, result: data[0]};
    }
    // rpc (queued RPCs would need to be idempotent; none are queued in M1).
    const {data, error} = await supabase.rpc(request.rpc!, request.payload);
    if (error) return classify(error, false);
    return {ok: true, result: data};
  } catch (e) {
    // Thrown = transport/offline → retryable.
    return {ok: false, retryable: true, error: e instanceof Error ? e.message : String(e)};
  }
};

// Read wrapper — normalizes {data,error}; throws on hard error so callers can surface ErrorState.
export async function read<T>(run: () => Promise<{data: T | null; error: PgError | null}>): Promise<T> {
  const {data, error} = await run();
  if (error) throw new Error(error.message);
  return (data ?? ([] as unknown as T));
}
