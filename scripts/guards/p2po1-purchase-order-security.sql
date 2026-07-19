-- Guard battery for P2PO1 — Purchase-order request/approval workflow.
-- Auth-boundary (purchase_order_requests + inventory_record_purchase's new fulfillment arg): proves
-- the tiered request-vs-decide split (purchase_order.request/inventory.purchase = request;
-- inventory.purchase = decide), that approval never itself touches stock/GL, that fulfillment only
-- proceeds against an Approved request for the SAME item, double-decision protection, self-decide
-- denial, cross-tenant isolation, and grant shape.
--
-- Org:
--   - bootstrap tenant P2PO1CO the real way (owner, rank 50, full catalog), seed standard roles.
--   - EMPLOYEE (purchase_order.request only, via seed) — the tier with no purchase authority.
--   - ADMIN (inventory.purchase, via seed) — approves/rejects/buys.
--   - OPERATOR (inventory.purchase, via seed) — also eligible to request (OR-gate), used for HAPPY4.
--   - one real inventory item, created via a genuine inventory_record_purchase() call (not a raw
--     insert) so category/base_unit are realistic.
--   - a SECOND tenant (P2PO1CO2) for cross-tenant isolation.
-- Exercise:
--   HAPPY 1: EMPLOYEE (purchase_order.request only) requests a purchase -> Pending row, audited,
--            stock/receivings/movements counts UNCHANGED (a request never moves inventory).
--   HAPPY 2: ADMIN approves EMPLOYEE's request -> Approved, decided_by=admin, audited; stock still
--            unchanged (approval only authorizes, never buys).
--   HAPPY 3: ADMIN fulfills the Approved request via inventory_record_purchase(...,
--            p_purchase_order_request_id) -> request becomes Fulfilled, fulfilled_receiving_id set
--            and matches the new receiving row; THIS is where stock/GL actually change.
--   HAPPY 4: OPERATOR (inventory.purchase, using the OR-gate to also file a request) requests a
--            second purchase; ADMIN rejects it with a reason -> Rejected, decision_notes set,
--            audited, stock unchanged.
--   HAPPY 5: ADMIN calls list_pending_purchase_order_requests() -> exactly the still-open queue.
--   HAPPY 6: EMPLOYEE calls list_my_purchase_order_requests(company) -> sees their own request(s)
--            (Pending + later-decided) regardless of status; sees none of OPERATOR's.
--   SAD 1: purchase_order.request explicitly DENIED via override -> insufficient_privilege (override
--          system composes correctly with the new key).
--   SAD 2: EMPLOYEE's request from HAPPY1 is already Approved; EMPLOYEE is THEN granted
--          inventory.purchase via override and tries to approve their OWN (different, new) request
--          -> insufficient_privilege (self-approve denied even after gaining the decide key).
--   SAD 3: reject with an empty reason -> raise_exception 'a reason is required'.
--   SAD 4: fulfilling with a Pending (not yet Approved) request id -> check_violation 'not Approved'.
--   SAD 5: fulfilling an Approved request but for a DIFFERENT item than what the purchase resolves
--          to -> check_violation 'different item' (defends against fulfilling the wrong PO).
--   SAD 6: double-decision — approving an already-Approved request again -> raise_exception 'not
--          found, already decided'.
--   Cross-tenant: second company's inventory.purchase admin sees zero rows from P2PO1CO's queue and
--     cannot approve/reject its still-Pending request.
--   Grant shape: anon has EXECUTE on none of the 6 new functions; authenticated has EXECUTE on all 6.
-- Wrapped in BEGIN/ROLLBACK; does not mutate (reset re-seeds on next run).
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- Owner auth.users + bootstrap
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0c100000-0000-0000-0000-000000000c11'::uuid, 'authenticated', 'authenticated', 'owner.p2po1@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0c100000-0000-0000-0000-000000000c11','Owner P2PO1','P2PO1CO','P2PO1 Company','P2PO1BR','P2PO1 Branch');
  set local role postgres;
end $$;

create temp table g as select
  (select id from public.companies where company_code='P2PO1CO') as v_company,
  (select id from public.branches where branch_code='P2PO1BR') as v_branch,
  (select id from public.users where auth_user_id='0c100000-0000-0000-0000-000000000c11') as v_owner,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P2PO1CO') and role_key='employee') as v_emp_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P2PO1CO') and role_key='operator') as v_op_role,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P2PO1CO') and role_key='admin') as v_admin_role;
-- authenticated needs SELECT on these fixture lookup tables too — every do-block below runs under
-- `set local role authenticated` and reads (select ... from g)/(select ... from gi).
grant select on g to authenticated;

-- EMPLOYEE (purchase_order.request only, via seed)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d100000-0000-0000-0000-000000000d11'::uuid, 'authenticated', 'authenticated', 'emp.p2po1@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d100000-0000-0000-0000-000000000d11', 'Emp P2PO1', 'emp.p2po1@t.local', 'emp_p2po1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d100000-0000-0000-0000-000000000d11';
  select v_emp_role into v_role from g;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- OPERATOR (inventory.purchase, via seed)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d100000-0000-0000-0000-000000000d12'::uuid, 'authenticated', 'authenticated', 'op.p2po1@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d100000-0000-0000-0000-000000000d12', 'Op P2PO1', 'op.p2po1@t.local', 'op_p2po1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d100000-0000-0000-0000-000000000d12';
  select v_op_role into v_role from g;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- ADMIN (inventory.purchase, via seed)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d100000-0000-0000-0000-000000000d13'::uuid, 'authenticated', 'authenticated', 'admin.p2po1@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d100000-0000-0000-0000-000000000d13', 'Admin P2PO1', 'admin.p2po1@t.local', 'admin_p2po1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d100000-0000-0000-0000-000000000d13';
  select v_admin_role into v_role from g;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, (select v_company from g), (select v_branch from g), v_role);
end $$;

-- SECOND tenant (cross-tenant isolation fixture)
insert into public.companies (id, company_code, name) values
  ('0f100000-0000-0000-0000-000000000f21','P2PO1CO2','P2PO1 Company Two');
insert into public.branches (id, company_id, branch_code, name) values
  ('0f100000-0000-0000-0000-000000000fb1','0f100000-0000-0000-0000-000000000f21','P2PO1BR2','P2PO1 Branch Two');
do $$ begin
  set local role service_role;
  perform public.seed_standard_roles('0f100000-0000-0000-0000-000000000f21');
  set local role postgres;
end $$;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d100000-0000-0000-0000-000000000d14'::uuid, 'authenticated', 'authenticated', 'admin2.p2po1@t.local');
do $$ declare v_role uuid; v_user uuid; v_co2 uuid := '0f100000-0000-0000-0000-000000000f21'; v_br2 uuid := '0f100000-0000-0000-0000-000000000fb1'; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d100000-0000-0000-0000-000000000d14', 'Admin P2PO1 Two', 'admin2.p2po1@t.local', 'admin2_p2po1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d100000-0000-0000-0000-000000000d14';
  select id into v_role from public.roles where company_id=v_co2 and role_key='admin';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, v_co2, v_br2, v_role);
end $$;

-- One real inventory item, created via a genuine inventory_record_purchase() call (ADMIN buys once
-- outside the PO flow, just to have a real item to request against).
do $$ declare v_admin_auth uuid := '0d100000-0000-0000-0000-000000000d13';
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  perform public.inventory_record_purchase(
    (select v_branch from g), 'seeds', 'Test Seeds P2PO1', false, 10, 500, 'online', 'Lazada', null,
    current_date, 'p2po1-seed-item', null, null, 'kg');
end $$;
set local role postgres;

create temp table gi as select id as v_item from public.inventory_items where company_id=(select v_company from g) and name='Test Seeds P2PO1';
grant select on gi to authenticated;

-- ── HAPPY 1: EMPLOYEE (purchase_order.request only) requests a purchase -> Pending, no stock move ─
do $$ declare v_emp uuid; v_req uuid; n int; recv_before int; mov_before int;
  v_emp_auth uuid := '0d100000-0000-0000-0000-000000000d11';
begin
  select id into v_emp from public.users where auth_user_id=v_emp_auth;
  select count(*) into recv_before from public.purchase_receivings where company_id=(select v_company from g);
  select count(*) into mov_before from public.inventory_movements where company_id=(select v_company from g);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  v_req := public.request_purchase_order((select v_branch from g), (select v_item from gi), 5, 60, null, 'running low on seeds');
  if v_req is null then raise exception 'HAPPY1: request_purchase_order returned null'; end if;
  set local role postgres;
  select count(*) into n from public.purchase_order_requests where id=v_req and status='Pending' and requested_by=v_emp;
  if n<>1 then raise exception 'HAPPY1: request row not Pending / wrong requester'; end if;
  select count(*) into n from public.audit_events where event_type='inventory.purchase_order_requested' and entity_id=v_req;
  if n<>1 then raise exception 'HAPPY1: purchase_order_requested audit missing'; end if;
  select count(*) into n from public.purchase_receivings where company_id=(select v_company from g);
  if n<>recv_before then raise exception 'HAPPY1: a request must never create a purchase_receivings row'; end if;
  select count(*) into n from public.inventory_movements where company_id=(select v_company from g);
  if n<>mov_before then raise exception 'HAPPY1: a request must never move the stock ledger'; end if;
  raise notice 'PASS p2po1: employee (purchase_order.request only) queued a Pending request, zero stock/GL side effects, audited';
end $$;
set local role postgres;

-- ── HAPPY 2: ADMIN approves EMPLOYEE's request -> Approved, still no stock move ─
do $$ declare v_admin uuid; v_req uuid; n int; recv_before int;
  v_admin_auth uuid := '0d100000-0000-0000-0000-000000000d13';
begin
  select id into v_admin from public.users where auth_user_id=v_admin_auth;
  select id into v_req from public.purchase_order_requests where company_id=(select v_company from g) and status='Pending' order by created_at limit 1;
  select count(*) into recv_before from public.purchase_receivings where company_id=(select v_company from g);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  perform public.approve_purchase_order_request(v_req, 'go ahead, we do need seeds');
  set local role postgres;
  select count(*) into n from public.purchase_order_requests where id=v_req and status='Approved' and decided_by=v_admin;
  if n<>1 then raise exception 'HAPPY2: request not Approved by admin'; end if;
  select count(*) into n from public.audit_events where event_type='inventory.purchase_order_approved' and entity_id=v_req;
  if n<>1 then raise exception 'HAPPY2: purchase_order_approved audit missing'; end if;
  select count(*) into n from public.purchase_receivings where company_id=(select v_company from g);
  if n<>recv_before then raise exception 'HAPPY2: approval must never create a purchase_receivings row'; end if;
  set local role authenticated;
  select count(*) into n from public.list_approved_purchase_order_requests() where id=v_req;
  if n<>1 then raise exception 'HAPPY2: newly-Approved request should appear in the "ready to buy" queue'; end if;
  set local role postgres;
  raise notice 'PASS p2po1: admin approved the queued request — authorized only, zero stock side effects, audited, now in the ready-to-buy queue';
end $$;
set local role postgres;

-- ── HAPPY 3: ADMIN fulfills the Approved request -> Fulfilled, fulfilled_receiving_id set, stock moves ─
do $$ declare v_admin_auth uuid := '0d100000-0000-0000-0000-000000000d13'; v_req uuid; v_recv uuid; n int;
begin
  select id into v_req from public.purchase_order_requests where company_id=(select v_company from g) and status='Approved' order by created_at limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  v_recv := public.inventory_record_purchase(
    (select v_branch from g), 'seeds', 'Test Seeds P2PO1', false, 5, 275, 'online', 'Lazada', null,
    current_date, 'p2po1-fulfill-1', null, null, null, v_req);
  set local role postgres;
  select count(*) into n from public.purchase_order_requests where id=v_req and status='Fulfilled' and fulfilled_receiving_id=v_recv;
  if n<>1 then raise exception 'HAPPY3: request not marked Fulfilled with the matching receiving id'; end if;
  select count(*) into n from public.purchase_receivings where id=v_recv;
  if n<>1 then raise exception 'HAPPY3: fulfillment purchase did not create a receiving row'; end if;
  set local role authenticated;
  select count(*) into n from public.list_approved_purchase_order_requests() where id=v_req;
  if n<>0 then raise exception 'HAPPY3: a Fulfilled request must drop off the ready-to-buy queue'; end if;
  set local role postgres;
  raise notice 'PASS p2po1: admin fulfilled the Approved request via inventory_record_purchase — Fulfilled, linked, stock now moved, off the ready-to-buy queue';
end $$;
set local role postgres;

-- ── HAPPY 4: OPERATOR (inventory.purchase, OR-gate) requests a purchase; ADMIN rejects it ─
do $$ declare v_op_auth uuid := '0d100000-0000-0000-0000-000000000d12'; v_admin_auth uuid := '0d100000-0000-0000-0000-000000000d13';
  v_op uuid; v_admin uuid; v_req uuid; n int;
begin
  select id into v_op from public.users where auth_user_id=v_op_auth;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_op_auth)::text, true);
  v_req := public.request_purchase_order((select v_branch from g), (select v_item from gi), 20, 55, null, 'bulk restock idea');
  set local role postgres;

  select id into v_admin from public.users where auth_user_id=v_admin_auth;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  perform public.reject_purchase_order_request(v_req, 'too much for now, small batches only');
  set local role postgres;
  select count(*) into n from public.purchase_order_requests where id=v_req and status='Rejected' and decided_by=v_admin and decision_notes='too much for now, small batches only';
  if n<>1 then raise exception 'HAPPY4: request not Rejected correctly'; end if;
  select count(*) into n from public.audit_events where event_type='inventory.purchase_order_rejected' and entity_id=v_req;
  if n<>1 then raise exception 'HAPPY4: purchase_order_rejected audit missing'; end if;
  raise notice 'PASS p2po1: operator (inventory.purchase, via OR-gate) requested; admin rejected with a reason, audited';
end $$;
set local role postgres;

-- ── HAPPY 5: ADMIN calls list_pending_purchase_order_requests() -> exactly the open queue ─
do $$ declare v_admin_auth uuid := '0d100000-0000-0000-0000-000000000d13'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  select count(*) into n from public.list_pending_purchase_order_requests();
  if n<>0 then raise exception 'HAPPY5: expected zero Pending rows at this point (all decided so far), got %', n; end if;
  raise notice 'PASS p2po1: list_pending_purchase_order_requests() reflects the true open-queue count (zero, all prior requests already decided)';
end $$;
set local role postgres;

-- ── HAPPY 6: EMPLOYEE calls list_my_purchase_order_requests() -> sees own rows, not OPERATOR's ─
do $$ declare v_emp_auth uuid := '0d100000-0000-0000-0000-000000000d11'; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  select count(*) into n from public.list_my_purchase_order_requests((select v_company from g));
  if n<>1 then raise exception 'HAPPY6: employee should see exactly their own 1 request (now Fulfilled), got %', n; end if;
  select count(*) into n from public.list_my_purchase_order_requests((select v_company from g)) where status='Fulfilled';
  if n<>1 then raise exception 'HAPPY6: employee''s own request should show status Fulfilled'; end if;
  raise notice 'PASS p2po1: employee self-view shows exactly their own request, correctly Fulfilled, none of operator''s';
end $$;
set local role postgres;

-- ── SAD 1: purchase_order.request explicitly DENIED via override -> insufficient_privilege ─
do $$ declare v_owner_auth uuid := '0c100000-0000-0000-0000-000000000c11';
  v_emp uuid; v_co uuid;
begin
  select id into v_emp from public.users where auth_user_id='0d100000-0000-0000-0000-000000000d11';
  select v_company into v_co from g;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.set_user_permission_override(v_co, v_emp, 'purchase_order.request', 'deny');
  set local role postgres;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', '0d100000-0000-0000-0000-000000000d11')::text, true);
  begin
    perform public.request_purchase_order((select v_branch from g), (select v_item from gi), 1, 10, null, 'nope');
    raise exception 'SAD1: employee should be denied — purchase_order.request overridden to deny';
  exception when insufficient_privilege then
    raise notice 'PASS p2po1: employee denied after purchase_order.request deny-override — override system composes correctly';
  end;
end $$;
set local role postgres;

-- ── SAD 2: EMPLOYEE gains inventory.purchase via override, tries to approve their OWN new request ─
do $$ declare v_owner_auth uuid := '0c100000-0000-0000-0000-000000000c11'; v_emp_auth uuid := '0d100000-0000-0000-0000-000000000d11';
  v_emp uuid; v_co uuid; v_req uuid;
begin
  select id into v_emp from public.users where auth_user_id=v_emp_auth;
  select v_company into v_co from g;
  -- clear the SAD1 deny-override first, then grant inventory.purchase instead
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner_auth)::text, true);
  perform public.set_user_permission_override(v_co, v_emp, 'purchase_order.request', null);
  perform public.set_user_permission_override(v_co, v_emp, 'inventory.purchase', 'grant');
  set local role postgres;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  v_req := public.request_purchase_order((select v_branch from g), (select v_item from gi), 2, 30, null, 'second request, now with inventory.purchase');
  begin
    perform public.approve_purchase_order_request(v_req, 'self-approving, should fail');
    raise exception 'SAD2: requester should not be able to approve their own request even after gaining inventory.purchase';
  exception when insufficient_privilege then
    raise notice 'PASS p2po1: self-approve denied even after the requester gained inventory.purchase';
  end;
end $$;
set local role postgres;

-- ── SAD 3: reject with an empty reason ─
do $$ declare v_admin_auth uuid := '0d100000-0000-0000-0000-000000000d13'; v_req uuid; v_msg text;
begin
  select id into v_req from public.purchase_order_requests where company_id=(select v_company from g) and status='Pending' order by created_at limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  begin
    perform public.reject_purchase_order_request(v_req, '   ');
    raise exception 'SAD3: empty reason should be rejected';
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not ilike '%reason is required%' then
      raise exception 'SAD3: wrong raise_exception branch fired — got "%"', v_msg;
    end if;
    raise notice 'PASS p2po1: empty reject reason denied — a reason is required';
  end;
end $$;
set local role postgres;

-- ── SAD 4: fulfilling with a Pending (not Approved) request id ─
do $$ declare v_admin_auth uuid := '0d100000-0000-0000-0000-000000000d13'; v_req uuid; v_msg text;
begin
  select id into v_req from public.purchase_order_requests where company_id=(select v_company from g) and status='Pending' order by created_at limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  begin
    perform public.inventory_record_purchase(
      (select v_branch from g), 'seeds', 'Test Seeds P2PO1', false, 2, 60, 'online', 'Lazada', null,
      current_date, 'p2po1-sad4', null, null, null, v_req);
    raise exception 'SAD4: fulfilling a Pending (not Approved) request should be rejected';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not ilike '%not Approved%' then
      raise exception 'SAD4: wrong check_violation branch fired — got "%"', v_msg;
    end if;
    raise notice 'PASS p2po1: fulfilling a non-Approved request denied';
  end;
end $$;
set local role postgres;

-- ── SAD 5: fulfilling an Approved request for a DIFFERENT item than the purchase resolves to ─
do $$ declare v_admin_auth uuid := '0d100000-0000-0000-0000-000000000d13'; v_req uuid; v_msg text;
begin
  select id into v_req from public.purchase_order_requests where company_id=(select v_company from g) and status='Pending' order by created_at limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  perform public.approve_purchase_order_request(v_req, 'approved for the mismatch test');
  begin
    perform public.inventory_record_purchase(
      (select v_branch from g), 'utilities', 'A totally different item P2PO1', false, 1, 100, 'online', 'Lazada', null,
      current_date, 'p2po1-sad5', null, null, null, v_req);
    raise exception 'SAD5: fulfilling an Approved request for a different item should be rejected';
  exception when check_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg not ilike '%different item%' then
      raise exception 'SAD5: wrong check_violation branch fired — got "%"', v_msg;
    end if;
    raise notice 'PASS p2po1: fulfilling an Approved request with a mismatched item denied';
  end;
end $$;
set local role postgres;

-- ── SAD 6: double-decision — approve an already-Approved request again ─
do $$ declare v_admin_auth uuid := '0d100000-0000-0000-0000-000000000d13'; v_req uuid;
begin
  -- reuse the request left Approved-but-unfulfilled by SAD5's setup
  select id into v_req from public.purchase_order_requests where company_id=(select v_company from g) and status='Approved' order by decided_at desc limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_auth)::text, true);
  begin
    perform public.approve_purchase_order_request(v_req, 'approving again');
    raise exception 'SAD6: approving an already-decided request should be rejected';
  exception when raise_exception then
    raise notice 'PASS p2po1: double-decision denied — approve_purchase_order_request is not idempotent on a decided row';
  end;
end $$;
set local role postgres;

-- ── Cross-tenant isolation: second company's inventory.purchase admin cannot see/decide P2PO1CO's queue ─
do $$ declare v_admin2_auth uuid := '0d100000-0000-0000-0000-000000000d14'; n int; v_req uuid; v_pending_req uuid;
begin
  -- leave one genuinely Pending row for the cross-tenant reject attempt
  select id into v_pending_req from public.purchase_order_requests where company_id=(select v_company from g) and status='Pending' order by created_at limit 1;
  if v_pending_req is null then
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', '0d100000-0000-0000-0000-000000000d12')::text, true);
    v_pending_req := public.request_purchase_order((select v_branch from g), (select v_item from gi), 1, 5, null, 'fixture for cross-tenant test');
    set local role postgres;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2_auth)::text, true);
  select count(*) into n from public.list_pending_purchase_order_requests();
  if n<>0 then raise exception 'CROSS-TENANT: second company''s admin should see zero rows from P2PO1CO, saw %', n; end if;

  begin
    perform public.approve_purchase_order_request(v_pending_req, 'not my company');
    raise exception 'CROSS-TENANT: second company''s admin should not be able to approve P2PO1CO''s request';
  exception when raise_exception then
    raise notice 'PASS p2po1: cross-tenant approve_purchase_order_request denied (not found in caller''s company)';
  end;

  begin
    perform public.reject_purchase_order_request(v_pending_req, 'not my company');
    raise exception 'CROSS-TENANT: second company''s admin should not be able to reject P2PO1CO''s request';
  exception when raise_exception then
    raise notice 'PASS p2po1: cross-tenant reject_purchase_order_request denied (not found in caller''s company)';
  end;
  raise notice 'PASS p2po1: second-tenant admin (inventory.purchase in a DIFFERENT company) has zero visibility into P2PO1CO''s queue';
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on none of the 6 new functions; authenticated has EXECUTE on all 6 ─
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('request_purchase_order','list_pending_purchase_order_requests','list_approved_purchase_order_requests','list_my_purchase_order_requests','approve_purchase_order_request','reject_purchase_order_request');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a P2PO1 function (found % grants)', n; end if;
  raise notice 'PASS p2po1: anon has no EXECUTE on any P2PO1 function';

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('request_purchase_order','list_pending_purchase_order_requests','list_approved_purchase_order_requests','list_my_purchase_order_requests','approve_purchase_order_request','reject_purchase_order_request');
  if n<>6 then raise exception 'GRANT: expected authenticated to have EXECUTE on all 6 P2PO1 functions, found %', n; end if;
  raise notice 'PASS p2po1: authenticated has EXECUTE on all 6 P2PO1 functions';
end $$;

rollback;
