-- Migration P2-M3A — Materials & Equipment Inventory Spine (Phase 2, Module 3A)
-- Authority: Phase_2_M3_Inventory_Module_Spec.md (reconciled) · prototype src/features/Inventory.tsx =
--   workflow-logic authority (owner 2026-07-02) · Systems 20.07 item master / 20.08 batches+FIFO / 20.09 movement
--   ledger / 20.12 receiving / 20.25 equipment / 22.16 inventory-accounting sync = structural authority.
-- Core rules honored: the item master defines identity, NEVER quantity (20.07); stock changes ONLY via a receiving
--   + movement (20.12); balances are DERIVED from the ledger (20.09 — the locked M2A `inventory_movements` table is
--   REUSED as the single ledger via additive alter); FIFO consumption (20.08); adjustments need a mandatory reason
--   (20.09); purchases post atomically to the GL (22.16/22.06: Dr RAW_MATERIALS|EQUIPMENT / Cr CASH — mock pays
--   cash; AP arrives with Accounting). Deferred (spec §2): PO approval workflow, business_partners, unit
--   conversion, expiration, transfers, depreciation.
-- Pattern: ADDITIVE ONLY — locked files untouched; ledger evolved via alter (M2C/M2E pattern). Risk: High
--   (inventory + GL). All writes function-only, append-only ledger, balanced postings.

-- ── Permission catalog additions (26.09-additive; inventory.adjust exists since M2A) ──
insert into public.permissions (permission_key, description) values
  ('inventory.purchase', 'Record material/equipment purchases into inventory (receiving; audited)'),
  ('equipment.manage',   'Register equipment and log condition checklists')
on conflict (permission_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. item_categories (20.07) — seeded with the mock''s categories per company (chart-of-accounts pattern).
-- ════════════════════════════════════════════════════════════════════════════
create table public.item_categories (
  id           uuid primary key default public.uuidv7(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  category_key text not null,
  name         text not null,
  status       text not null default 'Active' check (status in ('Active', 'Archived')),
  created_at   timestamptz not null default now(),
  unique (company_id, category_key),
  unique (id, company_id)
);
comment on table public.item_categories is 'Material categories (P2-M3A, 20.07). Company-scoped; seeded by inventory_ensure_categories with the prototype''s set; member-read; function-written.';
alter table public.item_categories enable row level security;
alter table public.item_categories force row level security;
revoke all on public.item_categories from public, anon, authenticated, service_role;
grant select on public.item_categories to authenticated;
create policy item_categories_select_member on public.item_categories for select to authenticated
  using (company_id in (select public.accessible_company_ids()));

create function public.inventory_ensure_categories(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.item_categories (company_id, category_key, name) values
    (p_company, 'seeds',     'Seeds/Seedlings'),
    (p_company, 'substrate', 'Substrate & Nutrients'),
    (p_company, 'packaging', 'Packaging'),
    (p_company, 'utilities', 'Water/Electricity'),
    (p_company, 'transport', 'Transport'),
    (p_company, 'misc',      'Miscellaneous'),
    (p_company, 'equipment', 'Equipment')
  on conflict (company_id, category_key) do nothing;
end; $$;
revoke all on function public.inventory_ensure_categories(uuid) from public;
grant execute on function public.inventory_ensure_categories(uuid) to authenticated;

-- GL accounts the module posts to (extends the M2B chart idempotently).
create function public.inventory_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.pos_ensure_accounts(p_company);  -- CASH etc.
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance) values
    (p_company, 'RAW_MATERIALS', 'Raw Materials Inventory', 'Asset',   'debit'),
    (p_company, 'EQUIPMENT',     'Equipment Assets',        'Asset',   'debit'),
    (p_company, 'SHRINKAGE',     'Inventory Shrinkage',     'Expense', 'debit')
  on conflict (company_id, account_code) do nothing;
end; $$;
revoke all on function public.inventory_ensure_accounts(uuid) from public;
grant execute on function public.inventory_ensure_accounts(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. inventory_items (20.07) — the materials master: identity only, never quantity.
--    (Finished goods stay on the locked M2A products/finished_goods spine — spec §2.)
-- ════════════════════════════════════════════════════════════════════════════
create table public.inventory_items (
  id             uuid primary key default public.uuidv7(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  category_id    uuid not null,
  item_code      text not null,
  name           text not null,
  inventory_type text not null default 'Consumable' check (inventory_type in ('Consumable', 'Equipment')),
  base_unit      text not null default 'pcs',
  reorder_level  numeric(12, 3) not null default 10 check (reorder_level >= 0),  -- mock low-stock limit default
  status         text not null default 'Active' check (status in ('Active', 'Inactive', 'Archived')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, item_code),
  unique (id, company_id),
  foreign key (category_id, company_id) references public.item_categories (id, company_id) on delete restrict
);
comment on table public.inventory_items is 'Materials item master (P2-M3A, 20.07). Identity only — balances derive from the movement ledger. Find-or-created by inventory_record_purchase; reorder_level = the mock''s low-stock limit.';
create index inventory_items_company_idx on public.inventory_items (company_id, category_id);
create trigger inventory_items_set_updated_at before update on public.inventory_items for each row execute function public.set_updated_at();
create trigger inventory_items_audit after insert or update on public.inventory_items for each row execute function public.inventory_audit();
alter table public.inventory_items enable row level security;
alter table public.inventory_items force row level security;
revoke all on public.inventory_items from public, anon, authenticated, service_role;
grant select on public.inventory_items to authenticated;
grant update (reorder_level) on public.inventory_items to authenticated;   -- the mock''s configurable limit; audited
create policy inventory_items_select_member on public.inventory_items for select to authenticated
  using (company_id in (select public.accessible_company_ids()));
create policy inventory_items_update_adjust on public.inventory_items for update to authenticated
  using (public.has_permission(company_id, 'inventory.adjust'))
  with check (public.has_permission(company_id, 'inventory.adjust'));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. purchase_receivings (20.12) — stock enters ONLY through a receiving. Minimal direct-receiving header
--    (single-line, mock parity); purchase_order_id reserved for the future PO workflow; supplier snapshot
--    columns until the 20.11 partners master ships (spec §2).
-- ════════════════════════════════════════════════════════════════════════════
create table public.purchase_receivings (
  id                uuid primary key default public.uuidv7(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  branch_id         uuid not null,
  item_id           uuid not null,
  quantity          numeric(12, 3) not null check (quantity > 0),
  total_amount      numeric(14, 2) not null check (total_amount > 0),
  source_type       text not null check (source_type in ('online', 'physical')),
  source_name       text not null,
  source_contact    text,
  received_date     date not null,
  received_by       uuid references public.users (id) on delete restrict,
  purchase_order_id uuid,             -- reserved: PO/approval workflow (deferred)
  supplier_id       uuid,             -- reserved: 20.11 business_partners (deferred)
  idempotency_key   text,
  created_at        timestamptz not null default now(),
  unique (id, company_id),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict,
  foreign key (item_id, company_id)   references public.inventory_items (id, company_id) on delete restrict
);
create unique index purchase_receivings_idem_uq on public.purchase_receivings (company_id, idempotency_key) where idempotency_key is not null;
create index purchase_receivings_branch_idx on public.purchase_receivings (branch_id, company_id);
comment on table public.purchase_receivings is 'Verified stock entry (P2-M3A, 20.12): inventory never increases without a receiving + movement. Written only by inventory_record_purchase; idempotent (B5); source snapshotted pending the partners master.';
alter table public.purchase_receivings enable row level security;
alter table public.purchase_receivings force row level security;
revoke all on public.purchase_receivings from public, anon, authenticated, service_role;
grant select on public.purchase_receivings to authenticated;
create policy purchase_receivings_select_member on public.purchase_receivings for select to authenticated
  using (public.is_branch_member(branch_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 4. material_batches (20.08) — FIFO lots. NO remaining-quantity column: derived from the ledger (M2A pattern).
-- ════════════════════════════════════════════════════════════════════════════
create table public.material_batches (
  id                    uuid primary key default public.uuidv7(),
  company_id            uuid not null references public.companies (id) on delete restrict,
  branch_id             uuid not null,
  item_id               uuid not null,
  purchase_receiving_id uuid,          -- null = adjustment-found stock (zero cost)
  unit_cost             numeric(12, 2) not null default 0 check (unit_cost >= 0),
  received_at           timestamptz not null default now(),
  status                text not null default 'Available' check (status in ('Available', 'Consumed', 'Expired', 'Damaged', 'Archived')),
  created_at            timestamptz not null default now(),
  unique (id, company_id),
  foreign key (branch_id, company_id)             references public.branches (id, company_id)           on delete restrict,
  foreign key (item_id, company_id)               references public.inventory_items (id, company_id)    on delete restrict,
  foreign key (purchase_receiving_id, company_id) references public.purchase_receivings (id, company_id) on delete restrict
);
create index material_batches_fifo_idx on public.material_batches (item_id, branch_id, received_at);
comment on table public.material_batches is 'Material FIFO lots (P2-M3A, 20.08). Quantity DERIVED from inventory_movements (never stored); oldest received_at consumed first. Function-only writes.';
alter table public.material_batches enable row level security;
alter table public.material_batches force row level security;
revoke all on public.material_batches from public, anon, authenticated, service_role;
grant select on public.material_batches to authenticated;
create policy material_batches_select_member on public.material_batches for select to authenticated
  using (public.is_branch_member(branch_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 5. THE ledger (20.09): evolve the locked M2A inventory_movements additively into the single company-wide
--    movement ledger — materials rows carry item_id + material_batch_id; finished-goods rows keep their batch.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.inventory_movements add column item_id uuid;
alter table public.inventory_movements add column material_batch_id uuid;
alter table public.inventory_movements alter column finished_goods_batch_id drop not null;
alter table public.inventory_movements add constraint inventory_movements_one_domain_chk
  check (((finished_goods_batch_id is not null)::int + (material_batch_id is not null)::int) = 1);
alter table public.inventory_movements add constraint inventory_movements_item_fk
  foreign key (item_id, company_id) references public.inventory_items (id, company_id) on delete restrict;
alter table public.inventory_movements add constraint inventory_movements_material_batch_fk
  foreign key (material_batch_id, company_id) references public.material_batches (id, company_id) on delete restrict;
alter table public.inventory_movements drop constraint inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check
  check (movement_type in ('Opening', 'Sales', 'AdjustmentIncrease', 'AdjustmentDecrease', 'Disposal', 'Reserve', 'Unreserve', 'PurchaseReceiving'));
create index inventory_movements_item_idx on public.inventory_movements (item_id, branch_id) where item_id is not null;

-- Derived balances (20.09: calculated, never entered).
create function public.material_available(p_item_id uuid, p_branch_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case
    when m.movement_type in ('Opening', 'AdjustmentIncrease', 'Unreserve', 'PurchaseReceiving') then m.quantity
    when m.movement_type in ('Sales', 'AdjustmentDecrease', 'Disposal', 'Reserve') then -m.quantity
    else 0 end), 0)
  from public.inventory_movements m
  where m.item_id = p_item_id and m.branch_id = p_branch_id
$$;
revoke all on function public.material_available(uuid, uuid) from public;
grant execute on function public.material_available(uuid, uuid) to authenticated;

create function public.material_batch_available(p_batch_id uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case
    when m.movement_type in ('Opening', 'AdjustmentIncrease', 'Unreserve', 'PurchaseReceiving') then m.quantity
    when m.movement_type in ('Sales', 'AdjustmentDecrease', 'Disposal', 'Reserve') then -m.quantity
    else 0 end), 0)
  from public.inventory_movements m
  where m.material_batch_id = p_batch_id
$$;
revoke all on function public.material_batch_available(uuid) from public;
grant execute on function public.material_batch_available(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. equipment_assets + maintenance logs (20.25, mock checklist parity). Depreciation/IoT deferred.
-- ════════════════════════════════════════════════════════════════════════════
create table public.equipment_assets (
  id                    uuid primary key default public.uuidv7(),
  company_id            uuid not null references public.companies (id) on delete restrict,
  branch_id             uuid not null,
  asset_code            text not null,
  name                  text not null,
  purchase_date         date,
  purchase_cost         numeric(14, 2) not null default 0 check (purchase_cost >= 0),
  condition             text not null default 'Good' check (condition in ('Good', 'Needs Maintenance', 'Broken', 'Retired')),
  purchase_receiving_id uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (company_id, asset_code),
  unique (id, company_id),
  foreign key (branch_id, company_id)             references public.branches (id, company_id)            on delete restrict,
  foreign key (purchase_receiving_id, company_id) references public.purchase_receivings (id, company_id) on delete restrict
);
comment on table public.equipment_assets is 'Equipment/asset registry (P2-M3A, 20.25). Auto-registered by Equipment purchases; condition maintained by equipment_log_check. Function-only writes.';
create trigger equipment_assets_set_updated_at before update on public.equipment_assets for each row execute function public.set_updated_at();
create trigger equipment_assets_audit after insert or update on public.equipment_assets for each row execute function public.inventory_audit();
alter table public.equipment_assets enable row level security;
alter table public.equipment_assets force row level security;
revoke all on public.equipment_assets from public, anon, authenticated, service_role;
grant select on public.equipment_assets to authenticated;
create policy equipment_assets_select_member on public.equipment_assets for select to authenticated
  using (public.is_branch_member(branch_id));

create table public.equipment_maintenance_logs (
  id                uuid primary key default public.uuidv7(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  equipment_id      uuid not null,
  working           boolean not null,
  needs_maintenance boolean not null default false,
  performed_by_name text not null,
  actor_user_id     uuid references public.users (id) on delete restrict,
  performed_date    timestamptz not null default now(),
  notes             text,
  created_at        timestamptz not null default now(),
  foreign key (equipment_id, company_id) references public.equipment_assets (id, company_id) on delete restrict
);
create index equipment_maintenance_logs_asset_idx on public.equipment_maintenance_logs (equipment_id, company_id);
comment on table public.equipment_maintenance_logs is 'Condition-checklist history (P2-M3A, 20.25/mock). Append-only in practice: no client write grants; written only by equipment_log_check.';
alter table public.equipment_maintenance_logs enable row level security;
alter table public.equipment_maintenance_logs force row level security;
revoke all on public.equipment_maintenance_logs from public, anon, authenticated, service_role;
grant select on public.equipment_maintenance_logs to authenticated;
create policy equipment_maintenance_logs_select_member on public.equipment_maintenance_logs for select to authenticated
  using (company_id in (select public.accessible_company_ids()));

-- ════════════════════════════════════════════════════════════════════════════
-- 7. inventory_record_purchase — the governed direct receiving (20.12): ONE atomic tx = receiving + item
--    find-or-create + FIFO batch + PurchaseReceiving movement + balanced GL + (Equipment) asset + audit.
-- ════════════════════════════════════════════════════════════════════════════
create function public.inventory_record_purchase(
  p_branch_id uuid, p_category_key text, p_item_name text, p_is_equipment boolean,
  p_quantity numeric, p_total_cost numeric,
  p_source_type text, p_source_name text, p_source_contact text,
  p_purchase_date date, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_cat uuid; v_item uuid; v_recv uuid; v_batch uuid; v_asset uuid;
  v_key text; v_unit_cost numeric; v_entry uuid; a_debit uuid; a_cash uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'inventory.purchase') then raise exception 'permission denied: inventory.purchase' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be > 0' using errcode = 'check_violation'; end if;
  if p_total_cost is null or p_total_cost <= 0 then raise exception 'purchase cost must be > 0' using errcode = 'check_violation'; end if;
  if p_source_type not in ('online', 'physical') then raise exception 'invalid source type' using errcode = 'check_violation'; end if;
  if p_item_name is null or length(trim(p_item_name)) = 0 then raise exception 'item name is required' using errcode = 'check_violation'; end if;

  select r.id into v_existing from public.purchase_receivings r
    where r.company_id = v_company and r.idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;  -- B5: at-most-once

  perform public.inventory_ensure_categories(v_company);
  perform public.inventory_ensure_accounts(v_company);
  v_key := case when p_is_equipment then 'equipment' else coalesce(p_category_key, 'misc') end;
  select c.id into v_cat from public.item_categories c where c.company_id = v_company and c.category_key = v_key;
  if v_cat is null then raise exception 'unknown material category %', v_key using errcode = 'check_violation'; end if;

  -- item master: find-or-create by (category, name) — identity only (20.07)
  select i.id into v_item from public.inventory_items i
    where i.company_id = v_company and i.category_id = v_cat and lower(i.name) = lower(trim(p_item_name));
  if v_item is null then
    insert into public.inventory_items (company_id, category_id, item_code, name, inventory_type)
      values (v_company, v_cat,
              upper(v_key) || '-' || substr(replace(public.uuidv7()::text, '-', ''), 1, 8),
              trim(p_item_name),
              case when p_is_equipment then 'Equipment' else 'Consumable' end)
      returning id into v_item;
  end if;

  v_unit_cost := round(p_total_cost / p_quantity, 2);
  insert into public.purchase_receivings (company_id, branch_id, item_id, quantity, total_amount, source_type, source_name, source_contact, received_date, received_by, idempotency_key)
    values (v_company, p_branch_id, v_item, p_quantity, p_total_cost, p_source_type, coalesce(nullif(trim(p_source_name), ''), 'Local Supplier'), nullif(trim(coalesce(p_source_contact, '')), ''), coalesce(p_purchase_date, now()::date), v_actor, p_idempotency_key)
    returning id into v_recv;
  insert into public.material_batches (company_id, branch_id, item_id, purchase_receiving_id, unit_cost, received_at)
    values (v_company, p_branch_id, v_item, v_recv, v_unit_cost, coalesce(p_purchase_date::timestamptz, now()))
    returning id into v_batch;
  insert into public.inventory_movements (company_id, branch_id, item_id, material_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, actor_user_id)
    values (v_company, p_branch_id, v_item, v_batch, 'PurchaseReceiving', p_quantity, v_unit_cost, p_total_cost, 'PurchaseReceiving', v_recv, v_actor);

  -- 22.16: physical AND financial impact — Dr asset account / Cr Cash, balanced, atomic
  select id into a_debit from public.chart_of_accounts where company_id = v_company and account_code = case when p_is_equipment then 'EQUIPMENT' else 'RAW_MATERIALS' end;
  select id into a_cash  from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'PurchaseReceiving', v_recv,
            case when p_is_equipment then 'Equipment purchase' else 'Materials purchase' end, v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_debit, p_total_cost, 0),
    (v_company, v_entry, a_cash, 0, p_total_cost);

  if p_is_equipment then
    insert into public.equipment_assets (company_id, branch_id, asset_code, name, purchase_date, purchase_cost, purchase_receiving_id)
      values (v_company, p_branch_id,
              'EQ-' || substr(replace(public.uuidv7()::text, '-', ''), 1, 8),
              trim(p_item_name), coalesce(p_purchase_date, now()::date), p_total_cost, v_recv)
      returning id into v_asset;
  end if;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Business', 'inventory.purchase_received', 'inventory', 'purchase_receivings', v_recv);
  return v_recv;
end; $$;
comment on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text) is 'P2-M3A: governed direct receiving (20.12) — receiving + item find-or-create + FIFO batch + movement + balanced GL (Dr RAW_MATERIALS|EQUIPMENT / Cr CASH) + equipment asset; inventory.purchase + branch member; idempotent; audited.';
revoke all on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text) from public;
grant execute on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. inventory_adjust_material — the mock''s audit adjustment under 20.09 protection: reason MANDATORY;
--    increase = zero-cost found-stock batch (conservative); decrease = FIFO drain (oldest batch first, one
--    movement per batch) + Dr SHRINKAGE / Cr RAW_MATERIALS at consumed FIFO cost. Returns the new balance.
-- ════════════════════════════════════════════════════════════════════════════
create function public.inventory_adjust_material(
  p_branch_id uuid, p_item_id uuid, p_qty_delta numeric, p_reason text, p_idempotency_key text
) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_batch uuid; v_avail numeric; v_need numeric; v_take numeric;
  v_shrink numeric := 0; v_entry uuid; a_shrink uuid; a_raw uuid; r record; v_first boolean := true;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'inventory.adjust') then raise exception 'permission denied: inventory.adjust' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'an adjustment reason is required' using errcode = 'check_violation'; end if;
  if p_qty_delta is null or p_qty_delta = 0 then raise exception 'adjustment quantity must be non-zero' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.inventory_items i where i.id = p_item_id and i.company_id = v_company) then
    raise exception 'unknown item' using errcode = 'foreign_key_violation';
  end if;
  if exists (select 1 from public.inventory_movements m where m.company_id = v_company and m.idempotency_key = p_idempotency_key) then
    return public.material_available(p_item_id, p_branch_id);  -- B5 replay
  end if;

  if p_qty_delta > 0 then
    insert into public.material_batches (company_id, branch_id, item_id, unit_cost)  -- found stock: zero cost
      values (v_company, p_branch_id, p_item_id, 0) returning id into v_batch;
    insert into public.inventory_movements (company_id, branch_id, item_id, material_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, idempotency_key, reason, actor_user_id)
      values (v_company, p_branch_id, p_item_id, v_batch, 'AdjustmentIncrease', p_qty_delta, 0, 0, 'Adjustment', p_idempotency_key, p_reason, v_actor);
  else
    v_need := -p_qty_delta;
    v_avail := public.material_available(p_item_id, p_branch_id);
    if v_avail < v_need then raise exception 'adjustment exceeds available stock (% < %)', v_avail, v_need using errcode = 'check_violation'; end if;
    for r in select mb.id, mb.unit_cost from public.material_batches mb
             where mb.item_id = p_item_id and mb.branch_id = p_branch_id and mb.status = 'Available'
             order by mb.received_at, mb.created_at loop
      exit when v_need <= 0;
      v_avail := public.material_batch_available(r.id);
      if v_avail <= 0 then continue; end if;
      v_take := least(v_avail, v_need);
      insert into public.inventory_movements (company_id, branch_id, item_id, material_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, idempotency_key, reason, actor_user_id)
        values (v_company, p_branch_id, p_item_id, r.id, 'AdjustmentDecrease', v_take, r.unit_cost, round(v_take * r.unit_cost, 2), 'Adjustment',
                case when v_first then p_idempotency_key else null end, p_reason, v_actor);
      v_first := false;
      v_shrink := v_shrink + round(v_take * r.unit_cost, 2);
      v_need := v_need - v_take;
    end loop;
    if v_shrink > 0 then  -- 22.16: financial impact of the physical loss, at FIFO cost
      perform public.inventory_ensure_accounts(v_company);
      select id into a_shrink from public.chart_of_accounts where company_id = v_company and account_code = 'SHRINKAGE';
      select id into a_raw    from public.chart_of_accounts where company_id = v_company and account_code = 'RAW_MATERIALS';
      v_entry := public.uuidv7();
      insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, description, created_by)
        values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'Adjustment', 'Inventory shrinkage: ' || p_reason, v_actor);
      insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
        (v_company, v_entry, a_shrink, v_shrink, 0),
        (v_company, v_entry, a_raw, 0, v_shrink);
    end if;
  end if;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, p_branch_id, v_actor, 'Administrative', 'inventory.adjusted', 'inventory', 'inventory_items', p_item_id,
            jsonb_build_object('delta', p_qty_delta, 'reason', p_reason));
  return public.material_available(p_item_id, p_branch_id);
end; $$;
comment on function public.inventory_adjust_material(uuid, uuid, numeric, text, text) is 'P2-M3A: audited material adjustment (20.09 protection) — reason mandatory; increase = zero-cost batch; decrease = FIFO drain + shrinkage posting at consumed cost; idempotent (B5).';
revoke all on function public.inventory_adjust_material(uuid, uuid, numeric, text, text) from public;
grant execute on function public.inventory_adjust_material(uuid, uuid, numeric, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. equipment_log_check — the mock''s condition checklist: append log + update condition. equipment.manage.
-- ════════════════════════════════════════════════════════════════════════════
create function public.equipment_log_check(
  p_asset_id uuid, p_working boolean, p_needs_maintenance boolean, p_inspector text, p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_branch uuid; v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select a.company_id, a.branch_id into v_company, v_branch from public.equipment_assets a where a.id = p_asset_id;
  if v_company is null then raise exception 'asset not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'equipment.manage') then raise exception 'permission denied: equipment.manage' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(v_branch) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_inspector is null or length(trim(p_inspector)) = 0 then raise exception 'inspector name is required' using errcode = 'check_violation'; end if;

  insert into public.equipment_maintenance_logs (company_id, equipment_id, working, needs_maintenance, performed_by_name, actor_user_id, notes)
    values (v_company, p_asset_id, p_working, coalesce(p_needs_maintenance, false), trim(p_inspector), v_actor, nullif(trim(coalesce(p_notes, '')), ''));
  update public.equipment_assets
     set condition = case when not p_working then 'Broken' when p_needs_maintenance then 'Needs Maintenance' else 'Good' end
   where id = p_asset_id;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_branch, v_actor, 'Business', 'equipment.checked', 'inventory', 'equipment_assets', p_asset_id,
            jsonb_build_object('working', p_working, 'needs_maintenance', p_needs_maintenance, 'inspector', trim(p_inspector)));
end; $$;
comment on function public.equipment_log_check(uuid, boolean, boolean, text, text) is 'P2-M3A: equipment condition checklist (20.25/mock) — appends the inspection log and updates asset condition. equipment.manage + branch member; audited.';
revoke all on function public.equipment_log_check(uuid, boolean, boolean, text, text) from public;
grant execute on function public.equipment_log_check(uuid, boolean, boolean, text, text) to authenticated;
