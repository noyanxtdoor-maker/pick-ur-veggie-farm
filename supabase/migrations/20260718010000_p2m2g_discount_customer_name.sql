-- Migration P2-M2G — POS discount on Direct Cash sales + customer name (owner directive 2026-07-18):
-- "add a Discount option and Customer name input in the POS checkout for both tabs (Direct Cash &
-- Pre-order). add the customer name in the receipt."
--
-- CURRENT STATE: the 10% discount toggle only exists in the checkout's Pre-order tab. pos_record_sale
-- hard-rejects ANY discount (or delivery fee) on a 'paid' (Direct Cash) sale: "discount/delivery apply
-- to pre-orders only". There is no customer-name concept anywhere on a POS sale — the closest thing is
-- the free-text delivery note, which only ever renders in the Pre-order tab and means something
-- different (a delivery instruction, not who the sale is for).
--
-- FIX: split the existing combined guard into two independent checks — delivery fee stays pre-order-only
-- (unchanged; a Direct Cash sale is paid in full immediately, there's nothing to "deliver later" for),
-- but discount is now allowed on EITHER sale kind. The discount rate stays constrained to exactly
-- {0, 0.10} (unchanged) — this is a fixed "apply the 10%" toggle, not a flexible-amount discount, the
-- same one that already existed for pre-orders; extending it to Direct Cash is a one-line guard change,
-- not a new discount system.
--
-- Customer name: new nullable `customer_name` column on `invoices`, threaded through a new optional
-- `p_customer_name` parameter (mirrors how `p_customer_note` already flows). Free text, not linked to
-- the `customers` master table — the ask was "a customer name input", not "pick a customer record";
-- linking to Customers & Credit would be a materially bigger feature (customer lookup/creation UI,
-- credit-standing checks) that wasn't requested here.

alter table public.invoices add column customer_name text;
comment on column public.invoices.customer_name is 'P2-M2G: free-text walk-in customer name captured at sale time, printed on the receipt. Not linked to the customers master table (that is a separate, bigger feature — this is just "who is this sale for").';

drop function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid);
create function public.pos_record_sale(
  p_branch_id uuid, p_lines jsonb, p_tender_cash numeric, p_idempotency_key text,
  p_sale_kind text default 'paid', p_discount_rate numeric default 0,
  p_delivery_fee numeric default 0, p_customer_note text default null,
  p_financial_account_id uuid default null, p_customer_name text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_line jsonb;
  v_pid uuid; v_fg uuid; v_qty numeric; v_retail numeric; v_farm numeric; v_cost numeric;
  v_bulk numeric; v_pname text;
  v_subtotal numeric := 0; v_cogs numeric := 0; v_discount numeric; v_total numeric;
  v_order uuid; v_invoice uuid; v_entry uuid; v_pay_code text;
  a_pay uuid; a_sales uuid; a_cogs uuid; a_fg uuid; a_ar uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'pos.sell') then raise exception 'permission denied: pos.sell' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_sale_kind not in ('paid', 'preorder') then raise exception 'invalid sale kind' using errcode = 'check_violation'; end if;
  if p_discount_rate not in (0, 0.10) then raise exception 'invalid discount rate' using errcode = 'check_violation'; end if;
  -- P2-M2G: discount now applies to either sale kind; delivery fee (a "deliver later" concept) stays
  -- pre-order-only — a Direct Cash sale is settled and handed over immediately.
  if p_sale_kind = 'paid' and coalesce(p_delivery_fee, 0) <> 0 then
    raise exception 'delivery fee applies to pre-orders only' using errcode = 'check_violation';
  end if;
  if coalesce(p_delivery_fee, 0) < 0 then raise exception 'delivery fee must be >= 0' using errcode = 'check_violation'; end if;
  -- P2-B2A: a pre-order collects no money at sale time — the account is chosen at settlement.
  if p_sale_kind = 'preorder' and p_financial_account_id is not null then
    raise exception 'a pre-order takes its payment account at settlement' using errcode = 'check_violation';
  end if;
  v_pay_code := public.finance_resolve_pay_code(v_company, p_branch_id, p_financial_account_id);

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
    select pr.retail_per_kg, pr.name into v_retail, v_pname
      from public.products pr where pr.id = v_pid and pr.company_id = v_company and pr.status = 'Active';
    if v_retail is null then raise exception 'unknown/inactive product' using errcode = 'foreign_key_violation'; end if;

    if v_line ? 'bulk_price' then
      v_bulk := (v_line ->> 'bulk_price')::numeric;
      if v_bulk is null or v_bulk <= 0 then raise exception 'bulk price must be > 0' using errcode = 'check_violation'; end if;
      insert into public.sales_order_items (company_id, sales_order_id, product_id, finished_goods_batch_id, quantity, unit_price, line_total, unit_cost, retail_unit_price, is_bulk, description)
        values (v_company, v_order, v_pid, null, 1, round(v_bulk, 2), round(v_bulk, 2), 0, null, true, v_pname || ' (Bulk Pre-order)');
      v_subtotal := v_subtotal + round(v_bulk, 2);
    else
      v_fg  := (v_line ->> 'finished_goods_batch_id')::uuid;
      v_qty := (v_line ->> 'weight_kg')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception 'weight must be > 0' using errcode = 'check_violation'; end if;
      v_farm := round(v_retail * 0.90, 2);
      -- P2-M2F: a batch is optional. Supplied -> unchanged cost/stock/COGS tracking. Absent (the normal
      -- case — produce isn't stock-counted) -> zero-cost line, no movement, no COGS.
      if v_fg is not null then
        select fg.cost_per_unit into v_cost from public.finished_goods_batches fg where fg.id = v_fg and fg.company_id = v_company;
        if v_cost is null then raise exception 'unknown finished-goods batch' using errcode = 'foreign_key_violation'; end if;
        if public.fg_available(v_fg) < v_qty then raise exception 'insufficient stock for batch %', v_fg using errcode = 'check_violation'; end if;
        insert into public.inventory_movements (company_id, branch_id, finished_goods_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, actor_user_id)
          values (v_company, p_branch_id, v_fg, 'Sales', v_qty, v_cost, round(v_qty * v_cost, 2), 'SalesInvoice', v_order, v_actor);
        v_cogs := v_cogs + round(v_qty * v_cost, 2);
      else
        v_cost := 0;
      end if;
      insert into public.sales_order_items (company_id, sales_order_id, product_id, finished_goods_batch_id, quantity, unit_price, line_total, unit_cost, retail_unit_price, is_bulk)
        values (v_company, v_order, v_pid, v_fg, v_qty, v_farm, round(v_qty * v_farm, 2), v_cost, v_retail, false);
      v_subtotal := v_subtotal + round(v_qty * v_farm, 2);
    end if;
  end loop;

  v_discount := round(v_subtotal * p_discount_rate, 2);
  v_total := round(v_subtotal - v_discount + coalesce(p_delivery_fee, 0), 2);
  if p_sale_kind = 'paid' and (p_tender_cash is null or p_tender_cash < v_total) then
    raise exception 'insufficient cash tendered' using errcode = 'check_violation';
  end if;

  update public.sales_orders set subtotal = v_subtotal, discount = v_discount, delivery_fee = coalesce(p_delivery_fee, 0), total_amount = v_total where id = v_order;
  v_invoice := public.uuidv7();
  insert into public.invoices (id, company_id, branch_id, sales_order_id, invoice_number, invoice_type, total, tender_cash, change_amount, status, created_by, paid_at, financial_account_id, customer_name)
    values (v_invoice, v_company, p_branch_id, v_order, public.pos_next_seq(v_company, p_branch_id, 'invoice'),
            case when p_sale_kind = 'paid' then 'cash' else 'credit' end, v_total,
            case when p_sale_kind = 'paid' then p_tender_cash else 0 end,
            case when p_sale_kind = 'paid' then round(p_tender_cash - v_total, 2) else 0 end,
            case when p_sale_kind = 'paid' then 'Paid' else 'Unpaid' end, v_actor,
            case when p_sale_kind = 'paid' then now() else null end,
            case when p_sale_kind = 'paid' then p_financial_account_id else null end,
            nullif(trim(coalesce(p_customer_name, '')), ''));

  select id into a_pay   from public.chart_of_accounts where company_id = v_company and account_code = v_pay_code;
  select id into a_sales from public.chart_of_accounts where company_id = v_company and account_code = 'SALES';
  select id into a_cogs  from public.chart_of_accounts where company_id = v_company and account_code = 'COGS';
  select id into a_fg    from public.chart_of_accounts where company_id = v_company and account_code = 'FG_INVENTORY';
  select id into a_ar    from public.chart_of_accounts where company_id = v_company and account_code = 'AR';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'SalesInvoice', v_invoice,
            case when p_sale_kind = 'paid' then 'POS sale' else 'POS pre-order (credit)' end, v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, case when p_sale_kind = 'paid' then a_pay else a_ar end, v_total, 0),
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
comment on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid, text) is 'P2-B2A, evolved P2-M2F/P2-M2G (2026-07-18): weigh-sale + payment account. finished_goods_batch_id optional for a weighed line. Discount (fixed 10% toggle) now applies to either sale kind; delivery fee stays pre-order-only. customer_name is free-text, optional, printed on the receipt. Atomic balanced GL; idempotent; audited.';
revoke all on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid, text) from public;
grant execute on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid, text) to authenticated;
