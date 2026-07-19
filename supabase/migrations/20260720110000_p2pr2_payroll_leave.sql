-- Migration P2PR2 — Payroll leave/absence request tracking (owner backlog item: "payroll build-out
-- — ...leave...", slice 2 of 6; slice 1 was P2PR1 attendance/shift tracking).
--
-- AUTHORITY: docs/21_Human_Resources_Payroll_Architecture/21.08_Leave_and_Absence_Management.md
-- describes the full enterprise leave system: named leave types, a request workflow (employee
-- submits -> supervisor reviews -> approved/rejected), automatic calendar/schedule blocking for
-- approved leave, absence categorization (approved/unexcused/sick/late/early-departure), and a
-- payroll connection that determines paid-leave compensation vs. unpaid deductions.
--
-- SCOPE NOTE (read before extending this): this migration ships ONLY the request/decide workflow —
-- leave type, date range, reason, Pending -> Approved/Rejected. It deliberately does NOT build:
--   (a) calendar/scheduling integration (21.08's "the scheduling system prevents assigning Juan to
--       farm tasks during this period") — the Scheduling module (P2M6*) has its own independent
--       shift-assignment model; wiring approved leave into it is a real cross-module feature, not a
--       one-line add, and stays open backlog;
--   (b) supporting-document uploads — this app has no file-storage/attachment infrastructure proven
--       anywhere yet; adding one just for this would be new complexity without a present need (C1 §4);
--   (c) the payroll connection (21.08: "Leave records determine paid leave compensation / unpaid
--       deductions") — payroll_disburse_wage's math is completely untouched here, same non-decision
--       already recorded in P2PR1's header for attendance: wiring this in needs a real answer to how
--       wage_payments' free-text pay_period maps to a date range, which is a separate design question.
-- The other four payroll sub-items (overtime, an approval workflow for disbursements, multiple payout
-- methods, formatted payslips) remain untouched and open, same as stated in P2PR1.
--
-- DESIGN (reuses the exact request/decide idiom already proven this session by P1O/P2N2/P2PO1, and
-- the exact table/RLS/audit shape P2PR1 just proved for attendance_records):
--   leave_requests — one row per request. leave_type is one of 21.08's named examples (Vacation,
--     Sick, Emergency, Maternity, Paternity, Unpaid, Other). Status Pending -> Approved/Rejected.
--     A NEW check this migration adds beyond 21.08's own text (a real, scope-appropriate data-
--     integrity rule, not spec-mandated but obviously correct): an employee cannot have two
--     Pending/Approved requests with overlapping date ranges.
--   payroll_request_leave(...) — payroll.manage (filing on behalf of any employee in the branch) OR
--     the linked employee filing their own (zero-permission self-service, matching list_attendance's
--     self-view idiom exactly — no new permission key needed).
--   payroll_decide_leave_request(p_request_id, p_approve, p_reason) — payroll.manage gated. Unlike
--     P1O/P2N2/P2PO1's "decider != requester" rule (which defends against the REQUESTER gaming their
--     own filed request), the real conflict here is the BENEFICIARY deciding their own leave — a
--     manager filing leave on a *different* employee's behalf and then approving it is completely
--     normal single-manager HR admin work and would be wrongly blocked by a literal requester-!=-
--     decider check. So this checks decider's own linked employee_id != the request's employee_id
--     instead — blocks "I approve my own leave," allows "I file and approve someone else's leave."
--     Reject requires a reason (matches the established reject-needs-reason idiom).
--   list_leave_requests(...) — dual access, same shape as list_attendance: payroll.read (+ branch-
--     member if a branch filter is given) sees broadly; otherwise the caller's own linked employee_id
--     is force-substituted server-side (never trusts a client-supplied p_employee_id for a non-
--     manager caller) so a plain worker can only ever see their own requests.
--   Audit: reuses the existing generic inventory_audit() trigger (same as P2PR1) — no manual
--     audit_events insert needed in either RPC.
--
-- PERMISSION: reuses payroll.manage (file-on-behalf / decide) and payroll.read (broad list) — no new
-- permission key, no seed_standard_roles change (C1 §4).
--
-- Authority: 21.08 (spec). High-risk domain per CLAUDE.md's tripwire table (Financial integrity,
-- B2/C7 §4, Phase 4) — mitigated the same way P2PR1 was: this table and its RPCs never touch
-- payroll_disburse_wage, the ledger, or any journal entry. Risk: Low.

create table public.leave_requests (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  branch_id        uuid not null,
  employee_id      uuid not null,
  leave_type       text not null check (leave_type in ('Vacation', 'Sick', 'Emergency', 'Maternity', 'Paternity', 'Unpaid', 'Other')),
  start_date       date not null,
  end_date         date not null,
  reason           text,
  status           text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  requested_by     uuid not null references public.users (id) on delete restrict,
  decided_by       uuid references public.users (id) on delete restrict,
  decided_at       timestamptz,
  decision_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict,
  foreign key (employee_id, company_id) references public.employees (id, company_id) on delete restrict,
  constraint leave_requests_date_order check (end_date >= start_date)
);
comment on table public.leave_requests is 'P2PR2: employee leave/absence requests. leave_type per 21.08''s named examples. Pending -> Approved/Rejected, decided by a payroll.manage holder who is not the leave''s own beneficiary. Does NOT block scheduling, does NOT feed payroll deduction math (see migration header).';
create index leave_requests_company_status_idx on public.leave_requests (company_id, status, created_at);
create index leave_requests_employee_idx on public.leave_requests (company_id, employee_id, created_at);
create trigger leave_requests_set_updated_at before update on public.leave_requests
  for each row execute function public.set_updated_at();
create trigger leave_requests_audit after insert or update on public.leave_requests
  for each row execute function public.inventory_audit();

alter table public.leave_requests enable row level security;
alter table public.leave_requests force row level security;
revoke all on public.leave_requests from public, anon, authenticated, service_role;
grant select on public.leave_requests to authenticated;
create policy leave_requests_select on public.leave_requests as permissive for select to authenticated
  using (
    (public.has_permission(company_id, 'payroll.read') and public.is_branch_member(branch_id))
    or exists (
      select 1 from public.employees e
       where e.id = leave_requests.employee_id and e.company_id = leave_requests.company_id
         and e.user_id = public.current_app_user_id()
    )
  );
-- Writes are function-only (SECURITY DEFINER RPCs below). No direct insert/update/delete grant.

-- ════════════════════════════════════════════════════════════════════════════
-- payroll_request_leave(...) — queue a Pending leave request.
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_request_leave(
  p_branch_id   uuid,
  p_employee_id uuid,
  p_leave_type  text,
  p_start_date  date,
  p_end_date    date,
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
  if p_leave_type not in ('Vacation', 'Sick', 'Emergency', 'Maternity', 'Paternity', 'Unpaid', 'Other') then
    raise exception 'invalid leave type' using errcode = 'check_violation';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'start and end date are required' using errcode = 'check_violation';
  end if;
  if p_end_date < p_start_date then
    raise exception 'end date cannot be before start date' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.leave_requests lr
     where lr.employee_id = p_employee_id and lr.status in ('Pending', 'Approved')
       and lr.start_date <= p_end_date and lr.end_date >= p_start_date
  ) then
    raise exception 'an overlapping leave request already exists for this employee' using errcode = 'check_violation';
  end if;

  insert into public.leave_requests (company_id, branch_id, employee_id, leave_type, start_date, end_date, reason, requested_by)
    values (v_company, p_branch_id, p_employee_id, p_leave_type, p_start_date, p_end_date, nullif(trim(coalesce(p_reason, '')), ''), v_actor)
    returning id into v_id;
  return v_id;
end; $$;
comment on function public.payroll_request_leave(uuid, uuid, text, date, date, text) is 'P2PR2: file a Pending leave request. payroll.manage (any employee in the branch) OR the linked employee filing their own (zero-permission self-service). Denies overlapping Pending/Approved requests for the same employee.';
revoke all on function public.payroll_request_leave(uuid, uuid, text, date, date, text) from public, anon;
grant execute on function public.payroll_request_leave(uuid, uuid, text, date, date, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- payroll_decide_leave_request(...) — approve or reject a Pending request.
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_decide_leave_request(p_request_id uuid, p_approve boolean, p_reason text default null)
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
  select lr.employee_id into v_employee_id
    from public.leave_requests lr
   where lr.id = p_request_id and lr.status = 'Pending' and lr.company_id = v_company
   for update of lr;
  if not found then
    raise exception 'leave request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  select exists (
    select 1 from public.employees e where e.id = v_employee_id and e.user_id = v_actor
  ) into v_is_self;
  if v_is_self then
    raise exception 'you cannot decide your own leave request — ask another payroll manager' using errcode = 'insufficient_privilege';
  end if;
  if p_approve then
    update public.leave_requests
      set status = 'Approved', decided_by = v_actor, decided_at = now(), decision_reason = nullif(trim(coalesce(p_reason, '')), '')
      where id = p_request_id;
  else
    if trim(coalesce(p_reason, '')) = '' then
      raise exception 'a reason is required to reject' using errcode = 'raise_exception';
    end if;
    update public.leave_requests
      set status = 'Rejected', decided_by = v_actor, decided_at = now(), decision_reason = trim(p_reason)
      where id = p_request_id;
  end if;
end; $$;
comment on function public.payroll_decide_leave_request(uuid, boolean, text) is 'P2PR2: approve or reject a Pending leave request. payroll.manage required; the decider''s own linked employee record must not be the request''s beneficiary (self-approval denied). Rejecting requires a reason.';
revoke all on function public.payroll_decide_leave_request(uuid, boolean, text) from public, anon;
grant execute on function public.payroll_decide_leave_request(uuid, boolean, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- list_leave_requests(...) — dual access read, same shape as list_attendance.
-- ════════════════════════════════════════════════════════════════════════════
create function public.list_leave_requests(p_company uuid, p_branch_id uuid default null, p_employee_id uuid default null, p_status text default null)
returns table (
  id uuid, employee_id uuid, employee_name text, branch_id uuid, branch_name text,
  leave_type text, start_date date, end_date date, reason text, status text,
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
    select lr.id, lr.employee_id, e.name as employee_name, lr.branch_id, br.name as branch_name,
           lr.leave_type, lr.start_date, lr.end_date, lr.reason, lr.status,
           lr.decided_by, du.display_name as decider_name, lr.decision_reason, lr.created_at
      from public.leave_requests lr
      join public.employees e on e.id = lr.employee_id
      join public.branches br on br.id = lr.branch_id
      left join public.users du on du.id = lr.decided_by
     where lr.company_id = p_company
       and (p_branch_id is null or lr.branch_id = p_branch_id)
       and (p_employee_id is null or lr.employee_id = p_employee_id)
       and (p_status is null or lr.status = p_status)
     order by lr.created_at desc;
end; $$;
comment on function public.list_leave_requests(uuid, uuid, uuid, text) is 'P2PR2: read leave requests. payroll.read (+ branch-member if p_branch_id given) sees broadly; otherwise the caller''s own linked employee_id is force-substituted server-side — never trusts a client-supplied p_employee_id for a non-manager caller.';
revoke all on function public.list_leave_requests(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.list_leave_requests(uuid, uuid, uuid, text) to authenticated;
