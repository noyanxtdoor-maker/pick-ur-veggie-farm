// Google-calendar-style day view (P2-M6D + DayFlow week/resize adoption) — hour grid, a live "now" indicator,
// and drag/resize event blocks (shared TimedBlock). All-day (untimed) events sit in a strip above the grid.
// Role visibility is enforced upstream (only visible events are passed); pure geometry lives in timeGrid.ts.
import {useEffect, useState} from 'react';
import type {CalendarEvent} from '../../types/db';
import {cn} from '../../components/ui';
import {DAY_START_H, PX_PER_MIN, hhmm, hourRows, toMinutes} from './timeGrid';
import {TimedBlock} from './TimedBlock';

const TYPE_COLOR: Record<string, string> = {
  Planting: 'bg-farm-green', Harvest: 'bg-emerald-600', Fertigation: 'bg-lime-600', Delivery: 'bg-amber-600',
  Meeting: 'bg-blue-600', Maintenance: 'bg-orange-600', Inspection: 'bg-purple-600', Training: 'bg-teal-600',
  Deadline: 'bg-farm-danger', Project: 'bg-indigo-600',
};
const HOUR_PX = 60 * PX_PER_MIN;

export function DayView({
  events, isToday, canManage, onRetime, onResize, onSelect,
}: {
  events: CalendarEvent[];
  isToday: boolean;
  canManage: boolean;
  onRetime: (e: CalendarEvent, start: string, end: string | null) => void;
  onResize: (e: CalendarEvent, start: string, end: string) => void;
  onSelect: (e: CalendarEvent) => void;
}) {
  const allDay = events.filter((e) => !e.start_time);
  const timed = events.filter((e) => e.start_time).sort((a, b) => toMinutes(hhmm(a.start_time)!) - toMinutes(hhmm(b.start_time)!));

  const [nowMin, setNowMin] = useState(() => {const d = new Date(); return d.getHours() * 60 + d.getMinutes();});
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => {const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes());}, 60000);
    return () => clearInterval(t);
  }, [isToday]);
  const nowTop = (nowMin - DAY_START_H * 60) * PX_PER_MIN;

  return (
    <div>
      {allDay.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5 border-b border-farm-accent-soft pb-3">
          <span className="mr-1 text-[10px] font-black uppercase tracking-wider text-farm-muted">All day</span>
          {allDay.map((e) => (
            <button key={e.id} onClick={() => onSelect(e)} className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold text-white', TYPE_COLOR[e.event_type] ?? 'bg-farm-muted', e.status === 'Completed' && 'opacity-50 line-through')}>{e.title}</button>
          ))}
        </div>
      ) : null}

      <div className="relative" style={{height: hourRows().length * HOUR_PX}}>
        {hourRows().map((h, i) => (
          <div key={h} className="absolute inset-x-0 flex items-start" style={{top: i * HOUR_PX}}>
            <span className="w-12 shrink-0 -translate-y-1.5 pr-2 text-right text-[10px] font-semibold text-farm-muted">{h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}</span>
            <span className="mt-0 h-px flex-1 bg-farm-accent-soft" />
          </div>
        ))}

        {isToday && nowTop >= 0 && nowTop <= hourRows().length * HOUR_PX ? (
          <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{top: nowTop}}>
            <span className="ml-10 h-2 w-2 rounded-full bg-farm-danger" />
            <span className="h-0.5 flex-1 bg-farm-danger" />
          </div>
        ) : null}

        {/* event column (left gutter = 3.5rem) */}
        <div className="absolute inset-y-0 left-14 right-0">
          {timed.map((e) => (
            <TimedBlock key={e.id} e={e} canManage={canManage} onRetime={onRetime} onResize={onResize} onSelect={onSelect} />
          ))}
        </div>
      </div>
      {canManage ? <p className="mt-2 text-[10px] text-farm-muted">Tip: drag a block to reschedule; drag its bottom edge to change how long it lasts. Snaps to 15 minutes.</p> : null}
    </div>
  );
}
