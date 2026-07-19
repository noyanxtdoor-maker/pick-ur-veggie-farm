-- Guard battery for P2ET1 — Expiration-date tracking + branch stock transfers.
-- Auth-boundary + BEHAVIORAL: proves expiration is settable/editable/listable and correctly gated,
-- write-off removes exactly one batch's stock and posts SHRINKAGE at that batch's own cost, transfer
-- correctly drains source / credits destination (both derived balances, not just one side), transfer
-- preserves FIFO cost + age at the destination, cross-branch/cross-company denial, and grant shape.
--
-- Org: bootstrap tenant P2ET1CO the real way (owner, rank 50), two branches (A, B). WORKER (inventory.
-- adjust + inventory.purchase, via seed's operator role) is the actor for most assertions. A SECOND
-- tenant (P2ET1CO2) with its own branch for cross-company transfer-denial.
-- Exercise:
--   HAPPY 1: buy 10kg of "Test Fert" at branch A with an expiration_date 10 days out -> batch has the
--            date, list_expiring_batches(company, 30) returns it, is_expired=false.
--   HAPPY 2: inventory_set_batch_expiration corrects the date -> list reflects the new date.
--   HAPPY 3: inventory_writeoff_batch on that batch -> material_available(item, branch A) drops to 0,
--            batch status='Expired', a SHRINKAGE journal entry posted for qty*unit_cost, audited.
--   HAPPY 4: buy 20kg fresh (no expiration) at branch A, transfer 12kg to branch B ->
--            material_available at A drops by 12, at B rises by 12 (both checked, not just one),
--            a new batch at B has the SAME unit_cost and SAME received_at as the source batch it came
--            from (FIFO age/cost preserved, not reset), both TransferOut/TransferIn movements share
--            one source_document_id.
--   HAPPY 5: buy at A with an expiration_date, transfer some of it to B -> the destination batch
--            inherits the SAME expiration_date (transfers must not silently drop the tracked date).
--   SAD 1: transfer more than available at source -> check_violation.
--   SAD 2: transfer to/from a branch the actor is not a member of -> insufficient_privilege (checked
--          both directions: not a member of source, not a member of destination).
--   SAD 3: transfer between two branches in DIFFERENT companies -> check_violation (composite lookup
--          catches it before the membership check even runs).
--   SAD 4: write off a batch with zero remaining stock (already consumed) -> check_violation.
--   SAD 5: write off with an empty reason -> raise_exception.
--   SAD 6: a holder with no inventory.adjust cannot call list_expiring_batches, inventory_writeoff_
--          batch, inventory_set_batch_expiration, or inventory_transfer_stock -> insufficient_privilege
--          on all four.
--   Cross-tenant: second company's worker cannot transfer P2ET1CO's item (unknown item denial) and
--     list_expiring_batches for their own company returns zero rows (proves company scoping, not an
--     accidentally-empty result).
--   Regression: inventory_record_purchase's original 14-arg call shape (no PO link, no expiration)
--     still resolves and behaves identically — proves this migration's drop-and-recreate didn't break
--     the P2U1/T3.2/P2M3B.1 call sites.
--   Grant shape: anon has EXECUTE on none of the 4 new functions; authenticated has EXECUTE on all 4.
-- Wrapped in BEGIN/ROLLBACK; does not mutate (reset re-seeds on next run).
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0c200000-0000-0000-0000-000000000c21'::uuid, 'authenticated', 'authenticated', 'owner.p2et1@t.local');
do $$ begin
  set local role service_role;
  perform public.bootstrap_initial_tenant('0c200000-0000-0000-0000-000000000c21','Owner P2ET1','P2ET1CO','P2ET1 Company','P2ET1BRA','P2ET1 Branch A');
  set local role postgres;
end $$;

insert into public.branches (id, company_id, branch_code, name)
  select public.uuidv7(), id, 'P2ET1BRB', 'P2ET1 Branch B' from public.companies where company_code='P2ET1CO';

create temp table g as select
  (select id from public.companies where company_code='P2ET1CO') as v_company,
  (select id from public.branches where branch_code='P2ET1BRA') as v_branch_a,
  (select id from public.branches where branch_code='P2ET1BRB') as v_branch_b,
  (select id from public.roles where company_id=(select id from public.companies where company_code='P2ET1CO') and role_key='operator') as v_op_role;
grant select on g to authenticated;

-- WORKER (operator: inventory.purchase + inventory.adjust, member of BOTH branches via seed)
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d200000-0000-0000-0000-000000000d21'::uuid, 'authenticated', 'authenticated', 'worker.p2et1@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d200000-0000-0000-0000-000000000d21', 'Worker P2ET1', 'worker.p2et1@t.local', 'worker_p2et1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d200000-0000-0000-0000-000000000d21';
  select v_op_role into v_role from g;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
    (v_user, (select v_company from g), (select v_branch_a from g), v_role),
    (v_user, (select v_company from g), (select v_branch_b from g), v_role);
end $$;

-- BRANCH-A-ONLY worker (no membership at branch B) for SAD 2
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d200000-0000-0000-0000-000000000d22'::uuid, 'authenticated', 'authenticated', 'workera.p2et1@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d200000-0000-0000-0000-000000000d22', 'Worker A-Only P2ET1', 'workera.p2et1@t.local', 'workera_p2et1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d200000-0000-0000-0000-000000000d22';
  select v_op_role into v_role from g;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
    (v_user, (select v_company from g), (select v_branch_a from g), v_role);
end $$;

-- EMPLOYEE (no inventory.adjust at all) for SAD 6
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d200000-0000-0000-0000-000000000d23'::uuid, 'authenticated', 'authenticated', 'emp.p2et1@t.local');
do $$ declare v_role uuid; v_user uuid; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d200000-0000-0000-0000-000000000d23', 'Emp P2ET1', 'emp.p2et1@t.local', 'emp_p2et1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d200000-0000-0000-0000-000000000d23';
  select id into v_role from public.roles where company_id=(select v_company from g) and role_key='employee';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
    (v_user, (select v_company from g), (select v_branch_a from g), v_role);
end $$;

-- SECOND tenant (cross-tenant fixture)
insert into public.companies (id, company_code, name) values
  ('0f200000-0000-0000-0000-000000000f21','P2ET1CO2','P2ET1 Company Two');
insert into public.branches (id, company_id, branch_code, name) values
  ('0f200000-0000-0000-0000-000000000fb1','0f200000-0000-0000-0000-000000000f21','P2ET1BR2','P2ET1 Branch Two'),
  ('0f200000-0000-0000-0000-000000000fb2','0f200000-0000-0000-0000-000000000f21','P2ET1BR3','P2ET1 Branch Three');
do $$ begin
  set local role service_role;
  perform public.seed_standard_roles('0f200000-0000-0000-0000-000000000f21');
  set local role postgres;
end $$;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '0d200000-0000-0000-0000-000000000d24'::uuid, 'authenticated', 'authenticated', 'worker2.p2et1@t.local');
do $$ declare v_role uuid; v_user uuid; v_co2 uuid := '0f200000-0000-0000-0000-000000000f21'; v_br2 uuid := '0f200000-0000-0000-0000-000000000fb1'; v_br3 uuid := '0f200000-0000-0000-0000-000000000fb2'; begin
  insert into public.users (auth_user_id, display_name, email, username)
    values ('0d200000-0000-0000-0000-000000000d24', 'Worker P2ET1 Two', 'worker2.p2et1@t.local', 'worker2_p2et1')
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id='0d200000-0000-0000-0000-000000000d24';
  select id into v_role from public.roles where company_id=v_co2 and role_key='operator';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
    (v_user, v_co2, v_br2, v_role),
    (v_user, v_co2, v_br3, v_role);
end $$;

-- ── HAPPY 1: buy with an expiration_date -> batch has it, list_expiring_batches sees it ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_recv uuid; v_batch uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  v_recv := public.inventory_record_purchase(
    (select v_branch_a from g), 'substrate', 'Test Fert P2ET1', false, 10, 500, 'online', 'Lazada', null,
    current_date, 'p2et1-happy1', null, null, null, null, (current_date + 10));
  select id into v_batch from public.material_batches where purchase_receiving_id = v_recv;
  select count(*) into n from public.list_expiring_batches((select v_company from g), 30) where id = v_batch and not is_expired;
  if n<>1 then raise exception 'HAPPY1: expiring batch not listed correctly'; end if;
  set local role postgres;
  select count(*) into n from public.material_batches where id=v_batch and expiration_date = current_date + 10;
  if n<>1 then raise exception 'HAPPY1: expiration_date not stored on the new batch'; end if;
  raise notice 'PASS p2et1: purchase with an expiration_date stores it on the batch and surfaces in list_expiring_batches';
end $$;
set local role postgres;

-- ── HAPPY 2: correct the date -> list reflects the new date ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_batch uuid; n int;
begin
  select mb.id into v_batch from public.material_batches mb join public.inventory_items ii on ii.id=mb.item_id
    where ii.name='Test Fert P2ET1' and mb.company_id=(select v_company from g);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  perform public.inventory_set_batch_expiration(v_batch, current_date + 3);
  select count(*) into n from public.list_expiring_batches((select v_company from g), 30) where id=v_batch and expiration_date = current_date + 3;
  if n<>1 then raise exception 'HAPPY2: corrected expiration_date not reflected'; end if;
  raise notice 'PASS p2et1: inventory_set_batch_expiration corrects the date, reflected immediately';
end $$;
set local role postgres;

-- ── HAPPY 3: write off the batch -> stock zeroed, Expired, SHRINKAGE posted ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_batch uuid; v_before numeric; n int;
begin
  select mb.id into v_batch from public.material_batches mb join public.inventory_items ii on ii.id=mb.item_id
    where ii.name='Test Fert P2ET1' and mb.company_id=(select v_company from g);
  select public.material_available((select ii.id from public.inventory_items ii where ii.name='Test Fert P2ET1'), (select v_branch_a from g)) into v_before;
  if v_before <> 10 then raise exception 'HAPPY3: expected 10kg on hand before write-off, got %', v_before; end if;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  perform public.inventory_writeoff_batch(v_batch, 'Spoiled, past date');
  set local role postgres;
  select public.material_available((select ii.id from public.inventory_items ii where ii.name='Test Fert P2ET1'), (select v_branch_a from g)) into v_before;
  if v_before <> 0 then raise exception 'HAPPY3: expected 0kg after write-off, got %', v_before; end if;
  select count(*) into n from public.material_batches where id=v_batch and status='Expired';
  if n<>1 then raise exception 'HAPPY3: batch not marked Expired'; end if;
  select count(*) into n from public.journal_lines jl join public.chart_of_accounts coa on coa.id=jl.account_id
    where coa.account_code='SHRINKAGE' and jl.company_id=(select v_company from g) and jl.debit = 500;
  if n<>1 then raise exception 'HAPPY3: SHRINKAGE journal line for 500 not found (10kg * 50/kg)'; end if;
  select count(*) into n from public.audit_events where event_type='inventory.batch_written_off' and entity_id=v_batch;
  if n<>1 then raise exception 'HAPPY3: batch_written_off audit missing'; end if;
  raise notice 'PASS p2et1: write-off zeroes the batch''s stock, marks it Expired, posts SHRINKAGE at its own cost, audited';
end $$;
set local role postgres;

-- ── HAPPY 4: transfer 12kg (no expiration) A->B, both sides checked, cost+age preserved ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_item uuid; v_recv uuid;
  v_src_batch uuid; v_transfer uuid; v_a numeric; v_b numeric; n int; v_src_cost numeric; v_src_received timestamptz;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  v_recv := public.inventory_record_purchase(
    (select v_branch_a from g), 'seeds', 'Test Seeds Transfer P2ET1', false, 20, 400, 'online', 'Lazada', null,
    current_date, 'p2et1-happy4', null, null, null, null, null);
  set local role postgres;
  select id into v_item from public.inventory_items where name='Test Seeds Transfer P2ET1' and company_id=(select v_company from g);
  select id, unit_cost, received_at into v_src_batch, v_src_cost, v_src_received from public.material_batches where purchase_receiving_id = v_recv;

  set local role authenticated;
  v_transfer := public.inventory_transfer_stock(v_item, (select v_branch_a from g), (select v_branch_b from g), 12, 'restocking branch B');
  set local role postgres;
  select public.material_available(v_item, (select v_branch_a from g)) into v_a;
  select public.material_available(v_item, (select v_branch_b from g)) into v_b;
  if v_a <> 8 then raise exception 'HAPPY4: expected 8kg left at source, got %', v_a; end if;
  if v_b <> 12 then raise exception 'HAPPY4: expected 12kg arrived at destination, got %', v_b; end if;
  select count(*) into n from public.inventory_movements where source_document_id=v_transfer and movement_type='TransferOut' and branch_id=(select v_branch_a from g) and quantity=12;
  if n<>1 then raise exception 'HAPPY4: TransferOut movement missing/wrong'; end if;
  select count(*) into n from public.inventory_movements where source_document_id=v_transfer and movement_type='TransferIn' and branch_id=(select v_branch_b from g) and quantity=12;
  if n<>1 then raise exception 'HAPPY4: TransferIn movement missing/wrong'; end if;
  select count(*) into n from public.material_batches where branch_id=(select v_branch_b from g) and item_id=v_item and unit_cost=v_src_cost and received_at=v_src_received;
  if n<>1 then raise exception 'HAPPY4: destination batch did not preserve source unit_cost + received_at (FIFO age)'; end if;
  raise notice 'PASS p2et1: transfer drains source and credits destination correctly (both sides checked), preserves FIFO cost + age, linked by one transfer id';
end $$;
set local role postgres;

-- ── HAPPY 5: transfer preserves expiration_date too ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_item uuid; v_recv uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  v_recv := public.inventory_record_purchase(
    (select v_branch_a from g), 'seeds', 'Test Seeds Expiring Transfer P2ET1', false, 5, 100, 'online', 'Lazada', null,
    current_date, 'p2et1-happy5', null, null, null, null, current_date + 15);
  set local role postgres;
  select id into v_item from public.inventory_items where name='Test Seeds Expiring Transfer P2ET1' and company_id=(select v_company from g);

  set local role authenticated;
  perform public.inventory_transfer_stock(v_item, (select v_branch_a from g), (select v_branch_b from g), 5, null);
  set local role postgres;
  select count(*) into n from public.material_batches where branch_id=(select v_branch_b from g) and item_id=v_item and expiration_date = current_date + 15;
  if n<>1 then raise exception 'HAPPY5: destination batch did not inherit the source expiration_date'; end if;
  raise notice 'PASS p2et1: transfer preserves the source batch''s expiration_date at the destination';
end $$;
set local role postgres;

-- ── SAD 1: transfer more than available ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_item uuid;
begin
  select id into v_item from public.inventory_items where name='Test Seeds Transfer P2ET1' and company_id=(select v_company from g);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  begin
    perform public.inventory_transfer_stock(v_item, (select v_branch_a from g), (select v_branch_b from g), 999, null);
    raise exception 'SAD1: transfer exceeding available stock should be rejected';
  exception when check_violation then
    raise notice 'PASS p2et1: transfer exceeding source stock denied';
  end;
end $$;
set local role postgres;

-- ── SAD 2: not a member of destination (worker A-only tries A->B) ─
do $$ declare v_workera_auth uuid := '0d200000-0000-0000-0000-000000000d22'; v_item uuid;
begin
  select id into v_item from public.inventory_items where name='Test Seeds Transfer P2ET1' and company_id=(select v_company from g);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_workera_auth)::text, true);
  begin
    perform public.inventory_transfer_stock(v_item, (select v_branch_a from g), (select v_branch_b from g), 1, null);
    raise exception 'SAD2: transfer to a branch the actor is not a member of should be denied';
  exception when insufficient_privilege then
    raise notice 'PASS p2et1: transfer denied — actor not a member of the destination branch';
  end;
end $$;
set local role postgres;

-- ── SAD 3: source and destination branches in different companies ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_item uuid;
begin
  select id into v_item from public.inventory_items where name='Test Seeds Transfer P2ET1' and company_id=(select v_company from g);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  begin
    perform public.inventory_transfer_stock(v_item, (select v_branch_a from g), '0f200000-0000-0000-0000-000000000fb1', 1, null);
    raise exception 'SAD3: cross-company transfer should be rejected';
  exception when check_violation then
    raise notice 'PASS p2et1: cross-company transfer denied (branches belong to different companies)';
  end;
end $$;
set local role postgres;

-- ── SAD 4: write off a batch with zero remaining stock ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_batch uuid;
begin
  select mb.id into v_batch from public.material_batches mb join public.inventory_items ii on ii.id=mb.item_id
    where ii.name='Test Fert P2ET1' and mb.company_id=(select v_company from g); -- already written off in HAPPY3
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  begin
    perform public.inventory_writeoff_batch(v_batch, 'trying again');
    raise exception 'SAD4: writing off an already-zeroed batch should be rejected';
  exception when check_violation then
    raise notice 'PASS p2et1: write-off denied on a batch with zero remaining stock';
  end;
end $$;
set local role postgres;

-- ── SAD 5: write off with an empty reason ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_batch uuid;
begin
  select id into v_batch from public.material_batches where branch_id=(select v_branch_b from g) limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  begin
    perform public.inventory_writeoff_batch(v_batch, '   ');
    raise exception 'SAD5: empty write-off reason should be rejected';
  exception when raise_exception then
    raise notice 'PASS p2et1: empty write-off reason denied';
  end;
end $$;
set local role postgres;

-- ── SAD 6: no inventory.adjust at all -> denied on all four new/changed functions ─
do $$ declare v_emp_auth uuid := '0d200000-0000-0000-0000-000000000d23'; v_item uuid; v_batch uuid;
begin
  select id into v_item from public.inventory_items where name='Test Seeds Transfer P2ET1' and company_id=(select v_company from g);
  select id into v_batch from public.material_batches where branch_id=(select v_branch_b from g) limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_emp_auth)::text, true);
  begin
    perform public.list_expiring_batches((select v_company from g), 30);
    raise exception 'SAD6a: list_expiring_batches should require inventory.adjust';
  exception when insufficient_privilege then raise notice 'PASS p2et1: list_expiring_batches denied without inventory.adjust'; end;
  begin
    perform public.inventory_set_batch_expiration(v_batch, current_date);
    raise exception 'SAD6b: inventory_set_batch_expiration should require inventory.adjust';
  exception when insufficient_privilege then raise notice 'PASS p2et1: inventory_set_batch_expiration denied without inventory.adjust'; end;
  begin
    perform public.inventory_writeoff_batch(v_batch, 'x');
    raise exception 'SAD6c: inventory_writeoff_batch should require inventory.adjust';
  exception when insufficient_privilege then raise notice 'PASS p2et1: inventory_writeoff_batch denied without inventory.adjust'; end;
  begin
    perform public.inventory_transfer_stock(v_item, (select v_branch_a from g), (select v_branch_b from g), 1, null);
    raise exception 'SAD6d: inventory_transfer_stock should require inventory.adjust';
  exception when insufficient_privilege then raise notice 'PASS p2et1: inventory_transfer_stock denied without inventory.adjust'; end;
end $$;
set local role postgres;

-- ── Cross-tenant: second company's worker cannot transfer P2ET1CO's item; sees zero expiring rows for their own empty company ─
do $$ declare v_worker2_auth uuid := '0d200000-0000-0000-0000-000000000d24'; v_item uuid; n int;
begin
  select id into v_item from public.inventory_items where name='Test Seeds Transfer P2ET1' and company_id=(select v_company from g);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker2_auth)::text, true);
  begin
    perform public.inventory_transfer_stock(v_item, '0f200000-0000-0000-0000-000000000fb1', '0f200000-0000-0000-0000-000000000fb2', 1, null);
    raise exception 'CROSS-TENANT: second company''s worker should not resolve P2ET1CO''s item at all';
  exception when foreign_key_violation then
    raise notice 'PASS p2et1: cross-tenant transfer denied (item not found in caller''s company, both branches genuinely theirs)';
  end;
  select count(*) into n from public.list_expiring_batches('0f200000-0000-0000-0000-000000000f21', 365);
  if n<>0 then raise exception 'CROSS-TENANT: second (empty) company should see zero expiring batches, saw %', n; end if;
  raise notice 'PASS p2et1: second-tenant worker has zero visibility into P2ET1CO''s expiring-batch queue';
end $$;
set local role postgres;

-- ── Regression: original 14-arg inventory_record_purchase call shape (T3.2/P2M3B.1 vintage) still works ─
do $$ declare v_worker_auth uuid := '0d200000-0000-0000-0000-000000000d21'; v_recv uuid; n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_worker_auth)::text, true);
  v_recv := public.inventory_record_purchase(
    (select v_branch_a from g), 'seeds', 'Test Regression Item P2ET1', false, 3, 90, 'online', 'Lazada', null,
    current_date, 'p2et1-regression', null, null, null);
  set local role postgres;
  select count(*) into n from public.purchase_receivings where id=v_recv and quantity=3 and total_amount=90;
  if n<>1 then raise exception 'REGRESSION: 14-arg call shape (no PO link, no expiration_date) did not resolve correctly'; end if;
  select count(*) into n from public.material_batches where purchase_receiving_id=v_recv and expiration_date is null;
  if n<>1 then raise exception 'REGRESSION: expiration_date should default to null when omitted'; end if;
  raise notice 'PASS p2et1: original pre-P2ET1 call shape (14 args) still resolves and behaves identically, expiration_date defaults to null';
end $$;
set local role postgres;

-- ── Grant shape: anon has EXECUTE on none of the 4 new functions; authenticated has EXECUTE on all 4 ─
do $$ declare n int;
begin
  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='anon'
     and routine_name in ('inventory_set_batch_expiration','list_expiring_batches','inventory_writeoff_batch','inventory_transfer_stock');
  if n<>0 then raise exception 'GRANT: anon has EXECUTE on a P2ET1 function (found % grants)', n; end if;
  raise notice 'PASS p2et1: anon has no EXECUTE on any P2ET1 function';

  select count(*) into n from information_schema.routine_privileges
   where routine_schema='public' and grantee='authenticated' and privilege_type='EXECUTE'
     and routine_name in ('inventory_set_batch_expiration','list_expiring_batches','inventory_writeoff_batch','inventory_transfer_stock');
  if n<>4 then raise exception 'GRANT: expected authenticated to have EXECUTE on all 4 P2ET1 functions, found %', n; end if;
  raise notice 'PASS p2et1: authenticated has EXECUTE on all 4 P2ET1 functions';
end $$;

rollback;
