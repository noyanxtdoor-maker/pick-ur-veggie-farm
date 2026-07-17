-- Guard for P1H.1 — employee and operator gain project.read via seed_standard_roles(); project.manage
-- stays admin+ only (unchanged). Owner: "all roles have permission to read but admin and above only
-- have permission to manage" (Project Checklist).
-- Bootstraps one tenant the REAL way (seed_standard_roles, not hand-built fixtures) so the actual
-- server-authoritative role/permission distribution is what's under test, not a guard-only fixture.
-- Wrapped in BEGIN/ROLLBACK; does not mutate.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0a000000-0000-0000-0000-0000000000a3'::uuid, 'authenticated', 'authenticated', 'owner.p1h1@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-0000000000a3','Owner P1H1','P1H1CO','P1H1 Company','P1H1BR','P1H1 Branch');
  set local role postgres;
  perform public.seed_standard_roles((select id from public.companies where company_code='P1H1CO'));
end $$;

create temp table g as select
  (select id from public.companies where company_code='P1H1CO') as v_company,
  (select id from public.branches where branch_code='P1H1BR') as v_branch,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1H1CO') and role_key='employee') as v_emp_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1H1CO') and role_key='operator') as v_op_role;

-- EMPLOYEE
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000e1'::uuid, 'authenticated', 'authenticated', 'emp.p1h1@t.local');
do $$ declare v_emp uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000e1', 'Emp P1H1', 'emp.p1h1@t.local', 'emp_p1h1')
    on conflict (auth_user_id) do nothing;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000e1';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_emp, (select v_company from g), (select v_branch from g), (select v_emp_role from g));
end $$;

-- OPERATOR
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000e2'::uuid, 'authenticated', 'authenticated', 'op.p1h1@t.local');
do $$ declare v_op uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000e2', 'Op P1H1', 'op.p1h1@t.local', 'op_p1h1')
    on conflict (auth_user_id) do nothing;
  select id into v_op from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000e2';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_op, (select v_company from g), (select v_branch from g), (select v_op_role from g));
end $$;

-- ── HAPPY 1: employee has project.read ──
do $$ declare v_co uuid; v_ok boolean; v_auth uuid := '0b000000-0000-0000-0000-0000000000e1'; begin
  select v_company into v_co from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  v_ok := public.has_permission(v_co, 'project.read');
  if not v_ok then raise exception 'HAPPY1: employee should hold project.read'; end if;
  raise notice 'PASS p1h1: employee holds project.read';
end $$;

-- ── HAPPY 2: operator has project.read ──
do $$ declare v_co uuid; v_ok boolean; v_auth uuid := '0b000000-0000-0000-0000-0000000000e2'; begin
  set local role postgres;
  select v_company into v_co from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  v_ok := public.has_permission(v_co, 'project.read');
  if not v_ok then raise exception 'HAPPY2: operator should hold project.read'; end if;
  raise notice 'PASS p1h1: operator holds project.read';
end $$;

-- ── SAD 1: employee does NOT have project.manage ──
do $$ declare v_co uuid; v_ok boolean; v_auth uuid := '0b000000-0000-0000-0000-0000000000e1'; begin
  set local role postgres;
  select v_company into v_co from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  v_ok := public.has_permission(v_co, 'project.manage');
  if v_ok then raise exception 'SAD1: employee should NOT hold project.manage'; end if;
  raise notice 'PASS p1h1: employee does not hold project.manage';
end $$;

-- ── SAD 2: operator does NOT have project.manage ──
do $$ declare v_co uuid; v_ok boolean; v_auth uuid := '0b000000-0000-0000-0000-0000000000e2'; begin
  set local role postgres;
  select v_company into v_co from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  v_ok := public.has_permission(v_co, 'project.manage');
  if v_ok then raise exception 'SAD2: operator should NOT hold project.manage'; end if;
  raise notice 'PASS p1h1: operator does not hold project.manage';
end $$;

rollback;
