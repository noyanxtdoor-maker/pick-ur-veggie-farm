-- Tier-2 BEHAVIORAL bootstrap security test (M6; ADS §5, B7 §2) — blocking gate.
-- Proves the one-time, explicitly-authorized, fully-audited, self-disabling guarantees of the controlled
-- bootstrap. Runs on a FRESH post-reset DB (no company; the M6-seeded permission catalog present).
-- Self-contained: BEGIN/ROLLBACK, leaves no data, no drift. Any DEFECT raises → fails under -v ON_ERROR_STOP=1.
\set ON_ERROR_STOP on
begin;
-- P1A: the signup trigger is under test in auth-lifecycle-security.sql; these fixtures construct
-- identities manually with fixed ids, so silence it inside this rolled-back transaction.
set local app.p1a_skip_signup_trigger = '1';

-- Owner auth identities (simulate Supabase Auth signup; the operator passes one to bootstrap — ownership is
-- NOT granted by being first to register).
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-00000000000a','authenticated','authenticated','owner@t.local'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-00000000000b','authenticated','authenticated','owner2@t.local');

-- Attack 3 — unauthorized callers (anon / authenticated) cannot invoke bootstrap (EXECUTE = service_role only)
do $$ begin set local role anon;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-00000000000a','Owner','CO-1','Company 1','BR-1','Branch 1');
  raise exception 'DEFECT: anon invoked bootstrap';
exception when insufficient_privilege then raise notice 'PASS bootstrap: anon denied (%)', sqlstate; end $$;
do $$ begin set local role authenticated;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-00000000000a','Owner','CO-1','Company 1','BR-1','Branch 1');
  raise exception 'DEFECT: authenticated invoked bootstrap';
exception when insufficient_privilege then raise notice 'PASS bootstrap: authenticated denied (%)', sqlstate; end $$;

-- Attack 4 — partial failure rolls back fully. Bad owner auth id fails at the users FK, AFTER company+branch
-- were created in-transaction → the whole call must roll back (no orphans).
do $$ declare n int; begin
  begin
    set local role service_role;
    perform public.bootstrap_initial_tenant('99999999-9999-9999-9999-999999999999','Ghost','CO-X','Company X','BR-X','Branch X');
    raise exception 'DEFECT: bootstrap with non-existent owner auth id succeeded';
  exception when foreign_key_violation then
    raise notice 'PASS bootstrap: mid-bootstrap failure raised FK (will verify rollback)';
  end;
  set local role postgres;
  select count(*) into n from public.companies;    if n<>0 then raise exception 'DEFECT: orphan company after failed bootstrap (%)',n; end if;
  select count(*) into n from public.branches;     if n<>0 then raise exception 'DEFECT: orphan branch after failed bootstrap (%)',n; end if;
  select count(*) into n from public.audit_events; if n<>0 then raise exception 'DEFECT: orphan audit after failed bootstrap (%)',n; end if;
  if (select completed from public.bootstrap_state where id) then raise exception 'DEFECT: bootstrap marked completed after a failed run'; end if;
  raise notice 'PASS bootstrap: partial failure rolled back fully (no orphans, not completed)';
end $$;

-- Positive bootstrap + data integrity (+ Attack 5 audit trail + Attack 6 no-escalation)
do $$ declare v_company uuid; v_branch uuid; v_user uuid; v_role uuid; n int; n_cat int; begin
  set local role service_role;
  v_company := public.bootstrap_initial_tenant('0a000000-0000-0000-0000-00000000000a','Tenant Owner','CO-1','Company 1','BR-1','Branch 1');
  set local role postgres;
  select count(*) into n from public.companies;                              if n<>1 then raise exception 'DEFECT: expected 1 company, got %',n; end if;
  if (select status from public.companies where id=v_company) <> 'Active' then raise exception 'DEFECT: first company not Active'; end if;
  select id into v_branch from public.branches where company_id=v_company;   if v_branch is null then raise exception 'DEFECT: branch missing / not in the company'; end if;
  select id into v_user from public.users where auth_user_id='0a000000-0000-0000-0000-00000000000a'; if v_user is null then raise exception 'DEFECT: owner ERP user not created'; end if;
  select id into v_role from public.roles where company_id=v_company and role_key='owner'; if v_role is null then raise exception 'DEFECT: owner role not created in the company'; end if;
  select count(*) into n from public.user_branch_roles
    where user_id=v_user and company_id=v_company and branch_id=v_branch and role_id=v_role and assignment_status='Active';
  if n<>1 then raise exception 'DEFECT: owner membership missing/incorrect (M3 composite FK scope)'; end if;
  select count(*) into n_cat from public.permissions where status='Active';
  select count(*) into n from public.role_permissions where company_id=v_company and role_id=v_role;
  if n<>n_cat then raise exception 'DEFECT: owner has % permissions, catalog has % (escalation/mismatch)',n,n_cat; end if;
  select count(*) into n from public.audit_events where company_id=v_company;
  if n<3 then raise exception 'DEFECT: bootstrap created only % audit events (expected >=3)',n; end if;
  if not (select completed from public.bootstrap_state where id) then raise exception 'DEFECT: bootstrap_state not completed'; end if;
  raise notice 'PASS bootstrap: first tenant created — company/branch/owner/role/% perms/membership/% audit events; completed', n_cat, n;
end $$;

-- Attack 1 & 2 — a second bootstrap (even with a different owner) permanently fails
do $$ begin set local role service_role;
  perform public.bootstrap_initial_tenant('0b000000-0000-0000-0000-00000000000b','Owner Two','CO-2','Company 2','BR-2','Branch 2');
  raise exception 'DEFECT: second bootstrap (another owner) succeeded';
exception when raise_exception then raise notice 'PASS bootstrap: double-bootstrap denied (%)', sqlerrm; end $$;

-- Impossible to re-enable: resetting the completion flag is blocked by the guard trigger (even as owner)
do $$ begin set local role postgres;
  update public.bootstrap_state set completed = false where id;
  raise exception 'DEFECT: bootstrap completion was reset';
exception when restrict_violation then raise notice 'PASS bootstrap: completion is irreversible (%)', sqlstate; end $$;

-- Owner satisfies the M4 resolver (correct owner authorization; created records survive resolver checks)
do $$ declare v_company uuid; begin
  set local role postgres; select id into v_company from public.companies limit 1;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  if not public.has_permission(v_company,'audit.read') then raise exception 'DEFECT: bootstrapped owner lacks audit.read via resolver'; end if;
  if not public.has_permission(v_company,'user.read')  then raise exception 'DEFECT: bootstrapped owner lacks user.read via resolver'; end if;
  if (select count(*) from public.accessible_company_ids()) <> 1 then raise exception 'DEFECT: owner accessible_company_ids != 1'; end if;
  if (select count(*) from public.companies) <> 1 then raise exception 'DEFECT: owner cannot see own company via RLS'; end if;
  raise notice 'PASS bootstrap: owner satisfies M4 resolver (permissions resolve; sees own tenant)';
end $$;

rollback;
