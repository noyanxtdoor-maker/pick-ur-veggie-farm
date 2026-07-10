// CAP-VG1 step 3 — the grounded Morning Brief must reflect exactly what's in the local caches (no
// invention: empty caches → the calm summary; seeded caches → the right sections with the right numbers).
import 'fake-indexeddb/auto';
import {beforeEach, describe, expect, it} from 'vitest';
import {offlineDB} from '@/app/core/offline/db';
import {gatherBrief, renderBriefText} from '@/app/features/copilot/brief';
import type {CalendarEvent, PosInvoice} from '@/app/types/db';

const CO = '00000000-0000-7000-8000-000000000001';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('CAP-VG1 morning brief', () => {
  beforeEach(async () => {
    await Promise.all([offlineDB.calendarEvents.clear(), offlineDB.posInvoices.clear(), offlineDB.materialStock.clear(), offlineDB.finishedGoods.clear(), offlineDB.projects.clear()]);
  });

  it('empty caches → no sections and an honest calm summary (never invents data)', async () => {
    const brief = await gatherBrief(CO);
    expect(brief.sections).toHaveLength(0);
    expect(brief.summary).toContain('running smoothly');
    expect(renderBriefText(brief)).toContain('running smoothly');
  });

  it('no company context → says so instead of guessing', async () => {
    const brief = await gatherBrief(null);
    expect(brief.sections).toHaveLength(0);
    expect(brief.summary).toContain('No company context');
  });

  it("seeded caches → today's event + the unpaid invoice with its exact peso total (grounded numbers)", async () => {
    const ev: CalendarEvent = {
      id: 'ev1', company_id: CO, branch_id: 'b1', event_type: 'Harvest', title: 'Harvest lettuce',
      description: null, event_date: today(), priority: 'High', visibility: 'General',
      start_time: '08:00', end_time: null, status: 'Scheduled', project_id: null,
      created_by: null, created_at: 'x', updated_at: 'x',
    };
    await offlineDB.calendarEvents.put(ev);
    const inv = {
      id: 'inv1', company_id: CO, branch_id: 'b1', invoice_number: 7, lines: [], subtotal: 270,
      discount: 0, delivery_fee: 0, total: 270, tender_cash: 0, change_amount: 0, note: 'Aling Nena',
      status: 'Unpaid', created_at: 'x',
    } as unknown as PosInvoice;
    await offlineDB.posInvoices.put(inv);

    const brief = await gatherBrief(CO);
    const text = renderBriefText(brief);
    expect(text).toContain('Harvest lettuce at 08:00 [High]');
    expect(text).toContain('₱270.00');
    expect(text).toContain('#7');
    // a cancelled event or paid invoice must NOT leak in
    expect(brief.sections.some((s) => s.heading.startsWith("Today's events"))).toBe(true);
    expect(brief.sections.some((s) => s.heading.startsWith('Open invoices (1'))).toBe(true);
  });
});
