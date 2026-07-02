// Verifies the mock / offline-dev adapter: the app runs with NO cloud — seeded data + the outbox draining into
// Dexie via mockSender (the full offline write path with no network).
import 'fake-indexeddb/auto';
import {describe, expect, it} from 'vitest';
import {offlineDB} from '@/app/core/offline/db';
import {DEMO, MOCK_MODE, mockSender, seedMockData} from '@/app/core/mock/mock';
import {enqueue, processOutbox} from '@/app/core/offline/queue';

describe('mock / offline-dev adapter', () => {
  it('auto-enables when Supabase is unconfigured', () => {
    expect(MOCK_MODE).toBe(true);
  });

  it('seeds a demo company, branches, and a full permission snapshot (idempotent)', async () => {
    await seedMockData();
    await seedMockData(); // second call is a no-op
    const company = await offlineDB.companies.get(DEMO.companyId);
    expect(company?.name).toBe('Demo Farm Co.');
    expect(await offlineDB.branches.where('company_id').equals(DEMO.companyId).count()).toBe(2);
    const snap = (await offlineDB.meta.get('perm-snapshot'))?.value as {keys: string[]} | undefined;
    expect(snap?.keys).toContain('crop.manage');
    expect(snap?.keys).toContain('pos.sell');
    expect(snap?.keys).toContain('cash.session');
    expect(snap?.keys.length).toBe(16);
  });

  it('drains the outbox into Dexie via mockSender (offline create works, no cloud)', async () => {
    await seedMockData();
    const before = await offlineDB.branches.where('company_id').equals(DEMO.companyId).count();
    await enqueue({
      companyId: DEMO.companyId,
      kind: 'branch.create',
      request: {type: 'insert', table: 'branches', payload: {company_id: DEMO.companyId, branch_code: 'BR-NEW', name: 'New Field'}},
    });
    const summary = await processOutbox(mockSender);
    expect(summary.completed).toBeGreaterThanOrEqual(1);
    expect(await offlineDB.branches.where('company_id').equals(DEMO.companyId).count()).toBe(before + 1);
  });
});
