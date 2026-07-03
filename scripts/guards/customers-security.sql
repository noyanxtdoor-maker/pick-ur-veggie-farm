-- Tier-2 BEHAVIORAL Customers & Credit security test (Phase 2 M9A / B1) — blocking gate.
-- Proves: customer master writes are customer.manage-gated and tenant-isolated; invoice→customer attribution is
-- pos.sell-gated, cross-tenant safe, and posts NO journal (not a money mutation); customer_ar_standing derives
-- outstanding AR from unpaid invoices and available credit = limit − outstanding, behind customer.read. Runs as
-- authenticated owners/workers with simulated JWT. Self-contained BEGIN/ROLLBACK; any DEFECT raises under ON_ERROR_STOP.
\set ON_ERROR_STOP on
begin;

-- ── fixtures ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-00000000000a','authenticated','authenticated','ownerA@t.local'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-00000000000b','authenticated','authenticated','ownerB@t.local'),
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-00000000000c','authenticated','authenticated','workerA@t.local');
insert into public.users (id, auth_user_id, display_name) values
  ('10000000-0000-0000-0000-00000000000a','0a000000-0000-0000-0000-00000000000a','Owner A'),
  ('10000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b','Owner B'),
  ('10000000-0000-0000-0000-00000000000c','0c000000-0000-0000-0000-00000000000c','Worker A');
insert into public.companies (id, company_code, name) values
  ('11111111-1111-1111-1111-111111111111','CO-A','Company A'),
  ('22222222-2222-2222-2222-222222222222','CO-B','Company B');
insert into public.branches (id, company_id, branch_code, name) values
  ('a1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','BR-A1','Branch A1'),
  ('b1111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','BR-B1','Branch B1');
insert into public.roles (id, company_id, role_key, description) values
  ('20000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','Owner A'),
  ('20000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','owner','Owner B'),
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker (no customer perms)');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions
  where permission_key in ('customer.read','customer.manage','pos.sell','inventory.opening','product.manage');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions
  where permission_key in ('customer.read','customer.manage','pos.sell','inventory.opening','product.manage');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000c', id from public.permissions
  where permission_key in ('pos.sell');  -- worker can sell but has NO customer.read/manage
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000c');
insert into public.products (id, company_id, product_code, name, retail_per_kg) values
  ('ca000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','LETTUCE','Lettuce',150.00);

-- HAPPY: create a customer with a credit limit (customer.manage)
do $$ declare v_cust uuid; v_lim numeric;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_cust := public.customer_upsert('11111111-1111-1111-1111-111111111111', null, 'Aling Nena Store', '0917-000', 5000.00, 'weekly buyer');
  set local role postgres;
  select credit_limit into v_lim from public.customers where id = v_cust;
  if v_lim <> 5000.00 then raise exception 'DEFECT cust: credit limit not saved (got %)', v_lim; end if;
  raise notice 'PASS cust: customer created with credit limit 5000';
end $$;

-- GATE: a worker without customer.manage cannot create a customer
do $$ declare v_denied boolean := false;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  begin perform public.customer_upsert('11111111-1111-1111-1111-111111111111', null, 'Sneaky', null, null, null);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT cust: worker without customer.manage created a customer'; end if;
  raise notice 'PASS cust: customer.manage gate enforced';
end $$;

-- ISOLATION: owner B cannot create a customer in company A, nor read company A standing
do $$ declare d1 boolean := false; d2 boolean := false;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0b000000-0000-0000-0000-00000000000b"}';
  begin perform public.customer_upsert('11111111-1111-1111-1111-111111111111', null, 'X', null, null, null);
  exception when insufficient_privilege then d1 := true; end;
  begin perform * from public.customer_ar_standing('11111111-1111-1111-1111-111111111111');
  exception when insufficient_privilege then d2 := true; end;
  if not (d1 and d2) then raise exception 'DEFECT cust: cross-tenant customer write/read not denied (write=% read=%)', d1, d2; end if;
  raise notice 'PASS cust: cross-tenant customer write + standing read denied';
end $$;

-- HAPPY: credit sale → Unpaid invoice; attribute it to the customer; standing reflects it; NO journal from the tag
do $$ declare v_cust uuid; v_fg uuid; v_inv uuid; v_out numeric; v_avail numeric; v_j_before int; v_j_after int; v_tagged uuid;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select id into v_cust from public.customers where company_id = '11111111-1111-1111-1111-111111111111' and name = 'Aling Nena Store';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-CUST', 10.0, 50.00, 'cust-open', 'opening');
  -- preorder = credit sale → Unpaid AR invoice
  v_inv := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 2.0)),
    0, 'cust-sale', 'preorder');
  set local role postgres;
  select count(*) into v_j_before from public.journal_entries where company_id = '11111111-1111-1111-1111-111111111111';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.pos_assign_invoice_customer(v_inv, v_cust);
  set local role postgres;
  select customer_id into v_tagged from public.invoices where id = v_inv;
  if v_tagged <> v_cust then raise exception 'DEFECT cust: invoice not tagged with the customer'; end if;
  select count(*) into v_j_after from public.journal_entries where company_id = '11111111-1111-1111-1111-111111111111';
  if v_j_after <> v_j_before then raise exception 'DEFECT cust: attribution posted a journal (% -> %) — must NOT be a money mutation', v_j_before, v_j_after; end if;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select outstanding_ar, available_credit into v_out, v_avail from public.customer_ar_standing('11111111-1111-1111-1111-111111111111') where customer_id = v_cust;
  if v_out <= 0 then raise exception 'DEFECT cust: outstanding AR not derived from the unpaid invoice (got %)', v_out; end if;
  if round(v_avail - (5000.00 - v_out), 2) <> 0 then raise exception 'DEFECT cust: available credit wrong (avail=% out=%)', v_avail, v_out; end if;
  raise notice 'PASS cust: credit sale attributed; standing outstanding=% available=% (no journal from the tag)', v_out, v_avail;
end $$;

-- ISOLATION: cannot attribute a foreign-company customer to company A's invoice
do $$ declare v_inv uuid; v_bcust uuid; v_denied boolean := false;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0b000000-0000-0000-0000-00000000000b"}';
  v_bcust := public.customer_upsert('22222222-2222-2222-2222-222222222222', null, 'Company B Buyer', null, null, null);
  set local role postgres;
  select id into v_inv from public.invoices where company_id = '11111111-1111-1111-1111-111111111111' limit 1;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  begin perform public.pos_assign_invoice_customer(v_inv, v_bcust);
  exception when foreign_key_violation then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT cust: attributed a foreign-company customer to this invoice'; end if;
  raise notice 'PASS cust: cross-tenant invoice attribution denied';
end $$;

-- GATE: worker without customer.read cannot read standing
do $$ declare v_denied boolean := false;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  begin perform * from public.customer_ar_standing('11111111-1111-1111-1111-111111111111');
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT cust: worker without customer.read read AR standing'; end if;
  raise notice 'PASS cust: customer.read gate enforced';
end $$;

rollback;
