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
insert into public.roles (id, company_id, role_key, description) values
  ('20000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','Owner A'),
  ('20000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','owner','Owner B');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions
   where permission_key in ('company.manage','branch.manage','role.manage','user.invite','membership.manage','user.read');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions
   where permission_key in ('company.manage','branch.manage','role.manage','user.invite','membership.manage');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b');

-- ── HAPPY PATH: owner manages org → invites → invitee accepts → isolated; + single-use replay ──
do $$ declare v_role uuid; v_token text; v_membership uuid; n int; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';  -- owner A
  insert into public.roles (company_id, role_key, description)
    values ('11111111-1111-1111-1111-111111111111','worker','Worker') returning id into v_role;            -- role.manage
  insert into public.role_permissions (company_id, role_id, permission_id)
    select '11111111-1111-1111-1111-111111111111', v_role, id from public.permissions where permission_key='user.read';
  insert into public.branches (company_id, branch_code, name)
    values ('11111111-1111-1111-1111-111111111111','BR-A2','Branch A2');                                    -- branch.manage
  update public.companies set name='Company A (edited)' where id='11111111-1111-1111-1111-111111111111';    -- company.manage
  v_token := public.invite_user('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111', v_role, 'invitee@t.local', 7);
  set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';  -- invitee
  v_membership := public.accept_invitation(v_token);
  begin
    perform public.accept_invitation(v_token);                                                              -- replay
    raise exception 'DEFECT org: invitation token was replayed';
  exception when raise_exception then raise notice 'PASS org: token replay denied (single-use)'; end;
  if (select count(*) from public.companies) <> 1 then raise exception 'DEFECT org: invitee sees % companies', (select count(*) from public.companies); end if;
  if (select count(*) from public.companies where id='22222222-2222-2222-2222-222222222222') <> 0 then raise exception 'DEFECT org: invitee sees company B'; end if;
  if not public.has_permission('11111111-1111-1111-1111-111111111111','user.read') then raise exception 'DEFECT org: invitee lacks granted worker permission'; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','membership.manage') then raise exception 'DEFECT org: invitee escalated to membership.manage'; end if;
  set local role postgres;
  select count(*) into n from public.user_branch_roles where id = v_membership; if n<>1 then raise exception 'DEFECT org: membership not created'; end if;
  raise notice 'PASS org: workflow — owner managed org + invited; invitee accepted, isolated to company A with exactly the worker permission set';
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
-- invite into company the owner does not manage
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.invite_user('22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b','x@t.local',7);
  raise exception 'DEFECT org: owner A invited into company B';
exception when insufficient_privilege then raise notice 'PASS org: invite into a foreign company denied (user.invite)'; end $$;
-- invite with a cross-company branch / role → composite FK blocks it
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.invite_user('11111111-1111-1111-1111-111111111111','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a','x@t.local',7);
  raise exception 'DEFECT org: invite accepted a cross-company branch';
exception when foreign_key_violation then raise notice 'PASS org: invite cross-company branch blocked (composite FK)'; end $$;
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.invite_user('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b','x@t.local',7);
  raise exception 'DEFECT org: invite accepted a cross-company role';
exception when foreign_key_violation then raise notice 'PASS org: invite cross-company role blocked (composite FK)'; end $$;
-- the invitee (worker) cannot invite or self-assign a membership (no escalation)
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.invite_user('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a','x@t.local',7);
  raise exception 'DEFECT org: a worker invited a user';
exception when insufficient_privilege then raise notice 'PASS org: worker cannot invite (no user.invite)'; end $$;
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a');
  raise exception 'DEFECT org: worker self-assigned a membership';
exception when insufficient_privilege then raise notice 'PASS org: worker cannot assign memberships (no membership.manage)'; end $$;
-- expired invitation cannot be accepted
do $$ begin set local role postgres;
  insert into public.invitations (company_id, branch_id, role_id, token, invited_by, expires_at)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a','expired-token-xyz','10000000-0000-0000-0000-00000000000a', now() - interval '1 day');
  set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.accept_invitation('expired-token-xyz');
  raise exception 'DEFECT org: expired invitation accepted';
exception when raise_exception then raise notice 'PASS org: expired invitation denied'; end $$;
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
