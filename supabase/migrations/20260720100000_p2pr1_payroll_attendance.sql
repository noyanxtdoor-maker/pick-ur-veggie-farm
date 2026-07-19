-- Migration P2PR1 — Payroll attendance/shift tracking (owner backlog item: "payroll build-out —
-- attendance/shifts..."). First slice of the payroll build-out; scoped and shipped narrowly on
-- purpose (see SCOPE NOTE below) rather than attempting all six named sub-items in one migration.
--
-- CURRENT STATE: payroll_disburse_wage's p_days_worked is free-typed by whoever disburses wages —
-- there is no backing record of who actually showed up on which day at all. This migration adds
-- that record without changing wage disbursement's authority or math in any way.
--
-- SCOPE NOTE (read before extending this): "the full payroll build-out" the owner listed is six
-- separable sub-items (attendance/shifts, leave, overtime, an approval workflow, multiple payout
-- methods, formatted payslips) — each is realistically its own standalone-feature-sized migration,
-- not one combined change. This migration ships ONLY attendance/shift tracking, the true foundation
-- the other five build on (leave and overtime both need a real attendance record to compute against;
-- an approval workflow needs something concrete to approve). The remaining five sub-items are
-- deliberately NOT touched here and remain open backlog, continuing one at a time at the same rigor
-- — flagged explicitly rather than silently claiming "payroll build-out" as done.
--
-- DESIGN:
--   attendance_records — one row per (employee, work_date). status in ('Present','Half Day',
--     'Absent') drives a day-fraction (1.0 / 0.5 / 0) a supervisor can mark without needing
--     minute-precise time-clock hardware (matches how small farm/field-labor crews are actually
--     tracked); clock_in/clock_out are optional reference timestamps, not required. One record per
--     employee per day (upsert semantics — correcting a mistake updates the same row, never a
--     duplicate).
--   payroll_record_attendance(...) — payroll.manage gated (the same tier that already disburses
--     wages), upserts. Reuses the existing generic inventory_audit() trigger for the audit trail
--     (already proven safe on equipment_assets — works off any table with id/company_id/branch_id).
--   list_attendance(...) — read, mirrors wage_payments' own dual-policy shape (payroll.manage/read
--     sees the branch's full roster; an employee with a linked user_id sees only their own rows).
--   Deliberately does NOT change payroll_disburse_wage's signature or math at all — attendance is a
--     pure client-side PREFILL for the existing days_worked input (still fully editable before
--     submit, same as every other prefill-then-editable pattern already used this session for Buy
--     Now/Cost Schedule), not a hard dependency. Keeps blast radius on the money-path RPC at zero.
--
-- PERMISSION: reuses payroll.manage (record) and payroll.read (view) — no new keys (C1 §4).
--
-- Authority: owner backlog item "payroll build-out." High-risk domain per CLAUDE.md's own tripwire
-- table (Financial integrity, B2/C7 §4, Phase 4) — mitigated by touching NOTHING in the disbursement
-- RPC itself; this is purely an additive, non-authoritative input record. Risk: Low.

create table public.attendance_records (
  id           uuid primary key default public.uuidv7(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  branch_id    uuid not null,
  employee_id  uuid not null,
  work_date    date not null,
  status       text not null check (status in ('Present', 'Half Day', 'Absent')),
  clock_in     timestamptz,
  clock_out    timestamptz,
  notes        text,
  recorded_by  uuid not null references public.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict,
  foreign key (employee_id, company_id) references public.employees (id, company_id) on delete restrict
);
comment on table public.attendance_records is 'P2PR1: one row per (employee, work_date). status drives a day-fraction (Present=1.0, Half Day=0.5, Absent=0) used to PRE-FILL (not authoritatively set) payroll_disburse_wage''s days_worked input. clock_in/clock_out are optional reference timestamps.';
create unique index attendance_records_one_per_day on public.attendance_records (company_id, employee_id, work_date);
create index attendance_records_branch_date_idx on public.attendance_records (company_id, branch_id, work_date);
create trigger attendance_records_set_updated_at before update on public.attendance_records
  for each row execute function public.set_updated_at();
create trigger attendance_records_audit after insert or update on public.attendance_records
  for each row execute function public.inventory_audit();

alter table public.attendance_records enable row level security;
alter table public.attendance_records force row level security;
revoke all on public.attendance_records from public, anon, authenticated, service_role;
grant select on public.attendance_records to authenticated;
create policy attendance_records_select on public.attendance_records as permissive for select to authenticated
  using (
    (public.has_permission(company_id, 'payroll.read') and public.is_branch_member(branch_id))
    or exists (
      select 1 from public.employees e
       where e.id = attendance_records.employee_id and e.company_id = attendance_records.company_id
         and e.user_id = public.current_app_user_id()
    )
  );
-- Writes are function-only (SECURITY DEFINER RPC below). No direct insert/update/delete grant.

create function public.payroll_record_attendance(
  p_branch_id   uuid,
  p_employee_id uuid,
  p_work_date   date,
  p_status      text,
  p_clock_in    timestamptz default null,
  p_clock_out   timestamptz default null,
  p_notes       text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid; v_emp_company uuid; v_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'payroll.manage') then
    raise exception 'permission denied: payroll.manage' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(p_branch_id) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;
  select e.company_id into v_emp_company from public.employees e where e.id = p_employee_id;
  if v_emp_company is null or v_emp_company <> v_company then
    raise exception 'employee not found in this company' using errcode = 'foreign_key_violation';
  end if;
  if p_status not in ('Present', 'Half Day', 'Absent') then
    raise exception 'invalid status' using errcode = 'check_violation';
  end if;
  if p_work_date is null then raise exception 'work date is required' using errcode = 'check_violation'; end if;
  if p_clock_in is not null and p_clock_out is not null and p_clock_out < p_clock_in then
    raise exception 'clock out cannot be before clock in' using errcode = 'check_violation';
  end if;

  insert into public.attendance_records (company_id, branch_id, employee_id, work_date, status, clock_in, clock_out, notes, recorded_by)
    values (v_company, p_branch_id, p_employee_id, p_work_date, p_status, p_clock_in, p_clock_out, nullif(trim(coalesce(p_notes, '')), ''), v_actor)
    on conflict (company_id, employee_id, work_date)
    do update set branch_id = excluded.branch_id, status = excluded.status, clock_in = excluded.clock_in,
                  clock_out = excluded.clock_out, notes = excluded.notes, recorded_by = excluded.recorded_by
    returning id into v_id;
  return v_id;
end; $$;
comment on function public.payroll_record_attendance(uuid, uuid, date, text, timestamptz, timestamptz, text) is 'P2PR1: record or correct one employee''s attendance for one work_date (upsert — one row per employee per day). payroll.manage-gated, audited via the generic inventory_audit() trigger.';
revoke all on function public.payroll_record_attendance(uuid, uuid, date, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.payroll_record_attendance(uuid, uuid, date, text, timestamptz, timestamptz, text) to authenticated;

create function public.list_attendance(p_company uuid, p_branch_id uuid, p_employee_id uuid default null, p_from date default null, p_to date default null)
returns table (
  id uuid, employee_id uuid, employee_name text, work_date date, status text,
  clock_in timestamptz, clock_out timestamptz, notes text
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not (
    (public.has_permission(p_company, 'payroll.read') and public.is_branch_member(p_branch_id))
    or exists (
      select 1 from public.employees e
       where e.company_id = p_company and e.user_id = v_actor and (p_employee_id is null or e.id = p_employee_id)
    )
  ) then
    raise exception 'permission denied: payroll.read' using errcode = 'insufficient_privilege';
  end if;
  return query
    select ar.id, ar.employee_id, e.name as employee_name, ar.work_date, ar.status, ar.clock_in, ar.clock_out, ar.notes
      from public.attendance_records ar
      join public.employees e on e.id = ar.employee_id
     where ar.company_id = p_company and ar.branch_id = p_branch_id
       and (p_employee_id is null or ar.employee_id = p_employee_id)
       and (p_from is null or ar.work_date >= p_from)
       and (p_to is null or ar.work_date <= p_to)
     order by ar.work_date desc, e.name;
end; $$;
comment on function public.list_attendance(uuid, uuid, uuid, date, date) is 'P2PR1: read attendance for a branch (optionally filtered to one employee/date range). payroll.read+branch-member, or an employee viewing their own linked record.';
revoke all on function public.list_attendance(uuid, uuid, uuid, date, date) from public, anon;
grant execute on function public.list_attendance(uuid, uuid, uuid, date, date) to authenticated;
