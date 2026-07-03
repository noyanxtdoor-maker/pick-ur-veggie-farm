-- Migration P2-M5A — Payroll Core (Phase 2, Module 5A): farm staff wages & cash advances.
-- Authority: Phase_2_M5_Payroll_Module_Spec.md · prototype src/features/Payroll.tsx = workflow-logic authority
--   (owner 2026-07-02) · Systems 21.02 employee master / 21.10-21.11 salary+computation / 21.12 cash advance /
--   21.14 disbursement / 22.20 payroll->accounting integration / 26.09 permission matrix = structural authority.
-- Model: lean daily-wage payroll. Advances and wages post BALANCED double-entry (22.20) via SECURITY DEFINER
--   functions; gross is server-recomputed from the employee's daily rate (wage authority — never trusts a client
--   amount); the outstanding-advance balance is DERIVED (never stored). Deferred (spec §1): attendance/shifts/
--   leave/overtime/approval-workflow/multi-method-disbursement/self-service-payslip.
-- Pattern: ADDITIVE ONLY — no locked file modified; the M4A read functions are evolved via drop+recreate to
--   include payroll (22.20). Risk: High (payroll is a money path). All writes function-only, journals append-only,
--   postings balanced.

-- ── Permissions (26.09 HR/Financial authority; NOT granted to Worker/Operator) ──
insert into public.permissions (permission_key, description) values
  ('payroll.read',   'View the staff roster, cash advances, and wage disbursement journal'),
  ('payroll.manage', 'Hire/deactivate staff, release cash advances, and disburse wages')
on conflict (permission_key) do nothing;

-- GL accounts the module posts to (extends the M4A chart idempotently).
create or replace function public.payroll_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.inventory_ensure_accounts(p_company);  -- CASH + full chart through M4A
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance) values
    (p_company, 'WAGES_EXPENSE',    'Labor & Wages Expense', 'Expense', 'debit'),
    (p_company, 'EMPLOYEE_ADVANCES','Employee Cash Advances','Asset',   'debit')
  on conflict (company_id, account_code) do nothing;
end; $$;
revoke all on function public.payroll_ensure_accounts(uuid) from public;
grant execute on function public.payroll_ensure_accounts(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. employees — staff master (company-scoped, like products; 21.02). RLS-gated writes (payroll.manage); no GL.
-- ════════════════════════════════════════════════════════════════════════════
create table public.employees (
  id            uuid primary key default public.uuidv7(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  employee_code text not null,
  name          text not null,
  position      text not null default 'Harvester',
  daily_rate    numeric(12, 2) not null check (daily_rate > 0),
  date_hired    date not null default now(),
  status        text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, employee_code),
  unique (id, company_id)
);
comment on table public.employees is 'Farm staff master (P2-M5A, 21.02). Company-scoped; payroll.read-view / payroll.manage-write; audited. No hard delete (status=Inactive).';
create index employees_company_idx on public.employees (company_id, status);
create trigger employees_set_updated_at before update on public.employees for each row execute function public.set_updated_at();
create trigger employees_audit after insert or update on public.employees for each row execute function public.inventory_audit();
alter table public.employees enable row level security;
alter table public.employees force row level security;
revoke all on public.employees from public, anon, authenticated, service_role;
grant select on public.employees to authenticated;
grant insert (company_id, employee_code, name, position, daily_rate, date_hired) on public.employees to authenticated;
grant update (name, position, daily_rate, status) on public.employees to authenticated;  -- code immutable
create policy employees_select on public.employees for select to authenticated
  using (public.has_permission(company_id, 'payroll.read'));
create policy employees_insert on public.employees for insert to authenticated
  with check (public.has_permission(company_id, 'payroll.manage'));
create policy employees_update on public.employees for update to authenticated
  using (public.has_permission(company_id, 'payroll.manage'))
  with check (public.has_permission(company_id, 'payroll.manage'));

-- ════════════════════════════════════════════════════════════════════════════
-- 2. cash_advances (21.12) — branch-owned, append-only. Written only by payroll_record_cash_advance.
-- ════════════════════════════════════════════════════════════════════════════
create table public.cash_advances (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  branch_id        uuid not null,
  employee_id      uuid not null,
  amount           numeric(14, 2) not null check (amount > 0),
  note             text,
  journal_entry_id uuid,
  idempotency_key  text,
  created_by       uuid references public.users (id) on delete restrict,
  created_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (branch_id, company_id)        references public.branches (id, company_id)        on delete restrict,
  foreign key (employee_id, company_id)      references public.employees (id, company_id)       on delete restrict,
  foreign key (journal_entry_id, company_id) references public.journal_entries (id, company_id) on delete restrict
);
create unique index cash_advances_idem_uq on public.cash_advances (company_id, idempotency_key) where idempotency_key is not null;
create index cash_advances_emp_idx on public.cash_advances (employee_id, company_id);
comment on table public.cash_advances is 'Employee cash advances (P2-M5A, 21.12). Branch-owned; function-only; each posts Dr Employee Advances/Cr Cash. Outstanding balance is derived, never stored.';
alter table public.cash_advances enable row level security;
alter table public.cash_advances force row level security;
revoke all on public.cash_advances from public, anon, authenticated, service_role;
grant select on public.cash_advances to authenticated;
create policy cash_advances_select on public.cash_advances for select to authenticated
  using (public.has_permission(company_id, 'payroll.read') and public.is_branch_member(branch_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. wage_payments (21.10/21.14) — branch-owned, append-only. Written only by payroll_disburse_wage.
-- ════════════════════════════════════════════════════════════════════════════
create table public.wage_payments (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  branch_id        uuid not null,
  employee_id      uuid not null,
  pay_period       text not null,
  days_worked      numeric(6, 2) not null check (days_worked > 0),
  daily_rate       numeric(12, 2) not null check (daily_rate >= 0),   -- snapshot at disbursement
  gross            numeric(14, 2) not null check (gross >= 0),
  ca_deducted      numeric(14, 2) not null default 0 check (ca_deducted >= 0),
  net              numeric(14, 2) not null check (net >= 0),
  notes            text,
  journal_entry_id uuid,
  idempotency_key  text,
  created_by       uuid references public.users (id) on delete restrict,
  created_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (branch_id, company_id)        references public.branches (id, company_id)        on delete restrict,
  foreign key (employee_id, company_id)      references public.employees (id, company_id)       on delete restrict,
  foreign key (journal_entry_id, company_id) references public.journal_entries (id, company_id) on delete restrict
);
create unique index wage_payments_idem_uq on public.wage_payments (company_id, idempotency_key) where idempotency_key is not null;
create index wage_payments_emp_idx on public.wage_payments (employee_id, company_id);
comment on table public.wage_payments is 'Wage disbursements (P2-M5A, 21.10/21.14). Branch-owned; function-only; each posts Dr Wages Expense/Cr Cash(net)/Cr Employee Advances(deduction). gross = days x rate, server-recomputed.';
alter table public.wage_payments enable row level security;
alter table public.wage_payments force row level security;
revoke all on public.wage_payments from public, anon, authenticated, service_role;
grant select on public.wage_payments to authenticated;
create policy wage_payments_select on public.wage_payments for select to authenticated
  using (public.has_permission(company_id, 'payroll.read') and public.is_branch_member(branch_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 4. employee_advance_balance — derived outstanding advance (Σ advances − Σ wage deductions). STABLE helper.
-- ════════════════════════════════════════════════════════════════════════════
create function public.employee_advance_balance(p_employee_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount) from public.cash_advances where employee_id = p_employee_id), 0)
       - coalesce((select sum(ca_deducted) from public.wage_payments where employee_id = p_employee_id), 0);
$$;
comment on function public.employee_advance_balance(uuid) is 'P2-M5A: outstanding advance per employee, derived from cash_advances − wage_payments deductions (never stored; mirrors the prototype).';
revoke all on function public.employee_advance_balance(uuid) from public;
grant execute on function public.employee_advance_balance(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. payroll_record_cash_advance — atomic advance + balanced GL (Dr Employee Advances / Cr Cash).
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_record_cash_advance(
  p_branch_id uuid, p_employee_id uuid, p_amount numeric, p_note text, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_status text; v_ca uuid; v_entry uuid; a_adv uuid; a_cash uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'payroll.manage') then raise exception 'permission denied: payroll.manage' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'advance amount must be > 0' using errcode = 'check_violation'; end if;
  select status into v_status from public.employees where id = p_employee_id and company_id = v_company;
  if v_status is null then raise exception 'unknown employee' using errcode = 'foreign_key_violation'; end if;
  if v_status <> 'Active' then raise exception 'employee is not active' using errcode = 'check_violation'; end if;

  select id into v_existing from public.cash_advances where company_id = v_company and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;  -- B5

  perform public.payroll_ensure_accounts(v_company);
  select id into a_adv  from public.chart_of_accounts where company_id = v_company and account_code = 'EMPLOYEE_ADVANCES';
  select id into a_cash from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  v_ca := public.uuidv7();
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'CashAdvance', v_ca, 'Employee cash advance', v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_adv, p_amount, 0),
    (v_company, v_entry, a_cash, 0, p_amount);
  insert into public.cash_advances (id, company_id, branch_id, employee_id, amount, note, journal_entry_id, idempotency_key, created_by)
    values (v_ca, v_company, p_branch_id, p_employee_id, p_amount, nullif(trim(coalesce(p_note, '')), ''), v_entry, p_idempotency_key, v_actor);
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Business', 'payroll.cash_advance', 'payroll', 'cash_advances', v_ca);
  return v_ca;
end; $$;
comment on function public.payroll_record_cash_advance(uuid, uuid, numeric, text, text) is 'P2-M5A: employee cash advance (21.12/22.20) — atomic cash_advances row + Dr Employee Advances/Cr Cash. payroll.manage + branch member; active employee; idempotent; audited.';
revoke all on function public.payroll_record_cash_advance(uuid, uuid, numeric, text, text) from public;
grant execute on function public.payroll_record_cash_advance(uuid, uuid, numeric, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. payroll_disburse_wage — atomic wage: gross = days × rate (server); Dr Wages/Cr Cash(net)/Cr Advances(ded).
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_disburse_wage(
  p_branch_id uuid, p_employee_id uuid, p_pay_period text, p_days_worked numeric, p_ca_deduction numeric,
  p_notes text, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_status text; v_rate numeric; v_gross numeric; v_ded numeric;
  v_net numeric; v_outstanding numeric; v_wage uuid; v_entry uuid; a_wages uuid; a_cash uuid; a_adv uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'payroll.manage') then raise exception 'permission denied: payroll.manage' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_days_worked is null or p_days_worked <= 0 then raise exception 'days worked must be > 0' using errcode = 'check_violation'; end if;
  v_ded := round(coalesce(p_ca_deduction, 0), 2);
  if v_ded < 0 then raise exception 'deduction must be >= 0' using errcode = 'check_violation'; end if;

  select status, daily_rate into v_status, v_rate from public.employees where id = p_employee_id and company_id = v_company;
  if v_status is null then raise exception 'unknown employee' using errcode = 'foreign_key_violation'; end if;
  if v_status <> 'Active' then raise exception 'employee is not active' using errcode = 'check_violation'; end if;

  v_gross := round(p_days_worked * v_rate, 2);   -- wage authority: gross recomputed from the master rate
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
  insert into public.wage_payments (id, company_id, branch_id, employee_id, pay_period, days_worked, daily_rate, gross, ca_deducted, net, notes, journal_entry_id, idempotency_key, created_by)
    values (v_wage, v_company, p_branch_id, p_employee_id, coalesce(nullif(trim(p_pay_period), ''), 'Cycle'), p_days_worked, v_rate, v_gross, v_ded, v_net, nullif(trim(coalesce(p_notes, '')), ''), v_entry, p_idempotency_key, v_actor);
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Business', 'payroll.wage_disbursed', 'payroll', 'wage_payments', v_wage);
  return v_wage;
end; $$;
comment on function public.payroll_disburse_wage(uuid, uuid, text, numeric, numeric, text, text) is 'P2-M5A: wage disbursement (21.10/21.14/22.20) — gross = days x rate (server-recomputed, wage authority); Dr Wages Expense/Cr Cash(net)/Cr Employee Advances(deduction); balanced. payroll.manage + branch member; net>=0; deduction<=outstanding advance; idempotent; audited.';
revoke all on function public.payroll_disburse_wage(uuid, uuid, text, numeric, numeric, text, text) from public;
grant execute on function public.payroll_disburse_wage(uuid, uuid, text, numeric, numeric, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Payroll → Accounting integration (22.20): evolve the M4A read functions additively so the statements pick up
--    wages (OpEx) and employee advances (asset). Both drop+recreate; zero-impact when no payroll data.
-- ════════════════════════════════════════════════════════════════════════════
drop function public.income_statement_monthly(uuid, uuid, int);
create function public.income_statement_monthly(p_company uuid, p_branch_id uuid default null, p_year int default extract(year from now())::int)
returns table(
  month_num int, month_name text,
  retail_revenue numeric, wholesale_revenue numeric, total_revenue numeric,
  cogs numeric, gross_profit numeric,
  shrinkage numeric, operating_expenses numeric, total_opex numeric,
  net_income numeric
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission(p_company, 'accounting.read') then
    raise exception 'permission denied: accounting.read' using errcode = 'insufficient_privilege';
  end if;
  return query
  with sale_class as (
    select i.id as invoice_id, bool_or(coalesce(soi.is_bulk, false)) as is_wholesale
    from public.invoices i
    join public.sales_order_items soi on soi.sales_order_id = i.sales_order_id and soi.company_id = i.company_id
    where i.company_id = p_company
    group by i.id
  ),
  base as (
    select extract(month from je.entry_date)::int as mo, a.account_code,
           coalesce(sc.is_wholesale, false) as is_wholesale, jl.debit, jl.credit
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id and je.company_id = p_company
    join public.chart_of_accounts a on a.id = jl.account_id and a.company_id = p_company
    left join sale_class sc on sc.invoice_id = je.source_document_id and a.account_code = 'SALES'
    where a.account_code in ('SALES', 'COGS', 'SHRINKAGE', 'OPERATING_EXPENSES', 'WAGES_EXPENSE')   -- P2-M5A: +wages
      and extract(year from je.entry_date) = p_year
      and (p_branch_id is null or je.branch_id = p_branch_id)
  ),
  monthly as (
    select mo,
      sum(case when account_code = 'SALES' and not is_wholesale then credit - debit else 0 end) as retail_revenue,
      sum(case when account_code = 'SALES' and is_wholesale then credit - debit else 0 end) as wholesale_revenue,
      sum(case when account_code = 'COGS' then debit - credit else 0 end) as cogs,
      sum(case when account_code = 'SHRINKAGE' then debit - credit else 0 end) as shrinkage,
      sum(case when account_code in ('OPERATING_EXPENSES', 'WAGES_EXPENSE') then debit - credit else 0 end) as operating_expenses  -- P2-M5A: wages fold into OpEx
    from base group by mo
  )
  select m.mo, to_char(to_date(m.mo::text, 'MM'), 'Mon'),
    coalesce(mm.retail_revenue, 0)::numeric, coalesce(mm.wholesale_revenue, 0)::numeric,
    (coalesce(mm.retail_revenue, 0) + coalesce(mm.wholesale_revenue, 0))::numeric,
    coalesce(mm.cogs, 0)::numeric,
    ((coalesce(mm.retail_revenue, 0) + coalesce(mm.wholesale_revenue, 0)) - coalesce(mm.cogs, 0))::numeric,
    coalesce(mm.shrinkage, 0)::numeric, coalesce(mm.operating_expenses, 0)::numeric,
    (coalesce(mm.shrinkage, 0) + coalesce(mm.operating_expenses, 0))::numeric,
    (((coalesce(mm.retail_revenue, 0) + coalesce(mm.wholesale_revenue, 0)) - coalesce(mm.cogs, 0))
      - (coalesce(mm.shrinkage, 0) + coalesce(mm.operating_expenses, 0)))::numeric
  from generate_series(1, 12) as m(mo)
  left join monthly mm on mm.mo = m.mo
  order by m.mo;
end; $$;
comment on function public.income_statement_monthly(uuid, uuid, int) is 'P2-M5A: income statement from the posted GL (22.05/22.22); WAGES_EXPENSE now folded into operating_expenses (22.20). accounting.read.';
revoke all on function public.income_statement_monthly(uuid, uuid, int) from public;
grant execute on function public.income_statement_monthly(uuid, uuid, int) to authenticated;

drop function public.balance_sheet(uuid, uuid, date);
create function public.balance_sheet(p_company uuid, p_branch_id uuid default null, p_as_of date default null)
returns table(
  cash numeric, accounts_receivable numeric, raw_materials numeric, finished_goods numeric, equipment numeric,
  employee_advances numeric, total_assets numeric,
  loans_payable numeric, total_liabilities numeric,
  owner_investment numeric, owners_drawings numeric, retained_earnings numeric, total_equity numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cash numeric; v_ar numeric; v_raw numeric; v_fg numeric; v_equip numeric; v_emp_adv numeric;
  v_loans numeric; v_opening_fg_equity numeric; v_net_income_cum numeric;
  v_invest numeric; v_drawings numeric;
begin
  if not public.has_permission(p_company, 'accounting.read') then
    raise exception 'permission denied: accounting.read' using errcode = 'insufficient_privilege';
  end if;

  select
    coalesce(sum(case when a.account_code = 'CASH' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'AR' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'RAW_MATERIALS' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'FG_INVENTORY' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'EQUIPMENT' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'EMPLOYEE_ADVANCES' then jl.debit - jl.credit else 0 end), 0),   -- P2-M5A
    coalesce(sum(case when a.account_code = 'LOANS_PAYABLE' then jl.credit - jl.debit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'OWNER_EQUITY' and je.source_document_type = 'OpeningBalance' then jl.credit - jl.debit else 0 end), 0),
    coalesce(sum(case when a.account_code in ('SALES', 'OTHER_INCOME') then jl.credit - jl.debit
                       when a.account_code in ('COGS', 'SHRINKAGE', 'OPERATING_EXPENSES', 'WAGES_EXPENSE') then -(jl.debit - jl.credit)   -- P2-M5A: +wages
                       else 0 end), 0)
  into v_cash, v_ar, v_raw, v_fg, v_equip, v_emp_adv, v_loans, v_opening_fg_equity, v_net_income_cum
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id and je.company_id = p_company
  join public.chart_of_accounts a on a.id = jl.account_id and a.company_id = p_company
  where (p_branch_id is null or je.branch_id = p_branch_id)
    and (p_as_of is null or je.entry_date::date <= p_as_of);

  select coalesce(sum(amount) filter (where category = 'Owner Investment'), 0),
         coalesce(sum(amount) filter (where category = 'Owner''s Drawings'), 0)
    into v_invest, v_drawings
  from public.cash_entries c
  where c.company_id = p_company and c.status = 'Posted'
    and (p_branch_id is null or c.branch_id = p_branch_id)
    and (p_as_of is null or c.entry_date <= p_as_of);

  return query select
    v_cash, v_ar, v_raw, v_fg, v_equip, v_emp_adv,
    (v_cash + v_ar + v_raw + v_fg + v_equip + v_emp_adv)::numeric,
    v_loans, v_loans::numeric,
    (v_invest + v_opening_fg_equity)::numeric, v_drawings, v_net_income_cum,
    (v_invest + v_opening_fg_equity - v_drawings + v_net_income_cum)::numeric;
end; $$;
comment on function public.balance_sheet(uuid, uuid, date) is 'P2-M5A: balance sheet from the posted GL + cash_entries (22.03/22.22); now includes EMPLOYEE_ADVANCES asset and WAGES_EXPENSE in retained earnings (22.20). Assets = Liabilities + Equity by construction. accounting.read.';
revoke all on function public.balance_sheet(uuid, uuid, date) from public;
grant execute on function public.balance_sheet(uuid, uuid, date) to authenticated;
