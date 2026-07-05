// Day-view time math (P2-M6D) — pure helpers for the Google-calendar-style day grid + drag. Kept separate
// so the tricky arithmetic (minutes ↔ HH:MM, snapping, drag deltas) is unit-tested without any DOM.

export const DAY_START_H = 5; // grid starts 5am
export const DAY_END_H = 21; // …ends 9pm
export const PX_PER_MIN = 0.9; // grid density (→ 54px/hour)
export const SNAP_MIN = 15; // drag snaps to quarter-hours

/** 'HH:MM:SS' | 'HH:MM' → 'HH:MM' (null passes through). */
export function hhmm(t: string | null | undefined): string | null {
  if (!t) return null;
  return t.slice(0, 5);
}

/** 'HH:MM' → minutes since midnight. */
export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** minutes since midnight → 'HH:MM' (clamped to a valid day). */
export function toTime(min: number): string {
  const c = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
}

export function snap(min: number, step = SNAP_MIN): number {
  return Math.round(min / step) * step;
}

/** Pixel top offset of a time within the grid (relative to DAY_START). */
export function topPx(startTime: string): number {
  return (toMinutes(startTime) - DAY_START_H * 60) * PX_PER_MIN;
}

/** Event block height in px (min 22 for legibility); default 60-min block when no end. */
export function heightPx(startTime: string, endTime: string | null): number {
  const dur = endTime ? Math.max(15, toMinutes(endTime) - toMinutes(startTime)) : 60;
  return Math.max(22, dur * PX_PER_MIN);
}

/** Given a pixel delta from a drag, return the new start/end times, snapped, preserving duration
 *  and clamped so the event stays inside [DAY_START, DAY_END]. */
export function applyDrag(startTime: string, endTime: string | null, deltaPx: number): {start: string; end: string | null} {
  const dur = endTime ? toMinutes(endTime) - toMinutes(startTime) : 60;
  const rawStart = toMinutes(startTime) + deltaPx / PX_PER_MIN;
  let start = snap(rawStart);
  const lo = DAY_START_H * 60;
  const hi = DAY_END_H * 60 - dur;
  start = Math.max(lo, Math.min(hi, start));
  return {start: toTime(start), end: endTime ? toTime(start + dur) : null};
}

/** Hour labels for the grid gutter. */
export function hourRows(): number[] {
  return Array.from({length: DAY_END_H - DAY_START_H + 1}, (_, i) => DAY_START_H + i);
}
