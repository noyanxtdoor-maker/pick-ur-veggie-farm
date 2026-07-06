// A positioned calendar event block with DayFlow-style drag (move) + resize (bottom handle), shared by the
// Day and Week views. Self-contained: it captures the pointer on press, so it needs no parent move handler.
// The authoritative drag state lives in a REF (read synchronously in pointer-up), not React state — so a fast
// gesture can't lose its commit to render batching; state only drives the live visual. Role visibility is
// enforced upstream (only events the user may see are passed in); canManage gates edits.
// Week view passes colWidthPx + onMoveDay: a horizontal drag then shifts the event to another day.
import {useRef, useState} from 'react';
import type {CalendarEvent} from '../../types/db';
import {cn} from '../../components/ui';
import {applyDrag, applyResize, heightPx, hhmm, topPx} from './timeGrid';

const TYPE_COLOR: Record<string, string> = {
  Planting: 'bg-farm-green', Harvest: 'bg-emerald-600', Fertigation: 'bg-lime-600', Delivery: 'bg-amber-600',
  Meeting: 'bg-blue-600', Maintenance: 'bg-orange-600', Inspection: 'bg-purple-600', Training: 'bg-teal-600',
  Deadline: 'bg-farm-danger', Project: 'bg-indigo-600',
};

export function TimedBlock({
  e, canManage, compact, colWidthPx, onRetime, onResize, onMoveDay, onSelect,
}: {
  e: CalendarEvent;
  canManage: boolean;
  compact?: boolean; // week view = tighter labels
  colWidthPx?: number; // week view: width of one day column → horizontal drag = day shift
  onRetime: (e: CalendarEvent, start: string, end: string | null) => void;
  onResize: (e: CalendarEvent, start: string, end: string) => void;
  onMoveDay?: (e: CalendarEvent, dayShift: number, start: string, end: string | null) => void;
  onSelect: (e: CalendarEvent) => void;
}) {
  const dragRef = useRef<{mode: 'move' | 'resize'; startX: number; startY: number; dx: number; dy: number} | null>(null);
  const [, force] = useState(0); // repaint only
  const start = hhmm(e.start_time)!;
  const end = hhmm(e.end_time);
  const canCrossDay = !!colWidthPx && !!onMoveDay;

  function begin(mode: 'move' | 'resize', ev: React.PointerEvent) {
    if (!canManage) return;
    ev.preventDefault();
    ev.stopPropagation();
    try {(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);} catch {/* ignore */}
    dragRef.current = {mode, startX: ev.clientX, startY: ev.clientY, dx: 0, dy: 0};
    force((x) => x + 1);
  }
  function move(ev: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current.dx = ev.clientX - dragRef.current.startX;
    dragRef.current.dy = ev.clientY - dragRef.current.startY;
    force((x) => x + 1);
  }
  function finish(ev: React.PointerEvent) {
    try {(ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);} catch {/* ignore */}
    const dr = dragRef.current;
    dragRef.current = null;
    force((x) => x + 1);
    if (!dr) return;
    if (Math.abs(dr.dx) < 4 && Math.abs(dr.dy) < 4) {onSelect(e); return;} // a tap = open detail
    if (dr.mode === 'resize') {
      const r = applyResize(start, end, dr.dy);
      if (r.end !== end) onResize(e, r.start, r.end);
      return;
    }
    // move: vertical → new time; horizontal (week view) → day shift
    const r = applyDrag(start, end, dr.dy);
    const dayShift = canCrossDay ? Math.round(dr.dx / colWidthPx!) : 0;
    if (dayShift !== 0) onMoveDay!(e, dayShift, r.start, r.end);
    else if (r.start !== start) onRetime(e, r.start, r.end);
  }

  const dr = dragRef.current;
  const moving = dr?.mode === 'move';
  const top = topPx(start) + (moving ? dr.dy : 0);
  const height = Math.max(22, heightPx(start, end) + (dr?.mode === 'resize' ? dr.dy : 0));
  const translateX = moving && canCrossDay ? dr.dx : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      // Managers drag (begin/move/finish handles tap-vs-drag). Read-only users get a plain click → open detail
      // to READ the event (begin() no-ops without canManage, so the native click is the only way in for them).
      onClick={!canManage ? () => onSelect(e) : undefined}
      // Keyboard: Enter/Space opens the detail for everyone (drag is pointer-only; this is the accessible path in).
      onKeyDown={(ev) => {if (ev.key === 'Enter' || ev.key === ' ') {ev.preventDefault(); onSelect(e);}}}
      onPointerDown={(ev) => begin('move', ev)}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      className={cn(
        'absolute inset-x-1 z-10 touch-none select-none overflow-hidden rounded-lg px-1.5 py-0.5 text-left text-white shadow-sm',
        TYPE_COLOR[e.event_type] ?? 'bg-farm-muted',
        canManage ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        dr && 'z-30 opacity-80 ring-2 ring-white',
        e.status === 'Completed' && 'opacity-50',
      )}
      style={{top, height, transform: translateX ? `translateX(${translateX}px)` : undefined}}
      title={canManage ? (canCrossDay ? 'Drag to move (any day) · drag bottom edge to resize' : 'Drag to move · drag the bottom edge to resize') : e.title}
    >
      <p className={cn('truncate font-bold', compact ? 'text-[10px]' : 'text-xs')}>{e.title}</p>
      {!compact || height > 34 ? <p className="truncate text-[10px] opacity-90">{start}{end ? `–${end}` : ''}</p> : null}
      {canManage ? (
        <span
          onPointerDown={(ev) => begin('resize', ev)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          className="absolute inset-x-0 bottom-0 h-2.5 cursor-ns-resize touch-none"
          aria-label="Resize"
        />
      ) : null}
    </div>
  );
}
