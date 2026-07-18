-- Migration T3.3 (2026-07-19) — Payroll: optional bonus/incentive on Disburse Wage.
-- Not in Team B's build — small, additive design following the exact evolution pattern T3.2 proved:
-- append a defaulted arg to a governed RPC, old positional call sites (guards, offline-queued client
-- payloads already in flight) keep working unchanged.
-- Authority: AGENTS.md §2 (money-path gate) — server remains the wage authority; gross is still fully
-- server-recomputed, never client-trusted; a bonus is an explicit, audited, separately-tracked add-on,
-- not folded silently into "days x rate" (a payslip showing days x rate alone shouldn't imply an
-- unexplained bonus — 22.24 audit trail honesty).

-- 1. wage_payments: track the bonus component separately from the days x rate component so the audit
--    trail (and any future payslip rendering) can always show the breakdown, not just the total gross.
alter table public.wage_payments add column bonus_amount numeric(14, 2) not null default 0 check (bonus_amount >= 0);
comment on column public.wage_payments.bonus_amount is 'T3.3: optional bonus/incentive included in gross (gross = days x rate + bonus_amount). Tracked separately for audit-trail honesty.';

-- 2. payroll_disburse_wage — recreated: p_bonus_amount appended LAST with a default, preserving the
--    existing 7-arg call shape used by the guard battery and any already-queued offline payloads.
--    gross = round(days x rate, 2) + round(bonus, 2); everything else (deduction bounds, net calc,
--    Dr WAGES_EXPENSE / Cr CASH(net) / Cr EMPLOYEE_ADVANCES(deduction), idempotency, audit) unchanged.
drop function public.payroll_disburse_wage(uuid, uuid, text, numeric, numeric, text, text);
create function public.payroll_disburse_wage(
  p_branch_id uuid, p_employee_id uuid, p_pay_period text, p_days_worked numeric, p_ca_deduction numeric,
  p_notes text, p_idempotency_key text, p_bonus_amount numeric default 0
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_status text; v_rate numeric; v_gross numeric; v_ded numeric;
  v_bonus numeric; v_net numeric; v_outstanding numeric; v_wage uuid; v_entry uuid; a_wages uuid; a_cash uuid; a_adv uuid;
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

  select status, daily_rate into v_status, v_rate from public.employees where id = p_employee_id and company_id = v_company;
  if v_status is null then raise exception 'unknown employee' using errcode = 'foreign_key_violation'; end if;
  if v_status <> 'Active' then raise exception 'employee is not active' using errcode = 'check_violation'; end if;

  v_gross := round(p_days_worked * v_rate, 2) + v_bonus;   -- wage authority: days x rate (server) + explicit bonus
  if v_ded > v_gross then raise exception 'deduction exceeds gross wage' using errcode = 'check_violation'; end if;
  v_outstanding := public.employee_advance_balance(p_employee_id);
  if v_ded > v_outstanding then raise exception 'deduction exceeds outstanding advance (%.2f)', v_outstanding using errcode = 'check_violation'; end if;
  v_net := round(v_gross - v_ded, 2);

  select id into v_existing from public.wage_payments where company_id = v_company and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;  -- B5

  perform public.payroll_ensure_accounts(v_company);
  select id into a_wages from public.chart_of_accounts where company_id = v_company and account_code = 'WAGES_EXPENSE';
  select id into a_cash  from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  select id into a_adv   from public.chart_of_accounts where company_id = v_company and account_code = 'EMPLOYEE_ADVANCES';
  v_wage := public.uuidv7();
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'WagePayment', v_wage, 'Wage disbursement: ' || p_pay_period, v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_wages, v_gross, 0),
    (v_company, v_entry, a_cash, 0, v_net);
  if v_ded > 0 then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_adv, 0, v_ded);
  end if;
  insert into public.wage_payments (id, company_id, branch_id, employee_id, pay_period, days_worked, daily_rate, gross, ca_deducted, net, bonus_amount, notes, journal_entry_id, idempotency_key, created_by)
    values (v_wage, v_company, p_branch_id, p_employee_id, coalesce(nullif(trim(p_pay_period), ''), 'Cycle'), p_days_worked, v_rate, v_gross, v_ded, v_net, v_bonus, nullif(trim(coalesce(p_notes, '')), ''), v_entry, p_idempotency_key, v_actor);
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Business', 'payroll.wage_disbursed', 'payroll', 'wage_payments', v_wage);
  return v_wage;
end; $$;
comment on function public.payroll_disburse_wage(uuid, uuid, text, numeric, numeric, text, text, numeric) is 'T3.3: wage disbursement (21.10/21.14/22.20) — gross = days x rate + optional bonus (server-recomputed, wage authority); Dr Wages Expense/Cr Cash(net)/Cr Employee Advances(deduction); balanced. payroll.manage + branch member; net>=0; deduction<=outstanding advance; bonus>=0; idempotent; audited.';
revoke all on function public.payroll_disburse_wage(uuid, uuid, text, numeric, numeric, text, text, numeric) from public;
grant execute on function public.payroll_disburse_wage(uuid, uuid, text, numeric, numeric, text, text, numeric) to authenticated;
