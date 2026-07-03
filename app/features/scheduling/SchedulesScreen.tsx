// Schedules & Plans (P2-M6B) — prototype-parity: src/features/Schedules.tsx is the workflow authority.
// Month grid (events per day) + selected-day list + create-event modal + delete. Branch-owned calendar (20.19);
// no GL. All writes via schedulingApi (RLS-gated; B5 offline-queued).
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import * as Dialog from '@radix-ui/react-dialog';
import {Calendar as CalIcon, ChevronLeft, ChevronRight, Plus, Trash2, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {schedulingApi, type EventInput} from './api';
import type {CalendarEvent, CalendarEventType} from '../../types/db';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TYPES: CalendarEventType[] = ['Planting', 'Fertigation', 'Harvest', 'Maintenance', 'Delivery', 'Meeting', 'Inspection', 'Training', 'Deadline', 'Project'];
const TYPE_COLOR: Record<string, string> = {
  Planting: 'bg-farm-green', Harvest: 'bg-emerald-600', Fertigation: 'bg-lime-600', Delivery: 'bg-amber-600',
  Meeting: 'bg-blue-600', Maintenance: 'bg-orange-600', Inspection: 'bg-purple-600', Training: 'bg-teal-600',
  Deadline: 'bg-farm-danger', Project: 'bg-indigo-600',
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function SchedulesScreen() {
  const {companyId, has} = usePermissions();
  const {notify} = useToast();
  const canRead = has('schedule.read');
  const canManage = has('schedule.manage');

  const branches = useLiveQuery(async () => (companyId ? offlineDB.branches.where('company_id').equals(companyId).filter((b) => b.status === 'Active').toArray() : []), [companyId]);
  const [branchId, setBranchId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!branchId && branches && branches.length > 0) setBranchId(branches[0]!.id);
  }, [branches, branchId]);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-11
  const [selectedDay, setSelectedDay] = useState(ymd(today));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!companyId || !branchId || !canRead) return;
    schedulingApi.fetchEvents(companyId, branchId).then(setEvents).catch(() => setEvents([]));
  }, [companyId, branchId, canRead]);
  useEffect(reload, [reload]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) m.set(e.event_date, [...(m.get(e.event_date) ?? []), e]);
    return m;
  }, [events]);
  const dayEvents = eventsByDay.get(selectedDay) ?? [];

  // month grid cells (leading blanks + days)
  const cells = useMemo(() => {
    const first = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const out: Array<string | null> = Array.from({length: first}, () => null);
    for (let d = 1; d <= days; d++) out.push(ymd(new Date(year, month, d)));
    return out;
  }, [year, month]);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  // create modal
  const [open, setOpen] = useState(false);
  const [cType, setCType] = useState<CalendarEventType>('Planting');
  const [cTitle, setCTitle] = useState('');
  const [cDate, setCDate] = useState(selectedDay);
  const [cPriority, setCPriority] = useState<CalendarEvent['priority']>('Normal');
  const [cDesc, setCDesc] = useState('');

  async function submit() {
    if (!companyId || !branchId) return;
    const input: EventInput = {event_type: cType, title: cTitle, description: cDesc, event_date: cDate, priority: cPriority};
    setBusy(true);
    try {
      await schedulingApi.createEvent(companyId, branchId, input);
      notify('Event scheduled');
      setOpen(false); setCTitle(''); setCDesc('');
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Failed to schedule', 'error'); } finally { setBusy(false); }
  }

  if (!canRead) {
    return (
      <div>
        <PageHeader title="Schedules &amp; Plans" />
        <Card><EmptyState title="Calendar access needed" hint="Your role does not include the schedule.read permission." /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedules &amp; Plans"
        subtitle="Farm operational calendar — planting, delivery, maintenance, and meetings."
        action={
          <div className="flex items-center gap-2">
            <div className="w-40"><SelectField value={branchId} onChange={setBranchId} placeholder="Branch" options={(branches ?? []).map((b) => ({value: b.id, label: b.name}))} /></div>
            {canManage ? <Button onClick={() => {setCType('Planting'); setCTitle(''); setCDate(selectedDay); setCPriority('Normal'); setCDesc(''); setOpen(true);}}><Plus size={18} aria-hidden /> New Event</Button> : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-bold text-farm-green"><CalIcon className="h-5 w-5" aria-hidden /> {MONTHS[month]} {year}</h3>
            <div className="flex gap-1">
              <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-farm-accent p-1.5 text-farm-green hover:bg-farm-accent-soft" aria-label="Previous month"><ChevronLeft size={18} aria-hidden /></button>
              <button onClick={() => {const d = new Date(); setYear(d.getFullYear()); setMonth(d.getMonth()); setSelectedDay(ymd(d));}} className="rounded-lg border border-farm-accent px-2 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">Today</button>
              <button onClick={() => shiftMonth(1)} className="rounded-lg border border-farm-accent p-1.5 text-farm-green hover:bg-farm-accent-soft" aria-label="Next month"><ChevronRight size={18} aria-hidden /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-wider text-farm-muted">
            {WEEKDAYS.map((w) => <div key={w} className="pb-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`b${i}`} />;
              const evs = eventsByDay.get(day) ?? [];
              const isToday = day === ymd(today);
              const isSel = day === selectedDay;
              return (
                <button key={day} onClick={() => setSelectedDay(day)}
                  className={cn('flex min-h-16 flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition',
                    isSel ? 'border-farm-green bg-farm-accent-soft ring-1 ring-farm-green' : 'border-farm-accent-soft hover:bg-farm-bg/50',
                    isToday && !isSel && 'border-farm-green')}>
                  <span className={cn('text-xs font-bold', isToday ? 'text-farm-green' : 'text-farm-ink')}>{Number(day.slice(-2))}</span>
                  <span className="flex flex-wrap gap-0.5">
                    {evs.slice(0, 4).map((e) => <span key={e.id} className={cn('h-1.5 w-1.5 rounded-full', TYPE_COLOR[e.event_type] ?? 'bg-farm-muted', e.status === 'Completed' && 'opacity-40', e.status === 'Cancelled' && 'opacity-20')} title={`${e.event_type}: ${e.title}`} />)}
                    {evs.length > 4 ? <span className="text-[8px] font-bold text-farm-muted">+{evs.length - 4}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <h3 className="mb-1 text-base font-bold text-farm-green">{new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-PH', {weekday: 'long', month: 'short', day: 'numeric'})}</h3>
          <p className="mb-3 text-xs text-farm-muted">{dayEvents.length} event{dayEvents.length === 1 ? '' : 's'}</p>
          {dayEvents.length === 0 ? (
            <p className="py-6 text-center text-sm italic text-farm-muted">No events. {canManage ? 'Add one with "New Event".' : ''}</p>
          ) : (
            <ul className="space-y-2">
              {dayEvents.map((e) => (
                <li key={e.id} className={cn('rounded-xl border border-farm-accent-soft bg-farm-bg/40 p-3', e.status === 'Cancelled' && 'opacity-50')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-farm-ink">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', TYPE_COLOR[e.event_type] ?? 'bg-farm-muted')} aria-hidden />
                        <span className={cn('truncate', e.status === 'Completed' && 'line-through')}>{e.title}</span>
                      </p>
                      <p className="text-[11px] text-farm-muted">{e.event_type}{e.priority !== 'Normal' ? ` · ${e.priority}` : ''} · {e.status}</p>
                      {e.description ? <p className="mt-1 text-xs text-farm-muted">{e.description}</p> : null}
                    </div>
                    {canManage ? (
                      <span className="flex flex-shrink-0 gap-1">
                        {e.status === 'Scheduled' ? <button onClick={async () => {setBusy(true); try {await schedulingApi.setStatus(e, 'Completed'); notify('Marked done'); reload();} catch (err) {notify(err instanceof Error ? err.message : 'Failed', 'error');} finally {setBusy(false);}}} className="rounded px-1.5 py-0.5 text-[10px] font-bold text-farm-green hover:bg-farm-accent-soft" title="Mark complete">Done</button> : null}
                        <button onClick={async () => {setBusy(true); try {await schedulingApi.deleteEvent(e); notify('Event removed'); reload();} catch (err) {notify(err instanceof Error ? err.message : 'Failed', 'error');} finally {setBusy(false);}}} className="rounded p-1 text-farm-danger hover:bg-red-50" aria-label="Delete event"><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Create event modal */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">Schedule an Event</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">Adds a plan to the farm calendar for the selected branch.</p>
            <div className="space-y-4 text-sm">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="ev-title">Title</label>
                <input id="ev-title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="e.g. Transplant lettuce, tunnel 3" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Type</label>
                  <SelectField value={cType} onChange={(v) => setCType(v as CalendarEventType)} options={TYPES.map((t) => ({value: t, label: t}))} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Priority</label>
                  <SelectField value={cPriority} onChange={(v) => setCPriority(v as CalendarEvent['priority'])} options={['Low', 'Normal', 'High', 'Critical'].map((p) => ({value: p, label: p}))} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="ev-date">Date</label>
                <input id="ev-date" type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm font-semibold" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="ev-desc">Notes</label>
                <input id="ev-desc" value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="optional" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submit()} disabled={busy || !cTitle.trim() || !cDate}>{busy ? 'Saving…' : 'Add to Calendar'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
