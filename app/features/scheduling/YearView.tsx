// Year view (DayFlow's 4th view) — 12 mini-months at a glance. For a farm this is the seasonal planting/harvest
// overview: any day with events shows a dot; click a day → jump to Day view; click a month name → Month view.
// Role visibility is enforced upstream (eventsByDay only holds events the user may see). Read-only, no drag.
import type {CalendarEvent} from '../../types/db';
import {cn} from '../../components/ui';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// leading blanks + day strings for one month (same shape the Month grid uses)
function monthCells(year: number, month: number): Array<string | null> {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const out: Array<string | null> = Array.from({length: first}, () => null);
  for (let d = 1; d <= days; d++) out.push(ymd(new Date(year, month, d)));
  return out;
}

export function YearView({
  year, eventsByDay, today, onSelectDay, onSelectMonth,
}: {
  year: number;
  eventsByDay: Map<string, CalendarEvent[]>;
  today: string;
  onSelectDay: (day: string) => void; // → Day view
  onSelectMonth: (month: number) => void; // → Month view
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {MONTHS_SHORT.map((name, m) => (
        <div key={name} className="rounded-lg border border-farm-accent-soft p-2">
          <button onClick={() => onSelectMonth(m)} className="mb-1 block text-xs font-bold text-farm-green hover:underline">{name}</button>
          <div className="grid grid-cols-7 gap-0.5">
            {monthCells(year, m).map((day, i) => {
              if (day === null) return <div key={`b${i}`} className="h-5" />;
              const has = (eventsByDay.get(day)?.length ?? 0) > 0;
              const isToday = day === today;
              return (
                <button key={day} onClick={() => onSelectDay(day)} title={has ? `${eventsByDay.get(day)!.length} event(s)` : undefined}
                  className={cn('flex h-5 items-center justify-center rounded text-[9px] leading-none transition',
                    isToday ? 'bg-farm-green font-bold text-white' : has ? 'bg-farm-accent-soft font-bold text-farm-green hover:bg-farm-accent' : 'text-farm-muted hover:bg-farm-bg')}>
                  {Number(day.slice(-2))}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
