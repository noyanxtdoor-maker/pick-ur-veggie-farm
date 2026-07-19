-- Migration P2ED1 — Equipment depreciation / asset book-value tracking (owner backlog item,
-- confirmed NOT built in the earlier audit). P2-M3A's own migration header already flagged this:
-- "Depreciation/IoT fields deferred."
--
-- SCOPE DECISION (read before extending this): this migration tracks the depreciation INPUTS
-- (useful life, salvage value) and exposes a DERIVED, read-only estimated book value — computed
-- on-the-fly with straight-line depreciation, matching the "balance is derived, never stored"
-- philosophy used everywhere else in this module (material_available, fg_available, etc.). It does
-- **NOT** post periodic depreciation journal entries (Dr Depreciation Expense / Cr Accumulated
-- Depreciation). That would require: a contra-asset ACCUMULATED_DEPRECIATION account, a periodic
-- (monthly) closing process, and some scheduled-invocation mechanism — none of which exist anywhere
-- in this app today (there is no cron/scheduled-RPC infrastructure at all). Building that is a real,
-- separate accounting-subsystem decision (C7 §4 financial integrity gate), not a quiet addition here.
-- "Equipment depreciation / asset tracking" as asked for is satisfied by an honest, always-current
-- estimated book value the owner can see per asset — not a full GAAP accrual pipeline.
--
-- DESIGN:
--   equipment_assets gains useful_life_months (nullable int — null = not yet configured, no
--   depreciation estimate shown) and salvage_value (numeric, default 0).
--   equipment_book_value(p_asset_id) — pure SQL, straight-line: purchase_cost minus
--   (elapsed_months / useful_life_months, capped at 1.0) * (purchase_cost - salvage_value). Returns
--   purchase_cost unchanged when useful_life_months is null (nothing configured) or purchase_date is
--   null (can't compute elapsed time) — never null, never negative, never below salvage_value.
--   equipment_set_depreciation(p_asset_id, p_useful_life_months, p_salvage_value) — equipment.manage
--   gated. salvage_value must be <= purchase_cost (a salvage value higher than what the asset cost
--   is nonsensical). The existing equipment_assets_audit trigger (inventory_audit()) already fires
--   on this UPDATE automatically — no manual audit insert needed, matching every other write to this
--   table (e.g. equipment_log_check's condition updates).
--
-- PERMISSION: reuses equipment.manage (already gates every other equipment_assets write) — no new
-- permission key, C1 §4.
--
-- Authority: Phase_2_M3_Inventory_Module_Spec.md's own "Depreciation/IoT fields deferred" note.
-- Risk: Low — two nullable/defaulted columns, one pure derived-value function, one narrow setter.
-- Never touches the ledger, GL, or any existing balance computation.

alter table public.equipment_assets add column useful_life_months int check (useful_life_months is null or useful_life_months > 0);
alter table public.equipment_assets add column salvage_value numeric(12,2) not null default 0 check (salvage_value >= 0);
comment on column public.equipment_assets.useful_life_months is 'P2ED1: straight-line depreciation period in months. Null = not configured, no book-value estimate shown.';
comment on column public.equipment_assets.salvage_value is 'P2ED1: estimated residual value at the end of useful_life_months. Must be <= purchase_cost.';

create function public.equipment_book_value(p_asset_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select case
    when ea.useful_life_months is null or ea.purchase_date is null then ea.purchase_cost
    else round(
      ea.purchase_cost - least(
        greatest(extract(year from age(current_date, ea.purchase_date))::int * 12 + extract(month from age(current_date, ea.purchase_date))::int, 0)::numeric / ea.useful_life_months,
        1
      ) * (ea.purchase_cost - ea.salvage_value)
    , 2)
  end
  from public.equipment_assets ea where ea.id = p_asset_id
$$;
comment on function public.equipment_book_value(uuid) is 'P2ED1: derived straight-line estimated book value, never stored. Returns purchase_cost unchanged when useful_life_months or purchase_date is unset. Floors at salvage_value once fully depreciated.';
revoke all on function public.equipment_book_value(uuid) from public, anon;
grant execute on function public.equipment_book_value(uuid) to authenticated;

create function public.equipment_set_depreciation(p_asset_id uuid, p_useful_life_months int, p_salvage_value numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid; v_cost numeric;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ea.company_id, ea.purchase_cost into v_company, v_cost from public.equipment_assets ea where ea.id = p_asset_id;
  if v_company is null then raise exception 'equipment asset not found' using errcode = 'raise_exception'; end if;
  if not public.has_permission(v_company, 'equipment.manage') then
    raise exception 'permission denied: equipment.manage' using errcode = 'insufficient_privilege';
  end if;
  if p_useful_life_months is not null and p_useful_life_months <= 0 then
    raise exception 'useful life must be a positive number of months' using errcode = 'check_violation';
  end if;
  if p_salvage_value is null or p_salvage_value < 0 then
    raise exception 'salvage value cannot be negative' using errcode = 'check_violation';
  end if;
  if p_salvage_value > v_cost then
    raise exception 'salvage value cannot exceed the asset''s purchase cost' using errcode = 'check_violation';
  end if;
  update public.equipment_assets set useful_life_months = p_useful_life_months, salvage_value = p_salvage_value where id = p_asset_id;
end; $$;
comment on function public.equipment_set_depreciation(uuid, int, numeric) is 'P2ED1: set/correct an asset''s depreciation inputs. equipment.manage-gated; salvage_value must be <= purchase_cost. Audited automatically via the existing equipment_assets_audit trigger.';
revoke all on function public.equipment_set_depreciation(uuid, int, numeric) from public, anon;
grant execute on function public.equipment_set_depreciation(uuid, int, numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- REAL BUG CAUGHT BY THIS MIGRATION'S OWN GUARD, NOT INVENTED: equipment_assets.asset_code has
-- carried the EXACT SAME collision flaw item_code had before P2U1 fixed it (2026-07-19, earlier
-- this pass) — `substr(replace(uuidv7()::text,'-',''),1,8)` is entirely the 48-bit millisecond
-- timestamp, not random at all, so two equipment purchases in the same millisecond are GUARANTEED
-- to collide on asset_code. P2U1 fixed inventory_items.item_code's identical bug but never touched
-- this second occurrence in the same function body. Confirmed live: this guard's own 3-equipment
-- fixture setup hit "duplicate key value violates unique constraint equipment_assets_company_id_
-- asset_code_key" until this fix landed. Same fix as P2U1: take the tail 8 hex chars (the genuinely
-- random part of rand_b) instead of the head. No argument-count change, so a plain create-or-replace
-- suffices — no DROP FUNCTION needed this time (unlike P2PO1's and P2ET1's evolutions, which each
-- added a new trailing arg).
-- ════════════════════════════════════════════════════════════════════════════
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
              'EQ-' || right(replace(public.uuidv7()::text, '-', ''), 8),
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
comment on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid, date) is 'P2-M3A + T3.2 + P2M3B.1 + P2U1 + P2PO1 + P2ET1 + P2ED1 (2026-07-20): record a stock purchase receiving. P2ED1 fixes equipment_assets.asset_code''s millisecond-collision bug (same class as P2U1''s item_code fix) — takes the tail 8 hex chars of uuidv7() instead of the head. No signature change from P2ET1''s version.';
revoke all on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid, date) from public, anon;
grant execute on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid, date) to authenticated;
