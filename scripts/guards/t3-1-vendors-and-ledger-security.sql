-- Guard battery T3.1 — Vendor master + Cost Schedule + Vendor ledger (AP).
-- Ported verbatim from Repo B (t3-1-vendors-and-ledger-security.sql, 8/8 PASS there) — the
-- underlying T3.1 migration ported clean (no Repo-A-specific compatibility gap), so this guard
-- needed no adaptation, unlike p2n2's.
-- Authority: AGENTS.md §2 (money-path gate) + 22.07 (balances derived, never stored).
-- Coverage:
--   HAPPY1: create vendor -> add cost-schedule row -> record a 2-line vendor invoice
--           (1 stock line -> FG_INVENTORY, 1 utility line -> OPERATING_EXPENSES) ->
--           journal balanced per entry, invoice total correct, AP seeded automatically.
--   HAPPY2: fully settle the invoice -> vendor status -> Paid, paid_amount == total,
--           AP/CASH journal entry balanced per entry.
--   HAPPY3: partial payment on a SECOND invoice -> status Partial, allocation sum ==
--           payment amount, paid_amount < total.
--   HAPPY4: cost_schedule_lookup returns the effective rate + auto-closes the prior
--           active row when a new rate is added.
--   SAD1:   caller without vendor.manage cannot record an invoice (insufficient_privilege).
--   SAD2:   allocations sum != payment amount raises (check_violation).
--   SAD3:   allocation exceeding outstanding balance raises (check_violation).
--   SAD4:   re-record same (company, vendor, invoice_number) returns existing id (idempotent).
-- Plus a non-zero, asymmetric fixture so any sign/swap error surfaces immediately.
-- Pattern: app.p1a_skip_signup_trigger='1' so we manually create public.users rows;
--          per-block reset of role to avoid the P1J 'set local role leaks across DO blocks' gotcha;
--          SECURITY DEFINER calls in the guards MUST run as the target user (set_config jwt),
--          so the inner current_app_user_id() / has_permission() resolve to the right actor.

\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

do $$
declare
  v_company uuid := public.uuidv7();
  v_branch uuid := public.uuidv7();
  v_user_admin uuid := public.uuidv7();
  v_user_clerk uuid := public.uuidv7();
  v_user_employee uuid := public.uuidv7();
  v_role_employee uuid; v_role_admin uuid; v_role_co_owner uuid; v_role_owner uuid;
  v_perm_vendor_read uuid; v_perm_vendor_manage uuid;
  v_perm_inv_read uuid;
  v_product uuid;
  v_vendor uuid; v_vendor2 uuid;
  v_cs_a uuid; v_cs_b uuid;
  v_oe_acct uuid; v_fg_acct uuid; v_ap_acct uuid; v_cash_acct uuid;
  v_invoice_a uuid; v_invoice_b uuid;
  v_actor uuid;
begin
  set local role postgres;
  insert into public.companies (id, company_code, name) values (v_company, 'T31', 'T3.1 Test Co');
  insert into public.branches (id, company_id, branch_code, name) values (v_branch, v_company, 'BR-1', 'Branch 1');
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance, status) values
    (v_company, 'CASH',         'Cash on Hand',             'Asset',    'debit',  'Active'),
    (v_company, 'SALES',        'Sales Revenue',            'Revenue',  'credit', 'Active'),
    (v_company, 'COGS',         'Cost of Goods Sold',       'Expense',  'debit',  'Active'),
    (v_company, 'FG_INVENTORY', 'Finished Goods Inventory', 'Asset',    'debit',  'Active'),
    (v_company, 'AR',           'Accounts Receivable',      'Asset',    'debit',  'Active'),
    (v_company, 'AP',           'Accounts Payable',         'Liability','credit', 'Active'),
    (v_company, 'OPERATING_EXPENSES', 'Operating Expenses',   'Expense',  'debit',  'Active')
  on conflict (company_id, account_code) do nothing;
  select id into v_ap_acct   from public.chart_of_accounts where company_id = v_company and account_code = 'AP';
  select id into v_cash_acct from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  select id into v_oe_acct   from public.chart_of_accounts where company_id = v_company and account_code = 'OPERATING_EXPENSES';
  select id into v_fg_acct   from public.chart_of_accounts where company_id = v_company and account_code = 'FG_INVENTORY';
  insert into auth.users (id, email) values
    (v_user_admin,    'admin.t31@t.local'),
    (v_user_clerk,    'clerk.t31@t.local'),
    (v_user_employee, 'employee.t31@t.local');
  insert into public.users (id, auth_user_id, display_name, account_status) values
    (v_user_admin,    v_user_admin,    'Admin T31',    'Active'),
    (v_user_clerk,    v_user_clerk,    'Clerk T31',    'Active'),
    (v_user_employee, v_user_employee, 'Employee T31', 'Active');
  v_role_employee := public.uuidv7();
  v_role_admin    := public.uuidv7();
  v_role_co_owner := public.uuidv7();
  v_role_owner    := public.uuidv7();
  insert into public.roles (id, company_id, role_key, description, rank) values
    (v_role_employee, v_company, 'employee', 'Employee', 10),
    (v_role_admin,    v_company, 'admin',    'Admin',    30),
    (v_role_co_owner, v_company, 'co_owner', 'Co-owner', 40),
    (v_role_owner,    v_company, 'owner',    'Owner',    50);
  select id into v_perm_vendor_read   from public.permissions where permission_key = 'vendor.read';
  select id into v_perm_vendor_manage from public.permissions where permission_key = 'vendor.manage';
  select id into v_perm_inv_read      from public.permissions where permission_key = 'product.manage';
  insert into public.role_permissions (company_id, role_id, permission_id) values
    (v_company, v_role_admin,    v_perm_vendor_read),
    (v_company, v_role_admin,    v_perm_vendor_manage),
    (v_company, v_role_co_owner, v_perm_vendor_read),
    (v_company, v_role_co_owner, v_perm_vendor_manage),
    (v_company, v_role_owner,    v_perm_vendor_read),
    (v_company, v_role_owner,    v_perm_vendor_manage);
  insert into public.user_branch_roles (user_id, role_id, company_id, branch_id, assignment_status) values
    (v_user_admin,    v_role_admin,    v_company, v_branch, 'Active'),
    (v_user_clerk,    v_role_employee, v_company, v_branch, 'Active'),
    (v_user_employee, v_role_employee, v_company, v_branch, 'Active');
  v_product := public.uuidv7();
  insert into public.products (id, company_id, product_code, name, retail_per_kg, status)
    values (v_product, v_company, 'PROD-T31', 'Pechay', 80, 'Active');
  create temp table t31_world as
    select v_company as company_id, v_branch as branch_id,
           v_user_admin as admin, v_user_clerk as clerk, v_user_employee as employee,
           v_oe_acct as oe_acct, v_fg_acct as fg_acct, v_ap_acct as ap_acct, v_cash_acct as cash_acct,
           v_product as product_id,
           null::uuid as vendor1, null::uuid as cs1, null::uuid as invoice1;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- HAPPY1: admin creates vendor -> adds a cost-schedule row -> records a 2-line
--         invoice (1 stock line, 1 utility line) -> verifies journal + total.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_vendor uuid; v_cs uuid; v_invoice uuid;
        v_total numeric; v_jl_count int; v_jl_sum_debit numeric; v_jl_sum_credit numeric;
        v_status text; v_ap_balance numeric; v_paid numeric;
        v_lines jsonb;
begin
  set local role postgres;
  select * into w from t31_world;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_vendor := public.vendor_upsert(w.company_id, null, 'VEND-001', 'Acme Farms', '0917-555-0101', 'Sitio Uno', 'TIN-001', 'Net 30', 'weekly produce');
  if v_vendor is null then raise exception 'HAPPY1 FAIL: vendor_upsert returned null'; end if;
  v_cs := public.cost_schedule_upsert(w.company_id, null, v_vendor, w.product_id, 22.50, current_date, null, 'opening rate');
  if v_cs is null then raise exception 'HAPPY1 FAIL: cost_schedule_upsert returned null'; end if;
  v_lines := jsonb_build_array(
    jsonb_build_object('product_id', w.product_id, 'description', 'Pechay 5kg', 'quantity', 5, 'unit_cost', 22.50, 'expense_account_id', w.fg_acct, 'cost_schedule_id', v_cs),
    jsonb_build_object('product_id', null, 'description', 'Electricity June', 'quantity', 1, 'unit_cost', 200, 'expense_account_id', w.oe_acct, 'cost_schedule_id', null)
  );
  v_invoice := public.vendor_invoice_record(w.company_id, w.branch_id, v_vendor, 'INV-2026-001', current_date, current_date + 30, v_lines, 'opening batch');
  if v_invoice is null then raise exception 'HAPPY1 FAIL: vendor_invoice_record returned null'; end if;
  set local role postgres;
  select total, status, paid_amount into v_total, v_status, v_paid from public.vendor_invoices where id = v_invoice;
  if v_total <> 312.50 then raise exception 'HAPPY1 FAIL: invoice total expected 312.50 got %', v_total; end if;
  if v_status <> 'Approved' then raise exception 'HAPPY1 FAIL: status expected Approved got %', v_status; end if;
  if v_paid <> 0 then raise exception 'HAPPY1 FAIL: paid_amount expected 0 got %', v_paid; end if;
  select count(*) into v_jl_count from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.source_document_type = 'VendorInvoice' and je.source_document_id = v_invoice;
  if v_jl_count <> 3 then raise exception 'HAPPY1 FAIL: expected 3 journal lines got %', v_jl_count; end if;
  if exists (
    select 1 from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_document_type = 'VendorInvoice' and je.source_document_id = v_invoice
     group by jl.journal_entry_id
    having round(sum(coalesce(jl.debit,0)) - sum(coalesce(jl.credit,0)), 2) <> 0
  ) then
    raise exception 'HAPPY1 FAIL: vendor invoice journal is not balanced per entry';
  end if;
  select outstanding_ap into v_ap_balance from public.vendor_ap_standing(w.company_id, v_vendor);
  if v_ap_balance <> 312.50 then raise exception 'HAPPY1 FAIL: AP standing expected 312.50 got %', v_ap_balance; end if;
  select count(*) into v_jl_count from public.vendor_invoice_lines where vendor_invoice_id = v_invoice;
  if v_jl_count <> 2 then raise exception 'HAPPY1 FAIL: expected 2 invoice lines got %', v_jl_count; end if;
  update t31_world set vendor1 = v_vendor, cs1 = v_cs, invoice1 = v_invoice;
  raise notice 'HAPPY1 PASS: vendor %, invoice % total ₱312.50, journal balanced, AP standing ₱312.50',
    v_vendor, v_invoice;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- HAPPY2: fully settle the invoice (payment = total). Verify status -> Paid,
--         AP journal entry (debit AP, credit CASH) balanced.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_vendor uuid; v_invoice uuid; v_payment uuid;
        v_status text; v_paid numeric; v_jl_count int;
        v_allocations jsonb;
begin
  set local role postgres;
  select * into w from t31_world;
  v_vendor := w.vendor1; v_invoice := w.invoice1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_allocations := jsonb_build_array(jsonb_build_object('vendor_invoice_id', v_invoice, 'amount', 312.50));
  v_payment := public.vendor_payment_record(w.company_id, w.branch_id, v_vendor, current_date, 312.50, v_allocations, 'Bank', 'TXN-0001', 'full settlement');
  if v_payment is null then raise exception 'HAPPY2 FAIL: vendor_payment_record returned null'; end if;
  set local role postgres;
  select status, paid_amount into v_status, v_paid from public.vendor_invoices where id = v_invoice;
  if v_status <> 'Paid' then raise exception 'HAPPY2 FAIL: status expected Paid got %', v_status; end if;
  if v_paid <> 312.50 then raise exception 'HAPPY2 FAIL: paid_amount expected 312.50 got %', v_paid; end if;
  select count(*) into v_jl_count from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.source_document_type = 'VendorPayment' and je.source_document_id = v_payment;
  if v_jl_count <> 2 then raise exception 'HAPPY2 FAIL: expected 2 journal lines for payment got %', v_jl_count; end if;
  if exists (
    select 1 from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
     where je.source_document_type = 'VendorPayment' and je.source_document_id = v_payment
     group by jl.journal_entry_id
    having round(sum(coalesce(jl.debit,0)) - sum(coalesce(jl.credit,0)), 2) <> 0
  ) then
    raise exception 'HAPPY2 FAIL: vendor payment journal is not balanced per entry';
  end if;
  if (select outstanding_ap from public.vendor_ap_standing(w.company_id, v_vendor)) <> 0 then
    raise exception 'HAPPY2 FAIL: AP standing expected 0 after full payment, got %',
      (select outstanding_ap from public.vendor_ap_standing(w.company_id, v_vendor));
  end if;
  raise notice 'HAPPY2 PASS: invoice Paid, journal balanced, AP cleared';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- HAPPY3: create a second vendor + second invoice (₱500). Record a partial
--         payment of ₱200 (allocation < total). Verify status Partial.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_vendor2 uuid; v_invoice2 uuid; v_payment uuid;
        v_status text; v_paid numeric; v_total numeric; v_outstanding numeric;
        v_allocations jsonb;
begin
  set local role postgres;
  select * into w from t31_world;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_vendor2 := public.vendor_upsert(w.company_id, null, 'VEND-002', 'Bayani Seeds', '0917-555-0202', null, null, 'COD', null);
  v_invoice2 := public.vendor_invoice_record(w.company_id, w.branch_id, v_vendor2, 'INV-B-100',
    current_date, current_date,
    jsonb_build_array(jsonb_build_object('product_id', null, 'description', 'Seed tray bulk', 'quantity', 5, 'unit_cost', 100, 'expense_account_id', w.oe_acct, 'cost_schedule_id', null)),
    'partial-pay test');
  v_allocations := jsonb_build_array(jsonb_build_object('vendor_invoice_id', v_invoice2, 'amount', 200));
  v_payment := public.vendor_payment_record(w.company_id, w.branch_id, v_vendor2, current_date, 200, v_allocations);
  set local role postgres;
  select status, paid_amount, total into v_status, v_paid, v_total from public.vendor_invoices where id = v_invoice2;
  if v_status <> 'Partial' then raise exception 'HAPPY3 FAIL: status expected Partial got %', v_status; end if;
  if v_total <> 500 or v_paid <> 200 then
    raise exception 'HAPPY3 FAIL: expected total=500, paid=200 got total=%, paid=%', v_total, v_paid;
  end if;
  v_outstanding := (select outstanding_ap from public.vendor_ap_standing(w.company_id, v_vendor2));
  if v_outstanding <> 300 then raise exception 'HAPPY3 FAIL: AP standing expected 300 got %', v_outstanding; end if;
  raise notice 'HAPPY3 PASS: invoice2 Partial, paid=200, total=500, AP standing 300';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- HAPPY4: cost-schedule lookup + auto-close of prior active row.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_vendor uuid; v_cs_a uuid; v_cs_b uuid; v_lookup numeric; v_lookup_id uuid;
        v_prior_to date;
begin
  set local role postgres;
  select * into w from t31_world;
  v_vendor := w.vendor1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_cs_b := public.cost_schedule_upsert(w.company_id, null, v_vendor, w.product_id, 25.00, current_date + 30, null, 'new rate');
  if v_cs_b is null then raise exception 'HAPPY4 FAIL: cost_schedule_upsert returned null'; end if;
  select effective_to into v_prior_to from public.cost_schedule where id = w.cs1;
  if v_prior_to <> current_date + 30 - 1 then
    raise exception 'HAPPY4 FAIL: prior effective_to expected % got %', current_date + 30 - 1, v_prior_to;
  end if;
  select unit_cost, schedule_id into v_lookup, v_lookup_id from public.cost_schedule_lookup(w.company_id, v_vendor, w.product_id, current_date);
  if v_lookup <> 22.50 or v_lookup_id <> w.cs1 then
    raise exception 'HAPPY4 FAIL: lookup on current_date expected 22.50/cs1 got %/%', v_lookup, v_lookup_id;
  end if;
  select unit_cost, schedule_id into v_lookup, v_lookup_id from public.cost_schedule_lookup(w.company_id, v_vendor, w.product_id, current_date + 60);
  if v_lookup <> 25.00 or v_lookup_id <> v_cs_b then
    raise exception 'HAPPY4 FAIL: lookup on current_date+60 expected 25.00/cs_b got %/%', v_lookup, v_lookup_id;
  end if;
  raise notice 'HAPPY4 PASS: cost-schedule auto-closed prior, lookup returns correct effective rate';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- HAPPY5 (2026-07-19 addition, not in Repo B's original 8): a company that has NEVER run a
-- sale/purchase — so chart_of_accounts is genuinely empty, not hand-seeded like t31_world above.
-- The client must resolve an expense_account_id BEFORE calling vendor_invoice_record (it's a picked
-- uuid, not a code), so the client calls inventory_ensure_accounts itself first — this assertion
-- mirrors that exact contract, then proves vendor_invoice_record/vendor_payment_record ALSO
-- self-heal the AP/CASH side of the seed (inventory_ensure_accounts perform, added alongside the
-- existing vendor_ensure_accounts perform) so a second caller who skips the client's own ensure-call
-- doesn't hit "AP / CASH accounts missing". Caught live: VendorsScreen's invoice dialog queried
-- chart_of_accounts for its dropdown before anything had ever seeded it, so every code resolved to
-- undefined and the RPC was never even reached.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_company uuid := public.uuidv7();
  v_branch uuid := public.uuidv7();
  v_owner uuid := public.uuidv7();
  v_role_owner uuid;
  v_vendor uuid; v_invoice uuid; v_payment uuid;
  v_oe_acct uuid; v_cash_acct uuid; v_total numeric; v_status text; v_ap_balance numeric;
begin
  set local role postgres;
  insert into public.companies (id, company_code, name) values (v_company, 'T31COLD', 'Cold Start Co');
  insert into public.branches (id, company_id, branch_code, name) values (v_branch, v_company, 'BR-1', 'Branch 1');
  -- deliberately NO chart_of_accounts insert here — this is the point of the assertion.
  insert into auth.users (id, email) values (v_owner, 'owner.t31cold@t.local');
  insert into public.users (id, auth_user_id, display_name, account_status) values (v_owner, v_owner, 'Owner ColdStart', 'Active');
  v_role_owner := public.uuidv7();
  insert into public.roles (id, company_id, role_key, description, rank) values (v_role_owner, v_company, 'owner', 'Owner', 50);
  insert into public.role_permissions (company_id, role_id, permission_id)
    select v_company, v_role_owner, id from public.permissions where permission_key in ('vendor.read', 'vendor.manage');
  insert into public.user_branch_roles (user_id, role_id, company_id, branch_id, assignment_status)
    values (v_owner, v_role_owner, v_company, v_branch, 'Active');
  if exists (select 1 from public.chart_of_accounts where company_id = v_company) then
    raise exception 'HAPPY5 SETUP FAIL: chart_of_accounts unexpectedly non-empty before the RPC calls';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_vendor := public.vendor_upsert(v_company, null, 'VEND-COLD', 'Cold Start Supplier', null, null, null, null, null);
  if v_vendor is null then raise exception 'HAPPY5 FAIL: vendor_upsert returned null'; end if;
  -- Mirrors VendorsScreen's InvoiceDialog: the client must resolve a real expense_account_id before
  -- it can call vendor_invoice_record (it's a picked uuid, not a code), so it seeds the chart first.
  perform public.inventory_ensure_accounts(v_company);
  select id into v_oe_acct from public.chart_of_accounts where company_id = v_company and account_code = 'OPERATING_EXPENSES';
  if v_oe_acct is null then raise exception 'HAPPY5 FAIL: OPERATING_EXPENSES was not seeded by inventory_ensure_accounts'; end if;
  v_invoice := public.vendor_invoice_record(v_company, v_branch, v_vendor, 'INV-COLD-001', current_date, current_date + 30,
    jsonb_build_array(jsonb_build_object('product_id', null, 'description', 'Cold-start bill', 'quantity', 1, 'unit_cost', 400, 'expense_account_id', v_oe_acct, 'cost_schedule_id', null)),
    'cold start invoice');
  if v_invoice is null then raise exception 'HAPPY5 FAIL: vendor_invoice_record returned null on a chart-of-accounts-less company'; end if;
  set local role postgres;
  select total, status into v_total, v_status from public.vendor_invoices where id = v_invoice;
  if v_total <> 400 then raise exception 'HAPPY5 FAIL: invoice total expected 400 got %', v_total; end if;
  select id into v_cash_acct from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  if v_cash_acct is null then raise exception 'HAPPY5 FAIL: CASH was not seeded before payment recording'; end if;
  set local role authenticated;
  v_payment := public.vendor_payment_record(v_company, v_branch, v_vendor, current_date, 400,
    jsonb_build_array(jsonb_build_object('vendor_invoice_id', v_invoice, 'amount', 400)));
  if v_payment is null then raise exception 'HAPPY5 FAIL: vendor_payment_record returned null on a chart-of-accounts-less company'; end if;
  set local role postgres;
  v_ap_balance := (select outstanding_ap from public.vendor_ap_standing(v_company, v_vendor));
  if v_ap_balance <> 0 then raise exception 'HAPPY5 FAIL: AP standing expected 0 after full payment, got %', v_ap_balance; end if;
  raise notice 'HAPPY5 PASS: cold-start company (empty chart_of_accounts) self-seeded and recorded+settled a ₱400 vendor invoice';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SAD1: caller without vendor.manage cannot record an invoice (insufficient_privilege).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record;
begin
  set local role postgres;
  select * into w from t31_world;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.employee::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.vendor_invoice_record(w.company_id, w.branch_id, w.vendor1, 'INV-SAD1',
      current_date, current_date,
      jsonb_build_array(jsonb_build_object('product_id', null, 'description', 'x', 'quantity', 1, 'unit_cost', 1, 'expense_account_id', w.oe_acct, 'cost_schedule_id', null)));
    raise exception 'SAD1 FAIL: vendor_invoice_record succeeded for a user with no vendor.manage';
  exception when insufficient_privilege then
    raise notice 'SAD1 PASS: vendor.manage gate held (insufficient_privilege)';
  end;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SAD2: allocations sum != payment amount raises (check_violation).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_vendor2 uuid; v_invoice2 uuid;
begin
  set local role postgres;
  select * into w from t31_world;
  v_vendor2 := (select id from public.vendors where company_id = w.company_id and vendor_code = 'VEND-002');
  v_invoice2 := (select id from public.vendor_invoices where company_id = w.company_id and invoice_number = 'INV-B-100');
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.vendor_payment_record(w.company_id, w.branch_id, v_vendor2, current_date, 200,
      jsonb_build_array(jsonb_build_object('vendor_invoice_id', v_invoice2, 'amount', 199)));
    raise exception 'SAD2 FAIL: mismatched allocation sum succeeded';
  exception when check_violation then
    raise notice 'SAD2 PASS: allocations-sum-mismatch check held (check_violation)';
  end;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SAD3: allocation exceeding outstanding balance raises (check_violation).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_vendor2 uuid; v_invoice2 uuid; v_outstanding numeric;
begin
  set local role postgres;
  select * into w from t31_world;
  v_vendor2 := (select id from public.vendors where company_id = w.company_id and vendor_code = 'VEND-002');
  v_invoice2 := (select id from public.vendor_invoices where company_id = w.company_id and invoice_number = 'INV-B-100');
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.vendor_payment_record(w.company_id, w.branch_id, v_vendor2, current_date, 500,
      jsonb_build_array(jsonb_build_object('vendor_invoice_id', v_invoice2, 'amount', 500)));
    raise exception 'SAD3 FAIL: over-allocation succeeded';
  exception when check_violation then
    raise notice 'SAD3 PASS: over-allocation check held (check_violation)';
  end;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- SAD4: re-record same (company, vendor, invoice_number) returns existing id (idempotent).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare w record; v_vendor uuid; v_invoice_a uuid; v_invoice_b uuid;
        v_count int; v_total numeric;
begin
  set local role postgres;
  select * into w from t31_world;
  v_vendor := w.vendor1;
  v_invoice_a := w.invoice1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', w.admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_invoice_b := public.vendor_invoice_record(w.company_id, w.branch_id, v_vendor, 'INV-2026-001', current_date, current_date + 30,
    jsonb_build_array(jsonb_build_object('product_id', null, 'description', 'dup', 'quantity', 1, 'unit_cost', 999, 'expense_account_id', w.oe_acct, 'cost_schedule_id', null)));
  set local role postgres;
  if v_invoice_b <> v_invoice_a then
    raise exception 'SAD4 FAIL: re-record returned a NEW id (%) instead of the original (%)', v_invoice_b, v_invoice_a;
  end if;
  select count(*) into v_count from public.vendor_invoices where company_id = w.company_id and vendor_id = v_vendor and invoice_number = 'INV-2026-001';
  if v_count <> 1 then raise exception 'SAD4 FAIL: expected exactly 1 row, got %', v_count; end if;
  select total into v_total from public.vendor_invoices where id = v_invoice_a;
  if v_total <> 312.50 then raise exception 'SAD4 FAIL: total changed on re-record: %', v_total; end if;
  raise notice 'SAD4 PASS: idempotent re-record returns existing id, total unchanged';
end $$;

rollback;
