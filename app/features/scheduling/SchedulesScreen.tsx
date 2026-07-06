// Schedules & Plans (P2-M6B/M6C + B.3) — prototype-parity: src/features/Schedules.tsx is the workflow authority.
// Month grid (events per day + PROJECT timelines) + selected-day list + create-event modal + delete. Projects
// overlay (owner ask): timelines from the Projects board appear here with finish dates — Calendar and Projects
// are connected. Branch-owned calendar (20.19); no GL. All writes via schedulingApi (RLS-gated; B5 offline-queued).
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {Link} from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {Calendar as CalIcon, ChevronLeft, ChevronRight, FolderKanban, Plus, X} from 'lucide-react';
import {offlineDB} from '../../core/offline/db';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {EmptyState, useToast} from '../../components/feedback';
import {SelectField} from '../../components/overlay';
import {schedulingApi, type EventInput} from './api';
import {projectsApi} from '../projects/api';
import {projectsOnDay, projectDueOn, projectPct} from './projectOverlay';
import {DayView} from './DayView';
import {WeekView} from './WeekView';
import {YearView} from './YearView';
import type {CalendarEvent, CalendarEventType, Project} from '../../types/db';

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
  const canReadPrivate = has('schedule.read_private'); // M6C: Management-tier entries (server RLS is the gate)
  const canReadProjects = has('project.read'); // B.3: project timelines overlay

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
  const [projects, setProjects] = useState<Project[]>([]); // B.3 overlay
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!companyId || !branchId || !canRead) return;
    schedulingApi.fetchEvents(companyId, branchId).then(setEvents).catch(() => setEvents([]));
    if (canReadProjects) projectsApi.fetchProjects(companyId, branchId).then(setProjects).catch(() => setProjects([]));
  }, [companyId, branchId, canRead, canReadProjects]);
  useEffect(reload, [reload]);

  // M6C filter (owner ask: "add a filter button too for everyone"). The SERVER already hides Management
  // events from users without schedule.read_private — this is a view filter on top, never the gate.
  const [tierFilter, setTierFilter] = useState<'all' | 'General' | 'Management'>('all');
  const visibleEvents = useMemo(() => events.filter((e) => tierFilter === 'all' || (e.visibility ?? 'General') === tierFilter), [events, tierFilter]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of visibleEvents) m.set(e.event_date, [...(m.get(e.event_date) ?? []), e]);
    return m;
  }, [visibleEvents]);
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

  const [view, setView] = useState<'year' | 'month' | 'week' | 'day'>('month'); // DayFlow view set: Year/Month/Week/Day

  async function retime(e: CalendarEvent, start: string, end: string | null) {
    try {await schedulingApi.setTime(e, start, end); notify(`Moved to ${start}`); reload();}
    catch (err) {notify(err instanceof Error ? err.message : 'Reschedule failed', 'error');}
  }
  async function resizeEvt(e: CalendarEvent, start: string, end: string) {
    try {await schedulingApi.setTime(e, start, end); notify(`Now ${start}–${end}`); reload();}
    catch (err) {notify(err instanceof Error ? err.message : 'Resize failed', 'error');}
  }

  // Week (Sun→Sat) containing selectedDay
  const weekDays = useMemo(() => {
    const base = new Date(selectedDay + 'T00:00:00');
    const sun = new Date(base); sun.setDate(base.getDate() - base.getDay());
    return Array.from({length: 7}, (_, i) => {const d = new Date(sun); d.setDate(sun.getDate() + i); return ymd(d);});
  }, [selectedDay]);

  // Cross-day drag (Week view): shift the event to another day column + new time; clamps to the visible week.
  async function moveDay(e: CalendarEvent, fromDay: string, dayShift: number, start: string, end: string | null) {
    const fromIdx = weekDays.indexOf(fromDay);
    const toDay = weekDays[Math.max(0, Math.min(6, fromIdx + dayShift))]!;
    try {await schedulingApi.setTime(e, start, end, toDay); notify(`Moved to ${new Date(toDay + 'T00:00:00').toLocaleDateString('en-PH', {weekday: 'short'})} ${start}`); reload();}
    catch (err) {notify(err instanceof Error ? err.message : 'Move failed', 'error');}
  }

  // Event detail panel (DayFlow: click any event → view; managers get edit / complete / delete = the R-U-D of CRUD).
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  async function detailAction(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try {await fn(); notify(ok); setDetail(null); reload();}
    catch (err) {notify(err instanceof Error ? err.message : 'Failed', 'error');}
    finally {setBusy(false);}
  }

  // create / edit modal (editingId set → Edit an existing event, else Create)
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cType, setCType] = useState<CalendarEventType>('Planting');
  const [cTitle, setCTitle] = useState('');
  const [cDate, setCDate] = useState(selectedDay);
  const [cPriority, setCPriority] = useState<CalendarEvent['priority']>('Normal');
  const [cVisibility, setCVisibility] = useState<CalendarEvent['visibility']>('General');
  const [cStart, setCStart] = useState(''); // M6D optional time-of-day
  const [cEnd, setCEnd] = useState('');
  const [cDesc, setCDesc] = useState('');

  function openCreate() {
    setEditingId(null); setCType('Planting'); setCTitle(''); setCDate(selectedDay); setCPriority('Normal');
    setCVisibility('General'); setCStart(''); setCEnd(''); setCDesc(''); setOpen(true);
  }
  function openEdit(e: CalendarEvent) {
    setEditingId(e.id); setCType(e.event_type); setCTitle(e.title); setCDate(e.event_date); setCPriority(e.priority);
    setCVisibility(e.visibility ?? 'General'); setCStart(e.start_time ? e.start_time.slice(0, 5) : '');
    setCEnd(e.end_time ? e.end_time.slice(0, 5) : ''); setCDesc(e.description ?? ''); setDetail(null); setOpen(true);
  }

  async function submit() {
    if (!companyId || !branchId) return;
    if (cStart && cEnd && cEnd <= cStart) return notify('End time must be after the start time.', 'error');
    setBusy(true);
    try {
      const fields = {event_type: cType, title: cTitle.trim(), description: cDesc.trim() || null, event_date: cDate, priority: cPriority, visibility: (canReadPrivate ? cVisibility : 'General') as CalendarEvent['visibility'], start_time: cStart || null, end_time: cEnd || null};
      if (editingId) {
        const target = events.find((x) => x.id === editingId);
        if (target) await schedulingApi.updateEvent(target, fields);
        notify('Event updated');
      } else {
        await schedulingApi.createEvent(companyId, branchId, {event_type: cType, title: cTitle, description: cDesc, event_date: cDate, priority: cPriority, visibility: fields.visibility, start_time: cStart || null, end_time: cEnd || null} as EventInput);
        notify('Event scheduled');
      }
      setOpen(false); setEditingId(null);
      reload();
    } catch (e) { notify(e instanceof Error ? e.message : 'Failed to save', 'error'); } finally { setBusy(false); }
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
            {canManage ? <Button onClick={openCreate}><Plus size={18} aria-hidden /> New Event</Button> : null}
          </div>
        }
      />

      {/* M6C tier filter — visible to everyone; the Management option only exists for read_private holders */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'General', ...(canReadPrivate ? ['Management' as const] : [])] as const).map((t) => (
          <button key={t} onClick={() => setTierFilter(t as typeof tierFilter)}
            className={cn('rounded-xl border px-3 py-1.5 text-xs font-bold transition', tierFilter === t ? 'border-transparent bg-farm-green text-white' : 'border-farm-accent bg-farm-card text-farm-muted hover:text-farm-green')}>
            {t === 'all' ? 'All events' : t === 'General' ? 'General (everyone sees)' : 'Management only'}
          </button>
        ))}
        {canReadPrivate ? <span className="text-[10px] text-farm-muted">Management entries are hidden from staff roles automatically.</span> : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-lg font-bold text-farm-green"><CalIcon className="h-5 w-5" aria-hidden /> {view === 'year' ? `${year}` : view === 'month' ? `${MONTHS[month]} ${year}` : view === 'week' ? `Week of ${new Date(weekDays[0]! + 'T00:00:00').toLocaleDateString('en-PH', {month: 'short', day: 'numeric'})}` : new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-PH', {weekday: 'long', month: 'long', day: 'numeric'})}</h3>
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-farm-accent text-xs font-bold">
                <button onClick={() => setView('year')} className={cn('px-2.5 py-1', view === 'year' ? 'bg-farm-green text-white' : 'text-farm-green hover:bg-farm-accent-soft')}>Year</button>
                <button onClick={() => setView('month')} className={cn('px-2.5 py-1', view === 'month' ? 'bg-farm-green text-white' : 'text-farm-green hover:bg-farm-accent-soft')}>Month</button>
                <button onClick={() => setView('week')} className={cn('px-2.5 py-1', view === 'week' ? 'bg-farm-green text-white' : 'text-farm-green hover:bg-farm-accent-soft')}>Week</button>
                <button onClick={() => setView('day')} className={cn('px-2.5 py-1', view === 'day' ? 'bg-farm-green text-white' : 'text-farm-green hover:bg-farm-accent-soft')}>Day</button>
              </div>
              <div className="flex gap-1">
                <button onClick={() => {if (view === 'year') setYear(year - 1); else if (view === 'month') shiftMonth(-1); else {const step = view === 'week' ? 7 : 1; const d = new Date(selectedDay + 'T00:00:00'); d.setDate(d.getDate() - step); setSelectedDay(ymd(d)); setYear(d.getFullYear()); setMonth(d.getMonth());}}} className="rounded-lg border border-farm-accent p-1.5 text-farm-green hover:bg-farm-accent-soft" aria-label="Previous"><ChevronLeft size={18} aria-hidden /></button>
                <button onClick={() => {const d = new Date(); setYear(d.getFullYear()); setMonth(d.getMonth()); setSelectedDay(ymd(d));}} className="rounded-lg border border-farm-accent px-2 text-xs font-bold text-farm-green hover:bg-farm-accent-soft">Today</button>
                <button onClick={() => {if (view === 'year') setYear(year + 1); else if (view === 'month') shiftMonth(1); else {const step = view === 'week' ? 7 : 1; const d = new Date(selectedDay + 'T00:00:00'); d.setDate(d.getDate() + step); setSelectedDay(ymd(d)); setYear(d.getFullYear()); setMonth(d.getMonth());}}} className="rounded-lg border border-farm-accent p-1.5 text-farm-green hover:bg-farm-accent-soft" aria-label="Next"><ChevronRight size={18} aria-hidden /></button>
              </div>
            </div>
          </div>
          {view === 'day' ? (
            <DayView events={dayEvents} isToday={selectedDay === ymd(today)} canManage={canManage} onRetime={(e, s, en) => void retime(e, s, en)} onResize={(e, s, en) => void resizeEvt(e, s, en)} onSelect={setDetail} />
          ) : view === 'week' ? (
            <WeekView weekDays={weekDays} eventsByDay={eventsByDay} today={ymd(today)} selectedDay={selectedDay} canManage={canManage} onRetime={(e, s, en) => void retime(e, s, en)} onResize={(e, s, en) => void resizeEvt(e, s, en)} onMoveDay={(e, from, shift, s, en) => void moveDay(e, from, shift, s, en)} onSelect={setDetail} onSelectDay={(d) => {setSelectedDay(d); setView('day');}} />
          ) : view === 'year' ? (
            <YearView year={year} eventsByDay={eventsByDay} today={ymd(today)} onSelectDay={(d) => {setSelectedDay(d); setView('day');}} onSelectMonth={(m) => {setMonth(m); setView('month');}} />
          ) : (
          <>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-wider text-farm-muted">
            {WEEKDAYS.map((w) => <div key={w} className="pb-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`b${i}`} />;
              const evs = eventsByDay.get(day) ?? [];
              const dayProjects = projectsOnDay(projects, day); // B.3 timeline overlay
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
                  {dayProjects.length > 0 ? (
                    <span className="mt-auto flex w-full flex-col gap-0.5">
                      {dayProjects.slice(0, 2).map((p) => (
                        <span key={p.id} className={cn('h-1 w-full rounded-full', projectDueOn(p, day) ? 'bg-farm-danger' : 'bg-indigo-400/70')} title={`${p.name}${p.end_date ? ` — finishes ${p.end_date}` : ''}`} />
                      ))}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          </>
          )}
        </Card>

        <Card>
          <h3 className="mb-1 text-base font-bold text-farm-green">{new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-PH', {weekday: 'long', month: 'short', day: 'numeric'})}</h3>
          <p className="mb-3 text-xs text-farm-muted">{dayEvents.length} event{dayEvents.length === 1 ? '' : 's'}</p>
          {dayEvents.length === 0 ? (
            <p className="py-6 text-center text-sm italic text-farm-muted">No events. {canManage ? 'Add one with "New Event".' : ''}</p>
          ) : (
            <ul className="space-y-2">
              {dayEvents.map((e) => (
                // Click the row → the shared detail panel (Read for all; managers get Edit/Done/Delete inside it).
                // This is the ONLY event surface in Month view, so it must reach the same CRUD as Day/Week blocks.
                <li key={e.id} className={cn('overflow-hidden rounded-xl border border-farm-accent-soft bg-farm-bg/40', e.status === 'Cancelled' && 'opacity-50')}>
                  <button type="button" onClick={() => setDetail(e)} className="w-full p-3 text-left transition hover:bg-farm-bg/70">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-farm-ink">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', TYPE_COLOR[e.event_type] ?? 'bg-farm-muted')} aria-hidden />
                      <span className={cn('truncate', e.status === 'Completed' && 'line-through')}>{e.title}</span>
                      {canManage ? <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-farm-muted" aria-hidden /> : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-farm-muted">
                      {e.start_time ? <span className="font-bold text-farm-green">{e.start_time.slice(0, 5)}{e.end_time ? `–${e.end_time.slice(0, 5)}` : ''} · </span> : null}
                      {e.event_type}{e.priority !== 'Normal' ? ` · ${e.priority}` : ''} · {e.status}
                      {(e.visibility ?? 'General') === 'Management' ? <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-900" title="Only roles with the see-management-schedules permission can see this entry">Mgmt only</span> : null}
                    </span>
                    {e.description ? <span className="mt-1 block truncate text-xs text-farm-muted">{e.description}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* B.3: projects whose timeline covers the selected day — Calendar and Projects are connected */}
          {canReadProjects && projectsOnDay(projects, selectedDay).length > 0 ? (
            <div className="mt-4 border-t border-farm-accent-soft pt-3">
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-farm-muted"><FolderKanban className="h-3.5 w-3.5" aria-hidden /> Projects on this day</h4>
              <ul className="space-y-2">
                {projectsOnDay(projects, selectedDay).map((p) => (
                  <li key={p.id}>
                    <Link to="/operations/projects" className="block rounded-xl border border-indigo-200 bg-indigo-50/50 p-2.5 transition hover:border-indigo-400 dark:border-farm-accent dark:bg-farm-bg/40">
                      <span className="flex items-center justify-between gap-2 text-sm font-bold text-farm-ink">
                        <span className="truncate">{p.name}</span>
                        {projectDueOn(p, selectedDay) ? <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-farm-danger">Finishes today</span> : null}
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-farm-accent-soft"><span className="block h-full rounded-full bg-indigo-500" style={{width: `${projectPct(p)}%`}} /></span>
                        <span className="text-[10px] font-bold text-farm-muted">{projectPct(p)}%{p.end_date ? ` · finishes ${p.end_date}` : ''}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      {/* Create / Edit event modal */}
      <Dialog.Root open={open} onOpenChange={(o) => {setOpen(o); if (!o) setEditingId(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-xl font-bold text-farm-green">{editingId ? 'Edit Event' : 'Schedule an Event'}</Dialog.Title>
              <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
            </div>
            <p className="mb-5 text-xs text-farm-muted">{editingId ? 'Update this plan on the farm calendar.' : 'Adds a plan to the farm calendar for the selected branch.'}</p>
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="ev-start">Start time <span className="normal-case text-farm-muted/70">(optional)</span></label>
                  <input id="ev-start" type="time" value={cStart} onChange={(e) => setCStart(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm font-semibold" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="ev-end">End time</label>
                  <input id="ev-end" type="time" value={cEnd} onChange={(e) => setCEnd(e.target.value)} className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm font-semibold" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted" htmlFor="ev-desc">Notes</label>
                <input id="ev-desc" value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="optional" className="min-h-12 w-full rounded-lg border border-farm-accent-soft bg-farm-bg px-3 text-sm" />
              </div>
              {canReadPrivate ? (
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase text-farm-muted">Who can see this?</label>
                  <SelectField value={cVisibility} onChange={(v) => setCVisibility(v as CalendarEvent['visibility'])} options={[{value: 'General', label: 'Everyone — planting, deliveries, farm work'}, {value: 'Management', label: 'Management only — meetings, investor plans'}]} />
                  <p className="mt-1 text-[10px] text-farm-muted">Management entries stay hidden from staff roles. Who counts as management is a role setting (Approvals &amp; Roles).</p>
                </div>
              ) : null}
            </div>
            <div className="mt-5 flex gap-2 border-t border-farm-accent-soft pt-4">
              <Button variant="secondary" onClick={() => {setOpen(false); setEditingId(null);}} disabled={busy}>Cancel</Button>
              <Button className="flex-1" onClick={() => void submit()} disabled={busy || !cTitle.trim() || !cDate}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Add to Calendar'}</Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Event detail panel (DayFlow): click any event → view; managers get edit / complete / delete (R-U-D of CRUD).
          Read-only roles (schedule.read without schedule.manage) see the details but no edit controls — RBAC. */}
      <Dialog.Root open={detail !== null} onOpenChange={(o) => {if (!o) setDetail(null);}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
            {detail ? (
              <>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Dialog.Title className="flex items-center gap-2 text-lg font-bold text-farm-green">
                    <span className={cn('h-3 w-3 shrink-0 rounded-full', TYPE_COLOR[detail.event_type] ?? 'bg-farm-muted')} aria-hidden />
                    {detail.title}
                  </Dialog.Title>
                  <Dialog.Close className="rounded p-1 text-farm-muted hover:text-farm-ink" aria-label="Close"><X size={20} aria-hidden /></Dialog.Close>
                </div>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-farm-muted">When</dt><dd className="font-semibold text-farm-ink">{new Date(detail.event_date + 'T00:00:00').toLocaleDateString('en-PH', {weekday: 'short', month: 'short', day: 'numeric'})}{detail.start_time ? ` · ${detail.start_time.slice(0, 5)}${detail.end_time ? `–${detail.end_time.slice(0, 5)}` : ''}` : ' · all day'}</dd></div>
                  <div className="flex justify-between"><dt className="text-farm-muted">Type</dt><dd className="font-semibold text-farm-ink">{detail.event_type}</dd></div>
                  <div className="flex justify-between"><dt className="text-farm-muted">Priority · Status</dt><dd className="font-semibold text-farm-ink">{detail.priority} · {detail.status}</dd></div>
                  <div className="flex justify-between"><dt className="text-farm-muted">Visibility</dt><dd className="font-semibold text-farm-ink">{(detail.visibility ?? 'General') === 'Management' ? 'Management only' : 'Everyone'}</dd></div>
                  {detail.description ? <div className="pt-1"><dt className="text-[10px] font-bold uppercase text-farm-muted">Notes</dt><dd className="text-sm text-farm-ink">{detail.description}</dd></div> : null}
                </dl>
                {canManage ? (
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-farm-accent-soft pt-4">
                    <Button variant="secondary" onClick={() => openEdit(detail)} disabled={busy}>Edit</Button>
                    {detail.status !== 'Completed'
                      ? <Button variant="secondary" onClick={() => void detailAction(() => schedulingApi.setStatus(detail, 'Completed'), 'Marked done')} disabled={busy}>Mark done</Button>
                      : <Button variant="secondary" onClick={() => void detailAction(() => schedulingApi.setStatus(detail, 'Scheduled'), 'Reopened')} disabled={busy}>Reopen</Button>}
                    <Button variant="danger" className="ml-auto" onClick={() => void detailAction(() => schedulingApi.deleteEvent(detail), 'Event deleted')} disabled={busy}>Delete</Button>
                  </div>
                ) : (
                  <p className="mt-5 border-t border-farm-accent-soft pt-4 text-[11px] text-farm-muted">View only — ask a manager to change this schedule.</p>
                )}
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
