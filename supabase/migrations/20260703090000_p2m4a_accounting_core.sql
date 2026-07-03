-- Migration P2-M4A — Accounting Core (Phase 2, Module 4A)
-- Authority: Phase_2_M4_Accounting_Module_Spec.md (reconciled) · prototype src/features/Accounting.tsx =
--   workflow-logic authority (owner 2026-07-02) · Systems 22.02 financial boundary / 22.03 chart of accounts /
--   22.04/22.05 GL + double-entry / 22.06 automatic posting / 22.09 cash management / 22.22 statement generator /
--   22.24 audit trail & record lock / 26.09 permission matrix = structural authority.
-- Central finding (spec §1): V3 already has a REAL posted GL (journal_entries/journal_lines, built M2B, posted
--   automatically by every POS sale/settlement/void and every M3A purchase/adjustment). This module does NOT
--   recompute statements from raw source tables like the mock does — it (a) closes the one remaining posting gap
--   (non-operating cash movements) and (b) READS the real GL for statements. No parallel ledger.
-- Spec §3 fix (additive, small): M3A's inventory_record_purchase posted utilities/transport/misc to the
--   RAW_MATERIALS inventory asset — per 22.03 those are Operating Expense accounts, not inventory. Recreated here
--   (same drop+recreate pattern as M2C/M2E evolving pos_record_sale) so those 3 categories post to a new
--   OPERATING_EXPENSES account instead. seeds/substrate/packaging (COGS-bound, RAW_MATERIALS) and equipment
--   (EQUIPMENT) are UNCHANGED. inventory_adjust_material/FIFO/shrinkage logic is untouched.
-- Pattern: ADDITIVE ONLY — no locked file modified. Risk: High (new posting path + a correction to a live posting
--   function). All writes function-only, append-only correction (void, not delete — 22.24), balanced postings.

-- ── Permission catalog additions (26.09 Financial Authority — not granted to Operator/Employee by default) ──
insert into public.permissions (permission_key, description) values
  ('accounting.read',   'View accounting statements, dashboard, chart of accounts, and the cash ledger'),
  ('accounting.manage', 'Record and void non-operating cash movements (owner investment, loans, drawings)')
on conflict (permission_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Extend the shared chart-of-accounts seed (recreate; same idempotent upsert idiom as pos_ensure_accounts).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.inventory_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.pos_ensure_accounts(p_company);  -- CASH/SALES/COGS/FG_INVENTORY/AR
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance) values
    (p_company, 'RAW_MATERIALS',      'Raw Materials Inventory',   'Asset',   'debit'),
    (p_company, 'EQUIPMENT',          'Equipment Assets',          'Asset',   'debit'),
    (p_company, 'SHRINKAGE',          'Inventory Shrinkage',       'Expense', 'debit'),
    (p_company, 'OPERATING_EXPENSES', 'Operating Expenses',        'Expense', 'debit'),  -- P2-M4A: utilities/transport/misc (spec §3)
    (p_company, 'OWNER_EQUITY',       'Owner''s Equity',           'Equity',  'credit'),
    (p_company, 'LOANS_PAYABLE',      'Loans Payable',             'Liability','credit'),
    (p_company, 'OTHER_INCOME',       'Other Income',              'Revenue', 'credit')
  on conflict (company_id, account_code) do nothing;
end; $$;
comment on function public.inventory_ensure_accounts(uuid) is 'P2-M3A/M4A: idempotent chart-of-accounts seed for inventory + accounting (22.03). Extends pos_ensure_accounts.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. inventory_record_purchase — recreated: category-based GL treatment (spec §3). Same signature/behavior
--    otherwise (find-or-create item, FIFO batch, movement, equipment asset registration all unchanged).
-- ════════════════════════════════════════════════════════════════════════════
drop function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text);
create function public.inventory_record_purchase(
  p_branch_id uuid, p_category_key text, p_item_name text, p_is_equipment boolean,
  p_quantity numeric, p_total_cost numeric,
  p_source_type text, p_source_name text, p_source_contact text,
  p_purchase_date date, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_cat uuid; v_item uuid; v_recv uuid; v_batch uuid; v_asset uuid;
  v_key text; v_unit_cost numeric; v_entry uuid; a_debit_code text; a_debit uuid; a_cash uuid;
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

  -- 22.03/spec §3: category determines GL treatment — seeds/substrate/packaging = inventory asset (future COGS via
  -- Production consumption); utilities/transport/misc = immediate operating expense; equipment = fixed asset.
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
            case when p_is_equipment then 'Equipment purchase' when a_debit_code = 'OPERATING_EXPENSES' then 'Operating expense: ' || v_key else 'Materials purchase' end,
            v_actor, coalesce(p_purchase_date::timestamptz, now()));
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
comment on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text) is 'P2-M4A: evolved from M3A — category-based GL treatment (spec §3): seeds/substrate/packaging->RAW_MATERIALS, utilities/transport/misc->OPERATING_EXPENSES, equipment->EQUIPMENT. Otherwise unchanged (atomic receiving+item+batch+movement+asset; idempotent; audited).';
revoke all on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text) from public;
grant execute on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2b. record_opening_finished_goods — recreated: posts the missing GL entry (spec §3.1). M2A predates the GL
--     (M2B) and never posted opening stock at all — Dr FG_INVENTORY / Cr OWNER_EQUITY (capital contribution in
--     kind, the standard treatment for an ERP go-live conversion, ODR-001) whenever quantity×unit_cost > 0.
--     Skipped when the value is zero (a 0/0 journal line violates the existing balanced-line CHECK). Same
--     signature; idempotency/permission/validation behavior otherwise unchanged.
-- ════════════════════════════════════════════════════════════════════════════
drop function public.record_opening_finished_goods(uuid, uuid, text, numeric, numeric, text, text);
create function public.record_opening_finished_goods(
  p_branch_id uuid, p_product_id uuid, p_finished_goods_code text,
  p_quantity numeric, p_unit_cost numeric, p_idempotency_key text, p_reason text default 'Opening balance'
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid; v_actor uuid; v_fg uuid; v_existing uuid; v_value numeric;
  v_entry uuid; a_fg uuid; a_equity uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;

  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;

  if not public.has_permission(v_company, 'inventory.opening') then
    raise exception 'permission denied: inventory.opening' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(p_branch_id) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be > 0' using errcode = 'check_violation'; end if;

  -- Idempotency (B5): a retry with the same key returns the prior result, never a second opening.
  select m.finished_goods_batch_id into v_existing
  from public.inventory_movements m
  where m.company_id = v_company and m.idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  -- product must belong to this company (composite FK also enforces it on the finished-goods insert)
  insert into public.finished_goods_batches (company_id, branch_id, finished_goods_code, product_id, origin, cost_per_unit)
    values (v_company, p_branch_id, p_finished_goods_code, p_product_id, 'opening_balance', coalesce(p_unit_cost, 0))
    returning id into v_fg;

  insert into public.inventory_movements
    (company_id, branch_id, finished_goods_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, idempotency_key, reason, actor_user_id)
  values
    (v_company, p_branch_id, v_fg, 'Opening', p_quantity, coalesce(p_unit_cost, 0), coalesce(p_unit_cost, 0) * p_quantity, 'OpeningBalance', p_idempotency_key, p_reason, v_actor);

  v_value := coalesce(p_unit_cost, 0) * p_quantity;
  if v_value > 0 then
    perform public.inventory_ensure_accounts(v_company);
    select id into a_fg     from public.chart_of_accounts where company_id = v_company and account_code = 'FG_INVENTORY';
    select id into a_equity from public.chart_of_accounts where company_id = v_company and account_code = 'OWNER_EQUITY';
    v_entry := public.uuidv7();
    insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
      values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'OpeningBalance', v_fg, 'Opening finished-goods balance: ' || p_reason, v_actor);
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_fg, v_value, 0),
      (v_company, v_entry, a_equity, 0, v_value);
  end if;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Administrative', 'inventory.opening_balance', 'inventory', 'finished_goods_batches', v_fg);

  return v_fg;
end;
$$;
comment on function public.record_opening_finished_goods(uuid, uuid, text, numeric, numeric, text, text) is 'P2-M4A: evolved from M2A — now posts Dr FG_INVENTORY/Cr Owner''s Equity when quantity×unit_cost > 0 (spec §3.1: opening stock is a capital contribution in kind). Otherwise unchanged: inventory.opening + branch member; atomic + audited + idempotent.';
revoke all on function public.record_opening_finished_goods(uuid, uuid, text, numeric, numeric, text, text) from public;
grant execute on function public.record_opening_finished_goods(uuid, uuid, text, numeric, numeric, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. cash_entries (22.09) — non-operating cash movements (thin header, mirrors purchase_receivings). Append-only
--    lifecycle: corrections are a reversing void, never a delete (22.24).
-- ════════════════════════════════════════════════════════════════════════════
create table public.cash_entries (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  branch_id        uuid not null,
  entry_date       date not null,
  flow             text not null check (flow in ('in', 'out')),
  category         text not null check (category in ('Owner Investment', 'Other Income', 'Loan Received', 'Loan Payment', 'Owner''s Drawings')),
  description      text,
  amount           numeric(14, 2) not null check (amount > 0),
  status           text not null default 'Posted' check (status in ('Posted', 'Voided')),
  void_reason      text,
  journal_entry_id uuid,
  idempotency_key  text,
  created_by       uuid references public.users (id) on delete restrict,
  created_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (branch_id, company_id)        references public.branches (id, company_id)        on delete restrict,
  foreign key (journal_entry_id, company_id) references public.journal_entries (id, company_id) on delete restrict
);
create unique index cash_entries_idem_uq on public.cash_entries (company_id, idempotency_key) where idempotency_key is not null;
create index cash_entries_branch_idx on public.cash_entries (branch_id, company_id, entry_date);
comment on table public.cash_entries is 'Non-operating cash movements (P2-M4A, 22.09): Owner Investment/Other Income/Loan Received/Loan Payment/Owner''s Drawings. Equipment Purchase is deliberately excluded — that is inventory_record_purchase''s domain (spec §2), not duplicated here. Written only by record_cash_entry/void_cash_entry; corrections are a reversing void (22.24), never a delete.';
alter table public.cash_entries enable row level security;
alter table public.cash_entries force row level security;
revoke all on public.cash_entries from public, anon, authenticated, service_role;
grant select on public.cash_entries to authenticated;
create policy cash_entries_select_member on public.cash_entries for select to authenticated
  using (public.has_permission(company_id, 'accounting.read'));

-- ════════════════════════════════════════════════════════════════════════════
-- 4. record_cash_entry — atomic: cash_entries row + balanced journal. accounting.manage + branch member.
-- ════════════════════════════════════════════════════════════════════════════
create function public.record_cash_entry(
  p_branch_id uuid, p_entry_date date, p_flow text, p_category text, p_description text, p_amount numeric, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_entry uuid; v_cash_id uuid;
  a_cash uuid; a_other uuid; a_other_code text; v_entry_desc text;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'accounting.manage') then raise exception 'permission denied: accounting.manage' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_flow not in ('in', 'out') then raise exception 'invalid flow direction' using errcode = 'check_violation'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be > 0' using errcode = 'check_violation'; end if;
  if p_entry_date is null then raise exception 'entry date is required' using errcode = 'check_violation'; end if;
  -- flow/category pairing (mock parity; Equipment Purchase intentionally not offered here — spec §2)
  if p_flow = 'in' and p_category not in ('Owner Investment', 'Other Income', 'Loan Received') then
    raise exception 'invalid inflow category' using errcode = 'check_violation';
  end if;
  if p_flow = 'out' and p_category not in ('Loan Payment', 'Owner''s Drawings') then
    raise exception 'invalid outflow category' using errcode = 'check_violation';
  end if;

  select c.id into v_existing from public.cash_entries c where c.company_id = v_company and c.idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;  -- B5: at-most-once

  perform public.inventory_ensure_accounts(v_company);
  a_other_code := case p_category
    when 'Owner Investment' then 'OWNER_EQUITY'
    when 'Other Income'     then 'OTHER_INCOME'
    when 'Loan Received'    then 'LOANS_PAYABLE'
    when 'Loan Payment'     then 'LOANS_PAYABLE'
    when 'Owner''s Drawings' then 'OWNER_EQUITY'
  end;
  select id into a_cash  from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  select id into a_other from public.chart_of_accounts where company_id = v_company and account_code = a_other_code;

  v_cash_id := public.uuidv7();
  v_entry := public.uuidv7();
  v_entry_desc := p_category || coalesce(': ' || nullif(trim(p_description), ''), '');
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by, entry_date)
    values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'CashEntry', v_cash_id, v_entry_desc, v_actor, p_entry_date::timestamptz);
  if p_flow = 'in' then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_cash, p_amount, 0),
      (v_company, v_entry, a_other, 0, p_amount);
  else
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_other, p_amount, 0),
      (v_company, v_entry, a_cash, 0, p_amount);
  end if;

  insert into public.cash_entries (id, company_id, branch_id, entry_date, flow, category, description, amount, journal_entry_id, idempotency_key, created_by)
    values (v_cash_id, v_company, p_branch_id, p_entry_date, p_flow, p_category, nullif(trim(p_description), ''), p_amount, v_entry, p_idempotency_key, v_actor);

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Business', 'accounting.cash_entry_recorded', 'accounting', 'cash_entries', v_cash_id);
  return v_cash_id;
end; $$;
comment on function public.record_cash_entry(uuid, date, text, text, text, numeric, text) is 'P2-M4A: non-operating cash movement (22.09) — atomic cash_entries row + balanced journal (Dr/Cr Cash vs Owner''s Equity/Loans Payable/Other Income per category). accounting.manage + branch member; idempotent (B5); audited.';
revoke all on function public.record_cash_entry(uuid, date, text, text, text, numeric, text) from public;
grant execute on function public.record_cash_entry(uuid, date, text, text, text, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. void_cash_entry — audited reversing correction (22.24: no delete of an approved financial record).
-- ════════════════════════════════════════════════════════════════════════════
create function public.void_cash_entry(p_cash_entry_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_branch uuid; v_actor uuid; v_flow text; v_category text; v_amount numeric; v_status text;
  v_entry uuid; a_cash uuid; a_other uuid; a_other_code text;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a void reason is required' using errcode = 'check_violation'; end if;
  select company_id, branch_id, flow, category, amount, status into v_company, v_branch, v_flow, v_category, v_amount, v_status
    from public.cash_entries where id = p_cash_entry_id;
  if v_company is null then raise exception 'cash entry not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'accounting.manage') then raise exception 'permission denied: accounting.manage' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(v_branch) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if v_status = 'Voided' then return; end if;  -- idempotent replay

  a_other_code := case v_category
    when 'Owner Investment' then 'OWNER_EQUITY'
    when 'Other Income'     then 'OTHER_INCOME'
    when 'Loan Received'    then 'LOANS_PAYABLE'
    when 'Loan Payment'     then 'LOANS_PAYABLE'
    when 'Owner''s Drawings' then 'OWNER_EQUITY'
  end;
  select id into a_cash  from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  select id into a_other from public.chart_of_accounts where company_id = v_company and account_code = a_other_code;
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'VoidedCashEntry', p_cash_entry_id, 'Void: ' || v_category || ' — ' || p_reason, v_actor);
  -- reversal: swap the original debit/credit
  if v_flow = 'in' then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_other, v_amount, 0),
      (v_company, v_entry, a_cash, 0, v_amount);
  else
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_cash, v_amount, 0),
      (v_company, v_entry, a_other, 0, v_amount);
  end if;

  update public.cash_entries set status = 'Voided', void_reason = p_reason where id = p_cash_entry_id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_branch, v_actor, 'Administrative', 'accounting.cash_entry_voided', 'accounting', 'cash_entries', p_cash_entry_id, jsonb_build_object('reason', p_reason));
end; $$;
comment on function public.void_cash_entry(uuid, text) is 'P2-M4A: audited reversing correction for a cash entry (22.24 — no delete of an approved financial record). accounting.manage + branch member; reason mandatory; idempotent.';
revoke all on function public.void_cash_entry(uuid, text) from public;
grant execute on function public.void_cash_entry(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Read functions — statements derived from the REAL GL (spec §1). STABLE, SECURITY DEFINER, permission-gated
--    inside the function body (the only gate; no table grants needed for these). Company-wide by default
--    (p_branch_id optional filter) — 26.09 "Owner: Access financial reports" is a company-level authority, not
--    branch-scoped, matching how audit.read already works in this codebase.
-- ════════════════════════════════════════════════════════════════════════════
create function public.trial_balance(p_company uuid, p_branch_id uuid default null, p_as_of date default null)
returns table(account_code text, account_name text, account_type text, normal_balance text, total_debit numeric, total_credit numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission(p_company, 'accounting.read') then
    raise exception 'permission denied: accounting.read' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.account_code, a.name, a.account_type, a.normal_balance,
           coalesce(sum(jl.debit), 0)::numeric, coalesce(sum(jl.credit), 0)::numeric
    from public.chart_of_accounts a
    left join public.journal_lines jl on jl.account_id = a.id and jl.company_id = a.company_id
    left join public.journal_entries je on je.id = jl.journal_entry_id and je.company_id = a.company_id
      and (p_branch_id is null or je.branch_id = p_branch_id)
      and (p_as_of is null or je.entry_date::date <= p_as_of)
    where a.company_id = p_company and a.status = 'Active'
    group by a.id, a.account_code, a.name, a.account_type, a.normal_balance
    order by a.account_code;
end; $$;
comment on function public.trial_balance(uuid, uuid, date) is 'P2-M4A: live trial balance from journal_lines (22.04) — every active account, debit/credit totals; sum(total_debit)=sum(total_credit) proves the GL is balanced. accounting.read.';
revoke all on function public.trial_balance(uuid, uuid, date) from public;
grant execute on function public.trial_balance(uuid, uuid, date) to authenticated;

create function public.income_statement_monthly(p_company uuid, p_branch_id uuid default null, p_year int default extract(year from now())::int)
returns table(
  month_num int, month_name text,
  retail_revenue numeric, wholesale_revenue numeric, total_revenue numeric,
  cogs numeric, gross_profit numeric,
  shrinkage numeric, operating_expenses numeric, total_opex numeric,
  net_income numeric
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission(p_company, 'accounting.read') then
    raise exception 'permission denied: accounting.read' using errcode = 'insufficient_privilege';
  end if;
  return query
  with sale_class as (
    select i.id as invoice_id, bool_or(coalesce(soi.is_bulk, false)) as is_wholesale
    from public.invoices i
    join public.sales_order_items soi on soi.sales_order_id = i.sales_order_id and soi.company_id = i.company_id
    where i.company_id = p_company
    group by i.id
  ),
  base as (
    select extract(month from je.entry_date)::int as mo, a.account_code,
           coalesce(sc.is_wholesale, false) as is_wholesale, jl.debit, jl.credit
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id and je.company_id = p_company
    join public.chart_of_accounts a on a.id = jl.account_id and a.company_id = p_company
    left join sale_class sc on sc.invoice_id = je.source_document_id and a.account_code = 'SALES'
    where a.account_code in ('SALES', 'COGS', 'SHRINKAGE', 'OPERATING_EXPENSES')
      and extract(year from je.entry_date) = p_year
      and (p_branch_id is null or je.branch_id = p_branch_id)
  ),
  monthly as (
    select mo,
      sum(case when account_code = 'SALES' and not is_wholesale then credit - debit else 0 end) as retail_revenue,
      sum(case when account_code = 'SALES' and is_wholesale then credit - debit else 0 end) as wholesale_revenue,
      sum(case when account_code = 'COGS' then debit - credit else 0 end) as cogs,
      sum(case when account_code = 'SHRINKAGE' then debit - credit else 0 end) as shrinkage,
      sum(case when account_code = 'OPERATING_EXPENSES' then debit - credit else 0 end) as operating_expenses
    from base group by mo
  )
  select m.mo, to_char(to_date(m.mo::text, 'MM'), 'Mon'),
    coalesce(mm.retail_revenue, 0)::numeric, coalesce(mm.wholesale_revenue, 0)::numeric,
    (coalesce(mm.retail_revenue, 0) + coalesce(mm.wholesale_revenue, 0))::numeric,
    coalesce(mm.cogs, 0)::numeric,
    ((coalesce(mm.retail_revenue, 0) + coalesce(mm.wholesale_revenue, 0)) - coalesce(mm.cogs, 0))::numeric,
    coalesce(mm.shrinkage, 0)::numeric, coalesce(mm.operating_expenses, 0)::numeric,
    (coalesce(mm.shrinkage, 0) + coalesce(mm.operating_expenses, 0))::numeric,
    (((coalesce(mm.retail_revenue, 0) + coalesce(mm.wholesale_revenue, 0)) - coalesce(mm.cogs, 0))
      - (coalesce(mm.shrinkage, 0) + coalesce(mm.operating_expenses, 0)))::numeric
  from generate_series(1, 12) as m(mo)
  left join monthly mm on mm.mo = m.mo
  order by m.mo;
end; $$;
comment on function public.income_statement_monthly(uuid, uuid, int) is 'P2-M4A: 12-month income statement from the posted GL (22.05/22.22). Retail/wholesale split derived from sales_order_items.is_bulk per invoice (no new GL accounts, zero touch to pos_record_sale). Labor = 0/reserved — no Payroll module yet. accounting.read.';
revoke all on function public.income_statement_monthly(uuid, uuid, int) from public;
grant execute on function public.income_statement_monthly(uuid, uuid, int) to authenticated;

create function public.balance_sheet(p_company uuid, p_branch_id uuid default null, p_as_of date default null)
returns table(
  cash numeric, accounts_receivable numeric, raw_materials numeric, finished_goods numeric, equipment numeric,
  total_assets numeric,
  loans_payable numeric, total_liabilities numeric,
  owner_investment numeric, owners_drawings numeric, retained_earnings numeric, total_equity numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cash numeric; v_ar numeric; v_raw numeric; v_fg numeric; v_equip numeric;
  v_loans numeric; v_opening_fg_equity numeric; v_net_income_cum numeric;
  v_invest numeric; v_drawings numeric;
begin
  if not public.has_permission(p_company, 'accounting.read') then
    raise exception 'permission denied: accounting.read' using errcode = 'insufficient_privilege';
  end if;

  select
    coalesce(sum(case when a.account_code = 'CASH' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'AR' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'RAW_MATERIALS' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'FG_INVENTORY' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'EQUIPMENT' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'LOANS_PAYABLE' then jl.credit - jl.debit else 0 end), 0),
    -- capital contributed in kind (opening finished-goods stock, spec §3.1) — isolated by its source tag so it can
    -- be shown blended into the "Owner Investment" line without double-sourcing the OWNER_EQUITY total below.
    coalesce(sum(case when a.account_code = 'OWNER_EQUITY' and je.source_document_type = 'OpeningBalance' then jl.credit - jl.debit else 0 end), 0),
    coalesce(sum(case when a.account_code in ('SALES', 'OTHER_INCOME') then jl.credit - jl.debit
                       when a.account_code in ('COGS', 'SHRINKAGE', 'OPERATING_EXPENSES') then -(jl.debit - jl.credit)
                       else 0 end), 0)
  into v_cash, v_ar, v_raw, v_fg, v_equip, v_loans, v_opening_fg_equity, v_net_income_cum
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id and je.company_id = p_company
  join public.chart_of_accounts a on a.id = jl.account_id and a.company_id = p_company
  where (p_branch_id is null or je.branch_id = p_branch_id)
    and (p_as_of is null or je.entry_date::date <= p_as_of);

  select coalesce(sum(amount) filter (where category = 'Owner Investment'), 0),
         coalesce(sum(amount) filter (where category = 'Owner''s Drawings'), 0)
    into v_invest, v_drawings
  from public.cash_entries c
  where c.company_id = p_company and c.status = 'Posted'
    and (p_branch_id is null or c.branch_id = p_branch_id)
    and (p_as_of is null or c.entry_date <= p_as_of);

  -- Investment (display) blends cash + in-kind contributions; Retained Earnings (display) is PURE net income —
  -- Drawings is subtracted exactly once, in the total below, never inside retained_earnings itself (a prior
  -- version double-subtracted it there AND in the total; caught by scripts/guards/accounting-security.sql).
  return query select
    v_cash, v_ar, v_raw, v_fg, v_equip, (v_cash + v_ar + v_raw + v_fg + v_equip)::numeric,
    v_loans, v_loans::numeric,
    (v_invest + v_opening_fg_equity)::numeric, v_drawings, v_net_income_cum,
    (v_invest + v_opening_fg_equity - v_drawings + v_net_income_cum)::numeric;
end; $$;
comment on function public.balance_sheet(uuid, uuid, date) is 'P2-M4A: balance sheet from the posted GL + cash_entries (22.03/22.22). Assets = Liabilities + Equity by construction (every posting is balanced double-entry). Retained earnings is NOT clamped to zero (a farm can run an accumulated deficit — a deliberate correction of the mock''s Math.max(0,...) display quirk). accounting.read.';
revoke all on function public.balance_sheet(uuid, uuid, date) from public;
grant execute on function public.balance_sheet(uuid, uuid, date) to authenticated;
