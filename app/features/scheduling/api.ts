// Scheduling data-access (M1B A1 seam; spec Phase_2_M6_Scheduling_Module_Spec.md). Calendar events are branch-
// owned, non-financial → plain RLS-gated writes (like crops): MOCK → Dexie; online → PostgREST; offline → outbox.
import {supabase} from '../../core/supabase/client';
import {offlineDB} from '../../core/offline/db';
import {enqueue} from '../../core/offline/queue';
import {uuidv7} from '../../core/offline/uuidv7';
import {MOCK_MODE} from '../../core/mock/mock';
import type {CalendarEvent, CalendarEventType} from '../../types/db';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

export interface EventInput {
  event_type: CalendarEventType;
  title: string;
  description?: string;
  event_date: string; // yyyy-mm-dd
  priority?: CalendarEvent['priority'];
  visibility?: CalendarEvent['visibility']; // P2-M6C: Management events need schedule.read_private to be seen
  start_time?: string | null; // P2-M6D: 'HH:MM' or null = all-day
  end_time?: string | null;
}

export const schedulingApi = {
  async fetchEvents(companyId: string, branchId: string): Promise<CalendarEvent[]> {
    if (MOCK_MODE) {
      const rows = await offlineDB.calendarEvents.where('company_id').equals(companyId).filter((e) => e.branch_id === branchId).toArray();
      return rows.sort((a, b) => a.event_date.localeCompare(b.event_date));
    }
    const {data, error} = await supabase.from('calendar_events').select('*').eq('company_id', companyId).eq('branch_id', branchId).order('event_date');
    if (error) throw new Error(error.message);
    return (data ?? []) as CalendarEvent[];
  },

  async createEvent(companyId: string, branchId: string, input: EventInput): Promise<void> {
    if (!input.title.trim()) throw new Error('Event title is required.');
    if (!input.event_date) throw new Error('Event date is required.');
    const payload = {
      company_id: companyId, branch_id: branchId, event_type: input.event_type, title: input.title.trim(),
      description: input.description?.trim() || null, event_date: input.event_date, priority: input.priority ?? 'Normal',
      visibility: input.visibility ?? 'General', start_time: input.start_time ?? null, end_time: input.end_time ?? null,
    };
    if (MOCK_MODE) {
      const now = new Date().toISOString();
      await offlineDB.calendarEvents.put({id: uuidv7(), ...payload, status: 'Scheduled', project_id: null, created_by: null, created_at: now, updated_at: now});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('calendar_events').insert(payload);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId, kind: 'schedule.create', request: {type: 'insert', table: 'calendar_events', payload}});
  },

  async setStatus(event: CalendarEvent, status: CalendarEvent['status']): Promise<void> {
    if (MOCK_MODE) {
      await offlineDB.calendarEvents.put({...event, status, updated_at: new Date().toISOString()});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('calendar_events').update({status}).eq('id', event.id);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: event.company_id, kind: 'schedule.update', request: {type: 'update', table: 'calendar_events', match: {id: event.id, baseUpdatedAt: event.updated_at}, payload: {status}}});
  },

  // Full edit (detail panel → Edit). schedule.manage RLS is the gate; DB grants update on exactly these columns.
  async updateEvent(event: CalendarEvent, patch: Partial<Pick<CalendarEvent, 'event_type' | 'title' | 'description' | 'event_date' | 'priority' | 'visibility' | 'start_time' | 'end_time'>>): Promise<void> {
    if (patch.title !== undefined && !patch.title.trim()) throw new Error('Event title is required.');
    if (patch.start_time && patch.end_time && patch.end_time <= patch.start_time) throw new Error('End time must be after the start time.');
    if (MOCK_MODE) {
      await offlineDB.calendarEvents.put({...event, ...patch, updated_at: new Date().toISOString()});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('calendar_events').update(patch).eq('id', event.id);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: event.company_id, kind: 'schedule.edit', request: {type: 'update', table: 'calendar_events', match: {id: event.id, baseUpdatedAt: event.updated_at}, payload: patch}});
  },

  // P2-M6D: adjust a timed event's start/end (day-view drag). schedule.manage RLS is the server gate.
  // DayFlow adoption: an optional event_date lets a cross-day drag move the event to another day (the new
  //   event_date is derived from where the block was dropped). event_date is updatable under schedule.manage
  //   (M6A grant line 41); the M6D end>start CHECK still holds — cross-day drag preserves times, never spans midnight.
  async setTime(event: CalendarEvent, start_time: string | null, end_time: string | null, event_date?: string): Promise<void> {
    const patch = event_date ? {start_time, end_time, event_date} : {start_time, end_time};
    if (MOCK_MODE) {
      await offlineDB.calendarEvents.put({...event, ...patch, updated_at: new Date().toISOString()});
      return;
    }
    if (online()) {
      const {error} = await supabase.from('calendar_events').update(patch).eq('id', event.id);
      if (error) throw new Error(error.message);
      return;
    }
    await enqueue({companyId: event.company_id, kind: 'schedule.retime', request: {type: 'update', table: 'calendar_events', match: {id: event.id, baseUpdatedAt: event.updated_at}, payload: patch}});
  },

  async deleteEvent(event: CalendarEvent): Promise<void> {
    if (MOCK_MODE) {
      await offlineDB.calendarEvents.delete(event.id);
      return;
    }
    if (online()) {
      const {error} = await supabase.from('calendar_events').delete().eq('id', event.id);
      if (error) throw new Error(error.message);
      return;
    }
    // offline delete: queue a status→Cancelled instead of a hard delete (the outbox has no delete verb; safe fallback)
    await enqueue({companyId: event.company_id, kind: 'schedule.cancel', request: {type: 'update', table: 'calendar_events', match: {id: event.id, baseUpdatedAt: event.updated_at}, payload: {status: 'Cancelled'}}});
  },
};
