-- Migration P2-M4D — Statement of Cash Flows (Phase 2, Module 4D)
-- Authority: Phase_2_M4C_Accounting_Reports_Spec.md / Phase_2_M4_Accounting_Module_Spec.md §2 (deferred item now
--   delivered) · Systems 22.22 statement generator / 22.04 GL. Owner authorized the B3 accounting-reports arc.
-- Scope: ONE read-only function. No table, no new permission (reuses accounting.read), no posting path — it only
--   READS the already-posted, already-balanced GL. Additive only; no locked file touched. Risk: Low (read-only).
--
-- Method (direct): every journal ENTRY that moves CASH is classified into exactly one activity + line by the
--   counterpart accounts in that same entry, and the entry's net cash delta (Σ CASH debit − credit) is attributed
--   to it. Because each entry lands in exactly one bucket, Operating + Investing + Financing = Σ all cash deltas =
--   Closing − Opening cash — the statement TIES by construction (proven, not asserted, in the guard).
--   Classification precedence (our posting functions never mix these in one entry, so precedence is only a safety
--   net): EQUIPMENT ⇒ Investing; OWNER_EQUITY/LOANS_PAYABLE ⇒ Financing; everything else ⇒ Operating.

create function public.cash_flow_statement(p_company uuid, p_branch_id uuid default null, p_year int default null)
returns table(activity text, line_label text, amount numeric, sort_order int)
language plpgsql stable security definer set search_path = '' as $$
declare v_opening numeric;
begin
  if not public.has_permission(p_company, 'accounting.read') then
    raise exception 'permission denied: accounting.read' using errcode = 'insufficient_privilege';
  end if;

  -- Opening cash = net cash movement STRICTLY BEFORE the period (0 when p_year is null → all-time view).
  select coalesce(sum(jl.debit - jl.credit), 0) into v_opening
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id and je.company_id = p_company
  join public.chart_of_accounts a on a.id = jl.account_id and a.company_id = p_company
  where a.account_code = 'CASH' and a.company_id = p_company
    and (p_branch_id is null or je.branch_id = p_branch_id)
    and (p_year is not null and extract(year from je.entry_date) < p_year);

  return query
  with je_cash as (
    select je.id as entry_id,
           sum(case when a.account_code = 'CASH' then jl.debit - jl.credit else 0 end) as cash_delta,
           bool_or(a.account_code = 'EQUIPMENT') as has_equip,
           bool_or(a.account_code = 'OWNER_EQUITY') as has_owner,
           bool_or(a.account_code = 'LOANS_PAYABLE') as has_loan,
           bool_or(a.account_code in ('SALES', 'AR')) as has_sales,
           bool_or(a.account_code in ('RAW_MATERIALS', 'OPERATING_EXPENSES')) as has_supplier,
           bool_or(a.account_code in ('WAGES_EXPENSE', 'EMPLOYEE_ADVANCES')) as has_labor,
           bool_or(a.account_code = 'OTHER_INCOME') as has_other_income
    from public.journal_entries je
    join public.journal_lines jl on jl.journal_entry_id = je.id and jl.company_id = p_company
    join public.chart_of_accounts a on a.id = jl.account_id and a.company_id = p_company
    where je.company_id = p_company
      and (p_branch_id is null or je.branch_id = p_branch_id)
      and (p_year is null or extract(year from je.entry_date) = p_year)
    group by je.id
    having sum(case when a.account_code = 'CASH' then jl.debit - jl.credit else 0 end) <> 0
  ),
  classified as (
    select cash_delta,
      case when has_equip then 'Investing'
           when has_owner or has_loan then 'Financing'
           else 'Operating' end as activity,
      case when has_equip then 'Equipment purchases'
           when has_owner then 'Owner investment / drawings'
           when has_loan then 'Loan proceeds / repayments'
           when has_sales then 'Receipts from customers'
           when has_supplier then 'Payments to suppliers'
           when has_labor then 'Payments to employees'
           when has_other_income then 'Other operating receipts'
           else 'Other operating' end as line_label
    from je_cash
  ),
  lines as (
    select c.activity, c.line_label, sum(c.cash_delta)::numeric as amount,
      case c.activity when 'Operating' then 1 when 'Investing' then 2 when 'Financing' then 3 else 4 end as sort_order
    from classified c group by c.activity, c.line_label
  )
  select l.activity, l.line_label, l.amount, l.sort_order from lines l
  union all
  select 'Reconciliation', 'Opening cash balance', v_opening, 10
  union all
  select 'Reconciliation', 'Closing cash balance',
         (v_opening + coalesce((select sum(jc.cash_delta) from je_cash jc), 0))::numeric, 11
  order by sort_order, line_label;
end; $$;
comment on function public.cash_flow_statement(uuid, uuid, int) is 'P2-M4D: direct-method Statement of Cash Flows from the posted GL (22.22). Classifies each cash-moving journal entry into Operating/Investing/Financing by counterpart account; Operating+Investing+Financing = Closing − Opening cash by construction. accounting.read; read-only.';
revoke all on function public.cash_flow_statement(uuid, uuid, int) from public;
grant execute on function public.cash_flow_statement(uuid, uuid, int) to authenticated;
