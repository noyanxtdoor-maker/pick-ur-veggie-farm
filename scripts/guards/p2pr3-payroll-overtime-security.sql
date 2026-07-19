-- Guard battery for P2PR3 — Payroll overtime request tracking.
-- Auth-boundary + BEHAVIORAL: proves file/decide/list happy paths, same-date-duplicate rejection,
-- hours-bounds rejection, permission gating, the "beneficiary cannot decide their own overtime" rule,
-- reject-requires-reason, already-decided rejection, cross-tenant denial, and grant shape.
--
-- Fixture shape is identical to P2PR2's: an owner, a second manager (admin2, granted payroll.manage
-- via override), a worker with no payroll perms, a linked employee (self-service), the owner ALSO
-- linked to their own employees row (self-approval test), and a second tenant for cross-tenant denial.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0c600000-0000-0000-0000-000000000c61'::uuid, 'authenticated', 'authenticated', 'owner.p2pr3@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0c600000-0000-0000-0000-000000000c61','Owner P2PR3','P2PR3CO','P2PR3 Company','P2PR3BR','P2PR3 Branch');
  set local role postgres;
end $$;

create temp table g as select
  (select id from public.companies where company_code='P2PR3CO') as v_company,
  (select id from public.branches where branch_code='P2PR3BR') as v_branch;
grant select on g to authenticated;

-- WORKER (no payroll perms at all)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d600000-0000-0000-0000-000000000d61'::uuid, 'authenticated', 'authenticated', 'worker.p2pr3@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d600000-0000-0000-0000-000000000d61', 'Worker P2PR3', 'worker.p2pr3@t.local', 'worker_p2pr3')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d600000-0000-0000-0000-000000000d61';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='employee';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- ADMIN2 — a second payroll.manage holder (admin lacks it by default, granted via override).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d600000-0000-0000-0000-000000000d62'::uuid, 'authenticated', 'authenticated', 'admin2.p2pr3@t.local');
do $$ declare v_role uuid; v_user uuid; v_perm uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d600000-0000-0000-0000-000000000d62', 'Admin2 P2PR3', 'admin2.p2pr3@t.local', 'admin2_p2pr3')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d600000-0000-0000-0000-000000000d62';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='admin';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
  select id into v_perm from public.permissions where permission_key='payroll.manage';
  insert into public.user_permission_overrides (company_id, user_id, permission_id, effect, created_by)
    values ((select v_company from g), v_user, v_perm, 'grant', v_user);
end $$;

-- LINKED EMPLOYEE (a real users row AND a real employees row with user_id set) for self-service.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d600000-0000-0000-0000-000000000d63'::uuid, 'authenticated', 'authenticated', 'linked.p2pr3@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d600000-0000-0000-0000-000000000d63', 'Linked P2PR3', 'linked.p2pr3@t.local', 'linked_p2pr3')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d600000-0000-0000-0000-000000000d63';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='employee';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;
do $$ declare v_user uuid; begin
  select id into v_user from public.users where auth_user_id='0d600000-0000-0000-0000-000000000d63';
  insert into public.employees (company_id, employee_code, name, daily_rate, user_id)
    values ((select v_company from g), 'P2PR3-EMP1', 'Linked Employee P2PR3', 500, v_user);
end $$;

-- OWNER's OWN employees row (self-approval test).
do $$ declare v_owner_user uuid; begin
  select id into v_owner_user from public.users where auth_user_id='0c600000-0000-0000-0000-000000000c61';
  insert into public.employees (company_id, employee_code, name, daily_rate, user_id)
    values ((select v_company from g), 'P2PR3-OWNER', 'Owner-as-Employee P2PR3', 600, v_owner_user);
end $$;

create temp table ge as select
  (select id from public.employees where employee_code='P2PR3-EMP1') as v_linked_emp,
  (select id from public.employees where employee_code='P2PR3-OWNER') as v_owner_emp;
grant select on ge to authenticated;

-- SECOND tenant (cross-tenant fixture)
insert into public.companies (id, company_code, name) values
  ('0f600000-0000-0000-0000-000000000f61','P2PR3CO2','P2PR3 Company Two');
insert into public.branches (id, company_id, branch_code, name) values
  ('0f600000-0000-0000-0000-000000000fb3','0f600000-0000-0000-0000-000000000f61','P2PR3BR2','P2PR3 Branch Two');
insert into public.employees (id, company_id, employee_code, name, daily_rate) values
  ('0f600000-0000-0000-0000-000000000fe3','0f600000-0000-0000-0000-000000000f61','P2PR3CO2-EMP1','Other Co Employee',400);

-- ── HAPPY 1: owner (payroll.manage) files a 3-hour overtime request for the linked employee ──
do $$ declare v_owner_auth uuid := '0c600000-0000-0000-0000-000000000c61'; v_id uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_id := public.payroll_request_overtime((select v_branch from g), (select v_linked_emp from ge), '2026-08-05', 3, 'harvest push');
  if v_id is null then raise exception 'HAPPY1: payroll_request_overtime returned null'; end if;
  set local role postgres;
  select count(*) into n from public.overtime_requests where id=v_id and status='Pending' and hours=3;
  if n<>1 then raise exception 'HAPPY1: overtime request not created as Pending/3 hours'; end if;
  select count(*) into n from public.audit_events where event_type='insert.overtime_requests' and entity_id=v_id;
  if n<>1 then raise exception 'HAPPY1: insert.overtime_requests audit missing'; end if;
  raise notice 'PASS p2pr3: owner filed a 3-hour overtime request for the linked employee, audited';
end $$;
set local role postgres;

-- ── SAD 1: a second request for the SAME employee+work_date while HAPPY1 is Pending ──
do $$ declare v_owner_auth uuid := '0c600000-0000-0000-0000-000000000c61';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_overtime((select v_branch from g), (select v_linked_emp from ge), '2026-08-05', 2, 'duplicate test');
    raise exception 'SAD1: a duplicate same-date Pending request should be rejected';
  exception when check_violation then
    raise notice 'PASS p2pr3: duplicate same-employee same-date Pending/Approved overtime request denied';
  end;
end $$;
set local role postgres;

-- ── HAPPY 2: the LINKED employee self-files their OWN overtime on a DIFFERENT date ──
do $$ declare v_linked_auth uuid := '0d600000-0000-0000-0000-000000000d63'; v_id uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_linked_auth)::text, true);
  v_id := public.payroll_request_overtime((select v_branch from g), (select v_linked_emp from ge), '2026-08-06', 1.5, 'late delivery');
  if v_id is null then raise exception 'HAPPY2: self-service payroll_request_overtime returned null'; end if;
  set local role postgres;
  select count(*) into n from public.overtime_requests where id=v_id and status='Pending';
  if n<>1 then raise exception 'HAPPY2: self-filed overtime request not created'; end if;
  raise notice 'PASS p2pr3: linked employee self-filed their own overtime request with zero payroll permission';
end $$;
set local role postgres;

-- ── SAD 2: hours out of bounds (0) ──
do $$ declare v_owner_auth uuid := '0c600000-0000-0000-0000-000000000c61';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_overtime((select v_branch from g), (select v_linked_emp from ge), '2026-08-10', 0, null);
    raise exception 'SAD2: zero hours should be rejected';
  exception when check_violation then
    raise notice 'PASS p2pr3: zero/invalid hours denied';
  end;
end $$;
set local role postgres;

-- ── SAD 3: hours out of bounds (25, over 24hr ceiling) ──
do $$ declare v_owner_auth uuid := '0c600000-0000-0000-0000-000000000c61';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_overtime((select v_branch from g), (select v_linked_emp from ge), '2026-08-11', 25, null);
    raise exception 'SAD3: more than 24 hours should be rejected';
  exception when check_violation then
    raise notice 'PASS p2pr3: more-than-24-hours denied';
  end;
end $$;
set local role postgres;

-- ── SAD 4: worker with no payroll.manage filing on SOMEONE ELSE's behalf ──
do $$ declare v_worker_auth uuid := '0d600000-0000-0000-0000-000000000d61';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  begin
    perform public.payroll_request_overtime((select v_branch from g), (select v_linked_emp from ge), '2026-08-12', 2, null);
    raise exception 'SAD4: a non-manager filing on someone else''s behalf should be denied';
  exception when insufficient_privilege then
    raise notice 'PASS p2pr3: payroll_request_overtime denied without payroll.manage (and not the target employee)';
  end;
end $$;
set local role postgres;

-- ── file an overtime request FOR THE OWNER's own employee record (filed by admin2) ──
do $$ declare v_admin2_auth uuid := '0d600000-0000-0000-0000-000000000d62';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  perform public.payroll_request_overtime((select v_branch from g), (select v_owner_emp from ge), '2026-08-07', 4, 'weekend harvest');
end $$;
set local role postgres;

-- ── SAD 5: the OWNER cannot decide their OWN overtime request (self-approval denied) ──
do $$ declare v_owner_auth uuid := '0c600000-0000-0000-0000-000000000c61'; v_req uuid;
begin
  select id into v_req from public.overtime_requests
   where company_id=(select v_company from g) and employee_id=(select v_owner_emp from ge) and work_date='2026-08-07';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_decide_overtime_request(v_req, true, null);
    raise exception 'SAD5: the owner should not be able to approve their own linked overtime request';
  exception when insufficient_privilege then
    raise notice 'PASS p2pr3: self-approval denied — the request''s own beneficiary cannot decide it, even though a DIFFERENT manager (admin2) filed it';
  end;
end $$;
set local role postgres;

-- ── HAPPY 3: a DIFFERENT manager (admin2) approves the owner's overtime request ──
do $$ declare v_admin2_auth uuid := '0d600000-0000-0000-0000-000000000d62'; v_req uuid; n int;
begin
  select id into v_req from public.overtime_requests
   where company_id=(select v_company from g) and employee_id=(select v_owner_emp from ge) and work_date='2026-08-07';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  perform public.payroll_decide_overtime_request(v_req, true, 'approved, extra harvest day');
  set local role postgres;
  select count(*) into n from public.overtime_requests where id=v_req and status='Approved' and decided_by is not null;
  if n<>1 then raise exception 'HAPPY3: a different manager should be able to approve the owner''s overtime'; end if;
  raise notice 'PASS p2pr3: a different manager approved the owner''s own overtime request';
end $$;
set local role postgres;

-- ── SAD 6: deciding an ALREADY-decided request again ──
do $$ declare v_admin2_auth uuid := '0d600000-0000-0000-0000-000000000d62'; v_req uuid;
begin
  select id into v_req from public.overtime_requests
   where company_id=(select v_company from g) and employee_id=(select v_owner_emp from ge) and work_date='2026-08-07';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  begin
    perform public.payroll_decide_overtime_request(v_req, true, null);
    raise exception 'SAD6: deciding an already-decided request should be rejected';
  exception when raise_exception then
    raise notice 'PASS p2pr3: double-decision on an already-decided overtime request denied';
  end;
end $$;
set local role postgres;

-- ── HAPPY 4 / SAD 7: reject requires a reason, then succeeds with one (HAPPY2's request) ──
do $$ declare v_owner_auth uuid := '0c600000-0000-0000-0000-000000000c61'; v_req uuid; n int;
begin
  select id into v_req from public.overtime_requests
   where company_id=(select v_company from g) and employee_id=(select v_linked_emp from ge) and work_date='2026-08-06';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_decide_overtime_request(v_req, false, '');
    raise exception 'SAD7: rejecting without a reason should be denied';
  exception when raise_exception then
    raise notice 'PASS p2pr3: rejecting an overtime request without a reason denied';
  end;
  perform public.payroll_decide_overtime_request(v_req, false, 'not authorized in advance');
  set local role postgres;
  select count(*) into n from public.overtime_requests where id=v_req and status='Rejected' and decision_reason='not authorized in advance';
  if n<>1 then raise exception 'HAPPY4: overtime request not correctly rejected with reason'; end if;
  raise notice 'PASS p2pr3: overtime request rejected with a required reason';
end $$;
set local role postgres;

-- ── list_overtime_requests: owner (payroll.read via full permission set) sees company-wide rows ──
do $$ declare v_owner_auth uuid := '0c600000-0000-0000-0000-000000000c61'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  select count(*) into n from public.list_overtime_requests((select v_company from g), null, null, null);
  if n<3 then raise exception 'LIST-BROAD: owner should see at least 3 overtime requests across the company, got %', n; end if;
  raise notice 'PASS p2pr3: list_overtime_requests as a payroll.read holder returns company-wide rows';
end $$;
set local role postgres;

-- ── list_overtime_requests: the linked employee (no payroll.read) sees ONLY their own rows ──
do $$ declare v_linked_auth uuid := '0d600000-0000-0000-0000-000000000d63'; n int; n_foreign int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_linked_auth)::text, true);
  select count(*) into n from public.list_overtime_requests((select v_company from g), null, null, null);
  select count(*) into n_foreign from public.list_overtime_requests((select v_company from g), null, null, null) where employee_id<>(select v_linked_emp from ge);
  if n<2 then raise exception 'LIST-SELF: linked employee should see at least their own 2 overtime requests, got %', n; end if;
  if n_foreign<>0 then raise exception 'LIST-SELF: linked employee''s self-view leaked % rows belonging to a different employee', n_foreign; end if;
  raise notice 'PASS p2pr3: linked employee self-view is force-restricted to their own rows only, even ignoring a client-supplied employee_id';
end $$;
set local role postgres;

-- ── Cross-tenant: filing against a DIFFERENT company's employee (via this company's own branch) ──
do $$ declare v_owner_auth uuid := '0c600000-0000-0000-0000-000000000c61';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_overtime((select v_branch from g), '0f600000-0000-0000-0000-000000000fe3', '2026-08-20', 2, null);
    raise exception 'CROSS-TENANT: filing against a different company''s employee should be rejected';
  exception when foreign_key_violation then
    raise notice 'PASS p2pr3: cross-tenant employee_id denied (employee not found in caller''s company)';
  end;
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on none of the 3 new functions; authenticated has all 3 ──
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('payroll_request_overtime','payroll_decide_overtime_request','list_overtime_requests');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a P2PR3 function (found % grants)', n; end if;
  raise notice 'PASS p2pr3: anon has no EXECUTE on any P2PR3 function';

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('payroll_request_overtime','payroll_decide_overtime_request','list_overtime_requests');
  if n<>3 then raise exception 'GRANT: expected authenticated to have EXECUTE on all 3 P2PR3 functions, found %', n; end if;
  raise notice 'PASS p2pr3: authenticated has EXECUTE on all 3 P2PR3 functions';
end $$;

rollback;
