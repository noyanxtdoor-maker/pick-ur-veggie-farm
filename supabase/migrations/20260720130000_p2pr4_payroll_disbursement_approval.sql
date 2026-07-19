-- Migration P2PR4 — Wage disbursement approval workflow (owner backlog item: "payroll build-out —
-- ...an approval workflow...", slice 4 of 6; slices 1-3 were P2PR1 attendance, P2PR2 leave, P2PR3
-- overtime).
--
-- CURRENT STATE: payroll_disburse_wage (P2-M5A, evolved by T3.3) is a one-shot RPC behind
-- payroll.manage — any single owner/co_owner/admin-with-override can hand out real cash
-- unilaterally, with no second person involved before money moves.
--
-- OWNER INTENT (matches the exact precedent already shipped for POS voids, P2N2, and product
-- removal, P1O): a wage disbursement should be a REQUEST, not a unilateral click. The Roster tab's
-- "Disburse Wage" button becomes "Request Disbursement" (still payroll.manage-gated — filing is not
-- opened to a lesser tier, unlike P1O/P2PO1's employee-tier request keys, because wage amounts are
-- sensitive payroll data, not a stock/removal request); a NEW "Disbursements" tab surfaces the
-- Pending queue (payroll.manage-gated) for a DIFFERENT payroll.manage holder to approve or reject.
--
-- AUTHORITY: docs/21_Human_Resources_Payroll_Architecture/21.13_Payroll_Approval_Workflow.md
-- describes a full BATCH payroll-run pipeline: HR prepares a payroll period -> system validates
-- (missing attendance, duplicate employees, excessive overtime, unauthorized deductions, duplicate
-- payroll periods) -> management reviews -> approves/rejects the WHOLE RUN -> payroll locks ->
-- payment is recorded. This app has no such concept anywhere — payroll_disburse_wage is, and
-- remains, a single ad-hoc per-employee disbursement (matches how a small farm actually pays daily-
-- wage crews: cash on the spot per work cycle, not a formal payroll run).
--
-- SCOPE NOTE (read before extending this): this migration ships ONLY a request/approve/reject layer
-- for the SINGLE existing money-moving action — separation of duties before cash moves, the concrete
-- thing "an approval workflow" asks for. It deliberately does NOT build:
--   (a) batch/period payroll runs with draft/locked states — no such state machine exists in this
--       app's data model at all;
--   (b) 21.13's specific automated validation checks (missing attendance, excessive overtime,
--       duplicate payroll periods) — P2PR1/P2PR3 now track attendance/overtime data that COULD feed
--       such checks, but "excessive" and "duplicate period" both require unstated business
--       thresholds this migration is not authorized to invent; a future pass can wire real
--       validation once those thresholds are decided with the owner.
-- The remaining two payroll sub-items (multiple payout methods, formatted payslips) remain
-- untouched and open.
--
-- DESIGN (mirrors P2N2's void-approval idiom exactly — the correct precedent here, not P2PR2/P2PR3's
-- "beneficiary decides" nuance, because the requester and the employee being paid are different
-- people; the real conflict-of-interest risk is the SAME payroll.manage holder both deciding to pay
-- and authorizing the payment):
--   wage_disbursement_requests — one row per requested disbursement. Pending -> Approved/Rejected.
--     Approving EXECUTES the disbursement atomically (no separate later "fulfill" step — unlike
--     P2PO1's purchase-order flow, a wage amount has no fulfillment variance: what was requested is
--     exactly what gets paid), linking the resulting wage_payments row via wage_payment_id.
--   payroll_request_disbursement(...) — payroll.manage + branch-member gated (same tier as direct
--     disbursement already required — filing is not opened to a lesser tier here, unlike P1O/P2PO1,
--     because wage amounts are sensitive payroll data). Same validation bounds as
--     payroll_disburse_wage (days>0, deduction>=0 and <= outstanding advance, bonus>=0, employee
--     Active) — re-validated again at approval time since the outstanding advance can shift between
--     request and decision.
--   payroll_approve_disbursement_request(p_request_id, p_notes) — payroll.manage + approver !=
--     requester (separation of duties). INLINES the exact same posting logic as
--     payroll_disburse_wage (Dr WAGES_EXPENSE / Cr CASH(net) / Cr EMPLOYEE_ADVANCES(deduction)) —
--     not a call to payroll_disburse_wage, for the same reason P2N2's approve_void_request inlines
--     its reversal: this SECURITY DEFINER function must record the APPROVER as the acting user on
--     every journal/audit row, and re-derive current state (rate, outstanding advance) fresh at
--     decision time rather than trusting anything computed at request time.
--   payroll_reject_disbursement_request(p_request_id, p_reason) — payroll.manage + approver !=
--     requester + reason required. No money moves.
--   list_pending_disbursement_requests() / list_disbursement_requests(...) — payroll.manage-gated
--     reads for the Disbursements tab's queue and history.
--   payroll_disburse_wage itself is UNCHANGED and its grant is NOT revoked (existing guard coverage
--     and any already-queued offline payloads keep working) — but the app UI no longer calls it
--     directly; "Request Disbursement" is now the only path a payroll.manage holder has in the app,
--     exactly mirroring how P2N2 left pos_void_sale in place while the POS UI switched fully to
--     "Request Void."
--
-- PERMISSION: reuses payroll.manage (request AND decide, both gates) — no new permission key
-- (C1 §4). Filing is intentionally NOT opened to payroll.read or any lesser tier.
--
-- Authority: 21.13 (spec, scoped as above). High-risk domain per CLAUDE.md's tripwire table
-- (Financial integrity, B2/C7 §4, Phase 4) — this IS the money-movement RPC itself (unlike P2PR1-3),
-- so the inlined posting logic must be kept in lockstep with payroll_disburse_wage by hand if that
-- function's math ever changes again (flagged in both functions' comments, same discipline P2N2
-- established for pos_void_sale/approve_void_request). Risk: Medium.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. wage_disbursement_requests table
-- ════════════════════════════════════════════════════════════════════════════
create table public.wage_disbursement_requests (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  branch_id        uuid not null,
  employee_id      uuid not null,
  pay_period       text not null,
  days_worked      numeric(8,3) not null check (days_worked > 0),
  ca_deduction     numeric(14,2) not null default 0 check (ca_deduction >= 0),
  bonus_amount     numeric(14,2) not null default 0 check (bonus_amount >= 0),
  notes            text,
  status           text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  requested_by     uuid not null references public.users (id) on delete restrict,
  decided_by       uuid references public.users (id) on delete restrict,
  decided_at       timestamptz,
  decision_reason  text,
  wage_payment_id  uuid references public.wage_payments (id) on delete restrict,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict,
  foreign key (employee_id, company_id) references public.employees (id, company_id) on delete restrict
);
comment on table public.wage_disbursement_requests is 'P2PR4: queued wage-disbursement requests. payroll.manage files; a DIFFERENT payroll.manage holder approves or rejects (separation of duties before cash moves). Approving executes the disbursement atomically and links wage_payment_id. payroll_disburse_wage itself is unchanged; this is the app''s only UI path to it now.';
create index wage_disbursement_requests_company_status_idx on public.wage_disbursement_requests (company_id, status, created_at);
create index wage_disbursement_requests_employee_idx on public.wage_disbursement_requests (company_id, employee_id, created_at);
create trigger wage_disbursement_requests_set_updated_at before update on public.wage_disbursement_requests
  for each row execute function public.set_updated_at();
create trigger wage_disbursement_requests_audit after insert or update on public.wage_disbursement_requests
  for each row execute function public.inventory_audit();

alter table public.wage_disbursement_requests enable row level security;
alter table public.wage_disbursement_requests force row level security;
revoke all on public.wage_disbursement_requests from public, anon, authenticated, service_role;
grant select on public.wage_disbursement_requests to authenticated;
create policy wage_disbursement_requests_read on public.wage_disbursement_requests as permissive for select to authenticated
  using (
    public.has_permission(company_id, 'payroll.manage')
    or requested_by = public.current_app_user_id()
  );
-- Writes are function-only (SECURITY DEFINER RPCs below). No direct insert/update/delete grant.

-- ════════════════════════════════════════════════════════════════════════════
-- 2. payroll_request_disbursement(...) — file a Pending disbursement request.
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_request_disbursement(
  p_branch_id    uuid,
  p_employee_id  uuid,
  p_pay_period   text,
  p_days_worked  numeric,
  p_ca_deduction numeric,
  p_notes        text default null,
  p_bonus_amount numeric default 0
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_status text; v_ded numeric; v_bonus numeric; v_outstanding numeric; v_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'payroll.manage') then
    raise exception 'permission denied: payroll.manage' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_days_worked is null or p_days_worked <= 0 then raise exception 'days worked must be > 0' using errcode = 'check_violation'; end if;
  v_ded := round(coalesce(p_ca_deduction, 0), 2);
  if v_ded < 0 then raise exception 'deduction must be >= 0' using errcode = 'check_violation'; end if;
  v_bonus := round(coalesce(p_bonus_amount, 0), 2);
  if v_bonus < 0 then raise exception 'bonus must be >= 0' using errcode = 'check_violation'; end if;

  select status into v_status from public.employees where id = p_employee_id and company_id = v_company;
  if v_status is null then raise exception 'unknown employee' using errcode = 'foreign_key_violation'; end if;
  if v_status <> 'Active' then raise exception 'employee is not active' using errcode = 'check_violation'; end if;

  v_outstanding := public.employee_advance_balance(p_employee_id);
  if v_ded > v_outstanding then raise exception 'deduction exceeds outstanding advance (%.2f)', v_outstanding using errcode = 'check_violation'; end if;

  insert into public.wage_disbursement_requests (company_id, branch_id, employee_id, pay_period, days_worked, ca_deduction, bonus_amount, notes, requested_by)
    values (v_company, p_branch_id, p_employee_id, coalesce(nullif(trim(p_pay_period), ''), 'Cycle'), p_days_worked, v_ded, v_bonus, nullif(trim(coalesce(p_notes, '')), ''), v_actor)
    returning id into v_id;
  return v_id;
end; $$;
comment on function public.payroll_request_disbursement(uuid, uuid, text, numeric, numeric, text, numeric) is 'P2PR4: file a Pending wage-disbursement request. payroll.manage + branch-member required (not opened to a lesser tier — payroll data is sensitive). Validated against the same bounds as payroll_disburse_wage; re-validated again at approval time.';
revoke all on function public.payroll_request_disbursement(uuid, uuid, text, numeric, numeric, text, numeric) from public, anon;
grant execute on function public.payroll_request_disbursement(uuid, uuid, text, numeric, numeric, text, numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. payroll_approve_disbursement_request(...) — execute the disbursement.
--    payroll.manage + approver != requester. Inlines payroll_disburse_wage's exact posting logic
--    (kept in lockstep by hand if that function's math ever changes again — same discipline P2N2
--    established for pos_void_sale/approve_void_request).
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_approve_disbursement_request(p_request_id uuid, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_branch uuid; v_employee uuid; v_requested_by uuid;
  v_pay_period text; v_days numeric; v_ded numeric; v_bonus numeric; v_req_notes text;
  v_status text; v_rate numeric; v_gross numeric; v_net numeric; v_outstanding numeric;
  v_wage uuid; v_entry uuid; a_wages uuid; a_cash uuid; a_adv uuid;
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
  select wdr.branch_id, wdr.employee_id, wdr.requested_by, wdr.pay_period, wdr.days_worked, wdr.ca_deduction, wdr.bonus_amount, wdr.notes
    into v_branch, v_employee, v_requested_by, v_pay_period, v_days, v_ded, v_bonus, v_req_notes
    from public.wage_disbursement_requests wdr
   where wdr.id = p_request_id and wdr.status = 'Pending' and wdr.company_id = v_company
   for update of wdr;
  if not found then
    raise exception 'disbursement request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  if v_actor = v_requested_by then
    raise exception 'you cannot approve your own disbursement request — ask another payroll manager' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(v_branch) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;

  -- re-derive current state at decision time — never trust what was true when the request was filed.
  select status, daily_rate into v_status, v_rate from public.employees where id = v_employee and company_id = v_company;
  if v_status is null or v_status <> 'Active' then
    raise exception 'employee is not active' using errcode = 'check_violation';
  end if;
  v_gross := round(v_days * v_rate, 2) + v_bonus;
  if v_ded > v_gross then raise exception 'deduction exceeds gross wage' using errcode = 'check_violation'; end if;
  v_outstanding := public.employee_advance_balance(v_employee);
  if v_ded > v_outstanding then raise exception 'deduction exceeds outstanding advance (%.2f)', v_outstanding using errcode = 'check_violation'; end if;
  v_net := round(v_gross - v_ded, 2);

  perform public.payroll_ensure_accounts(v_company);
  select id into a_wages from public.chart_of_accounts where company_id = v_company and account_code = 'WAGES_EXPENSE';
  select id into a_cash  from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  select id into a_adv   from public.chart_of_accounts where company_id = v_company and account_code = 'EMPLOYEE_ADVANCES';
  v_wage := public.uuidv7();
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'WagePayment', v_wage, 'Wage disbursement (approved): ' || v_pay_period, v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_wages, v_gross, 0),
    (v_company, v_entry, a_cash, 0, v_net);
  if v_ded > 0 then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_adv, 0, v_ded);
  end if;
  insert into public.wage_payments (id, company_id, branch_id, employee_id, pay_period, days_worked, daily_rate, gross, ca_deducted, net, bonus_amount, notes, journal_entry_id, idempotency_key, created_by)
    values (v_wage, v_company, v_branch, v_employee, v_pay_period, v_days, v_rate, v_gross, v_ded, v_net, v_bonus, v_req_notes, v_entry, 'p2pr4:' || p_request_id::text, v_actor);
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_branch, v_actor, 'Business', 'payroll.wage_disbursed', 'payroll', 'wage_payments', v_wage);

  update public.wage_disbursement_requests
    set status = 'Approved', decided_by = v_actor, decided_at = now(), decision_reason = nullif(trim(coalesce(p_notes, '')), ''), wage_payment_id = v_wage
    where id = p_request_id;
  return v_wage;
end; $$;
comment on function public.payroll_approve_disbursement_request(uuid, text) is 'P2PR4: approve a Pending disbursement request. payroll.manage + approver != requester (separation of duties). Executes the disbursement atomically — inlines payroll_disburse_wage''s exact posting logic (Dr Wages Expense/Cr Cash(net)/Cr Employee Advances(deduction)), re-validating employee status and outstanding advance fresh at decision time. Returns the new wage_payments id.';
revoke all on function public.payroll_approve_disbursement_request(uuid, text) from public, anon;
grant execute on function public.payroll_approve_disbursement_request(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. payroll_reject_disbursement_request(...) — reason required, no money moves.
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_reject_disbursement_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_requested_by uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'a rejection reason is required' using errcode = 'check_violation';
  end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'payroll.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: payroll.manage' using errcode = 'insufficient_privilege';
  end if;
  select wdr.requested_by into v_requested_by
    from public.wage_disbursement_requests wdr
   where wdr.id = p_request_id and wdr.status = 'Pending' and wdr.company_id = v_company
   for update of wdr;
  if not found then
    raise exception 'disbursement request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  if v_actor = v_requested_by then
    raise exception 'you cannot reject your own disbursement request — ask another payroll manager' using errcode = 'insufficient_privilege';
  end if;
  update public.wage_disbursement_requests
    set status = 'Rejected', decided_by = v_actor, decided_at = now(), decision_reason = trim(p_reason)
    where id = p_request_id;
end; $$;
comment on function public.payroll_reject_disbursement_request(uuid, text) is 'P2PR4: reject a Pending disbursement request. payroll.manage + approver != requester + reason required. No money moves.';
revoke all on function public.payroll_reject_disbursement_request(uuid, text) from public, anon;
grant execute on function public.payroll_reject_disbursement_request(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. list_pending_disbursement_requests() / list_disbursement_requests(...) — payroll.manage reads.
-- ════════════════════════════════════════════════════════════════════════════
create function public.list_pending_disbursement_requests()
returns table (
  id uuid, branch_id uuid, branch_name text, employee_id uuid, employee_name text,
  pay_period text, days_worked numeric, ca_deduction numeric, bonus_amount numeric, notes text,
  requested_by uuid, requester_name text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid;
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
  return query
    select wdr.id, wdr.branch_id, br.name as branch_name, wdr.employee_id, e.name as employee_name,
           wdr.pay_period, wdr.days_worked, wdr.ca_deduction, wdr.bonus_amount, wdr.notes,
           wdr.requested_by, ru.display_name as requester_name, wdr.created_at
      from public.wage_disbursement_requests wdr
      join public.branches br on br.id = wdr.branch_id
      join public.employees e on e.id = wdr.employee_id
      join public.users ru on ru.id = wdr.requested_by
     where wdr.company_id = v_company and wdr.status = 'Pending'
     order by wdr.created_at;
end; $$;
comment on function public.list_pending_disbursement_requests() is 'P2PR4: returns the Pending wage-disbursement-request queue for the actor''s company. payroll.manage-gated.';
revoke all on function public.list_pending_disbursement_requests() from public, anon;
grant execute on function public.list_pending_disbursement_requests() to authenticated;

create function public.list_disbursement_requests(p_company uuid, p_branch_id uuid default null, p_status text default null)
returns table (
  id uuid, branch_id uuid, branch_name text, employee_id uuid, employee_name text,
  pay_period text, days_worked numeric, ca_deduction numeric, bonus_amount numeric, notes text,
  status text, requested_by uuid, requester_name text,
  decided_by uuid, decider_name text, decision_reason text, wage_payment_id uuid, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company, 'payroll.manage') then
    raise exception 'permission denied: payroll.manage' using errcode = 'insufficient_privilege';
  end if;
  if p_branch_id is not null and not public.is_branch_member(p_branch_id) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;
  return query
    select wdr.id, wdr.branch_id, br.name as branch_name, wdr.employee_id, e.name as employee_name,
           wdr.pay_period, wdr.days_worked, wdr.ca_deduction, wdr.bonus_amount, wdr.notes, wdr.status,
           wdr.requested_by, ru.display_name as requester_name,
           wdr.decided_by, du.display_name as decider_name, wdr.decision_reason, wdr.wage_payment_id, wdr.created_at
      from public.wage_disbursement_requests wdr
      join public.branches br on br.id = wdr.branch_id
      join public.employees e on e.id = wdr.employee_id
      join public.users ru on ru.id = wdr.requested_by
      left join public.users du on du.id = wdr.decided_by
     where wdr.company_id = p_company
       and (p_branch_id is null or wdr.branch_id = p_branch_id)
       and (p_status is null or wdr.status = p_status)
     order by wdr.created_at desc;
end; $$;
comment on function public.list_disbursement_requests(uuid, uuid, text) is 'P2PR4: read disbursement requests (any status, optionally filtered by branch/status). payroll.manage-gated — this is manager-only payroll data, no self-view (unlike P2PR2/P2PR3, the requester and the paid employee are different people).';
revoke all on function public.list_disbursement_requests(uuid, uuid, text) from public, anon;
grant execute on function public.list_disbursement_requests(uuid, uuid, text) to authenticated;
