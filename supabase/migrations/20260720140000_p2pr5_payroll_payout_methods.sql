-- Migration P2PR5 — Multiple payout methods for wage disbursement (owner backlog item: "payroll
-- build-out — ...multiple payout methods...", slice 5 of 6; slice 4, P2PR4, added the request/
-- approve separation-of-duties layer this migration now extends).
--
-- CURRENT STATE: every payroll disbursement (both the legacy direct `payroll_disburse_wage` and
-- P2PR4's request/approve flow) always credits the hardcoded CASH account — there is no way to pay
-- a worker via GCash, a bank transfer, or any other digital account, even though this exact
-- capability (`financial_accounts`, `finance_resolve_pay_code`) has existed since P2-B2A and is
-- already used by POS sales, settlements, and void reversals.
--
-- SCOPE NOTE: this migration extends ONLY the P2PR4 request/approve path with an optional payout
-- account — the legacy `payroll_disburse_wage` stays CASH-only and unchanged (same "old function
-- kept in place, new capability lives in the new path" precedent P2N2 established for
-- `pos_void_sale`). It reuses the EXISTING `finance_resolve_pay_code()` helper (P2-B2A) rather than
-- inventing new account-resolution logic — the identical function POS already uses for
-- `pos_record_sale`/`pos_settle_sale`/`approve_void_request`.
--
-- DESIGN:
--   wage_disbursement_requests.financial_account_id (nullable; null = cash drawer, mirroring
--     invoices.financial_account_id's own convention) — set at file time, RE-RESOLVED (not trusted)
--     at approval time via finance_resolve_pay_code(), so an account archived between request and
--     decision is caught fresh, same "never trust file-time state at decision time" discipline
--     P2PR4 already established for the outstanding-advance check.
--   wage_payments.financial_account_id (nullable) — mirrors invoices.financial_account_id so the
--     paid record itself shows which account the money left from; feeds the (still-open) formatted-
--     payslip sub-item.
--   payroll_request_disbursement(...) gains p_financial_account_id uuid default null (8th arg,
--     appended last — old 7-arg call sites, including this session's own guard fixtures, keep
--     resolving; the argument-count change means the old overload must be DROPPED first, the same
--     lesson learned repeatedly this session for inventory_record_purchase).
--   payroll_approve_disbursement_request(...) signature is UNCHANGED (the account was already
--     chosen at file time, stored on the request) — its posting logic now resolves and credits
--     whichever account finance_resolve_pay_code() returns instead of a hardcoded CASH lookup.
--   list_pending_disbursement_requests()/list_disbursement_requests(...) now also return
--     financial_account_id + a joined account_name/provider for the Disbursements tab's display.
--
-- IN-SCOPE BYPRODUCT FIX (not scope creep — this migration is already rewriting the exact posting
-- block below for account-routing): P2PR4's payroll_approve_disbursement_request had the same
-- net=0-crashes-on-journal-check-constraint bug flagged for payroll_disburse_wage itself (a
-- disbursement whose deduction exactly equals gross posts a Cash line with debit=0 AND credit=0,
-- which the journal_lines check constraint rejects). Fixed here by guarding the Cash/pay-account
-- line the same way the Employee Advances line already was (`if v_net > 0 then ... end if;`).
-- payroll_disburse_wage itself is untouched and still has this bug — remains its own flagged task.
--
-- PERMISSION: no change — still payroll.manage (request) / a different payroll.manage holder
-- (decide). No new permission key (C1 §4).
--
-- Authority: owner backlog item "payroll build-out — multiple payout methods"; reuses P2-B2A's own
-- architecture wholesale rather than reinventing it. High-risk domain (Financial integrity, B2/C7
-- §4) — mitigated by reusing the exact, already-guard-proven finance_resolve_pay_code() helper
-- rather than new account-validation logic. Risk: Medium (still a money-movement RPC).

alter table public.wage_disbursement_requests add column financial_account_id uuid;
alter table public.wage_disbursement_requests
  add constraint wage_disbursement_requests_financial_account_fkey
  foreign key (financial_account_id, company_id) references public.financial_accounts (id, company_id) on delete restrict;
comment on column public.wage_disbursement_requests.financial_account_id is 'P2PR5: the payout account chosen at file time (null = cash drawer). Re-resolved fresh via finance_resolve_pay_code() at approval time, never trusted from file time.';

alter table public.wage_payments add column financial_account_id uuid;
alter table public.wage_payments
  add constraint wage_payments_financial_account_fkey
  foreign key (financial_account_id, company_id) references public.financial_accounts (id, company_id) on delete restrict;
comment on column public.wage_payments.financial_account_id is 'P2PR5: the account this wage was actually paid from (null = cash drawer), mirroring invoices.financial_account_id''s own convention.';

-- ════════════════════════════════════════════════════════════════════════════
-- payroll_request_disbursement(...) — evolved: p_financial_account_id appended last (8th arg).
-- Argument count changed, so the old 7-arg overload must be dropped first.
-- ════════════════════════════════════════════════════════════════════════════
drop function public.payroll_request_disbursement(uuid, uuid, text, numeric, numeric, text, numeric);
create function public.payroll_request_disbursement(
  p_branch_id             uuid,
  p_employee_id           uuid,
  p_pay_period            text,
  p_days_worked           numeric,
  p_ca_deduction          numeric,
  p_notes                 text default null,
  p_bonus_amount          numeric default 0,
  p_financial_account_id  uuid default null
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

  -- Validate the payout account up front (company/branch/Active) so a bad choice fails at file time,
  -- not silently at approval time. finance_resolve_pay_code raises on its own if invalid; we only
  -- need its side-effect validation here, not the returned code (approval re-resolves it fresh).
  perform public.finance_resolve_pay_code(v_company, p_branch_id, p_financial_account_id);

  insert into public.wage_disbursement_requests (company_id, branch_id, employee_id, pay_period, days_worked, ca_deduction, bonus_amount, notes, requested_by, financial_account_id)
    values (v_company, p_branch_id, p_employee_id, coalesce(nullif(trim(p_pay_period), ''), 'Cycle'), p_days_worked, v_ded, v_bonus, nullif(trim(coalesce(p_notes, '')), ''), v_actor, p_financial_account_id)
    returning id into v_id;
  return v_id;
end; $$;
comment on function public.payroll_request_disbursement(uuid, uuid, text, numeric, numeric, text, numeric, uuid) is 'P2PR5: file a Pending wage-disbursement request, optionally naming a payout account (null = cash drawer). Validated via the same finance_resolve_pay_code() helper POS uses; re-validated fresh at approval time.';
revoke all on function public.payroll_request_disbursement(uuid, uuid, text, numeric, numeric, text, numeric, uuid) from public, anon;
grant execute on function public.payroll_request_disbursement(uuid, uuid, text, numeric, numeric, text, numeric, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- payroll_approve_disbursement_request(...) — SAME signature; posting logic now routes to whichever
-- account the request named (re-resolved fresh, not trusted from file time), and the Cash/pay-
-- account journal line is now guarded against net=0 the same way the Employee Advances line already
-- was (in-scope byproduct fix, see migration header).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.payroll_approve_disbursement_request(p_request_id uuid, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_branch uuid; v_employee uuid; v_requested_by uuid;
  v_pay_period text; v_days numeric; v_ded numeric; v_bonus numeric; v_req_notes text; v_fa uuid;
  v_status text; v_rate numeric; v_gross numeric; v_net numeric; v_outstanding numeric; v_pay_code text;
  v_wage uuid; v_entry uuid; a_wages uuid; a_pay uuid; a_adv uuid;
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
  select wdr.branch_id, wdr.employee_id, wdr.requested_by, wdr.pay_period, wdr.days_worked, wdr.ca_deduction, wdr.bonus_amount, wdr.notes, wdr.financial_account_id
    into v_branch, v_employee, v_requested_by, v_pay_period, v_days, v_ded, v_bonus, v_req_notes, v_fa
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
  -- re-resolve the payout account fresh — it may have been archived since the request was filed.
  v_pay_code := public.finance_resolve_pay_code(v_company, v_branch, v_fa);

  perform public.payroll_ensure_accounts(v_company);
  select id into a_wages from public.chart_of_accounts where company_id = v_company and account_code = 'WAGES_EXPENSE';
  select id into a_pay   from public.chart_of_accounts where company_id = v_company and account_code = v_pay_code;
  select id into a_adv   from public.chart_of_accounts where company_id = v_company and account_code = 'EMPLOYEE_ADVANCES';
  v_wage := public.uuidv7();
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'WagePayment', v_wage, 'Wage disbursement (approved): ' || v_pay_period, v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_wages, v_gross, 0);
  if v_net > 0 then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_pay, 0, v_net);
  end if;
  if v_ded > 0 then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_adv, 0, v_ded);
  end if;
  insert into public.wage_payments (id, company_id, branch_id, employee_id, pay_period, days_worked, daily_rate, gross, ca_deducted, net, bonus_amount, notes, journal_entry_id, idempotency_key, created_by, financial_account_id)
    values (v_wage, v_company, v_branch, v_employee, v_pay_period, v_days, v_rate, v_gross, v_ded, v_net, v_bonus, v_req_notes, v_entry, 'p2pr4:' || p_request_id::text, v_actor, v_fa);
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_branch, v_actor, 'Business', 'payroll.wage_disbursed', 'payroll', 'wage_payments', v_wage);

  update public.wage_disbursement_requests
    set status = 'Approved', decided_by = v_actor, decided_at = now(), decision_reason = nullif(trim(coalesce(p_notes, '')), ''), wage_payment_id = v_wage
    where id = p_request_id;
  return v_wage;
end; $$;
comment on function public.payroll_approve_disbursement_request(uuid, text) is 'P2PR5: approve a Pending disbursement request. payroll.manage + approver != requester. Credits whichever payout account the request named (re-resolved fresh via finance_resolve_pay_code, null = cash drawer) instead of a hardcoded CASH lookup. Skips the pay-account journal line entirely when net=0 (the whole wage went to advance repayment) rather than posting an invalid zero/zero line.';
revoke all on function public.payroll_approve_disbursement_request(uuid, text) from public, anon;
grant execute on function public.payroll_approve_disbursement_request(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- list_pending_disbursement_requests() / list_disbursement_requests(...) — now also return the
-- payout account's id/name/provider for display.
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.list_pending_disbursement_requests();
create function public.list_pending_disbursement_requests()
returns table (
  id uuid, branch_id uuid, branch_name text, employee_id uuid, employee_name text,
  pay_period text, days_worked numeric, ca_deduction numeric, bonus_amount numeric, notes text,
  requested_by uuid, requester_name text, created_at timestamptz,
  financial_account_id uuid, account_name text, account_provider text
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
           wdr.requested_by, ru.display_name as requester_name, wdr.created_at,
           wdr.financial_account_id, fa.name as account_name, fa.provider as account_provider
      from public.wage_disbursement_requests wdr
      join public.branches br on br.id = wdr.branch_id
      join public.employees e on e.id = wdr.employee_id
      join public.users ru on ru.id = wdr.requested_by
      left join public.financial_accounts fa on fa.id = wdr.financial_account_id
     where wdr.company_id = v_company and wdr.status = 'Pending'
     order by wdr.created_at;
end; $$;
comment on function public.list_pending_disbursement_requests() is 'P2PR5: returns the Pending wage-disbursement-request queue, including the named payout account (null = cash drawer). payroll.manage-gated.';
revoke all on function public.list_pending_disbursement_requests() from public, anon;
grant execute on function public.list_pending_disbursement_requests() to authenticated;

drop function if exists public.list_disbursement_requests(uuid, uuid, text);
create function public.list_disbursement_requests(p_company uuid, p_branch_id uuid default null, p_status text default null)
returns table (
  id uuid, branch_id uuid, branch_name text, employee_id uuid, employee_name text,
  pay_period text, days_worked numeric, ca_deduction numeric, bonus_amount numeric, notes text,
  status text, requested_by uuid, requester_name text,
  decided_by uuid, decider_name text, decision_reason text, wage_payment_id uuid, created_at timestamptz,
  financial_account_id uuid, account_name text, account_provider text
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
           wdr.decided_by, du.display_name as decider_name, wdr.decision_reason, wdr.wage_payment_id, wdr.created_at,
           wdr.financial_account_id, fa.name as account_name, fa.provider as account_provider
      from public.wage_disbursement_requests wdr
      join public.branches br on br.id = wdr.branch_id
      join public.employees e on e.id = wdr.employee_id
      join public.users ru on ru.id = wdr.requested_by
      left join public.users du on du.id = wdr.decided_by
      left join public.financial_accounts fa on fa.id = wdr.financial_account_id
     where wdr.company_id = p_company
       and (p_branch_id is null or wdr.branch_id = p_branch_id)
       and (p_status is null or wdr.status = p_status)
     order by wdr.created_at desc;
end; $$;
comment on function public.list_disbursement_requests(uuid, uuid, text) is 'P2PR5: read disbursement requests (any status, optionally filtered), including the named payout account. payroll.manage-gated.';
revoke all on function public.list_disbursement_requests(uuid, uuid, text) from public, anon;
grant execute on function public.list_disbursement_requests(uuid, uuid, text) to authenticated;
