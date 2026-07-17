-- Tier-2 BEHAVIORAL P1D — Payroll-role-link + managed positions + job_title security test — blocking gate.
-- Authority: Launch_Runbook / payroll_role_link_prompt.md (owner spec 2026-07-12) ·
--   supabase/migrations/20260712200000_p1d_payroll_role_link.sql.
-- Proves: assign_membership_with_payroll is atomic (no half-changed state), requires payroll info OR
-- exemption for eligible (rank<40) roles, skips the requirement for co_owner/owner and already-linked
-- users, and enforces the same rank/permission gates as direct assignment; list_unlinked_payroll_eligible
-- returns the right set and is permission-gated; positions enforce case/whitespace-insensitive uniqueness
-- and position.manage-only writes; job_title is editable only by job_title.manage holders, never by self.
-- Self-contained BEGIN/ROLLBACK; any DEFECT raises under ON_ERROR_STOP.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- ── fixtures: one company bootstrapped the real way (owner rank 50, standard tiers seeded) ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-0000000000d1','authenticated','authenticated','ownerP1D@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-0000000000d1','Owner P1D','CO-P1D','Company P1D','BR-P1D','Branch P1D');
end $$;

-- ── §Part3 — positions: case/whitespace-insensitive uniqueness, position.manage-only writes ──
do $$ declare v_company uuid; v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000d1';
  v_adm_auth uuid := '0b000000-0000-0000-0000-0000000000d2'; v_adm_id uuid; v_adm_role uuid; v_branch uuid;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_branch from public.branches where company_id=v_company;
  select id into v_adm_role from public.roles where company_id=v_company and role_key='admin';
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', v_adm_auth, 'authenticated','authenticated','admP1D@t.local');
  insert into public.users (auth_user_id, display_name) values (v_adm_auth, 'Admin P1D');
  select id into v_adm_id from public.users where auth_user_id=v_adm_auth;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_adm_id, v_company, v_branch, v_adm_role);

  -- admin (no position.manage — only co_owner/owner get it) cannot create a position
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_adm_auth)::text, true);
  begin
    insert into public.positions (company_id, label) values (v_company, 'Tractor Driver');
    raise exception 'DEFECT p1d: admin created a position without position.manage';
  exception when insufficient_privilege then raise notice 'PASS p1d: admin cannot manage positions (position.manage is co_owner/owner only)'; end;

  -- owner CAN create a position, and created_by is server-derived (never trusted from the client)
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  insert into public.positions (company_id, label) values (v_company, '  Tractor Driver  ');
  if not exists (select 1 from public.positions where company_id=v_company and label='Tractor Driver' and created_by=(select id from public.users where auth_user_id=v_owner_auth)) then
    raise exception 'DEFECT p1d: position not created correctly (trim + server-derived created_by)';
  end if;
  raise notice 'PASS p1d: owner creates a position; label trimmed; created_by server-derived (not client-trusted)';

  -- case/whitespace-insensitive duplicate rejected
  begin
    insert into public.positions (company_id, label) values (v_company, 'tractor driver ');
    raise exception 'DEFECT p1d: case/whitespace-insensitive duplicate position was accepted';
  exception when unique_violation then raise notice 'PASS p1d: duplicate position rejected (case/whitespace-insensitive)'; end;
end $$;

-- ── §Part1 — assign_membership_with_payroll: the core atomic function ──
do $$ declare v_company uuid; v_branch uuid; v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000d1';
  v_emp_role uuid; v_op_role uuid; v_co_role uuid; v_position uuid; v_pending_auth uuid; v_pending_id uuid; v_membership uuid; n int;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_branch from public.branches where company_id=v_company;
  select id into v_emp_role from public.roles where company_id=v_company and role_key='employee';
  select id into v_op_role from public.roles where company_id=v_company and role_key='operator';
  select id into v_co_role from public.roles where company_id=v_company and role_key='co_owner';
  select id into v_position from public.positions where company_id=v_company and label='Tractor Driver';

  v_pending_auth := '0c000000-0000-0000-0000-0000000000d3';
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', v_pending_auth, 'authenticated','authenticated','pendingP1D@t.local');
  insert into public.users (auth_user_id, display_name) values (v_pending_auth, 'Pending Worker');
  select id into v_pending_id from public.users where auth_user_id=v_pending_auth;

  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);

  -- eligible role (employee, rank 10) with NEITHER payroll info NOR exempt -> rejected, ATOMIC (no membership either)
  begin
    perform public.assign_membership_with_payroll(v_company, v_pending_id, v_branch, v_emp_role);
    raise exception 'DEFECT p1d: eligible-role approval succeeded with no payroll info and no exemption';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if; -- raise_exception errcode
  end;
  select count(*) into n from public.user_branch_roles where user_id=v_pending_id and company_id=v_company;
  if n<>0 then raise exception 'DEFECT p1d: a half-changed state was left after the payroll-missing rejection (% membership rows)', n; end if;
  raise notice 'PASS p1d: eligible role without payroll info/exemption is rejected atomically (zero membership rows, not half-changed)';

  -- happy path: eligible role WITH payroll info -> employee + membership created together
  v_membership := public.assign_membership_with_payroll(v_company, v_pending_id, v_branch, v_emp_role, 'Pending Worker', v_position, 600);
  if not exists (select 1 from public.employees where company_id=v_company and user_id=v_pending_id and daily_rate=600 and position_id=v_position) then
    raise exception 'DEFECT p1d: employee record not created/linked correctly on approval';
  end if;
  if not exists (select 1 from public.user_branch_roles where id=v_membership and user_id=v_pending_id and assignment_status='Active') then
    raise exception 'DEFECT p1d: membership not created correctly on approval';
  end if;
  raise notice 'PASS p1d: approving an eligible role with payroll info creates the employee record + membership atomically, linked';

  -- role CHANGE to a DIFFERENT eligible role for the SAME (already-linked) user -> no second employee
  -- row, no re-prompt needed (already linked)
  perform public.assign_membership_with_payroll(v_company, v_pending_id, v_branch, v_op_role, null, null, null, false);
  select count(*) into n from public.employees where company_id=v_company and user_id=v_pending_id;
  if n<>1 then raise exception 'DEFECT p1d: role change on an already-linked user created a duplicate/extra employee row (n=%)', n; end if;
  select count(*) into n from public.user_branch_roles where user_id=v_pending_id and company_id=v_company and assignment_status='Active';
  if n<>1 then raise exception 'DEFECT p1d: role change left more than one active membership (n=%)', n; end if;
  raise notice 'PASS p1d: reassigning an already-linked user to a different role does not re-trigger payroll setup or duplicate the employee record';

  -- role change BACK to the role they held before (employee -> operator -> employee): proves the
  -- partial-unique-index fix (§ latent M3 bug) — the OLD, now-Expired employee-role row must not block
  -- a fresh Active row for the same (user,company,branch,role) tuple.
  perform public.assign_membership_with_payroll(v_company, v_pending_id, v_branch, v_emp_role, null, null, null, false);
  select count(*) into n from public.user_branch_roles where user_id=v_pending_id and company_id=v_company and role_id=v_emp_role and assignment_status='Active';
  if n<>1 then raise exception 'DEFECT p1d: reassigning back to a PREVIOUSLY-held role failed (the old Expired row for that tuple blocked it, n=%)', n; end if;
  raise notice 'PASS p1d: a user can be reassigned back to a role they previously held in the same branch (partial-unique-index fix confirmed)';
end $$;

-- ── exemption path + co_owner/owner skip entirely ──
do $$ declare v_company uuid; v_branch uuid; v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000d1';
  v_op_role uuid; v_co_role uuid; v_exempt_auth uuid; v_exempt_id uuid; v_promo_auth uuid; v_promo_id uuid;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_branch from public.branches where company_id=v_company;
  select id into v_op_role from public.roles where company_id=v_company and role_key='operator';
  select id into v_co_role from public.roles where company_id=v_company and role_key='co_owner';

  v_exempt_auth := '0d000000-0000-0000-0000-0000000000d4';
  insert into auth.users (instance_id, id, aud, role, email) values ('00000000-0000-0000-0000-000000000000', v_exempt_auth, 'authenticated','authenticated','exemptP1D@t.local');
  insert into public.users (auth_user_id, display_name) values (v_exempt_auth, 'E2E Tester');
  select id into v_exempt_id from public.users where auth_user_id=v_exempt_auth;

  v_promo_auth := '0e000000-0000-0000-0000-0000000000d5';
  insert into auth.users (instance_id, id, aud, role, email) values ('00000000-0000-0000-0000-000000000000', v_promo_auth, 'authenticated','authenticated','promoP1D@t.local');
  insert into public.users (auth_user_id, display_name) values (v_promo_auth, 'Promoted Owner');
  select id into v_promo_id from public.users where auth_user_id=v_promo_auth;

  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);

  -- eligible role + exempt=true -> no employee created, payroll_exempt flips, membership still created
  perform public.assign_membership_with_payroll(v_company, v_exempt_id, v_branch, v_op_role, null, null, null, true);
  if exists (select 1 from public.employees where company_id=v_company and user_id=v_exempt_id) then
    raise exception 'DEFECT p1d: an employee record was created despite exempt=true';
  end if;
  if not (select payroll_exempt from public.users where id=v_exempt_id) then
    raise exception 'DEFECT p1d: payroll_exempt was not set';
  end if;
  if not exists (select 1 from public.user_branch_roles where user_id=v_exempt_id and company_id=v_company and assignment_status='Active') then
    raise exception 'DEFECT p1d: exempt path did not still create the membership';
  end if;
  raise notice 'PASS p1d: the exempt escape hatch creates no employee record, sets payroll_exempt, still assigns the membership';

  -- co_owner (rank 40) requires NO payroll info at all, even with none supplied
  perform public.assign_membership_with_payroll(v_company, v_promo_id, v_branch, v_co_role);
  if exists (select 1 from public.employees where company_id=v_company and user_id=v_promo_id) then
    raise exception 'DEFECT p1d: an employee record was created for a co_owner-tier assignment';
  end if;
  raise notice 'PASS p1d: co_owner/owner-tier assignment skips the payroll requirement entirely (rank >= 40)';
end $$;

-- ── rank/permission gates reused correctly (same as direct assignment) ──
do $$ declare v_company uuid; v_branch uuid; v_adm_auth uuid := '0b000000-0000-0000-0000-0000000000d2';
  v_op_role uuid; v_own_role uuid; v_target_auth uuid; v_target_id uuid;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_branch from public.branches where company_id=v_company;
  select id into v_op_role from public.roles where company_id=v_company and role_key='operator';
  select id into v_own_role from public.roles where company_id=v_company and role_key='owner';
  v_target_auth := '0f000000-0000-0000-0000-0000000000d6';
  insert into auth.users (instance_id, id, aud, role, email) values ('00000000-0000-0000-0000-000000000000', v_target_auth, 'authenticated','authenticated','targetP1D@t.local');
  insert into public.users (auth_user_id, display_name) values (v_target_auth, 'Target P1D');
  select id into v_target_id from public.users where auth_user_id=v_target_auth;

  -- P1C3 (2026-07-17): admin now holds membership.approve by default, and the target here has ZERO
  -- prior memberships (a fresh approval) — this is exactly the lighter tier assign_membership_with_payroll
  -- now accepts. Admin approving a brand-new signup should SUCCEED (this assertion used to expect
  -- denial, back when the function required membership.manage unconditionally).
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_adm_auth)::text, true);
  if public.assign_membership_with_payroll(v_company, v_target_id, v_branch, v_op_role, 'X', null, null, true) is null then
    raise exception 'DEFECT p1d/p1c3: admin (membership.approve) should be able to approve a brand-new signup';
  end if;
  raise notice 'PASS p1d/p1c3: assign_membership_with_payroll accepts membership.approve for a target with no prior membership';
end $$;
do $$ declare v_company uuid; v_branch uuid; v_co_auth uuid; v_co_id uuid; v_co_role uuid; v_own_role uuid; v_target_id uuid;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_branch from public.branches where company_id=v_company;
  select id into v_co_role  from public.roles where company_id=v_company and role_key='co_owner';
  select id into v_own_role from public.roles where company_id=v_company and role_key='owner';
  select id into v_target_id from public.users where auth_user_id='0f000000-0000-0000-0000-0000000000d6';
  v_co_auth := '10000000-0000-0000-0000-0000000000d7';
  insert into auth.users (instance_id, id, aud, role, email) values ('00000000-0000-0000-0000-000000000000', v_co_auth, 'authenticated','authenticated','co2P1D@t.local');
  insert into public.users (auth_user_id, display_name) values (v_co_auth, 'Co-Owner P1D');
  select id into v_co_id from public.users where auth_user_id=v_co_auth;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_co_id, v_company, v_branch, v_co_role);

  -- co_owner (rank 40) cannot appoint someone as owner (rank 50) via this function either — same outranks_role rule
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_co_auth)::text, true);
  begin
    perform public.assign_membership_with_payroll(v_company, v_target_id, v_branch, v_own_role);
    raise exception 'DEFECT p1d: co-owner appointed an owner via the payroll-link function';
  exception when insufficient_privilege then raise notice 'PASS p1d: assign_membership_with_payroll enforces outranks_role (co-owner cannot appoint owner)'; end;
end $$;

-- ── list_unlinked_payroll_eligible: the backfill-banner data source ──
do $$ declare v_company uuid; v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000d1'; n int;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  -- from the fixtures above: the exempt user and the co_owner-tier user must NOT appear; anyone eligible+unlinked would.
  select count(*) into n from public.list_unlinked_payroll_eligible(v_company) where display_name in ('E2E Tester','Promoted Owner');
  if n<>0 then raise exception 'DEFECT p1d: exempt or co_owner-tier users appeared in the unlinked-eligible backfill list (n=%)', n; end if;
  raise notice 'PASS p1d: list_unlinked_payroll_eligible correctly excludes exempt and co_owner+/owner-tier members';
end $$;
do $$ declare v_company uuid; v_adm_auth uuid := '0b000000-0000-0000-0000-0000000000d2';
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  -- P1C3 (2026-07-17): admin's default no longer includes payroll.manage (self-payroll-only by
  -- default, see the P1C3 migration) or membership.manage — this function requires one of the two, so
  -- admin is now correctly denied. This assertion used to expect success back when admin held
  -- payroll.manage unconditionally; it now proves the narrowing actually took effect for this call too.
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_adm_auth)::text, true);
  begin
    perform public.list_unlinked_payroll_eligible(v_company);
    raise exception 'DEFECT p1d/p1c3: admin (no payroll.manage, no membership.manage by default) should not read the backfill-eligible list';
  exception when insufficient_privilege then
    raise notice 'PASS p1d/p1c3: admin denied list_unlinked_payroll_eligible by default (holds neither membership.manage nor payroll.manage post-P1C3)';
  end;
end $$;

-- ── job_title: only job_title.manage holders may set it; never self-editable ──
do $$ declare v_company uuid; v_branch uuid; v_owner_auth uuid := '0a000000-0000-0000-0000-0000000000d1'; v_adm_auth uuid := '0b000000-0000-0000-0000-0000000000d2';
  v_emp_role uuid; v_target_id uuid; n int;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_branch from public.branches where company_id=v_company;
  select id into v_emp_role from public.roles where company_id=v_company and role_key='employee';
  select id into v_target_id from public.users where auth_user_id='0f000000-0000-0000-0000-0000000000d6';
  -- this fixture user was only ever a FAILED assignment target earlier (co-owner denied appointing them
  -- owner) — they have zero real memberships. Give them one so the job_title policy's "shares a company
  -- with the actor" join has something to match.
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_target_id, v_company, v_branch, v_emp_role);

  -- admin (holds job_title.manage per §2.2) CAN set someone else's job title
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_adm_auth)::text, true);
  update public.users set job_title = 'Senior Harvester' where id = v_target_id;
  get diagnostics n = row_count;
  if n<>1 then raise exception 'DEFECT p1d: admin (job_title.manage) could not set another member''s job title (% rows)', n; end if;
  raise notice 'PASS p1d: an actor holding job_title.manage can set another member''s job title';

  -- the target CANNOT set their OWN job title (owner decision: admin-tier and above only, not self-editable).
  -- The pre-existing M4 self-update policy WOULD otherwise let this through (RLS policies for the same
  -- command are OR'd) — the users_job_title_guard trigger is what actually blocks it (raises, not 0 rows).
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0f000000-0000-0000-0000-0000000000d6')::text, true);
  begin
    update public.users set job_title = 'Self-Promoted' where id = v_target_id;
    raise exception 'DEFECT p1d: a member set their own job title without job_title.manage';
  exception when insufficient_privilege then raise notice 'PASS p1d: job_title is not self-editable — only an actor holding job_title.manage may set it (owner decision; trigger-enforced, not just RLS)'; end;
end $$;

rollback;
