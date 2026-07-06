// Week view (DayFlow adoption) — a 7-day time grid with drag/resize/cross-day-drag per column, reusing TimedBlock
// + timeGrid. Role visibility is enforced upstream (eventsByDay only holds events the user may see). An all-day
// row above the grid shows untimed events per day (clickable → detail). Horizontal drag moves an event to another
// day (onMoveDay), vertical drag re-times it; both persist under schedule.manage RLS.
import {useEffect, useRef, useState} from 'react';
import type {CalendarEvent} from '../../types/db';
import {cn} from '../../components/ui';
import {DAY_START_H, PX_PER_MIN, hourRows} from './timeGrid';
import {TimedBlock} from './TimedBlock';

const TYPE_COLOR: Record<string, string> = {
  Planting: 'bg-farm-green', Harvest: 'bg-emerald-600', Fertigation: 'bg-lime-600', Delivery: 'bg-amber-600',
  Meeting: 'bg-blue-600', Maintenance: 'bg-orange-600', Inspection: 'bg-purple-600', Training: 'bg-teal-600',
  Deadline: 'bg-farm-danger', Project: 'bg-indigo-600',
};
const HOUR_PX = 60 * PX_PER_MIN;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WeekView({
  weekDays, eventsByDay, today, selectedDay, canManage, onRetime, onResize, onMoveDay, onSelect, onSelectDay,
}: {
  weekDays: string[]; // 7 × yyyy-mm-dd
  eventsByDay: Map<string, CalendarEvent[]>;
  today: string;
  selectedDay: string;
  canManage: boolean;
  onRetime: (e: CalendarEvent, start: string, end: string | null) => void;
  onResize: (e: CalendarEvent, start: string, end: string) => void;
  onMoveDay: (e: CalendarEvent, fromDay: string, dayShift: number, start: string, end: string | null) => void;
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

  // measure one day-column's width so a horizontal drag maps to a whole-day shift
  const colsRef = useRef<HTMLDivElement>(null);
  const [colW, setColW] = useState(0);
  useEffect(() => {
    const measure = () => {if (colsRef.current) setColW(colsRef.current.getBoundingClientRect().width / 7);};
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* day headers */}
        <div className="flex border-b border-farm-accent-soft pb-1">
          <div className="w-12 shrink-0" />
          {weekDays.map((d) => {
            const dow = new Date(d + 'T00:00:00').getDay();
            const isT = d === today; const isSel = d === selectedDay;
            return (
              <button key={d} onClick={() => onSelectDay(d)} className={cn('flex-1 rounded-t-lg px-1 py-1 text-center', isSel && 'bg-farm-accent-soft')}>
                <span className="block text-[9px] font-black uppercase tracking-wider text-farm-muted">{WD[dow]}</span>
                <span className={cn('text-sm font-bold', isT ? 'text-farm-green' : 'text-farm-ink')}>{Number(d.slice(-2))}</span>
              </button>
            );
          })}
        </div>

        {/* all-day row (untimed events show here in every view — not just Month) */}
        <div className="flex border-b border-farm-accent-soft">
          <span className="flex w-12 shrink-0 items-center justify-end pr-2 text-[8px] font-black uppercase text-farm-muted">All day</span>
          {weekDays.map((d) => {
            const allDay = (eventsByDay.get(d) ?? []).filter((e) => !e.start_time);
            return (
              <div key={d} className="min-h-[26px] flex-1 space-y-0.5 border-l border-farm-accent-soft p-0.5">
                {allDay.map((e) => (
                  <button key={e.id} onClick={() => onSelect(e)} className={cn('block w-full truncate rounded px-1 py-0.5 text-left text-[9px] font-bold text-white', TYPE_COLOR[e.event_type] ?? 'bg-farm-muted', e.status === 'Completed' && 'opacity-50 line-through')} title={e.title}>{e.title}</button>
                ))}
              </div>
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
          <div ref={colsRef} className="flex flex-1">
            {weekDays.map((d) => {
              const timed = (eventsByDay.get(d) ?? []).filter((e) => e.start_time);
              return (
                <div key={d} className="relative flex-1 border-l border-farm-accent-soft">
                  {hourRows().map((h, i) => <span key={h} className="absolute inset-x-0 h-px bg-farm-accent-soft/70" style={{top: i * HOUR_PX}} />)}
                  {d === today && nowTop >= 0 && nowTop <= gridH ? <span className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-farm-danger" style={{top: nowTop}} /> : null}
                  {timed.map((e) => (
                    <TimedBlock key={e.id} e={e} canManage={canManage} compact colWidthPx={colW || undefined}
                      onRetime={onRetime} onResize={onResize} onSelect={onSelect}
                      onMoveDay={(ev, shift, s, en) => onMoveDay(ev, d, shift, s, en)} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
