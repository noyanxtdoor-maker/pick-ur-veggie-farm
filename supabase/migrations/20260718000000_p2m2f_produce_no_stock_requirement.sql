-- Migration P2-M2F — produce sales no longer require tracked stock (owner directive 2026-07-17/18):
-- "when adding a new product in POS, lets not require to have a stock... the owner explicitly told me
-- that the sold of each product is the inventory, they dont keep count of their own product inventory —
-- only Equipment and Usable inventory (materials) are tracked."
--
-- ROOT CAUSE (found while investigating, not assumed): record_opening_finished_goods() — the only RPC
-- that can ever create a finished_goods_batches row — has ZERO callers anywhere in app/. So today, EVERY
-- product added via posApi.addProduct() ("Register New Vegetable Item") has zero stock forever, the POS
-- grid tile is permanently disabled (availableFor() = 0), and the product is unsellable through any
-- shipped UI path. This isn't a deliberate stock-tracking policy being worked around — it's a dead end
-- the product was never meant to hit, now surfaced because the owner's real business (no produce
-- inventory counts) exposed it immediately.
--
-- FIX: make finished_goods_batch_id genuinely OPTIONAL for a weighed produce line, mirroring the exact
-- pattern already proven safe for bulk/"Skip Weigh" lines (which have shipped with finished_goods_batch_id
-- = null, no stock check, no inventory movement, no COGS contribution, since P2-M2E — see
-- 20260628120000_p2m2a_finished_goods_spine.sql for the nullable FK, 20260702180000_p2m2e for the bulk
-- precedent). When a batch id IS supplied (a future harvest-tracking flow, or legacy data), behavior is
-- 100% unchanged: cost lookup, fg_available() oversell check, inventory_movements row, COGS journal line.
-- When none is supplied (the normal case going forward), the line records at farm price with zero
-- stock/COGS impact — same GL shape a bulk-only sale already posts in production today (Sales↔Cash/AR
-- only, no COGS lines, verified balanced by the existing income-statement reads which derive COGS from
-- journal_lines, never from finished_goods_batches — confirmed via a full-repo grep before writing this).
--
-- Client-side: app/features/pos/PosScreen.tsx's grid no longer disables an unstocked product's tile, and
-- addToSlip() no longer rejects a weighed line for lacking a matching batch — it still uses one if found
-- (preserves cost/stock tracking for anyone who does track it), just never blocks on its absence.
-- app/features/pos/api.ts needed NO changes — the online payload already passes whatever
-- finished_goods_batch_id the client supplies, including null, and the MOCK_MODE path already filters to
-- `finished_goods_batch_id !== null` before touching stock (it was already null-safe, just unreachable
-- from the UI).

drop function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid);
create function public.pos_record_sale(
  p_branch_id uuid, p_lines jsonb, p_tender_cash numeric, p_idempotency_key text,
  p_sale_kind text default 'paid', p_discount_rate numeric default 0,
  p_delivery_fee numeric default 0, p_customer_note text default null,
  p_financial_account_id uuid default null
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
  if p_sale_kind = 'paid' and (p_discount_rate <> 0 or coalesce(p_delivery_fee, 0) <> 0) then
    raise exception 'discount/delivery apply to pre-orders only' using errcode = 'check_violation';
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
      -- case — produce isn't stock-counted) -> zero-cost line, no movement, no COGS, same shape a bulk
      -- line already posts safely in production today.
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
  insert into public.invoices (id, company_id, branch_id, sales_order_id, invoice_number, invoice_type, total, tender_cash, change_amount, status, created_by, paid_at, financial_account_id)
    values (v_invoice, v_company, p_branch_id, v_order, public.pos_next_seq(v_company, p_branch_id, 'invoice'),
            case when p_sale_kind = 'paid' then 'cash' else 'credit' end, v_total,
            case when p_sale_kind = 'paid' then p_tender_cash else 0 end,
            case when p_sale_kind = 'paid' then round(p_tender_cash - v_total, 2) else 0 end,
            case when p_sale_kind = 'paid' then 'Paid' else 'Unpaid' end, v_actor,
            case when p_sale_kind = 'paid' then now() else null end,
            case when p_sale_kind = 'paid' then p_financial_account_id else null end);

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
comment on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid) is 'P2-B2A, evolved P2-M2F (2026-07-18): weigh-sale + payment account; finished_goods_batch_id is now OPTIONAL for a weighed line — supplied means unchanged cost/stock/COGS tracking, absent (the normal case; produce is not stock-counted) means a zero-cost line with no inventory movement and no COGS journal contribution, same GL shape a bulk-only sale already posts. Amounts/pricing otherwise unchanged from M2E; account stored on the invoice; atomic balanced GL; idempotent; audited.';
revoke all on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid) from public;
grant execute on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid) to authenticated;
