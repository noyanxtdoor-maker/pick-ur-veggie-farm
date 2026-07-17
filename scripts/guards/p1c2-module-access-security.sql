-- Guard battery for P1C2 module-access overrides (Item C: merged 3-state permissions panel).
-- Ported from Team B's guard, adapted to our BEGIN/ROLLBACK convention (B's own version commits
-- permanent fixtures; ours rolls back so nothing persists between runs).
--
-- Verifies the migration adds + backfills modules correctly, the permission_modules view is
-- well-formed (one row per module), and the user_module_access() resolver returns the right state
-- for an employee (read-only via role), a co_owner (manage via role_permissions full catalog),
-- and after an explicit deny override.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- Bootstrap: owner (rank 50) + seed standard roles (employee/operator/admin/co_owner with catalog).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0a000000-0000-0000-0000-0000000000f1'::uuid, 'authenticated', 'authenticated', 'owner.p1c2@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-0000000000f1','Owner P1C2','P1C2CO','P1C2 Company','P1C2BR','P1C2 Branch');
  set local role postgres;
  perform public.seed_standard_roles((select id from public.companies where company_code='P1C2CO'));
end $$;

create temp table g as select
  (select id from public.companies where company_code='P1C2CO') as v_company,
  (select id from public.branches where branch_code='P1C2BR') as v_branch,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1C2CO') and role_key='co_owner') as v_co_role,
  null::uuid as v_op_role;

-- EMPLOYEE with ONLY pos.sell (a dedicated role, not the standard seed's employee, so we control
-- its exact key set for the assertion).
do $$ declare v_co uuid; v_role uuid; begin
  select v_company into v_co from g;
  insert into public.roles (company_id, role_key, description, rank)
    values (v_co, 'g_pos_only', 'Guard: pos.sell only', 10)
    returning id into v_role;
  insert into public.role_permissions (company_id, role_id, permission_id)
    select v_co, v_role, p.id from public.permissions p where p.permission_key = 'pos.sell';
  update g set v_op_role = v_role;
end $$;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000f2'::uuid, 'authenticated', 'authenticated', 'emp.p1c2@t.local');
do $$ declare v_emp uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000f2', 'Emp P1C2', 'emp.p1c2@t.local', 'emp_p1c2')
    on conflict (auth_user_id) do nothing;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000f2';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_emp, (select v_company from g), (select v_branch from g), (select v_op_role from g));
end $$;

-- CO_OWNER (full catalog via seed_standard_roles)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000f3'::uuid, 'authenticated', 'authenticated', 'co.p1c2@t.local');
do $$ declare v_co uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000f3', 'Co P1C2', 'co.p1c2@t.local', 'co_p1c2')
    on conflict (auth_user_id) do nothing;
  select id into v_co from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000f3';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_co, (select v_company from g), (select v_branch from g), (select v_co_role from g));
end $$;

-- ── HAPPY 1: permission_modules view has >= 8 distinct modules ──
do $$ declare n int; begin
  select count(distinct module) into n from public.permission_modules;
  if n < 8 then raise exception 'HAPPY1: permission_modules has % modules (expected >= 8)', n; end if;
  raise notice 'PASS p1c2: permission_modules view has % modules (>= 8)', n;
end $$;

-- ── HAPPY 2: employee with ONLY pos.sell -> user_module_access('pos') = 'view' ──
do $$ declare v_co uuid; v_emp uuid; v_access text; begin
  select v_company into v_co from g;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000f2';
  select public.user_module_access(v_co, v_emp, 'pos') into v_access;
  if v_access <> 'view' then raise exception 'HAPPY2: employee pos access = % (expected view)', v_access; end if;
  raise notice 'PASS p1c2: employee(pos.sell only) -> pos access = view';
end $$;

-- ── HAPPY 3: employee has NO accounting key -> user_module_access('accounting') = 'none' ──
do $$ declare v_co uuid; v_emp uuid; v_access text; begin
  select v_company into v_co from g;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000f2';
  select public.user_module_access(v_co, v_emp, 'accounting') into v_access;
  if v_access <> 'none' then raise exception 'HAPPY3: employee accounting access = % (expected none)', v_access; end if;
  raise notice 'PASS p1c2: employee(no accounting keys) -> accounting access = none';
end $$;

-- ── HAPPY 4: co_owner (full catalog) -> user_module_access('accounting') = 'manage' ──
do $$ declare v_coid uuid; v_co uuid; v_access text; begin
  select v_company into v_coid from g;
  select id into v_co from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000f3';
  select public.user_module_access(v_coid, v_co, 'accounting') into v_access;
  if v_access <> 'manage' then raise exception 'HAPPY4: co_owner accounting access = % (expected manage)', v_access; end if;
  raise notice 'PASS p1c2: co_owner(full catalog) -> accounting access = manage';
end $$;

-- ── SAD 1: explicit DENY on accounting.manage for co_owner -> access drops to 'view' (still has read) ──
do $$ declare v_coid uuid; v_co uuid; v_perm uuid; v_access text; begin
  select v_company into v_coid from g;
  select id into v_co from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000f3';
  select id into v_perm from public.permissions where permission_key='accounting.manage' and status='Active';
  insert into public.user_permission_overrides (company_id, user_id, permission_id, effect, created_by)
    values (v_coid, v_co, v_perm, 'deny', v_co);
  select public.user_module_access(v_coid, v_co, 'accounting') into v_access;
  if v_access <> 'view' then raise exception 'SAD1: co_owner with accounting.manage deny -> access = % (expected view)', v_access; end if;
  raise notice 'PASS p1c2: co_owner accounting.manage deny -> access drops to view';
end $$;

-- ── SAD 2: unknown module -> 'none' (no crash, no leakage) ──
do $$ declare v_co uuid; v_emp uuid; v_access text; begin
  select v_company into v_co from g;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000f2';
  select public.user_module_access(v_co, v_emp, 'nonexistent_module') into v_access;
  if v_access <> 'none' then raise exception 'SAD2: unknown module access = % (expected none)', v_access; end if;
  raise notice 'PASS p1c2: unknown module -> none';
end $$;

-- ── GRANT SHAPE: anon must NOT be able to call the resolver or read the view ──
do $$ begin
  set local role postgres;
  if has_function_privilege('anon', 'public.user_module_access(uuid,uuid,text)', 'execute') then
    raise exception 'DEFECT p1c2 grant-shape: anon can call user_module_access';
  end if;
  if has_table_privilege('anon', 'public.permission_modules', 'select') then
    raise exception 'DEFECT p1c2 grant-shape: anon can read permission_modules';
  end if;
  raise notice 'PASS p1c2: anon has neither EXECUTE on the resolver nor SELECT on the view';
end $$;

rollback;
