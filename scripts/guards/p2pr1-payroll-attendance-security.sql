-- Guard battery for P2PR1 — Payroll attendance/shift tracking.
-- Auth-boundary + BEHAVIORAL: proves record/correct/list happy paths, one-row-per-day upsert
-- semantics, permission gating, clock_out-before-clock_in rejection, invalid status rejection,
-- cross-tenant employee rejection, self-view for a linked employee (own rows only), and grant shape.
--
-- Org: bootstrap tenant P2PR1CO the real way (owner, rank 50), one employee linked to a real user
-- account (so the self-view path is genuinely exercised, not simulated). A SECOND tenant (P2PR1CO2)
-- for cross-tenant denial.
-- Exercise:
--   HAPPY 1: ADMIN (payroll.manage) records 'Present' for the employee on a work_date -> row exists,
--            audited via the generic inventory_audit() trigger.
--   HAPPY 2: ADMIN corrects the SAME (employee, work_date) to 'Half Day' -> still exactly one row
--            (upsert, not a duplicate), status updated.
--   HAPPY 3: list_attendance() as ADMIN returns the corrected row with the employee's name joined.
--   HAPPY 4: the LINKED employee (self-view, no payroll.read at all) sees their own attendance via
--            list_attendance() — proves the self-view path works end to end, not just structurally.
--   SAD 1: clock_out before clock_in -> check_violation.
--   SAD 2: invalid status ('On Leave' — not yet a supported value, deliberately, since leave tracking
--          is a separate not-yet-built sub-item) -> check_violation.
--   SAD 3: employee_id belongs to a DIFFERENT company -> foreign_key_violation.
--   SAD 4: a holder with no payroll.manage cannot record attendance -> insufficient_privilege.
--   SAD 5: a holder with no payroll.read (and not the linked employee) cannot list another
--          employee's attendance -> insufficient_privilege.
--   Cross-tenant: second company's payroll.manage holder cannot record attendance against P2PR1CO's
--     employee (foreign_key_violation — the employee genuinely doesn't exist in their company).
--   Grant shape: anon has EXECUTE on neither new function; authenticated has EXECUTE on both.
-- Wrapped in BEGIN/ROLLBACK; does not mutate (reset re-seeds on next run).
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0c400000-0000-0000-0000-000000000c41'::uuid, 'authenticated', 'authenticated', 'owner.p2pr1@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0c400000-0000-0000-0000-000000000c41','Owner P2PR1','P2PR1CO','P2PR1 Company','P2PR1BR','P2PR1 Branch');
  set local role postgres;
end $$;

create temp table g as select
  (select id from public.companies where company_code='P2PR1CO') as v_company,
  (select id from public.branches where branch_code='P2PR1BR') as v_branch;
grant select on g to authenticated;

-- WORKER (no payroll perms at all) for SAD 4/5
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d400000-0000-0000-0000-000000000d41'::uuid, 'authenticated', 'authenticated', 'worker.p2pr1@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d400000-0000-0000-0000-000000000d41', 'Worker P2PR1', 'worker.p2pr1@t.local', 'worker_p2pr1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d400000-0000-0000-0000-000000000d41';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='employee';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- LINKED EMPLOYEE (a real users row AND a real employees row with user_id set) for HAPPY 4
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d400000-0000-0000-0000-000000000d42'::uuid, 'authenticated', 'authenticated', 'linked.p2pr1@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d400000-0000-0000-0000-000000000d42', 'Linked P2PR1', 'linked.p2pr1@t.local', 'linked_p2pr1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d400000-0000-0000-0000-000000000d42';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='employee';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- The employees row itself, linked to the "linked" user above. authenticated has no direct INSERT
-- grant on employees (writes go through an RPC not under test here) — a plain postgres fixture
-- insert is the correct pattern, matching how every other guard seeds fixture data.
do $$ declare v_user uuid; begin
  select id into v_user from public.users where auth_user_id='0d400000-0000-0000-0000-000000000d42';
  insert into public.employees (company_id, employee_code, name, daily_rate, user_id)
    values ((select v_company from g), 'P2PR1-EMP1', 'Linked Employee P2PR1', 500, v_user);
end $$;
create temp table ge as select id as v_emp from public.employees where employee_code='P2PR1-EMP1';
grant select on ge to authenticated;

-- SECOND tenant (cross-tenant fixture)
insert into public.companies (id, company_code, name) values
  ('0f400000-0000-0000-0000-000000000f41','P2PR1CO2','P2PR1 Company Two');
insert into public.branches (id, company_id, branch_code, name) values
  ('0f400000-0000-0000-0000-000000000fb1','0f400000-0000-0000-0000-000000000f41','P2PR1BR2','P2PR1 Branch Two');
do $$ begin
  set local role service_role;
  perform public.seed_standard_roles('0f400000-0000-0000-0000-000000000f41');
  set local role postgres;
end $$;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d400000-0000-0000-0000-000000000d43'::uuid, 'authenticated', 'authenticated', 'admin2.p2pr1@t.local');
do $$ declare v_role uuid; v_user uuid; v_perm uuid; v_co2 uuid := '0f400000-0000-0000-0000-000000000f41'; v_br2 uuid := '0f400000-0000-0000-0000-000000000fb1'; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d400000-0000-0000-0000-000000000d43', 'Admin P2PR1 Two', 'admin2.p2pr1@t.local', 'admin2_p2pr1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d400000-0000-0000-0000-000000000d43';
  select id into v_role from public.roles where company_id=v_co2 and role_key='admin';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, v_co2, v_br2, v_role);
  -- admin does NOT get payroll.manage by default (only owner/co_owner do) — grant it directly via
  -- override so the cross-tenant test below genuinely reaches the employee-lookup check, not just
  -- redundantly re-proving SAD4's permission denial.
  select id into v_perm from public.permissions where permission_key='payroll.manage';
  insert into public.user_permission_overrides (company_id, user_id, permission_id, effect, created_by)
    values (v_co2, v_user, v_perm, 'grant', v_user);
end $$;

-- ── HAPPY 1: owner (payroll.manage) records Present for a work_date ─
do $$ declare v_owner_auth uuid := '0c400000-0000-0000-0000-000000000c41'; v_id uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_id := public.payroll_record_attendance((select v_branch from g), (select v_emp from ge), '2026-07-20', 'Present');
  if v_id is null then raise exception 'HAPPY1: payroll_record_attendance returned null'; end if;
  set local role postgres;
  select count(*) into n from public.attendance_records where id=v_id and status='Present';
  if n<>1 then raise exception 'HAPPY1: attendance row not created with status Present'; end if;
  select count(*) into n from public.audit_events where event_type='insert.attendance_records' and entity_id=v_id;
  if n<>1 then raise exception 'HAPPY1: insert.attendance_records audit missing'; end if;
  raise notice 'PASS p2pr1: owner recorded Present attendance, audited via the generic trigger';
end $$;
set local role postgres;

-- ── HAPPY 2: owner corrects the SAME (employee, work_date) to Half Day -> upsert, not a duplicate ─
do $$ declare v_owner_auth uuid := '0c400000-0000-0000-0000-000000000c41'; v_id uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_id := public.payroll_record_attendance((select v_branch from g), (select v_emp from ge), '2026-07-20', 'Half Day');
  set local role postgres;
  select count(*) into n from public.attendance_records where company_id=(select v_company from g) and employee_id=(select v_emp from ge) and work_date='2026-07-20';
  if n<>1 then raise exception 'HAPPY2: expected exactly 1 row for this employee+date after correction, got %', n; end if;
  select count(*) into n from public.attendance_records where id=v_id and status='Half Day';
  if n<>1 then raise exception 'HAPPY2: status not updated to Half Day'; end if;
  raise notice 'PASS p2pr1: correcting the same employee+date upserts (still exactly 1 row), status updated';
end $$;
set local role postgres;

-- ── HAPPY 3: list_attendance() as owner returns the corrected row with employee name joined ─
do $$ declare v_owner_auth uuid := '0c400000-0000-0000-0000-000000000c41'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  select count(*) into n from public.list_attendance((select v_company from g), (select v_branch from g), (select v_emp from ge), null, null)
   where employee_name='Linked Employee P2PR1' and status='Half Day' and work_date='2026-07-20';
  if n<>1 then raise exception 'HAPPY3: list_attendance did not return the expected row with employee name joined'; end if;
  raise notice 'PASS p2pr1: list_attendance() returns the corrected row with the employee name joined';
end $$;
set local role postgres;

-- ── HAPPY 4: the LINKED employee (no payroll.read) sees their own attendance via self-view ─
do $$ declare v_linked_auth uuid := '0d400000-0000-0000-0000-000000000d42'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_linked_auth)::text, true);
  select count(*) into n from public.list_attendance((select v_company from g), (select v_branch from g), null, null, null);
  if n<>1 then raise exception 'HAPPY4: linked employee self-view should see exactly their own 1 attendance row, got %', n; end if;
  raise notice 'PASS p2pr1: linked employee (no payroll.read at all) sees their own attendance via self-view';
end $$;
set local role postgres;

-- ── SAD 1: clock_out before clock_in ─
do $$ declare v_owner_auth uuid := '0c400000-0000-0000-0000-000000000c41';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_record_attendance((select v_branch from g), (select v_emp from ge), '2026-07-21', 'Present', '2026-07-21 17:00:00+00', '2026-07-21 08:00:00+00');
    raise exception 'SAD1: clock_out before clock_in should be rejected';
  exception when check_violation then
    raise notice 'PASS p2pr1: clock_out before clock_in denied';
  end;
end $$;
set local role postgres;

-- ── SAD 2: invalid status (leave tracking deliberately not yet built) ─
do $$ declare v_owner_auth uuid := '0c400000-0000-0000-0000-000000000c41';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_record_attendance((select v_branch from g), (select v_emp from ge), '2026-07-21', 'On Leave');
    raise exception 'SAD2: an unsupported status should be rejected';
  exception when check_violation then
    raise notice 'PASS p2pr1: unsupported status denied — only Present/Half Day/Absent are valid today';
  end;
end $$;
set local role postgres;

-- ── SAD 3: employee_id belongs to a different company ─
do $$ declare v_owner_auth uuid := '0c400000-0000-0000-0000-000000000c41'; v_other_emp uuid;
begin
  insert into public.employees (company_id, employee_code, name, daily_rate)
    values ('0f400000-0000-0000-0000-000000000f41', 'P2PR1CO2-EMP1', 'Other Co Employee', 400)
    returning id into v_other_emp;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.payroll_record_attendance((select v_branch from g), v_other_emp, '2026-07-21', 'Present');
    raise exception 'SAD3: recording attendance for a cross-company employee should be rejected';
  exception when foreign_key_violation then
    raise notice 'PASS p2pr1: cross-company employee_id denied';
  end;
end $$;
set local role postgres;

-- ── SAD 4: no payroll.manage ─
do $$ declare v_worker_auth uuid := '0d400000-0000-0000-0000-000000000d41';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  begin
    perform public.payroll_record_attendance((select v_branch from g), (select v_emp from ge), '2026-07-21', 'Present');
    raise exception 'SAD4: a holder with no payroll.manage should be denied';
  exception when insufficient_privilege then
    raise notice 'PASS p2pr1: payroll_record_attendance denied without payroll.manage';
  end;
end $$;
set local role postgres;

-- ── SAD 5: no payroll.read and not the linked employee ─
do $$ declare v_worker_auth uuid := '0d400000-0000-0000-0000-000000000d41';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  begin
    perform public.list_attendance((select v_company from g), (select v_branch from g), (select v_emp from ge), null, null);
    raise exception 'SAD5: a holder with no payroll.read (and not the linked employee) should be denied';
  exception when insufficient_privilege then
    raise notice 'PASS p2pr1: list_attendance denied without payroll.read and no linked employee record';
  end;
end $$;
set local role postgres;

-- ── Cross-tenant: second company's payroll.manage holder cannot record against P2PR1CO's employee ─
do $$ declare v_admin2_auth uuid := '0d400000-0000-0000-0000-000000000d43';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  begin
    perform public.payroll_record_attendance('0f400000-0000-0000-0000-000000000fb1', (select v_emp from ge), '2026-07-21', 'Present');
    raise exception 'CROSS-TENANT: second company''s admin should not resolve P2PR1CO''s employee at all';
  exception when foreign_key_violation then
    raise notice 'PASS p2pr1: cross-tenant attendance recording denied (employee not found in caller''s company)';
  end;
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on neither function; authenticated has EXECUTE on both ─
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('payroll_record_attendance','list_attendance');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a P2PR1 function (found % grants)', n; end if;
  raise notice 'PASS p2pr1: anon has no EXECUTE on either P2PR1 function';

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('payroll_record_attendance','list_attendance');
  if n<>2 then raise exception 'GRANT: expected authenticated to have EXECUTE on both P2PR1 functions, found %', n; end if;
  raise notice 'PASS p2pr1: authenticated has EXECUTE on both P2PR1 functions';
end $$;

rollback;
