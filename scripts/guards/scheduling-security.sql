-- Tier-2 BEHAVIORAL Scheduling security test (Phase 2 M6A) — blocking gate.
-- Proves: calendar events are tenant + branch isolated, writes require schedule.manage + branch membership, reads
-- require schedule.read + branch membership, and every write is audited. Non-financial module (no GL). Runs as
-- authenticated owners/workers with simulated JWT. Self-contained BEGIN/ROLLBACK; any DEFECT raises.
\set ON_ERROR_STOP on
begin;

-- ── fixtures (postgres) ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-00000000000a','authenticated','authenticated','ownerA@t.local'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-00000000000b','authenticated','authenticated','ownerB@t.local'),
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-00000000000c','authenticated','authenticated','workerA2@t.local');
insert into public.users (id, auth_user_id, display_name) values
  ('10000000-0000-0000-0000-00000000000a','0a000000-0000-0000-0000-00000000000a','Owner A'),
  ('10000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b','Owner B'),
  ('10000000-0000-0000-0000-00000000000c','0c000000-0000-0000-0000-00000000000c','Worker A2');
insert into public.companies (id, company_code, name) values
  ('11111111-1111-1111-1111-111111111111','CO-A','Company A'),
  ('22222222-2222-2222-2222-222222222222','CO-B','Company B');
insert into public.branches (id, company_id, branch_code, name) values
  ('a1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','BR-A1','Branch A1'),
  ('a2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','BR-A2','Branch A2'),
  ('b1111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','BR-B1','Branch B1');
insert into public.roles (id, company_id, role_key, description) values
  ('20000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','Owner A'),
  ('20000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','owner','Owner B'),
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker (schedule.read only)');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions where permission_key in ('schedule.read','schedule.manage');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions where permission_key in ('schedule.read','schedule.manage');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000c', id from public.permissions where permission_key in ('schedule.read');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000c');

-- ── HAPPY: owner A creates an event in A1; it is audited ──
do $$ declare v_ev uuid; n int;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.calendar_events (company_id, branch_id, event_type, title, description, event_date, created_by)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','Planting','Transplant lettuce block A','poly-tunnel 3','2026-07-10','10000000-0000-0000-0000-00000000000a')
    returning id into v_ev;
  set local role postgres;
  select count(*) into n from public.audit_events where entity_type='calendar_events' and entity_id=v_ev;
  if n < 1 then raise exception 'DEFECT sched: event create not audited'; end if;
  raise notice 'PASS sched: owner A created a branch-A1 event (schedule.manage), audited';
end $$;

-- ── ATTACKS ──
-- worker with schedule.read but NOT schedule.manage cannot create
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  insert into public.calendar_events (company_id, branch_id, event_type, title, event_date, created_by)
    values ('11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','Meeting','x','2026-07-10','10000000-0000-0000-0000-00000000000c');
  raise exception 'DEFECT sched: worker without schedule.manage created an event';
exception when insufficient_privilege then raise notice 'PASS sched: create denied without schedule.manage'; end $$;

-- cross-company: owner A cannot create in company B's branch
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.calendar_events (company_id, branch_id, event_type, title, event_date, created_by)
    values ('22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','Meeting','hack','2026-07-10','10000000-0000-0000-0000-00000000000a');
  raise exception 'DEFECT sched: owner A created an event in company B';
exception when insufficient_privilege then raise notice 'PASS sched: cross-company event create denied'; end $$;

-- branch isolation: worker C (member of A2, has schedule.read) cannot see the A1 event
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  select count(*) into n from public.calendar_events where branch_id='a1111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'DEFECT sched: A2 member saw % A1 events (branch isolation broken)', n; end if;
  raise notice 'PASS sched: branch-A1 events invisible to a non-member of A1';
end $$;

-- tenant isolation: owner B sees zero company-A events
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0b000000-0000-0000-0000-00000000000b"}';
  select count(*) into n from public.calendar_events where company_id='11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'DEFECT sched: owner B saw company-A events'; end if;
  raise notice 'PASS sched: company-A events isolated from company B';
end $$;

-- positive: owner A (member of A1) sees the A1 event
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select count(*) into n from public.calendar_events where branch_id='a1111111-1111-1111-1111-111111111111';
  if n < 1 then raise exception 'DEFECT sched: owner A cannot see the A1 event'; end if;
  raise notice 'PASS sched: owner A (member of A1) sees the A1 event';
end $$;

-- update/delete gated by schedule.manage: worker C cannot update or delete (RLS → 0 rows affected, no error, so assert count)
do $$ declare v_ev uuid; n int; begin
  set local role postgres; select id into v_ev from public.calendar_events where branch_id='a1111111-1111-1111-1111-111111111111' limit 1;
  set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  update public.calendar_events set title='hijacked' where id = v_ev;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'DEFECT sched: worker updated an event without schedule.manage'; end if;
  delete from public.calendar_events where id = v_ev;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'DEFECT sched: worker deleted an event without schedule.manage'; end if;
  raise notice 'PASS sched: update/delete blocked without schedule.manage (RLS, 0 rows affected)';
end $$;

-- owner A can update + delete their own branch event
do $$ declare v_ev uuid; n int; begin
  set local role postgres; select id into v_ev from public.calendar_events where branch_id='a1111111-1111-1111-1111-111111111111' limit 1;
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  update public.calendar_events set status='Completed' where id = v_ev;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'DEFECT sched: owner A could not update the A1 event'; end if;
  delete from public.calendar_events where id = v_ev;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'DEFECT sched: owner A could not delete the A1 event'; end if;
  raise notice 'PASS sched: owner A (schedule.manage) can update + delete branch-A1 events';
end $$;

rollback;
