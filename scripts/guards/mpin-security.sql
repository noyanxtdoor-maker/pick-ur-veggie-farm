-- Guard battery for P1P — mandatory MPIN security layer (owner directive 2026-07-18).
-- Auth-boundary (user_mpin table + set_mpin/verify_mpin/change_mpin/mpin_status/onboarding_next_step):
-- format validation, trivial-PIN deny-list, escalating lockout, cross-user isolation, grant shape,
-- and the onboarding-sequence ordering (username -> mpin -> null).
--
-- Fixture: bootstrap one tenant the real way (owner, auto-membership); a second bootstrapped tenant
-- for cross-user isolation. Wrapped in BEGIN/ROLLBACK; does not mutate (reset re-seeds next run).
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- ── Tenant A: owner, used for the bulk of the assertions ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0e100000-0000-0000-0000-0000000000e1'::uuid, 'authenticated', 'authenticated', 'owner.p1p@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0e100000-0000-0000-0000-0000000000e1','Owner P1P','P1PCOA','P1P Company A','P1PBRA','P1P Branch A');
  set local role postgres;
end $$;

-- ── Tenant B: second owner, used ONLY for cross-user isolation ──
insert into public.companies (id, company_code, name) values
  ('0e200000-0000-0000-0000-0000000000e0','P1PCOB','P1P Company B');
insert into public.branches (id, company_id, branch_code, name) values
  ('0e200000-0000-0000-0000-0000000000eb','0e200000-0000-0000-0000-0000000000e0','P1PBRB','P1P Branch B');
do $$ begin
  set local role service_role;
  perform public.seed_standard_roles('0e200000-0000-0000-0000-0000000000e0');
  set local role postgres;
end $$;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0e200000-0000-0000-0000-0000000000e2'::uuid, 'authenticated', 'authenticated', 'owner.b.p1p@t.local');
do $$ declare v_role uuid; v_user uuid; v_co uuid := '0e200000-0000-0000-0000-0000000000e0'; v_br uuid := '0e200000-0000-0000-0000-0000000000eb'; begin
  insert into public.users (auth_user_id, display_name, email, username, username_chosen_at) values
    ('0e200000-0000-0000-0000-0000000000e2', 'Owner B P1P', 'owner.b.p1p@t.local', 'owner_b_p1p', now())
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0e200000-0000-0000-0000-0000000000e2';
  -- Tenant B is a direct-insert fixture, not bootstrap_initial_tenant, so it has no 'owner' row
  -- (that role_key is only ever created inside bootstrap itself) — co_owner is the top tier here.
  select id into v_role from public.roles where company_id=v_co and role_key='co_owner';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_user, v_co, v_br, v_role);
end $$;

do $$ declare v_a_auth uuid := '0e100000-0000-0000-0000-0000000000e1'; v_a uuid;
begin
  select id into v_a from public.users where auth_user_id = v_a_auth;
  update public.users set username = 'owner_a_p1p', username_chosen_at = now() where id = v_a; -- skip P1N's own onboarding for THIS guard's purpose
end $$;

-- ── HAPPY 1: fresh user has no MPIN; mpin_status() reflects it ──
do $$ declare v_has boolean; v_locked timestamptz;
begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  select has_mpin, locked_until into v_has, v_locked from public.mpin_status();
  if v_has or v_locked is not null then raise exception 'DEFECT p1p: fresh user reports an MPIN already set'; end if;
  raise notice 'PASS p1p: mpin_status() correctly reports no MPIN set for a fresh user';
end $$;
set local role postgres;

-- ── SAD 1: bad format rejected (not 6 digits) ──
do $$ begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  perform public.set_mpin('12345');
  raise exception 'DEFECT p1p: 5-digit MPIN accepted';
exception when check_violation then raise notice 'PASS p1p: non-6-digit MPIN rejected'; end $$;
set local role postgres;

-- ── SAD 2: trivial PIN deny-list ──
do $$ begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  perform public.set_mpin('123456');
  raise exception 'DEFECT p1p: trivial MPIN 123456 accepted';
exception when check_violation then raise notice 'PASS p1p: trivial MPIN (123456) rejected by the deny-list'; end $$;
set local role postgres;

-- ── HAPPY 2: valid MPIN accepted; mpin_status() flips; audited ──
do $$ declare v_has boolean; n int;
begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  perform public.set_mpin('482917');
  select has_mpin into v_has from public.mpin_status();
  if not v_has then raise exception 'DEFECT p1p: mpin_status() still reports no MPIN after set_mpin'; end if;
  set local role postgres;
  select count(*) into n from public.audit_events where event_type = 'mpin.set';
  if n <> 1 then raise exception 'DEFECT p1p: mpin.set not audited (found %)', n; end if;
  raise notice 'PASS p1p: valid MPIN accepted, mpin_status() flips to true, audited (mpin.set)';
end $$;

-- ── HAPPY 3: correct MPIN verifies ──
do $$ declare v_result text;
begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  select public.verify_mpin('482917') into v_result;
  if v_result <> 'ok' then raise exception 'DEFECT p1p: correct MPIN failed to verify (got %)', v_result; end if;
  raise notice 'PASS p1p: correct MPIN verifies successfully';
end $$;
set local role postgres;

-- ── SAD 3: wrong MPIN rejected via return value (not a raise — see the migration's own comment: a
--    RAISE here would roll back the very counter increment / audit insert being asserted below,
--    since Postgres has no autonomous transactions), audited ──
do $$ declare v_result text;
begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  select public.verify_mpin('000001') into v_result;
  if v_result <> 'wrong' then raise exception 'DEFECT p1p: wrong MPIN did not return ''wrong'' (got %)', v_result; end if;
  set local role postgres;
  perform 1 from public.audit_events where event_type = 'mpin.verify_failed';
  if not found then raise exception 'DEFECT p1p: mpin.verify_failed not audited'; end if;
  raise notice 'PASS p1p: wrong MPIN returns ''wrong'' (no exception — the write survives), audited';
end $$;

-- ── SAD 4: 5th consecutive failure engages a 60s lockout; correct MPIN still rejected while locked ──
do $$ declare v_locked timestamptz; v_result text;
begin
  -- already at 1 failure from SAD 3 above; drive 4 more to reach exactly 5
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  for i in 1..3 loop
    perform public.verify_mpin('000002');
  end loop;
  select public.verify_mpin('000003') into v_result; -- the 5th consecutive failure
  if v_result <> 'locked' then raise exception 'DEFECT p1p: 5th failure did not return ''locked'' (got %)', v_result; end if;
  set local role postgres;
  select locked_until into v_locked from public.user_mpin where user_id = (select id from public.users where auth_user_id='0e100000-0000-0000-0000-0000000000e1');
  if v_locked is null or v_locked < now() + interval '30 seconds' or v_locked > now() + interval '90 seconds' then
    raise exception 'DEFECT p1p: lockout window not ~60s (got %)', v_locked - now();
  end if;
  -- even the CORRECT mpin is rejected while locked
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  select public.verify_mpin('482917') into v_result;
  if v_result <> 'locked' then raise exception 'DEFECT p1p: correct MPIN accepted (or not reported locked) while locked out — got %', v_result; end if;
  raise notice 'PASS p1p: 5th consecutive failure locks out for ~60s; even the correct MPIN is reported locked while locked';
end $$;
set local role postgres;

-- ── HAPPY 4: lockout escalates to 5 minutes at the 10th consecutive failure ──
do $$ declare v_locked timestamptz; v_uid uuid := (select id from public.users where auth_user_id='0e100000-0000-0000-0000-0000000000e1');
begin
  -- simulate already being at 9 consecutive failures with the cooldown expired, then drive one more
  update public.user_mpin set failed_attempts = 9, locked_until = now() - interval '1 second' where user_id = v_uid;
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  perform public.verify_mpin('000004');
  set local role postgres;
  select locked_until into v_locked from public.user_mpin where user_id = v_uid;
  if v_locked is null or v_locked < now() + interval '4 minutes' or v_locked > now() + interval '6 minutes' then
    raise exception 'DEFECT p1p: 10th-failure escalation not ~5min (got %)', v_locked - now();
  end if;
  raise notice 'PASS p1p: lockout escalates to ~5 minutes at the 10th consecutive failure';
end $$;

-- ── HAPPY 5: a subsequent SUCCESS resets failed_attempts to 0 ──
do $$ declare v_uid uuid := (select id from public.users where auth_user_id='0e100000-0000-0000-0000-0000000000e1'); v_attempts int;
begin
  update public.user_mpin set failed_attempts = 3, locked_until = null where user_id = v_uid;
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  perform public.verify_mpin('482917');
  set local role postgres;
  select failed_attempts into v_attempts from public.user_mpin where user_id = v_uid;
  if v_attempts <> 0 then raise exception 'DEFECT p1p: successful verify did not reset failed_attempts (got %)', v_attempts; end if;
  raise notice 'PASS p1p: a successful verify resets failed_attempts to 0';
end $$;

-- ── HAPPY 6 / SAD 5: change_mpin requires the CORRECT current MPIN ──
do $$ declare v_uid uuid := (select id from public.users where auth_user_id='0e100000-0000-0000-0000-0000000000e1'); v_result text;
begin
  update public.user_mpin set failed_attempts = 0, locked_until = null where user_id = v_uid; -- clean slate
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  select public.change_mpin('000000', '739215') into v_result;
  if v_result <> 'wrong' then raise exception 'DEFECT p1p: change_mpin did not reject the wrong current MPIN (got %)', v_result; end if;
  set local role postgres;
  update public.user_mpin set failed_attempts = 0, locked_until = null where user_id = v_uid; -- clear the failure the wrong-attempt above just caused
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  select public.change_mpin('482917', '739215') into v_result;
  if v_result <> 'ok' then raise exception 'DEFECT p1p: change_mpin rejected the correct current MPIN (got %)', v_result; end if;
  select public.verify_mpin('739215') into v_result; -- the new one now works
  if v_result <> 'ok' then raise exception 'DEFECT p1p: new MPIN does not verify after change_mpin (got %)', v_result; end if;
  raise notice 'PASS p1p: change_mpin rejects the wrong current MPIN, accepts + applies with the correct one';
end $$;
set local role postgres;

-- ── SAD 6: cross-user isolation — Owner B's MPIN state is completely untouched by Owner A's attempts ──
do $$ declare v_b_status record; v_result text;
begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e200000-0000-0000-0000-0000000000e2')::text, true);
  select * into v_b_status from public.mpin_status();
  if v_b_status.has_mpin then raise exception 'DEFECT p1p: Owner B has an MPIN despite never setting one — cross-user leak'; end if;
  select public.verify_mpin('482917') into v_result; -- Owner A's real MPIN, tried against Owner B's (nonexistent) row
  if v_result <> 'no_mpin' then raise exception 'DEFECT p1p: verify_mpin against a user with no MPIN row did not return ''no_mpin'' (got %)', v_result; end if;
  raise notice 'PASS p1p: cross-user isolation holds — Owner B has no MPIN, unaffected by Owner A''s activity, and verify_mpin correctly reports no_mpin for Owner B regardless of the MPIN tried';
end $$;
set local role postgres;

-- ── HAPPY 7: onboarding_next_step() ordering — username first, then mpin, then null ──
do $$ declare v_step text; v_new_auth uuid := '0e300000-0000-0000-0000-0000000000e3'; v_new_user uuid; v_co uuid; v_br uuid; v_role uuid;
begin
  select id into v_co from public.companies where company_code = 'P1PCOA';
  select id into v_br from public.branches where company_id = v_co limit 1;
  select id into v_role from public.roles where company_id = v_co and role_key = 'employee';
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', v_new_auth, 'authenticated', 'authenticated', 'newbie.p1p@t.local');
  insert into public.users (auth_user_id, display_name) values (v_new_auth, 'Newbie P1P') on conflict (auth_user_id) do nothing;
  select id into v_new_user from public.users where auth_user_id = v_new_auth;

  -- stage 0: no active membership yet -> null (not this gate's job, awaiting-approval queue instead)
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_new_auth)::text, true);
  select public.onboarding_next_step() into v_step;
  if v_step is not null then raise exception 'DEFECT p1p: onboarding_next_step() should be null pre-membership, got %', v_step; end if;
  set local role postgres;

  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_new_user, v_co, v_br, v_role);

  -- stage 1: membership exists, no username yet -> 'username'
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_new_auth)::text, true);
  select public.onboarding_next_step() into v_step;
  if v_step <> 'username' then raise exception 'DEFECT p1p: expected username step, got %', coalesce(v_step, 'null'); end if;
  set local role postgres;

  update public.users set username = 'newbie_p1p', username_chosen_at = now() where id = v_new_user;

  -- stage 2: username chosen, no MPIN yet -> 'mpin'
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_new_auth)::text, true);
  select public.onboarding_next_step() into v_step;
  if v_step <> 'mpin' then raise exception 'DEFECT p1p: expected mpin step, got %', coalesce(v_step, 'null'); end if;
  perform public.set_mpin('268401');

  -- stage 3 (P1P.2): MPIN set, biometric offer not yet decided -> 'biometric_offer'
  select public.onboarding_next_step() into v_step;
  if v_step <> 'biometric_offer' then raise exception 'DEFECT p1p2: expected biometric_offer step, got %', coalesce(v_step, 'null'); end if;
  perform public.dismiss_biometric_offer();

  -- stage 4: fully onboarded -> null
  select public.onboarding_next_step() into v_step;
  if v_step is not null then raise exception 'DEFECT p1p2: expected null (fully onboarded), got %', v_step; end if;
  raise notice 'PASS p1p2: onboarding_next_step() orders correctly — null (pre-membership) -> username -> mpin -> biometric_offer -> null (fully onboarded)';

  -- dismiss_biometric_offer() is idempotent — a second call after already-dismissed is a no-op, still null
  perform public.dismiss_biometric_offer();
  select public.onboarding_next_step() into v_step;
  if v_step is not null then raise exception 'DEFECT p1p2: a second dismiss_biometric_offer() call changed onboarding state, got %', v_step; end if;
  raise notice 'PASS p1p2: dismiss_biometric_offer() is idempotent';
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on none of the 6 functions (5 P1P + P1P.2's dismiss_biometric_offer);
--    authenticated has EXECUTE on all 6; the raw user_mpin table has ZERO grants to anon/authenticated ──
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('set_mpin','verify_mpin','change_mpin','mpin_status','onboarding_next_step','dismiss_biometric_offer');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a P1P/P1P.2 function (found % grants)', n; end if;

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('set_mpin','verify_mpin','change_mpin','mpin_status','onboarding_next_step','dismiss_biometric_offer');
  if n<>6 then raise exception 'GRANT: expected authenticated to have EXECUTE on all 6 P1P/P1P.2 functions, found %', n; end if;

  select count(*) into n from information_schema.table_privileges
   where table_schema='public' and table_name='user_mpin' and grantee in ('anon','authenticated');
  if n<>0 then raise exception 'GRANT: user_mpin has % direct grant(s) to anon/authenticated (should be zero — RPC-only)', n; end if;

  raise notice 'PASS p1p: anon has no EXECUTE on any P1P/P1P.2 function; authenticated has EXECUTE on all 6; user_mpin table has zero direct grants to anon/authenticated';
end $$;

-- ── Direct table access denied even for the row owner (function-only writes/reads) ──
do $$ begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0e100000-0000-0000-0000-0000000000e1')::text, true);
  perform 1 from public.user_mpin limit 1;
  raise exception 'DEFECT p1p: authenticated could SELECT from user_mpin directly';
exception when insufficient_privilege then raise notice 'PASS p1p: direct SELECT on user_mpin denied even for the row owner (RPC-only access)'; end $$;
set local role postgres;

rollback;
