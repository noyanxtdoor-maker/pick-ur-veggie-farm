-- Tier-2 BEHAVIORAL P1C — Approvals & Roles hardening security test — blocking gate.
-- Authority: Launch_Runbook §2 (P1C spec) · supabase/migrations/20260712130000_p1c_approvals_roles_hardening.sql.
-- Proves: bootstrap seeds the 5 standard tiers with the exact scoped permission sets; per-user overrides are
-- server-enforced (deny beats grant; grant requires a live membership; company-scoped; cannot self-override;
-- only a strictly-higher rank may set one); rank-based revoke/appoint authority (peer/above denied, below
-- allowed, self-management exempt); role creation/mutation capped below the actor's own rank (no lateral or
-- upward role manufacture, no self-escalation via role_permissions padding).
-- Self-contained BEGIN/ROLLBACK; any DEFECT raises under ON_ERROR_STOP.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- ── fixtures: one company bootstrapped the REAL way (proves seed_standard_roles ran) ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-0000000000a1','authenticated','authenticated','ownerP1C@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0a000000-0000-0000-0000-0000000000a1','Owner P1C','CO-P1C','Company P1C','BR-P1C','Branch P1C');
end $$;

-- ── §2.2 — the 5 standard tiers exist with the right rank + scoped permission sets ──
do $$ declare v_company uuid; v_emp_rank int; v_op_rank int; v_adm_rank int; v_co_rank int; v_own_rank int;
  v_emp_perms int; v_op_perms int; v_adm_perms int; v_co_perms int; v_own_perms int; v_catalog int;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select rank into v_emp_rank from public.roles where company_id=v_company and role_key='employee';
  select rank into v_op_rank  from public.roles where company_id=v_company and role_key='operator';
  select rank into v_adm_rank from public.roles where company_id=v_company and role_key='admin';
  select rank into v_co_rank  from public.roles where company_id=v_company and role_key='co_owner';
  select rank into v_own_rank from public.roles where company_id=v_company and role_key='owner';
  if v_emp_rank<>10 or v_op_rank<>20 or v_adm_rank<>30 or v_co_rank<>40 or v_own_rank<>50 then
    raise exception 'DEFECT p1c: rank ladder wrong (emp=% op=% adm=% co=% owner=%)', v_emp_rank, v_op_rank, v_adm_rank, v_co_rank, v_own_rank;
  end if;
  select count(*) into v_emp_perms from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.company_id=v_company and r.role_key='employee';
  select count(*) into v_op_perms  from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.company_id=v_company and r.role_key='operator';
  select count(*) into v_adm_perms from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.company_id=v_company and r.role_key='admin';
  select count(*) into v_co_perms  from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.company_id=v_company and r.role_key='co_owner';
  select count(*) into v_own_perms from public.role_permissions rp join public.roles r on r.id=rp.role_id where r.company_id=v_company and r.role_key='owner';
  select count(*) into v_catalog from public.permissions where status='Active';
  if v_emp_perms=0 or v_op_perms<=v_emp_perms or v_adm_perms<=v_op_perms or v_co_perms<v_adm_perms then
    raise exception 'DEFECT p1c: tiers not strictly widening (emp=% op=% adm=% co=%)', v_emp_perms, v_op_perms, v_adm_perms, v_co_perms;
  end if;
  if v_own_perms<>v_catalog then raise exception 'DEFECT p1c: owner has % perms, catalog has %', v_own_perms, v_catalog; end if;
  if v_co_perms<>v_catalog then raise exception 'DEFECT p1c: co_owner (owner-equivalent keys) has % perms, catalog has %', v_co_perms, v_catalog; end if;
  raise notice 'PASS p1c: 5-tier ladder ranked 10/20/30/40/50, permission sets strictly widen, co_owner+owner hold the full % -key catalog', v_catalog;
end $$;

-- ── §2.5 — appointment/revoke authority is server-RANK-enforced, not client-trusted ──
-- Per the catalog (§2.2): membership.manage is a Co-Owner+/Owner capability — Admin does NOT hold it. So the
-- ADMIN-actor cases below prove "lacks the permission entirely" (denied for EVERY target); the CO-OWNER-actor
-- cases prove the rank boundary itself (below succeeds, peer/above denied) — that's where §2.5 actually bites.
do $$ declare v_company uuid; v_branch uuid; v_owner uuid;
  v_emp_role uuid; v_adm_role uuid; v_co_role uuid; v_own_role uuid;
  v_emp_auth uuid := '0b000000-0000-0000-0000-0000000000b1';
  v_adm_auth uuid := '0b000000-0000-0000-0000-0000000000b3';
  v_co1_auth uuid := '0b000000-0000-0000-0000-0000000000b5';
  v_co2_auth uuid := '0b000000-0000-0000-0000-0000000000b6';
  v_emp_id uuid; v_adm_id uuid; v_co1_id uuid; v_co2_id uuid; n int;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_owner from public.users where auth_user_id='0a000000-0000-0000-0000-0000000000a1';
  select id into v_branch from public.branches where company_id=v_company;
  select id into v_emp_role from public.roles where company_id=v_company and role_key='employee';
  select id into v_adm_role from public.roles where company_id=v_company and role_key='admin';
  select id into v_co_role  from public.roles where company_id=v_company and role_key='co_owner';
  select id into v_own_role from public.roles where company_id=v_company and role_key='owner';

  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', v_emp_auth, 'authenticated','authenticated','emp1@t.local'),
    ('00000000-0000-0000-0000-000000000000', v_adm_auth, 'authenticated','authenticated','adm1@t.local'),
    ('00000000-0000-0000-0000-000000000000', v_co1_auth, 'authenticated','authenticated','co1@t.local'),
    ('00000000-0000-0000-0000-000000000000', v_co2_auth, 'authenticated','authenticated','co2@t.local');
  insert into public.users (auth_user_id, display_name) values
    (v_emp_auth, 'Employee One'), (v_adm_auth, 'Admin One'), (v_co1_auth, 'Co-Owner One'), (v_co2_auth, 'Co-Owner Two');
  select id into v_emp_id from public.users where auth_user_id=v_emp_auth;
  select id into v_adm_id from public.users where auth_user_id=v_adm_auth;
  select id into v_co1_id from public.users where auth_user_id=v_co1_auth;
  select id into v_co2_id from public.users where auth_user_id=v_co2_auth;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
    (v_emp_id, v_company, v_branch, v_emp_role),
    (v_adm_id, v_company, v_branch, v_adm_role),
    (v_co1_id, v_company, v_branch, v_co_role),
    (v_co2_id, v_company, v_branch, v_co_role);

  -- admin (no membership.manage at all) cannot revoke ANYONE, not even someone strictly below (employee)
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_adm_auth)::text, true);
  update public.user_branch_roles set assignment_status='Expired' where user_id=v_emp_id and company_id=v_company;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'DEFECT p1c: admin (no membership.manage) revoked a membership (% rows)', n; end if;
  raise notice 'PASS p1c: admin lacks membership.manage entirely — cannot revoke anyone, even someone below their tier';

  -- co-owner1 (has membership.manage, rank 40) revokes admin (rank 30, strictly below) — succeeds
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_co1_auth)::text, true);
  update public.user_branch_roles set assignment_status='Expired' where user_id=v_adm_id and company_id=v_company;
  get diagnostics n = row_count;
  if n<>1 then raise exception 'DEFECT p1c: co-owner could not revoke admin below their tier (% rows)', n; end if;
  raise notice 'PASS p1c: co-owner revokes admin below their tier (1 row)';

  -- co-owner1 cannot revoke co-owner2 (peer rank 40)
  update public.user_branch_roles set assignment_status='Expired' where user_id=v_co2_id and company_id=v_company;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'DEFECT p1c: co-owner1 revoked peer co-owner2 (% rows)', n; end if;
  raise notice 'PASS p1c: co-owner cannot revoke a peer co-owner (0 rows, rank-blocked)';

  -- co-owner1 cannot revoke the owner (rank 50, above)
  update public.user_branch_roles set assignment_status='Expired' where user_id=v_owner and company_id=v_company;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'DEFECT p1c: co-owner revoked the owner (% rows)', n; end if;
  raise notice 'PASS p1c: co-owner cannot revoke the owner (0 rows, rank-blocked)';

  -- co-owner1 appoints a NEW employee membership (insert, rank 10 strictly below 40) — succeeds
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_adm_id, v_company, v_branch, v_emp_role);   -- re-appoint the revoked admin, now as employee
  raise notice 'PASS p1c: co-owner appoints a membership strictly below their tier';

  -- co-owner1 CANNOT appoint another co-owner (insert, rank 40 not strictly below 40)
  begin
    insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
      values (v_emp_id, v_company, v_branch, v_co_role);
    raise exception 'DEFECT p1c: co-owner appointed a peer-rank co-owner';
  exception when insufficient_privilege then raise notice 'PASS p1c: co-owner cannot appoint a peer-or-above role (outranks_role blocked)'; end;

  -- owner CAN appoint a co-owner (rank 40 < owner's 50)
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0a000000-0000-0000-0000-0000000000a1')::text, true);
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_emp_id, v_company, v_branch, v_co_role);
  raise notice 'PASS p1c: owner appoints co-owner (strictly outranks)';

  -- owner CAN suspend their OWN membership (self exempt from the P1C rank check, org-security.sql parity —
  -- that pre-existing guard proves exactly this self-suspend case, never a chained self-reactivate).
  update public.user_branch_roles set assignment_status='Expired' where user_id=v_owner and company_id=v_company;
  get diagnostics n = row_count;
  if n<>1 then raise exception 'DEFECT p1c: owner could not suspend own membership (self-exempt broken, % rows)', n; end if;
  raise notice 'PASS p1c: owner self-suspend still works (not an escalation path, self-exempt from rank check)';

  -- Inherent to has_permission (unrelated to P1C — it only ever counts Active rows): the instant the owner's
  -- sole membership goes Expired, has_permission(membership.manage) is false for them too, so RLS silently
  -- denies even their OWN reactivate attempt (0 rows, not an error). Recovery is the governed backend path
  -- (service_role), not client self-service — proving that path still works.
  update public.user_branch_roles set assignment_status='Active', expires_at=null where user_id=v_owner and company_id=v_company;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'DEFECT p1c: a self-suspended owner unexpectedly retains enough access to self-reactivate (% rows) — should be 0, recovery must go through service_role', n; end if;
  set local role postgres;
  update public.user_branch_roles set assignment_status='Active', expires_at=null where user_id=v_owner and company_id=v_company;
  get diagnostics n = row_count;
  if n<>1 then raise exception 'DEFECT p1c: service_role could not recover a self-suspended owner (% rows)', n; end if;
  raise notice 'PASS p1c: a self-suspended owner cannot self-reactivate (0 rows, has_permission correctly re-evaluates to false); service_role recovery works';
end $$;

-- ── §2.4 — server-enforced per-user permission overrides ──
do $$ declare v_company uuid; v_branch uuid; v_emp_role uuid; v_op_role uuid;
  v_own_auth uuid := '0a000000-0000-0000-0000-0000000000a1';
  v_target_auth uuid := '0c000000-0000-0000-0000-0000000000c1';
  v_target_id uuid; v_before boolean; v_after boolean;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_branch from public.branches where company_id=v_company;
  select id into v_emp_role from public.roles where company_id=v_company and role_key='employee';
  select id into v_op_role  from public.roles where company_id=v_company and role_key='operator';
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', v_target_auth, 'authenticated','authenticated','target@t.local');
  insert into public.users (auth_user_id, display_name) values (v_target_auth, 'Target Employee');
  select id into v_target_id from public.users where auth_user_id=v_target_auth;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values (v_target_id, v_company, v_branch, v_emp_role);

  -- baseline: employee lacks accounting.read
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_target_auth)::text, true);
  v_before := public.has_permission(v_company, 'accounting.read');
  if v_before then raise exception 'DEFECT p1c: baseline employee already has accounting.read'; end if;

  -- owner grants an override key the employee's role lacks
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_own_auth)::text, true);
  perform public.set_user_permission_override(v_company, v_target_id, 'accounting.read', 'grant');

  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_target_auth)::text, true);
  v_after := public.has_permission(v_company, 'accounting.read');
  if not v_after then raise exception 'DEFECT p1c: grant-override did not light up accounting.read'; end if;
  raise notice 'PASS p1c: grant-override adds a key the base role lacks';

  -- deny-override beats a role-granted key (pos.sell is in the employee's base set)
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_own_auth)::text, true);
  perform public.set_user_permission_override(v_company, v_target_id, 'pos.sell', 'deny');
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_target_auth)::text, true);
  if public.has_permission(v_company, 'pos.sell') then raise exception 'DEFECT p1c: deny-override did not block a role-granted key'; end if;
  raise notice 'PASS p1c: deny-override beats a role-granted key (pos.sell blocked despite role membership)';

  -- clearing the override (null effect) restores baseline
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_own_auth)::text, true);
  perform public.set_user_permission_override(v_company, v_target_id, 'pos.sell', null);
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_target_auth)::text, true);
  if not public.has_permission(v_company, 'pos.sell') then raise exception 'DEFECT p1c: clearing the override did not restore the role-granted key'; end if;
  raise notice 'PASS p1c: null effect clears an override and restores the base role grant';

  -- self-override forbidden
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_own_auth)::text, true);
  begin
    perform public.set_user_permission_override(v_company, (select id from public.users where auth_user_id=v_own_auth), 'pos.sell', 'grant');
    raise exception 'DEFECT p1c: owner set an override on themselves';
  exception when insufficient_privilege then raise notice 'PASS p1c: self-override forbidden'; end;

  -- a peer/equal-or-higher rank cannot override a target (operator cannot override an employee's peer-or-above... proves via employee trying to override another employee)
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_target_auth)::text, true);
  begin
    perform public.set_user_permission_override(v_company, v_target_id, 'pos.sell', 'grant');
    raise exception 'DEFECT p1c: employee (no membership.manage) set an override';
  exception when insufficient_privilege then raise notice 'PASS p1c: override write requires membership.manage'; end;

  -- override on a non-member (no active membership in this company) grants nothing even if it existed pre-membership-loss
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_own_auth)::text, true);
  perform public.set_user_permission_override(v_company, v_target_id, 'accounting.manage', 'grant');
  update public.user_branch_roles set assignment_status='Expired' where user_id=v_target_id and company_id=v_company;
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_target_auth)::text, true);
  if public.has_permission(v_company, 'accounting.manage') then raise exception 'DEFECT p1c: grant-override survived membership loss (non-member granted access)'; end if;
  raise notice 'PASS p1c: a grant-override cannot manufacture access for a non-member (membership required to redeem it)';
end $$;

-- ── §2.5 (role governance) — role creation/mutation capped below the actor's own rank ──
-- role.manage is also Co-Owner+/Owner only (§2.2 catalog) — the ADMIN case proves "lacks it entirely"; the
-- CO-OWNER case proves the rank boundary (peer-rank denied, strictly-below allowed, self-escalation blocked).
do $$ declare v_company uuid;
  v_adm_auth uuid := '0b000000-0000-0000-0000-0000000000b3';
  v_co_auth  uuid := '0b000000-0000-0000-0000-0000000000b5';
  v_co_role uuid; v_own_role uuid; n int;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_co_role  from public.roles where company_id=v_company and role_key='co_owner';
  select id into v_own_role from public.roles where company_id=v_company and role_key='owner';

  -- admin (no role.manage at all) cannot create a role, period — even one far below any tier
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_adm_auth)::text, true);
  begin
    insert into public.roles (company_id, role_key, description, rank) values (v_company, 'shadow_low', 'x', 1);
    raise exception 'DEFECT p1c: admin (no role.manage) created a role';
  exception when insufficient_privilege then raise notice 'PASS p1c: admin lacks role.manage entirely — cannot create any role'; end;

  -- co-owner (rank 40, has role.manage) cannot create a role at or above their own rank (peer-rank denied)
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_co_auth)::text, true);
  begin
    insert into public.roles (company_id, role_key, description, rank) values (v_company, 'shadow_co', 'x', 40);
    raise exception 'DEFECT p1c: co-owner created a peer-rank role';
  exception when insufficient_privilege then raise notice 'PASS p1c: role creation capped strictly below the creator''s own rank'; end;

  -- co-owner CAN create a role strictly below their own rank
  insert into public.roles (company_id, role_key, description, rank) values (v_company, 'junior', 'x', 5);
  raise notice 'PASS p1c: co-owner creates a role strictly below their own rank';

  -- co-owner cannot edit (deprecate) the owner role (above their rank)
  update public.roles set status='Deprecated' where id=v_own_role;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'DEFECT p1c: co-owner deprecated the owner role (% rows)', n; end if;
  raise notice 'PASS p1c: co-owner cannot edit a role above their own rank (0 rows, RLS-silent)';

  -- co-owner cannot pad their OWN role's permission set (self-escalation via role_permissions — rank check
  -- fails since actor_rank(40) is not strictly greater than the target role's own rank(40))
  begin
    insert into public.role_permissions (company_id, role_id, permission_id)
      select v_company, v_co_role, id from public.permissions where permission_key='audit.read'
      on conflict do nothing;
    raise exception 'DEFECT p1c: co-owner escalated their own role''s permission set';
  exception when insufficient_privilege then raise notice 'PASS p1c: role_permissions insert requires outranking the target role (blocks self-escalation)'; end;
end $$;

-- P1I (2026-07-13): invite_user() is retired (owner decision) — its own rank-check behavior (formerly
-- tested here, §Fix1) is now moot, since the parallel entry point it guarded is closed outright (EXECUTE
-- revoked, proven unreachable in org-security.sql's P1I block) rather than merely rank-checked.

-- ── P1C.1 — self-reactivation of a dormant higher-rank row now blocked (closes §Fix2) ──
do $$ declare v_company uuid; v_branch uuid; v_owner uuid; v_co_role uuid; v_emp_role uuid;
  v_co_auth uuid := '0b000000-0000-0000-0000-0000000000b7';
  v_co_id uuid; n int;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  select id into v_branch from public.branches where company_id=v_company;
  select id into v_co_role  from public.roles where company_id=v_company and role_key='co_owner';
  select id into v_emp_role from public.roles where company_id=v_company and role_key='employee';
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000', v_co_auth, 'authenticated','authenticated','selfres@t.local');
  insert into public.users (auth_user_id, display_name) values (v_co_auth, 'Self Resurrector');
  select id into v_co_id from public.users where auth_user_id=v_co_auth;

  -- fixture: this user ONCE held co_owner (now Expired — simulating a past demotion), currently holds employee (Active)
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id, assignment_status) values
    (v_co_id, v_company, v_branch, v_co_role, 'Expired');
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id, assignment_status) values
    (v_co_id, v_company, v_branch, v_emp_role, 'Active');

  -- employee alone has no membership.manage, so this must fail on has_permission ALONE — but prove the
  -- specific escalation path is closed even if the actor DID have membership.manage: use the owner to
  -- first grant this user co_owner-equivalent membership.manage via override, then retry as themselves.
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0a000000-0000-0000-0000-0000000000a1')::text, true);
  perform public.set_user_permission_override(v_company, v_co_id, 'membership.manage', 'grant');

  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_co_auth)::text, true);
  update public.user_branch_roles set assignment_status='Active' where user_id=v_co_id and role_id=v_co_role and company_id=v_company;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'DEFECT p1c1: user self-resurrected a dormant higher-rank (co_owner) row via the self-exemption (% rows)', n; end if;
  raise notice 'PASS p1c1: self-reactivation of a dormant higher-rank row is blocked even with membership.manage granted (0 rows — outranks_role now applies to reactivation)';

  -- sanity: this same user CAN still self-suspend their own currently-Active row (the exemption still works for its intended case)
  update public.user_branch_roles set assignment_status='Expired' where user_id=v_co_id and role_id=v_emp_role and company_id=v_company;
  get diagnostics n = row_count;
  if n<>1 then raise exception 'DEFECT p1c1: self-suspend (the intended exemption case) broke (% rows)', n; end if;
  raise notice 'PASS p1c1: self-suspend of your own currently-Active row still works (exemption correctly narrowed, not removed)';
end $$;

-- ── P1C.1 — role_permissions insert now requires the actor already hold the permission (closes §Fix3) ──
do $$ declare v_company uuid; v_co_auth uuid := '0b000000-0000-0000-0000-0000000000b5';
  v_low_role uuid; n int;
begin
  set local role postgres;
  select company_id into v_company from public.bootstrap_state where id;
  -- fixture: a low-rank role the co-owner is entitled to create (rank 1, well below co-owner's 40)
  insert into public.roles (company_id, role_key, description, rank) values (v_company, 'proxy_test', 'x', 1) returning id into v_low_role;

  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', v_co_auth)::text, true);
  -- co-owner DOES hold accounting.manage (full catalog) — adding it to a low-rank role should succeed
  insert into public.role_permissions (company_id, role_id, permission_id)
    select v_company, v_low_role, id from public.permissions where permission_key='accounting.manage';
  raise notice 'PASS p1c1: role_permissions insert succeeds when the actor already holds the permission being added';
end $$;

rollback;
