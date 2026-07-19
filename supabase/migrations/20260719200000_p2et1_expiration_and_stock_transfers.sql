-- Migration P2ET1 — Expiration-date tracking + branch stock transfers (owner backlog items,
-- confirmed NOT built in the earlier audit; both explicitly listed as deferred additive scope in
-- Phase_2_M3_Inventory_Module_Spec.md line 36: "expiration tracking, branch transfers").
--
-- SCOPE:
--   Expiration — material_batches gains a nullable expiration_date (settable at purchase time via
--     inventory_record_purchase's 16th arg, or later via inventory_set_batch_expiration). A read RPC
--     (list_expiring_batches) surfaces batches expiring within N days or already past their date. A
--     write-off RPC (inventory_writeoff_batch) removes an expired/damaged batch's remaining quantity
--     from stock and posts the loss to SHRINKAGE at FIFO cost — economically identical to the existing
--     inventory_adjust_material shrinkage path, just targeted at ONE specific aged batch instead of a
--     FIFO sweep across all of an item's batches (the whole point of tracking expiration per-batch is
--     writing off the SPECIFIC batch that spoiled, not "the oldest stock regardless of which lot").
--   Transfers — a new inventory_transfer_stock RPC moves a quantity of one item from branch A to
--     branch B: FIFO-drains source batches (identical draining loop to inventory_adjust_material,
--     copied not reused — a plpgsql function can't easily share a loop body without a helper, and this
--     one's exit condition differs enough — creating new zero-cost batches was wrong here) and creates
--     a matching batch at the destination PER SOURCE BATCH DRAINED, preserving that batch's own
--     unit_cost and original received_at (so FIFO aging carries over correctly at the new branch,
--     rather than resetting the age of transferred stock to "just received"). No GL entry — moving
--     stock between two branches of the same company is not a purchase, sale, or loss; the RAW_MATERIALS
--     balance is unchanged in aggregate, only its branch attribution shifts. Movement rows on both
--     ends share one `source_document_id` (a fresh transfer id) so a transfer's full history — what
--     left branch A, what arrived at branch B — can be reconstructed as one linked story.
--
-- PERMISSION: reuses inventory.adjust for both new writes (no new permission key) — that key already
-- represents "can change stock counts for reasons other than a purchase or sale," which is exactly
-- what a transfer and a write-off both are. Adding a new key here would be complexity without a real
-- access-boundary need (C1 §4).
--
-- Authority: Phase_2_M3_Inventory_Module_Spec.md line 36 (explicit deferred-additive), C7 §5
-- (inventory ledger integrity — the append-only movement ledger is the only thing that ever changes
-- a balance; this migration adds two new movement_type values but never bypasses that ledger).
-- Risk: Medium — touches the shared inventory_movements/material_batches tables and two SQL functions
-- (material_available, material_batch_available) that the entire inventory module's stock math derives
-- from. Full guard battery (not just the new guard) required after this migration, since a mistake in
-- either SQL function would silently corrupt every existing balance read.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. material_batches: nullable expiration_date (additive column)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.material_batches add column expiration_date date;
comment on column public.material_batches.expiration_date is 'P2ET1: optional best-before/expiration date, set at purchase time or later. Null = not tracked for this batch (most consumables today).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. inventory_movements: widen movement_type to allow TransferOut/TransferIn (additive to the CHECK)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.inventory_movements drop constraint inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type = any (array['Opening','Sales','AdjustmentIncrease','AdjustmentDecrease','Disposal','Reserve','Unreserve','PurchaseReceiving','TransferOut','TransferIn']));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. material_available / material_batch_available: TransferIn additive, TransferOut subtractive.
--    Same signature as before (SQL functions), so a plain create-or-replace is sufficient — no drop
--    needed (unlike inventory_record_purchase's plpgsql evolutions, arg count is unchanged here).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.material_available(p_item_id uuid, p_branch_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case
    when m.movement_type in ('Opening', 'AdjustmentIncrease', 'Unreserve', 'PurchaseReceiving', 'TransferIn') then m.quantity
    when m.movement_type in ('Sales', 'AdjustmentDecrease', 'Disposal', 'Reserve', 'TransferOut') then -m.quantity
    else 0 end), 0)
  from public.inventory_movements m
  where m.item_id = p_item_id and m.branch_id = p_branch_id
$$;
comment on function public.material_available(uuid, uuid) is 'P2-M2A + P2ET1: derived stock balance for an item at a branch, summed from the append-only movement ledger. TransferIn/TransferOut added (P2ET1) alongside the original movement types.';

create or replace function public.material_batch_available(p_batch_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case
    when m.movement_type in ('Opening', 'AdjustmentIncrease', 'Unreserve', 'PurchaseReceiving', 'TransferIn') then m.quantity
    when m.movement_type in ('Sales', 'AdjustmentDecrease', 'Disposal', 'Reserve', 'TransferOut') then -m.quantity
    else 0 end), 0)
  from public.inventory_movements m
  where m.material_batch_id = p_batch_id
$$;
comment on function public.material_batch_available(uuid) is 'P2-M2A + P2ET1: derived remaining quantity for one specific batch. TransferIn/TransferOut added (P2ET1) alongside the original movement types.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. inventory_record_purchase(...): append p_expiration_date (16th arg, default null) — sets the
--    new batch's expiration_date at purchase time, the most natural point to record it (a receipt or
--    package label is right there). Same evolution pattern as P2PO1's p_purchase_order_request_id;
--    another arg-count change, so the old 15-arg overload must be dropped first (same reason as P2PO1).
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid);
create or replace function public.inventory_record_purchase(
  p_branch_id                    uuid,
  p_category_key                 text,
  p_item_name                    text,
  p_is_equipment                 boolean,
  p_quantity                     numeric,
  p_total_cost                   numeric,
  p_source_type                  text,
  p_source_name                  text,
  p_source_contact               text,
  p_purchase_date                date,
  p_idempotency_key              text,
  p_vendor_id                    uuid default null,
  p_bought_by                    text default null,
  p_base_unit                    text default null,
  p_purchase_order_request_id    uuid default null,
  p_expiration_date              date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_cat uuid; v_item uuid; v_recv uuid; v_batch uuid; v_asset uuid;
  v_key text; v_unit_cost numeric; v_entry uuid; a_debit_code text; a_debit uuid; a_cash uuid;
  v_vendor_name text; v_vendor_contact text; v_vendor_status text;
  v_por_company uuid; v_por_status text; v_por_item uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'inventory.purchase') then
    raise exception 'permission denied: inventory.purchase' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(p_branch_id) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be > 0' using errcode = 'check_violation'; end if;
  if p_total_cost is null or p_total_cost <= 0 then raise exception 'purchase cost must be > 0' using errcode = 'check_violation'; end if;
  if p_source_type not in ('online', 'physical', 'vendor') then
    raise exception 'invalid source type' using errcode = 'check_violation';
  end if;
  if p_item_name is null or length(trim(p_item_name)) = 0 then
    raise exception 'item name is required' using errcode = 'check_violation';
  end if;

  if p_vendor_id is not null then
    select v.name, v.contact, v.status into v_vendor_name, v_vendor_contact, v_vendor_status
      from public.vendors v where v.id = p_vendor_id and v.company_id = v_company;
    if v_vendor_name is null then
      raise exception 'vendor not found in this company' using errcode = 'foreign_key_violation';
    end if;
    if v_vendor_status <> 'Active' then
      raise exception 'vendor is not Active' using errcode = 'check_violation';
    end if;
    if p_source_type <> 'vendor' then
      raise exception 'p_vendor_id is set but source_type is not ''vendor'' (got %)', p_source_type using errcode = 'check_violation';
    end if;
  end if;

  if p_purchase_order_request_id is not null then
    select por.company_id, por.status, por.item_id into v_por_company, v_por_status, v_por_item
      from public.purchase_order_requests por where por.id = p_purchase_order_request_id
      for update of por;
    if v_por_company is null or v_por_company <> v_company then
      raise exception 'purchase order request not found in this company' using errcode = 'foreign_key_violation';
    end if;
    if v_por_status <> 'Approved' then
      raise exception 'purchase order request is not Approved (status: %)', v_por_status using errcode = 'check_violation';
    end if;
  end if;

  select r.id into v_existing from public.purchase_receivings r
    where r.company_id = v_company and r.idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  perform public.inventory_ensure_categories(v_company);
  perform public.inventory_ensure_accounts(v_company);
  v_key := case when p_is_equipment then 'equipment' else coalesce(p_category_key, 'misc') end;
  select c.id into v_cat from public.item_categories c where c.company_id = v_company and c.category_key = v_key;
  if v_cat is null then raise exception 'unknown material category %', v_key using errcode = 'check_violation'; end if;

  select i.id into v_item from public.inventory_items i
    where i.company_id = v_company and i.category_id = v_cat and lower(i.name) = lower(trim(p_item_name));
  if v_item is null then
    insert into public.inventory_items (id, company_id, category_id, item_code, name, inventory_type, base_unit)
      values (public.uuidv7(), v_company, v_cat,
              upper(v_key) || '-' || right(replace(public.uuidv7()::text, '-', ''), 8),
              trim(p_item_name),
              case when p_is_equipment then 'Equipment' else 'Consumable' end,
              coalesce(nullif(trim(p_base_unit), ''), 'pcs'))
      returning id into v_item;
  end if;

  if p_purchase_order_request_id is not null and v_por_item <> v_item then
    raise exception 'this purchase order request is for a different item' using errcode = 'check_violation';
  end if;

  v_unit_cost := round(p_total_cost / p_quantity, 2);
  insert into public.purchase_receivings (
    company_id, branch_id, item_id, quantity, total_amount,
    source_type, source_name, source_contact,
    received_date, received_by, idempotency_key, vendor_id, bought_by
  ) values (
    v_company, p_branch_id, v_item, p_quantity, p_total_cost,
    p_source_type,
    case when p_source_type = 'vendor' and p_vendor_id is not null then v_vendor_name
         else coalesce(nullif(trim(p_source_name), ''), 'Local Supplier') end,
    case when p_source_type = 'vendor' and p_vendor_id is not null then v_vendor_contact
         else nullif(trim(coalesce(p_source_contact, '')), '') end,
    coalesce(p_purchase_date, now()::date), v_actor, p_idempotency_key, p_vendor_id, nullif(trim(coalesce(p_bought_by, '')), '')
  )
  returning id into v_recv;
  insert into public.material_batches (company_id, branch_id, item_id, purchase_receiving_id, unit_cost, received_at, expiration_date)
    values (v_company, p_branch_id, v_item, v_recv, v_unit_cost, coalesce(p_purchase_date::timestamptz, now()), p_expiration_date)
    returning id into v_batch;
  insert into public.inventory_movements (company_id, branch_id, item_id, material_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, actor_user_id)
    values (v_company, p_branch_id, v_item, v_batch, 'PurchaseReceiving', p_quantity, v_unit_cost, p_total_cost, 'PurchaseReceiving', v_recv, v_actor);

  a_debit_code := case
    when p_is_equipment then 'EQUIPMENT'
    when v_key in ('seeds', 'substrate', 'packaging') then 'RAW_MATERIALS'
    else 'OPERATING_EXPENSES'
  end;
  select id into a_debit from public.chart_of_accounts where company_id = v_company and account_code = a_debit_code;
  select id into a_cash  from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by, entry_date)
    values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'PurchaseReceiving', v_recv,
            'Buy: ' || trim(p_item_name) || case when p_source_type = 'vendor' and p_vendor_id is not null then ' (' || v_vendor_name || ')' else '' end,
            v_actor, coalesce(p_purchase_date, now()::date));
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit)
    values
      (v_company, v_entry, a_debit, p_total_cost, 0),
      (v_company, v_entry, a_cash, 0, p_total_cost);
  if p_is_equipment then
    insert into public.equipment_assets (company_id, branch_id, asset_code, name, purchase_date, purchase_cost, purchase_receiving_id)
      values (v_company, p_branch_id,
              'EQ-' || substr(replace(public.uuidv7()::text, '-', ''), 1, 8),
              trim(p_item_name), coalesce(p_purchase_date, now()::date), p_total_cost, v_recv)
      returning id into v_asset;
  end if;

  if p_purchase_order_request_id is not null then
    update public.purchase_order_requests
      set status = 'Fulfilled', fulfilled_receiving_id = v_recv
      where id = p_purchase_order_request_id;
  end if;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, p_branch_id, v_actor, 'Business', 'inventory.purchase_received', 'inventory', 'purchase_receivings', v_recv,
            jsonb_build_object('source_type', p_source_type, 'vendor_id', p_vendor_id, 'item', trim(p_item_name), 'quantity', p_quantity, 'total_cost', p_total_cost, 'bought_by', p_bought_by, 'purchase_order_request_id', p_purchase_order_request_id, 'expiration_date', p_expiration_date));
  return v_recv;
end; $$;
comment on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid, date) is 'P2-M3A + T3.2 + P2M3B.1 + P2U1 + P2PO1 + P2ET1 (2026-07-19): record a stock purchase receiving. New optional p_expiration_date arg (default null, 16th) sets the new batch''s best-before date at purchase time. First 15 args unchanged, so all existing call sites still resolve identically.';
revoke all on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid, date) from public, anon;
grant execute on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. inventory_set_batch_expiration(p_batch_id, p_expiration_date) — set/correct after the fact.
-- ════════════════════════════════════════════════════════════════════════════
create function public.inventory_set_batch_expiration(p_batch_id uuid, p_expiration_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid; v_old date;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select mb.company_id, mb.expiration_date into v_company, v_old from public.material_batches mb where mb.id = p_batch_id;
  if v_company is null then raise exception 'batch not found' using errcode = 'raise_exception'; end if;
  if not public.has_permission(v_company, 'inventory.adjust') then
    raise exception 'permission denied: inventory.adjust' using errcode = 'insufficient_privilege';
  end if;
  update public.material_batches set expiration_date = p_expiration_date where id = p_batch_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, previous_value, new_value)
    values (v_company, v_actor, 'Business', 'inventory.batch_expiration_edited', 'inventory', 'material_batches', p_batch_id,
            jsonb_build_object('expiration_date', v_old), jsonb_build_object('expiration_date', p_expiration_date));
end; $$;
comment on function public.inventory_set_batch_expiration(uuid, date) is 'P2ET1: set or correct a material batch''s expiration_date after purchase. inventory.adjust-gated, audited.';
revoke all on function public.inventory_set_batch_expiration(uuid, date) from public, anon;
grant execute on function public.inventory_set_batch_expiration(uuid, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. list_expiring_batches(p_company, p_days_ahead) — batches expiring within N days, or already
--    past due, that still have stock remaining. inventory.adjust-gated (the tier that can also act
--    on the alert via write-off).
-- ════════════════════════════════════════════════════════════════════════════
create function public.list_expiring_batches(p_company uuid, p_days_ahead int default 30)
returns table (
  id uuid, branch_id uuid, branch_name text, item_id uuid, item_name text,
  expiration_date date, remaining numeric, unit_cost numeric, is_expired boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company, 'inventory.adjust') then
    raise exception 'permission denied: inventory.adjust' using errcode = 'insufficient_privilege';
  end if;
  return query
    select mb.id, mb.branch_id, br.name as branch_name, mb.item_id, ii.name as item_name,
           mb.expiration_date, public.material_batch_available(mb.id) as remaining, mb.unit_cost,
           (mb.expiration_date < current_date) as is_expired
      from public.material_batches mb
      join public.branches br on br.id = mb.branch_id
      join public.inventory_items ii on ii.id = mb.item_id
     where mb.company_id = p_company and mb.status = 'Available' and mb.expiration_date is not null
       and mb.expiration_date <= current_date + p_days_ahead
       and public.material_batch_available(mb.id) > 0
     order by mb.expiration_date;
end; $$;
comment on function public.list_expiring_batches(uuid, int) is 'P2ET1: batches expiring within p_days_ahead (default 30) or already past due, still holding stock. inventory.adjust-gated.';
revoke all on function public.list_expiring_batches(uuid, int) from public, anon;
grant execute on function public.list_expiring_batches(uuid, int) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. inventory_writeoff_batch(p_batch_id, p_reason) — remove ONE batch's remaining stock, posts
--    SHRINKAGE at that batch's own cost. Mirrors inventory_adjust_material's shrinkage path but
--    targets a single named batch instead of a FIFO sweep across all of an item's batches.
-- ════════════════════════════════════════════════════════════════════════════
create function public.inventory_writeoff_batch(p_batch_id uuid, p_reason text default 'Expired')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_branch uuid; v_item uuid; v_unit_cost numeric; v_remaining numeric;
  v_shrink numeric; v_entry uuid; a_shrink uuid; a_raw uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select mb.company_id, mb.branch_id, mb.item_id, mb.unit_cost
    into v_company, v_branch, v_item, v_unit_cost
    from public.material_batches mb where mb.id = p_batch_id for update of mb;
  if v_company is null then raise exception 'batch not found' using errcode = 'raise_exception'; end if;
  if not public.has_permission(v_company, 'inventory.adjust') then
    raise exception 'permission denied: inventory.adjust' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(v_branch) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;
  if trim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required' using errcode = 'raise_exception'; end if;
  v_remaining := public.material_batch_available(p_batch_id);
  if v_remaining <= 0 then raise exception 'this batch has no remaining stock to write off' using errcode = 'check_violation'; end if;

  insert into public.inventory_movements (company_id, branch_id, item_id, material_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, reason, actor_user_id)
    values (v_company, v_branch, v_item, p_batch_id, 'AdjustmentDecrease', v_remaining, v_unit_cost, round(v_remaining * v_unit_cost, 2), 'Adjustment', p_reason, v_actor);
  update public.material_batches set status = 'Expired' where id = p_batch_id;

  v_shrink := round(v_remaining * v_unit_cost, 2);
  if v_shrink > 0 then
    perform public.inventory_ensure_accounts(v_company);
    select id into a_shrink from public.chart_of_accounts where company_id = v_company and account_code = 'SHRINKAGE';
    select id into a_raw    from public.chart_of_accounts where company_id = v_company and account_code = 'RAW_MATERIALS';
    v_entry := public.uuidv7();
    insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, description, created_by)
      values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'Adjustment', 'Batch write-off: ' || p_reason, v_actor);
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_shrink, v_shrink, 0),
      (v_company, v_entry, a_raw, 0, v_shrink);
  end if;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_branch, v_actor, 'Business', 'inventory.batch_written_off', 'inventory', 'material_batches', p_batch_id,
            jsonb_build_object('quantity', v_remaining, 'unit_cost', v_unit_cost, 'reason', p_reason));
end; $$;
comment on function public.inventory_writeoff_batch(uuid, text) is 'P2ET1: writes off a specific batch''s remaining stock (expired/damaged), posting the loss to SHRINKAGE at that batch''s own FIFO cost. inventory.adjust-gated, audited.';
revoke all on function public.inventory_writeoff_batch(uuid, text) from public, anon;
grant execute on function public.inventory_writeoff_batch(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. inventory_transfer_stock(p_item_id, p_from_branch_id, p_to_branch_id, p_quantity, p_notes) —
--    FIFO-drain source, create matching destination batches preserving cost + received_at. No GL
--    entry (internal relocation, not a purchase/sale/loss).
-- ════════════════════════════════════════════════════════════════════════════
create function public.inventory_transfer_stock(
  p_item_id        uuid,
  p_from_branch_id uuid,
  p_to_branch_id   uuid,
  p_quantity       numeric,
  p_notes          text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_company2 uuid; v_transfer uuid;
  v_avail numeric; v_need numeric; v_take numeric; r record; v_new_batch uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_from_branch_id;
  select b.company_id into v_company2 from public.branches b where b.id = p_to_branch_id;
  if v_company is null or v_company2 is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if v_company <> v_company2 then raise exception 'both branches must belong to the same company' using errcode = 'check_violation'; end if;
  if p_from_branch_id = p_to_branch_id then raise exception 'source and destination branch must differ' using errcode = 'check_violation'; end if;
  if not public.has_permission(v_company, 'inventory.adjust') then
    raise exception 'permission denied: inventory.adjust' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(p_from_branch_id) then
    raise exception 'not a member of the source branch' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(p_to_branch_id) then
    raise exception 'not a member of the destination branch' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.inventory_items i where i.id = p_item_id and i.company_id = v_company) then
    raise exception 'unknown item' using errcode = 'foreign_key_violation';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be > 0' using errcode = 'check_violation'; end if;

  v_avail := public.material_available(p_item_id, p_from_branch_id);
  if v_avail < p_quantity then
    raise exception 'transfer exceeds available stock at source (% < %)', v_avail, p_quantity using errcode = 'check_violation';
  end if;

  v_transfer := public.uuidv7();
  v_need := p_quantity;
  for r in select mb.id, mb.unit_cost, mb.received_at, mb.expiration_date from public.material_batches mb
           where mb.item_id = p_item_id and mb.branch_id = p_from_branch_id and mb.status = 'Available'
           order by mb.received_at, mb.created_at loop
    exit when v_need <= 0;
    v_avail := public.material_batch_available(r.id);
    if v_avail <= 0 then continue; end if;
    v_take := least(v_avail, v_need);

    insert into public.inventory_movements (company_id, branch_id, item_id, material_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, reason, actor_user_id)
      values (v_company, p_from_branch_id, p_item_id, r.id, 'TransferOut', v_take, r.unit_cost, round(v_take * r.unit_cost, 2), 'Transfer', v_transfer, p_notes, v_actor);

    insert into public.material_batches (company_id, branch_id, item_id, unit_cost, received_at, expiration_date)
      values (v_company, p_to_branch_id, p_item_id, r.unit_cost, r.received_at, r.expiration_date)
      returning id into v_new_batch;
    insert into public.inventory_movements (company_id, branch_id, item_id, material_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, reason, actor_user_id)
      values (v_company, p_to_branch_id, p_item_id, v_new_batch, 'TransferIn', v_take, r.unit_cost, round(v_take * r.unit_cost, 2), 'Transfer', v_transfer, p_notes, v_actor);

    v_need := v_need - v_take;
  end loop;

  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_actor, 'Business', 'inventory.stock_transferred', 'inventory', 'inventory_movements', v_transfer,
            jsonb_build_object('item_id', p_item_id, 'from_branch_id', p_from_branch_id, 'to_branch_id', p_to_branch_id, 'quantity', p_quantity, 'notes', p_notes));
  return v_transfer;
end; $$;
comment on function public.inventory_transfer_stock(uuid, uuid, uuid, numeric, text) is 'P2ET1: move quantity of an item from one branch to another within the same company. FIFO-drains source batches, creates matching destination batches preserving unit_cost + received_at (FIFO age carries over). No GL entry — internal relocation, not a purchase/sale/loss. Returns a shared transfer id linking both sides'' movement rows. inventory.adjust-gated, both branches required.';
revoke all on function public.inventory_transfer_stock(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.inventory_transfer_stock(uuid, uuid, uuid, numeric, text) to authenticated;
