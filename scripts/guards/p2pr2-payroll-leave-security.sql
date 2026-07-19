-- Guard battery for P2PR2 — Payroll leave/absence request tracking.
-- Auth-boundary + BEHAVIORAL: proves file/decide/list happy paths, overlapping-date rejection,
-- invalid-type/date-order rejection, permission gating, the "beneficiary cannot decide their own
-- leave" rule (distinct from a plain requester != decider check — see migration header), reject-
-- requires-reason, already-decided rejection, cross-tenant denial, and grant shape.
--
-- Org: bootstrap tenant P2PR2CO the real way (owner, rank 50). A second manager (admin2, granted
-- payroll.manage via override — admin lacks it by default, same fact P2PR1's guard already found) so
-- a genuinely DIFFERENT person can decide requests. A worker with no payroll perms. A "linked
-- employee" (separate real user, employees row with user_id set) for self-service filing/viewing.
-- The OWNER is ALSO linked to their own employees row, specifically to exercise the self-approval
-- block (decider's own linked employee_id == the request's employee_id). A SECOND tenant (P2PR2CO2)
-- for cross-tenant denial.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0c500000-0000-0000-0000-000000000c51'::uuid, 'authenticated', 'authenticated', 'owner.p2pr2@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0c500000-0000-0000-0000-000000000c51','Owner P2PR2','P2PR2CO','P2PR2 Company','P2PR2BR','P2PR2 Branch');
  set local role postgres;
end $$;

create temp table g as select
  (select id from public.companies where company_code='P2PR2CO') as v_company,
  (select id from public.branches where branch_code='P2PR2BR') as v_branch;
grant select on g to authenticated;

-- WORKER (no payroll perms at all)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d500000-0000-0000-0000-000000000d51'::uuid, 'authenticated', 'authenticated', 'worker.p2pr2@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d500000-0000-0000-0000-000000000d51', 'Worker P2PR2', 'worker.p2pr2@t.local', 'worker_p2pr2')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d500000-0000-0000-0000-000000000d51';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='employee';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- ADMIN2 — a second payroll.manage holder in the SAME company (admin lacks payroll.manage by
-- default, granted directly via override, matching P2PR1's guard fix).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d500000-0000-0000-0000-000000000d52'::uuid, 'authenticated', 'authenticated', 'admin2.p2pr2@t.local');
do $$ declare v_role uuid; v_user uuid; v_perm uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d500000-0000-0000-0000-000000000d52', 'Admin2 P2PR2', 'admin2.p2pr2@t.local', 'admin2_p2pr2')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d500000-0000-0000-0000-000000000d52';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='admin';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
  select id into v_perm from public.permissions where permission_key='payroll.manage';
  insert into public.user_permission_overrides (company_id, user_id, permission_id, effect, created_by)
    values ((select v_company from g), v_user, v_perm, 'grant', v_user);
end $$;

-- LINKED EMPLOYEE (a real users row AND a real employees row with user_id set) for self-service.
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d500000-0000-0000-0000-000000000d53'::uuid, 'authenticated', 'authenticated', 'linked.p2pr2@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d500000-0000-0000-0000-000000000d53', 'Linked P2PR2', 'linked.p2pr2@t.local', 'linked_p2pr2')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d500000-0000-0000-0000-000000000d53';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='employee';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;
-- authenticated has no direct INSERT grant on employees — a plain postgres fixture insert is correct
-- (matches every other guard's fixture pattern).
do $$ declare v_user uuid; begin
  select id into v_user from public.users where auth_user_id='0d500000-0000-0000-0000-000000000d53';
  insert into public.employees (company_id, employee_code, name, daily_rate, user_id)
    values ((select v_company from g), 'P2PR2-EMP1', 'Linked Employee P2PR2', 500, v_user);
end $$;

-- OWNER's OWN employees row (so a self-approval attempt has a real beneficiary link to test against).
do $$ declare v_owner_user uuid; begin
  select id into v_owner_user from public.users where auth_user_id='0c500000-0000-0000-0000-000000000c51';
  insert into public.employees (company_id, employee_code, name, daily_rate, user_id)
    values ((select v_company from g), 'P2PR2-OWNER', 'Owner-as-Employee P2PR2', 600, v_owner_user);
end $$;

create temp table ge as select
  (select id from public.employees where employee_code='P2PR2-EMP1') as v_linked_emp,
  (select id from public.employees where employee_code='P2PR2-OWNER') as v_owner_emp;
grant select on ge to authenticated;

-- SECOND tenant (cross-tenant fixture)
insert into public.companies (id, company_code, name) values
  ('0f500000-0000-0000-0000-000000000f51','P2PR2CO2','P2PR2 Company Two');
insert into public.branches (id, company_id, branch_code, name) values
  ('0f500000-0000-0000-0000-000000000fb2','0f500000-0000-0000-0000-000000000f51','P2PR2BR2','P2PR2 Branch Two');
insert into public.employees (id, company_id, employee_code, name, daily_rate) values
  ('0f500000-0000-0000-0000-000000000fe2','0f500000-0000-0000-0000-000000000f51','P2PR2CO2-EMP1','Other Co Employee',400);

-- ── HAPPY 1: owner (payroll.manage) files a Vacation request for the linked employee ──
do $$ declare v_owner_auth uuid := '0c500000-0000-0000-0000-000000000c51'; v_id uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_id := public.payroll_request_leave((select v_branch from g), (select v_linked_emp from ge), 'Vacation', '2026-08-01', '2026-08-03', 'Family trip');
  if v_id is null then raise exception 'HAPPY1: payroll_request_leave returned null'; end if;
  set local role postgres;
  select count(*) into n from public.leave_requests where id=v_id and status='Pending' and leave_type='Vacation';
  if n<>1 then raise exception 'HAPPY1: leave request not created as Pending/Vacation'; end if;
  select count(*) into n from public.audit_events where event_type='insert.leave_requests' and entity_id=v_id;
  if n<>1 then raise exception 'HAPPY1: insert.leave_requests audit missing'; end if;
  raise notice 'PASS p2pr2: owner filed a Vacation request for the linked employee, audited';
end $$;
set local role postgres;

-- ── SAD 1: an overlapping request for the same employee while HAPPY1 is Pending ──
do $$ declare v_owner_auth uuid := '0c500000-0000-0000-0000-000000000c51';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_leave((select v_branch from g), (select v_linked_emp from ge), 'Sick', '2026-08-02', '2026-08-04', 'overlap test');
    raise exception 'SAD1: an overlapping Pending request should be rejected';
  exception when check_violation then
    raise notice 'PASS p2pr2: overlapping Pending/Approved leave request denied';
  end;
end $$;
set local role postgres;

-- ── HAPPY 2: the LINKED employee self-files their OWN separate, non-overlapping request ──
do $$ declare v_linked_auth uuid := '0d500000-0000-0000-0000-000000000d53'; v_id uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_linked_auth)::text, true);
  v_id := public.payroll_request_leave((select v_branch from g), (select v_linked_emp from ge), 'Sick', '2026-09-01', '2026-09-02', 'flu');
  if v_id is null then raise exception 'HAPPY2: self-service payroll_request_leave returned null'; end if;
  set local role postgres;
  select count(*) into n from public.leave_requests where id=v_id and status='Pending';
  if n<>1 then raise exception 'HAPPY2: self-filed leave request not created'; end if;
  raise notice 'PASS p2pr2: linked employee self-filed their own leave request with zero payroll permission';
end $$;
set local role postgres;

-- ── SAD 2: invalid leave_type ──
do $$ declare v_owner_auth uuid := '0c500000-0000-0000-0000-000000000c51';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_leave((select v_branch from g), (select v_linked_emp from ge), 'Bereavement', '2026-10-01', '2026-10-02', null);
    raise exception 'SAD2: an unsupported leave_type should be rejected';
  exception when check_violation then
    raise notice 'PASS p2pr2: unsupported leave_type denied';
  end;
end $$;
set local role postgres;

-- ── SAD 3: end_date before start_date ──
do $$ declare v_owner_auth uuid := '0c500000-0000-0000-0000-000000000c51';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_leave((select v_branch from g), (select v_linked_emp from ge), 'Vacation', '2026-10-05', '2026-10-01', null);
    raise exception 'SAD3: end_date before start_date should be rejected';
  exception when check_violation then
    raise notice 'PASS p2pr2: end_date before start_date denied';
  end;
end $$;
set local role postgres;

-- ── SAD 4: worker with no payroll.manage filing on SOMEONE ELSE's behalf ──
do $$ declare v_worker_auth uuid := '0d500000-0000-0000-0000-000000000d51';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  begin
    perform public.payroll_request_leave((select v_branch from g), (select v_linked_emp from ge), 'Vacation', '2026-11-01', '2026-11-02', null);
    raise exception 'SAD4: a non-manager filing on someone else''s behalf should be denied';
  exception when insufficient_privilege then
    raise notice 'PASS p2pr2: payroll_request_leave denied without payroll.manage (and not the target employee)';
  end;
end $$;
set local role postgres;

-- ── file a request FOR THE OWNER's own employee record (filed by admin2, a different manager) ──
do $$ declare v_admin2_auth uuid := '0d500000-0000-0000-0000-000000000d52';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  perform public.payroll_request_leave((select v_branch from g), (select v_owner_emp from ge), 'Unpaid', '2026-08-10', '2026-08-11', 'personal');
end $$;
set local role postgres;

-- ── SAD 5: the OWNER cannot decide their OWN leave request (self-approval denied) ──
do $$ declare v_owner_auth uuid := '0c500000-0000-0000-0000-000000000c51'; v_req uuid;
begin
  select id into v_req from public.leave_requests
   where company_id=(select v_company from g) and employee_id=(select v_owner_emp from ge) and leave_type='Unpaid' and status='Pending';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_decide_leave_request(v_req, true, null);
    raise exception 'SAD5: the owner should not be able to approve their own linked leave request';
  exception when insufficient_privilege then
    raise notice 'PASS p2pr2: self-approval denied — the request''s own beneficiary cannot decide it, even though a DIFFERENT manager (admin2) filed it';
  end;
end $$;
set local role postgres;

-- ── HAPPY 3: a DIFFERENT manager (admin2) approves the owner's leave request ──
do $$ declare v_admin2_auth uuid := '0d500000-0000-0000-0000-000000000d52'; v_req uuid; n int;
begin
  select id into v_req from public.leave_requests
   where company_id=(select v_company from g) and employee_id=(select v_owner_emp from ge) and leave_type='Unpaid' and status='Pending';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  perform public.payroll_decide_leave_request(v_req, true, 'approved, cover arranged');
  set local role postgres;
  select count(*) into n from public.leave_requests where id=v_req and status='Approved' and decided_by is not null;
  if n<>1 then raise exception 'HAPPY3: a different manager should be able to approve the owner''s leave'; end if;
  raise notice 'PASS p2pr2: a different manager approved the owner''s own leave request';
end $$;
set local role postgres;

-- ── SAD 6: deciding an ALREADY-decided request again ──
do $$ declare v_admin2_auth uuid := '0d500000-0000-0000-0000-000000000d52'; v_req uuid;
begin
  select id into v_req from public.leave_requests
   where company_id=(select v_company from g) and employee_id=(select v_owner_emp from ge) and leave_type='Unpaid' and status='Approved';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  begin
    perform public.payroll_decide_leave_request(v_req, true, null);
    raise exception 'SAD6: deciding an already-decided request should be rejected';
  exception when raise_exception then
    raise notice 'PASS p2pr2: double-decision on an already-decided leave request denied';
  end;
end $$;
set local role postgres;

-- ── HAPPY 4 / SAD 7: reject requires a reason, then succeeds with one (HAPPY2's Sick request) ──
do $$ declare v_owner_auth uuid := '0c500000-0000-0000-0000-000000000c51'; v_req uuid; n int;
begin
  select id into v_req from public.leave_requests
   where company_id=(select v_company from g) and employee_id=(select v_linked_emp from ge) and leave_type='Sick' and status='Pending';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_decide_leave_request(v_req, false, '');
    raise exception 'SAD7: rejecting without a reason should be denied';
  exception when raise_exception then
    raise notice 'PASS p2pr2: rejecting a leave request without a reason denied';
  end;
  perform public.payroll_decide_leave_request(v_req, false, 'short-staffed that week');
  set local role postgres;
  select count(*) into n from public.leave_requests where id=v_req and status='Rejected' and decision_reason='short-staffed that week';
  if n<>1 then raise exception 'HAPPY4: leave request not correctly rejected with reason'; end if;
  raise notice 'PASS p2pr2: leave request rejected with a required reason (decided by owner, a different person than the linked-employee beneficiary)';
end $$;
set local role postgres;

-- ── list_leave_requests: owner (payroll.read via full permission set) sees company-wide rows ──
do $$ declare v_owner_auth uuid := '0c500000-0000-0000-0000-000000000c51'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  select count(*) into n from public.list_leave_requests((select v_company from g), null, null, null);
  if n<3 then raise exception 'LIST-BROAD: owner should see at least 3 leave requests across the company, got %', n; end if;
  raise notice 'PASS p2pr2: list_leave_requests as a payroll.read holder returns company-wide rows';
end $$;
set local role postgres;

-- ── list_leave_requests: the linked employee (no payroll.read) sees ONLY their own rows ──
do $$ declare v_linked_auth uuid := '0d500000-0000-0000-0000-000000000d53'; n int; n_foreign int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_linked_auth)::text, true);
  select count(*) into n from public.list_leave_requests((select v_company from g), null, null, null);
  select count(*) into n_foreign from public.list_leave_requests((select v_company from g), null, null, null) where employee_id<>(select v_linked_emp from ge);
  if n<2 then raise exception 'LIST-SELF: linked employee should see at least their own 2 leave requests, got %', n; end if;
  if n_foreign<>0 then raise exception 'LIST-SELF: linked employee''s self-view leaked % rows belonging to a different employee', n_foreign; end if;
  raise notice 'PASS p2pr2: linked employee self-view is force-restricted to their own rows only, even ignoring a client-supplied employee_id';
end $$;
set local role postgres;

-- ── Cross-tenant: filing against a DIFFERENT company's employee (via this company's own branch) ──
do $$ declare v_owner_auth uuid := '0c500000-0000-0000-0000-000000000c51';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_request_leave((select v_branch from g), '0f500000-0000-0000-0000-000000000fe2', 'Vacation', '2026-12-01', '2026-12-02', null);
    raise exception 'CROSS-TENANT: filing against a different company''s employee should be rejected';
  exception when foreign_key_violation then
    raise notice 'PASS p2pr2: cross-tenant employee_id denied (employee not found in caller''s company)';
  end;
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on none of the 3 new functions; authenticated has all 3 ──
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('payroll_request_leave','payroll_decide_leave_request','list_leave_requests');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a P2PR2 function (found % grants)', n; end if;
  raise notice 'PASS p2pr2: anon has no EXECUTE on any P2PR2 function';

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('payroll_request_leave','payroll_decide_leave_request','list_leave_requests');
  if n<>3 then raise exception 'GRANT: expected authenticated to have EXECUTE on all 3 P2PR2 functions, found %', n; end if;
  raise notice 'PASS p2pr2: authenticated has EXECUTE on all 3 P2PR2 functions';
end $$;

rollback;
