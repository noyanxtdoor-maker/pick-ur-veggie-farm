-- Tier-2 BEHAVIORAL Projects security test (Phase 2 M7A) — blocking gate.
-- Proves: projects + their task checklists are tenant + branch isolated, writes require project.manage + branch
-- membership, task rows are scoped through their parent project (EXISTS + is_branch_member), and writes are
-- audited. Non-financial (no GL). Self-contained BEGIN/ROLLBACK; any DEFECT raises under ON_ERROR_STOP.
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
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker (project.read only)');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions where permission_key in ('project.read','project.manage');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions where permission_key in ('project.read','project.manage');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000c', id from public.permissions where permission_key in ('project.read');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000c');

-- ── HAPPY: owner A creates a project in A1 + a task; toggles it done ──
do $$ declare v_proj uuid; v_task uuid; n int;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.projects (company_id, branch_id, name, description, status, created_by)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','Tunnel 3 rebuild','replace poly cover','In Progress','10000000-0000-0000-0000-00000000000a')
    returning id into v_proj;
  insert into public.project_tasks (company_id, project_id, text) values ('11111111-1111-1111-1111-111111111111', v_proj, 'order poly sheet') returning id into v_task;
  update public.project_tasks set completed = true, completed_by='10000000-0000-0000-0000-00000000000a', completed_at=now() where id = v_task;
  if (select completed from public.project_tasks where id = v_task) is not true then raise exception 'DEFECT proj: task toggle failed'; end if;
  set local role postgres;
  select count(*) into n from public.audit_events where entity_type='projects' and entity_id=v_proj;
  if n < 1 then raise exception 'DEFECT proj: project create not audited'; end if;
  raise notice 'PASS proj: owner A created project + task, toggled done, audited';
end $$;

-- ── ATTACKS ──
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  insert into public.projects (company_id, branch_id, name, status, created_by)
    values ('11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','x','In Progress','10000000-0000-0000-0000-00000000000c');
  raise exception 'DEFECT proj: worker without project.manage created a project';
exception when insufficient_privilege then raise notice 'PASS proj: project create denied without project.manage'; end $$;

do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.projects (company_id, branch_id, name, status, created_by)
    values ('22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','hack','In Progress','10000000-0000-0000-0000-00000000000a');
  raise exception 'DEFECT proj: owner A created a project in company B';
exception when insufficient_privilege then raise notice 'PASS proj: cross-company project create denied'; end $$;

-- branch isolation: worker C (member A2, project.read) cannot see the A1 project or its tasks
do $$ declare np int; nt int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  select count(*) into np from public.projects where branch_id='a1111111-1111-1111-1111-111111111111';
  select count(*) into nt from public.project_tasks pt join public.projects p on p.id=pt.project_id where p.branch_id='a1111111-1111-1111-1111-111111111111';
  if np <> 0 or nt <> 0 then raise exception 'DEFECT proj: A2 member saw A1 projects/tasks (% projects, % tasks)', np, nt; end if;
  raise notice 'PASS proj: A1 projects + tasks invisible to a non-member of A1 (task scoping via parent)';
end $$;

-- worker cannot add a task to the A1 project (no manage + not member A1)
do $$ declare v_proj uuid; begin
  set local role postgres; select id into v_proj from public.projects where branch_id='a1111111-1111-1111-1111-111111111111' limit 1;
  set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  insert into public.project_tasks (company_id, project_id, text) values ('11111111-1111-1111-1111-111111111111', v_proj, 'sneaky task');
  raise exception 'DEFECT proj: non-manager added a task to a foreign project';
exception when insufficient_privilege then raise notice 'PASS proj: task insert denied without project.manage on the parent'; end $$;

-- tenant isolation: owner B sees zero company-A projects
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0b000000-0000-0000-0000-00000000000b"}';
  select count(*) into n from public.projects where company_id='11111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'DEFECT proj: owner B saw company-A projects'; end if;
  raise notice 'PASS proj: company-A projects isolated from company B';
end $$;

-- positive: owner A sees the project + its task
do $$ declare np int; nt int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select count(*) into np from public.projects where branch_id='a1111111-1111-1111-1111-111111111111';
  select count(*) into nt from public.project_tasks pt join public.projects p on p.id=pt.project_id where p.branch_id='a1111111-1111-1111-1111-111111111111';
  if np < 1 or nt < 1 then raise exception 'DEFECT proj: owner A cannot see the A1 project/task (% / %)', np, nt; end if;
  raise notice 'PASS proj: owner A (member of A1) sees the A1 project + task';
end $$;

rollback;
