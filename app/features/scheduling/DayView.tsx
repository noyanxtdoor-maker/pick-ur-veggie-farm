// Google-calendar-style day view (P2-M6D) — hour grid, a live "now" indicator, and drag-to-reschedule for
// managers. All-day (untimed) events sit in a strip above the grid. Times persist via onRetime (schedule.manage
// RLS is the real gate). Pure geometry lives in timeGrid.ts; this file is the DOM + pointer handling only.
import {useEffect, useRef, useState} from 'react';
import type {CalendarEvent} from '../../types/db';
import {cn} from '../../components/ui';
import {DAY_START_H, PX_PER_MIN, applyDrag, heightPx, hhmm, hourRows, toMinutes, topPx} from './timeGrid';

const TYPE_COLOR: Record<string, string> = {
  Planting: 'bg-farm-green', Harvest: 'bg-emerald-600', Fertigation: 'bg-lime-600', Delivery: 'bg-amber-600',
  Meeting: 'bg-blue-600', Maintenance: 'bg-orange-600', Inspection: 'bg-purple-600', Training: 'bg-teal-600',
  Deadline: 'bg-farm-danger', Project: 'bg-indigo-600',
};
const HOUR_PX = 60 * PX_PER_MIN;

export function DayView({
  events, isToday, canManage, onRetime, onSelect,
}: {
  events: CalendarEvent[];
  isToday: boolean;
  canManage: boolean;
  onRetime: (e: CalendarEvent, start: string, end: string | null) => void;
  onSelect: (e: CalendarEvent) => void;
}) {
  const allDay = events.filter((e) => !e.start_time);
  const timed = events.filter((e) => e.start_time).sort((a, b) => toMinutes(hhmm(a.start_time)!) - toMinutes(hhmm(b.start_time)!));

  // live "now" line
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => {const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes());}, 60000);
    return () => clearInterval(t);
  }, [isToday]);
  const nowTop = (nowMin - DAY_START_H * 60) * PX_PER_MIN;

  // drag state
  const [drag, setDrag] = useState<{id: string; deltaPx: number} | null>(null);
  const startY = useRef(0);

  function onPointerDown(ev: React.PointerEvent, e: CalendarEvent) {
    if (!canManage) return;
    ev.preventDefault();
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    startY.current = ev.clientY;
    setDrag({id: e.id, deltaPx: 0});
  }
  function onPointerMove(ev: React.PointerEvent) {
    if (!drag) return;
    setDrag({id: drag.id, deltaPx: ev.clientY - startY.current});
  }
  function onPointerUp(e: CalendarEvent) {
    if (!drag || drag.id !== e.id) return setDrag(null);
    if (Math.abs(drag.deltaPx) < 4) {onSelect(e); setDrag(null); return;} // treat as a click
    const {start, end} = applyDrag(hhmm(e.start_time)!, hhmm(e.end_time), drag.deltaPx);
    if (start !== hhmm(e.start_time)) onRetime(e, start, end);
    setDrag(null);
  }

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

      <div className="relative" style={{height: hourRows().length * HOUR_PX}} onPointerMove={onPointerMove}>
        {/* hour lines + gutter labels */}
        {hourRows().map((h, i) => (
          <div key={h} className="absolute inset-x-0 flex items-start" style={{top: i * HOUR_PX}}>
            <span className="w-12 shrink-0 -translate-y-1.5 pr-2 text-right text-[10px] font-semibold text-farm-muted">{h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'am' : 'pm'}</span>
            <span className="mt-0 h-px flex-1 bg-farm-accent-soft" />
          </div>
        ))}

        {/* now indicator */}
        {isToday && nowTop >= 0 && nowTop <= hourRows().length * HOUR_PX ? (
          <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{top: nowTop}}>
            <span className="ml-10 h-2 w-2 rounded-full bg-farm-danger" />
            <span className="h-0.5 flex-1 bg-farm-danger" />
          </div>
        ) : null}

        {/* timed event blocks */}
        {timed.map((e) => {
          const isDragging = drag?.id === e.id;
          const offset = isDragging ? drag!.deltaPx : 0;
          return (
            <div
              key={e.id}
              onPointerDown={(ev) => onPointerDown(ev, e)}
              onPointerUp={() => onPointerUp(e)}
              role="button"
              tabIndex={0}
              className={cn(
                'absolute left-14 right-1 z-10 overflow-hidden rounded-lg px-2 py-1 text-left text-white shadow-sm',
                TYPE_COLOR[e.event_type] ?? 'bg-farm-muted',
                canManage ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                isDragging && 'opacity-80 ring-2 ring-white',
                e.status === 'Completed' && 'opacity-50',
              )}
              style={{top: topPx(hhmm(e.start_time)!) + offset, height: heightPx(hhmm(e.start_time)!, hhmm(e.end_time))}}
              title={canManage ? 'Drag to reschedule' : e.title}
            >
              <p className="truncate text-xs font-bold">{e.title}</p>
              <p className="truncate text-[10px] opacity-90">{hhmm(e.start_time)}{e.end_time ? `–${hhmm(e.end_time)}` : ''} · {e.event_type}</p>
            </div>
          );
        })}
      </div>
      {canManage ? <p className="mt-2 text-[10px] text-farm-muted">Tip: drag a block up or down to reschedule it. Times snap to 15 minutes.</p> : null}
    </div>
  );
}
