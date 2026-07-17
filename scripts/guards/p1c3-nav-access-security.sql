-- Guard battery for P1C3 (Section Access redesign + admin default narrowing).
-- Bootstraps one tenant the REAL way (seed_standard_roles, not hand-built fixtures) so the actual
-- server-authoritative role/permission distribution is what's under test.
--
-- Exercises:
--   HAPPY 1: admin (fresh, no overrides) resolves 'view' on the Approvals node (membership.approve
--            held via role, membership.manage not held).
--   HAPPY 2: admin resolves 'none' on Company/Branches/Roles/Members/Archived (all manage-key-only,
--            admin lacks all four manage keys by default).
--   HAPPY 3: admin has neither payroll.read nor payroll.manage (proves the DELETE backfill worked).
--   HAPPY 4: list_pending_users() succeeds for the admin actor (membership.approve is enough).
--   HAPPY 5: assign_membership_with_payroll(...) succeeds for the admin actor against a target with
--            ZERO active memberships (the approve path).
--   HAPPY 6: reject_pending_user(...) succeeds for the admin actor against a genuinely pending target.
--   HAPPY 7: after the OWNER grants membership.manage to the admin via override, user_key_tier flips
--            Approvals to 'manage' AND Members/Archived (sharing the same manage_key) to 'manage' too
--            — direct proof one key correctly serves three different tabs.
--   SAD 1: list_pending_users() raises for an employee actor (holds neither key).
--   SAD 2: assign_membership_with_payroll(...) raises for the admin actor against a target that
--          ALREADY has an active membership (the reassignment path stays locked to full manage).
--   SAD 3: set_user_permission_override(...) still raises for the admin actor (Access-dialog write
--          path stays locked to membership.manage, unchanged by this migration).
--   SAD 4 (Bug-A regression): an explicit deny override on membership.approve for a co_owner (who
--          holds it via the full-catalog role grant) makes user_key_tier resolve 'none', not 'view' —
--          proves the read-key-deny check was actually added to user_key_tier, not just manage-key.
--   GRANT SHAPE: anon has EXECUTE on none of user_key_tier, list_pending_users, reject_pending_user,
--          assign_membership_with_payroll.
-- Wrapped in BEGIN/ROLLBACK; does not mutate.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- Owner auth.users + bootstrap (owner rank 50, full catalog via seed_standard_roles).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0a000000-0000-0000-0000-0000000000c3'::uuid, 'authenticated', 'authenticated', 'owner.p1c3@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-0000000000c3','Owner P1C3','P1C3CO','P1C3 Company','P1C3BR','P1C3 Branch');
  set local role postgres;
  perform public.seed_standard_roles((select id from public.companies where company_code='P1C3CO'));
end $$;

create temp table g as select
  (select id from public.companies where company_code='P1C3CO') as v_company,
  (select id from public.branches where branch_code='P1C3BR') as v_branch,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1C3CO') and role_key='employee') as v_emp_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1C3CO') and role_key='admin') as v_admin_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1C3CO') and role_key='co_owner') as v_co_role;

-- ADMIN (rank 30, fresh — no overrides)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000c1'::uuid, 'authenticated', 'authenticated', 'admin.p1c3@t.local');
do $$ declare v_admin uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000c1', 'Admin P1C3', 'admin.p1c3@t.local', 'admin_p1c3')
    on conflict (auth_user_id) do nothing;
  select id into v_admin from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c1';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_admin, (select v_company from g), (select v_branch from g), (select v_admin_role from g));
end $$;

-- EMPLOYEE (rank 10 — holds neither membership.approve nor membership.manage)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000c2'::uuid, 'authenticated', 'authenticated', 'emp.p1c3@t.local');
do $$ declare v_emp uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000c2', 'Emp P1C3', 'emp.p1c3@t.local', 'emp_p1c3')
    on conflict (auth_user_id) do nothing;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c2';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_emp, (select v_company from g), (select v_branch from g), (select v_emp_role from g));
end $$;

-- PENDING signup (Active identity, zero memberships — genuine approve/reject target)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000c5'::uuid, 'authenticated', 'authenticated', 'pending.p1c3@t.local');
do $$ begin
  insert into public.users (auth_user_id, display_name, email, username, account_status)
    values ('0b000000-0000-0000-0000-0000000000c5', 'Pending P1C3', 'pending.p1c3@t.local', 'pending_p1c3', 'Active')
    on conflict (auth_user_id) do nothing;
end $$;

-- SECOND pending signup (separate target for HAPPY5's assign_membership_with_payroll call, so HAPPY6's
-- reject_pending_user doesn't collide with an already-approved target)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000c6'::uuid, 'authenticated', 'authenticated', 'pending2.p1c3@t.local');
do $$ begin
  insert into public.users (auth_user_id, display_name, email, username, account_status)
    values ('0b000000-0000-0000-0000-0000000000c6', 'Pending2 P1C3', 'pending2.p1c3@t.local', 'pending2_p1c3', 'Active')
    on conflict (auth_user_id) do nothing;
end $$;

-- ALREADY-A-MEMBER target (for SAD2's reassignment-path test)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000c7'::uuid, 'authenticated', 'authenticated', 'member.p1c3@t.local');
do $$ declare v_mem uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000c7', 'Member P1C3', 'member.p1c3@t.local', 'member_p1c3')
    on conflict (auth_user_id) do nothing;
  select id into v_mem from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c7';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_mem, (select v_company from g), (select v_branch from g), (select v_emp_role from g));
end $$;

-- ── HAPPY 1: admin resolves 'view' on Approvals (membership.approve via role) ──
do $$ declare v_co uuid; v_admin uuid; v_tier text; begin
  select v_company into v_co from g;
  select id into v_admin from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c1';
  select public.user_key_tier(v_co, v_admin, 'membership.approve', 'membership.manage') into v_tier;
  if v_tier <> 'view' then raise exception 'HAPPY1: admin approvals tier = % (expected view)', v_tier; end if;
  raise notice 'PASS p1c3: admin(membership.approve only) -> Approvals tier = view';
end $$;

-- ── HAPPY 2: admin resolves 'none' on Company/Branches/Roles/Members/Archived ──
do $$ declare v_co uuid; v_admin uuid; v_tier text; begin
  select v_company into v_co from g;
  select id into v_admin from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c1';
  select public.user_key_tier(v_co, v_admin, null, 'company.manage') into v_tier;
  if v_tier <> 'none' then raise exception 'HAPPY2a: admin company tier = % (expected none)', v_tier; end if;
  select public.user_key_tier(v_co, v_admin, null, 'branch.manage') into v_tier;
  if v_tier <> 'none' then raise exception 'HAPPY2b: admin branches tier = % (expected none)', v_tier; end if;
  select public.user_key_tier(v_co, v_admin, null, 'role.manage') into v_tier;
  if v_tier <> 'none' then raise exception 'HAPPY2c: admin roles tier = % (expected none)', v_tier; end if;
  select public.user_key_tier(v_co, v_admin, null, 'membership.manage') into v_tier;
  if v_tier <> 'none' then raise exception 'HAPPY2d: admin members/archived tier = % (expected none)', v_tier; end if;
  raise notice 'PASS p1c3: admin(no manage keys) -> Company/Branches/Roles/Members/Archived all = none';
end $$;

-- ── HAPPY 3: admin has neither payroll.read nor payroll.manage (DELETE backfill worked) ──
do $$ declare v_co uuid; v_admin_auth uuid := '0b000000-0000-0000-0000-0000000000c1'; v_ok boolean; begin
  select v_company into v_co from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  v_ok := public.has_permission(v_co, 'payroll.read');
  if v_ok then raise exception 'HAPPY3a: admin should NOT hold payroll.read'; end if;
  v_ok := public.has_permission(v_co, 'payroll.manage');
  if v_ok then raise exception 'HAPPY3b: admin should NOT hold payroll.manage'; end if;
  raise notice 'PASS p1c3: admin holds neither payroll.read nor payroll.manage (self-only by default)';
end $$;

-- ── HAPPY 4: list_pending_users() succeeds for the admin actor ──
do $$ declare v_admin_auth uuid := '0b000000-0000-0000-0000-0000000000c1'; n int; begin
  set local role postgres;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  select count(*) into n from public.list_pending_users();
  if n < 2 then raise exception 'HAPPY4: expected >= 2 pending signups visible to admin, got %', n; end if;
  raise notice 'PASS p1c3: list_pending_users() succeeds for admin (membership.approve is enough)';
end $$;

-- ── HAPPY 5: assign_membership_with_payroll(...) succeeds for admin against a ZERO-membership target ──
do $$ declare v_co uuid; v_br uuid; v_role uuid; v_target uuid; v_admin_auth uuid := '0b000000-0000-0000-0000-0000000000c1'; v_new uuid; begin
  set local role postgres;
  select v_company into v_co from g; select v_branch into v_br from g; select v_emp_role into v_role from g;
  select id into v_target from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c5';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  v_new := public.assign_membership_with_payroll(v_co, v_target, v_br, v_role, null, null, null, true);
  if v_new is null then raise exception 'HAPPY5: assign_membership_with_payroll returned null'; end if;
  raise notice 'PASS p1c3: admin(membership.approve) can approve a brand-new signup (no prior membership)';
end $$;

-- ── HAPPY 6: reject_pending_user(...) succeeds for admin against a genuinely pending target ──
do $$ declare v_target uuid; v_admin_auth uuid := '0b000000-0000-0000-0000-0000000000c1'; n int; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c6';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  perform public.reject_pending_user(v_target);
  set local role postgres;
  select count(*) into n from public.users where id=v_target and account_status='Suspended';
  if n<>1 then raise exception 'HAPPY6: target was not rejected (still not Suspended)'; end if;
  raise notice 'PASS p1c3: admin(membership.approve) can reject a genuinely pending signup';
end $$;

-- ── SAD 1: list_pending_users() raises for an employee actor (holds neither key) ──
do $$ declare v_emp_auth uuid := '0b000000-0000-0000-0000-0000000000c2'; begin
  set local role postgres;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  begin
    perform public.list_pending_users();
    raise exception 'SAD1: employee should not be able to list_pending_users';
  exception when insufficient_privilege then
    raise notice 'PASS p1c3: employee denied on list_pending_users (holds neither approve nor manage)';
  end;
end $$;

-- ── SAD 2: assign_membership_with_payroll(...) raises for admin against an ALREADY-A-MEMBER target ──
do $$ declare v_co uuid; v_br uuid; v_op_role uuid; v_target uuid; v_admin_auth uuid := '0b000000-0000-0000-0000-0000000000c1'; begin
  set local role postgres;
  select v_company into v_co from g; select v_branch into v_br from g;
  select id into v_op_role from public.roles where company_id=v_co and role_key='operator';
  select id into v_target from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c7';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  begin
    perform public.assign_membership_with_payroll(v_co, v_target, v_br, v_op_role, null, null, null, true);
    raise exception 'SAD2: admin(approve only) should not be able to reassign an existing member';
  exception when insufficient_privilege then
    raise notice 'PASS p1c3: admin(approve only) denied reassigning an existing member — membership.manage still required';
  end;
end $$;

-- ── SAD 3: set_user_permission_override(...) still raises for the admin actor ──
do $$ declare v_co uuid; v_admin uuid; v_target uuid; v_admin_auth uuid := '0b000000-0000-0000-0000-0000000000c1'; begin
  set local role postgres;
  select v_company into v_co from g;
  select id into v_admin from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c1';
  select id into v_target from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c2';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  begin
    perform public.set_user_permission_override(v_co, v_target, 'pos.void', 'grant');
    raise exception 'SAD3: admin(approve only) should not be able to write permission overrides';
  exception when insufficient_privilege then
    raise notice 'PASS p1c3: admin(approve only) still denied set_user_permission_override — membership.manage required, unchanged';
  end;
end $$;

-- ── SAD 4 (Bug-A regression): explicit deny on membership.approve for admin -> tier = none, not view.
-- Must run BEFORE HAPPY 7 grants admin membership.manage — a manage-key holder resolves 'manage'
-- regardless of the read key's state, so this only proves the read-key-deny check in isolation while
-- admin still holds ONLY the read key (its natural default state), nothing else. ──
do $$ declare v_co uuid; v_admin uuid; v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000c3'; v_tier text; begin
  set local role postgres;
  select v_company into v_co from g;
  select id into v_admin from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c1';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.set_user_permission_override(v_co, v_admin, 'membership.approve', 'deny');
  set local role postgres;
  select public.user_key_tier(v_co, v_admin, 'membership.approve', 'membership.manage') into v_tier;
  if v_tier <> 'none' then raise exception 'SAD4: admin with membership.approve explicitly denied -> tier = % (expected none)', v_tier; end if;
  raise notice 'PASS p1c3: explicit deny on the READ key correctly overrides a role-derived grant (Bug-A fix confirmed)';
  -- clear the deny again so HAPPY 7 (next) starts from a clean slate for the same user/key.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.set_user_permission_override(v_co, v_admin, 'membership.approve', null);
  set local role postgres;
end $$;

-- ── HAPPY 7: OWNER grants membership.manage to admin -> Approvals AND Members/Archived flip to manage ──
do $$ declare v_co uuid; v_admin uuid; v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000c3'; v_tier text; begin
  set local role postgres;
  select v_company into v_co from g;
  select id into v_admin from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000c1';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.set_user_permission_override(v_co, v_admin, 'membership.manage', 'grant');
  set local role postgres;
  select public.user_key_tier(v_co, v_admin, 'membership.approve', 'membership.manage') into v_tier;
  if v_tier <> 'manage' then raise exception 'HAPPY7a: admin approvals tier = % after grant (expected manage)', v_tier; end if;
  select public.user_key_tier(v_co, v_admin, null, 'membership.manage') into v_tier;
  if v_tier <> 'manage' then raise exception 'HAPPY7b: admin members/archived tier = % after grant (expected manage)', v_tier; end if;
  raise notice 'PASS p1c3: one membership.manage override upgrades Approvals AND Members/Archived to manage together';
end $$;

-- ── GRANT SHAPE: anon must NOT be able to call any of the touched/new functions ──
do $$ begin
  set local role postgres;
  if has_function_privilege('anon', 'public.user_key_tier(uuid,uuid,text,text)', 'execute') then
    raise exception 'DEFECT p1c3 grant-shape: anon can call user_key_tier';
  end if;
  if has_function_privilege('anon', 'public.list_pending_users()', 'execute') then
    raise exception 'DEFECT p1c3 grant-shape: anon can call list_pending_users';
  end if;
  if has_function_privilege('anon', 'public.reject_pending_user(uuid)', 'execute') then
    raise exception 'DEFECT p1c3 grant-shape: anon can call reject_pending_user';
  end if;
  if has_function_privilege('anon', 'public.assign_membership_with_payroll(uuid,uuid,uuid,uuid,text,uuid,numeric,boolean)', 'execute') then
    raise exception 'DEFECT p1c3 grant-shape: anon can call assign_membership_with_payroll';
  end if;
  raise notice 'PASS p1c3: anon has EXECUTE on none of user_key_tier / list_pending_users / reject_pending_user / assign_membership_with_payroll';
end $$;

rollback;
