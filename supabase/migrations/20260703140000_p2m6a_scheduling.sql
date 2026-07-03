-- Migration P2-M6A — Scheduling / Calendar Event Engine (Phase 2, Module 6A).
-- Authority: Phase_2_M6_Scheduling_Module_Spec.md · prototype src/features/Schedules.tsx = workflow-logic authority
--   (owner 2026-07-02) · System 20.19 Calendar Event Engine = structural authority · 26.09 permissions.
-- Model: branch-owned farm calendar. NO GL, no money path — plain RLS-gated writes (like crops/products), audited.
--   Deferred (spec §2): datetime ranges, per-role visibility, automation, assignment/crop/zone/equipment refs,
--   week/day views. project_id reserved (Projects module M7 not built).
-- Pattern: ADDITIVE ONLY. Risk: Medium (new operational table; no financial impact).

insert into public.permissions (permission_key, description) values
  ('schedule.read',   'View the farm calendar / schedule'),
  ('schedule.manage', 'Create, edit, and delete calendar events')
on conflict (permission_key) do nothing;

create table public.calendar_events (
  id           uuid primary key default public.uuidv7(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  branch_id    uuid not null,
  event_type   text not null default 'Meeting' check (event_type in ('Planting', 'Fertigation', 'Harvest', 'Maintenance', 'Delivery', 'Meeting', 'Inspection', 'Training', 'Deadline', 'Project')),
  title        text not null,
  description  text,
  event_date   date not null,
  priority     text not null default 'Normal' check (priority in ('Low', 'Normal', 'High', 'Critical')),
  status       text not null default 'Scheduled' check (status in ('Scheduled', 'In Progress', 'Completed', 'Cancelled', 'Overdue')),
  project_id   uuid,            -- reserved: Projects module (M7); not FK-enforced yet
  created_by   uuid references public.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, company_id),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict
);
comment on table public.calendar_events is 'Farm calendar events (P2-M6A, 20.19). Branch-owned; schedule.read-view / schedule.manage-write; audited. No GL. project_id reserved for M7.';
create index calendar_events_branch_date_idx on public.calendar_events (branch_id, company_id, event_date);
create trigger calendar_events_set_updated_at before update on public.calendar_events for each row execute function public.set_updated_at();
create trigger calendar_events_audit after insert or update on public.calendar_events for each row execute function public.inventory_audit();

alter table public.calendar_events enable row level security;
alter table public.calendar_events force row level security;
revoke all on public.calendar_events from public, anon, authenticated, service_role;
grant select on public.calendar_events to authenticated;
grant insert (company_id, branch_id, event_type, title, description, event_date, priority, status, project_id, created_by) on public.calendar_events to authenticated;
grant update (event_type, title, description, event_date, priority, status, project_id) on public.calendar_events to authenticated;
grant delete on public.calendar_events to authenticated;   -- operational (non-financial) data; hard delete OK, RLS-gated
create policy calendar_events_select on public.calendar_events for select to authenticated
  using (public.has_permission(company_id, 'schedule.read') and public.is_branch_member(branch_id));
create policy calendar_events_insert on public.calendar_events for insert to authenticated
  with check (public.has_permission(company_id, 'schedule.manage') and public.is_branch_member(branch_id));
create policy calendar_events_update on public.calendar_events for update to authenticated
  using (public.has_permission(company_id, 'schedule.manage') and public.is_branch_member(branch_id))
  with check (public.has_permission(company_id, 'schedule.manage') and public.is_branch_member(branch_id));
create policy calendar_events_delete on public.calendar_events for delete to authenticated
  using (public.has_permission(company_id, 'schedule.manage') and public.is_branch_member(branch_id));
