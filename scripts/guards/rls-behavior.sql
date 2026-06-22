-- Tier-2 BEHAVIORAL security test (C5 §3, B1 §9) — blocking gate from M4 onward.
-- Proves the resolver + RLS *behavior*, not just that "RLS exists": cross-company isolation, permission
-- gating, role-name-injection immunity, and lifecycle (suspended/expired/inactive/deprecated) handling.
-- Runs as the `authenticated` role with simulated JWT claims (request.jwt.claims.sub = auth user id).
-- Self-contained: sets up its own fixtures inside one transaction and ROLLBACKs — leaves no data, no drift.
-- Any DEFECT raises an exception; with `-v ON_ERROR_STOP=1` that fails the job. Clean run prints PASS lines.
\set ON_ERROR_STOP on
begin;

-- ── fixtures (as postgres superuser; bypasses RLS) ───────────────────────────
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1','authenticated','authenticated','a@t.local'),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1','authenticated','authenticated','b@t.local'),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000c1','authenticated','authenticated','c@t.local'),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000d1','authenticated','authenticated','d@t.local'),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000e1','authenticated','authenticated','e@t.local'),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000f1','authenticated','authenticated','f@t.local'),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000a01','authenticated','authenticated','g@t.local'),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000b01','authenticated','authenticated','i@t.local');

insert into public.companies (id, company_code, name, status) values
  ('11111111-1111-1111-1111-111111111111','CO-A','Company A','Active'),
  ('22222222-2222-2222-2222-222222222222','CO-B','Company B','Active'),
  ('33333333-3333-3333-3333-333333333333','CO-Z','Company Z','Archived');   -- inactive company

insert into public.branches (id, company_id, branch_code, name, status) values
  ('a1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','BR-A1','Branch A1','Active'),
  ('a2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','BR-A2','Branch A2','Suspended'), -- suspended branch
  ('b1111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','BR-B1','Branch B1','Active'),
  ('c1111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','BR-Z1','Branch Z1','Active');

insert into public.users (id, auth_user_id, display_name, account_status) values
  ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','User A','Active'),
  ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1','User B','Active'),
  ('10000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000c1','User C','Active'),
  ('10000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d1','User D','Suspended'),   -- suspended user
  ('10000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1','User E','Active'),
  ('10000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f1','User F','Active'),
  ('10000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-000000000a01','User G','Active'),
  ('10000000-0000-0000-0000-000000000b01','00000000-0000-0000-0000-000000000b01','User I','Active');

insert into public.roles (id, company_id, role_key, description, status) values
  ('20000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','worker','Worker','Active'),
  ('20000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','superadmin','SuperAdmin label (no permissions)','Active'),
  ('20000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','legacy','Deprecated role','Deprecated'), -- deprecated role
  ('20000000-0000-0000-0000-0000000000a4','11111111-1111-1111-1111-111111111111','admin','Admin','Active'),
  ('20000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','workerb','Worker B','Active'),
  ('20000000-0000-0000-0000-0000000000c1','33333333-3333-3333-3333-333333333333','workerz','Worker Z','Active');

-- guard:rls owns its permission fixtures within this rolled-back transaction; clear the M6-seeded catalog first
-- so the synthetic ids below don't collide on permission_key (the seeded catalog is restored on ROLLBACK).
delete from public.permissions;
insert into public.permissions (id, permission_key, description, status) values
  ('30000000-0000-0000-0000-0000000000a1','inventory.read','Read inventory','Active'),
  ('30000000-0000-0000-0000-0000000000a2','user.read','Read users','Active'),
  ('30000000-0000-0000-0000-0000000000a3','membership.read','Read memberships','Active'),
  ('30000000-0000-0000-0000-0000000000a4','reports.read','Read reports','Deprecated'),  -- deprecated permission
  ('30000000-0000-0000-0000-0000000000a5','audit.read','Read audit log','Active');

insert into public.role_permissions (company_id, role_id, permission_id) values
  ('11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a1','30000000-0000-0000-0000-0000000000a1'), -- worker -> inventory.read
  ('11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a3','30000000-0000-0000-0000-0000000000a1'), -- legacy(deprecated role) -> inventory.read
  ('11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a4','30000000-0000-0000-0000-0000000000a2'), -- admin -> user.read
  ('11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a4','30000000-0000-0000-0000-0000000000a3'), -- admin -> membership.read
  ('11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a4','30000000-0000-0000-0000-0000000000a4'), -- admin -> reports.read (deprecated perm)
  ('11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a4','30000000-0000-0000-0000-0000000000a5'), -- admin -> audit.read
  ('22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-0000000000b1','30000000-0000-0000-0000-0000000000a1'), -- workerb -> inventory.read (company B)
  ('33333333-3333-3333-3333-333333333333','20000000-0000-0000-0000-0000000000c1','30000000-0000-0000-0000-0000000000a1'); -- workerz -> inventory.read (company Z)
  -- superadmin role: intentionally NO role_permissions

insert into public.user_branch_roles (id, user_id, company_id, branch_id, role_id, assignment_status, expires_at) values
  ('40000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a1','Active',null),       -- uA worker@A
  ('40000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000b1','Active',null),       -- uB worker@B
  ('40000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-0000000000c1','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a2','Active',null),       -- uC superadmin@A (no perms)
  ('40000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-0000000000d1','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a1','Active',null),       -- uD worker@A (user suspended)
  ('40000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000e1','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a1','Active',now()-interval '1 day'), -- uE worker@A (expired)
  ('40000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-0000000000f1','33333333-3333-3333-3333-333333333333','c1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000c1','Active',null),       -- uF worker@Z (company archived)
  ('40000000-0000-0000-0000-000000000a01','10000000-0000-0000-0000-000000000a01','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a4','Active',null),       -- uG admin@A
  ('40000000-0000-0000-0000-000000000b01','10000000-0000-0000-0000-000000000b01','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a3','Active',null);       -- uI legacy(deprecated role)@A

-- ── persona uA: worker@A — cross-company isolation + permission gating ────────
do $$ declare n int; begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
  select count(*) into n from public.companies;                                         if n<>1 then raise exception 'DEFECT uA: sees % companies (expect 1)',n; end if;
  select count(*) into n from public.companies where id='22222222-2222-2222-2222-222222222222'; if n<>0 then raise exception 'DEFECT uA: sees company B'; end if;
  select count(*) into n from public.branches where company_id='22222222-2222-2222-2222-222222222222'; if n<>0 then raise exception 'DEFECT uA: sees B branches'; end if;
  select count(*) into n from public.roles where company_id='22222222-2222-2222-2222-222222222222'; if n<>0 then raise exception 'DEFECT uA: sees B roles'; end if;
  select count(*) into n from public.role_permissions where company_id='22222222-2222-2222-2222-222222222222'; if n<>0 then raise exception 'DEFECT uA: sees B role_permissions'; end if;
  select count(*) into n from public.user_branch_roles where company_id='22222222-2222-2222-2222-222222222222'; if n<>0 then raise exception 'DEFECT uA: sees B memberships'; end if;
  select count(*) into n from public.companies where id='11111111-1111-1111-1111-111111111111'; if n<>1 then raise exception 'DEFECT uA: cannot see own company A'; end if;
  select count(*) into n from public.branches where company_id='11111111-1111-1111-1111-111111111111'; if n<>2 then raise exception 'DEFECT uA: sees % A branches (expect 2 incl suspended)',n; end if;
  select count(*) into n from public.user_branch_roles;                                 if n<>1 then raise exception 'DEFECT uA: sees % memberships (expect own=1, no membership.read)',n; end if;
  select count(*) into n from public.users;                                             if n<>1 then raise exception 'DEFECT uA: sees % users (expect self=1, no user.read)',n; end if;
  if not public.has_permission('11111111-1111-1111-1111-111111111111','inventory.read') then raise exception 'DEFECT uA: lacks granted inventory.read'; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','user.read')       then raise exception 'DEFECT uA: escalated to user.read'; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','membership.read') then raise exception 'DEFECT uA: escalated to membership.read'; end if;
  if public.has_permission('22222222-2222-2222-2222-222222222222','inventory.read')  then raise exception 'DEFECT uA: has permission in company B'; end if;
  select count(*) into n from public.accessible_company_ids();                          if n<>1 then raise exception 'DEFECT uA: accessible_company_ids=% (expect 1)',n; end if;
  raise notice 'PASS uA worker@A: cross-company isolation + permission gating';
end $$;

-- uA cannot self-grant a membership / escalate (no write grant)
do $$ begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
  insert into public.user_branch_roles (user_id,company_id,branch_id,role_id)
    values ('10000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-0000000000a4');
  raise exception 'DEFECT uA: self-granted a membership (privilege escalation)';
exception when insufficient_privilege then raise notice 'PASS uA: self-grant membership denied (%)', sqlstate; end $$;

-- uA cannot write the authz tables it can now read
do $$ begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
  insert into public.roles (company_id,role_key) values ('11111111-1111-1111-1111-111111111111','hacked');
  raise exception 'DEFECT uA: inserted a role';
exception when insufficient_privilege then raise notice 'PASS uA: role insert denied (%)', sqlstate; end $$;

-- ── persona uB: worker@B — reverse isolation (B cannot see A) ─────────────────
do $$ declare n int; begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
  select count(*) into n from public.companies;                                         if n<>1 then raise exception 'DEFECT uB: sees % companies (expect 1)',n; end if;
  select count(*) into n from public.companies where id='11111111-1111-1111-1111-111111111111'; if n<>0 then raise exception 'DEFECT uB: sees company A'; end if;
  if public.has_permission('22222222-2222-2222-2222-222222222222','inventory.read') is not true then raise exception 'DEFECT uB: lacks own inventory.read'; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','inventory.read')      then raise exception 'DEFECT uB: has permission in company A'; end if;
  raise notice 'PASS uB worker@B: reverse cross-company isolation';
end $$;

-- ── persona uC: "SuperAdmin" role with NO permissions — role-name injection ───
do $$ declare n int; begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1"}';
  select count(*) into n from public.accessible_company_ids();                          if n<>1 then raise exception 'DEFECT uC: accessible_company_ids=% (expect 1, is a member)',n; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','inventory.read') then raise exception 'DEFECT uC: SuperAdmin label granted inventory.read'; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','user.read')      then raise exception 'DEFECT uC: SuperAdmin label granted user.read'; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','membership.read') then raise exception 'DEFECT uC: SuperAdmin label granted membership.read'; end if;
  raise notice 'PASS uC: role name "SuperAdmin" (no role_permissions) grants ZERO authorization';
end $$;

-- ── persona uD: suspended user — total denial (B1 §3) ────────────────────────
do $$ declare n int; begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
  select count(*) into n from public.accessible_company_ids();  if n<>0 then raise exception 'DEFECT uD(suspended): accessible_company_ids=%',n; end if;
  select count(*) into n from public.companies;                 if n<>0 then raise exception 'DEFECT uD(suspended): sees % companies',n; end if;
  select count(*) into n from public.users;                     if n<>0 then raise exception 'DEFECT uD(suspended): sees own user row (% rows)',n; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','inventory.read') then raise exception 'DEFECT uD(suspended): retained permission'; end if;
  raise notice 'PASS uD suspended-user: zero access (incl. own row)';
end $$;

-- ── persona uE: expired assignment — denial ──────────────────────────────────
do $$ declare n int; begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
  select count(*) into n from public.accessible_company_ids();  if n<>0 then raise exception 'DEFECT uE(expired): accessible_company_ids=%',n; end if;
  select count(*) into n from public.companies;                 if n<>0 then raise exception 'DEFECT uE(expired): sees % companies',n; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','inventory.read') then raise exception 'DEFECT uE(expired): retained permission'; end if;
  raise notice 'PASS uE expired-assignment: zero access';
end $$;

-- ── persona uF: inactive (Archived) company — denial ─────────────────────────
do $$ declare n int; begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1"}';
  select count(*) into n from public.accessible_company_ids();  if n<>0 then raise exception 'DEFECT uF(archived co): accessible_company_ids=%',n; end if;
  select count(*) into n from public.companies;                 if n<>0 then raise exception 'DEFECT uF(archived co): sees % companies',n; end if;
  if public.has_permission('33333333-3333-3333-3333-333333333333','inventory.read') then raise exception 'DEFECT uF(archived co): retained permission'; end if;
  raise notice 'PASS uF inactive-company: zero access';
end $$;

-- ── persona uG: admin@A — positive permission-gated reads + deprecated perm ───
do $$ declare n int; begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000a01"}';
  if not public.has_permission('11111111-1111-1111-1111-111111111111','user.read')       then raise exception 'DEFECT uG: lacks granted user.read'; end if;
  if not public.has_permission('11111111-1111-1111-1111-111111111111','membership.read') then raise exception 'DEFECT uG: lacks granted membership.read'; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','reports.read')         then raise exception 'DEFECT uG: deprecated permission reports.read granted'; end if;
  select count(*) into n from public.users where id='10000000-0000-0000-0000-0000000000a1'; if n<>1 then raise exception 'DEFECT uG(user.read): cannot see member uA'; end if;
  select count(*) into n from public.users;                                                 if n<2 then raise exception 'DEFECT uG(user.read): sees only % users',n; end if;
  select count(*) into n from public.user_branch_roles;                                      if n<2 then raise exception 'DEFECT uG(membership.read): sees only % memberships',n; end if;
  if public.has_permission('22222222-2222-2222-2222-222222222222','user.read') then raise exception 'DEFECT uG: user.read leaked into company B'; end if;
  raise notice 'PASS uG admin@A: permission-gated reads work; deprecated permission denied; no cross-company leak';
end $$;

-- ── persona uI: deprecated role — member sees company, but ZERO permissions ───
do $$ declare n int; begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000b01"}';
  select count(*) into n from public.accessible_company_ids();  if n<>1 then raise exception 'DEFECT uI: accessible_company_ids=% (member, expect 1)',n; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111','inventory.read') then raise exception 'DEFECT uI: deprecated role granted inventory.read'; end if;
  raise notice 'PASS uI deprecated-role: member retains company visibility but ZERO permissions';
end $$;

-- ── USING(true) proof: no tenant table has an over-broad (true) policy ────────
do $$ declare bad text; begin
  select string_agg(tablename||'.'||policyname, ', ') into bad
  from pg_policies
  where schemaname='public'
    and tablename in ('companies','branches','roles','role_permissions','user_branch_roles','users')
    and (coalesce(qual,'') = 'true');
  if bad is not null then raise exception 'DEFECT: over-broad USING(true) policy on tenant table(s): %', bad; end if;
  raise notice 'PASS: no USING(true) policy on any tenant table';
end $$;

-- ════════ AUDIT (M5): immutability · attribution · cross-tenant isolation ════════
set local role postgres;
insert into public.audit_events (id, company_id, branch_id, actor_user_id, event_class, event_type, module) values
  ('50000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','10000000-0000-0000-0000-0000000000a1','Business','inventory.updated','inventory'),
  ('50000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','10000000-0000-0000-0000-0000000000b1','Business','inventory.updated','inventory');
insert into public.audit_events (id, event_class, event_type, module) values
  ('50000000-0000-0000-0000-0000000000f1','Security','login.failed','auth');  -- platform event: no tenant, no actor

-- Attack 2 — service_role cannot rewrite/erase history (no UPDATE/DELETE/TRUNCATE grant)
do $$ begin set local role service_role;
  update public.audit_events set event_type='tamper' where id='50000000-0000-0000-0000-0000000000a1';
  raise exception 'DEFECT: service_role UPDATE audit succeeded';
exception when insufficient_privilege then raise notice 'PASS audit: service_role UPDATE denied (%)', sqlstate; end $$;
do $$ begin set local role service_role;
  delete from public.audit_events where id='50000000-0000-0000-0000-0000000000a1';
  raise exception 'DEFECT: service_role DELETE audit succeeded';
exception when insufficient_privilege then raise notice 'PASS audit: service_role DELETE denied (%)', sqlstate; end $$;
do $$ begin set local role service_role;
  truncate public.audit_events;
  raise exception 'DEFECT: service_role TRUNCATE audit succeeded';
exception when insufficient_privilege then raise notice 'PASS audit: service_role TRUNCATE denied (%)', sqlstate; end $$;

-- Attack 1 — even the table owner (superuser) is blocked by the append-only trigger
do $$ begin set local role postgres;
  update public.audit_events set event_type='tamper' where id='50000000-0000-0000-0000-0000000000a1';
  raise exception 'DEFECT: owner UPDATE audit succeeded (trigger missing)';
exception when restrict_violation then raise notice 'PASS audit: owner UPDATE blocked by trigger (%)', sqlstate; end $$;
do $$ begin set local role postgres;
  delete from public.audit_events where id='50000000-0000-0000-0000-0000000000a1';
  raise exception 'DEFECT: owner DELETE audit succeeded (trigger missing)';
exception when restrict_violation then raise notice 'PASS audit: owner DELETE blocked by trigger (%)', sqlstate; end $$;
do $$ begin set local role postgres;
  truncate public.audit_events;
  raise exception 'DEFECT: owner TRUNCATE audit succeeded (trigger missing)';
exception when restrict_violation then raise notice 'PASS audit: owner TRUNCATE blocked by trigger (%)', sqlstate; end $$;

-- Attack 3 — an actioned event must name an actor (System/Security may be actor-less)
do $$ begin set local role postgres;
  insert into public.audit_events (company_id, event_class, event_type) values ('11111111-1111-1111-1111-111111111111','Business','no.actor');
  raise exception 'DEFECT: Business audit event with no actor accepted';
exception when check_violation then raise notice 'PASS audit: actor-less Business event rejected (%)', sqlstate; end $$;

-- Attack 6 — orphan audit (referencing a non-existent company) is rejected
do $$ begin set local role postgres;
  insert into public.audit_events (company_id, actor_auth_id, event_class, event_type)
    values ('99999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-0000000000a1','System','orphan');
  raise exception 'DEFECT: orphan audit (bad company_id) accepted';
exception when foreign_key_violation then raise notice 'PASS audit: orphan audit FK rejected (%)', sqlstate; end $$;

-- server-authoritative time — service_role cannot set server_timestamp (no column grant) → no backdating
do $$ begin set local role service_role;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, server_timestamp)
    values ('11111111-1111-1111-1111-111111111111','10000000-0000-0000-0000-0000000000a1','Business','backdate', now() - interval '10 years');
  raise exception 'DEFECT: service_role set server_timestamp (backdating)';
exception when insufficient_privilege then raise notice 'PASS audit: service_role cannot set server_timestamp (%)', sqlstate; end $$;

-- Attack 5 (positive) — service_role CAN append a legitimate audit record (granted columns only)
do $$ declare before_n int; after_n int; begin
  set local role postgres; select count(*) into before_n from public.audit_events;
  set local role service_role;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module)
    values ('11111111-1111-1111-1111-111111111111','10000000-0000-0000-0000-0000000000a1','Business','inventory.created','inventory');
  set local role postgres; select count(*) into after_n from public.audit_events;
  if after_n <> before_n + 1 then raise exception 'DEFECT: service_role legitimate audit insert failed'; end if;
  raise notice 'PASS audit: service_role can append a legitimate audit record';
end $$;

-- Attack 4 — cross-tenant audit isolation: uG (audit.read@A) sees only company A; platform/company-B hidden
do $$ declare n int; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000a01"}';  -- uG admin@A
  select count(*) into n from public.audit_events where company_id='22222222-2222-2222-2222-222222222222';
  if n<>0 then raise exception 'DEFECT: uG read company B audit (% rows)',n; end if;
  select count(*) into n from public.audit_events where company_id is null;
  if n<>0 then raise exception 'DEFECT: uG read platform audit (% rows)',n; end if;
  select count(*) into n from public.audit_events where company_id='11111111-1111-1111-1111-111111111111';
  if n<1 then raise exception 'DEFECT: uG cannot read own company A audit'; end if;
  raise notice 'PASS audit: uG sees only company A audit (company-B + platform isolated)';
end $$;
do $$ declare n int; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';  -- uA worker, no audit.read
  select count(*) into n from public.audit_events;
  if n<>0 then raise exception 'DEFECT: uA (no audit.read) read % audit rows',n; end if;
  raise notice 'PASS audit: uA without audit.read sees zero audit records';
end $$;

rollback;
