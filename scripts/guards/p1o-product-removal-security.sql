-- Guard battery for P1O — POS product-removal approval workflow (owner directive 2026-07-17).
-- Auth-boundary (products / product_removal_requests): tests the 4 RPCs + RLS + the tiered
-- instant-vs-queued split (product.manage = instant; product.remove-only = queued, needs approval).
--
-- Org:
--   - bootstrap one tenant the REAL way (owner role, rank 50, full catalog).
--   - seed the standard tiers via seed_standard_roles (employee/operator/admin/co_owner).
--   - helper users: EMPLOYEE (rank 10, product.remove only), OPERATOR (rank 20, product.remove only),
--     ADMIN (rank 30, product.manage).
--   - 5 test products.
-- Exercise:
--   HAPPY 1: ADMIN (product.manage) removes product #1 instantly -> Archived, request row already
--            Approved (requested_by = decided_by = admin), audited.
--   HAPPY 2: EMPLOYEE (product.remove only) requests removal of product #2 -> still Active, request
--            row Pending, audited.
--   HAPPY 3: OWNER (product.manage) approves EMPLOYEE's Pending request on product #2 -> Archived,
--            request Approved (decided_by = owner), audited.
--   HAPPY 4: OPERATOR (product.remove only) requests removal of product #3; ADMIN rejects it -> product
--            #3 STILL Active, request Rejected with a decision_reason, audited.
--   SAD 1: a fixture with product.remove explicitly DENIED via override tries to request removal ->
--          insufficient_privilege (proves the override system composes with this new key).
--   SAD 2: EMPLOYEE requests removal of product #4, then requests it again while still Pending ->
--          raise_exception (one Pending per product).
--   SAD 3: EMPLOYEE requests removal of product #5 (Pending), is THEN granted product.manage via
--          override, and tries to approve their own request -> insufficient_privilege (self-approve
--          denied even when the requester later gains manage).
--   SAD 4: empty reason -> raise_exception (message asserted, not just errcode — distinguishes from SAD2's
--          duplicate-pending, which shares the same errcode).
--   SAD 5: requesting removal of an already-Archived product (product #1, archived in HAPPY1) ->
--          raise_exception (message asserted too, same errcode-sharing reason as SAD4).
--   HAPPY 5: ADMIN calls list_pending_product_removals() -> exactly the 2 still-open Pending rows
--            (product #4 from SAD2, product #5 from SAD3), by id.
--   SAD 6: EMPLOYEE (product.remove only, no product.manage) calls list_pending_product_removals() ->
--          insufficient_privilege (the read-queue RPC was previously never invoked by this guard at all).
--   SAD 7: OWNER tries to approve product #2's request a second time (already Approved in HAPPY3) ->
--          raise_exception 'not found, already decided' (double-decision protection).
--   SAD 8: OPERATOR (product.remove only, holds NO product.manage at all — distinct from SAD3's
--          "gained product.manage then self-approved" case) tries to approve product #4's Pending
--          request, requested by someone else (the employee) -> insufficient_privilege on the
--          "actor has no product.manage anywhere" branch, never reached by any existing test.
--   Cross-tenant: bootstrap a SECOND company (P1OCO2) with its own product.manage admin. That admin's
--     list_pending_product_removals() returns zero rows (doesn't see P1OCO's queue), and
--     approve/reject_product_removal against P1OCO's still-Pending product #4/#5 requests both raise
--     'not found... or outside your company' — proves the company scoping isn't just accidentally safe.
--   Grant shape: anon has EXECUTE on none of the 4 new functions; authenticated has EXECUTE on all 4.
-- Wrapped in BEGIN/ROLLBACK; does not mutate (reset re-seeds on next run).
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- Owner auth.users + bootstrap
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0c000000-0000-0000-0000-0000000000c1'::uuid, 'authenticated', 'authenticated', 'owner.p1o@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0c000000-0000-0000-0000-0000000000c1','Owner P1O','P1OCO','P1O Company','P1OBR','P1O Branch');
  set local role postgres;
end $$;

create temp table g as select
  (select id from public.companies where company_code='P1OCO') as v_company,
  (select id from public.branches where branch_code='P1OBR') as v_branch,
  (select id from public.users where auth_user_id='0c000000-0000-0000-0000-0000000000c1') as v_owner,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1OCO') and role_key='employee') as v_emp_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1OCO') and role_key='operator') as v_op_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P1OCO') and role_key='admin') as v_admin_role;

-- EMPLOYEE (product.remove only, via seed)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d000000-0000-0000-0000-0000000000d1'::uuid, 'authenticated', 'authenticated', 'emp.p1o@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d000000-0000-0000-0000-0000000000d1', 'Emp P1O', 'emp.p1o@t.local', 'emp_p1o')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d000000-0000-0000-0000-0000000000d1';
  select v_emp_role into v_role from g;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- OPERATOR (product.remove only, via seed)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d000000-0000-0000-0000-0000000000d2'::uuid, 'authenticated', 'authenticated', 'op.p1o@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d000000-0000-0000-0000-0000000000d2', 'Op P1O', 'op.p1o@t.local', 'op_p1o')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d000000-0000-0000-0000-0000000000d2';
  select v_op_role into v_role from g;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- ADMIN (product.manage, via seed)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d000000-0000-0000-0000-0000000000d3'::uuid, 'authenticated', 'authenticated', 'admin.p1o@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d000000-0000-0000-0000-0000000000d3', 'Admin P1O', 'admin.p1o@t.local', 'admin_p1o')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d000000-0000-0000-0000-0000000000d3';
  select v_admin_role into v_role from g;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- SECOND tenant (cross-tenant isolation fixture) — bootstrap_initial_tenant is a GLOBAL one-time gate
-- (exists(select 1 from companies)), already consumed by P1OCO above, so a second company has to be
-- built directly the same way scripts/guards/cross-tenant-helper-hardening-security.sql does it, then
-- handed to seed_standard_roles() (per-company idempotent, not globally gated) for its admin's product.manage.
insert into public.companies (id, company_code, name) values
  ('0f000000-0000-0000-0000-0000000000f2','P1OCO2','P1O Company Two');
insert into public.branches (id, company_id, branch_code, name) values
  ('0f000000-0000-0000-0000-0000000000fb','0f000000-0000-0000-0000-0000000000f2','P1OBR2','P1O Branch Two');
do $$ begin
  set local role service_role;
  perform public.seed_standard_roles('0f000000-0000-0000-0000-0000000000f2');
  set local role postgres;
end $$;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d000000-0000-0000-0000-0000000000d4'::uuid, 'authenticated', 'authenticated', 'admin2.p1o@t.local');
do $$ declare v_role uuid; v_user uuid; v_co2 uuid := '0f000000-0000-0000-0000-0000000000f2'; v_br2 uuid := '0f000000-0000-0000-0000-0000000000fb'; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d000000-0000-0000-0000-0000000000d4', 'Admin P1O Two', 'admin2.p1o@t.local', 'admin2_p1o')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d000000-0000-0000-0000-0000000000d4';
  select id into v_role from public.roles where company_id=v_co2 and role_key='admin';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, v_co2, v_br2, v_role);
end $$;

-- 5 test products (fixture data, inserted directly as postgres)
insert into public.products (id, company_id, product_code, name, retail_per_kg, status) values
  ('0e000000-0000-0000-0000-0000000000e1', (select v_company from g), 'P1O-1', 'Tomato P1O', 100, 'Active'),
  ('0e000000-0000-0000-0000-0000000000e2', (select v_company from g), 'P1O-2', 'Eggplant P1O', 90, 'Active'),
  ('0e000000-0000-0000-0000-0000000000e3', (select v_company from g), 'P1O-3', 'Okra P1O', 80, 'Active'),
  ('0e000000-0000-0000-0000-0000000000e4', (select v_company from g), 'P1O-4', 'Squash P1O', 70, 'Active'),
  ('0e000000-0000-0000-0000-0000000000e5', (select v_company from g), 'P1O-5', 'Cabbage P1O', 60, 'Active');

-- ── HAPPY 1: ADMIN removes product #1 instantly ─────────────────────
do $$ declare v_admin uuid; v_req uuid; n int;
  v_admin_auth uuid := '0d000000-0000-0000-0000-0000000000d3';
  v_prod uuid := '0e000000-0000-0000-0000-0000000000e1';
begin
  select id into v_admin from public.users where auth_user_id=v_admin_auth;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  v_req := public.request_product_removal(v_prod, 'seasonal item, discontinuing');
  if v_req is null then raise exception 'HAPPY1: request_product_removal returned null'; end if;
  select count(*) into n from public.products where id=v_prod and status='Archived';
  if n<>1 then raise exception 'HAPPY1: product not Archived immediately'; end if;
  select count(*) into n from public.product_removal_requests where id=v_req and status='Approved' and requested_by=v_admin and decided_by=v_admin;
  if n<>1 then raise exception 'HAPPY1: request row not instantly Approved with requested_by=decided_by=admin'; end if;
  select count(*) into n from public.audit_events where event_type='product.removal_approved' and entity_id=v_prod;
  if n<>1 then raise exception 'HAPPY1: product.removal_approved audit missing'; end if;
  raise notice 'PASS p1o: admin (product.manage) removed product #1 instantly, request row already Approved, audited';
end $$;
set local role postgres;

-- ── HAPPY 2: EMPLOYEE requests removal of product #2 -> queued, not archived ─
do $$ declare v_emp uuid; v_req uuid; n int;
  v_emp_auth uuid := '0d000000-0000-0000-0000-0000000000d1';
  v_prod uuid := '0e000000-0000-0000-0000-0000000000e2';
begin
  select id into v_emp from public.users where auth_user_id=v_emp_auth;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  v_req := public.request_product_removal(v_prod, 'wrong price entered, want it re-listed cleanly');
  -- Employee lacks audit.read by default — checking audit_events under their own RLS context would
  -- see zero rows regardless of whether the audit fired. Switch to postgres (bypasses RLS) to assert.
  set local role postgres;
  select count(*) into n from public.products where id=v_prod and status='Active';
  if n<>1 then raise exception 'HAPPY2: product should still be Active while Pending'; end if;
  select count(*) into n from public.product_removal_requests where id=v_req and status='Pending' and requested_by=v_emp;
  if n<>1 then raise exception 'HAPPY2: request not Pending / wrong requester'; end if;
  select count(*) into n from public.audit_events where event_type='product.removal_requested' and entity_id=v_req;
  if n<>1 then raise exception 'HAPPY2: product.removal_requested audit missing'; end if;
  raise notice 'PASS p1o: employee (product.remove only) queued a Pending request, product still Active, audited';
end $$;
set local role postgres;

-- ── HAPPY 3: OWNER approves the employee's Pending request on product #2 ─
do $$ declare v_owner uuid; v_req uuid; v_prod uuid := '0e000000-0000-0000-0000-0000000000e2'; n int;
  v_owner_auth uuid := '0c000000-0000-0000-0000-0000000000c1';
begin
  select id into v_owner from public.users where auth_user_id=v_owner_auth;
  select id into v_req from public.product_removal_requests where product_id=v_prod and status='Pending';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.approve_product_removal(v_req);
  select count(*) into n from public.products where id=v_prod and status='Archived';
  if n<>1 then raise exception 'HAPPY3: product not Archived after approval'; end if;
  select count(*) into n from public.product_removal_requests where id=v_req and status='Approved' and decided_by=v_owner;
  if n<>1 then raise exception 'HAPPY3: request not Approved by owner'; end if;
  select count(*) into n from public.audit_events where event_type='product.removal_approved' and entity_id=v_prod;
  if n<>1 then raise exception 'HAPPY3: product.removal_approved audit missing'; end if;
  raise notice 'PASS p1o: owner approved the queued request, product #2 Archived, audited';
end $$;
set local role postgres;

-- ── HAPPY 4: OPERATOR requests removal of product #3; ADMIN rejects it ─
do $$ declare v_op uuid; v_admin uuid; v_req uuid; v_prod uuid := '0e000000-0000-0000-0000-0000000000e3'; n int;
  v_op_auth uuid := '0d000000-0000-0000-0000-0000000000d2';
  v_admin_auth uuid := '0d000000-0000-0000-0000-0000000000d3';
begin
  select id into v_op from public.users where auth_user_id=v_op_auth;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_op_auth)::text, true);
  v_req := public.request_product_removal(v_prod, 'thinking about removing this one');
  set local role postgres;

  select id into v_admin from public.users where auth_user_id=v_admin_auth;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  perform public.reject_product_removal(v_req, 'still selling well, keep it');
  select count(*) into n from public.products where id=v_prod and status='Active';
  if n<>1 then raise exception 'HAPPY4: product should still be Active after rejection'; end if;
  select count(*) into n from public.product_removal_requests where id=v_req and status='Rejected' and decided_by=v_admin and decision_reason='still selling well, keep it';
  if n<>1 then raise exception 'HAPPY4: request not Rejected correctly'; end if;
  select count(*) into n from public.audit_events where event_type='product.removal_rejected' and entity_id=v_req;
  if n<>1 then raise exception 'HAPPY4: product.removal_rejected audit missing'; end if;
  raise notice 'PASS p1o: admin rejected the queued request, product #3 stays Active, audited';
end $$;
set local role postgres;

-- ── SAD 1: product.remove explicitly DENIED via override -> insufficient_privilege ─
do $$ declare v_owner_auth uuid := '0c000000-0000-0000-0000-0000000000c1';
  v_op uuid; v_co uuid; v_prod uuid := '0e000000-0000-0000-0000-0000000000e4';
begin
  select id into v_op from public.users where auth_user_id='0d000000-0000-0000-0000-0000000000d2';
  select v_company into v_co from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.set_user_permission_override(v_co, v_op, 'product.remove', 'deny');
  set local role postgres;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', '0d000000-0000-0000-0000-0000000000d2')::text, true);
  begin
    perform public.request_product_removal(v_prod, 'nope');
    raise exception 'SAD1: operator should be denied — product.remove overridden to deny';
  exception when insufficient_privilege then
    raise notice 'PASS p1o: operator denied after product.remove deny-override — override system composes correctly';
  end;
end $$;
set local role postgres;

-- ── SAD 2: duplicate Pending request on the same product ─
do $$ declare v_emp_auth uuid := '0d000000-0000-0000-0000-0000000000d1'; v_prod uuid := '0e000000-0000-0000-0000-0000000000e4'; v_msg text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  perform public.request_product_removal(v_prod, 'first request');
  begin
    perform public.request_product_removal(v_prod, 'second request while pending');
    raise exception 'SAD2: duplicate Pending request should be rejected';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not ilike '%Pending removal request already exists%' then
      raise exception 'SAD2: wrong raise_exception branch fired — got "%"', v_msg;
    end if;
    raise notice 'PASS p1o: duplicate Pending request denied — one Pending per product';
  end;
end $$;
set local role postgres;

-- ── SAD 3: requester later gains product.manage, tries to approve their OWN request -> denied ─
do $$ declare v_emp uuid; v_emp_auth uuid := '0d000000-0000-0000-0000-0000000000d1';
  v_owner_auth uuid := '0c000000-0000-0000-0000-0000000000c1';
  v_co uuid; v_req uuid; v_prod uuid := '0e000000-0000-0000-0000-0000000000e5';
begin
  select id into v_emp from public.users where auth_user_id=v_emp_auth;
  select v_company into v_co from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  v_req := public.request_product_removal(v_prod, 'requesting before gaining manage');
  set local role postgres;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.set_user_permission_override(v_co, v_emp, 'product.manage', 'grant');
  set local role postgres;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  begin
    perform public.approve_product_removal(v_req);
    raise exception 'SAD3: requester should not be able to approve their own request even after gaining product.manage';
  exception when insufficient_privilege then
    raise notice 'PASS p1o: self-approve denied even after the requester later gained product.manage';
  end;
end $$;
set local role postgres;

-- ── SAD 4: empty reason ─
do $$ declare v_admin_auth uuid := '0d000000-0000-0000-0000-0000000000d3'; v_prod uuid := '0e000000-0000-0000-0000-0000000000e5'; v_msg text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  begin
    perform public.request_product_removal(v_prod, '   ');
    raise exception 'SAD4: empty reason should be rejected';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not ilike '%reason is required%' then
      raise exception 'SAD4: wrong raise_exception branch fired — got "%"', v_msg;
    end if;
    raise notice 'PASS p1o: empty reason denied — a reason is required';
  end;
end $$;
set local role postgres;

-- ── SAD 5: already-Archived product (product #1, archived in HAPPY1) ─
do $$ declare v_admin_auth uuid := '0d000000-0000-0000-0000-0000000000d3'; v_prod uuid := '0e000000-0000-0000-0000-0000000000e1'; v_msg text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  begin
    perform public.request_product_removal(v_prod, 'trying again');
    raise exception 'SAD5: already-archived product should be rejected';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not ilike '%already removed%' then
      raise exception 'SAD5: wrong raise_exception branch fired — got "%"', v_msg;
    end if;
    raise notice 'PASS p1o: already-Archived product denied — cannot request removal twice';
  end;
end $$;
set local role postgres;

-- ── HAPPY 5: ADMIN calls list_pending_product_removals() -> exactly the 2 open Pending rows ─
do $$ declare v_admin_auth uuid := '0d000000-0000-0000-0000-0000000000d3'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  select count(*) into n from public.list_pending_product_removals();
  if n<>2 then raise exception 'HAPPY5: expected exactly 2 Pending rows (product #4 + #5), got %', n; end if;
  select count(*) into n from public.list_pending_product_removals()
   where product_id in ('0e000000-0000-0000-0000-0000000000e4','0e000000-0000-0000-0000-0000000000e5');
  if n<>2 then raise exception 'HAPPY5: the 2 Pending rows are not products #4 and #5'; end if;
  raise notice 'PASS p1o: list_pending_product_removals() returns exactly the open queue for the actor''s company';
end $$;
set local role postgres;

-- ── SAD 6: a holder with no product.manage calls list_pending_product_removals() -> denied ─
-- Uses the OPERATOR, not the employee: SAD3 granted the employee product.manage via override and that
-- grant persists for the rest of this script (no rollback between blocks), so by this point the employee
-- genuinely holds product.manage and would wrongly pass a "remove-only" test.
do $$ declare v_op_auth uuid := '0d000000-0000-0000-0000-0000000000d2';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_op_auth)::text, true);
  begin
    perform count(*) from public.list_pending_product_removals();
    raise exception 'SAD6: a holder with no product.manage should not be able to read the manage queue';
  exception when insufficient_privilege then
    raise notice 'PASS p1o: holder with no product.manage denied reading list_pending_product_removals()';
  end;
end $$;
set local role postgres;

-- ── SAD 7: double-decision — approve product #2's request again (already Approved in HAPPY3) ─
do $$ declare v_owner_auth uuid := '0c000000-0000-0000-0000-0000000000c1'; v_req uuid; v_prod uuid := '0e000000-0000-0000-0000-0000000000e2';
begin
  select id into v_req from public.product_removal_requests where product_id=v_prod and status='Approved';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  begin
    perform public.approve_product_removal(v_req);
    raise exception 'SAD7: approving an already-decided request should be rejected';
  exception when raise_exception then
    raise notice 'PASS p1o: double-decision denied — approve_product_removal is not idempotent on a decided row';
  end;
end $$;
set local role postgres;

-- ── SAD 8: OPERATOR (product.remove only, holds NO product.manage anywhere) tries to approve
--    someone else's (the employee's) still-Pending request on product #4 ─
do $$ declare v_op_auth uuid := '0d000000-0000-0000-0000-0000000000d2'; v_req uuid; v_prod uuid := '0e000000-0000-0000-0000-0000000000e4';
begin
  select id into v_req from public.product_removal_requests where product_id=v_prod and status='Pending';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_op_auth)::text, true);
  begin
    perform public.approve_product_removal(v_req);
    raise exception 'SAD8: a product.remove-only holder with no product.manage should never reach approve';
  exception when insufficient_privilege then
    raise notice 'PASS p1o: operator with no product.manage denied approving someone else''s request';
  end;
end $$;
set local role postgres;

-- ── Cross-tenant isolation: second company's product.manage admin cannot see or decide P1OCO's queue ─
do $$ declare v_admin2_auth uuid := '0d000000-0000-0000-0000-0000000000d4'; n int;
  v_req4 uuid; v_req5 uuid;
begin
  select id into v_req4 from public.product_removal_requests where product_id='0e000000-0000-0000-0000-0000000000e4' and status='Pending';
  select id into v_req5 from public.product_removal_requests where product_id='0e000000-0000-0000-0000-0000000000e5' and status='Pending';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  select count(*) into n from public.list_pending_product_removals();
  if n<>0 then raise exception 'CROSS-TENANT: second company''s admin should see zero rows from P1OCO, saw %', n; end if;

  begin
    perform public.approve_product_removal(v_req4);
    raise exception 'CROSS-TENANT: second company''s admin should not be able to approve P1OCO''s request';
  exception when raise_exception then
    raise notice 'PASS p1o: cross-tenant approve_product_removal denied (not found in caller''s company)';
  end;

  begin
    perform public.reject_product_removal(v_req5, 'not my company');
    raise exception 'CROSS-TENANT: second company''s admin should not be able to reject P1OCO''s request';
  exception when raise_exception then
    raise notice 'PASS p1o: cross-tenant reject_product_removal denied (not found in caller''s company)';
  end;
  raise notice 'PASS p1o: second-tenant admin (product.manage in a DIFFERENT company) has zero visibility into P1OCO''s queue';
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on none of the 4 new functions; authenticated has EXECUTE on all 4 ─
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('request_product_removal','list_pending_product_removals','approve_product_removal','reject_product_removal');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a P1O function (found % grants)', n; end if;
  raise notice 'PASS p1o: anon has no EXECUTE on any P1O function';

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('request_product_removal','list_pending_product_removals','approve_product_removal','reject_product_removal');
  if n<>4 then raise exception 'GRANT: expected authenticated to have EXECUTE on all 4 P1O functions, found %', n; end if;
  raise notice 'PASS p1o: authenticated has EXECUTE on all 4 P1O functions';
end $$;

rollback;
