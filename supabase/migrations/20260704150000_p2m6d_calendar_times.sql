-- Migration P2-M6D — Calendar event times (owner review 2026-07-04, plan B-polish: Google-calendar day view).
-- Owner: "make the calendar like google calendar … in day view we must be able to see the time and the time
--   indicator … drag & drop (adjust it)." Events currently carry a DATE only; this adds an optional time-of-day
--   so a day-view can position + drag them. NULL start_time = all-day (unchanged behaviour, shown untimed).
-- Additive only (M6A/M6C files immutable): two nullable columns + a sanity check + widened column grants.
-- Non-money (20.19 calendar); RLS/visibility (schedule.read + M6C tier) unchanged.

alter table public.calendar_events add column start_time time;
alter table public.calendar_events add column end_time   time;
alter table public.calendar_events add constraint calendar_events_time_order
  check (start_time is null or end_time is null or end_time > start_time);
comment on column public.calendar_events.start_time is 'P2-M6D: optional time-of-day for the day view. NULL = all-day event.';

-- widen the column-scoped grants so schedule.manage can write/adjust the times (RLS policy unchanged)
grant insert (start_time, end_time) on public.calendar_events to authenticated;
grant update (start_time, end_time) on public.calendar_events to authenticated;
