// M6B scheduling seam (mock mode): create, list-by-branch, status update, delete. Server-side tenant/branch/
// permission isolation is proven by scripts/guards/scheduling-security.sql; this covers the client seam.
import 'fake-indexeddb/auto';
import {describe, expect, it, beforeAll} from 'vitest';
import {DEMO, seedMockData} from '@/app/core/mock/mock';
import {schedulingApi} from '@/app/features/scheduling/api';

describe('scheduling (mock mode)', () => {
  beforeAll(async () => {
    await seedMockData();
  });

  it('creates events and lists them for the branch, sorted by date', async () => {
    await schedulingApi.createEvent(DEMO.companyId, DEMO.branchA, {event_type: 'Planting', title: 'Transplant lettuce', event_date: '2026-07-20', priority: 'High'});
    await schedulingApi.createEvent(DEMO.companyId, DEMO.branchA, {event_type: 'Delivery', title: 'Market run', event_date: '2026-07-10'});
    const evs = await schedulingApi.fetchEvents(DEMO.companyId, DEMO.branchA);
    expect(evs.map((e) => e.title)).toEqual(['Market run', 'Transplant lettuce']); // date-sorted
    expect(evs[0]!.status).toBe('Scheduled');
    expect(evs[1]!.priority).toBe('High');
  });

  it('scopes events to the branch (other branch sees none)', async () => {
    const other = await schedulingApi.fetchEvents(DEMO.companyId, DEMO.branchB);
    expect(other).toHaveLength(0);
  });

  it('marks an event complete and deletes another', async () => {
    const evs = await schedulingApi.fetchEvents(DEMO.companyId, DEMO.branchA);
    await schedulingApi.setStatus(evs[0]!, 'Completed');
    await schedulingApi.deleteEvent(evs[1]!);
    const after = await schedulingApi.fetchEvents(DEMO.companyId, DEMO.branchA);
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('Completed');
  });

  it('rejects an event with no title', async () => {
    await expect(schedulingApi.createEvent(DEMO.companyId, DEMO.branchA, {event_type: 'Meeting', title: '  ', event_date: '2026-07-15'})).rejects.toThrow(/title/i);
  });
});
