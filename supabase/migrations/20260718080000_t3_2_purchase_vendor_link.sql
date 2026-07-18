-- Migration T3.2 (owner directive 2026-07-19) — Tier 3 follow-on: link a Buy Stock purchase to a
-- registered Vendor. Ported verbatim from Repo B (20260716180000_t3_2_purchase_vendor_link.sql,
-- guard 7/7, cloud-verified) — confirmed fully compatible: Repo A's current inventory_record_purchase
-- (20260703090000_p2m4a_accounting_core.sql) is byte-identical to what this migration assumes it's
-- evolving from (same 11-arg signature, same category->GL mapping), so no adaptation was needed here
-- (unlike P2N2, see that migration's header for the one place a verbatim port would have been wrong).
--
-- CURRENT STATE: purchase_receivings.source_type is CHECK-constrained to ('online', 'physical').
-- inventory_record_purchase validates `if p_source_type not in ('online', 'physical')`.
--
-- OWNER INTENT: a cashier/operator logging a physical purchase from a registered vendor should be
-- able to pick "Vendor" as the source and select the vendor from a dropdown. The receiving row
-- carries the vendor's name + contact automatically. The T3.1 vendor_invoice_record RPC is the
-- separate, formal AP-bill-posting flow — this migration only adds the source picker + a nullable
-- vendor_id FK so receivings are linked to the vendor master.
--
-- DESIGN (ADDITIVE):
--   - Drop & re-add the CHECK constraint to allow 'vendor' as a third source_type.
--   - Drop the existing 11-arg inventory_record_purchase and re-create it as a 12-arg function with
--     the SAME arg positions as before + a new optional p_vendor_id argument appended last (default
--     null), so existing call sites (guards, client) that pass only the first 11 args still resolve
--     and behave identically.
--   - Add nullable purchase_receivings.vendor_id (FK to vendors, on delete restrict).
--   - When p_vendor_id is provided, snapshot the vendor's name + contact into the receiving
--     (snapshot semantics — the receiving is a historical record; later vendor renames do not
--     propagate), mirroring the customer/branch snapshot pattern in P2-M2C.
--
-- AUTHORITY: 20.12 (receiving is the only stock entry path) · 22.03 (GL treatment by category) ·
--            AGENTS.md §2 (money-adjacent: cash-debit journal for stock purchases is unchanged; the
--            vendor_id column is a non-money link).
-- RISK: Low. Additive column, expanded enum value, optional FK with a default-NULL 12th arg.

-- 1. Add nullable vendor_id column
alter table public.purchase_receivings
  add column if not exists vendor_id uuid references public.vendors (id) on delete restrict;
create index if not exists purchase_receivings_vendor_idx
  on public.purchase_receivings (vendor_id) where vendor_id is not null;
comment on column public.purchase_receivings.vendor_id is 'T3.2 (2026-07-19): optional FK to vendors. Set when a Buy Stock entry is attributed to a registered vendor in the Vendors & AP module (T3.1). Receivings are historical records; the FK is set on insert and never re-resolved.';

-- 2. Expand the source_type CHECK to allow 'vendor'
alter table public.purchase_receivings drop constraint if exists purchase_receivings_source_type_check;
alter table public.purchase_receivings add constraint purchase_receivings_source_type_check
  check (source_type in ('online', 'physical', 'vendor'));

-- 3. Drop the old 11-arg overload before recreating with the 12-arg signature.
drop function if exists public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text);

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
  p_vendor_id           uuid default null
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
    insert into public.inventory_items (id, company_id, category_id, item_code, name, inventory_type)
      values (public.uuidv7(), v_company, v_cat,
              upper(v_key) || '-' || substr(replace(public.uuidv7()::text, '-', ''), 1, 8),
              trim(p_item_name),
              case when p_is_equipment then 'Equipment' else 'Consumable' end)
      returning id into v_item;
  end if;

  v_unit_cost := round(p_total_cost / p_quantity, 2);
  insert into public.purchase_receivings (
    company_id, branch_id, item_id, quantity, total_amount,
    source_type, source_name, source_contact,
    received_date, received_by, idempotency_key, vendor_id
  ) values (
    v_company, p_branch_id, v_item, p_quantity, p_total_cost,
    p_source_type,
    case when p_source_type = 'vendor' and p_vendor_id is not null then v_vendor_name
         else coalesce(nullif(trim(p_source_name), ''), 'Local Supplier') end,
    case when p_source_type = 'vendor' and p_vendor_id is not null then v_vendor_contact
         else nullif(trim(coalesce(p_source_contact, '')), '') end,
    coalesce(p_purchase_date, now()::date), v_actor, p_idempotency_key, p_vendor_id
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
            jsonb_build_object('source_type', p_source_type, 'vendor_id', p_vendor_id, 'item', trim(p_item_name), 'quantity', p_quantity, 'total_cost', p_total_cost));
  return v_recv;
end; $$;
comment on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid) is 'P2-M3A + T3.2 (2026-07-19): record a stock purchase receiving. New optional p_vendor_id arg (default null) appended as the 12th arg links the receiving to a registered vendor; when set, source_name + source_contact are snapshotted from the vendor master. The first 11 args are unchanged, so all existing call sites (guards, client) still resolve identically.';
revoke all on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid) from public, anon;
grant execute on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid) to authenticated;
