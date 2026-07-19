-- Tier-2 BEHAVIORAL Organization-Setup security test (Phase 2 M1) — blocking gate.
-- Proves the first authenticated-driven write model + invitation/membership flows + cross-company isolation.
-- Runs as authenticated owners/invitees with simulated JWT claims. Self-contained BEGIN/ROLLBACK; any DEFECT
-- raises → fails under -v ON_ERROR_STOP=1.
\set ON_ERROR_STOP on
begin;
-- P1A: the signup trigger is under test in auth-lifecycle-security.sql; these fixtures construct
-- identities manually with fixed ids, so silence it inside this rolled-back transaction.
set local app.p1a_skip_signup_trigger = '1';

-- ── fixtures (postgres): two companies, each with an owner holding the Module-1 management permissions ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-00000000000a','authenticated','authenticated','ownerA@t.local'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-00000000000b','authenticated','authenticated','ownerB@t.local'),
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-00000000000c','authenticated','authenticated','invitee@t.local');
insert into public.users (id, auth_user_id, display_name) values
  ('10000000-0000-0000-0000-00000000000a','0a000000-0000-0000-0000-00000000000a','Owner A'),
  ('10000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b','Owner B');
insert into public.companies (id, company_code, name) values
  ('11111111-1111-1111-1111-111111111111','CO-A','Company A'),
  ('22222222-2222-2222-2222-222222222222','CO-B','Company B');
insert into public.branches (id, company_id, branch_code, name) values
  ('a1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','BR-A1','Branch A1'),
  ('b1111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','BR-B1','Branch B1');
-- P1C: rank=50 matches the production invariant (bootstrap_initial_tenant always seeds owner at rank 50) —
-- required for these hand-built fixture owners to pass the P1C rank-outranks checks on roles/memberships.
insert into public.roles (id, company_id, role_key, description, rank) values
  ('20000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','Owner A', 50),
  ('20000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','owner','Owner B', 50);
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions
   where permission_key in ('company.manage','branch.manage','role.manage','user.invite','membership.manage','membership.read','user.read');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions
   where permission_key in ('company.manage','branch.manage','role.manage','user.invite','membership.manage');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b');

-- ── HAPPY PATH: owner manages org → grants a membership directly → grantee is isolated to their company ──
-- P1I (2026-07-13): invite_user/accept_invitation are RETIRED (owner decision — see the P1I migration).
-- This block now proves the same company/branch/role-management + isolation guarantees via the governed
-- direct-assignment path instead (matching how a real approval/reassignment works post-P1I).
do $$ declare v_role uuid; v_membership uuid; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';  -- owner A
  insert into public.roles (company_id, role_key, description)
    values ('11111111-1111-1111-1111-111111111111','worker','Worker') returning id into v_role;            -- role.manage
  insert into public.role_permissions (company_id, role_id, permission_id)
    select '11111111-1111-1111-1111-111111111111', v_role, id from public.permissions where permission_key='user.read';
  insert into public.branches (company_id, branch_code, name)
    values ('11111111-1111-1111-1111-111111111111','BR-A2','Branch A2');                                    -- branch.manage
  update public.companies set name='Company A (edited)', tax_rate=12.00 where id='11111111-1111-1111-1111-111111111111';    -- company.manage (P2S1: tax_rate too)
  set local role postgres;
  insert into public.users (id, auth_user_id, display_name) values
    ('10000000-0000-0000-0000-00000000000c','0c000000-0000-0000-0000-00000000000c','Invitee') on conflict do nothing;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';  -- owner A again
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111', v_role)
    returning id into v_membership;                                                                          -- membership.manage
  set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';  -- grantee
  if (select count(*) from public.companies) <> 1 then raise exception 'DEFECT org: grantee sees % companies', (select count(*) from public.companies); end if;
  if (select count(*) from public.companies where id='22222222-2222-2222-2222-222222222222') <> 0 then raise exception 'DEFECT org: grantee sees company B'; end if;
  if not public.has_permission('11111111-1111-1111-1111-111111111111','user.read') then raise exception 'DEFECT org: grantee lacks granted worker permission'; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','membership.manage') then raise exception 'DEFECT org: grantee escalated to membership.manage'; end if;
  set local role postgres;
  if not exists (select 1 from public.user_branch_roles where id = v_membership) then raise exception 'DEFECT org: membership not created'; end if;
  raise notice 'PASS org: workflow — owner managed org + granted a membership directly; grantee isolated to company A with exactly the worker permission set';
end $$;

-- P2S1: tax_rate is company.manage-editable (same grant shape as name), and its saved value round-trips.
do $$ declare v_rate numeric; begin
  set local role postgres;
  select tax_rate into v_rate from public.companies where id='11111111-1111-1111-1111-111111111111';
  if v_rate <> 12.00 then raise exception 'DEFECT p2s1: tax_rate did not save (got %)', v_rate; end if;
  raise notice 'PASS p2s1: company.manage-editable tax_rate saved and readable (12.00)';
end $$;
-- a member with only user.read (no company.manage) cannot edit tax_rate — the column grant is blanket
-- to `authenticated` (same shape as `name`), so enforcement is the RLS USING clause: a non-qualifying
-- actor's UPDATE matches 0 rows, not a Postgres-level permission exception (unlike company_code below,
-- which has no column grant at all and DOES raise insufficient_privilege).
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  update public.companies set tax_rate=99.00 where id='11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n<>0 then raise exception 'DEFECT p2s1: non-company.manage member edited tax_rate (% rows)', n; end if;
  set local role postgres;
  if (select tax_rate from public.companies where id='11111111-1111-1111-1111-111111111111') = 99.00 then
    raise exception 'DEFECT p2s1: tax_rate was changed despite 0-row report';
  end if;
  raise notice 'PASS p2s1: tax_rate edit denied without company.manage (0 rows, RLS-blocked)';
end $$;

-- P1I: invite_user/accept_invitation are retired but not dropped (never-hard-delete) — prove EXECUTE is
-- actually gone, not just unused by the app.
do $$ declare v_denied boolean := false; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  begin perform public.invite_user('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a','x@t.local',7);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT p1i: invite_user is still reachable after being retired'; end if;
  v_denied := false;
  begin perform public.accept_invitation('anything');
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT p1i: accept_invitation is still reachable after being retired'; end if;
  raise notice 'PASS p1i: invite_user and accept_invitation are both unreachable (EXECUTE revoked, owner decision 2026-07-13) — kept, not dropped';
end $$;

-- ── ATTACKS ──
-- cross-company branch creation
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.branches (company_id, branch_code, name) values ('22222222-2222-2222-2222-222222222222','BR-X','X');
  raise exception 'DEFECT org: owner A created a branch in company B';
exception when insufficient_privilege then raise notice 'PASS org: cross-company branch insert denied (RLS)'; end $$;
-- cross-company company edit → RLS hides B's row → 0 rows changed (no effect)
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  update public.companies set name='hijacked' where id='22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  if n<>0 then raise exception 'DEFECT org: owner A edited company B (% rows)', n; end if;
  raise notice 'PASS org: owner A cannot edit company B (0 rows, RLS-isolated)';
end $$;
-- immutable identifier: company_code not editable by anyone (no grant)
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  update public.companies set company_code='HACK' where id='11111111-1111-1111-1111-111111111111';
  raise exception 'DEFECT org: company_code was edited';
exception when insufficient_privilege then raise notice 'PASS org: company_code immutable (no column grant)'; end $$;
-- the grantee (worker) cannot self-assign a membership (no escalation) — P1I: the parallel "cannot invite"
-- assertions that used to live here tested invite_user, now retired (proven unreachable above instead).
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a');
  raise exception 'DEFECT org: worker self-assigned a membership';
exception when insufficient_privilege then raise notice 'PASS org: worker cannot assign memberships (no membership.manage)'; end $$;
-- membership management: owner A may suspend a membership in A (positive); cannot touch B (0 rows)
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  update public.user_branch_roles set assignment_status='Expired'
    where company_id='11111111-1111-1111-1111-111111111111' and user_id='10000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  if n<1 then raise exception 'DEFECT org: owner A could not suspend a membership in A'; end if;
  update public.user_branch_roles set assignment_status='Expired' where company_id='22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  if n<>0 then raise exception 'DEFECT org: owner A modified a membership in company B (% rows)', n; end if;
  raise notice 'PASS org: membership.manage works in A; cannot touch company B (RLS-isolated)';
end $$;
-- read isolation: owner A sees only company A across every org entity
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select count(*) into n from public.branches where company_id='22222222-2222-2222-2222-222222222222'; if n<>0 then raise exception 'DEFECT org: owner A sees B branches'; end if;
  select count(*) into n from public.roles where company_id='22222222-2222-2222-2222-222222222222'; if n<>0 then raise exception 'DEFECT org: owner A sees B roles'; end if;
  select count(*) into n from public.user_branch_roles where company_id='22222222-2222-2222-2222-222222222222'; if n<>0 then raise exception 'DEFECT org: owner A sees B memberships'; end if;
  select count(*) into n from public.invitations where company_id='22222222-2222-2222-2222-222222222222'; if n<>0 then raise exception 'DEFECT org: owner A sees B invitations'; end if;
  raise notice 'PASS org: owner A read-isolated from company B (branches/roles/memberships/invitations)';
end $$;

rollback;
