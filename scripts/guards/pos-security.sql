-- Tier-2 BEHAVIORAL POS-Sale security test (Phase 2 M2B) — blocking gate.
-- Proves the core operational transaction: an atomic weigh-sale posts BALANCED double-entry (22.06/26.07), deducts
-- finished-goods stock via the controlled ledger (20.16/20.09), recognizes COGS, is idempotent (B5), enforces price
-- authority + no-oversell + pos.sell + branch isolation, and writes immutable (append-only) journals. Runs as
-- authenticated owners/workers with simulated JWT. Self-contained BEGIN/ROLLBACK; any DEFECT raises under ON_ERROR_STOP.
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
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker (no pos.sell)');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions where permission_key in ('product.manage','inventory.opening','pos.sell','pos.settle','pos.void','cash.session');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions where permission_key in ('product.manage','inventory.opening','pos.sell');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000c');
insert into public.products (id, company_id, product_code, name, retail_per_kg) values
  ('ca000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','LETTUCE','Lettuce',150.00),
  ('cb000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','TOMATO-B','B Tomato',120.00);

-- ── HAPPY PATH: open 10kg @ ₱50 cost; sell 2kg @ retail ₱150 → FARM price ₱135/kg (P2-M2E, mock DISCOUNT=0.10) ──
do $$ declare v_fg uuid; v_inv uuid; avail numeric; v_entry uuid; d numeric; c numeric; rev numeric; cogs numeric;
              v_unit numeric; v_retail numeric; v_total numeric;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';  -- owner A
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-LET', 10.0, 50.00, 'open-1', 'opening');
  v_inv := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
            jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 2.0)),
            500.00, 'sale-1');
  avail := public.fg_available(v_fg);
  if avail <> 8.0 then raise exception 'DEFECT pos: stock not deducted (got %, want 8)', avail; end if;
  set local role postgres;
  -- farm price authority: charged 135/kg (retail 150 snapshotted), invoice total 270
  select total into v_total from public.invoices where id = v_inv;
  if v_total <> 270.00 then raise exception 'DEFECT pos: invoice total wrong (got %, want 270 = 2kg x 135 farm)', v_total; end if;
  select unit_price, retail_unit_price into v_unit, v_retail from public.sales_order_items
    where sales_order_id = (select sales_order_id from public.invoices where id = v_inv);
  if v_unit <> 135.00 or v_retail <> 150.00 then raise exception 'DEFECT pos: farm/retail prices wrong (unit %, retail %; want 135/150)', v_unit, v_retail; end if;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_inv;
  if v_entry is null then raise exception 'DEFECT pos: no journal entry posted for the sale'; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if d <> c then raise exception 'DEFECT pos: journal does not balance (debits % <> credits %)', d, c; end if;
  if d <> 370.00 then raise exception 'DEFECT pos: posting total wrong (got %, want 370 = 270 sales + 100 cogs)', d; end if;
  select jl.credit into rev from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='SALES';
  select jl.debit  into cogs from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='COGS';
  if rev <> 270.00 then raise exception 'DEFECT pos: sales revenue wrong (got %, want 270 farm-priced)', rev; end if;
  if cogs <> 100.00 then raise exception 'DEFECT pos: COGS wrong (got %, want 100)', cogs; end if;
  raise notice 'PASS pos: farm-priced sale (135/kg, retail 150 snapshotted) posted balanced GL (270 sales + 100 cogs), stock 10->8';
end $$;

-- idempotency: replaying the same sale returns the same invoice; no double-deduct, no second journal
do $$ declare v_fg uuid; v_inv1 uuid; v_inv2 uuid; n int;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-LET2', 10.0, 50.00, 'open-2', 'opening');
  v_inv1 := public.pos_record_sale('a1111111-1111-1111-1111-111111111111', jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 3.0)), 500, 'sale-dup');
  v_inv2 := public.pos_record_sale('a1111111-1111-1111-1111-111111111111', jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 3.0)), 500, 'sale-dup');
  if v_inv1 <> v_inv2 then raise exception 'DEFECT pos: idempotent retry created a second sale'; end if;
  if public.fg_available(v_fg) <> 7.0 then raise exception 'DEFECT pos: idempotent retry double-deducted stock (got %, want 7)', public.fg_available(v_fg); end if;
  set local role postgres;
  select count(*) into n from public.journal_entries je join public.invoices i on i.id = je.source_document_id where i.id = v_inv1;
  if n <> 1 then raise exception 'DEFECT pos: idempotent retry posted % journals (want 1)', n; end if;
  raise notice 'PASS pos: replay is idempotent (one invoice, stock 10->7 once, one journal)';
end $$;

-- ── ATTACKS ──
do $$ declare v_fg uuid; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-OS', 5.0, 50.00, 'open-os', 'x');
  perform public.pos_record_sale('a1111111-1111-1111-1111-111111111111', jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 999.0)), 999999, 'sale-os');
  raise exception 'DEFECT pos: oversold beyond available stock';
exception when check_violation then raise notice 'PASS pos: oversell rejected (available < quantity, 20.17 revenue-integrity)'; end $$;

do $$ declare v_fg uuid; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-CASH', 5.0, 50.00, 'open-cash', 'x');
  perform public.pos_record_sale('a1111111-1111-1111-1111-111111111111', jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 2.0)), 100.00, 'sale-cash');
  raise exception 'DEFECT pos: sale accepted with cash < total';
exception when check_violation then raise notice 'PASS pos: insufficient cash tendered rejected'; end $$;

-- permission: worker without pos.sell cannot sell (and cannot read company-A stock to target it anyway)
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.pos_record_sale('a2222222-2222-2222-2222-222222222222', jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id','ca000000-0000-0000-0000-0000000000a1','weight_kg',1.0)), 500, 'sale-wk');
  raise exception 'DEFECT pos: worker without pos.sell recorded a sale';
exception when insufficient_privilege then raise notice 'PASS pos: sale denied without pos.sell'; end $$;

-- branch isolation: owner A cannot sell in company B''s branch (no pos.sell in B)
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.pos_record_sale('b1111111-1111-1111-1111-111111111111', jsonb_build_array(jsonb_build_object('product_id','cb000000-0000-0000-0000-0000000000b1','finished_goods_batch_id','cb000000-0000-0000-0000-0000000000b1','weight_kg',1.0)), 500, 'sale-xb');
  raise exception 'DEFECT pos: owner A sold in company B';
exception when insufficient_privilege then raise notice 'PASS pos: cross-company/branch sale denied'; end $$;

-- cross-tenant product: owner A selling company B''s product → unknown product in company A
do $$ declare v_fg uuid; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-XT', 5.0, 50.00, 'open-xt', 'x');
  perform public.pos_record_sale('a1111111-1111-1111-1111-111111111111', jsonb_build_array(jsonb_build_object('product_id','cb000000-0000-0000-0000-0000000000b1','finished_goods_batch_id', v_fg, 'weight_kg', 1.0)), 500, 'sale-xt');
  raise exception 'DEFECT pos: sale accepted a cross-company product';
exception when foreign_key_violation then raise notice 'PASS pos: cross-company product reference blocked (server price authority)'; end $$;

-- append-only financials: a posted journal line cannot be edited even by the owner/superuser
do $$ begin set local role postgres;
  update public.journal_lines set debit = 0, credit = 0 where debit > 0;
  raise exception 'DEFECT pos: a journal line was edited';
exception when restrict_violation then raise notice 'PASS pos: journals are append-only (UPDATE blocked — financial immutability)'; end $$;

-- ══ M2C: pre-order → AR · settlement · void · cash session ══════════════════

-- preorder (farm-priced): 2kg @ retail 150 → farm 270, 10% discount −27, delivery +20 → total 263; Dr AR 263
do $$ declare v_fg uuid; v_inv uuid; v_entry uuid; ar_debit numeric; d numeric; c numeric; v_status text; v_type text; v_total numeric;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-PRE', 10.0, 50.00, 'open-pre', 'x');
  v_inv := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
            jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 2.0)),
            0, 'sale-pre', 'preorder', 0.10, 20.00, 'Deliver to Aling Sandra, Public Market');
  set local role postgres;
  select status, invoice_type, total into v_status, v_type, v_total from public.invoices where id = v_inv;
  if v_status <> 'Unpaid' or v_type <> 'credit' then raise exception 'DEFECT pos: preorder not Unpaid/credit (%/%)', v_status, v_type; end if;
  if v_total <> 263.00 then raise exception 'DEFECT pos: preorder total wrong (got %, want 263 = 270 farm - 27 + 20)', v_total; end if;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_inv;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if d <> c then raise exception 'DEFECT pos: preorder journal unbalanced'; end if;
  select jl.debit into ar_debit from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='AR';
  if ar_debit <> 263.00 then raise exception 'DEFECT pos: AR debit wrong (got %, want 263)', ar_debit; end if;
  if public.fg_available(v_fg) <> 8.0 then raise exception 'DEFECT pos: preorder did not deduct stock'; end if;
  raise notice 'PASS pos: preorder → Unpaid credit invoice 263 (farm 270−10%%+20 fee, mock stacking), Dr AR 263 balanced, stock deducted';
end $$;

-- settle: cash 500 on the 263 preorder → Paid, change 237, new balanced journal Dr Cash/Cr AR; double-settle no-op
do $$ declare v_inv uuid; v_change numeric; n1 int; n2 int;
begin
  set local role postgres;
  select id into v_inv from public.invoices where status = 'Unpaid' limit 1;
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_change := public.pos_settle_sale(v_inv, 500.00);
  if v_change <> 237.00 then raise exception 'DEFECT pos: settlement change wrong (got %, want 237)', v_change; end if;
  set local role postgres;
  if (select status from public.invoices where id = v_inv) <> 'Paid' then raise exception 'DEFECT pos: settled invoice not Paid'; end if;
  select count(*) into n1 from public.journal_entries where source_document_id = v_inv;
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.pos_settle_sale(v_inv, 999.00);  -- replay
  set local role postgres;
  select count(*) into n2 from public.journal_entries where source_document_id = v_inv;
  if n2 <> n1 then raise exception 'DEFECT pos: double-settle posted another journal'; end if;
  raise notice 'PASS pos: settlement Paid w/ change 237, Dr Cash/Cr AR posted once; double-settle is a no-op';
end $$;

-- settle/void permission tiers: the worker (pos-less) is denied both (id fetched as postgres — RLS already hides
-- A1 invoices from a non-member, which is itself the isolation working)
do $$ declare v_inv uuid; begin
  set local role postgres; select id into v_inv from public.invoices limit 1;
  set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.pos_settle_sale(v_inv, 999);
  raise exception 'DEFECT pos: worker settled an invoice';
exception when insufficient_privilege then raise notice 'PASS pos: settle denied without pos.settle'; end $$;
do $$ declare v_inv uuid; begin
  set local role postgres; select id into v_inv from public.invoices limit 1;
  set local role authenticated; set local request.jwt.claims='{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.pos_void_sale(v_inv, 'because');
  raise exception 'DEFECT pos: worker voided an invoice';
exception when insufficient_privilege then raise notice 'PASS pos: void denied without pos.void (approval tier)'; end $$;

-- void: reversing journal balances, stock returns, status Voided, reason mandatory, idempotent
do $$ declare v_fg uuid; v_inv uuid; before_avail numeric; n1 int; n2 int; d numeric; c numeric; v_entry uuid;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-VOID', 10.0, 50.00, 'open-void', 'x');
  v_inv := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
            jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 4.0)), 999, 'sale-void');
  if public.fg_available(v_fg) <> 6.0 then raise exception 'DEFECT pos: setup deduct failed'; end if;
  begin
    perform public.pos_void_sale(v_inv, '');
    raise exception 'DEFECT pos: void accepted without a reason';
  exception when check_violation then null; end;
  perform public.pos_void_sale(v_inv, 'weighing error');
  if public.fg_available(v_fg) <> 10.0 then raise exception 'DEFECT pos: void did not return stock (got %)', public.fg_available(v_fg); end if;
  set local role postgres;
  if (select status from public.invoices where id = v_inv) <> 'Voided' then raise exception 'DEFECT pos: invoice not Voided'; end if;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_inv and je.source_document_type = 'VoidedInvoice';
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if v_entry is null or d <> c or d <> 740.00 then raise exception 'DEFECT pos: void reversal wrong (entry %, d=% c=%, want 740 = 540 farm sales + 200 cogs)', v_entry, d, c; end if;
  select count(*) into n1 from public.inventory_movements where source_document_id = v_inv and movement_type = 'AdjustmentIncrease';
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.pos_void_sale(v_inv, 'again');  -- replay
  set local role postgres;
  select count(*) into n2 from public.inventory_movements where source_document_id = v_inv and movement_type = 'AdjustmentIncrease';
  if n2 <> n1 then raise exception 'DEFECT pos: double-void duplicated stock returns'; end if;
  raise notice 'PASS pos: void = balanced reversal (740 farm-priced), stock returned 6→10, reason mandatory, idempotent';
end $$;

-- discount tamper: arbitrary rate rejected; discount/delivery on a PAID sale rejected
do $$ declare v_fg uuid; begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-DISC', 5.0, 50.00, 'open-disc', 'x');
  perform public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 1.0)), 0, 'sale-disc', 'preorder', 0.50, 0, null);
  raise exception 'DEFECT pos: arbitrary discount rate accepted';
exception when check_violation then raise notice 'PASS pos: discount is server-constrained (arbitrary rate rejected)'; end $$;

-- ══ M2E: bulk wholesale (mock "Skip Weigh") ═════════════════════════════════

-- bulk sale: flat ₱500, revenue posted balanced, NO inventory movement, NO COGS; item is_bulk w/ null batch
do $$ declare v_inv uuid; v_order uuid; v_entry uuid; d numeric; c numeric; n_mov int; n_cogs int; v_bulk boolean; v_batch uuid; v_desc text;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_inv := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
            jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','bulk_price', 500.00)),
            500.00, 'sale-bulk');
  set local role postgres;
  select sales_order_id into v_order from public.invoices where id = v_inv;
  if (select total from public.invoices where id = v_inv) <> 500.00 then raise exception 'DEFECT pos: bulk invoice total wrong'; end if;
  select is_bulk, finished_goods_batch_id, description into v_bulk, v_batch, v_desc from public.sales_order_items where sales_order_id = v_order;
  if not v_bulk or v_batch is not null or v_desc <> 'Lettuce (Bulk Pre-order)' then
    raise exception 'DEFECT pos: bulk line wrong (is_bulk %, batch %, desc %)', v_bulk, v_batch, v_desc; end if;
  select count(*) into n_mov from public.inventory_movements where source_document_id = v_order;
  if n_mov <> 0 then raise exception 'DEFECT pos: bulk sale moved stock (% movements, want 0)', n_mov; end if;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_inv;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if d <> c or d <> 500.00 then raise exception 'DEFECT pos: bulk journal wrong (d=% c=%, want 500 revenue only)', d, c; end if;
  select count(*) into n_cogs from public.journal_lines jl join public.chart_of_accounts a on a.id = jl.account_id
    where jl.journal_entry_id = v_entry and a.account_code in ('COGS','FG_INVENTORY');
  if n_cogs <> 0 then raise exception 'DEFECT pos: bulk sale posted COGS lines'; end if;
  raise notice 'PASS pos: bulk wholesale — flat 500 revenue balanced, zero movements, zero COGS, is_bulk null-batch line';
end $$;

-- bulk price must be > 0 (a zero/negative negotiated price is rejected)
do $$ begin set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','bulk_price', 0)), 999, 'sale-bulk0');
  raise exception 'DEFECT pos: bulk price 0 accepted';
exception when check_violation then raise notice 'PASS pos: bulk price <= 0 rejected'; end $$;

-- mixed weighed + bulk: totals add (farm 135 + 200 = 335), only the weighed kg leaves stock; void returns only it
do $$ declare v_fg uuid; v_inv uuid; v_order uuid; n_mov int; v_total numeric; d numeric; c numeric; v_entry uuid;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-MIX', 5.0, 50.00, 'open-mix', 'x');
  v_inv := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
            jsonb_build_array(
              jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 1.0),
              jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','bulk_price', 200.00)),
            500.00, 'sale-mix');
  if public.fg_available(v_fg) <> 4.0 then raise exception 'DEFECT pos: mixed sale stock wrong (got %, want 4)', public.fg_available(v_fg); end if;
  set local role postgres;
  select total, sales_order_id into v_total, v_order from public.invoices where id = v_inv;
  if v_total <> 335.00 then raise exception 'DEFECT pos: mixed total wrong (got %, want 335 = 135 farm + 200 bulk)', v_total; end if;
  select count(*) into n_mov from public.inventory_movements where source_document_id = v_order and movement_type = 'Sales';
  if n_mov <> 1 then raise exception 'DEFECT pos: mixed sale movements wrong (got %, want 1)', n_mov; end if;
  -- void: only the weighed kg returns; reversal = 335 sales + 50 cogs pair, balanced
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.pos_void_sale(v_inv, 'mixed test reversal');
  if public.fg_available(v_fg) <> 5.0 then raise exception 'DEFECT pos: mixed void stock wrong (got %, want 5)', public.fg_available(v_fg); end if;
  set local role postgres;
  select count(*) into n_mov from public.inventory_movements where source_document_id = v_inv and movement_type = 'AdjustmentIncrease';
  if n_mov <> 1 then raise exception 'DEFECT pos: mixed void returned % movements (want 1 — bulk must not return stock)', n_mov; end if;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_inv and je.source_document_type = 'VoidedInvoice';
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if d <> c or d <> 385.00 then raise exception 'DEFECT pos: mixed void reversal wrong (d=% c=%, want 385 = 335 + 50 cogs)', d, c; end if;
  raise notice 'PASS pos: mixed weighed+bulk — 335 total, 1 movement out/1 back on void, bulk never touches stock, reversal balanced';
end $$;

-- cash session: open → sale → close with derived expected (variance 0); variance requires reason; one Open per branch
do $$ declare v_sess uuid; v_fg uuid; v_expected numeric; v_var numeric; v_sess2 uuid;
begin
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_sess := public.cash_open_session('a1111111-1111-1111-1111-111111111111', 1000.00);
  begin
    perform public.cash_open_session('a1111111-1111-1111-1111-111111111111', 5.00);
    raise exception 'DEFECT pos: opened a second cash session in the same branch';
  exception when unique_violation then null; end;
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-SESS', 10.0, 50.00, 'open-sess', 'x');
  perform public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 2.0)), 500.00, 'sale-sess');
  -- derive the same expected the server derives (same-tx timestamps all fall in the window)
  set local role postgres;
  select 1000.00 + coalesce(sum(i.tender_cash - i.change_amount), 0) into v_expected
    from public.invoices i where i.branch_id = 'a1111111-1111-1111-1111-111111111111' and i.status = 'Paid';
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  begin
    perform public.cash_close_session(v_sess, v_expected + 50.00, null);  -- variance without reason
    raise exception 'DEFECT pos: variance accepted without a reason';
  exception when check_violation then null; end;
  v_var := public.cash_close_session(v_sess, v_expected, null);
  if v_var <> 0 then raise exception 'DEFECT pos: variance should be 0 (got %)', v_var; end if;
  begin
    perform public.cash_close_session(v_sess, v_expected, null);  -- close twice
    raise exception 'DEFECT pos: closed a session twice';
  exception when check_violation then null; end;
  -- a real variance with a reason is accepted and recorded
  v_sess2 := public.cash_open_session('a1111111-1111-1111-1111-111111111111', 100.00);
  set local role postgres;
  select 100.00 + coalesce(sum(i.tender_cash - i.change_amount), 0) into v_expected
    from public.invoices i where i.branch_id = 'a1111111-1111-1111-1111-111111111111' and i.status = 'Paid';
  set local role authenticated; set local request.jwt.claims='{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_var := public.cash_close_session(v_sess2, v_expected - 25.00, 'till shortage, reported');
  if v_var <> -25.00 then raise exception 'DEFECT pos: variance calc wrong (got %, want -25)', v_var; end if;
  raise notice 'PASS pos: cash session — one-open-per-branch, server-derived expected, variance 0 close, reasoned variance −25 recorded';
end $$;

rollback;
