// Week view (DayFlow adoption) — a 7-day time grid with drag/resize per column, reusing TimedBlock + timeGrid.
// Role visibility is enforced upstream (eventsByDay only holds events the user may see). Cross-day drag is
// deferred (v1 moves within a day's column); switch to Day view or edit to move a task to another day.
import {useEffect, useState} from 'react';
import type {CalendarEvent} from '../../types/db';
import {cn} from '../../components/ui';
import {DAY_START_H, PX_PER_MIN, hhmm, hourRows} from './timeGrid';
import {TimedBlock} from './TimedBlock';

const TYPE_COLOR: Record<string, string> = {
  Planting: 'bg-farm-green', Harvest: 'bg-emerald-600', Fertigation: 'bg-lime-600', Delivery: 'bg-amber-600',
  Meeting: 'bg-blue-600', Maintenance: 'bg-orange-600', Inspection: 'bg-purple-600', Training: 'bg-teal-600',
  Deadline: 'bg-farm-danger', Project: 'bg-indigo-600',
};
const HOUR_PX = 60 * PX_PER_MIN;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WeekView({
  weekDays, eventsByDay, today, selectedDay, canManage, onRetime, onResize, onSelect, onSelectDay,
}: {
  weekDays: string[]; // 7 × yyyy-mm-dd
  eventsByDay: Map<string, CalendarEvent[]>;
  today: string;
  selectedDay: string;
  canManage: boolean;
  onRetime: (e: CalendarEvent, start: string, end: string | null) => void;
  onResize: (e: CalendarEvent, start: string, end: string) => void;
  onSelect: (e: CalendarEvent) => void;
  onSelectDay: (day: string) => void;
}) {
  const [nowMin, setNowMin] = useState(() => {const d = new Date(); return d.getHours() * 60 + d.getMinutes();});
  useEffect(() => {
    const t = setInterval(() => {const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes());}, 60000);
    return () => clearInterval(t);
  }, []);
  const nowTop = (nowMin - DAY_START_H * 60) * PX_PER_MIN;
  const gridH = hourRows().length * HOUR_PX;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* day headers */}
        <div className="flex border-b border-farm-accent-soft pb-1">
          <div className="w-12 shrink-0" />
          {weekDays.map((d) => {
            const dow = new Date(d + 'T00:00:00').getDay();
            const isT = d === today; const isSel = d === selectedDay;
            const allDay = (eventsByDay.get(d) ?? []).filter((e) => !e.start_time);
            return (
              <button key={d} onClick={() => onSelectDay(d)} className={cn('flex-1 rounded-t-lg px-1 py-1 text-center', isSel && 'bg-farm-accent-soft')}>
                <span className="block text-[9px] font-black uppercase tracking-wider text-farm-muted">{WD[dow]}</span>
                <span className={cn('text-sm font-bold', isT ? 'text-farm-green' : 'text-farm-ink')}>{Number(d.slice(-2))}</span>
                {allDay.length > 0 ? <span className="mx-auto mt-0.5 block h-1 w-4 rounded-full bg-farm-accent" title={`${allDay.length} all-day`} /> : null}
              </button>
            );
          })}
        </div>

        {/* time grid */}
        <div className="relative flex" style={{height: gridH}}>
          {/* hour gutter */}
          <div className="relative w-12 shrink-0">
            {hourRows().map((h, i) => (
              <span key={h} className="absolute right-2 -translate-y-1.5 text-[10px] font-semibold text-farm-muted" style={{top: i * HOUR_PX}}>{h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'a' : 'p'}</span>
            ))}
          </div>
          {/* day columns */}
          {weekDays.map((d) => {
            const timed = (eventsByDay.get(d) ?? []).filter((e) => e.start_time);
            return (
              <div key={d} className="relative flex-1 border-l border-farm-accent-soft">
                {hourRows().map((h, i) => <span key={h} className="absolute inset-x-0 h-px bg-farm-accent-soft/70" style={{top: i * HOUR_PX}} />)}
                {d === today && nowTop >= 0 && nowTop <= gridH ? <span className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-farm-danger" style={{top: nowTop}} /> : null}
                {timed.map((e) => (
                  <TimedBlock key={e.id} e={e} canManage={canManage} compact onRetime={onRetime} onResize={onResize} onSelect={onSelect} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
