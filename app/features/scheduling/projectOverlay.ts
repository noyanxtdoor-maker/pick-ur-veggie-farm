// Projects ↔ Calendar (owner review 2026-07-04, plan Phase B.3): pure date logic for overlaying project
// timelines on the calendar. "Make the projects be seen in Calendar and show its timeline when can it be
// finished." App-only — projects already carry start/end dates; RLS (project.read) authorizes the rows.
import type {Project} from '../../types/db';

/** Projects whose timeline covers the given yyyy-mm-dd day.
 *  Span = [start_date, end_date]; a project with only one date appears on that single day.
 *  Completed projects drop off the calendar (their work is done); On Hold stays visible (still planned). */
export function projectsOnDay(projects: Project[], day: string): Project[] {
  return projects.filter((p) => {
    if (p.status === 'Completed') return false;
    const start = p.start_date ?? p.end_date;
    const end = p.end_date ?? p.start_date;
    if (!start || !end) return false; // undated projects don't belong on a calendar
    return start <= day && day <= end;
  });
}

/** Does a project finish on this day? (the "when can it be finished" marker) */
export function projectDueOn(p: Project, day: string): boolean {
  return p.end_date === day && p.status !== 'Completed';
}

/** 0–100 checklist progress, mirroring the Projects board. */
export function projectPct(p: Project): number {
  if (p.tasks.length === 0) return 0;
  return Math.round((p.tasks.filter((t) => t.completed).length / p.tasks.length) * 100);
}
