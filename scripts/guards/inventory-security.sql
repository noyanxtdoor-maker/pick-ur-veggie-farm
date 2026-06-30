-- Tier-2 BEHAVIORAL Finished-Goods/Inventory-Spine security test (Phase 2 M2A) — blocking gate.
-- Proves: balances are ledger-derived (20.09), the ledger is tamper-proof (no manual write; append-only), opening
-- balances are governed (inventory.opening + branch member + idempotent + audited), and product/stock are tenant +
-- branch isolated. Runs as authenticated owners/workers with simulated JWT. Self-contained BEGIN/ROLLBACK; any DEFECT
-- raises → fails under -v ON_ERROR_STOP=1.
\set ON_ERROR_STOP on
begin;

-- ── fixtures (postgres): companies A(branches A1,A2) + B(B1); owners hold product.manage + inventory.opening; a
--    worker is a member of A2 only with NO inventory perms; one product per company (B exists for cross-company tests).
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
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker (no inventory perms)');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions where permission_key in ('product.manage','inventory.opening');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions where permission_key in ('product.manage','inventory.opening');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000c');
-- products (postgres fixtures, one per company)
insert into public.products (id, company_id, product_code, name, retail_per_kg) values
  ('ca000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','LETTUCE','Lettuce',150.00),
  ('cb000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','TOMATO-B','B Tomato',120.00);

-- ── HAPPY PATH: owner A records an opening finished-goods balance; balance is ledger-derived; idempotent ──
do $$ declare v_fg uuid; v_fg2 uuid; n int; avail numeric;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';  -- owner A
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-LET-A1', 100.0, 50.00, 'idem-open-1', 'opening count');
  avail := public.fg_available(v_fg);
  if avail <> 100.0 then raise exception 'DEFECT inv: opening balance derived wrong (got %, want 100)', avail; end if;
  -- idempotency: same key returns the same batch, no second opening
  v_fg2 := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-LET-A1b', 999.0, 1.00, 'idem-open-1', 'retry');
  if v_fg2 <> v_fg then raise exception 'DEFECT inv: idempotency key produced a second opening batch'; end if;
  if public.fg_available(v_fg) <> 100.0 then raise exception 'DEFECT inv: idempotent retry changed the balance'; end if;
  set local role postgres;
  select count(*) into n from public.inventory_movements where finished_goods_batch_id = v_fg and movement_type='Opening'; if n <> 1 then raise exception 'DEFECT inv: expected exactly 1 Opening movement, got %', n; end if;
  select count(*) into n from public.audit_events where company_id='11111111-1111-1111-1111-111111111111' and module='inventory'; if n < 1 then raise exception 'DEFECT inv: opening not audited'; end if;
  raise notice 'PASS inv: opening balance recorded; fg_available=100 from ledger; idempotent; movement + audit written';
end $$;

-- ── ATTACKS ──
-- permission gating: a member without inventory.opening cannot record an opening
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.record_opening_finished_goods('a2222222-2222-2222-2222-222222222222','ca000000-0000-0000-0000-0000000000a1','FG-X', 10.0, 1.00, 'idem-wk', 'x');
  raise exception 'DEFECT inv: worker without inventory.opening recorded an opening';
exception when insufficient_privilege then raise notice 'PASS inv: opening denied without inventory.opening'; end $$;

-- branch/company isolation: owner A cannot open stock in company B''s branch (no permission in B)
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.record_opening_finished_goods('b1111111-1111-1111-1111-111111111111','cb000000-0000-0000-0000-0000000000b1','FG-Y', 10.0, 1.00, 'idem-xc', 'x');
  raise exception 'DEFECT inv: owner A opened stock in company B';
exception when insufficient_privilege then raise notice 'PASS inv: cross-company opening denied (no permission in B)'; end $$;

-- cross-company product reference: owner A opening with company B''s product → composite FK blocks it
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','cb000000-0000-0000-0000-0000000000b1','FG-Z', 10.0, 1.00, 'idem-xp', 'x');
  raise exception 'DEFECT inv: finished goods accepted a cross-company product';
exception when foreign_key_violation then raise notice 'PASS inv: cross-company product reference blocked (composite FK)'; end $$;

-- tamper-proof ledger: authenticated cannot INSERT a movement directly (no grant) — stock cannot be invented
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.inventory_movements (company_id, branch_id, finished_goods_batch_id, movement_type, quantity)
    select company_id, branch_id, id, 'AdjustmentIncrease', 9999.0 from public.finished_goods_batches limit 1;
  raise exception 'DEFECT inv: authenticated wrote the movement ledger directly';
exception when insufficient_privilege then raise notice 'PASS inv: direct movement insert denied (ledger is function-only)'; end $$;

-- stock cannot be invented: authenticated cannot INSERT finished goods directly (no grant)
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.finished_goods_batches (company_id, branch_id, finished_goods_code, product_id, cost_per_unit)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','FG-HACK','ca000000-0000-0000-0000-0000000000a1',0);
  raise exception 'DEFECT inv: authenticated created finished goods outside the governed function';
exception when insufficient_privilege then raise notice 'PASS inv: direct finished-goods insert denied (function-only)'; end $$;

-- append-only ledger: history cannot be rewritten — UPDATE blocked even for the table owner (superuser)
do $$ begin set local role postgres;
  update public.inventory_movements set quantity = 1 where movement_type = 'Opening';
  raise exception 'DEFECT inv: a movement row was updated';
exception when restrict_violation then raise notice 'PASS inv: movement ledger is append-only (UPDATE blocked by trigger)'; end $$;
do $$ begin set local role postgres;
  delete from public.inventory_movements where movement_type = 'Opening';
  raise exception 'DEFECT inv: a movement row was deleted';
exception when restrict_violation then raise notice 'PASS inv: movement ledger is append-only (DELETE blocked by trigger)'; end $$;

-- read isolation: the worker (member of A2) cannot see branch A1''s finished goods / movements
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  select count(*) into n from public.finished_goods_batches where branch_id='a1111111-1111-1111-1111-111111111111'; if n <> 0 then raise exception 'DEFECT inv: worker sees A1 finished goods (%)', n; end if;
  select count(*) into n from public.inventory_movements where branch_id='a1111111-1111-1111-1111-111111111111'; if n <> 0 then raise exception 'DEFECT inv: worker sees A1 movements'; end if;
  raise notice 'PASS inv: branch A1 stock/movements invisible to a non-member (branch isolation)';
end $$;
-- positive: owner A (member of A1) sees the A1 finished goods
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select count(*) into n from public.finished_goods_batches where branch_id='a1111111-1111-1111-1111-111111111111'; if n < 1 then raise exception 'DEFECT inv: owner A cannot see A1 finished goods'; end if;
  raise notice 'PASS inv: owner A (member of A1) sees A1 finished goods';
end $$;

-- product price list: cross-company write denied; worker without product.manage denied
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.products (company_id, product_code, name, retail_per_kg) values ('22222222-2222-2222-2222-222222222222','HACK','x',1);
  raise exception 'DEFECT inv: owner A created a product in company B';
exception when insufficient_privilege then raise notice 'PASS inv: cross-company product insert denied (RLS)'; end $$;
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  insert into public.products (company_id, product_code, name, retail_per_kg) values ('11111111-1111-1111-1111-111111111111','WK','x',1);
  raise exception 'DEFECT inv: worker without product.manage created a product';
exception when insufficient_privilege then raise notice 'PASS inv: product create denied without product.manage'; end $$;

rollback;
