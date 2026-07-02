-- Migration P2-M2C — POS Pre-orders → AR · Settlement · Void · Cash Sessions (Phase 2, Module 2C)
-- Authority: Phase_2_M2C_POS_Preorder_CashSession_Spec.md (reconciled) · 22.07 AR · 22.09 cash sessions ·
--   22.24/26.07 corrections-by-addition · 26.09 permission tiers · prototype src/features/POS.tsx workflow.
-- Pattern: ADDITIVE ONLY — the locked M2B file is untouched; pos_record_sale is evolved via drop+recreate with
--   defaulted new args (existing 4-arg callers keep working), like M4 evolved M1-M3 policies.
-- Risk: High (AR + reversals + cash control). All financial writes remain function-only, append-only, balanced.

-- ── Permission catalog additions (26.09: settle=Financial/Operator, void=Approval, session=Financial) ──
insert into public.permissions (permission_key, description) values
  ('pos.settle',   'Settle a pre-order invoice (collect cash against receivable)'),
  ('pos.void',     'Void a sales invoice (audited reversing entries) — approval tier'),
  ('cash.session', 'Open and close the branch cash session (count, variance)')
on conflict (permission_key) do nothing;

-- ── Additive columns on the M2B tables (new migration; locked file untouched) ──
alter table public.sales_orders add column delivery_fee  numeric(14, 2) not null default 0 check (delivery_fee >= 0);
alter table public.sales_orders add column customer_note text;
alter table public.invoices     add column paid_at       timestamptz;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. cash_sessions (22.09) — open/count/close with SERVER-derived expected cash. One Open session per branch.
-- ════════════════════════════════════════════════════════════════════════════
create table public.cash_sessions (
  id              uuid primary key default public.uuidv7(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  branch_id       uuid not null,
  status          text not null default 'Open' check (status in ('Open', 'Closed')),
  opened_by       uuid not null references public.users (id) on delete restrict,
  opened_at       timestamptz not null default now(),
  opening_cash   numeric(14, 2) not null default 0 check (opening_cash >= 0),
  closed_by       uuid references public.users (id) on delete restrict,
  closed_at       timestamptz,
  counted_cash    numeric(14, 2),
  expected_cash   numeric(14, 2),          -- derived by cash_close_session, never client-supplied
  variance        numeric(14, 2),          -- counted − expected
  variance_reason text,
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict
);
create unique index cash_sessions_one_open_uq on public.cash_sessions (company_id, branch_id) where status = 'Open';
create index cash_sessions_branch_idx on public.cash_sessions (branch_id, company_id);
comment on table public.cash_sessions is 'Branch cash-drawer sessions (P2-M2C, 22.09). Open/close via functions only; expected cash + variance derived server-side; append-only lifecycle.';

alter table public.cash_sessions enable row level security;
alter table public.cash_sessions force row level security;
revoke all on public.cash_sessions from public, anon, authenticated, service_role;
grant select on public.cash_sessions to authenticated;
create policy cash_sessions_select_member on public.cash_sessions for select to authenticated
  using (public.is_branch_member(branch_id));

create function public.cash_open_session(p_branch_id uuid, p_opening_cash numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_actor uuid; v_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'cash.session') then raise exception 'permission denied: cash.session' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if coalesce(p_opening_cash, -1) < 0 then raise exception 'opening cash must be >= 0' using errcode = 'check_violation'; end if;
  insert into public.cash_sessions (company_id, branch_id, opened_by, opening_cash)
    values (v_company, p_branch_id, v_actor, p_opening_cash) returning id into v_id;  -- unique partial index blocks a 2nd Open
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Business', 'cash.session_opened', 'pos', 'cash_sessions', v_id);
  return v_id;
end; $$;
revoke all on function public.cash_open_session(uuid, numeric) from public;
grant execute on function public.cash_open_session(uuid, numeric) to authenticated;

create function public.cash_close_session(p_session_id uuid, p_counted_cash numeric, p_variance_reason text default null)
returns numeric  -- returns the variance
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_expected numeric; v_variance numeric;
        v_company uuid; v_branch uuid; v_opened timestamptz; v_open_cash numeric; v_status text;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select company_id, branch_id, opened_at, opening_cash, status into v_company, v_branch, v_opened, v_open_cash, v_status
    from public.cash_sessions where id = p_session_id;
  if v_company is null then raise exception 'session not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'cash.session') then raise exception 'permission denied: cash.session' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(v_branch) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if v_status <> 'Open' then raise exception 'session is not open' using errcode = 'check_violation'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'counted cash must be >= 0' using errcode = 'check_violation'; end if;

  -- SERVER-derived expected cash (22.09): opening cash + net cash received on invoices paid in this branch since open.
  select v_open_cash + coalesce(sum(i.tender_cash - i.change_amount), 0) into v_expected
  from public.invoices i
  where i.branch_id = v_branch and i.status = 'Paid'
    and coalesce(i.paid_at, i.created_at) >= v_opened;

  v_variance := round(p_counted_cash - v_expected, 2);
  if v_variance <> 0 and (p_variance_reason is null or length(trim(p_variance_reason)) = 0) then
    raise exception 'variance of % requires a reason', v_variance using errcode = 'check_violation';
  end if;

  update public.cash_sessions
     set status = 'Closed', closed_by = v_actor, closed_at = now(),
         counted_cash = p_counted_cash, expected_cash = v_expected,
         variance = v_variance, variance_reason = p_variance_reason
   where id = p_session_id and status = 'Open';

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_branch, v_actor, case when v_variance <> 0 then 'Administrative' else 'Business' end,
            case when v_variance <> 0 then 'cash.variance' else 'cash.session_closed' end,
            'pos', 'cash_sessions', p_session_id,
            jsonb_build_object('expected', v_expected, 'counted', p_counted_cash, 'variance', v_variance, 'reason', p_variance_reason));
  return v_variance;
end; $$;
revoke all on function public.cash_close_session(uuid, numeric, text) from public;
grant execute on function public.cash_close_session(uuid, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. pos_record_sale — evolved: sale kind paid|preorder, SERVER-applied discount rate, delivery fee, note.
--    Same first 4 args (existing callers unaffected). Preorder: invoice_type=credit, status=Unpaid, Dr AR.
-- ════════════════════════════════════════════════════════════════════════════
drop function public.pos_record_sale(uuid, jsonb, numeric, text);
create function public.pos_record_sale(
  p_branch_id uuid, p_lines jsonb, p_tender_cash numeric, p_idempotency_key text,
  p_sale_kind text default 'paid', p_discount_rate numeric default 0,
  p_delivery_fee numeric default 0, p_customer_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_line jsonb;
  v_pid uuid; v_fg uuid; v_qty numeric; v_price numeric; v_cost numeric;
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
  if p_discount_rate not in (0, 0.10) then raise exception 'invalid discount rate' using errcode = 'check_violation'; end if;  -- server-applied, prototype 10%
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
    v_fg  := (v_line ->> 'finished_goods_batch_id')::uuid;
    v_qty := (v_line ->> 'weight_kg')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'weight must be > 0' using errcode = 'check_violation'; end if;
    select pr.retail_per_kg into v_price from public.products pr where pr.id = v_pid and pr.company_id = v_company and pr.status = 'Active';
    if v_price is null then raise exception 'unknown/inactive product' using errcode = 'foreign_key_violation'; end if;
    select fg.cost_per_unit into v_cost from public.finished_goods_batches fg where fg.id = v_fg and fg.company_id = v_company;
    if v_cost is null then raise exception 'unknown finished-goods batch' using errcode = 'foreign_key_violation'; end if;
    if public.fg_available(v_fg) < v_qty then raise exception 'insufficient stock for batch %', v_fg using errcode = 'check_violation'; end if;
    insert into public.sales_order_items (company_id, sales_order_id, product_id, finished_goods_batch_id, quantity, unit_price, line_total, unit_cost)
      values (v_company, v_order, v_pid, v_fg, v_qty, v_price, round(v_qty * v_price, 2), v_cost);
    insert into public.inventory_movements (company_id, branch_id, finished_goods_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, actor_user_id)
      values (v_company, p_branch_id, v_fg, 'Sales', v_qty, v_cost, round(v_qty * v_cost, 2), 'SalesInvoice', v_order, v_actor);
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_cogs := v_cogs + round(v_qty * v_cost, 2);
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
comment on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text) is 'P2-M2C: weigh-sale, paid OR preorder(credit->AR). Server price+discount authority; atomic order+invoice+stock+COGS+balanced GL; idempotent; audited.';
revoke all on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text) from public;
grant execute on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. pos_settle_sale — collect cash against a pre-order (22.07). Status-idempotent; new journal (Dr Cash / Cr AR).
-- ════════════════════════════════════════════════════════════════════════════
create function public.pos_settle_sale(p_invoice_id uuid, p_cash numeric)
returns numeric  -- change given
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_branch uuid; v_total numeric; v_status text; v_actor uuid; v_entry uuid;
        a_cash uuid; a_ar uuid; v_change numeric;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select company_id, branch_id, total, status into v_company, v_branch, v_total, v_status from public.invoices where id = p_invoice_id;
  if v_company is null then raise exception 'invoice not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'pos.settle') then raise exception 'permission denied: pos.settle' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(v_branch) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if v_status = 'Paid' then return 0; end if;  -- idempotent replay
  if v_status <> 'Unpaid' then raise exception 'invoice is not settleable (status=%)', v_status using errcode = 'check_violation'; end if;
  if p_cash is null or p_cash < v_total then raise exception 'cash must cover the outstanding total' using errcode = 'check_violation'; end if;

  v_change := round(p_cash - v_total, 2);
  update public.invoices set status = 'Paid', tender_cash = p_cash, change_amount = v_change, paid_at = now() where id = p_invoice_id;

  select id into a_cash from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  select id into a_ar   from public.chart_of_accounts where company_id = v_company and account_code = 'AR';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'Settlement', p_invoice_id, 'Pre-order settlement', v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_cash, v_total, 0),
    (v_company, v_entry, a_ar, 0, v_total);

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_branch, v_actor, 'Business', 'pos.sale_settled', 'pos', 'invoices', p_invoice_id);
  return v_change;
end; $$;
revoke all on function public.pos_settle_sale(uuid, numeric) from public;
grant execute on function public.pos_settle_sale(uuid, numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. pos_void_sale — audited APPEND-ONLY reversal (22.24/26.07): reversing journal + stock-return movements.
--    26.09 approval tier: requires pos.void (not granted to plain cashiers).
-- ════════════════════════════════════════════════════════════════════════════
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

  -- stock returns (append-only movements) + COGS sum from the original lines
  v_cogs := 0;
  for r in select finished_goods_batch_id, quantity, unit_cost from public.sales_order_items where sales_order_id = v_order loop
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
  -- reverse revenue against the tender source (cash if it was Paid, AR if Unpaid)
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
revoke all on function public.pos_void_sale(uuid, text) from public;
grant execute on function public.pos_void_sale(uuid, text) to authenticated;
