-- Guard battery for P2ED1 — Equipment depreciation / asset book-value tracking.
-- Auth-boundary + BEHAVIORAL: proves the straight-line book-value math (partial + fully depreciated
-- + unconfigured), permission gating, salvage-value bound, positive-useful-life bound, unknown-asset
-- denial, cross-tenant denial, and grant shape.
--
-- Org: bootstrap tenant P2ED1CO the real way (owner, rank 50), one equipment asset bought via the
-- real inventory_record_purchase() RPC with p_is_equipment=true (not a raw insert) so purchase_cost/
-- purchase_date come from a realistic path. A SECOND tenant (P2ED1CO2) for cross-tenant denial.
-- Exercise:
--   HAPPY 1: set useful_life_months=12, salvage_value=0 on an asset purchased exactly 6 calendar
--            months ago (purchase_date backdated directly as postgres, matching how a real receipt
--            could be logged with a past date) -> equipment_book_value ~= half of purchase_cost
--            (12000 -> ~6000), within a small tolerance for the age()/day-count boundary.
--   HAPPY 2: an asset purchased 24 months ago with useful_life_months=12 -> book value == salvage_value
--            exactly (floors, never goes negative or below salvage even though 24 > 12 months elapsed).
--   HAPPY 3: an asset with useful_life_months left unset (never configured) -> book value ==
--            purchase_cost unchanged, not zero, not null.
--   SAD 1: salvage_value > purchase_cost -> check_violation.
--   SAD 2: useful_life_months = 0 -> check_violation (must be a positive number of months).
--   SAD 3: a holder with no equipment.manage cannot call equipment_set_depreciation -> insufficient_privilege.
--   SAD 4: unknown asset id -> raise_exception.
--   Cross-tenant: second company's equipment.manage holder cannot set depreciation on P2ED1CO's asset
--     (has_permission checks company membership internally — proves this composes correctly, not just
--     "no permission key at all").
--   Grant shape: anon has EXECUTE on neither new function; authenticated has EXECUTE on both.
-- Wrapped in BEGIN/ROLLBACK; does not mutate (reset re-seeds on next run).
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0c300000-0000-0000-0000-000000000c31'::uuid, 'authenticated', 'authenticated', 'owner.p2ed1@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0c300000-0000-0000-0000-000000000c31','Owner P2ED1','P2ED1CO','P2ED1 Company','P2ED1BR','P2ED1 Branch');
  set local role postgres;
end $$;

create temp table g as select
  (select id from public.companies where company_code='P2ED1CO') as v_company,
  (select id from public.branches where branch_code='P2ED1BR') as v_branch;
grant select on g to authenticated;

-- EMPLOYEE (no equipment.manage) for SAD 3
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d300000-0000-0000-0000-000000000d31'::uuid, 'authenticated', 'authenticated', 'emp.p2ed1@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d300000-0000-0000-0000-000000000d31', 'Emp P2ED1', 'emp.p2ed1@t.local', 'emp_p2ed1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d300000-0000-0000-0000-000000000d31';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='employee';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- SECOND tenant (cross-tenant fixture) — owner has equipment.manage in THEIR company only
insert into public.companies (id, company_code, name) values
  ('0f300000-0000-0000-0000-000000000f31','P2ED1CO2','P2ED1 Company Two');
insert into public.branches (id, company_id, branch_code, name) values
  ('0f300000-0000-0000-0000-000000000fb1','0f300000-0000-0000-0000-000000000f31','P2ED1BR2','P2ED1 Branch Two');
do $$ begin
  set local role service_role;
  perform public.seed_standard_roles('0f300000-0000-0000-0000-000000000f31');
  set local role postgres;
end $$;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d300000-0000-0000-0000-000000000d32'::uuid, 'authenticated', 'authenticated', 'admin2.p2ed1@t.local');
do $$ declare v_role uuid; v_user uuid; v_co2 uuid := '0f300000-0000-0000-0000-000000000f31'; v_br2 uuid := '0f300000-0000-0000-0000-000000000fb1'; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d300000-0000-0000-0000-000000000d32', 'Admin P2ED1 Two', 'admin2.p2ed1@t.local', 'admin2_p2ed1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d300000-0000-0000-0000-000000000d32';
  select id into v_role from public.roles where company_id=v_co2 and role_key='admin';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, v_co2, v_br2, v_role);
end $$;

-- Buy 3 real equipment assets via inventory_record_purchase(), then backdate purchase_date directly
-- as postgres (simulating "this was bought a while ago" without waiting real time).
do $$ declare v_owner_auth uuid := '0c300000-0000-0000-0000-000000000c31';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.inventory_record_purchase((select v_branch from g), null, 'Half-Life Tiller P2ED1', true, 1, 12000, 'online', 'Lazada', null, current_date, 'p2ed1-half', null, null, null);
  perform public.inventory_record_purchase((select v_branch from g), null, 'Fully-Depreciated Pump P2ED1', true, 1, 5000, 'online', 'Lazada', null, current_date, 'p2ed1-full', null, null, null);
  perform public.inventory_record_purchase((select v_branch from g), null, 'Unconfigured Sprayer P2ED1', true, 1, 3000, 'online', 'Lazada', null, current_date, 'p2ed1-unconf', null, null, null);
end $$;
set local role postgres;
update public.equipment_assets set purchase_date = current_date - interval '6 months' where name = 'Half-Life Tiller P2ED1';
update public.equipment_assets set purchase_date = current_date - interval '24 months' where name = 'Fully-Depreciated Pump P2ED1';

create temp table gh as select id as v_half from public.equipment_assets where name = 'Half-Life Tiller P2ED1';
create temp table gf as select id as v_full from public.equipment_assets where name = 'Fully-Depreciated Pump P2ED1';
create temp table gu as select id as v_unconf from public.equipment_assets where name = 'Unconfigured Sprayer P2ED1';
grant select on gh, gf, gu to authenticated;

-- ── HAPPY 1: half-life asset, 6mo elapsed of a 12mo useful life, salvage 0 -> ~half of 12000 ─
do $$ declare v_owner_auth uuid := '0c300000-0000-0000-0000-000000000c31'; v_bv numeric;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.equipment_set_depreciation((select v_half from gh), 12, 0);
  select public.equipment_book_value((select v_half from gh)) into v_bv;
  if v_bv < 5900 or v_bv > 6100 then raise exception 'HAPPY1: expected book value near 6000 (half of 12000) after 6 of 12 months, got %', v_bv; end if;
  raise notice 'PASS p2ed1: half-life asset books at ~half of purchase cost (got %)', v_bv;
end $$;
set local role postgres;

-- ── HAPPY 2: fully-elapsed asset (24mo of a 12mo life) floors at salvage_value exactly ─
do $$ declare v_owner_auth uuid := '0c300000-0000-0000-0000-000000000c31'; v_bv numeric;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.equipment_set_depreciation((select v_full from gf), 12, 500);
  select public.equipment_book_value((select v_full from gf)) into v_bv;
  if v_bv <> 500 then raise exception 'HAPPY2: fully-depreciated asset should floor exactly at salvage_value 500, got %', v_bv; end if;
  raise notice 'PASS p2ed1: fully-depreciated asset (24mo of a 12mo life) floors exactly at salvage_value, never below';
end $$;
set local role postgres;

-- ── HAPPY 3: unconfigured asset (useful_life_months never set) -> book value == purchase_cost ─
do $$ declare v_bv numeric;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', '0c300000-0000-0000-0000-000000000c31')::text, true);
  select public.equipment_book_value((select v_unconf from gu)) into v_bv;
  if v_bv <> 3000 then raise exception 'HAPPY3: unconfigured asset should book at unchanged purchase_cost 3000, got %', v_bv; end if;
  raise notice 'PASS p2ed1: unconfigured asset (no useful_life_months set) books at unchanged purchase_cost';
end $$;
set local role postgres;

-- ── SAD 1: salvage_value > purchase_cost ─
do $$ declare v_owner_auth uuid := '0c300000-0000-0000-0000-000000000c31';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.equipment_set_depreciation((select v_unconf from gu), 12, 999999);
    raise exception 'SAD1: salvage_value exceeding purchase_cost should be rejected';
  exception when check_violation then
    raise notice 'PASS p2ed1: salvage_value > purchase_cost denied';
  end;
end $$;
set local role postgres;

-- ── SAD 2: useful_life_months = 0 ─
do $$ declare v_owner_auth uuid := '0c300000-0000-0000-0000-000000000c31';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.equipment_set_depreciation((select v_unconf from gu), 0, 0);
    raise exception 'SAD2: useful_life_months of 0 should be rejected';
  exception when check_violation then
    raise notice 'PASS p2ed1: useful_life_months = 0 denied — must be a positive number of months';
  end;
end $$;
set local role postgres;

-- ── SAD 3: no equipment.manage ─
do $$ declare v_emp_auth uuid := '0d300000-0000-0000-0000-000000000d31';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  begin
    perform public.equipment_set_depreciation((select v_unconf from gu), 12, 0);
    raise exception 'SAD3: a holder with no equipment.manage should be denied';
  exception when insufficient_privilege then
    raise notice 'PASS p2ed1: equipment_set_depreciation denied without equipment.manage';
  end;
end $$;
set local role postgres;

-- ── SAD 4: unknown asset id ─
do $$ declare v_owner_auth uuid := '0c300000-0000-0000-0000-000000000c31';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.equipment_set_depreciation('00000000-0000-0000-0000-000000000000', 12, 0);
    raise exception 'SAD4: an unknown asset id should be rejected';
  exception when raise_exception then
    raise notice 'PASS p2ed1: unknown asset id denied';
  end;
end $$;
set local role postgres;

-- ── Cross-tenant: second company's equipment.manage holder cannot touch P2ED1CO's asset ─
do $$ declare v_admin2_auth uuid := '0d300000-0000-0000-0000-000000000d32';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  begin
    perform public.equipment_set_depreciation((select v_unconf from gu), 12, 0);
    raise exception 'CROSS-TENANT: second company''s equipment.manage holder should not touch P2ED1CO''s asset';
  exception when insufficient_privilege then
    raise notice 'PASS p2ed1: cross-tenant equipment_set_depreciation denied (has_permission checks company membership, not just the key)';
  end;
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on neither function; authenticated has EXECUTE on both ─
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('equipment_book_value','equipment_set_depreciation');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a P2ED1 function (found % grants)', n; end if;
  raise notice 'PASS p2ed1: anon has no EXECUTE on either P2ED1 function';

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('equipment_book_value','equipment_set_depreciation');
  if n<>2 then raise exception 'GRANT: expected authenticated to have EXECUTE on both P2ED1 functions, found %', n; end if;
  raise notice 'PASS p2ed1: authenticated has EXECUTE on both P2ED1 functions';
end $$;

rollback;
