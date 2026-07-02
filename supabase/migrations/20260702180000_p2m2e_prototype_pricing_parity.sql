-- Migration P2-M2E — POS Prototype-Logic Parity (Phase 2, Module 2E)
-- Authority: owner decision 2026-07-02 ("fully follow the logic of the google ai mock app; architecture still
--   considered") + Phase_2_M2E_Prototype_Parity_Spec.md + src/lib/money.ts (DISCOUNT=0.10) + src/features/POS.tsx.
-- What changes: (1) the CHARGED price for weighed produce becomes the FARM price = round(retail × 0.90, 2) —
--   server-computed, clients still send no prices; retail is snapshotted per line so "farm discount saved" is a
--   derived fact, not client math. (2) Bulk wholesale lines (mock "Skip Weigh"): cashier-negotiated flat price,
--   is_bulk, NO inventory movement / NO COGS (no weight exists to move; stock is corrected later via
--   inventory.adjust — deviation recorded in the spec §3). (3) pos_void_sale skips null-batch (bulk) lines.
-- Pattern: ADDITIVE ONLY — locked M2B/M2C files untouched; functions evolved via drop+recreate (M2C pattern).
-- Risk: High (changes revenue amounts). All financial writes remain function-only, append-only, balanced.

-- ── Additive columns on sales_order_items (retail snapshot + bulk support) ──
alter table public.sales_order_items add column retail_unit_price numeric(12, 2) check (retail_unit_price >= 0);
alter table public.sales_order_items add column is_bulk boolean not null default false;
alter table public.sales_order_items add column description text;
-- bulk lines have no finished-goods batch (mock: weightKg null → nothing to deduct)
alter table public.sales_order_items alter column finished_goods_batch_id drop not null;
comment on column public.sales_order_items.retail_unit_price is 'P2-M2E: prevailing retail ₱/kg snapshot at sale time (farm price charged = retail × 0.90); null for bulk lines.';
comment on column public.sales_order_items.is_bulk is 'P2-M2E: mock "Skip Weigh" bulk wholesale line — flat negotiated price, no movement/COGS.';

-- ════════════════════════════════════════════════════════════════════════════
-- pos_record_sale — recreated: farm pricing + bulk lines. Same signature (callers unaffected).
--   Weighed line:  {product_id, finished_goods_batch_id, weight_kg}  → charged round(retail×0.90,2)/kg (SERVER).
--   Bulk line:     {product_id, bulk_price}                          → flat revenue, no movement, no COGS.
--   Pre-order: server-applied 10% discount on the (farm-priced) subtotal + delivery fee (stacks — mock formula).
-- ════════════════════════════════════════════════════════════════════════════
drop function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text);
create function public.pos_record_sale(
  p_branch_id uuid, p_lines jsonb, p_tender_cash numeric, p_idempotency_key text,
  p_sale_kind text default 'paid', p_discount_rate numeric default 0,
  p_delivery_fee numeric default 0, p_customer_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_line jsonb;
  v_pid uuid; v_fg uuid; v_qty numeric; v_retail numeric; v_farm numeric; v_cost numeric;
  v_bulk numeric; v_pname text;
  v_subtotal numeric := 0; v_cogs numeric := 0; v_discount numeric; v_total numeric;
  v_order uuid; v_invoice uuid; v_entry uuid;
  a_cash uuid; a_sales uuid; a_cogs uuid; a_fg uuid; a_ar uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'pos.sell') then raise exception 'permission denied: pos.sell' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_sale_kind not in ('paid', 'preorder') then raise exception 'invalid sale kind' using errcode = 'check_violation'; end if;
  if p_discount_rate not in (0, 0.10) then raise exception 'invalid discount rate' using errcode = 'check_violation'; end if;
  if p_sale_kind = 'paid' and (p_discount_rate <> 0 or coalesce(p_delivery_fee, 0) <> 0) then
    raise exception 'discount/delivery apply to pre-orders only' using errcode = 'check_violation';
  end if;
  if coalesce(p_delivery_fee, 0) < 0 then raise exception 'delivery fee must be >= 0' using errcode = 'check_violation'; end if;

  select i.id into v_existing from public.sales_orders so join public.invoices i on i.sales_order_id = so.id
    where so.company_id = v_company and so.idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'empty sale' using errcode = 'check_violation'; end if;
  perform public.pos_ensure_accounts(v_company);

  v_order := public.uuidv7();
  insert into public.sales_orders (id, company_id, branch_id, order_number, sales_channel, status, subtotal, total_amount, idempotency_key, created_by, customer_note)
    values (v_order, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'order'), 'Farm Gate', 'Completed', 0, 0, p_idempotency_key, v_actor, p_customer_note);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pid := (v_line ->> 'product_id')::uuid;
    -- product must exist in this company for BOTH line kinds (name/price authority)
    select pr.retail_per_kg, pr.name into v_retail, v_pname
      from public.products pr where pr.id = v_pid and pr.company_id = v_company and pr.status = 'Active';
    if v_retail is null then raise exception 'unknown/inactive product' using errcode = 'foreign_key_violation'; end if;

    if v_line ? 'bulk_price' then
      -- Bulk wholesale (mock "Skip Weigh"): negotiated flat price; no weight → no movement, no COGS (spec §3).
      v_bulk := (v_line ->> 'bulk_price')::numeric;
      if v_bulk is null or v_bulk <= 0 then raise exception 'bulk price must be > 0' using errcode = 'check_violation'; end if;
      insert into public.sales_order_items (company_id, sales_order_id, product_id, finished_goods_batch_id, quantity, unit_price, line_total, unit_cost, retail_unit_price, is_bulk, description)
        values (v_company, v_order, v_pid, null, 1, round(v_bulk, 2), round(v_bulk, 2), 0, null, true, v_pname || ' (Bulk Pre-order)');
      v_subtotal := v_subtotal + round(v_bulk, 2);
    else
      -- Weighed produce: SERVER computes the farm price (retail × 0.90) — the mock's DISCOUNT=0.10, B2 rounding.
      v_fg  := (v_line ->> 'finished_goods_batch_id')::uuid;
      v_qty := (v_line ->> 'weight_kg')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception 'weight must be > 0' using errcode = 'check_violation'; end if;
      v_farm := round(v_retail * 0.90, 2);
      select fg.cost_per_unit into v_cost from public.finished_goods_batches fg where fg.id = v_fg and fg.company_id = v_company;
      if v_cost is null then raise exception 'unknown finished-goods batch' using errcode = 'foreign_key_violation'; end if;
      if public.fg_available(v_fg) < v_qty then raise exception 'insufficient stock for batch %', v_fg using errcode = 'check_violation'; end if;
      insert into public.sales_order_items (company_id, sales_order_id, product_id, finished_goods_batch_id, quantity, unit_price, line_total, unit_cost, retail_unit_price, is_bulk)
        values (v_company, v_order, v_pid, v_fg, v_qty, v_farm, round(v_qty * v_farm, 2), v_cost, v_retail, false);
      insert into public.inventory_movements (company_id, branch_id, finished_goods_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, actor_user_id)
        values (v_company, p_branch_id, v_fg, 'Sales', v_qty, v_cost, round(v_qty * v_cost, 2), 'SalesInvoice', v_order, v_actor);
      v_subtotal := v_subtotal + round(v_qty * v_farm, 2);
      v_cogs := v_cogs + round(v_qty * v_cost, 2);
    end if;
  end loop;

  v_discount := round(v_subtotal * p_discount_rate, 2);
  v_total := round(v_subtotal - v_discount + coalesce(p_delivery_fee, 0), 2);
  if p_sale_kind = 'paid' and (p_tender_cash is null or p_tender_cash < v_total) then
    raise exception 'insufficient cash tendered' using errcode = 'check_violation';
  end if;

  update public.sales_orders set subtotal = v_subtotal, discount = v_discount, delivery_fee = coalesce(p_delivery_fee, 0), total_amount = v_total where id = v_order;
  v_invoice := public.uuidv7();
  insert into public.invoices (id, company_id, branch_id, sales_order_id, invoice_number, invoice_type, total, tender_cash, change_amount, status, created_by, paid_at)
    values (v_invoice, v_company, p_branch_id, v_order, public.pos_next_seq(v_company, p_branch_id, 'invoice'),
            case when p_sale_kind = 'paid' then 'cash' else 'credit' end, v_total,
            case when p_sale_kind = 'paid' then p_tender_cash else 0 end,
            case when p_sale_kind = 'paid' then round(p_tender_cash - v_total, 2) else 0 end,
            case when p_sale_kind = 'paid' then 'Paid' else 'Unpaid' end, v_actor,
            case when p_sale_kind = 'paid' then now() else null end);

  select id into a_cash  from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  select id into a_sales from public.chart_of_accounts where company_id = v_company and account_code = 'SALES';
  select id into a_cogs  from public.chart_of_accounts where company_id = v_company and account_code = 'COGS';
  select id into a_fg    from public.chart_of_accounts where company_id = v_company and account_code = 'FG_INVENTORY';
  select id into a_ar    from public.chart_of_accounts where company_id = v_company and account_code = 'AR';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'SalesInvoice', v_invoice,
            case when p_sale_kind = 'paid' then 'POS sale' else 'POS pre-order (credit)' end, v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, case when p_sale_kind = 'paid' then a_cash else a_ar end, v_total, 0),
    (v_company, v_entry, a_sales, 0, v_total);
  if v_cogs > 0 then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_cogs, v_cogs, 0),
      (v_company, v_entry, a_fg,   0, v_cogs);
  end if;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Business',
            case when p_sale_kind = 'paid' then 'pos.sale_recorded' else 'pos.preorder_recorded' end, 'pos', 'invoices', v_invoice);
  return v_invoice;
end; $$;
comment on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text) is 'P2-M2E: prototype-parity weigh-sale — farm price (retail×0.90) server-computed per weighed line (retail snapshotted); bulk wholesale flat-price lines (no movement/COGS); paid|preorder(credit→AR); atomic balanced GL; idempotent; audited.';
revoke all on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text) from public;
grant execute on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- pos_void_sale — recreated: stock returns skip bulk (null-batch) lines; reversal math unchanged.
-- ════════════════════════════════════════════════════════════════════════════
drop function public.pos_void_sale(uuid, text);
create function public.pos_void_sale(p_invoice_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_branch uuid; v_total numeric; v_status text; v_order uuid; v_actor uuid; v_entry uuid;
        a_cash uuid; a_sales uuid; a_cogs uuid; a_fg uuid; a_ar uuid; v_cogs numeric; r record;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a void reason is required' using errcode = 'check_violation'; end if;
  select i.company_id, i.branch_id, i.total, i.status, i.sales_order_id into v_company, v_branch, v_total, v_status, v_order
    from public.invoices i where i.id = p_invoice_id;
  if v_company is null then raise exception 'invoice not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'pos.void') then raise exception 'permission denied: pos.void' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(v_branch) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if v_status = 'Voided' then return; end if;  -- idempotent replay

  -- stock returns for weighed lines only (bulk lines never moved stock — P2-M2E)
  v_cogs := 0;
  for r in select finished_goods_batch_id, quantity, unit_cost from public.sales_order_items
           where sales_order_id = v_order and finished_goods_batch_id is not null loop
    insert into public.inventory_movements (company_id, branch_id, finished_goods_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, reason, actor_user_id)
      values (v_company, v_branch, r.finished_goods_batch_id, 'AdjustmentIncrease', r.quantity, r.unit_cost, round(r.quantity * r.unit_cost, 2), 'VoidedInvoice', p_invoice_id, p_reason, v_actor);
    v_cogs := v_cogs + round(r.quantity * r.unit_cost, 2);
  end loop;

  select id into a_cash  from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  select id into a_sales from public.chart_of_accounts where company_id = v_company and account_code = 'SALES';
  select id into a_cogs  from public.chart_of_accounts where company_id = v_company and account_code = 'COGS';
  select id into a_fg    from public.chart_of_accounts where company_id = v_company and account_code = 'FG_INVENTORY';
  select id into a_ar    from public.chart_of_accounts where company_id = v_company and account_code = 'AR';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'VoidedInvoice', p_invoice_id, 'Void: ' || p_reason, v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_sales, v_total, 0),
    (v_company, v_entry, case when v_status = 'Paid' then a_cash else a_ar end, 0, v_total);
  if v_cogs > 0 then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_fg,   v_cogs, 0),
      (v_company, v_entry, a_cogs, 0, v_cogs);
  end if;

  update public.invoices set status = 'Voided' where id = p_invoice_id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_branch, v_actor, 'Administrative', 'pos.sale_voided', 'pos', 'invoices', p_invoice_id, jsonb_build_object('reason', p_reason, 'was_status', v_status));
end; $$;
comment on function public.pos_void_sale(uuid, text) is 'P2-M2E: audited append-only reversal — reversing journal + stock returns for weighed lines (bulk lines never moved stock). pos.void approval tier; reason mandatory; idempotent.';
revoke all on function public.pos_void_sale(uuid, text) from public;
grant execute on function public.pos_void_sale(uuid, text) to authenticated;
