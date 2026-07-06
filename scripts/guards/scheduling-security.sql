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

-- ── P2-M6C visibility tiers: Management events hidden from staff without schedule.read_private ──
-- fixtures: a manager-tier reader in branch A2 (read + read_private) and two A2 events (General + Management)
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0d000000-0000-0000-0000-00000000000d','authenticated','authenticated','managerA2@t.local');
insert into public.users (id, auth_user_id, display_name) values
  ('10000000-0000-0000-0000-00000000000d','0d000000-0000-0000-0000-00000000000d','Manager A2');
insert into public.roles (id, company_id, role_key, description) values
  ('20000000-0000-0000-0000-00000000000d','11111111-1111-1111-1111-111111111111','sched_manager','Reader with private visibility');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000d', id from public.permissions where permission_key in ('schedule.read','schedule.read_private');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000d','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000d');
insert into public.calendar_events (id, company_id, branch_id, event_type, title, event_date, visibility, created_by) values
  ('e1000000-0000-0000-0000-0000000000d1','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','Planting','Transplant kangkong','2026-07-11','General','10000000-0000-0000-0000-00000000000a'),
  ('e2000000-0000-0000-0000-0000000000d2','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','Meeting','Investor meeting — Q3 budget','2026-07-12','Management','10000000-0000-0000-0000-00000000000a');

-- staff (schedule.read only, A2 member) sees ONLY the General event
do $$ declare n int; n_mgmt int; begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  select count(*), count(*) filter (where visibility = 'Management')
    into n, n_mgmt from public.calendar_events where branch_id='a2222222-2222-2222-2222-222222222222';
  if n <> 1 or n_mgmt <> 0 then raise exception 'DEFECT sched: staff saw % events (% Management) — investor meetings leaked', n, n_mgmt; end if;
  raise notice 'PASS sched: Management events hidden from staff without schedule.read_private (M6C)';
end $$;
-- manager tier (read + read_private, A2 member) sees BOTH
do $$ declare n int; begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0d000000-0000-0000-0000-00000000000d"}';
  select count(*) into n from public.calendar_events where branch_id='a2222222-2222-2222-2222-222222222222';
  if n <> 2 then raise exception 'DEFECT sched: read_private holder saw % of 2 tiered events', n; end if;
  raise notice 'PASS sched: schedule.read_private reveals Management events (grantable per role = the owner setting, M6C)';
end $$;
-- read_private alone still respects branch isolation: manager A2 sees no A1 events
do $$ declare n int; begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0d000000-0000-0000-0000-00000000000d"}';
  select count(*) into n from public.calendar_events where branch_id='a1111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'DEFECT sched: read_private bypassed branch isolation'; end if;
  raise notice 'PASS sched: read_private does not bypass branch membership (M6C)';
end $$;

-- ── P2-M6D: timed events (day view). manager can set a start/end time; the order check rejects end<=start ──
do $$ declare n int; begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.calendar_events (company_id, branch_id, event_type, title, event_date, start_time, end_time, created_by)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','Delivery','Vendor pickup','2026-07-13','08:00','10:00','10000000-0000-0000-0000-00000000000a');
  select count(*) into n from public.calendar_events where start_time = '08:00' and end_time = '10:00';
  if n <> 1 then raise exception 'DEFECT sched: timed event not stored'; end if;
  raise notice 'PASS sched: manager set a timed event (start/end time, M6D day view)';
end $$;
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.calendar_events (company_id, branch_id, event_type, title, event_date, start_time, end_time, created_by)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','Meeting','bad times','2026-07-13','10:00','09:00','10000000-0000-0000-0000-00000000000a');
  raise exception 'DEFECT sched: end_time <= start_time was accepted';
exception when check_violation then raise notice 'PASS sched: end<=start time rejected (M6D check)'; end $$;

-- ── DayFlow cross-day drag (P2-M6E): a setTime update that also moves event_date is still RLS-gated + audited ──
do $$ declare v_ev uuid; n int; begin
  set local role postgres; select id into v_ev from public.calendar_events where branch_id='a1111111-1111-1111-1111-111111111111' and start_time='08:00' limit 1;
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  update public.calendar_events set event_date='2026-07-15', start_time='09:00', end_time='11:00' where id = v_ev;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'DEFECT sched: owner cross-day setTime (event_date move) updated % rows', n; end if;
  set local role postgres; select count(*) into n from public.audit_events where entity_type='calendar_events' and entity_id=v_ev;
  if n < 1 then raise exception 'DEFECT sched: cross-day setTime not audited'; end if;
  raise notice 'PASS sched: owner cross-day setTime (event_date move) allowed + audited (DayFlow)';
end $$;
-- worker C (schedule.read only, A2 member) cannot move an event across days (RLS → 0 rows; event_date is updatable only under schedule.manage)
do $$ declare v_ev uuid; n int; begin
  set local role postgres; select id into v_ev from public.calendar_events where branch_id='a1111111-1111-1111-1111-111111111111' limit 1;
  set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  update public.calendar_events set event_date='2026-07-20' where id = v_ev;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'DEFECT sched: worker moved an event across days without schedule.manage'; end if;
  raise notice 'PASS sched: cross-day setTime denied without schedule.manage (RLS, 0 rows)';
end $$;

rollback;
