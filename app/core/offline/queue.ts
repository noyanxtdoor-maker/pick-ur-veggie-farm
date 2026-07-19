// Write-ahead outbox queue (B5 §1–§2, §5; M1B O1/O3/O4). Guarantees:
//  • App crash cannot LOSE a queued action — enqueue is a single atomic IndexedDB commit before the UI confirms.
//  • Device reboot cannot DUPLICATE actions — every action carries one client idempotency key; the server
//    dedups on (company_id, idempotency_key); re-driving an interrupted item reuses the SAME key.
//  • Uploads RESUME after restart — items left `Uploading` (crash mid-flight) are re-driven, not lost.
// The queue is transport-agnostic: it calls an injected `Sender` (real app → supabase api layer; tests → mock).
import {offlineDB, type OfflineDB, type OutboxItem, type OutboxState, type SyncRequest} from './db';
import {uuidv7} from './uuidv7';

// Flat result shape (no discriminated-union narrowing needed): ok ? result : (retryable ? Failed : Blocked).
export interface SendResult {
  ok: boolean;
  result?: unknown;
  retryable?: boolean;
  error?: string;
  reason?: 'conflict'; // see OutboxItem.reason — only meaningful when ok is false and retryable is false
}

export type Sender = (item: OutboxItem) => Promise<SendResult>;

export interface EnqueueInput {
  companyId: string;
  kind: string;
  request: SyncRequest;
}

// O1 — durable, atomic write-ahead. Resolves only after the row is committed to IndexedDB, so the caller
// may confirm to the user only once the action cannot be lost. One enqueue = one idempotency key (O4).
export async function enqueue(input: EnqueueInput, db: OfflineDB = offlineDB): Promise<OutboxItem> {
  const now = Date.now();
  const item: OutboxItem = {
    id: uuidv7(),
    idempotencyKey: uuidv7(),
    companyId: input.companyId,
    kind: input.kind,
    request: input.request,
    state: 'Pending',
    attempts: 0,
    lastError: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction('rw', db.outbox, async () => {
    await db.outbox.add(item);
  });
  return item;
}

const DRIVABLE: ReadonlySet<OutboxState> = new Set<OutboxState>(['Pending', 'Failed', 'Uploading']);

export interface DrainSummary {
  processed: number;
  completed: number;
  failed: number;
  blocked: number;
}

// O3 — on restart this includes items left `Uploading` (interrupted) and re-drives them; idempotency makes the
// re-send safe (server returns the prior result if it had already committed). Processed oldest-first (FIFO).
export async function processOutbox(send: Sender, db: OfflineDB = offlineDB): Promise<DrainSummary> {
  const summary: DrainSummary = {processed: 0, completed: 0, failed: 0, blocked: 0};
  const all = await db.outbox.orderBy('createdAt').toArray();
  const drivable = all.filter((i) => DRIVABLE.has(i.state));

  for (const item of drivable) {
    summary.processed++;
    await setState(db, item.id, 'Uploading', {attempts: item.attempts + 1});
    const res = await trySend(send, {...item, state: 'Uploading', attempts: item.attempts + 1});
    if (res.ok) {
      await setState(db, item.id, 'Completed', {result: res.result ?? null, lastError: null});
      summary.completed++;
    } else if (res.retryable) {
      // Stays in the queue (Failed) for the next sync pass — backoff is the caller's concern (B5 §10).
      await setState(db, item.id, 'Failed', {lastError: res.error ?? 'sync failed'});
      summary.failed++;
    } else {
      // Conflict / permission / validation → needs review, never silently dropped (B5 §7 dead-letter).
      await setState(db, item.id, 'Blocked', {lastError: res.error ?? 'blocked', reason: res.reason});
      summary.blocked++;
    }
  }
  return summary;
}

async function trySend(send: Sender, item: OutboxItem): Promise<SendResult> {
  try {
    return await send(item);
  } catch (e) {
    return {ok: false, retryable: true, error: e instanceof Error ? e.message : String(e)};
  }
}

async function setState(
  db: OfflineDB,
  id: string,
  state: OutboxState,
  patch: Partial<Pick<OutboxItem, 'attempts' | 'lastError' | 'result' | 'reason'>> = {},
): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const row = await db.outbox.get(id);
    if (!row) return;
    await db.outbox.put({...row, ...patch, state, updatedAt: Date.now()});
  });
}

export async function pendingCount(db: OfflineDB = offlineDB): Promise<number> {
  return db.outbox.where('state').anyOf('Pending', 'Failed', 'Uploading').count();
}

export async function blockedCount(db: OfflineDB = offlineDB): Promise<number> {
  return db.outbox.where('state').equals('Blocked').count();
}

export async function blockedItems(db: OfflineDB = offlineDB): Promise<OutboxItem[]> {
  return db.outbox.where('state').equals('Blocked').reverse().sortBy('createdAt');
}

// Found live (2026-07-19, owner report — a sale made on one device never appeared anywhere else): the
// queue already classified a permanently-rejected item as 'Blocked' and preserved it (never silently
// dropped, B5 §7) rather than losing it, but nothing in the app ever showed a Blocked item to anyone —
// the top bar's own "pending" count deliberately excludes 'Blocked' (it means something different: work
// still in flight vs. work that needs a human). The record was never actually lost, just invisible.
// This is the other half: let the person whose device holds it see it, and re-queue it once whatever
// was wrong (e.g. a since-fixed reference) no longer applies.
export async function retryBlocked(id: string, db: OfflineDB = offlineDB): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const row = await db.outbox.get(id);
    if (!row || row.state !== 'Blocked') return;
    await db.outbox.put({...row, state: 'Pending', lastError: null, updatedAt: Date.now()});
  });
}

// Found live (2026-07-19, owner report — "Membership Update" stuck in Sync issues, "Retry now" did
// nothing): retryBlocked() only flips the state back to Pending — it never touches request.match.baseUpdatedAt,
// which was frozen at enqueue time. For a 'conflict' item that value can never match the server row again
// (it already changed once), so retry fails identically forever with no way to clear the item. This is the
// other half: once the user has re-applied the edit through the real form (which enqueues a fresh item with
// a current baseUpdatedAt), the original stale item can be discarded — it was never going to succeed anyway.
export async function discardBlocked(id: string, db: OfflineDB = offlineDB): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const row = await db.outbox.get(id);
    if (!row || row.state !== 'Blocked') return;
    await db.outbox.delete(id);
  });
}
