-- Guard battery T3.2 — Purchase <-> Vendor link.
-- Ported verbatim from Repo B (t3-2-purchase-vendor-link-security.sql, 7/7 PASS there) — the
-- underlying T3.2 migration ported clean (confirmed fully compatible with Repo A's current
-- inventory_record_purchase), so this guard needed no adaptation.
-- Authority: AGENTS.md §2 (additive money-adjacent: no new GL path, just a non-money FK on
--            purchase_receivings + a CHECK constraint extension on source_type).
-- Coverage:
--   HAPPY1: admin records a Buy Stock with source_type='vendor' + a registered Active vendor ->
--           source_name + source_contact are snapshotted from the vendor master, vendor_id is set
--           on the receiving row.
--   HAPPY2: source_type='vendor' WITHOUT a vendor_id (typed-in supplier). Function still works,
--           vendor_id is NULL, source_name falls back to the caller's value.
--   HAPPY3: source_type='online' WITH a vendor_id (mismatch). Function raises check_violation.
--   SAD1:   vendor_id pointing to a vendor in a different company -> foreign_key_violation.
--   SAD2:   vendor_id pointing to an Archived vendor -> check_violation.
--   SAD3:   CHECK constraint denies unknown source_type values at the table level.
--   SAD4:   Existing 11-arg call (no vendor_id arg) still resolves (backward compat).
-- Plus the standard non-zero, asymmetric fixtures so any sign/swap error surfaces immediately.

\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

do $$
declare
  v_company uuid := public.uuidv7();
  v_company2 uuid := public.uuidv7();
  v_branch uuid := public.uuidv7();
  v_branch2 uuid := public.uuidv7();
  v_user_admin uuid := public.uuidv7();
  v_perm_purchase uuid;
  v_role_admin uuid; v_role_owner uuid;
  v_item uuid; v_vendor uuid; v_vendor_other uuid;
begin
  set local role postgres;
  insert into public.companies (id, company_code, name) values
    (v_company, 'T32', 'T3.2 Test Co'),
    (v_company2, 'T32X', 'T3.2 Other Co');
  insert into public.branches (id, company_id, branch_code, name) values
    (v_branch,  v_company,  'BR-1', 'Branch 1'),
    (v_branch2, v_company2, 'BR-X', 'Branch X');
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance, status) values
    (v_company, 'CASH',     'Cash on Hand', 'Asset',    'debit',  'Active'),
    (v_company, 'EQUIPMENT','Equipment',    'Asset',    'debit',  'Active'),
    (v_company, 'RAW_MATERIALS', 'Raw Materials', 'Asset','debit',  'Active'),
    (v_company, 'OPERATING_EXPENSES', 'Operating Expenses', 'Expense', 'debit', 'Active'),
    (v_company, 'AP', 'Accounts Payable', 'Liability', 'credit', 'Active')
  on conflict (company_id, account_code) do nothing;
  insert into auth.users (id, email) values (v_user_admin, 'admin.t32@t.local');
  insert into public.users (id, auth_user_id, display_name, account_status) values
    (v_user_admin, v_user_admin, 'Admin T32', 'Active');
  v_role_admin := public.uuidv7();
  v_role_owner := public.uuidv7();
  insert into public.roles (id, company_id, role_key, description, rank) values
    (v_role_admin, v_company, 'admin', 'Admin', 30),
    (v_role_owner, v_company, 'owner', 'Owner', 50);
  select id into v_perm_purchase from public.permissions where permission_key = 'inventory.purchase';
  insert into public.role_permissions (company_id, role_id, permission_id) values
    (v_company, v_role_admin, v_perm_purchase),
    (v_company, v_role_owner, v_perm_purchase);
  insert into public.user_branch_roles (user_id, role_id, company_id, branch_id, assignment_status) values
    (v_user_admin, v_role_admin, v_company, v_branch, 'Active');
  v_vendor := public.uuidv7();
  v_vendor_other := public.uuidv7();
  insert into public.vendors (id, company_id, vendor_code, name, contact, status) values
    (v_vendor, v_company, 'VEND-001', 'Acme Farms', '0917-555-0001', 'Active'),
    (v_vendor_other, v_company2, 'VEND-OTHER', 'Foreign Vendor', null, 'Active');
  v_item := public.uuidv7();
  insert into public.inventory_items (id, company_id, category_id, item_code, name, inventory_type)
    select v_item, v_company, c.id, 'ITEM-T32', 'Calcium Nitrate', 'Consumable'
    from public.item_categories c where c.company_id = v_company and c.category_key = 'substrate';
  create temp table t32_world as
    select v_company as company_id, v_branch as branch_id, v_company2 as company2_id, v_branch2 as branch2_id,
           v_user_admin as admin, v_vendor as vendor_active, v_vendor_other as vendor_other;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- HAPPY1: source_type='vendor' + an Active vendor id -> source_name + source_contact snapshotted
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_recv uuid; v_source_name text; v_source_contact text; v_vendor_id uuid;
begin
  set local role postgres;
  select * into w from t32_world;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_recv := public.inventory_record_purchase(
    w.branch_id, 'substrate', 'Calcium Nitrate', false, 10, 800.00,
    'vendor', '', '', current_date, 't32-idem-happy1', w.vendor_active);
  set local role postgres;
  select source_name, source_contact, vendor_id into v_source_name, v_source_contact, v_vendor_id
    from public.purchase_receivings where id = v_recv;
  if v_source_name <> 'Acme Farms' then
    raise exception 'HAPPY1 FAIL: source_name expected "Acme Farms" got "%"', v_source_name;
  end if;
  if v_source_contact <> '0917-555-0001' then
    raise exception 'HAPPY1 FAIL: source_contact expected "0917-555-0001" got "%"', v_source_contact;
  end if;
  if v_vendor_id <> w.vendor_active then
    raise exception 'HAPPY1 FAIL: vendor_id mismatch';
  end if;
  raise notice 'HAPPY1 PASS: vendor receiving snapshotted source_name + source_contact, vendor_id set';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- HAPPY2: source_type='vendor' WITHOUT a vendor_id (typed-in supplier) -> still works
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_recv uuid; v_source_name text; v_vendor_id uuid;
begin
  set local role postgres;
  select * into w from t32_world;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_recv := public.inventory_record_purchase(
    w.branch_id, 'utilities', 'Vermicast Delivery', false, 5, 200.00,
    'vendor', 'Walk-in Supplier at Quiapo', '0917-555-9999', current_date, 't32-idem-happy2', null);
  set local role postgres;
  select source_name, vendor_id into v_source_name, v_vendor_id
    from public.purchase_receivings where id = v_recv;
  if v_source_name <> 'Walk-in Supplier at Quiapo' then
    raise exception 'HAPPY2 FAIL: typed-in source_name lost: got "%"', v_source_name;
  end if;
  if v_vendor_id is not null then
    raise exception 'HAPPY2 FAIL: vendor_id should be null when caller did not provide one';
  end if;
  raise notice 'HAPPY2 PASS: typed-in supplier preserved when vendor_id omitted';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- HAPPY3: source_type='online' WITH a vendor_id (mismatch) -> check_violation
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record;
begin
  set local role postgres;
  select * into w from t32_world;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.inventory_record_purchase(
      w.branch_id, 'substrate', 'Coco Coir', false, 1, 50.00,
      'online', 'Lazada', null, current_date, 't32-idem-happy3', w.vendor_active);
    raise exception 'HAPPY3 FAIL: online+vendor_id succeeded';
  exception when check_violation then
    raise notice 'HAPPY3 PASS: vendor_id + source_type mismatch held (check_violation)';
  end;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SAD1: vendor_id in a different company -> foreign_key_violation
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record;
begin
  set local role postgres;
  select * into w from t32_world;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.inventory_record_purchase(
      w.branch_id, 'substrate', 'Cross-co attempt', false, 1, 50.00,
      'vendor', '', '', current_date, 't32-idem-sad1', w.vendor_other);
    raise exception 'SAD1 FAIL: cross-company vendor_id succeeded';
  exception when foreign_key_violation then
    raise notice 'SAD1 PASS: cross-company vendor_id rejected (foreign_key_violation)';
  end;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SAD2: Archived vendor -> check_violation
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_archived uuid;
begin
  set local role postgres;
  select * into w from t32_world;
  update public.vendors set status = 'Archived' where id = w.vendor_active returning id into v_archived;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.inventory_record_purchase(
      w.branch_id, 'substrate', 'Try archived', false, 1, 50.00,
      'vendor', '', '', current_date, 't32-idem-sad2', v_archived);
    raise exception 'SAD2 FAIL: archived vendor_id succeeded';
  exception when check_violation then
    raise notice 'SAD2 PASS: archived vendor rejected (check_violation)';
  end;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SAD3: CHECK constraint on purchase_receivings.source_type denies 'unknown'
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_item uuid;
begin
  set local role postgres;
  select * into w from t32_world;
  select id into v_item from public.inventory_items where company_id = w.company_id limit 1;
  begin
    insert into public.purchase_receivings (company_id, branch_id, item_id, quantity, total_amount, source_type, source_name, source_contact, received_date, received_by, idempotency_key)
      values (w.company_id, w.branch_id, v_item, 1, 1, 'unknown', 'x', null, current_date, w.admin, 't32-idem-sad3');
    raise exception 'SAD3 FAIL: unknown source_type accepted at table level';
  exception when check_violation then
    raise notice 'SAD3 PASS: CHECK constraint denied unknown source_type (check_violation)';
  end;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SAD4: backward compat — 11-arg call (no vendor_id) still resolves and works
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_recv uuid;
begin
  set local role postgres;
  select * into w from t32_world;
  update public.vendors set status = 'Active' where id = w.vendor_active;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_recv := public.inventory_record_purchase(
    w.branch_id, 'transport', 'Backward-compat call', false, 1, 10.00,
    'physical', 'Some Shop', '0917-555-0000', current_date, 't32-idem-sad4');
  set local role postgres;
  if v_recv is null then raise exception 'SAD4 FAIL: 11-arg call did not return a receiving id'; end if;
  raise notice 'SAD4 PASS: 11-arg call (no vendor_id) still resolves identically';
end $$;

rollback;
