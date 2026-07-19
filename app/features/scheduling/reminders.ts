// Event reminders (owner backlog item, 2026-07-19). Browser Notification API, client-side only — no
// push infrastructure exists for this app, so a reminder only fires while this tab is open, same
// "each device does its own thing" shape as the rest of the offline-first client. Fires once, 15
// minutes before an event's start_time, for events inside the next 24h that have a start_time set
// (all-day events have no clock time to count down to).
import {useEffect} from 'react';
import {usePref} from '../../core/prefs/prefs';
import type {CalendarEvent} from '../../types/db';

const LEAD_MINUTES = 15;
const MAX_LOOKAHEAD_MS = 24 * 60 * 60_000;

export function useEventReminders(events: CalendarEvent[]) {
  const [enabled] = usePref('reminders_enabled', '0');
  useEffect(() => {
    if (enabled !== '1' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const now = Date.now();
    const timers = events
      .filter((e) => e.start_time)
      .map((e) => {
        const at = new Date(`${e.event_date}T${e.start_time}`).getTime() - LEAD_MINUTES * 60_000;
        const delay = at - now;
        if (delay <= 0 || delay > MAX_LOOKAHEAD_MS) return null;
        return window.setTimeout(() => {
          new Notification(`${e.title} in ${LEAD_MINUTES} min`, {body: `${e.event_date} · ${e.start_time!.slice(0, 5)}`, tag: e.id});
        }, delay);
      })
      .filter((t): t is number => t !== null);
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [events, enabled]);
}

export async function requestReminderPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function reminderPermissionDenied(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'denied';
}
