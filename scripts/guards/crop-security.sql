-- Tier-2 BEHAVIORAL Crop-Management security test (Phase 2 M2) — blocking gate.
-- Proves: company isolation, branch isolation (is_branch_member — first branch-owned table), permission gating
-- (crop.manage), composite-FK same-company integrity, archived-parent rejection, and audit-cannot-be-bypassed.
-- Runs as authenticated owners/workers with simulated JWT claims. Self-contained BEGIN/ROLLBACK; any DEFECT raises
-- → fails under -v ON_ERROR_STOP=1.
\set ON_ERROR_STOP on
begin;

-- ── fixtures (postgres): two companies; A has branches A1+A2; an owner per company (crop.manage) + a worker who
--    is a member of A2 ONLY and holds NO crop.manage. Company B gets a full catalog so isolation has data to hide.
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
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker (no crop.manage)');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions where permission_key = 'crop.manage';
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions where permission_key = 'crop.manage';
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),  -- owner A → branch A1
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),  -- owner B → branch B1
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000c');  -- worker → branch A2

-- Company B catalog (postgres fixture: bypasses RLS as superuser) so cross-company isolation has data to hide.
insert into public.crop_categories (id, company_id, category_code, name) values
  ('cb000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','CAT-B','B category');
insert into public.crop_varieties (id, company_id, category_id, variety_code, name) values
  ('cb000000-0000-0000-0000-0000000000b2','22222222-2222-2222-2222-222222222222','cb000000-0000-0000-0000-0000000000b1','VAR-B','B variety');
insert into public.crop_profiles (id, company_id, variety_id, profile_code, name) values
  ('cb000000-0000-0000-0000-0000000000b3','22222222-2222-2222-2222-222222222222','cb000000-0000-0000-0000-0000000000b2','PROF-B','B profile');
insert into public.planting_templates (company_id, branch_id, profile_id, template_code, name) values
  ('22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','cb000000-0000-0000-0000-0000000000b3','TMPL-B','B template');

-- ── HAPPY PATH: owner A builds the catalog and a branch-A1 template; all audited ──
do $$ declare v_cat uuid; v_var uuid; v_prof uuid; v_tmpl uuid; n int; n2 int;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';  -- owner A
  insert into public.crop_categories (company_id, category_code, name)
    values ('11111111-1111-1111-1111-111111111111','CAT-LEAFY','Leafy greens') returning id into v_cat;
  insert into public.crop_varieties (company_id, category_id, variety_code, name)
    values ('11111111-1111-1111-1111-111111111111', v_cat, 'VAR-LETTUCE','Lettuce') returning id into v_var;
  insert into public.crop_profiles (company_id, variety_id, profile_code, name, growth_duration_days)
    values ('11111111-1111-1111-1111-111111111111', v_var, 'PROF-LET','Lettuce standard', 45) returning id into v_prof;
  insert into public.planting_templates (company_id, branch_id, profile_id, template_code, name, planned_quantity)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111', v_prof, 'TMPL-LET-A1','Lettuce A1', 200) returning id into v_tmpl;
  set local role postgres;
  select count(*) into n from public.audit_events where company_id = '11111111-1111-1111-1111-111111111111' and module = 'crops';
  if n < 4 then raise exception 'DEFECT crop: expected >=4 audit events for company A crops, got %', n; end if;
  raise notice 'PASS crop: owner A built category→variety→profile→template; all 4 writes audited (% events)', n;

  -- archive + audit-on-update (audit cannot be bypassed)
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  update public.crop_categories set status = 'Archived' where id = v_cat;
  set local role postgres;
  select count(*) into n2 from public.audit_events where company_id = '11111111-1111-1111-1111-111111111111' and module = 'crops';
  if n2 <= n then raise exception 'DEFECT crop: archive UPDATE was not audited (% -> %)', n, n2; end if;
  raise notice 'PASS crop: category archived (Active->Archived) and the update was audited (% -> %)', n, n2;
end $$;

-- ── ATTACKS ──
-- cross-company read isolation: owner A sees ONLY company A across every crop entity (0 of B's)
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select count(*) into n from public.crop_categories where company_id = '22222222-2222-2222-2222-222222222222'; if n <> 0 then raise exception 'DEFECT crop: owner A sees B categories (%)', n; end if;
  select count(*) into n from public.crop_varieties  where company_id = '22222222-2222-2222-2222-222222222222'; if n <> 0 then raise exception 'DEFECT crop: owner A sees B varieties'; end if;
  select count(*) into n from public.crop_profiles   where company_id = '22222222-2222-2222-2222-222222222222'; if n <> 0 then raise exception 'DEFECT crop: owner A sees B profiles'; end if;
  select count(*) into n from public.planting_templates where company_id = '22222222-2222-2222-2222-222222222222'; if n <> 0 then raise exception 'DEFECT crop: owner A sees B templates'; end if;
  raise notice 'PASS crop: owner A read-isolated from company B (categories/varieties/profiles/templates)';
end $$;

-- cross-company write denied (RLS)
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.crop_categories (company_id, category_code, name) values ('22222222-2222-2222-2222-222222222222','HACK','x');
  raise exception 'DEFECT crop: owner A created a category in company B';
exception when insufficient_privilege then raise notice 'PASS crop: cross-company category insert denied (RLS)'; end $$;

-- permission gating: worker (no crop.manage) cannot write, but CAN read company A as a member
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  insert into public.crop_categories (company_id, category_code, name) values ('11111111-1111-1111-1111-111111111111','WK','x');
  raise exception 'DEFECT crop: a worker without crop.manage created a category';
exception when insufficient_privilege then raise notice 'PASS crop: worker without crop.manage cannot create (deny)'; end $$;
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  select count(*) into n from public.crop_categories where company_id = '11111111-1111-1111-1111-111111111111';
  if n < 1 then raise exception 'DEFECT crop: worker (member) cannot read company A categories'; end if;
  raise notice 'PASS crop: worker (member) CAN read company A categories (% visible)', n;
end $$;

-- composite FK: a same-company-authorized variety insert that references company B's category is blocked
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.crop_varieties (company_id, category_id, variety_code, name)
    values ('11111111-1111-1111-1111-111111111111','cb000000-0000-0000-0000-0000000000b1','XV','x');  -- B's category id under company A
  raise exception 'DEFECT crop: variety accepted a cross-company category';
exception when foreign_key_violation then raise notice 'PASS crop: cross-company category reference blocked (composite FK)'; end $$;

-- branch leakage (write): owner A is a member of A1, NOT A2 → cannot create a template in branch A2
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.planting_templates (company_id, branch_id, profile_id, template_code, name)
    select '11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222', id, 'TMPL-A2','x'
    from public.crop_profiles where company_id = '11111111-1111-1111-1111-111111111111' limit 1;
  raise exception 'DEFECT crop: owner A created a template in a branch they do not belong to (A2)';
exception when insufficient_privilege then raise notice 'PASS crop: template write into a non-member branch denied (is_branch_member)'; end $$;

-- branch leakage (read): the worker is a member of A2 only → cannot see branch A1's templates
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  select count(*) into n from public.planting_templates where branch_id = 'a1111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'DEFECT crop: worker (member of A2) sees branch A1 templates (% rows)', n; end if;
  raise notice 'PASS crop: branch A1 templates are invisible to a non-member of A1 (branch isolation)';
end $$;

-- positive: owner A (member of A1) DOES see the A1 template
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select count(*) into n from public.planting_templates where branch_id = 'a1111111-1111-1111-1111-111111111111';
  if n < 1 then raise exception 'DEFECT crop: owner A (member of A1) cannot see the A1 template'; end if;
  raise notice 'PASS crop: owner A (member of A1) sees the A1 template (% rows)', n;
end $$;

-- archived-crop usage: creating a variety under an Archived category is rejected
do $$ declare v_arch uuid; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  -- status is not insertable (column grant excludes it) — rows are created Active, then archived via UPDATE.
  insert into public.crop_categories (company_id, category_code, name)
    values ('11111111-1111-1111-1111-111111111111','CAT-ARCH','Archived cat') returning id into v_arch;
  update public.crop_categories set status = 'Archived' where id = v_arch;
  insert into public.crop_varieties (company_id, category_id, variety_code, name)
    values ('11111111-1111-1111-1111-111111111111', v_arch, 'VAR-ARCH','x');
  raise exception 'DEFECT crop: created a variety under an Archived category';
exception when check_violation then raise notice 'PASS crop: cannot create a child under an Archived parent (archived-usage blocked)'; end $$;

rollback;
