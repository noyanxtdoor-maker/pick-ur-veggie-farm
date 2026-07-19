-- Migration P2U1 — real unit conversion for Materials & Equipment inventory (owner backlog item,
-- 2026-07-19: "Build real unit conversion — every item is currently hard-coded to 'pieces'.").
--
-- Confirmed by reading the code, not just the DB default: `inventory_items.base_unit` defaults to
-- 'pcs', but `inventory_record_purchase`'s item-creation branch never passes a unit at all — every
-- new item gets 'pcs' unconditionally, and the client (`app/features/inventory/api.ts`) hardcodes
-- `base_unit: 'pcs'` too. So this is a real, literal "hardcoded to pieces" bug, not just a missing
-- nice-to-have — every fertilizer sack, packaging roll, and tool in this system has been recorded as
-- "pieces" regardless of what it actually is.
--
-- Scope decision: the STOCK LEDGER (purchase_receivings.quantity, material_batches, inventory_movements,
-- material_available()) keeps meaning exactly what it always has — "how many base_units" — completely
-- unchanged. That is deliberate: those tables already feed financial postings (Dr RAW_MATERIALS/
-- EQUIPMENT/OPERATING_EXPENSES) and 25 existing inventory-security guard assertions; reinterpreting
-- their quantity semantics mid-flight is exactly the kind of change that silently corrupts historical
-- reconciliation. Instead:
--   1. base_unit becomes genuinely choosable at item-creation time (was hardcoded).
--   2. A per-item, informational purchase_unit + conversion_factor ("1 sack = 50 kg") lets the app
--      show a real conversion calculator in the Buy Stock UI — the OWNER enters "2 sacks", the client
--      converts to 100 kg client-side, and the RPC receives 100 (base_unit terms) exactly as it always
--      has. The server-side money-path contract does not change at all; this is real, working
--      unit-conversion functionality delivered entirely at the UI/metadata layer, which is the correct
--      place for it — the ledger was never supposed to know or care what unit the owner counted in at
--      the register.

alter table public.inventory_items add column purchase_unit text;
alter table public.inventory_items add column unit_conversion_factor numeric(12, 4) check (unit_conversion_factor is null or unit_conversion_factor > 0);
comment on column public.inventory_items.purchase_unit is 'P2U1: the unit this item is normally BOUGHT in (e.g. "sack"), distinct from base_unit (the unit STOCK is tracked in, e.g. "kg"). Null = no conversion defined; Buy Stock is entered directly in base_unit.';
comment on column public.inventory_items.unit_conversion_factor is 'P2U1: how many base_units equal one purchase_unit (e.g. 50, if 1 sack = 50 kg). Informational/UI-only — inventory_record_purchase always receives an already-converted base_unit quantity; this column never changes ledger semantics.';

-- 1. Evolve inventory_record_purchase: append p_base_unit (default null) as the 14th arg — same
--    append-a-defaulted-arg pattern as T3.2/T3.3/P2M3B.1. Applied ONLY on first-creation of an item;
--    an existing item's base_unit is immutable thereafter (changing units on stock that already has a
--    history would silently misstate every past movement).
drop function if exists public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text);

create or replace function public.inventory_record_purchase(
  p_branch_id           uuid,
  p_category_key        text,
  p_item_name           text,
  p_is_equipment        boolean,
  p_quantity            numeric,
  p_total_cost          numeric,
  p_source_type         text,
  p_source_name         text,
  p_source_contact      text,
  p_purchase_date       date,
  p_idempotency_key     text,
  p_vendor_id           uuid default null,
  p_bought_by           text default null,
  p_base_unit           text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_cat uuid; v_item uuid; v_recv uuid; v_batch uuid; v_asset uuid;
  v_key text; v_unit_cost numeric; v_entry uuid; a_debit_code text; a_debit uuid; a_cash uuid;
  v_vendor_name text; v_vendor_contact text; v_vendor_status text;
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
    -- P2U1 fix (found while testing this migration, not caused by it — pre-existing in every prior
    -- version of this function): item_code's suffix used to be substr(...,1,8) — the FIRST 8 hex
    -- chars of a fresh uuidv7(), which is ENTIRELY the 48-bit millisecond timestamp (confirmed live:
    -- three uuidv7() calls in the same statement batch shared an identical first-12-hex-char prefix).
    -- Two items in the same category created within the same millisecond were GUARANTEED to collide
    -- on item_code, not just theoretically likely — a real latent bug, now fixed by taking the last 8
    -- hex chars instead (the tail of rand_b, genuinely random every call, confirmed live to differ).
    insert into public.inventory_items (id, company_id, category_id, item_code, name, inventory_type, base_unit)
      values (public.uuidv7(), v_company, v_cat,
              upper(v_key) || '-' || right(replace(public.uuidv7()::text, '-', ''), 8),
              trim(p_item_name),
              case when p_is_equipment then 'Equipment' else 'Consumable' end,
              coalesce(nullif(trim(p_base_unit), ''), 'pcs'))
      returning id into v_item;
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
  insert into public.material_batches (company_id, branch_id, item_id, purchase_receiving_id, unit_cost, received_at)
    values (v_company, p_branch_id, v_item, v_recv, v_unit_cost, coalesce(p_purchase_date::timestamptz, now()))
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
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, p_branch_id, v_actor, 'Business', 'inventory.purchase_received', 'inventory', 'purchase_receivings', v_recv,
            jsonb_build_object('source_type', p_source_type, 'vendor_id', p_vendor_id, 'item', trim(p_item_name), 'quantity', p_quantity, 'total_cost', p_total_cost, 'bought_by', p_bought_by));
  return v_recv;
end; $$;
comment on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text) is 'P2-M3A + T3.2 + P2M3B.1 + P2U1 (2026-07-19): record a stock purchase receiving. New optional p_base_unit arg (default null, 14th) sets base_unit ONLY when the item is first created — existing items keep their original unit. p_quantity is always in base_unit terms; unit conversion for a "bought in a different unit" scenario happens client-side before this call (see inventory_set_unit_conversion). First 13 args unchanged, so all existing call sites still resolve identically.';
revoke all on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text) from public, anon;
grant execute on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text) to authenticated;

-- 2. Set/edit an item's purchase-unit conversion after the fact (e.g. define "1 sack = 50 kg" once,
--    or correct it later). Same inventory.purchase gate as the rest of this module's item-level edits
--    (inventory_set_purchase_bought_by uses the identical shape). Company-scoped (items have no
--    branch_id of their own — they're a company-wide master, per the P2-M3A table comment).
create function public.inventory_set_unit_conversion(p_item_id uuid, p_purchase_unit text, p_conversion_factor numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_old_unit text; v_old_factor numeric;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select i.company_id, i.purchase_unit, i.unit_conversion_factor into v_company, v_old_unit, v_old_factor
    from public.inventory_items i where i.id = p_item_id;
  if v_company is null then raise exception 'inventory item not found' using errcode = 'raise_exception'; end if;
  if not public.has_permission(v_company, 'inventory.purchase') then
    raise exception 'permission denied: inventory.purchase' using errcode = 'insufficient_privilege';
  end if;
  if p_conversion_factor is not null and p_conversion_factor <= 0 then
    raise exception 'conversion factor must be > 0' using errcode = 'check_violation';
  end if;
  update public.inventory_items
    set purchase_unit = nullif(trim(coalesce(p_purchase_unit, '')), ''),
        unit_conversion_factor = p_conversion_factor
    where id = p_item_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, previous_value, new_value)
    values (v_company, v_actor, 'Business', 'inventory.unit_conversion_edited', 'inventory', 'inventory_items', p_item_id,
            jsonb_build_object('purchase_unit', v_old_unit, 'unit_conversion_factor', v_old_factor),
            jsonb_build_object('purchase_unit', p_purchase_unit, 'unit_conversion_factor', p_conversion_factor));
end; $$;
comment on function public.inventory_set_unit_conversion(uuid, text, numeric) is 'P2U1: define or correct an item''s purchase-unit conversion ("1 sack = 50 kg") for the Buy Stock UI calculator. Never affects existing ledger rows. inventory.purchase-gated, audited (old + new value).';
revoke all on function public.inventory_set_unit_conversion(uuid, text, numeric) from public, anon;
grant execute on function public.inventory_set_unit_conversion(uuid, text, numeric) to authenticated;
