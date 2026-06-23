// Proves the B5 / M1B offline write-ahead guarantees (Step 5): a crash cannot LOSE a queued action, a reboot
// cannot DUPLICATE it, idempotency keys are client-generated, and interrupted uploads RESUME after restart.
import 'fake-indexeddb/auto';
import {describe, expect, it} from 'vitest';
import {OfflineDB} from '@/app/core/offline/db';
import {enqueue, processOutbox, type Sender} from '@/app/core/offline/queue';

let n = 0;
function freshDB(): OfflineDB {
  n += 1;
  return new OfflineDB(`test-${n}-${Math.random().toString(36).slice(2)}`);
}

// An idempotent "server": dedups on idempotencyKey, so a re-sent action commits exactly once.
function idempotentServer(preCommitted: string[] = []) {
  const commits = new Map<string, unknown>();
  for (const k of preCommitted) commits.set(k, {pre: true});
  let calls = 0;
  const send: Sender = async (item) => {
    calls += 1;
    if (commits.has(item.idempotencyKey)) return {ok: true, result: commits.get(item.idempotencyKey)};
    const result = {serverId: `srv-${item.id}`};
    commits.set(item.idempotencyKey, result);
    return {ok: true, result};
  };
  return {send, commits, calls: () => calls};
}

const sampleReq = {type: 'insert' as const, table: 'branches', payload: {company_id: 'c1', branch_code: 'BR-1', name: 'X'}};

describe('offline write-ahead queue', () => {
  it('generates a client-side uuidv7 idempotency key per action (unique)', async () => {
    const db = freshDB();
    const a = await enqueue({companyId: 'c1', kind: 'branch.create', request: sampleReq}, db);
    const b = await enqueue({companyId: 'c1', kind: 'branch.create', request: sampleReq}, db);
    expect(a.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it('a crash cannot LOSE a queued action — it is durably committed before confirm', async () => {
    const name = `durable-${Math.random().toString(36).slice(2)}`;
    const dbA = new OfflineDB(name);
    const item = await enqueue({companyId: 'c1', kind: 'branch.create', request: sampleReq}, dbA);
    // Simulate a process restart: a brand-new DB handle over the same store.
    const dbB = new OfflineDB(name);
    const recovered = await dbB.outbox.get(item.id);
    expect(recovered).toBeDefined();
    expect(recovered?.state).toBe('Pending');
  });

  it('drains Pending → Completed exactly once, and does not re-send Completed items', async () => {
    const db = freshDB();
    await enqueue({companyId: 'c1', kind: 'branch.create', request: sampleReq}, db);
    const server = idempotentServer();
    const s1 = await processOutbox(server.send, db);
    expect(s1.completed).toBe(1);
    expect(server.commits.size).toBe(1);
    // Second pass: the item is Completed, so it is NOT re-driven.
    const s2 = await processOutbox(server.send, db);
    expect(s2.processed).toBe(0);
    expect(server.calls()).toBe(1);
    expect(server.commits.size).toBe(1);
  });

  it('a reboot during upload RESUMES and cannot DUPLICATE (server already committed)', async () => {
    const db = freshDB();
    const item = await enqueue({companyId: 'c1', kind: 'branch.create', request: sampleReq}, db);
    // Simulate a crash AFTER the server committed but BEFORE the ack was recorded: item stuck Uploading,
    // and the server already holds this idempotency key.
    await db.outbox.update(item.id, {state: 'Uploading'});
    const server = idempotentServer([item.idempotencyKey]);
    const summary = await processOutbox(server.send, db);
    expect(summary.completed).toBe(1); // re-driven and resolved
    expect(server.commits.size).toBe(1); // NO duplicate commit
    const row = await db.outbox.get(item.id);
    expect(row?.state).toBe('Completed');
  });

  it('a retryable failure stays queued (Failed); a permanent failure is Blocked for review', async () => {
    const db = freshDB();
    await enqueue({companyId: 'c1', kind: 'branch.create', request: sampleReq}, db);
    const retry: Sender = async () => ({ok: false, retryable: true, error: 'network'});
    const r = await processOutbox(retry, db);
    expect(r.failed).toBe(1);
    // Failed items are re-driven on the next pass (still in the queue).
    const block: Sender = async () => ({ok: false, retryable: false, error: 'permission denied'});
    const b = await processOutbox(block, db);
    expect(b.processed).toBe(1);
    expect(b.blocked).toBe(1);
  });
});
