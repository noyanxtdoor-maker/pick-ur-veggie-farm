-- Tier-2 BEHAVIORAL Finished-Goods/Inventory-Spine security test (Phase 2 M2A) — blocking gate.
-- Proves: balances are ledger-derived (20.09), the ledger is tamper-proof (no manual write; append-only), opening
-- balances are governed (inventory.opening + branch member + idempotent + audited), and product/stock are tenant +
-- branch isolated. Runs as authenticated owners/workers with simulated JWT. Self-contained BEGIN/ROLLBACK; any DEFECT
-- raises → fails under -v ON_ERROR_STOP=1.
\set ON_ERROR_STOP on
begin;
-- P1A: the signup trigger is under test in auth-lifecycle-security.sql; these fixtures construct
-- identities manually with fixed ids, so silence it inside this rolled-back transaction.
set local app.p1a_skip_signup_trigger = '1';

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

-- ══ M3A: materials & equipment inventory (20.07/20.08/20.09/20.12/20.25) ═════
-- extra fixture: owner A also holds the M3A permission keys (postgres)
set local role postgres;
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions where permission_key in ('inventory.purchase','inventory.adjust','equipment.manage');

-- purchase happy path: receiving + item find-or-create + batch + movement + balanced GL; categories seeded; idempotent
do $$ declare v_recv uuid; v_recv2 uuid; v_item uuid; v_bal numeric; n int; d numeric; c numeric; v_entry uuid; raw_d numeric;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_recv := public.inventory_record_purchase('a1111111-1111-1111-1111-111111111111','substrate','Calcium Nitrate',false,10,800.00,'online','Lazada','General Seller','2026-07-01','idem-buy-1');
  v_recv2 := public.inventory_record_purchase('a1111111-1111-1111-1111-111111111111','substrate','Calcium Nitrate',false,999,9.00,'online','Lazada','x','2026-07-01','idem-buy-1');  -- replay
  if v_recv2 <> v_recv then raise exception 'DEFECT inv: purchase replay created a second receiving'; end if;
  set local role postgres;
  select count(*) into n from public.item_categories where company_id='11111111-1111-1111-1111-111111111111';
  if n <> 7 then raise exception 'DEFECT inv: categories not seeded (got %, want 7)', n; end if;
  select item_id into v_item from public.purchase_receivings where id = v_recv;
  if (select name from public.inventory_items where id = v_item) <> 'Calcium Nitrate' then raise exception 'DEFECT inv: item not created from purchase'; end if;
  v_bal := public.material_available(v_item, 'a1111111-1111-1111-1111-111111111111');
  if v_bal <> 10 then raise exception 'DEFECT inv: purchase balance wrong (got %, want 10 — replay must not double)', v_bal; end if;
  if (select unit_cost from public.material_batches where purchase_receiving_id = v_recv) <> 80.00 then raise exception 'DEFECT inv: batch unit cost wrong (want 80 = 800/10)'; end if;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_recv;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if v_entry is null or d <> c or d <> 800.00 then raise exception 'DEFECT inv: purchase GL wrong (d=% c=%, want 800)', d, c; end if;
  select jl.debit into raw_d from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='RAW_MATERIALS';
  if raw_d <> 800.00 then raise exception 'DEFECT inv: RAW_MATERIALS debit wrong'; end if;
  raise notice 'PASS inv: purchase = receiving+item+batch+movement, balance 10 from ledger, Dr RAW_MATERIALS 800/Cr CASH 800, idempotent, 7 categories seeded';
end $$;

-- FIFO: second (newer) batch @50; decrease 15 drains oldest batch (10@80) then 5@50 → shrinkage 1050, balance 15
do $$ declare v_item uuid; v_bal numeric; n int; d numeric; c numeric; v_entry uuid;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.inventory_record_purchase('a1111111-1111-1111-1111-111111111111','substrate','Calcium Nitrate',false,20,1000.00,'physical','Agri-Supply Malolos','Aling Sandra','2026-07-02','idem-buy-2');
  set local role postgres;
  select id into v_item from public.inventory_items where company_id='11111111-1111-1111-1111-111111111111' and name='Calcium Nitrate';
  if public.material_available(v_item,'a1111111-1111-1111-1111-111111111111') <> 30 then raise exception 'DEFECT inv: setup balance wrong'; end if;
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_bal := public.inventory_adjust_material('a1111111-1111-1111-1111-111111111111', v_item, -15, 'spoiled by moisture exposure', 'idem-adj-1');
  if v_bal <> 15 then raise exception 'DEFECT inv: adjusted balance wrong (got %, want 15)', v_bal; end if;
  set local role postgres;
  select count(*) into n from public.inventory_movements where item_id = v_item and movement_type = 'AdjustmentDecrease';
  if n <> 2 then raise exception 'DEFECT inv: FIFO drain movements wrong (got %, want 2 — one per batch)', n; end if;
  select je.id into v_entry from public.journal_entries je where je.description like 'Inventory shrinkage%';
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if v_entry is null or d <> c or d <> 1050.00 then raise exception 'DEFECT inv: shrinkage GL wrong (d=% c=%, want 1050 = 10x80 + 5x50 FIFO)', d, c; end if;
  raise notice 'PASS inv: FIFO decrease drained oldest batch first (10@80 then 5@50), shrinkage 1050 balanced, balance 15';
end $$;

-- adjustment protections: reason mandatory; cannot exceed stock; increase = zero-cost found stock
do $$ declare v_item uuid; begin
  set local role postgres; select id into v_item from public.inventory_items where name='Calcium Nitrate';
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.inventory_adjust_material('a1111111-1111-1111-1111-111111111111', v_item, -1, '  ', 'idem-adj-nr');
  raise exception 'DEFECT inv: adjustment accepted without a reason';
exception when check_violation then raise notice 'PASS inv: adjustment reason is mandatory (20.09 protection)'; end $$;
do $$ declare v_item uuid; begin
  set local role postgres; select id into v_item from public.inventory_items where name='Calcium Nitrate';
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.inventory_adjust_material('a1111111-1111-1111-1111-111111111111', v_item, -9999, 'oops', 'idem-adj-ov');
  raise exception 'DEFECT inv: adjustment exceeded available stock';
exception when check_violation then raise notice 'PASS inv: adjustment beyond available stock rejected'; end $$;
do $$ declare v_item uuid; v_bal numeric; v_cost numeric;
begin
  set local role postgres; select id into v_item from public.inventory_items where name='Calcium Nitrate';
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_bal := public.inventory_adjust_material('a1111111-1111-1111-1111-111111111111', v_item, 5, 'excess found on shelf count', 'idem-adj-2');
  if v_bal <> 20 then raise exception 'DEFECT inv: increase balance wrong (got %, want 20)', v_bal; end if;
  set local role postgres;
  select unit_cost into v_cost from public.material_batches where item_id = v_item and purchase_receiving_id is null;
  if v_cost <> 0 then raise exception 'DEFECT inv: found-stock batch not zero-cost'; end if;
  raise notice 'PASS inv: increase = zero-cost found-stock batch, balance 20';
end $$;

-- equipment: purchase auto-registers the asset + Dr EQUIPMENT; checklist appends log + updates condition
do $$ declare v_recv uuid; v_asset uuid; d numeric; c numeric; v_entry uuid; n int; v_cond text;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_recv := public.inventory_record_purchase('a1111111-1111-1111-1111-111111111111','equipment','Submersible Pump',true,1,3500.00,'physical','Agri-Supply Malolos','Mang Ben','2026-07-02','idem-buy-eq');
  set local role postgres;
  select id, condition into v_asset, v_cond from public.equipment_assets where purchase_receiving_id = v_recv;
  if v_asset is null or v_cond <> 'Good' then raise exception 'DEFECT inv: equipment asset not registered Good'; end if;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_recv;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if d <> c or d <> 3500.00 then raise exception 'DEFECT inv: equipment GL wrong (d=% c=%, want 3500)', d, c; end if;
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.equipment_log_check(v_asset, true, true, 'Owner A', 'filter needs replacement soon');
  set local role postgres;
  if (select condition from public.equipment_assets where id = v_asset) <> 'Needs Maintenance' then raise exception 'DEFECT inv: condition not Needs Maintenance'; end if;
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.equipment_log_check(v_asset, false, false, 'Owner A', 'motor burned out');
  set local role postgres;
  if (select condition from public.equipment_assets where id = v_asset) <> 'Broken' then raise exception 'DEFECT inv: condition not Broken'; end if;
  select count(*) into n from public.equipment_maintenance_logs where equipment_id = v_asset;
  if n <> 2 then raise exception 'DEFECT inv: checklist history wrong (got %, want 2)', n; end if;
  raise notice 'PASS inv: equipment purchase → asset Good + Dr EQUIPMENT 3500; checklist history 2, condition Good→Needs Maintenance→Broken';
end $$;

-- permission + isolation attacks on the new surface
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.inventory_record_purchase('a2222222-2222-2222-2222-222222222222','seeds','Hack Seeds',false,1,1,'online','Lazada',null,'2026-07-02','idem-wk-buy');
  raise exception 'DEFECT inv: worker without inventory.purchase recorded a purchase';
exception when insufficient_privilege then raise notice 'PASS inv: purchase denied without inventory.purchase'; end $$;
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.inventory_record_purchase('b1111111-1111-1111-1111-111111111111','seeds','Hack Seeds',false,1,1,'online','Lazada',null,'2026-07-02','idem-xc-buy');
  raise exception 'DEFECT inv: owner A purchased into company B';
exception when insufficient_privilege then raise notice 'PASS inv: cross-company purchase denied'; end $$;
do $$ declare v_asset uuid; begin
  set local role postgres; select id into v_asset from public.equipment_assets limit 1;
  set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.equipment_log_check(v_asset, true, false, 'Worker', 'x');
  raise exception 'DEFECT inv: worker without equipment.manage logged a checklist';
exception when insufficient_privilege then raise notice 'PASS inv: equipment checklist denied without equipment.manage'; end $$;

-- function-only writes: authenticated cannot create items/receivings/batches directly (stock cannot be invented)
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.purchase_receivings (company_id, branch_id, item_id, quantity, total_amount, source_type, source_name, received_date)
    select company_id, 'a1111111-1111-1111-1111-111111111111', id, 1, 1, 'online', 'x', now()::date from public.inventory_items limit 1;
  raise exception 'DEFECT inv: authenticated created a receiving directly';
exception when insufficient_privilege then raise notice 'PASS inv: direct receiving insert denied (function-only)'; end $$;
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.material_batches (company_id, branch_id, item_id, unit_cost)
    select company_id, 'a1111111-1111-1111-1111-111111111111', id, 0 from public.inventory_items limit 1;
  raise exception 'DEFECT inv: authenticated created a material batch directly';
exception when insufficient_privilege then raise notice 'PASS inv: direct material-batch insert denied (function-only)'; end $$;

-- ledger domain integrity: a movement must reference exactly ONE batch domain (fg XOR material)
do $$ begin set local role postgres;
  insert into public.inventory_movements (company_id, branch_id, movement_type, quantity)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','AdjustmentIncrease', 1);
  raise exception 'DEFECT inv: movement accepted with no batch reference';
exception when check_violation then raise notice 'PASS inv: ledger one-domain check enforced (fg XOR material batch)'; end $$;

rollback;
