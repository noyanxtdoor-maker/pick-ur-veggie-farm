-- Migration P2PR3 — Payroll overtime request tracking (owner backlog item: "payroll build-out —
-- ...overtime...", slice 3 of 6; slice 1 was P2PR1 attendance, slice 2 was P2PR2 leave).
--
-- AUTHORITY: docs/21_Human_Resources_Payroll_Architecture/21.09_Overtime_and_Holiday_Pay_System.md
-- describes a full enterprise system: AUTOMATIC overtime detection (actual time-out vs. an assigned
-- shift schedule), a request/approve workflow, holiday-type classification (regular/special/rest-day/
-- company holidays), company-configurable overtime multipliers/holiday rates/night differentials
-- varying by country or company policy, and "audit protection" that blocks edits after payroll
-- processing.
--
-- SCOPE NOTE (read before extending this): this migration ships ONLY the manual request/approve
-- workflow half of 21.09 — an employee (or a manager on their behalf) records hours of overtime
-- worked on a date; a payroll.manage holder (not the beneficiary) approves or rejects it. It
-- deliberately does NOT build:
--   (a) automatic detection from a scheduled shift vs. actual time-out — the Scheduling module
--       (P2M6*) has its own independent shift-assignment model with no per-employee "assigned shift
--       hours today" concept payroll could diff against; wiring the two together is a real cross-
--       module feature, not a one-line add;
--   (b) holiday-type classification and any rate multiplier math (overtime multiplier, holiday rate,
--       night differential) — 21.09 itself says these must vary "based on country or company policy,"
--       i.e. real configuration surface this app has nowhere to store or edit today. This migration
--       tracks HOURS and an approval decision only; it does not compute or store a peso amount for
--       the overtime, matching the exact same "payroll connection deferred" decision already recorded
--       in P2PR1 (attendance) and P2PR2 (leave) — wage_payments has no structured way to consume a
--       derived overtime amount yet, and inventing one here would be guessing at unstated pay rules;
--   (c) "audit protection after payroll processing" — this app has no payroll-period-close concept at
--       all (wages are disbursed ad-hoc per payroll_disburse_wage call), so there is no "after
--       processing" state to protect against yet.
-- The remaining three payroll sub-items (an approval workflow for disbursements themselves, multiple
-- payout methods, formatted payslips) remain untouched and open.
--
-- DESIGN (mirrors P2PR2's leave-request idiom almost exactly, single-date instead of a date range):
--   overtime_requests — one row per (employee, work_date, filed-instance). A NEW data-integrity rule
--     this migration adds (not spec-mandated, obviously correct): an employee cannot hold two
--     Pending/Approved overtime requests for the SAME work_date.
--   payroll_request_overtime(...) — payroll.manage (any employee in the branch) OR the linked
--     employee filing their own (zero-permission self-service, same idiom as P2PR1/P2PR2).
--   payroll_decide_overtime_request(p_request_id, p_approve, p_reason) — payroll.manage gated. Same
--     P2PR2 rule: blocks the request's own beneficiary from deciding it (self-approval denied), not a
--     literal requester-!=-decider check — a manager filing overtime for a DIFFERENT employee and then
--     approving it is normal single-manager HR work. Reject requires a reason.
--   list_overtime_requests(...) — dual access, identical shape to list_leave_requests: payroll.read
--     (+branch-member if a branch filter is given) sees broadly; otherwise the caller's own linked
--     employee_id is force-substituted server-side.
--   Audit: reuses the existing generic inventory_audit() trigger — no manual audit_events insert.
--
-- PERMISSION: reuses payroll.manage (file-on-behalf / decide) and payroll.read (broad list) — no new
-- permission key, no seed_standard_roles change (C1 §4).
--
-- Authority: 21.09 (spec). High-risk domain per CLAUDE.md's tripwire table (Financial integrity,
-- B2/C7 §4, Phase 4) — mitigated identically to P2PR1/P2PR2: this table and its RPCs never touch
-- payroll_disburse_wage, the ledger, or any journal entry; they track hours and a decision only.
-- Risk: Low.

create table public.overtime_requests (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  branch_id        uuid not null,
  employee_id      uuid not null,
  work_date        date not null,
  hours            numeric(5,2) not null check (hours > 0 and hours <= 24),
  reason           text,
  status           text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  requested_by     uuid not null references public.users (id) on delete restrict,
  decided_by       uuid references public.users (id) on delete restrict,
  decided_at       timestamptz,
  decision_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict,
  foreign key (employee_id, company_id) references public.employees (id, company_id) on delete restrict
);
comment on table public.overtime_requests is 'P2PR3: employee overtime-hours requests. Pending -> Approved/Rejected, decided by a payroll.manage holder who is not the request''s own beneficiary. Tracks HOURS only — no rate multiplier, holiday classification, or payroll amount is computed here (see migration header).';
create index overtime_requests_company_status_idx on public.overtime_requests (company_id, status, created_at);
create index overtime_requests_employee_idx on public.overtime_requests (company_id, employee_id, created_at);
create trigger overtime_requests_set_updated_at before update on public.overtime_requests
  for each row execute function public.set_updated_at();
create trigger overtime_requests_audit after insert or update on public.overtime_requests
  for each row execute function public.inventory_audit();

alter table public.overtime_requests enable row level security;
alter table public.overtime_requests force row level security;
revoke all on public.overtime_requests from public, anon, authenticated, service_role;
grant select on public.overtime_requests to authenticated;
create policy overtime_requests_select on public.overtime_requests as permissive for select to authenticated
  using (
    (public.has_permission(company_id, 'payroll.read') and public.is_branch_member(branch_id))
    or exists (
      select 1 from public.employees e
       where e.id = overtime_requests.employee_id and e.company_id = overtime_requests.company_id
         and e.user_id = public.current_app_user_id()
    )
  );
-- Writes are function-only (SECURITY DEFINER RPCs below). No direct insert/update/delete grant.

-- ════════════════════════════════════════════════════════════════════════════
-- payroll_request_overtime(...) — queue a Pending overtime request.
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_request_overtime(
  p_branch_id   uuid,
  p_employee_id uuid,
  p_work_date   date,
  p_hours       numeric,
  p_reason      text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_emp_company uuid; v_emp_user uuid; v_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  select e.company_id, e.user_id into v_emp_company, v_emp_user from public.employees e where e.id = p_employee_id;
  if v_emp_company is null or v_emp_company <> v_company then
    raise exception 'employee not found in this company' using errcode = 'foreign_key_violation';
  end if;
  if public.has_permission(v_company, 'payroll.manage') then
    if not public.is_branch_member(p_branch_id) then
      raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
    end if;
  elsif v_emp_user is null or v_emp_user <> v_actor then
    raise exception 'permission denied: payroll.manage' using errcode = 'insufficient_privilege';
  end if;
  if p_work_date is null then raise exception 'work date is required' using errcode = 'check_violation'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 24 then
    raise exception 'hours must be greater than 0 and at most 24' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.overtime_requests o
     where o.employee_id = p_employee_id and o.work_date = p_work_date and o.status in ('Pending', 'Approved')
  ) then
    raise exception 'an overtime request for this employee on this date already exists' using errcode = 'check_violation';
  end if;

  insert into public.overtime_requests (company_id, branch_id, employee_id, work_date, hours, reason, requested_by)
    values (v_company, p_branch_id, p_employee_id, p_work_date, p_hours, nullif(trim(coalesce(p_reason, '')), ''), v_actor)
    returning id into v_id;
  return v_id;
end; $$;
comment on function public.payroll_request_overtime(uuid, uuid, date, numeric, text) is 'P2PR3: file a Pending overtime-hours request. payroll.manage (any employee in the branch) OR the linked employee filing their own (zero-permission self-service). Denies a second Pending/Approved request for the same employee+work_date.';
revoke all on function public.payroll_request_overtime(uuid, uuid, date, numeric, text) from public, anon;
grant execute on function public.payroll_request_overtime(uuid, uuid, date, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- payroll_decide_overtime_request(...) — approve or reject a Pending request.
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_decide_overtime_request(p_request_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_employee_id uuid; v_is_self boolean;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'payroll.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: payroll.manage' using errcode = 'insufficient_privilege';
  end if;
  select o.employee_id into v_employee_id
    from public.overtime_requests o
   where o.id = p_request_id and o.status = 'Pending' and o.company_id = v_company
   for update of o;
  if not found then
    raise exception 'overtime request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  select exists (
    select 1 from public.employees e where e.id = v_employee_id and e.user_id = v_actor
  ) into v_is_self;
  if v_is_self then
    raise exception 'you cannot decide your own overtime request — ask another payroll manager' using errcode = 'insufficient_privilege';
  end if;
  if p_approve then
    update public.overtime_requests
      set status = 'Approved', decided_by = v_actor, decided_at = now(), decision_reason = nullif(trim(coalesce(p_reason, '')), '')
      where id = p_request_id;
  else
    if trim(coalesce(p_reason, '')) = '' then
      raise exception 'a reason is required to reject' using errcode = 'raise_exception';
    end if;
    update public.overtime_requests
      set status = 'Rejected', decided_by = v_actor, decided_at = now(), decision_reason = trim(p_reason)
      where id = p_request_id;
  end if;
end; $$;
comment on function public.payroll_decide_overtime_request(uuid, boolean, text) is 'P2PR3: approve or reject a Pending overtime request. payroll.manage required; the decider''s own linked employee record must not be the request''s beneficiary (self-approval denied). Rejecting requires a reason.';
revoke all on function public.payroll_decide_overtime_request(uuid, boolean, text) from public, anon;
grant execute on function public.payroll_decide_overtime_request(uuid, boolean, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- list_overtime_requests(...) — dual access read, same shape as list_leave_requests.
-- ════════════════════════════════════════════════════════════════════════════
create function public.list_overtime_requests(p_company uuid, p_branch_id uuid default null, p_employee_id uuid default null, p_status text default null)
returns table (
  id uuid, employee_id uuid, employee_name text, branch_id uuid, branch_name text,
  work_date date, hours numeric, reason text, status text,
  decided_by uuid, decider_name text, decision_reason text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid; v_has_read boolean; v_self_emp uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  v_has_read := public.has_permission(p_company, 'payroll.read');
  if v_has_read then
    if p_branch_id is not null and not public.is_branch_member(p_branch_id) then
      raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
    end if;
  else
    select e.id into v_self_emp from public.employees e where e.company_id = p_company and e.user_id = v_actor;
    if v_self_emp is null then
      raise exception 'permission denied: payroll.read' using errcode = 'insufficient_privilege';
    end if;
    p_employee_id := v_self_emp; -- force to the caller's own record regardless of what was passed in
  end if;

  return query
    select o.id, o.employee_id, e.name as employee_name, o.branch_id, br.name as branch_name,
           o.work_date, o.hours, o.reason, o.status,
           o.decided_by, du.display_name as decider_name, o.decision_reason, o.created_at
      from public.overtime_requests o
      join public.employees e on e.id = o.employee_id
      join public.branches br on br.id = o.branch_id
      left join public.users du on du.id = o.decided_by
     where o.company_id = p_company
       and (p_branch_id is null or o.branch_id = p_branch_id)
       and (p_employee_id is null or o.employee_id = p_employee_id)
       and (p_status is null or o.status = p_status)
     order by o.work_date desc, o.created_at desc;
end; $$;
comment on function public.list_overtime_requests(uuid, uuid, uuid, text) is 'P2PR3: read overtime requests. payroll.read (+ branch-member if p_branch_id given) sees broadly; otherwise the caller''s own linked employee_id is force-substituted server-side.';
revoke all on function public.list_overtime_requests(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.list_overtime_requests(uuid, uuid, uuid, text) to authenticated;
