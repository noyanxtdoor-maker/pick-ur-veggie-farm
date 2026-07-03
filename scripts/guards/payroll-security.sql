-- Tier-2 BEHAVIORAL Payroll security test (Phase 2 M5A) — blocking gate.
-- Proves: cash advances + wage disbursements post BALANCED double-entry (22.20); gross is server-recomputed from
-- the employee's daily rate (wage authority — no client amount trusted); the outstanding-advance balance is
-- derived (never stored); net>=0 and deduction<=outstanding enforced; idempotent (B5); payroll.manage + branch +
-- active-employee gated; salary reads gated by payroll.read; tables are function-only + tenant-isolated; and the
-- accounting statements pick up wages (OpEx) + employee advances (asset) while the balance sheet still ties out.
-- Runs as authenticated owners/workers with simulated JWT. Self-contained BEGIN/ROLLBACK; any DEFECT raises.
\set ON_ERROR_STOP on
begin;

-- ── fixtures (postgres) ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-00000000000a','authenticated','authenticated','ownerA@t.local'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-00000000000b','authenticated','authenticated','ownerB@t.local'),
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-00000000000c','authenticated','authenticated','workerA2@t.local');
insert into public.users (id, auth_user_id, display_name) values
  ('10000000-0000-0000-0000-00000000000a','0a000000-0000-0000-0000-00000000000a','Owner A'),
  ('10000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b','Owner B'),
  ('10000000-0000-0000-0000-00000000000c','0c000000-0000-0000-0000-00000000000c','Worker A2');
insert into public.companies (id, company_code, name) values
  ('11111111-1111-1111-1111-111111111111','CO-A','Company A'),
  ('22222222-2222-2222-2222-222222222222','CO-B','Company B');
insert into public.branches (id, company_id, branch_code, name) values
  ('a1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','BR-A1','Branch A1'),
  ('a2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','BR-A2','Branch A2'),
  ('b1111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','BR-B1','Branch B1');
insert into public.roles (id, company_id, role_key, description) values
  ('20000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','Owner A'),
  ('20000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','owner','Owner B'),
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker (no payroll perms)');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions where permission_key in ('payroll.read','payroll.manage','accounting.read');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions where permission_key in ('payroll.read','payroll.manage','accounting.read');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000c');
-- one employee in company A (rate 500), one inactive
insert into public.employees (id, company_id, employee_code, name, position, daily_rate, status) values
  ('e1000000-0000-0000-0000-0000000000e1','11111111-1111-1111-1111-111111111111','EMP-001','Juan Dela Cruz','Harvester',500.00,'Active'),
  ('e2000000-0000-0000-0000-0000000000e2','11111111-1111-1111-1111-111111111111','EMP-002','Resigned Rey','Packer',450.00,'Inactive');

-- ── hire via RLS: owner A (payroll.manage) can insert; worker cannot ──
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.employees (company_id, employee_code, name, position, daily_rate) values ('11111111-1111-1111-1111-111111111111','EMP-003','Maria Santos','Farm Operator',600.00);
  raise notice 'PASS payroll: owner A hired a worker (payroll.manage RLS insert)';
end $$;
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  insert into public.employees (company_id, employee_code, name, position, daily_rate) values ('11111111-1111-1111-1111-111111111111','EMP-HACK','Hacker','x',1);
  raise exception 'DEFECT payroll: worker without payroll.manage hired a worker';
exception when insufficient_privilege then raise notice 'PASS payroll: hire denied without payroll.manage'; end $$;

-- ── HAPPY: cash advance 500 → Dr Employee Advances / Cr Cash, balanced; derived balance = 500 ──
do $$ declare v_ca uuid; v_entry uuid; d numeric; c numeric; adv_d numeric; v_bal numeric;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_ca := public.payroll_record_cash_advance('a1111111-1111-1111-1111-111111111111','e1000000-0000-0000-0000-0000000000e1', 500.00, 'medicine', 'ca-1');
  v_bal := public.employee_advance_balance('e1000000-0000-0000-0000-0000000000e1');
  if v_bal <> 500.00 then raise exception 'DEFECT payroll: advance balance wrong (got %, want 500)', v_bal; end if;
  set local role postgres;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_ca;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if v_entry is null or d <> c or d <> 500.00 then raise exception 'DEFECT payroll: advance journal wrong (d=% c=%, want 500)', d, c; end if;
  select jl.debit into adv_d from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='EMPLOYEE_ADVANCES';
  if adv_d <> 500.00 then raise exception 'DEFECT payroll: Employee Advances debit wrong'; end if;
  raise notice 'PASS payroll: advance 500 posts Dr Employee Advances/Cr Cash balanced; derived balance 500';
end $$;

-- idempotency: replay advance → same row, no second journal
do $$ declare v1 uuid; v2 uuid; n int;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v1 := public.payroll_record_cash_advance('a1111111-1111-1111-1111-111111111111','e1000000-0000-0000-0000-0000000000e1', 999.00, 'dup', 'ca-dup');
  v2 := public.payroll_record_cash_advance('a1111111-1111-1111-1111-111111111111','e1000000-0000-0000-0000-0000000000e1', 999.00, 'dup', 'ca-dup');
  if v1 <> v2 then raise exception 'DEFECT payroll: idempotent advance created a second row'; end if;
  set local role postgres;
  select count(*) into n from public.journal_entries where source_document_id = v1;
  if n <> 1 then raise exception 'DEFECT payroll: idempotent advance posted % journals (want 1)', n; end if;
  raise notice 'PASS payroll: advance replay idempotent';
end $$;

-- ── HAPPY: wage 2 days × 500 = gross 1000, deduct 300 → net 700; balanced Dr Wages/Cr Cash/Cr Advances ──
-- (ca-dup left an extra 999 advance → outstanding is 500+999=1499 before this wage; deduct 300 is fine.)
do $$ declare v_wage uuid; v_entry uuid; d numeric; c numeric; w_d numeric; cash_c numeric; adv_c numeric; v_gross numeric; v_net numeric; v_bal_before numeric; v_bal_after numeric;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_bal_before := public.employee_advance_balance('e1000000-0000-0000-0000-0000000000e1');
  v_wage := public.payroll_disburse_wage('a1111111-1111-1111-1111-111111111111','e1000000-0000-0000-0000-0000000000e1','July 1-7', 2.0, 300.00, 'harvest cycle', 'wage-1');
  set local role postgres;
  select gross, net into v_gross, v_net from public.wage_payments where id = v_wage;
  if v_gross <> 1000.00 then raise exception 'DEFECT payroll: gross wrong (got %, want 1000 = 2 x 500 server-computed)', v_gross; end if;
  if v_net <> 700.00 then raise exception 'DEFECT payroll: net wrong (got %, want 700)', v_net; end if;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_wage;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if d <> c or d <> 1000.00 then raise exception 'DEFECT payroll: wage journal wrong (d=% c=%, want 1000)', d, c; end if;
  select jl.debit into w_d from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='WAGES_EXPENSE';
  select jl.credit into cash_c from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='CASH';
  select jl.credit into adv_c from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='EMPLOYEE_ADVANCES';
  if w_d <> 1000.00 or cash_c <> 700.00 or adv_c <> 300.00 then raise exception 'DEFECT payroll: wage lines wrong (wages %, cash %, adv %; want 1000/700/300)', w_d, cash_c, adv_c; end if;
  v_bal_after := public.employee_advance_balance('e1000000-0000-0000-0000-0000000000e1');
  if v_bal_after <> v_bal_before - 300.00 then raise exception 'DEFECT payroll: advance balance not reduced by deduction (before %, after %)', v_bal_before, v_bal_after; end if;
  raise notice 'PASS payroll: wage gross 1000 (server-computed), Dr Wages 1000/Cr Cash 700/Cr Advances 300 balanced; advance balance reduced 300';
end $$;

-- ── ATTACKS ──
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.payroll_record_cash_advance('a1111111-1111-1111-1111-111111111111','e2000000-0000-0000-0000-0000000000e2', 100.00, 'x', 'ca-inactive');
  raise exception 'DEFECT payroll: advance to an inactive employee accepted';
exception when check_violation then raise notice 'PASS payroll: advance to inactive employee rejected'; end $$;

do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.payroll_disburse_wage('a1111111-1111-1111-1111-111111111111','e1000000-0000-0000-0000-0000000000e1','x', 1.0, 9999.00, 'x', 'wage-overded');
  raise exception 'DEFECT payroll: deduction exceeding gross accepted';
exception when check_violation then raise notice 'PASS payroll: deduction > gross rejected (net cannot be negative)'; end $$;

-- deduction within gross but beyond outstanding advance: give EMP-003 (new, no advances) a wage deducting 100
do $$ declare v_emp uuid; begin
  set local role postgres; select id into v_emp from public.employees where company_id='11111111-1111-1111-1111-111111111111' and employee_code='EMP-003';
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.payroll_disburse_wage('a1111111-1111-1111-1111-111111111111', v_emp, 'x', 1.0, 100.00, 'x', 'wage-noadv');
  raise exception 'DEFECT payroll: deduction beyond outstanding advance accepted';
exception when check_violation then raise notice 'PASS payroll: deduction > outstanding advance rejected'; end $$;

do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.payroll_disburse_wage('a1111111-1111-1111-1111-111111111111','e1000000-0000-0000-0000-0000000000e1','x', 0, 0, 'x', 'wage-zero');
  raise exception 'DEFECT payroll: zero days accepted';
exception when check_violation then raise notice 'PASS payroll: days worked <= 0 rejected'; end $$;

-- permission gating
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.payroll_record_cash_advance('a2222222-2222-2222-2222-222222222222','e1000000-0000-0000-0000-0000000000e1', 100.00, 'x', 'ca-wk');
  raise exception 'DEFECT payroll: worker without payroll.manage released an advance';
exception when insufficient_privilege then raise notice 'PASS payroll: advance denied without payroll.manage'; end $$;
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  select count(*) into n from public.employees where company_id='11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'DEFECT payroll: worker without payroll.read saw % salary rows', n; end if;
  raise notice 'PASS payroll: roster/salary reads hidden without payroll.read (privacy)';
end $$;

-- cross-company: owner A cannot disburse in company B
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.payroll_disburse_wage('b1111111-1111-1111-1111-111111111111','e1000000-0000-0000-0000-0000000000e1','x', 1.0, 0, 'x', 'wage-xc');
  raise exception 'DEFECT payroll: owner A disbursed in company B';
exception when insufficient_privilege then raise notice 'PASS payroll: cross-company disbursement denied'; end $$;

-- append-only: authenticated cannot delete a cash advance / wage (function-only, no grant)
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  delete from public.wage_payments where company_id='11111111-1111-1111-1111-111111111111';
  raise exception 'DEFECT payroll: a wage payment was deleted directly';
exception when insufficient_privilege then raise notice 'PASS payroll: direct wage delete denied (function-only)'; end $$;

-- ── statements pick up payroll; balance sheet still ties (22.20) ──
do $$ declare v_opex numeric; v_emp_adv numeric; v_assets numeric; v_liab numeric; v_eq numeric;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select operating_expenses into v_opex from public.income_statement_monthly('11111111-1111-1111-1111-111111111111', null, extract(year from now())::int)
    where month_num = extract(month from now())::int;
  if v_opex < 1000.00 then raise exception 'DEFECT payroll: wages (1000) not in income-statement OpEx (got %)', v_opex; end if;
  select employee_advances, total_assets, total_liabilities, total_equity into v_emp_adv, v_assets, v_liab, v_eq from public.balance_sheet('11111111-1111-1111-1111-111111111111');
  if v_emp_adv <= 0 then raise exception 'DEFECT payroll: employee advances not shown as a balance-sheet asset (got %)', v_emp_adv; end if;
  if round(v_assets - (v_liab + v_eq), 2) <> 0 then raise exception 'DEFECT payroll: balance sheet does not tie after payroll (assets=% liab=% eq=%)', v_assets, v_liab, v_eq; end if;
  raise notice 'PASS payroll: income-statement OpEx includes wages; balance sheet shows Employee Advances asset and still ties (Assets % = Liab % + Equity %)', v_assets, v_liab, v_eq;
end $$;

rollback;
