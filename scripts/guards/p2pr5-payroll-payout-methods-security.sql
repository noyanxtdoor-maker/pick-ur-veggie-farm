-- Guard battery for P2PR5 — Multiple payout methods for wage disbursement.
-- Money-path guard extending P2PR4's coverage.
-- Coverage:
--   HAPPY1: owner files a disbursement request naming a real GCash-type financial account (not
--           cash) -> Pending row stores financial_account_id; list_pending_disbursement_requests
--           joins the account name.
--   HAPPY2: a DIFFERENT manager approves -> wage_payments.financial_account_id matches the request's
--           account, and the journal credits THAT account's coa_code, not CASH.
--   HAPPY3: the net=0 byproduct fix — a request whose deduction exactly equals gross is approved
--           successfully (no journal_lines check-constraint crash), journal has exactly 2 balanced
--           lines (Wages debit, Employee Advances credit), no zero-amount pay-account line.
--   HAPPY4: filing with financial_account_id = null still works and disburses via CASH (backward
--           compatible default), matching P2PR4's original behavior exactly.
--   SAD1:   filing against an Archived financial account is denied at file time.
--   SAD2:   filing against a financial account from a DIFFERENT branch is denied at file time.
--   SAD3:   the re-resolve-at-approval-time property — a request is filed against a valid account,
--           the account is archived before the request is decided, and approval is denied because
--           the account is re-resolved fresh, not trusted from file time.
--   Cross-tenant: filing against a different company's financial account is rejected.
--   Grant shape: anon has EXECUTE on none of the (re-created) functions; authenticated has all of them.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0c800000-0000-0000-0000-000000000c81'::uuid, 'authenticated', 'authenticated', 'owner.p2pr5@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0c800000-0000-0000-0000-000000000c81','Owner P2PR5','P2PR5CO','P2PR5 Company','P2PR5BR','P2PR5 Branch');
  set local role postgres;
end $$;

create temp table g as select
  (select id from public.companies where company_code='P2PR5CO') as v_company,
  (select id from public.branches where branch_code='P2PR5BR') as v_branch;
grant select on g to authenticated;

-- ADMIN2 — a second payroll.manage holder (admin lacks it by default, granted via override).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d800000-0000-0000-0000-000000000d82'::uuid, 'authenticated', 'authenticated', 'admin2.p2pr5@t.local');
do $$ declare v_role uuid; v_user uuid; v_perm uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d800000-0000-0000-0000-000000000d82', 'Admin2 P2PR5', 'admin2.p2pr5@t.local', 'admin2_p2pr5')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d800000-0000-0000-0000-000000000d82';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='admin';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
  select id into v_perm from public.permissions where permission_key='payroll.manage';
  insert into public.user_permission_overrides (company_id, user_id, permission_id, effect, created_by)
    values ((select v_company from g), v_user, v_perm, 'grant', v_user);
end $$;

-- Real employees.
insert into public.employees (company_id, employee_code, name, daily_rate, status) values
  ((select v_company from g), 'P2PR5-EMP1', 'Employee One P2PR5', 500, 'Active'),
  ((select v_company from g), 'P2PR5-EMP2', 'Employee Two P2PR5', 500, 'Active'),
  ((select v_company from g), 'P2PR5-EMP3', 'Employee Three P2PR5', 500, 'Active');
create temp table ge as select
  (select id from public.employees where employee_code='P2PR5-EMP1') as v_emp1,
  (select id from public.employees where employee_code='P2PR5-EMP2') as v_emp2,
  (select id from public.employees where employee_code='P2PR5-EMP3') as v_emp3;
grant select on ge to authenticated;

-- A real GCash-type financial account for this branch, and an Archived one, and a wrong-branch one.
-- Inserted directly as postgres (the table owner) — matching every other fixture-table pattern in
-- this guard suite; financial_accounts writes normally go through governed RPCs, not a raw INSERT
-- grant, so authenticated/service_role can't do this directly either.
insert into public.financial_accounts (id, company_id, branch_id, name, account_type, provider, coa_code, status, created_by)
  values
    ('0e800000-0000-0000-0000-000000000ea1', (select v_company from g), (select v_branch from g), 'Owner GCash', 'Digital Wallet', 'GCash', 'GCASH_P2PR5', 'Active',
      (select id from public.users where auth_user_id='0c800000-0000-0000-0000-000000000c81')),
    ('0e800000-0000-0000-0000-000000000ea2', (select v_company from g), (select v_branch from g), 'Old Wallet', 'Digital Wallet', 'PayMaya', 'WALLET_P2PR5', 'Archived',
      (select id from public.users where auth_user_id='0c800000-0000-0000-0000-000000000c81'));
insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance)
  values ((select v_company from g), 'GCASH_P2PR5', 'GCash (P2PR5)', 'Asset', 'debit')
  on conflict do nothing;

-- SECOND tenant (cross-tenant fixture) with its own financial account and branch.
insert into public.companies (id, company_code, name) values
  ('0f800000-0000-0000-0000-000000000f81','P2PR5CO2','P2PR5 Company Two');
insert into public.branches (id, company_id, branch_code, name) values
  ('0f800000-0000-0000-0000-000000000fb5','0f800000-0000-0000-0000-000000000f81','P2PR5BR2','P2PR5 Branch Two');
insert into public.financial_accounts (id, company_id, branch_id, name, account_type, provider, coa_code, status, created_by) values
  ('0f800000-0000-0000-0000-000000000fa5','0f800000-0000-0000-0000-000000000f81','0f800000-0000-0000-0000-000000000fb5','Other Co GCash','Digital Wallet','GCash','GCASH_OTHER','Active',
    (select id from public.users where auth_user_id='0c800000-0000-0000-0000-000000000c81'));

-- A second branch in P2PR5CO for the wrong-branch test.
insert into public.branches (id, company_id, branch_code, name) values
  ('0e800000-0000-0000-0000-000000000eb2', (select v_company from g), 'P2PR5BR2LOCAL', 'P2PR5 Branch Local Two');
insert into public.financial_accounts (id, company_id, branch_id, name, account_type, provider, coa_code, status, created_by) values
  ('0e800000-0000-0000-0000-000000000ea3', (select v_company from g), '0e800000-0000-0000-0000-000000000eb2', 'Wrong Branch GCash', 'Digital Wallet', 'GCash', 'GCASH_WRONGBR', 'Active',
    (select id from public.users where auth_user_id='0c800000-0000-0000-0000-000000000c81'));

-- ── HAPPY 1: owner files a request naming the real GCash account ──
do $$ declare v_owner_auth uuid := '0c800000-0000-0000-0000-000000000c81'; v_id uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_id := public.payroll_request_disbursement((select v_branch from g), (select v_emp1 from ge), 'Cycle 1', 1, 0, 'via gcash', 0, '0e800000-0000-0000-0000-000000000ea1');
  if v_id is null then raise exception 'HAPPY1: payroll_request_disbursement returned null'; end if;
  set local role postgres;
  select count(*) into n from public.wage_disbursement_requests where id=v_id and financial_account_id='0e800000-0000-0000-0000-000000000ea1';
  if n<>1 then raise exception 'HAPPY1: request did not store the named financial account'; end if;
  select count(*) into n from public.list_pending_disbursement_requests() where id=v_id and account_name='Owner GCash' and account_provider='GCash';
  if n<>1 then raise exception 'HAPPY1: list_pending_disbursement_requests did not join the account name/provider'; end if;
  raise notice 'PASS p2pr5: owner filed a disbursement request naming a real GCash account, joined correctly in the list';
end $$;
set local role postgres;

-- ── HAPPY 2: a DIFFERENT manager approves -> wage_payments + journal credit the GCash account ──
do $$ declare v_admin2_auth uuid := '0d800000-0000-0000-0000-000000000d82'; v_req uuid; v_wage uuid; n int;
  v_gcash_acct uuid;
begin
  select id into v_req from public.wage_disbursement_requests
   where company_id=(select v_company from g) and employee_id=(select v_emp1 from ge) and status='Pending';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  v_wage := public.payroll_approve_disbursement_request(v_req, null);
  set local role postgres;
  select count(*) into n from public.wage_payments where id=v_wage and financial_account_id='0e800000-0000-0000-0000-000000000ea1';
  if n<>1 then raise exception 'HAPPY2: wage_payments.financial_account_id does not match the request''s named account'; end if;
  select id into v_gcash_acct from public.chart_of_accounts where company_id=(select v_company from g) and account_code='GCASH_P2PR5';
  select count(*) into n from public.journal_lines
   where journal_entry_id=(select journal_entry_id from public.wage_payments where id=v_wage) and account_id=v_gcash_acct and credit=500;
  if n<>1 then raise exception 'HAPPY2: journal did not credit the GCash account for 500'; end if;
  select count(*) into n from public.journal_lines
   where journal_entry_id=(select journal_entry_id from public.wage_payments where id=v_wage)
     and account_id=(select id from public.chart_of_accounts where company_id=(select v_company from g) and account_code='CASH');
  if n<>0 then raise exception 'HAPPY2: journal incorrectly ALSO touched CASH for a GCash disbursement'; end if;
  raise notice 'PASS p2pr5: a different manager approved — wage_payments and the journal credit the named GCash account, not CASH';
end $$;
set local role postgres;

-- ── HAPPY 3: net=0 byproduct fix — deduction exactly equals gross, approval must SUCCEED ──
do $$ declare v_owner_auth uuid := '0c800000-0000-0000-0000-000000000c81'; v_admin2_auth uuid := '0d800000-0000-0000-0000-000000000d82';
  v_req uuid; v_wage uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.payroll_record_cash_advance((select v_branch from g), (select v_emp2 from ge), 500, 'advance for net-zero test', 'p2pr5-net0-adv');
  v_req := public.payroll_request_disbursement((select v_branch from g), (select v_emp2 from ge), 'Cycle 2', 1, 500, 'entire wage to advance', 0, null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  v_wage := public.payroll_approve_disbursement_request(v_req, null);
  if v_wage is null then raise exception 'HAPPY3: net=0 approval should succeed and return a wage_payments id'; end if;
  set local role postgres;
  select count(*) into n from public.wage_payments where id=v_wage and gross=500 and net=0 and ca_deducted=500;
  if n<>1 then raise exception 'HAPPY3: wage_payments row not created with expected net=0'; end if;
  select count(*) into n from public.journal_lines where journal_entry_id=(select journal_entry_id from public.wage_payments where id=v_wage);
  if n<>2 then raise exception 'HAPPY3: expected exactly 2 journal lines (Wages debit + Advances credit), got %', n; end if;
  select count(*) into n from public.journal_lines where journal_entry_id=(select journal_entry_id from public.wage_payments where id=v_wage) and debit=0 and credit=0;
  if n<>0 then raise exception 'HAPPY3: found an invalid zero/zero journal line'; end if;
  raise notice 'PASS p2pr5: net=0 disbursement (full deduction) approves successfully with no invalid zero-amount journal line — byproduct fix confirmed';
end $$;
set local role postgres;

-- ── HAPPY 4: filing with financial_account_id = null still disburses via CASH (backward compat) ──
do $$ declare v_owner_auth uuid := '0c800000-0000-0000-0000-000000000c81'; v_admin2_auth uuid := '0d800000-0000-0000-0000-000000000d82';
  v_req uuid; v_wage uuid; n int; v_cash_acct uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_req := public.payroll_request_disbursement((select v_branch from g), (select v_emp3 from ge), 'Cycle 3', 1, 0, null, 0);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  v_wage := public.payroll_approve_disbursement_request(v_req, null);
  set local role postgres;
  select id into v_cash_acct from public.chart_of_accounts where company_id=(select v_company from g) and account_code='CASH';
  select count(*) into n from public.journal_lines
   where journal_entry_id=(select journal_entry_id from public.wage_payments where id=v_wage) and account_id=v_cash_acct and credit=500;
  if n<>1 then raise exception 'HAPPY4: default (null account) disbursement should still credit CASH'; end if;
  select count(*) into n from public.wage_payments where id=v_wage and financial_account_id is null;
  if n<>1 then raise exception 'HAPPY4: wage_payments.financial_account_id should be null for the default cash path'; end if;
  raise notice 'PASS p2pr5: omitting a payout account still defaults to CASH, unchanged from P2PR4';
end $$;
set local role postgres;

-- ── SAD 1: filing against an Archived financial account ──
do $$ declare v_owner_auth uuid := '0c800000-0000-0000-0000-000000000c81';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_disbursement((select v_branch from g), (select v_emp1 from ge), 'Cycle X', 1, 0, null, 0, '0e800000-0000-0000-0000-000000000ea2');
    raise exception 'SAD1: filing against an Archived financial account should be denied';
  exception when check_violation then
    raise notice 'PASS p2pr5: filing against an Archived financial account denied at file time';
  end;
end $$;
set local role postgres;

-- ── SAD 2: filing against a financial account from a DIFFERENT branch (same company) ──
do $$ declare v_owner_auth uuid := '0c800000-0000-0000-0000-000000000c81';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_disbursement((select v_branch from g), (select v_emp1 from ge), 'Cycle X', 1, 0, null, 0, '0e800000-0000-0000-0000-000000000ea3');
    raise exception 'SAD2: filing against a wrong-branch financial account should be denied';
  exception when check_violation then
    raise notice 'PASS p2pr5: filing against a different branch''s financial account denied at file time';
  end;
end $$;
set local role postgres;

-- ── SAD 3: re-resolve-at-approval-time — account archived AFTER filing, BEFORE decision ──
do $$ declare v_owner_auth uuid := '0c800000-0000-0000-0000-000000000c81'; v_admin2_auth uuid := '0d800000-0000-0000-0000-000000000d82';
  v_req uuid;
begin
  -- reactivate the archived account just long enough to file against it
  update public.financial_accounts set status='Active' where id='0e800000-0000-0000-0000-000000000ea2';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_req := public.payroll_request_disbursement((select v_branch from g), (select v_emp1 from ge), 'Cycle 4', 1, 0, null, 0, '0e800000-0000-0000-0000-000000000ea2');
  set local role postgres;
  -- now archive it again before approval
  update public.financial_accounts set status='Archived' where id='0e800000-0000-0000-0000-000000000ea2';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  begin
    perform public.payroll_approve_disbursement_request(v_req, null);
    raise exception 'SAD3: approval should be denied — the payout account was archived after filing, before the decision';
  exception when check_violation then
    raise notice 'PASS p2pr5: approval re-resolves the payout account fresh at decision time — an account archived after filing is caught, not trusted from file time';
  end;
end $$;
set local role postgres;

-- ── Cross-tenant: filing against a DIFFERENT company's financial account ──
do $$ declare v_owner_auth uuid := '0c800000-0000-0000-0000-000000000c81';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_disbursement((select v_branch from g), (select v_emp1 from ge), 'Cycle X', 1, 0, null, 0, '0f800000-0000-0000-0000-000000000fa5');
    raise exception 'CROSS-TENANT: filing against a different company''s financial account should be rejected';
  exception when foreign_key_violation then
    raise notice 'PASS p2pr5: cross-tenant financial_account_id denied (account not found in caller''s company)';
  end;
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on none of the disbursement functions; authenticated has all ──
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('payroll_request_disbursement','payroll_approve_disbursement_request','payroll_reject_disbursement_request','list_pending_disbursement_requests','list_disbursement_requests');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a disbursement function (found % grants)', n; end if;
  raise notice 'PASS p2pr5: anon has no EXECUTE on any disbursement function';

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('payroll_request_disbursement','payroll_approve_disbursement_request','payroll_reject_disbursement_request','list_pending_disbursement_requests','list_disbursement_requests');
  if n<>5 then raise exception 'GRANT: expected authenticated to have EXECUTE on all 5 disbursement functions, found %', n; end if;
  raise notice 'PASS p2pr5: authenticated has EXECUTE on all 5 disbursement functions';
end $$;

rollback;
