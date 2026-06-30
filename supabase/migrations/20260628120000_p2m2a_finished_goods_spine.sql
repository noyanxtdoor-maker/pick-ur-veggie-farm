-- Migration P2-M2A — Finished-Goods & Opening-Balance Spine (Phase 2, Module 2A) — the POS prerequisite.
-- Authority: POS_Enterprise_Reconciliation_Audit.md + Phase_2_M2A_Finished_Goods_Opening_Balance_Spec.md.
--   Reuses the canonical schema (20.16 finished goods, 20.09 inventory movement ledger, ODR-001 opening balance) at
--   MINIMUM-VIABLE depth so POS can deduct stock + release COGS. NOT the full Inventory module.
-- Inherits: M1 (uuidv7), M2 (companies/branches, set_updated_at), M3 (composite-FK tenant integrity), M4 (resolver:
--   has_permission/accessible_company_ids/current_app_user_id), M5 (audit_events), M6 (permission catalog), P2-M2
--   (is_branch_member — branch isolation; audit-trigger pattern). C7 §0 (permission-based authz, never role names),
--   B2 (NUMERIC money, no float).
-- Integrity model (the point of this module): finished-goods balances are DERIVED from `inventory_movements` only
--   (20.09: "if inventory changed but no movement record exists, the data is invalid"). The movement ledger is
--   tamper-proof — it is written ONLY by SECURITY DEFINER functions (no authenticated write grant) and is append-only
--   (UPDATE/DELETE/TRUNCATE blocked). Finished goods carry NO authoritative quantity column.
-- Scope note (owner decision, spec §8): harvest_batches (20.15) is deferred to the Production module, so
--   `finished_goods_batches.harvest_batch_id` is NULLABLE with an `origin` flag; opening-balance stock has
--   origin='opening_balance' and no harvest batch yet (ODR-001 "migrate opening balances, start a clean ledger").
--   A later migration adds the harvest FK and requires it for origin='field_harvest'.
-- Risk: High (new operational + financial-integrity tables). Rollback: structural while unused.

-- ── Permission catalog additions (additive, idempotent; M6 catalog grows per module; mapped to 26.09 categories) ──
insert into public.permissions (permission_key, description) values
  ('product.manage',    'Manage the sellable product price list (selling prices)'),
  ('inventory.opening', 'Record opening finished-goods balances (high-risk; audited)'),
  ('inventory.adjust',  'Adjust or dispose finished-goods stock (high-risk; audited)')
on conflict (permission_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- Audit trigger for the inventory domain (M5). SECURITY DEFINER so it appends to the append-only log regardless of
-- the caller's grants → audit cannot be bypassed. branch_id read via jsonb so one function serves company- and
-- branch-owned tables (the P2-M2 pattern).
-- ════════════════════════════════════════════════════════════════════════════
create function public.inventory_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_app_user_id();
  v_branch uuid := (to_jsonb(NEW) ->> 'branch_id')::uuid;
  v_class  text := case when v_actor is null then 'System' else 'Business' end;
begin
  insert into public.audit_events
    (company_id, branch_id, actor_user_id, actor_auth_id, event_class, event_type, module, entity_type, entity_id, new_value)
  values
    (NEW.company_id, v_branch, v_actor, (select auth.uid()), v_class, lower(TG_OP) || '.' || TG_TABLE_NAME, 'inventory', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
  return NEW;
end;
$$;
comment on function public.inventory_audit() is 'Phase 2 M2A: append-only audit of finished-goods/product writes (M5). SECURITY DEFINER → cannot be bypassed.';

-- Append-only guard for the movement ledger (mirrors M5 audit immutability): blocks UPDATE/DELETE/TRUNCATE so stock
-- history can never be rewritten — corrections are new (reversal/adjustment) movements only.
create function public.inventory_movements_block_modify()
returns trigger
language plpgsql
as $$
begin
  raise exception 'inventory_movements is append-only: corrections are new adjustment/reversal movements, not edits'
    using errcode = 'restrict_violation';
end;
$$;
comment on function public.inventory_movements_block_modify() is 'Phase 2 M2A: enforces append-only inventory ledger (20.09) — no UPDATE/DELETE/TRUNCATE for any role.';

-- ════════════════════════════════════════════════════════════════════════════
-- 1. products — sellable price list (company-scoped catalog; the POS "selling-price book", reconciliation §0.1)
-- ════════════════════════════════════════════════════════════════════════════
create table public.products (
  id            uuid primary key default public.uuidv7(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  product_code  text not null,
  name          text not null,
  retail_per_kg numeric(12, 2) not null check (retail_per_kg >= 0),   -- NUMERIC, never float (B2)
  status        text not null default 'Active' check (status in ('Active', 'Archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, product_code),
  unique (id, company_id)   -- composite-FK target for finished_goods_batches
);
comment on table public.products is 'POS sellable products + selling price (P2-M2A). Company-scoped; member-read, product.manage-write; audited.';
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger products_audit after insert or update on public.products for each row execute function public.inventory_audit();

alter table public.products enable row level security;
alter table public.products force row level security;
revoke all on public.products from public, anon, authenticated, service_role;
grant select on public.products to authenticated;
grant insert (company_id, product_code, name, retail_per_kg) on public.products to authenticated;  -- code immutable after create
grant update (name, retail_per_kg, status) on public.products to authenticated;
create policy products_select_member on public.products for select to authenticated
  using (company_id in (select public.accessible_company_ids()));
create policy products_insert_manage on public.products for insert to authenticated
  with check (public.has_permission(company_id, 'product.manage'));
create policy products_update_manage on public.products for update to authenticated
  using (public.has_permission(company_id, 'product.manage'))
  with check (public.has_permission(company_id, 'product.manage'));

-- ════════════════════════════════════════════════════════════════════════════
-- 2. finished_goods_batches — sellable stock (branch-owned, 20.16). NO authoritative quantity (derived from movements).
--    Created only via governed functions (no authenticated INSERT/UPDATE grant) → stock cannot be invented.
-- ════════════════════════════════════════════════════════════════════════════
create table public.finished_goods_batches (
  id                  uuid primary key default public.uuidv7(),
  company_id          uuid not null references public.companies (id) on delete restrict,
  branch_id           uuid not null,
  finished_goods_code text not null,
  product_id          uuid not null,
  origin              text not null default 'opening_balance' check (origin in ('opening_balance', 'field_harvest')),
  harvest_batch_id    uuid,                                   -- deferred to Production module (nullable for opening; spec §8)
  unit                text not null default 'kg',
  cost_per_unit       numeric(12, 2) not null check (cost_per_unit >= 0),  -- COGS basis
  status              text not null default 'Available' check (status in ('Available', 'Reserved', 'Sold', 'Expired')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, finished_goods_code),
  unique (id, company_id),
  foreign key (branch_id, company_id)  references public.branches (id, company_id) on delete restrict,
  foreign key (product_id, company_id) references public.products (id, company_id) on delete restrict
);
comment on table public.finished_goods_batches is 'Finished-goods stock (P2-M2A, 20.16). Branch-owned; quantity DERIVED from inventory_movements (no manual qty). Created via governed functions only. Links to a product; harvest link deferred (spec §8).';
create index finished_goods_branch_idx on public.finished_goods_batches (branch_id, company_id);
create index finished_goods_product_idx on public.finished_goods_batches (product_id, company_id);
create trigger finished_goods_set_updated_at before update on public.finished_goods_batches for each row execute function public.set_updated_at();
create trigger finished_goods_audit after insert or update on public.finished_goods_batches for each row execute function public.inventory_audit();

alter table public.finished_goods_batches enable row level security;
alter table public.finished_goods_batches force row level security;
revoke all on public.finished_goods_batches from public, anon, authenticated, service_role;
grant select on public.finished_goods_batches to authenticated;   -- read only for members; writes via SECURITY DEFINER functions
create policy finished_goods_select_member on public.finished_goods_batches for select to authenticated
  using (public.is_branch_member(branch_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. inventory_movements — the balance ledger (branch-owned, append-only, 20.09). The SINGLE source of truth for
--    finished-goods quantity. Tamper-proof: NO write grant to any app role; written only by SECURITY DEFINER
--    functions; UPDATE/DELETE/TRUNCATE blocked.
-- ════════════════════════════════════════════════════════════════════════════
create table public.inventory_movements (
  id                       uuid primary key default public.uuidv7(),
  company_id               uuid not null references public.companies (id) on delete restrict,
  branch_id                uuid not null,
  finished_goods_batch_id  uuid not null,
  movement_type            text not null check (movement_type in ('Opening', 'Sales', 'AdjustmentIncrease', 'AdjustmentDecrease', 'Disposal', 'Reserve', 'Unreserve')),
  quantity                 numeric(12, 3) not null check (quantity > 0),
  unit_cost                numeric(12, 2) not null default 0 check (unit_cost >= 0),
  total_cost               numeric(14, 2) not null default 0,
  source_document_type     text,                              -- OpeningBalance | SalesInvoice | Adjustment
  source_document_id       uuid,
  idempotency_key          text,                              -- B5: at-most-once per (company_id, idempotency_key)
  reason                   text,
  actor_user_id            uuid references public.users (id) on delete restrict,
  created_at               timestamptz not null default now(),
  foreign key (branch_id, company_id)               references public.branches (id, company_id)              on delete restrict,
  foreign key (finished_goods_batch_id, company_id) references public.finished_goods_batches (id, company_id) on delete restrict
);
comment on table public.inventory_movements is 'Append-only finished-goods balance ledger (P2-M2A, 20.09). Balance = inbound - outbound. Written ONLY by SECURITY DEFINER functions; never edited/deleted. Branch-owned; idempotent (B5).';
create index inventory_movements_batch_idx on public.inventory_movements (finished_goods_batch_id, company_id);
create index inventory_movements_branch_idx on public.inventory_movements (branch_id, company_id);
create unique index inventory_movements_idem_uq on public.inventory_movements (company_id, idempotency_key) where idempotency_key is not null;

alter table public.inventory_movements enable row level security;
alter table public.inventory_movements force row level security;
revoke all on public.inventory_movements from public, anon, authenticated, service_role;
grant select on public.inventory_movements to authenticated;   -- read only (members); NO write grant to anyone (functions only)
create policy inventory_movements_select_member on public.inventory_movements for select to authenticated
  using (public.is_branch_member(branch_id));
-- append-only: block any modification for every role (incl. owner), like M5 audit immutability
create trigger inventory_movements_block_update before update on public.inventory_movements for each row execute function public.inventory_movements_block_modify();
create trigger inventory_movements_block_delete before delete on public.inventory_movements for each row execute function public.inventory_movements_block_modify();
create trigger inventory_movements_block_truncate before truncate on public.inventory_movements execute function public.inventory_movements_block_modify();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Balance resolver — finished-goods available quantity, derived purely from the ledger (20.09). STABLE; member-callable.
-- ════════════════════════════════════════════════════════════════════════════
create function public.fg_available(p_batch_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    case
      when m.movement_type in ('Opening', 'AdjustmentIncrease', 'Unreserve') then m.quantity
      when m.movement_type in ('Sales', 'AdjustmentDecrease', 'Disposal', 'Reserve') then -m.quantity
      else 0
    end), 0)
  from public.inventory_movements m
  where m.finished_goods_batch_id = p_batch_id
$$;
comment on function public.fg_available(uuid) is 'Phase 2 M2A: finished-goods available qty derived from the movement ledger (20.09). Never a stored column.';
revoke all on function public.fg_available(uuid) from public;
grant execute on function public.fg_available(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. record_opening_finished_goods — governed opening-balance entry (ODR-001). The only authenticated way to create
--    finished-goods stock until the Production module ships harvest. Gated by inventory.opening + branch membership;
--    atomic (finished-goods row + Opening movement + audit); idempotent (B5). SECURITY DEFINER → writes the locked ledger.
-- ════════════════════════════════════════════════════════════════════════════
create function public.record_opening_finished_goods(
  p_branch_id uuid, p_product_id uuid, p_finished_goods_code text,
  p_quantity numeric, p_unit_cost numeric, p_idempotency_key text, p_reason text default 'Opening balance'
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_company uuid; v_actor uuid; v_fg uuid; v_existing uuid;
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

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Administrative', 'inventory.opening_balance', 'inventory', 'finished_goods_batches', v_fg);

  return v_fg;
end;
$$;
comment on function public.record_opening_finished_goods(uuid, uuid, text, numeric, numeric, text, text) is 'Phase 2 M2A: governed opening finished-goods balance (ODR-001). inventory.opening + branch member; atomic + audited + idempotent.';
revoke all on function public.record_opening_finished_goods(uuid, uuid, text, numeric, numeric, text, text) from public;
grant execute on function public.record_opening_finished_goods(uuid, uuid, text, numeric, numeric, text, text) to authenticated;
