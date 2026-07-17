-- Guard battery for P1C4 (role default-access editor — remove_role_permission RPC).
-- Bootstraps one tenant the REAL way (seed_standard_roles, not hand-built fixtures).
--
--   HAPPY1: owner removes accounting.manage from the admin role -> row gone, audit_events row
--           present, and a member CURRENTLY HOLDING the admin role immediately loses has_permission
--           for that key (proves the "live effect on current members" behavior, the whole point).
--   SAD1: employee (no role.manage) tries to remove -> insufficient_privilege.
--   SAD2: admin (lacks role.manage by its own P1C3 default) tries to remove from its own role ->
--         insufficient_privilege.
--   SAD3: co_owner (rank 40) tries to remove from the owner role (rank 50, does not outrank) ->
--         insufficient_privilege — proves the owner role is structurally unreachable.
--   SAD4: unknown/inactive permission key -> raise_exception.
--   GRANT SHAPE: anon has no EXECUTE.
-- Wrapped in BEGIN/ROLLBACK; does not mutate.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0a000000-0000-0000-0000-0000000000d9'::uuid, 'authenticated', 'authenticated', 'owner.p1c4@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-0000000000d9','Owner P1C4','P1C4CO','P1C4 Company','P1C4BR','P1C4 Branch');
  set local role postgres;
  perform public.seed_standard_roles((select id from public.companies where company_code='P1C4CO'));
end $$;

create temp table g as select
  (select id from public.companies where company_code='P1C4CO') as v_company,
  (select id from public.branches where branch_code='P1C4BR') as v_branch,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1C4CO') and role_key='admin') as v_admin_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1C4CO') and role_key='owner') as v_owner_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1C4CO') and role_key='employee') as v_emp_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1C4CO') and role_key='co_owner') as v_co_role;

-- ADMIN member (holds the role whose permission gets removed in HAPPY1)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000d1'::uuid, 'authenticated', 'authenticated', 'admin.p1c4@t.local');
do $$ declare v_admin uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000d1', 'Admin P1C4', 'admin.p1c4@t.local', 'admin_p1c4')
    on conflict (auth_user_id) do nothing;
  select id into v_admin from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000d1';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_admin, (select v_company from g), (select v_branch from g), (select v_admin_role from g));
end $$;

-- EMPLOYEE (no role.manage)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000d2'::uuid, 'authenticated', 'authenticated', 'emp.p1c4@t.local');
do $$ declare v_emp uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000d2', 'Emp P1C4', 'emp.p1c4@t.local', 'emp_p1c4')
    on conflict (auth_user_id) do nothing;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000d2';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_emp, (select v_company from g), (select v_branch from g), (select v_emp_role from g));
end $$;

-- CO_OWNER (rank 40 — cannot outrank owner, rank 50)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000d3'::uuid, 'authenticated', 'authenticated', 'co.p1c4@t.local');
do $$ declare v_co uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000d3', 'Co P1C4', 'co.p1c4@t.local', 'co_p1c4')
    on conflict (auth_user_id) do nothing;
  select id into v_co from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000d3';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_co, (select v_company from g), (select v_branch from g), (select v_co_role from g));
end $$;

-- ── HAPPY 1: owner removes accounting.manage from admin -> gone, audited, live on the current member ──
do $$ declare v_co uuid; v_role uuid; v_admin uuid; v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000d9';
  n int; v_ok boolean; begin
  select v_company into v_co from g;
  select v_admin_role into v_role from g;
  select id into v_admin from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000d1';

  -- precondition: admin still holds it via role before removal
  set local role postgres;
  select count(*) into n from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
    where rp.role_id = v_role and p.permission_key='accounting.manage';
  if n<>1 then raise exception 'HAPPY1 precondition: admin role should hold accounting.manage before removal'; end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.remove_role_permission(v_co, v_role, 'accounting.manage');

  set local role postgres;
  select count(*) into n from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
    where rp.role_id = v_role and p.permission_key='accounting.manage';
  if n<>0 then raise exception 'HAPPY1: accounting.manage row still present on admin role after removal'; end if;

  select count(*) into n from public.audit_events where event_type='role.permission_removed' and entity_id=v_role;
  if n<>1 then raise exception 'HAPPY1: role.permission_removed audit row missing'; end if;

  -- live effect: the CURRENT admin member immediately loses it (has_permission, not a cache)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', '0b000000-0000-0000-0000-0000000000d1')::text, true);
  v_ok := public.has_permission(v_co, 'accounting.manage');
  if v_ok then raise exception 'HAPPY1: admin member should have immediately lost accounting.manage'; end if;

  raise notice 'PASS p1c4: owner removed accounting.manage from admin -> row gone, audited, live effect on the current member confirmed';
end $$;

-- ── SAD 1: employee (no role.manage) cannot remove ──
do $$ declare v_co uuid; v_role uuid; v_emp_auth uuid := '0b000000-0000-0000-0000-0000000000d2'; begin
  set local role postgres;
  select v_company into v_co from g; select v_admin_role into v_role from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  begin
    perform public.remove_role_permission(v_co, v_role, 'pos.void');
    raise exception 'SAD1: employee should not be able to remove_role_permission';
  exception when insufficient_privilege then
    raise notice 'PASS p1c4: employee denied (no role.manage)';
  end;
end $$;

-- ── SAD 2: admin (lacks role.manage per its own P1C3 default) cannot remove from its own role ──
do $$ declare v_co uuid; v_role uuid; v_admin_auth uuid := '0b000000-0000-0000-0000-0000000000d1'; begin
  set local role postgres;
  select v_company into v_co from g; select v_admin_role into v_role from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  begin
    perform public.remove_role_permission(v_co, v_role, 'pos.void');
    raise exception 'SAD2: admin should not be able to remove_role_permission (lacks role.manage)';
  exception when insufficient_privilege then
    raise notice 'PASS p1c4: admin denied (lacks role.manage by its own P1C3 default)';
  end;
end $$;

-- ── SAD 3: co_owner (rank 40) cannot remove from the owner role (rank 50, does not outrank) ──
do $$ declare v_co uuid; v_role uuid; v_co_auth uuid := '0b000000-0000-0000-0000-0000000000d3'; begin
  set local role postgres;
  select v_company into v_co from g; select v_owner_role into v_role from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_co_auth)::text, true);
  begin
    perform public.remove_role_permission(v_co, v_role, 'membership.manage');
    raise exception 'SAD3: co_owner should not be able to remove from the owner role';
  exception when insufficient_privilege then
    raise notice 'PASS p1c4: co_owner denied removing from owner role (does not outrank rank 50) -- owner role structurally unreachable';
  end;
end $$;

-- ── SAD 4: unknown/inactive permission key ──
do $$ declare v_co uuid; v_role uuid; v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000d9'; begin
  set local role postgres;
  select v_company into v_co from g; select v_admin_role into v_role from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.remove_role_permission(v_co, v_role, 'nonexistent.key');
    raise exception 'SAD4: unknown permission key should have raised';
  exception when raise_exception then
    raise notice 'PASS p1c4: unknown permission key rejected';
  end;
end $$;

-- ── GRANT SHAPE ──
do $$ begin
  set local role postgres;
  if has_function_privilege('anon', 'public.remove_role_permission(uuid,uuid,text)', 'execute') then
    raise exception 'DEFECT p1c4 grant-shape: anon can call remove_role_permission';
  end if;
  raise notice 'PASS p1c4: anon has no EXECUTE on remove_role_permission';
end $$;

rollback;
