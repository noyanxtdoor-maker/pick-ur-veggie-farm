-- Guard battery for P1M revoke-approval workflow (ported from Team B's guard for their "P1J"-labeled
-- commit c014423 — relabeled P1M here since P1J already means username-login on our chain).
-- Auth-boundary (memberships): tests the 4 RPCs + RLS + the separation-of-duties gate.
--
-- Org:
--   - bootstrap one tenant the REAL way (owner role, rank 50, full catalog).
--   - seed the standard tiers via seed_standard_roles (employee/operator/admin/co_owner).
--   - create helper users: an EMPLOYEE (rank 10) = revoke target, plus a SECOND owner-tier person
--     (co_owner role rank 40) = the necessary second approver (separation of duties).
-- Exercise:
--   HAPPY 1: co_owner1 requests revoke of employee -> queued + audited.
--   HAPPY 2: the OTHER co_owner (co_owner2) approves -> employee memberships Expired, request
--            Approved, 'revoke.approved' audit emitted.
--   SAD 1: EMPLOYEE (no membership.manage) tries request_revoke -> insufficient_privilege.
--   SAD 2: co_owner1 (the REQUESTER) tries approve_revoke_request on their own request ->
--          insufficient_privilege (separation of duties — cannot self-approve).
--   SAD 3: duplicate request_revoke while one is Pending -> raise_exception.
--   SAD 4: self-revoke (co_owner tries request_revoke(co_owner)) -> insufficient_privilege.
-- Wrapped in BEGIN/ROLLBACK; does not mutate (reset re-seeds on next run).
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- Owner auth.users + bootstrap
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0a000000-0000-0000-0000-0000000000a1'::uuid, 'authenticated', 'authenticated', 'owner.p1m@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-0000000000a1','Owner P1M','P1MCO','P1M Company','P1MBR','P1M Branch');
  set local role postgres;  -- revert so subsequent auth.users inserts run as superuser, not service_role
end $$;

-- Helper: fetch the company + branch + owner role
create temp table g as select
  (select id from public.companies where company_code='P1MCO') as v_company,
  (select id from public.branches where branch_code='P1MBR') as v_branch,
  (select id from public.users where auth_user_id='0a000000-0000-0000-0000-0000000000a1') as v_owner,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1MCO') and role_key='owner') as v_owner_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1MCO') and role_key='co_owner') as v_co_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1MCO') and role_key='employee') as v_emp_role;

-- CO_OWNER1 (a membership.manage holder; the requester)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000b5'::uuid, 'authenticated', 'authenticated', 'co1.p1m@t.local');
do $$ declare v_co1 uuid; begin
  -- p1a_skip_signup_trigger is set, so the auth trigger is skipped — insert public.users manually.
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000b5', 'Co1 P1M', 'co1.p1m@t.local', 'co1_p1m')
    on conflict (auth_user_id) do nothing;
  select id into v_co1 from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b5';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_co1, (select v_company from g), (select v_branch from g), (select v_co_role from g));
end $$;

-- CO_OWNER2 (the separate approver)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000b6'::uuid, 'authenticated', 'authenticated', 'co2.p1m@t.local');
do $$ declare v_co2 uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000b6', 'Co2 P1M', 'co2.p1m@t.local', 'co2_p1m')
    on conflict (auth_user_id) do nothing;
  select id into v_co2 from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b6';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_co2, (select v_company from g), (select v_branch from g), (select v_co_role from g));
end $$;

-- EMPLOYEE (the revoke target)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000b1'::uuid, 'authenticated', 'authenticated', 'emp.p1m@t.local');
do $$ declare v_emp uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000b1', 'Emp P1M', 'emp.p1m@t.local', 'emp_p1m')
    on conflict (auth_user_id) do nothing;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b1';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_emp, (select v_company from g), (select v_branch from g), (select v_emp_role from g));
end $$;

-- ── HAPPY 1: co_owner1 requests revoke of the employee ─────────────────────
do $$ declare v_co1 uuid; v_emp uuid; v_req uuid; n int;
  v_co1_auth uuid := '0b000000-0000-0000-0000-0000000000b5';
begin
  select id into v_co1 from public.users where auth_user_id=v_co1_auth;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b1';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_co1_auth)::text, true);
  v_req := public.request_revoke(v_emp, 'end of contract');
  if v_req is null then raise exception 'HAPPY1: request_revoke returned null'; end if;
  select count(*) into n from public.revoke_requests where id=v_req and status='Pending';
  if n<>1 then raise exception 'HAPPY1: request not Pending'; end if;
  select count(*) into n from public.audit_events where event_type='revoke.requested' and entity_id=v_req;
  if n<>1 then raise exception 'HAPPY1: revoke.requested audit missing'; end if;
  raise notice 'PASS p1m: co_owner1 requested revoke, request Pending, audited';
end $$;

-- ── HAPPY 2: co_owner2 approves -> employee memberships Expired, request Approved, audited ─
do $$ declare v_co2 uuid; v_emp uuid; v_req uuid; n int;
  v_co2_auth uuid := '0b000000-0000-0000-0000-0000000000b6';
begin
  select id into v_co2 from public.users where auth_user_id=v_co2_auth;
  select id into v_emp from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b1';
  select id into v_req from public.revoke_requests where target_user_id=v_emp and status='Pending';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_co2_auth)::text, true);
  perform public.approve_revoke_request(v_req);
  select count(*) into n from public.user_branch_roles where user_id=v_emp and assignment_status='Active';
  if n<>0 then raise exception 'HAPPY2: employee still has active memberships after approve'; end if;
  select count(*) into n from public.revoke_requests where id=v_req and status='Approved';
  if n<>1 then raise exception 'HAPPY2: request not Approved'; end if;
  select count(*) into n from public.audit_events where event_type='revoke.approved' and entity_id=v_emp;
  if n<>1 then raise exception 'HAPPY2: revoke.approved audit missing'; end if;
  raise notice 'PASS p1m: co_owner2 approved, employee memberships Expired, request Approved, audited';
end $$;

-- ── SAD 1: EMPLOYEE (no membership.manage) tries request_revoke on co_owner1 ─
do $$ declare v_emp uuid; v_co1 uuid;
  v_emp_auth uuid := '0b000000-0000-0000-0000-0000000000b1';
begin
  select id into v_emp from public.users where auth_user_id=v_emp_auth;
  select id into v_co1 from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b5';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  begin
    perform public.request_revoke(v_co1, 'nope');
    raise exception 'SAD1: employee should not be able to request_revoke';
  exception when insufficient_privilege then
    raise notice 'PASS p1m: employee denied (insufficient_privilege) — membership.manage required';
  end;
end $$;

-- ── SAD 2: co_owner1 (the REQUESTER) tries to approve their own request ────
do $$ declare v_co1 uuid; v_co2 uuid; v_req uuid; n int;
  v_co1_auth uuid := '0b000000-0000-0000-0000-0000000000b5';
begin
  set local role postgres;  -- clear any leaked authenticated role from prior blocks
  select id into v_co1 from public.users where auth_user_id=v_co1_auth;
  select id into v_co2 from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b6';
  -- sanity: co_owner2 must still have an active membership
  select count(*) into n from public.user_branch_roles where user_id=v_co2 and assignment_status='Active';
  if n=0 then raise exception 'SAD2 precondition: co_owner2 has no active membership'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_co1_auth)::text, true);
  v_req := public.request_revoke(v_co2, 'test self-approve');
  begin
    perform public.approve_revoke_request(v_req);
    raise exception 'SAD2: co_owner1 should not approve their own request';
  exception when insufficient_privilege then
    raise notice 'PASS p1m: self-approve denied (insufficient_privilege) — separation of duties';
  end;
end $$;

-- ── SAD 3: duplicate request_revoke while one is Pending ──────────────────
do $$ declare v_co1 uuid; v_co2 uuid; n int;
  v_co1_auth uuid := '0b000000-0000-0000-0000-0000000000b5';
begin
  set local role postgres;
  select id into v_co1 from public.users where auth_user_id=v_co1_auth;
  select id into v_co2 from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b6';
  -- precondition: a Pending request for co_owner2 already exists from SAD2
  select count(*) into n from public.revoke_requests where target_user_id=v_co2 and status='Pending';
  if n=0 then raise exception 'SAD3 precondition: no Pending request for co_owner2'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_co1_auth)::text, true);
  begin
    perform public.request_revoke(v_co2, 'dup');
    raise exception 'SAD3: duplicate Pending request should have been rejected';
  exception when raise_exception then
    raise notice 'PASS p1m: duplicate Pending request rejected (one per target)';
  end;
end $$;

-- ── SAD 4: self-revoke (co_owner1 tries request_revoke on themselves) ──────
do $$ declare v_co1 uuid; n int;
  v_co1_auth uuid := '0b000000-0000-0000-0000-0000000000b5';
begin
  set local role postgres;
  select id into v_co1 from public.users where auth_user_id=v_co1_auth;
  select count(*) into n from public.user_branch_roles where user_id=v_co1 and assignment_status='Active';
  if n=0 then raise exception 'SAD4 precondition: co_owner1 has no active membership'; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_co1_auth)::text, true);
  begin
    perform public.request_revoke(v_co1, 'self');
    raise exception 'SAD4: self-revoke should have been rejected';
  exception when insufficient_privilege then
    raise notice 'PASS p1m: self-revoke denied (insufficient_privilege)';
  end;
end $$;

-- ── EMPLOYEE2 (a second revoke target, dedicated to the P1M.2 owner-instant test) ──
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0b000000-0000-0000-0000-0000000000b7'::uuid, 'authenticated', 'authenticated', 'emp2.p1m@t.local');
do $$ declare v_emp2 uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0b000000-0000-0000-0000-0000000000b7', 'Emp2 P1M', 'emp2.p1m@t.local', 'emp2_p1m')
    on conflict (auth_user_id) do nothing;
  select id into v_emp2 from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b7';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_emp2, (select v_company from g), (select v_branch from g), (select v_emp_role from g));
end $$;

-- ── HAPPY 3 (P1M.2): owner requests a revoke -> executes IMMEDIATELY, no Pending queue ──
do $$ declare v_owner uuid; v_emp2 uuid; v_req uuid; n int;
  v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000a1';
begin
  set local role postgres;
  select id into v_owner from public.users where auth_user_id=v_owner_auth;
  select id into v_emp2 from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b7';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  v_req := public.request_revoke(v_emp2, 'owner instant revoke test');
  set local role postgres;
  select count(*) into n from public.user_branch_roles where user_id=v_emp2 and assignment_status='Active';
  if n<>0 then raise exception 'HAPPY3: employee2 still has active memberships — owner revoke should be instant'; end if;
  select count(*) into n from public.revoke_requests where id=v_req and status='Approved' and decided_by=v_owner and requested_by=v_owner;
  if n<>1 then raise exception 'HAPPY3: expected an already-Approved row (self-decided), got %', n; end if;
  select count(*) into n from public.revoke_requests where id=v_req and status='Pending';
  if n<>0 then raise exception 'HAPPY3: owner revoke must never sit as Pending (nothing to approve — it already happened)'; end if;
  select count(*) into n from public.audit_events where event_type='revoke.approved' and entity_id=v_emp2;
  if n<>1 then raise exception 'HAPPY3: revoke.approved audit row missing for the instant path'; end if;
  raise notice 'PASS p1m2: owner request_revoke executes instantly (no Pending row), audited as revoke.approved';
end $$;

-- ── SAD 5 (P1M.2): the OTHER co_owner's revoke still queues normally, unaffected by the owner path ──
do $$ declare v_co2 uuid; v_target uuid; v_req uuid; n int;
  v_co2_auth uuid := '0b000000-0000-0000-0000-0000000000b6';
begin
  set local role postgres;
  -- reuse co_owner1 as a fresh target here (their prior SAD4 self-revoke attempt was rejected, so they
  -- still hold an active membership) — co_owner2 (a non-owner membership.manage holder) requests it.
  select id into v_target from public.users where auth_user_id='0b000000-0000-0000-0000-0000000000b5';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_co2_auth)::text, true);
  v_req := public.request_revoke(v_target, 'co-owner path still queues');
  set local role postgres;
  select count(*) into n from public.revoke_requests where id=v_req and status='Pending';
  if n<>1 then raise exception 'SAD5: co_owner-initiated revoke should still be Pending (queued), not instant'; end if;
  select count(*) into n from public.user_branch_roles where user_id=v_target and assignment_status='Active';
  if n=0 then raise exception 'SAD5: target should still be Active — a queued request must not execute on its own'; end if;
  raise notice 'PASS p1m2: co_owner-initiated revoke still queues as Pending, unaffected by the owner-instant path';
end $$;

-- ── GRANT SHAPE: anon must NOT be able to call any of the 4 RPCs (P1M.1 hardening) ─
-- This Supabase project has an ALTER DEFAULT PRIVILEGES rule that grants EXECUTE on every new
-- function to anon directly — `revoke ... from public` alone does NOT strip it (confirmed via
-- pg_default_acl during the P1M production push). Assert the anon-specific revoke landed, so this
-- class of grant-hygiene bug can never regress silently again.
do $$ begin
  set local role postgres;
  if has_function_privilege('anon', 'public.request_revoke(uuid,text)', 'execute') then
    raise exception 'DEFECT p1m grant-shape: anon can call request_revoke — P1M.1 hardening missing or regressed';
  end if;
  if has_function_privilege('anon', 'public.list_revoke_requests()', 'execute') then
    raise exception 'DEFECT p1m grant-shape: anon can call list_revoke_requests — P1M.1 hardening missing or regressed';
  end if;
  if has_function_privilege('anon', 'public.approve_revoke_request(uuid)', 'execute') then
    raise exception 'DEFECT p1m grant-shape: anon can call approve_revoke_request — P1M.1 hardening missing or regressed';
  end if;
  if has_function_privilege('anon', 'public.reject_revoke_request(uuid,text)', 'execute') then
    raise exception 'DEFECT p1m grant-shape: anon can call reject_revoke_request — P1M.1 hardening missing or regressed';
  end if;
  raise notice 'PASS p1m: anon has EXECUTE on none of the 4 revoke-approval RPCs (P1M.1 hardening confirmed)';
end $$;

rollback;
