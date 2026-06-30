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
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions where permission_key in ('product.manage','inventory.opening','pos.sell');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions where permission_key in ('product.manage','inventory.opening','pos.sell');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000c');
insert into public.products (id, company_id, product_code, name, retail_per_kg) values
  ('ca000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','LETTUCE','Lettuce',150.00),
  ('cb000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','TOMATO-B','B Tomato',120.00);

-- ── HAPPY PATH: open 10kg @ ₱50 cost; sell 2kg @ ₱150; assert balanced GL + stock down + COGS ──
do $$ declare v_fg uuid; v_inv uuid; avail numeric; v_entry uuid; d numeric; c numeric; rev numeric; cogs numeric;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';  -- owner A
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-LET', 10.0, 50.00, 'open-1', 'opening');
  v_inv := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
            jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 2.0)),
            500.00, 'sale-1');
  avail := public.fg_available(v_fg);
  if avail <> 8.0 then raise exception 'DEFECT pos: stock not deducted (got %, want 8)', avail; end if;
  set local role postgres;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_inv;
  if v_entry is null then raise exception 'DEFECT pos: no journal entry posted for the sale'; end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if d <> c then raise exception 'DEFECT pos: journal does not balance (debits % <> credits %)', d, c; end if;
  if d <> 400.00 then raise exception 'DEFECT pos: posting total wrong (got %, want 400 = 300 sales + 100 cogs)', d; end if;
  select jl.credit into rev from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='SALES';
  select jl.debit  into cogs from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='COGS';
  if rev <> 300.00 then raise exception 'DEFECT pos: sales revenue wrong (got %, want 300)', rev; end if;
  if cogs <> 100.00 then raise exception 'DEFECT pos: COGS wrong (got %, want 100)', cogs; end if;
  raise notice 'PASS pos: sale posted balanced GL (Dr Cash 300/Cr Sales 300; Dr COGS 100/Cr FG 100), stock 10->8, COGS recognized';
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

rollback;
