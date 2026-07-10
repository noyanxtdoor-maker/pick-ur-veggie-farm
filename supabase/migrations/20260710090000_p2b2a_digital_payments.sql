-- Migration P2-B2A — Digital Payments: financial accounts (Bank / GCash / Maya) — first slice
-- Authority: Phase_2_B2_Digital_Payments_Reconciliation_Spec.md §4 (minimal slice) · System 20.24
--   (financial_accounts; "balances calculated from transaction history, manual change prohibited") ·
--   System 22.10 ("the ERP does NOT hold money; it records the movement"; transfers move balance, no P&L) ·
--   22.06 automatic posting · 26.09 permissions. Implementation authorized by the cross-vendor money-path
--   review §9 (B2 — APPROVED 2026-07-08); B2 itself requires its own review before lock (spec §6c).
-- Design stance (spec §2): financial_accounts is a THIN REGISTRY keyed to a chart_of_accounts Asset code.
--   NO stored balance column anywhere — per-account balance is DERIVED from journal_lines, always.
-- Pattern: ADDITIVE ONLY — locked files untouched; posting functions evolved via drop+recreate (M2E precedent).
--   pos_void_sale also evolves (not in spec §3's table but required by C7 §4 "reversal mirrors the original":
--   a sale paid into GCash must void by crediting GCash, not CASH).
-- Risk: HIGH (money path — changes where the cash-side leg of the sale/settle/void posts).

-- ── 1. Permissions (26.09) ──
insert into public.permissions (permission_key, description) values
  ('finance.account.read',   'View financial accounts (cash/bank/wallet) and their derived balances'),
  ('finance.account.manage', 'Create/edit financial accounts and transfer between them')
on conflict (permission_key) do nothing;

-- ── 2. financial_accounts — thin registry (20.24), branch-owned, NO balance column ──
create table public.financial_accounts (
  id             uuid primary key default public.uuidv7(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  branch_id      uuid not null,
  name           text not null check (length(trim(name)) > 0),
  account_type   text not null check (account_type in ('Cash', 'Bank', 'Digital Wallet')),
  provider       text,           -- bank name / wallet provider (display metadata)
  account_number text,           -- display-only reference; never used in posting
  coa_code       text not null check (coa_code ~ '^[A-Z][A-Z0-9_]{2,30}$'),
  status         text not null default 'Active' check (status in ('Active', 'Archived')),
  created_by     uuid references public.users (id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, branch_id, coa_code),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict
);
comment on table public.financial_accounts is 'P2-B2A: registry/metadata for monetary accounts (20.24). Each row is keyed to a chart_of_accounts ASSET code; balance is DERIVED from journal_lines — no stored balance, ever.';

alter table public.financial_accounts enable row level security;
alter table public.financial_accounts force row level security;
revoke all on public.financial_accounts from public, anon, authenticated, service_role;
grant select on public.financial_accounts to authenticated;
create policy financial_accounts_select_member on public.financial_accounts for select to authenticated
  using (public.has_permission(company_id, 'finance.account.read') and public.is_branch_member(branch_id));
-- writes are function-only (no insert/update/delete grants or policies)

-- ── 3. financial_transfers — append-only transfer record (idempotency + audit surface) ──
create table public.financial_transfers (
  id              uuid primary key default public.uuidv7(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  branch_id       uuid not null,
  from_account_id uuid not null,
  to_account_id   uuid not null,
  amount          numeric(14, 2) not null check (amount > 0),
  note            text,
  idempotency_key text not null,
  created_by      uuid references public.users (id) on delete restrict,
  created_at      timestamptz not null default now(),
  unique (company_id, idempotency_key),
  unique (id, company_id),
  check (from_account_id <> to_account_id),
  foreign key (branch_id, company_id)      references public.branches (id, company_id)           on delete restrict,
  foreign key (from_account_id, company_id) references public.financial_accounts (id, company_id) on delete restrict,
  foreign key (to_account_id, company_id)   references public.financial_accounts (id, company_id) on delete restrict
);
comment on table public.financial_transfers is 'P2-B2A: append-only record of account-to-account transfers (22.10 — balance moves, no P&L). The journal entry is the financial truth; this row carries idempotency + display metadata.';

alter table public.financial_transfers enable row level security;
alter table public.financial_transfers force row level security;
revoke all on public.financial_transfers from public, anon, authenticated, service_role;
grant select on public.financial_transfers to authenticated;
create policy financial_transfers_select_member on public.financial_transfers for select to authenticated
  using (public.has_permission(company_id, 'finance.account.read') and public.is_branch_member(branch_id));

-- ── 4. invoices.financial_account_id (additive; null = legacy/default cash drawer) ──
alter table public.invoices add column financial_account_id uuid;
alter table public.invoices add constraint invoices_financial_account_fk
  foreign key (financial_account_id, company_id) references public.financial_accounts (id, company_id) on delete restrict;
create index invoices_financial_account_idx on public.invoices (financial_account_id, company_id) where financial_account_id is not null;
comment on column public.invoices.financial_account_id is 'P2-B2A: the financial account the money landed in (null = cash drawer / CASH). Set at paid-sale time or at settlement.';

-- ── 5. financial_account_upsert — governed create/edit. coa_code + type + branch are IMMUTABLE on edit ──
create function public.financial_account_upsert(
  p_branch_id uuid, p_name text, p_account_type text, p_coa_code text,
  p_provider text default null, p_account_number text default null, p_account_id uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_actor uuid; v_id uuid; v_existing_type text;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'finance.account.manage') then raise exception 'permission denied: finance.account.manage' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;

  if p_account_id is not null then
    -- EDIT: display metadata only. coa_code / account_type / branch are immutable — journal history must
    -- never be silently re-pointed (C7 §4 immutable history).
    update public.financial_accounts
       set name = trim(p_name), provider = p_provider, account_number = p_account_number, updated_at = now()
     where id = p_account_id and company_id = v_company and branch_id = p_branch_id;
    if not found then raise exception 'account not found in this branch' using errcode = 'foreign_key_violation'; end if;
    v_id := p_account_id;
  else
    -- CREATE: the registry owns its COA code. A NEW code must not collide with any existing COA account
    -- (routing money into SALES/FG_INVENTORY/etc. would corrupt the statements); the sole exception is
    -- CASH — registering the branch cash drawer maps to the existing CASH asset account.
    if p_coa_code <> 'CASH' then
      select a.account_type into v_existing_type from public.chart_of_accounts a
        where a.company_id = v_company and a.account_code = p_coa_code;
      if v_existing_type is not null then
        raise exception 'account code % already exists in the chart of accounts', p_coa_code using errcode = 'check_violation';
      end if;
    end if;
    perform public.pos_ensure_accounts(v_company);  -- guarantees CASH exists for the drawer mapping
    insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance)
      values (v_company, p_coa_code, trim(p_name), 'Asset', 'debit')
      on conflict (company_id, account_code) do nothing;
    v_id := public.uuidv7();
    insert into public.financial_accounts (id, company_id, branch_id, name, account_type, provider, account_number, coa_code, created_by)
      values (v_id, v_company, p_branch_id, trim(p_name), p_account_type, p_provider, p_account_number, p_coa_code, v_actor);
  end if;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Administrative',
            case when p_account_id is null then 'finance.account_created' else 'finance.account_updated' end,
            'finance', 'financial_accounts', v_id);
  return v_id;
end; $$;
comment on function public.financial_account_upsert(uuid, text, text, text, text, text, uuid) is 'P2-B2A: governed create/edit of a financial account (finance.account.manage + branch member). Creates the backing COA Asset code on demand; code/type/branch immutable on edit; audited.';
revoke all on function public.financial_account_upsert(uuid, text, text, text, text, text, uuid) from public;
grant execute on function public.financial_account_upsert(uuid, text, text, text, text, text, uuid) to authenticated;

-- ── 6. financial_account_set_status — archive / reactivate (registry only; history untouched) ──
create function public.financial_account_set_status(p_account_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_branch uuid; v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if p_status not in ('Active', 'Archived') then raise exception 'invalid status' using errcode = 'check_violation'; end if;
  select company_id, branch_id into v_company, v_branch from public.financial_accounts where id = p_account_id;
  if v_company is null then raise exception 'account not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'finance.account.manage') then raise exception 'permission denied: finance.account.manage' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(v_branch) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  update public.financial_accounts set status = p_status, updated_at = now() where id = p_account_id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_branch, v_actor, 'Administrative', 'finance.account_status', 'finance', 'financial_accounts', p_account_id, jsonb_build_object('status', p_status));
end; $$;
revoke all on function public.financial_account_set_status(uuid, text) from public;
grant execute on function public.financial_account_set_status(uuid, text) to authenticated;

-- ── 7. financial_ensure_cash — idempotent registry row for the branch cash drawer (type Cash → CASH) ──
create function public.financial_ensure_cash(p_branch_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_id uuid;
begin
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  select id into v_id from public.financial_accounts
    where company_id = v_company and branch_id = p_branch_id and coa_code = 'CASH';
  if v_id is not null then return v_id; end if;
  return public.financial_account_upsert(p_branch_id, 'Cash on Hand', 'Cash', 'CASH');
end; $$;
comment on function public.financial_ensure_cash(uuid) is 'P2-B2A: idempotent — registers the branch cash drawer as a financial account (CASH mapping) so it can appear in balances and be a transfer endpoint. Inherits the manage gate from financial_account_upsert.';
revoke all on function public.financial_ensure_cash(uuid) from public;
grant execute on function public.financial_ensure_cash(uuid) to authenticated;

-- ── 8. financial_account_balances — DERIVED balances (20.24), per-branch rows + optional branch filter ──
create function public.financial_account_balances(p_company uuid, p_branch_id uuid default null)
returns table(account_id uuid, branch_id uuid, name text, account_type text, provider text,
              account_number text, coa_code text, status text, balance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission(p_company, 'finance.account.read') then
    raise exception 'permission denied: finance.account.read' using errcode = 'insufficient_privilege';
  end if;
  return query
  select fa.id, fa.branch_id, fa.name, fa.account_type, fa.provider, fa.account_number, fa.coa_code, fa.status,
         coalesce((
           select sum(jl.debit - jl.credit)
           from public.journal_lines jl
           join public.journal_entries je on je.id = jl.journal_entry_id and je.company_id = p_company
           join public.chart_of_accounts a on a.id = jl.account_id and a.company_id = p_company
           where a.account_code = fa.coa_code and je.branch_id = fa.branch_id
         ), 0)::numeric as balance
  from public.financial_accounts fa
  where fa.company_id = p_company
    and (p_branch_id is null or fa.branch_id = p_branch_id)
  order by fa.account_type, fa.name;
end; $$;
comment on function public.financial_account_balances(uuid, uuid) is 'P2-B2A: each account''s balance DERIVED from journal_lines over its COA code within its branch (20.24 — no stored balance). finance.account.read.';
revoke all on function public.financial_account_balances(uuid, uuid) from public;
grant execute on function public.financial_account_balances(uuid, uuid) to authenticated;

-- ── 9. financial_account_transfer — Dr {to} / Cr {from}, NO P&L (22.10); idempotent; audited ──
create function public.financial_account_transfer(
  p_from_account_id uuid, p_to_account_id uuid, p_amount numeric, p_idempotency_key text, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_branch uuid; v_company_to uuid; v_branch_to uuid;
  v_from_code text; v_to_code text; v_from_status text; v_to_status text;
  v_existing uuid; v_id uuid; v_entry uuid; a_from uuid; a_to uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'transfer amount must be > 0' using errcode = 'check_violation'; end if;
  if p_from_account_id = p_to_account_id then raise exception 'cannot transfer an account to itself' using errcode = 'check_violation'; end if;

  select company_id, branch_id, coa_code, status into v_company, v_branch, v_from_code, v_from_status
    from public.financial_accounts where id = p_from_account_id;
  select company_id, branch_id, coa_code, status into v_company_to, v_branch_to, v_to_code, v_to_status
    from public.financial_accounts where id = p_to_account_id;
  if v_company is null or v_company_to is null then raise exception 'account not found' using errcode = 'foreign_key_violation'; end if;
  if v_company <> v_company_to then raise exception 'accounts belong to different companies' using errcode = 'check_violation'; end if;
  if v_branch <> v_branch_to then raise exception 'cross-branch transfers are not supported in this slice' using errcode = 'check_violation'; end if;
  if v_from_status <> 'Active' or v_to_status <> 'Active' then raise exception 'both accounts must be Active' using errcode = 'check_violation'; end if;
  if not public.has_permission(v_company, 'finance.account.manage') then raise exception 'permission denied: finance.account.manage' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(v_branch) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;

  select id into v_existing from public.financial_transfers
    where company_id = v_company and idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;  -- at-most-once (C7 §6)

  v_id := public.uuidv7();
  insert into public.financial_transfers (id, company_id, branch_id, from_account_id, to_account_id, amount, note, idempotency_key, created_by)
    values (v_id, v_company, v_branch, p_from_account_id, p_to_account_id, round(p_amount, 2), p_note, p_idempotency_key, v_actor);

  select id into a_from from public.chart_of_accounts where company_id = v_company and account_code = v_from_code;
  select id into a_to   from public.chart_of_accounts where company_id = v_company and account_code = v_to_code;
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'AccountTransfer', v_id,
            'Account transfer' || coalesce(': ' || p_note, ''), v_actor);
  -- balance moves between two ASSET accounts; deliberately no revenue/expense line (22.10)
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_to,   round(p_amount, 2), 0),
    (v_company, v_entry, a_from, 0, round(p_amount, 2));

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_branch, v_actor, 'Business', 'finance.account_transfer', 'finance', 'financial_transfers', v_id,
            jsonb_build_object('from', v_from_code, 'to', v_to_code, 'amount', round(p_amount, 2)));
  return v_id;
end; $$;
comment on function public.financial_account_transfer(uuid, uuid, numeric, text, text) is 'P2-B2A: GCash→Bank etc. — Dr destination / Cr source, zero P&L (22.10). Same-branch, same-company, both Active; finance.account.manage; idempotent; audited.';
revoke all on function public.financial_account_transfer(uuid, uuid, numeric, text, text) from public;
grant execute on function public.financial_account_transfer(uuid, uuid, numeric, text, text) to authenticated;

-- ── 10. helper: resolve the cash-side COA code for a sale/settle (null account = CASH drawer) ──
create function public.finance_resolve_pay_code(p_company uuid, p_branch uuid, p_account_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_code text; v_status text; v_branch uuid; v_company uuid;
begin
  if p_account_id is null then return 'CASH'; end if;
  select coa_code, status, branch_id, company_id into v_code, v_status, v_branch, v_company
    from public.financial_accounts where id = p_account_id;
  if v_code is null or v_company <> p_company then raise exception 'financial account not found' using errcode = 'foreign_key_violation'; end if;
  if v_branch <> p_branch then raise exception 'financial account belongs to another branch' using errcode = 'check_violation'; end if;
  if v_status <> 'Active' then raise exception 'financial account is archived' using errcode = 'check_violation'; end if;
  return v_code;
end; $$;
revoke all on function public.finance_resolve_pay_code(uuid, uuid, uuid) from public;
grant execute on function public.finance_resolve_pay_code(uuid, uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. pos_record_sale — recreated (M2E body + p_financial_account_id). The ONLY money-math change is WHICH
--     asset account receives the paid-sale debit; amounts, pricing, COGS, idempotency all byte-identical to M2E.
-- ════════════════════════════════════════════════════════════════════════════
drop function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text);
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
      select fg.cost_per_unit into v_cost from public.finished_goods_batches fg where fg.id = v_fg and fg.company_id = v_company;
      if v_cost is null then raise exception 'unknown finished-goods batch' using errcode = 'foreign_key_violation'; end if;
      if public.fg_available(v_fg) < v_qty then raise exception 'insufficient stock for batch %', v_fg using errcode = 'check_violation'; end if;
      insert into public.sales_order_items (company_id, sales_order_id, product_id, finished_goods_batch_id, quantity, unit_price, line_total, unit_cost, retail_unit_price, is_bulk)
        values (v_company, v_order, v_pid, v_fg, v_qty, v_farm, round(v_qty * v_farm, 2), v_cost, v_retail, false);
      insert into public.inventory_movements (company_id, branch_id, finished_goods_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, actor_user_id)
        values (v_company, p_branch_id, v_fg, 'Sales', v_qty, v_cost, round(v_qty * v_cost, 2), 'SalesInvoice', v_order, v_actor);
      v_subtotal := v_subtotal + round(v_qty * v_farm, 2);
      v_cogs := v_cogs + round(v_qty * v_cost, 2);
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
comment on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid) is 'P2-B2A: M2E weigh-sale + payment account — the paid-sale debit lands in the chosen financial account''s COA code (null = CASH drawer). Amounts/pricing/COGS unchanged from M2E; account stored on the invoice; atomic balanced GL; idempotent; audited.';
revoke all on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid) from public;
grant execute on function public.pos_record_sale(uuid, jsonb, numeric, text, text, numeric, numeric, text, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. pos_settle_sale — recreated (M2C body + p_financial_account_id): the settlement debit lands in the
--     chosen account; the account is recorded on the invoice at settlement time.
-- ════════════════════════════════════════════════════════════════════════════
drop function public.pos_settle_sale(uuid, numeric);
create function public.pos_settle_sale(p_invoice_id uuid, p_cash numeric, p_financial_account_id uuid default null)
returns numeric  -- change given
language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_branch uuid; v_total numeric; v_status text; v_actor uuid; v_entry uuid;
        a_pay uuid; a_ar uuid; v_change numeric; v_pay_code text;
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
  v_pay_code := public.finance_resolve_pay_code(v_company, v_branch, p_financial_account_id);

  v_change := round(p_cash - v_total, 2);
  update public.invoices set status = 'Paid', tender_cash = p_cash, change_amount = v_change, paid_at = now(),
                             financial_account_id = p_financial_account_id
    where id = p_invoice_id;

  select id into a_pay from public.chart_of_accounts where company_id = v_company and account_code = v_pay_code;
  select id into a_ar  from public.chart_of_accounts where company_id = v_company and account_code = 'AR';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'Settlement', p_invoice_id, 'Pre-order settlement', v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_pay, v_total, 0),
    (v_company, v_entry, a_ar, 0, v_total);

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_branch, v_actor, 'Business', 'pos.sale_settled', 'pos', 'invoices', p_invoice_id);
  return v_change;
end; $$;
comment on function public.pos_settle_sale(uuid, numeric, uuid) is 'P2-B2A: M2C settlement + payment account — Dr {chosen account} / Cr AR; account recorded on the invoice. pos.settle; idempotent; audited.';
revoke all on function public.pos_settle_sale(uuid, numeric, uuid) from public;
grant execute on function public.pos_settle_sale(uuid, numeric, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. pos_void_sale — recreated: the reversal credits the ACCOUNT THAT WAS DEBITED (C7 §4 — reversal
--     mirrors the original). A GCash-paid sale voids against WALLET_*; a drawer sale against CASH;
--     an unsettled pre-order against AR. Everything else byte-identical to M2E.
-- ════════════════════════════════════════════════════════════════════════════
drop function public.pos_void_sale(uuid, text);
create function public.pos_void_sale(p_invoice_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_branch uuid; v_total numeric; v_status text; v_order uuid; v_actor uuid; v_entry uuid;
        v_fa uuid; v_pay_code text;
        a_pay uuid; a_sales uuid; a_cogs uuid; a_fg uuid; a_ar uuid; v_cogs numeric; r record;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'a void reason is required' using errcode = 'check_violation'; end if;
  select i.company_id, i.branch_id, i.total, i.status, i.sales_order_id, i.financial_account_id
    into v_company, v_branch, v_total, v_status, v_order, v_fa
    from public.invoices i where i.id = p_invoice_id;
  if v_company is null then raise exception 'invoice not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'pos.void') then raise exception 'permission denied: pos.void' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(v_branch) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if v_status = 'Voided' then return; end if;  -- idempotent replay

  -- reverse against what was actually debited: the invoice's stored account (null = CASH drawer).
  -- read the code directly (not via finance_resolve_pay_code): a void must succeed even if the
  -- account was archived after the sale — history mirrors history.
  if v_fa is null then v_pay_code := 'CASH';
  else select coa_code into v_pay_code from public.financial_accounts where id = v_fa; end if;

  v_cogs := 0;
  for r in select finished_goods_batch_id, quantity, unit_cost from public.sales_order_items
           where sales_order_id = v_order and finished_goods_batch_id is not null loop
    insert into public.inventory_movements (company_id, branch_id, finished_goods_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, reason, actor_user_id)
      values (v_company, v_branch, r.finished_goods_batch_id, 'AdjustmentIncrease', r.quantity, r.unit_cost, round(r.quantity * r.unit_cost, 2), 'VoidedInvoice', p_invoice_id, p_reason, v_actor);
    v_cogs := v_cogs + round(r.quantity * r.unit_cost, 2);
  end loop;

  select id into a_pay   from public.chart_of_accounts where company_id = v_company and account_code = v_pay_code;
  select id into a_sales from public.chart_of_accounts where company_id = v_company and account_code = 'SALES';
  select id into a_cogs  from public.chart_of_accounts where company_id = v_company and account_code = 'COGS';
  select id into a_fg    from public.chart_of_accounts where company_id = v_company and account_code = 'FG_INVENTORY';
  select id into a_ar    from public.chart_of_accounts where company_id = v_company and account_code = 'AR';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'VoidedInvoice', p_invoice_id, 'Void: ' || p_reason, v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_sales, v_total, 0),
    (v_company, v_entry, case when v_status = 'Paid' then a_pay else a_ar end, 0, v_total);
  if v_cogs > 0 then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_fg,   v_cogs, 0),
      (v_company, v_entry, a_cogs, 0, v_cogs);
  end if;

  update public.invoices set status = 'Voided' where id = p_invoice_id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_branch, v_actor, 'Administrative', 'pos.sale_voided', 'pos', 'invoices', p_invoice_id, jsonb_build_object('reason', p_reason, 'was_status', v_status, 'reversed_account', v_pay_code));
end; $$;
comment on function public.pos_void_sale(uuid, text) is 'P2-B2A: append-only reversal that credits the account actually debited (invoice.financial_account_id; null = CASH) — reversal mirrors the original (C7 §4). Stock returns for weighed lines only; pos.void; reason mandatory; idempotent.';
revoke all on function public.pos_void_sale(uuid, text) from public;
grant execute on function public.pos_void_sale(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 14. balance_sheet — recreated (M5A body; the `cash` column becomes CASH + all financial-account codes =
--     "Cash & equivalents"). Return shape unchanged; ties preserved (a transfer moves value inside one column).
-- ════════════════════════════════════════════════════════════════════════════
drop function public.balance_sheet(uuid, uuid, date);
create function public.balance_sheet(p_company uuid, p_branch_id uuid default null, p_as_of date default null)
returns table(
  cash numeric, accounts_receivable numeric, raw_materials numeric, finished_goods numeric, equipment numeric,
  employee_advances numeric, total_assets numeric,
  loans_payable numeric, total_liabilities numeric,
  owner_investment numeric, owners_drawings numeric, retained_earnings numeric, total_equity numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cash numeric; v_ar numeric; v_raw numeric; v_fg numeric; v_equip numeric; v_emp_adv numeric;
  v_loans numeric; v_opening_fg_equity numeric; v_net_income_cum numeric;
  v_invest numeric; v_drawings numeric;
begin
  if not public.has_permission(p_company, 'accounting.read') then
    raise exception 'permission denied: accounting.read' using errcode = 'insufficient_privilege';
  end if;

  select
    -- P2-B2A: cash & equivalents = CASH + every financial-account code (bank/wallet); still fully derived
    coalesce(sum(case when a.account_code = 'CASH'
                        or a.account_code in (select fa.coa_code from public.financial_accounts fa where fa.company_id = p_company)
                      then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'AR' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'RAW_MATERIALS' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'FG_INVENTORY' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'EQUIPMENT' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'EMPLOYEE_ADVANCES' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'LOANS_PAYABLE' then jl.credit - jl.debit else 0 end), 0),
    coalesce(sum(case when a.account_code = 'OWNER_EQUITY' and je.source_document_type = 'OpeningBalance' then jl.credit - jl.debit else 0 end), 0),
    coalesce(sum(case when a.account_code in ('SALES', 'OTHER_INCOME') then jl.credit - jl.debit
                       when a.account_code in ('COGS', 'SHRINKAGE', 'OPERATING_EXPENSES', 'WAGES_EXPENSE') then -(jl.debit - jl.credit)
                       else 0 end), 0)
  into v_cash, v_ar, v_raw, v_fg, v_equip, v_emp_adv, v_loans, v_opening_fg_equity, v_net_income_cum
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

  return query select
    v_cash, v_ar, v_raw, v_fg, v_equip, v_emp_adv,
    (v_cash + v_ar + v_raw + v_fg + v_equip + v_emp_adv)::numeric,
    v_loans, v_loans::numeric,
    (v_invest + v_opening_fg_equity)::numeric, v_drawings, v_net_income_cum,
    (v_invest + v_opening_fg_equity - v_drawings + v_net_income_cum)::numeric;
end; $$;
comment on function public.balance_sheet(uuid, uuid, date) is 'P2-B2A: M5A balance sheet with `cash` = Cash & equivalents (CASH + all financial-account codes, 20.24 derived). Assets = Liabilities + Equity by construction. accounting.read.';
revoke all on function public.balance_sheet(uuid, uuid, date) from public;
grant execute on function public.balance_sheet(uuid, uuid, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 15. cash_flow_statement — recreated (M4D body; the "cash" account set becomes CASH + all financial-account
--     codes). A transfer's entry nets to 0 inside the set → drops out of the activity lines by the existing
--     HAVING filter, and opening/closing still tie by construction.
-- ════════════════════════════════════════════════════════════════════════════
drop function public.cash_flow_statement(uuid, uuid, int);
create function public.cash_flow_statement(p_company uuid, p_branch_id uuid default null, p_year int default null)
returns table(activity text, line_label text, amount numeric, sort_order int)
language plpgsql stable security definer set search_path = '' as $$
declare v_opening numeric;
begin
  if not public.has_permission(p_company, 'accounting.read') then
    raise exception 'permission denied: accounting.read' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(jl.debit - jl.credit), 0) into v_opening
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id and je.company_id = p_company
  join public.chart_of_accounts a on a.id = jl.account_id and a.company_id = p_company
  where (a.account_code = 'CASH'
         or a.account_code in (select fa.coa_code from public.financial_accounts fa where fa.company_id = p_company))
    and a.company_id = p_company
    and (p_branch_id is null or je.branch_id = p_branch_id)
    and (p_year is not null and extract(year from je.entry_date) < p_year);

  return query
  with je_cash as (
    select je.id as entry_id,
           sum(case when a.account_code = 'CASH'
                      or a.account_code in (select fa.coa_code from public.financial_accounts fa where fa.company_id = p_company)
                    then jl.debit - jl.credit else 0 end) as cash_delta,
           bool_or(a.account_code = 'EQUIPMENT') as has_equip,
           bool_or(a.account_code = 'OWNER_EQUITY') as has_owner,
           bool_or(a.account_code = 'LOANS_PAYABLE') as has_loan,
           bool_or(a.account_code in ('SALES', 'AR')) as has_sales,
           bool_or(a.account_code in ('RAW_MATERIALS', 'OPERATING_EXPENSES')) as has_supplier,
           bool_or(a.account_code in ('WAGES_EXPENSE', 'EMPLOYEE_ADVANCES')) as has_labor,
           bool_or(a.account_code = 'OTHER_INCOME') as has_other_income
    from public.journal_entries je
    join public.journal_lines jl on jl.journal_entry_id = je.id and jl.company_id = p_company
    join public.chart_of_accounts a on a.id = jl.account_id and a.company_id = p_company
    where je.company_id = p_company
      and (p_branch_id is null or je.branch_id = p_branch_id)
      and (p_year is null or extract(year from je.entry_date) = p_year)
    group by je.id
    having sum(case when a.account_code = 'CASH'
                      or a.account_code in (select fa.coa_code from public.financial_accounts fa where fa.company_id = p_company)
                    then jl.debit - jl.credit else 0 end) <> 0
  ),
  classified as (
    select cash_delta,
      case when has_equip then 'Investing'
           when has_owner or has_loan then 'Financing'
           else 'Operating' end as activity,
      case when has_equip then 'Equipment purchases'
           when has_owner then 'Owner investment / drawings'
           when has_loan then 'Loan proceeds / repayments'
           when has_sales then 'Receipts from customers'
           when has_supplier then 'Payments to suppliers'
           when has_labor then 'Payments to employees'
           when has_other_income then 'Other operating receipts'
           else 'Other operating' end as line_label
    from je_cash
  ),
  lines as (
    select c.activity, c.line_label, sum(c.cash_delta)::numeric as amount,
      case c.activity when 'Operating' then 1 when 'Investing' then 2 when 'Financing' then 3 else 4 end as sort_order
    from classified c group by c.activity, c.line_label
  )
  select l.activity, l.line_label, l.amount, l.sort_order from lines l
  union all
  select 'Reconciliation', 'Opening cash balance', v_opening, 10
  union all
  select 'Reconciliation', 'Closing cash balance',
         (v_opening + coalesce((select sum(jc.cash_delta) from je_cash jc), 0))::numeric, 11
  order by sort_order, line_label;
end; $$;
comment on function public.cash_flow_statement(uuid, uuid, int) is 'P2-B2A: M4D direct-method cash flows over Cash & equivalents (CASH + all financial-account codes). Transfers inside the set net to zero and drop out; Operating+Investing+Financing = Closing − Opening by construction. accounting.read.';
revoke all on function public.cash_flow_statement(uuid, uuid, int) from public;
grant execute on function public.cash_flow_statement(uuid, uuid, int) to authenticated;
