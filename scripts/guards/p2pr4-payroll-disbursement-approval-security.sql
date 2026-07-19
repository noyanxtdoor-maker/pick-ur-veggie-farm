-- Guard battery for P2PR4 — Wage disbursement approval workflow.
-- Money-path guard (this migration IS the money-movement RPC, unlike P2PR1-3) — matches P2N2's
-- void-approval rigor level.
-- Coverage:
--   HAPPY1: owner (payroll.manage) files a disbursement request -> Pending row, audited.
--   SAD1:   worker with no payroll.manage cannot file -> insufficient_privilege.
--   SAD2:   the SAME owner who filed cannot approve their own request (separation of duties).
--   HAPPY2: a DIFFERENT manager (admin2) approves -> wage_payments row created (correct gross/net,
--           balanced journal), wage_disbursement_requests Approved with wage_payment_id linked.
--   SAD3:   approving an already-decided request again -> raise_exception ('already decided').
--   HAPPY3: a second request is filed and REJECTED (by a different manager) with a reason -> no
--           wage_payments row created, request Rejected, decision_reason set.
--   SAD4:   rejecting without a reason -> denied.
--   SAD5:   requested deduction exceeds the outstanding advance -> denied AT FILE TIME.
--   SAD6:   days_worked <= 0 -> denied.
--   SAD7:   filing against an Inactive employee -> denied.
--   SAD8:   the load-bearing "re-validate at approval time" property: a request is filed while a
--           deduction is valid, then the SAME advance is separately fully consumed via the existing
--           direct payroll_disburse_wage RPC before the request is decided — approval must be denied
--           because the outstanding advance is re-derived fresh at decision time, not trusted from
--           file time.
--   Cross-tenant: filing against a different company's employee is rejected.
--   Grant shape: anon has EXECUTE on none of the 5 new functions; authenticated has all 5.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0c700000-0000-0000-0000-000000000c71'::uuid, 'authenticated', 'authenticated', 'owner.p2pr4@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0c700000-0000-0000-0000-000000000c71','Owner P2PR4','P2PR4CO','P2PR4 Company','P2PR4BR','P2PR4 Branch');
  set local role postgres;
end $$;

create temp table g as select
  (select id from public.companies where company_code='P2PR4CO') as v_company,
  (select id from public.branches where branch_code='P2PR4BR') as v_branch;
grant select on g to authenticated;

-- WORKER (no payroll perms at all)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d700000-0000-0000-0000-000000000d71'::uuid, 'authenticated', 'authenticated', 'worker.p2pr4@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d700000-0000-0000-0000-000000000d71', 'Worker P2PR4', 'worker.p2pr4@t.local', 'worker_p2pr4')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d700000-0000-0000-0000-000000000d71';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='employee';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- ADMIN2 — a second payroll.manage holder (admin lacks it by default, granted via override).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d700000-0000-0000-0000-000000000d72'::uuid, 'authenticated', 'authenticated', 'admin2.p2pr4@t.local');
do $$ declare v_role uuid; v_user uuid; v_perm uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d700000-0000-0000-0000-000000000d72', 'Admin2 P2PR4', 'admin2.p2pr4@t.local', 'admin2_p2pr4')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d700000-0000-0000-0000-000000000d72';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='admin';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
  select id into v_perm from public.permissions where permission_key='payroll.manage';
  insert into public.user_permission_overrides (company_id, user_id, permission_id, effect, created_by)
    values ((select v_company from g), v_user, v_perm, 'grant', v_user);
end $$;

-- Real employees, and one Inactive employee for SAD7.
insert into public.employees (company_id, employee_code, name, daily_rate, status) values
  ((select v_company from g), 'P2PR4-EMP1', 'Employee One P2PR4', 500, 'Active'),
  ((select v_company from g), 'P2PR4-EMP2', 'Employee Two P2PR4', 500, 'Active'),
  ((select v_company from g), 'P2PR4-EMP3', 'Employee Three P2PR4', 500, 'Active'),
  ((select v_company from g), 'P2PR4-INACTIVE', 'Inactive Employee P2PR4', 500, 'Inactive');
create temp table ge as select
  (select id from public.employees where employee_code='P2PR4-EMP1') as v_emp1,
  (select id from public.employees where employee_code='P2PR4-EMP2') as v_emp2,
  (select id from public.employees where employee_code='P2PR4-EMP3') as v_emp3,
  (select id from public.employees where employee_code='P2PR4-INACTIVE') as v_inactive;
grant select on ge to authenticated;

-- SECOND tenant (cross-tenant fixture)
insert into public.companies (id, company_code, name) values
  ('0f700000-0000-0000-0000-000000000f71','P2PR4CO2','P2PR4 Company Two');
insert into public.branches (id, company_id, branch_code, name) values
  ('0f700000-0000-0000-0000-000000000fb4','0f700000-0000-0000-0000-000000000f71','P2PR4BR2','P2PR4 Branch Two');
insert into public.employees (id, company_id, employee_code, name, daily_rate) values
  ('0f700000-0000-0000-0000-000000000fe4','0f700000-0000-0000-0000-000000000f71','P2PR4CO2-EMP1','Other Co Employee',400);

-- ── HAPPY 1: owner files a disbursement request for EMP1 (1 day, no deduction, no bonus) ──
do $$ declare v_owner_auth uuid := '0c700000-0000-0000-0000-000000000c71'; v_id uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_id := public.payroll_request_disbursement((select v_branch from g), (select v_emp1 from ge), 'Cycle 1', 1, 0, 'regular day', 0);
  if v_id is null then raise exception 'HAPPY1: payroll_request_disbursement returned null'; end if;
  set local role postgres;
  select count(*) into n from public.wage_disbursement_requests where id=v_id and status='Pending';
  if n<>1 then raise exception 'HAPPY1: disbursement request not created as Pending'; end if;
  select count(*) into n from public.audit_events where event_type='insert.wage_disbursement_requests' and entity_id=v_id;
  if n<>1 then raise exception 'HAPPY1: insert audit missing'; end if;
  raise notice 'PASS p2pr4: owner filed a disbursement request for EMP1, audited';
end $$;
set local role postgres;

-- ── SAD 1: worker with no payroll.manage cannot file ──
do $$ declare v_worker_auth uuid := '0d700000-0000-0000-0000-000000000d71';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  begin
    perform public.payroll_request_disbursement((select v_branch from g), (select v_emp1 from ge), 'Cycle X', 1, 0, null, 0);
    raise exception 'SAD1: a worker with no payroll.manage should be denied';
  exception when insufficient_privilege then
    raise notice 'PASS p2pr4: payroll_request_disbursement denied without payroll.manage';
  end;
end $$;
set local role postgres;

-- ── SAD 2: the SAME owner who filed cannot approve their own request ──
do $$ declare v_owner_auth uuid := '0c700000-0000-0000-0000-000000000c71'; v_req uuid;
begin
  select id into v_req from public.wage_disbursement_requests
   where company_id=(select v_company from g) and employee_id=(select v_emp1 from ge) and status='Pending';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_approve_disbursement_request(v_req, null);
    raise exception 'SAD2: the owner should not be able to approve their own disbursement request';
  exception when insufficient_privilege then
    raise notice 'PASS p2pr4: self-approval denied — the requester cannot decide their own disbursement request';
  end;
end $$;
set local role postgres;

-- ── HAPPY 2: a DIFFERENT manager (admin2) approves -> wage_payments created, journal balanced ──
do $$ declare v_admin2_auth uuid := '0d700000-0000-0000-0000-000000000d72'; v_req uuid; v_wage uuid; n int;
  v_debit numeric; v_credit numeric;
begin
  select id into v_req from public.wage_disbursement_requests
   where company_id=(select v_company from g) and employee_id=(select v_emp1 from ge) and status='Pending';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  v_wage := public.payroll_approve_disbursement_request(v_req, 'looks correct');
  if v_wage is null then raise exception 'HAPPY2: payroll_approve_disbursement_request returned null'; end if;
  set local role postgres;
  select count(*) into n from public.wage_disbursement_requests where id=v_req and status='Approved' and decided_by is not null and wage_payment_id=v_wage;
  if n<>1 then raise exception 'HAPPY2: request not correctly marked Approved with wage_payment_id linked'; end if;
  select count(*) into n from public.wage_payments where id=v_wage and gross=500 and net=500 and ca_deducted=0;
  if n<>1 then raise exception 'HAPPY2: wage_payments row not created with expected gross/net (500/500, 1 day x rate 500)'; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into v_debit, v_credit
    from public.journal_lines where journal_entry_id = (select journal_entry_id from public.wage_payments where id=v_wage);
  if v_debit <> v_credit or v_debit <> 500 then raise exception 'HAPPY2: journal not balanced (debit=%, credit=%)', v_debit, v_credit; end if;
  raise notice 'PASS p2pr4: a different manager approved — wage_payments created with correct gross/net, journal balanced (debit=credit=500)';
end $$;
set local role postgres;

-- ── SAD 3: approving an already-decided request again ──
do $$ declare v_admin2_auth uuid := '0d700000-0000-0000-0000-000000000d72'; v_req uuid;
begin
  select id into v_req from public.wage_disbursement_requests
   where company_id=(select v_company from g) and employee_id=(select v_emp1 from ge) and status='Approved';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  begin
    perform public.payroll_approve_disbursement_request(v_req, null);
    raise exception 'SAD3: deciding an already-decided disbursement request should be rejected';
  exception when raise_exception then
    raise notice 'PASS p2pr4: double-decision on an already-decided disbursement request denied';
  end;
end $$;
set local role postgres;

-- ── HAPPY 3 / SAD 4: file for EMP2, reject requires a reason, then succeeds with one ──
do $$ declare v_owner_auth uuid := '0c700000-0000-0000-0000-000000000c71'; v_admin2_auth uuid := '0d700000-0000-0000-0000-000000000d72';
  v_req uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_req := public.payroll_request_disbursement((select v_branch from g), (select v_emp2 from ge), 'Cycle 2', 1, 0, null, 0);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  begin
    perform public.payroll_reject_disbursement_request(v_req, '');
    raise exception 'SAD4: rejecting without a reason should be denied';
  exception when check_violation then
    raise notice 'PASS p2pr4: rejecting a disbursement request without a reason denied';
  end;
  perform public.payroll_reject_disbursement_request(v_req, 'wrong pay period, refile');
  set local role postgres;
  select count(*) into n from public.wage_disbursement_requests where id=v_req and status='Rejected' and decision_reason='wrong pay period, refile' and wage_payment_id is null;
  if n<>1 then raise exception 'HAPPY3: disbursement request not correctly rejected'; end if;
  select count(*) into n from public.wage_payments where employee_id=(select v_emp2 from ge);
  if n<>0 then raise exception 'HAPPY3: a rejected request must NOT create a wage_payments row, found %', n; end if;
  raise notice 'PASS p2pr4: disbursement request rejected with a required reason, no money moved';
end $$;
set local role postgres;

-- ── SAD 5: requested deduction exceeds the outstanding advance (zero, no advance taken) ──
do $$ declare v_owner_auth uuid := '0c700000-0000-0000-0000-000000000c71';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_disbursement((select v_branch from g), (select v_emp3 from ge), 'Cycle 3', 1, 100, null, 0);
    raise exception 'SAD5: a deduction exceeding the outstanding advance should be denied at file time';
  exception when check_violation then
    raise notice 'PASS p2pr4: deduction-exceeds-outstanding-advance denied at file time';
  end;
end $$;
set local role postgres;

-- ── SAD 6: days_worked <= 0 ──
do $$ declare v_owner_auth uuid := '0c700000-0000-0000-0000-000000000c71';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_disbursement((select v_branch from g), (select v_emp3 from ge), 'Cycle 3', 0, 0, null, 0);
    raise exception 'SAD6: zero days_worked should be denied';
  exception when check_violation then
    raise notice 'PASS p2pr4: zero/invalid days_worked denied';
  end;
end $$;
set local role postgres;

-- ── SAD 7: filing against an Inactive employee ──
do $$ declare v_owner_auth uuid := '0c700000-0000-0000-0000-000000000c71';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_disbursement((select v_branch from g), (select v_inactive from ge), 'Cycle 3', 1, 0, null, 0);
    raise exception 'SAD7: filing against an Inactive employee should be denied';
  exception when check_violation then
    raise notice 'PASS p2pr4: filing against an Inactive employee denied';
  end;
end $$;
set local role postgres;

-- ── SAD 8: re-validation at approval time — the outstanding advance is fully consumed by a
-- DIRECT disbursement (still callable) AFTER the request was filed but BEFORE it is decided. ──
do $$ declare v_owner_auth uuid := '0c700000-0000-0000-0000-000000000c71'; v_admin2_auth uuid := '0d700000-0000-0000-0000-000000000d72';
  v_req uuid; v_idem text := 'p2pr4-sad8';
begin
  -- give EMP3 a real advance of 500
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.payroll_record_cash_advance((select v_branch from g), (select v_emp3 from ge), 500, 'tools', v_idem || '-adv');

  -- file a disbursement request that deducts the FULL 500 (valid right now)
  v_req := public.payroll_request_disbursement((select v_branch from g), (select v_emp3 from ge), 'Cycle 3', 1, 500, null, 0);

  -- SEPARATELY, directly disburse (still-callable RPC) consuming the SAME advance in full — 2 days
  -- worked (gross 1000) so net (500) stays > 0, sidestepping an unrelated pre-existing edge case in
  -- payroll_disburse_wage where an exact net=0 disbursement violates journal_lines' check constraint
  -- (a (0,0) Cash line) — a real latent bug, flagged separately, not this migration's to fix.
  perform public.payroll_disburse_wage((select v_branch from g), (select v_emp3 from ge), 'Cycle 3 direct', 2, 500, 'direct disbursement eating the advance', v_idem || '-direct');

  -- now approving the ORIGINAL request must fail — the outstanding advance is 0, re-derived fresh
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  begin
    perform public.payroll_approve_disbursement_request(v_req, null);
    raise exception 'SAD8: approval should be denied — the outstanding advance was already fully consumed by a direct disbursement filed after this request';
  exception when check_violation then
    raise notice 'PASS p2pr4: approval re-validates the outstanding advance fresh at decision time, not trusting the value from file time';
  end;
end $$;
set local role postgres;

-- ── Cross-tenant: filing against a DIFFERENT company's employee (via this company's own branch) ──
do $$ declare v_owner_auth uuid := '0c700000-0000-0000-0000-000000000c71';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_disbursement((select v_branch from g), '0f700000-0000-0000-0000-000000000fe4', 'Cycle X', 1, 0, null, 0);
    raise exception 'CROSS-TENANT: filing against a different company''s employee should be rejected';
  exception when foreign_key_violation then
    raise notice 'PASS p2pr4: cross-tenant employee_id denied (employee not found in caller''s company)';
  end;
end $$;
set local role postgres;

-- ── list_disbursement_requests: owner sees the full company-wide history ──
do $$ declare v_owner_auth uuid := '0c700000-0000-0000-0000-000000000c71'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  select count(*) into n from public.list_disbursement_requests((select v_company from g), null, null);
  if n<3 then raise exception 'LIST: owner should see at least 3 disbursement requests, got %', n; end if;
  raise notice 'PASS p2pr4: list_disbursement_requests returns the company-wide history';
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on none of the 5 new functions; authenticated has all 5 ──
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('payroll_request_disbursement','payroll_approve_disbursement_request','payroll_reject_disbursement_request','list_pending_disbursement_requests','list_disbursement_requests');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a P2PR4 function (found % grants)', n; end if;
  raise notice 'PASS p2pr4: anon has no EXECUTE on any P2PR4 function';

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('payroll_request_disbursement','payroll_approve_disbursement_request','payroll_reject_disbursement_request','list_pending_disbursement_requests','list_disbursement_requests');
  if n<>5 then raise exception 'GRANT: expected authenticated to have EXECUTE on all 5 P2PR4 functions, found %', n; end if;
  raise notice 'PASS p2pr4: authenticated has EXECUTE on all 5 P2PR4 functions';
end $$;

rollback;
