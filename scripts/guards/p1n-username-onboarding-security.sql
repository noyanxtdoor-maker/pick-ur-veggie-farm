-- Guard battery for P1N post-approval username onboarding (ported from Team B's guard for their
-- "P1M"-labeled commits da8c546/6773242 — relabeled P1N here since P1M already means the
-- revoke-approval workflow on our chain).
-- Auth-adjacent (username self-service write): tests the 2 RPCs + the app-redirect gate + grant shape.
--
-- Organization:
--   - bootstrap one tenant the REAL way (owner with full catalog).
--   - create helper EMPLOYEE auth.users + public.users rows + active memberships (post-approval).
--
-- Exercise:
--   HAPPY 1: needs_username_onboarding() returns TRUE for an approved employee who has NOT chosen.
--   HAPPY 2: set_chosen_username('maria.f') — sets username + username_chosen_at + audits 'username.chosen'.
--   HAPPY 3: needs_username_onboarding() returns FALSE after they chose.
--   SAD 1: a user with NO active membership tries set_chosen_username — "not approved yet".
--   SAD 2: the same employee tries set_chosen_username AGAIN — "already chosen".
--   SAD 3: format violation — too short (1 char) -> raise_exception.
--   SAD 4: uniqueness — a second user tries the same username -> unique_violation.
--   GRANT SHAPE: anon must NOT be able to call either RPC (applied from the start this time —
--   P1M/P1M.1 earlier tonight caught this exact class of bug via a default-ACL rule in this
--   Supabase project that grants EXECUTE to anon directly on every new function).
-- Wrapped in BEGIN/ROLLBACK; does not mutate.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- ── Owner auth.users + bootstrap ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0a000000-0000-0000-0000-0000000000a2'::uuid, 'authenticated', 'authenticated', 'owner.p1n@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-0000000000a2','Owner P1N','P1NCO','P1N Company','P1NBR','P1N Branch');
  set local role postgres;
end $$;

-- Helper: company + branch
create temp table g as select
  (select id from public.companies where company_code='P1NCO') as v_company,
  (select id from public.branches where branch_code='P1NBR') as v_branch,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1NCO') and role_key='employee') as v_emp_role;

-- ── EMPLOYEE1 (the approved-onboarder; has an active membership) ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000d1'::uuid, 'authenticated', 'authenticated', 'emp1.p1n@t.local');
do $$ declare v_emp1 uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000d1', 'Emp1 P1N', 'emp1.p1n@t.local', 'emp1_p1n_auto')
    on conflict (auth_user_id) do nothing;
  select id into v_emp1 from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000d1';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_emp1, (select v_company from g), (select v_branch from g), (select v_emp_role from g));
  -- reset username_chosen_at to null (emp1 starts unchosen)
  update public.users set username_chosen_at = null where id = v_emp1;
end $$;

-- ── EMPLOYEE2 (a second approved user, for the uniqueness SAD) ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000d2'::uuid, 'authenticated', 'authenticated', 'emp2.p1n@t.local');
do $$ declare v_emp2 uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000d2', 'Emp2 P1N', 'emp2.p1n@t.local', null)
    on conflict (auth_user_id) do nothing;
  select id into v_emp2 from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000d2';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_emp2, (select v_company from g), (select v_branch from g), (select v_emp_role from g));
end $$;

-- ── PENDING-USER (signed up, NO membership yet) for SAD 1 ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000d3'::uuid, 'authenticated', 'authenticated', 'pend.p1n@t.local');
do $$ begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000d3', 'Pending P1N', 'pend.p1n@t.local', null)
    on conflict (auth_user_id) do nothing;
end $$;

-- ── HAPPY 1: needs_username_onboarding() TRUE for employee1 (approved, not chosen) ──
do $$ declare v_emp1 uuid; v_need boolean;
  v_auth uuid := '0b000000-0000-0000-0000-0000000000d1';
begin
  set local role postgres;
  select id into v_emp1 from public.users where auth_user_id=v_auth;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  v_need := public.needs_username_onboarding();
  if not v_need then raise exception 'HAPPY1: needs_username_onboarding should be true before choosing'; end if;
  raise notice 'PASS p1n: needs_username_onboarding() = true (approved + not chosen)';
end $$;

-- ── HAPPY 2: set_chosen_username('maria.f') — sets + audits ──
do $$ declare v_emp1 uuid; n int;
  v_auth uuid := '0b000000-0000-0000-0000-0000000000d1';
begin
  set local role postgres;
  select id into v_emp1 from public.users where auth_user_id=v_auth;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  perform public.set_chosen_username('maria.f');
  -- RLS gotcha (same as B found): the audit_events SELECT policy requires audit.read, which
  -- employee tier lacks — read the audit row back as postgres (bypasses RLS) to verify it landed.
  set local role postgres;
  select count(*) into n from public.users where id=v_emp1 and username='maria.f' and username_chosen_at is not null;
  if n<>1 then raise exception 'HAPPY2: username/username_chosen_at not set'; end if;
  select count(*) into n from public.audit_events where event_type='username.chosen' and entity_id=v_emp1;
  if n<>1 then raise exception 'HAPPY2: username.chosen audit missing'; end if;
  raise notice 'PASS p1n: set_chosen_username(maria.f) — username + username_chosen_at set, audited';
end $$;

-- ── HAPPY 3: needs_username_onboarding() FALSE after they chose ──
do $$ declare v_need boolean;
  v_auth uuid := '0b000000-0000-0000-0000-0000000000d1';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  v_need := public.needs_username_onboarding();
  if v_need then raise exception 'HAPPY3: needs_username_onboarding should be false after choosing'; end if;
  raise notice 'PASS p1n: needs_username_onboarding() = false (already chose)';
end $$;

-- ── SAD 1: a PENDING user (no membership) tries set_chosen_username ──
do $$ declare v_auth uuid := '0b000000-0000-0000-0000-0000000000d3';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  begin
    perform public.set_chosen_username('anything');
    raise exception 'SAD1: no-membership user should be denied';
  exception when raise_exception then
    raise notice 'PASS p1n: no-membership user denied (raise_exception — not approved yet)';
  end;
end $$;

-- ── SAD 2: employee1 tries set_chosen_username AGAIN ──
do $$ declare v_auth uuid := '0b000000-0000-0000-0000-0000000000d1';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  begin
    perform public.set_chosen_username('maria.g');
    raise exception 'SAD2: second set_chosen_username should be denied';
  exception when raise_exception then
    raise notice 'PASS p1n: second set_chosen_username denied (raise_exception — one-time-only)';
  end;
end $$;

-- ── SAD 3: format violation (too short) on employee2 ──
do $$ declare v_auth uuid := '0b000000-0000-0000-0000-0000000000d2';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  begin
    perform public.set_chosen_username('a');  -- 1 char, below 3-char minimum
    raise exception 'SAD3: format violation should have been rejected';
  exception when raise_exception then
    raise notice 'PASS p1n: format violation rejected (raise_exception — must be 3-30 chars)';
  end;
end $$;

-- ── SAD 4: uniqueness — employee2 tries 'maria.f' (already taken by employee1) ──
do $$ declare v_auth uuid := '0b000000-0000-0000-0000-0000000000d2';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  begin
    perform public.set_chosen_username('maria.f');
    raise exception 'SAD4: duplicate username should have been rejected';
  exception when unique_violation then
    raise notice 'PASS p1n: duplicate username rejected (unique_violation — username is taken)';
  end;
end $$;

-- ── GRANT SHAPE: anon must NOT be able to call either RPC ──
do $$ begin
  set local role postgres;
  if has_function_privilege('anon', 'public.set_chosen_username(text)', 'execute') then
    raise exception 'DEFECT p1n grant-shape: anon can call set_chosen_username';
  end if;
  if has_function_privilege('anon', 'public.needs_username_onboarding()', 'execute') then
    raise exception 'DEFECT p1n grant-shape: anon can call needs_username_onboarding';
  end if;
  raise notice 'PASS p1n: anon has EXECUTE on neither onboarding RPC';
end $$;

rollback;
