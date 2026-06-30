-- Migration P2-M2B — POS Sale + Minimal Real GL (Phase 2, Module 2B). The core operational transaction.
-- Authority: POS_Enterprise_Reconciliation_Audit.md + Phase_2_M2_POS_Operational_Specification.md §0 (enterprise-
--   reconciled). A POS sale REUSES the canonical sales schema (20.17 sales_orders/invoices) and posts AUTOMATIC,
--   ATOMIC, BALANCED double-entry (22.06/26.07 → 20.22 journal) with mandatory inventory decrement + COGS
--   (20.16/22.16/22.19) against the M2A finished-goods spine. No parallel `pos_sales`/`pos_payments` tables.
-- Inherits: M1 uuidv7 · M2 companies/branches/set_updated_at · M3 composite-FK integrity · M4 resolver · M5 audit ·
--   M6 catalog · P2-M2 is_branch_member · P2-M2A products/finished_goods/inventory_movements/fg_available.
-- Scope (this slice): PAID retail weigh-sale (cash tender). Pre-order/AR/credit + cash-session + void → M2C.
-- Integrity: journals are append-only (UPDATE/DELETE/TRUNCATE blocked — 22.24/26.07) and ALWAYS balanced (enforced in
--   the posting function). The sale is written ONLY by the SECURITY DEFINER `pos_record_sale` (no client write grant on
--   sales/invoice/journal); price is server-recomputed from `products` (no client price trust); idempotent (B5).
-- Risk: High (revenue + financial posting). Rollback: structural while unused. M1–M6 + P2-M1/M2/M2A untouched.

insert into public.permissions (permission_key, description) values
  ('pos.sell', 'Process a weigh-POS sale in a branch you belong to')
on conflict (permission_key) do nothing;

-- Append-only guard for financial records (mirrors M5 audit immutability; 22.24/26.07).
create function public.finance_block_modify()
returns trigger language plpgsql as $$
begin
  raise exception 'financial records are append-only: corrections are reversing entries, not edits'
    using errcode = 'restrict_violation';
end; $$;

-- Per-branch document numbering (order/invoice/journal). SECURITY DEFINER counter; one row per (company,branch,kind).
create table public.pos_sequences (
  company_id uuid not null references public.companies (id) on delete restrict,
  branch_id  uuid not null,
  kind       text not null check (kind in ('order', 'invoice', 'journal')),
  next_value bigint not null default 1,
  primary key (company_id, branch_id, kind)
);
alter table public.pos_sequences enable row level security;
alter table public.pos_sequences force row level security;  -- no app-role grants: touched only by SECURITY DEFINER functions

create function public.pos_next_seq(p_company uuid, p_branch uuid, p_kind text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into public.pos_sequences (company_id, branch_id, kind, next_value)
    values (p_company, p_branch, p_kind, 2)
  on conflict (company_id, branch_id, kind) do update set next_value = public.pos_sequences.next_value + 1
  returning next_value - 1 into v;
  return v;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. chart_of_accounts — minimal GL accounts (company-scoped master, 22.03/20.21)
-- ════════════════════════════════════════════════════════════════════════════
create table public.chart_of_accounts (
  id             uuid primary key default public.uuidv7(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  account_code   text not null,
  name           text not null,
  account_type   text not null check (account_type in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  status         text not null default 'Active' check (status in ('Active', 'Archived')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, account_code),
  unique (id, company_id)
);
comment on table public.chart_of_accounts is 'Minimal GL chart of accounts (P2-M2B, 22.03). Company-scoped; member-read; seeded by pos_ensure_accounts.';
create trigger coa_set_updated_at before update on public.chart_of_accounts for each row execute function public.set_updated_at();
alter table public.chart_of_accounts enable row level security;
alter table public.chart_of_accounts force row level security;
revoke all on public.chart_of_accounts from public, anon, authenticated, service_role;
grant select on public.chart_of_accounts to authenticated;
create policy coa_select_member on public.chart_of_accounts for select to authenticated
  using (company_id in (select public.accessible_company_ids()));

-- Seed the 5 accounts POS needs, idempotently, for a company. SECURITY DEFINER (writes master data).
create function public.pos_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance) values
    (p_company, 'CASH',        'Cash on Hand',            'Asset',   'debit'),
    (p_company, 'SALES',       'Sales Revenue',           'Revenue', 'credit'),
    (p_company, 'COGS',        'Cost of Goods Sold',      'Expense', 'debit'),
    (p_company, 'FG_INVENTORY','Finished Goods Inventory','Asset',   'debit'),
    (p_company, 'AR',          'Accounts Receivable',     'Asset',   'debit')
  on conflict (company_id, account_code) do nothing;
end; $$;
revoke all on function public.pos_ensure_accounts(uuid) from public;
grant execute on function public.pos_ensure_accounts(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. sales_orders + items + invoices (branch-owned, 20.17). Read-only to clients; written by pos_record_sale only.
-- ════════════════════════════════════════════════════════════════════════════
create table public.sales_orders (
  id            uuid primary key default public.uuidv7(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  branch_id     uuid not null,
  order_number  bigint not null,
  customer_id   uuid,                                   -- null = walk-in retail (customer master = 20.11, later)
  order_date    timestamptz not null default now(),
  sales_channel text not null default 'Farm Gate' check (sales_channel in ('Farm Gate', 'Retail Store', 'Restaurant', 'Supermarket', 'Online')),
  status        text not null default 'Completed' check (status in ('Draft', 'Confirmed', 'Completed', 'Cancelled')),
  subtotal      numeric(14, 2) not null,
  discount      numeric(14, 2) not null default 0,
  total_amount  numeric(14, 2) not null,
  idempotency_key text,
  created_by    uuid references public.users (id) on delete restrict,
  created_at    timestamptz not null default now(),
  unique (company_id, branch_id, order_number),
  unique (id, company_id),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict
);
create unique index sales_orders_idem_uq on public.sales_orders (company_id, idempotency_key) where idempotency_key is not null;
create index sales_orders_branch_idx on public.sales_orders (branch_id, company_id);
comment on table public.sales_orders is 'Sales orders (P2-M2B, 20.17). A POS sale = a Farm-Gate order. Branch-owned; written by pos_record_sale only; idempotent (B5).';

create table public.sales_order_items (
  id                      uuid primary key default public.uuidv7(),
  company_id              uuid not null references public.companies (id) on delete restrict,
  sales_order_id          uuid not null,
  product_id              uuid not null,
  finished_goods_batch_id uuid not null,
  quantity                numeric(12, 3) not null check (quantity > 0),
  unit_price              numeric(12, 2) not null check (unit_price >= 0),
  line_total              numeric(14, 2) not null,
  unit_cost               numeric(12, 2) not null default 0,
  foreign key (sales_order_id, company_id) references public.sales_orders (id, company_id) on delete restrict
);
create index sales_order_items_order_idx on public.sales_order_items (sales_order_id, company_id);

create table public.invoices (
  id             uuid primary key default public.uuidv7(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  branch_id      uuid not null,
  sales_order_id uuid not null,
  invoice_number bigint not null,
  invoice_type   text not null default 'cash' check (invoice_type in ('cash', 'credit')),
  total          numeric(14, 2) not null,
  tender_cash    numeric(14, 2) not null default 0,
  change_amount  numeric(14, 2) not null default 0,
  status         text not null default 'Paid' check (status in ('Paid', 'Unpaid', 'Voided')),
  created_by     uuid references public.users (id) on delete restrict,
  created_at     timestamptz not null default now(),
  unique (company_id, branch_id, invoice_number),
  unique (id, company_id),
  foreign key (sales_order_id, company_id) references public.sales_orders (id, company_id) on delete restrict,
  foreign key (branch_id, company_id)      references public.branches (id, company_id)     on delete restrict
);
comment on table public.invoices is 'Invoices (P2-M2B, 20.17) — the legal financial record; the printed slip is a render of this. Branch-owned; written by pos_record_sale only.';

-- RLS: members of the branch read; no client writes (functions only).
do $$ begin
  perform 1;
end $$;
alter table public.sales_orders enable row level security;       alter table public.sales_orders force row level security;
alter table public.sales_order_items enable row level security;  alter table public.sales_order_items force row level security;
alter table public.invoices enable row level security;           alter table public.invoices force row level security;
revoke all on public.sales_orders, public.sales_order_items, public.invoices from public, anon, authenticated, service_role;
grant select on public.sales_orders, public.sales_order_items, public.invoices to authenticated;
create policy sales_orders_select_member on public.sales_orders for select to authenticated using (public.is_branch_member(branch_id));
create policy sales_order_items_select_member on public.sales_order_items for select to authenticated
  using (company_id in (select public.accessible_company_ids()));
create policy invoices_select_member on public.invoices for select to authenticated using (public.is_branch_member(branch_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. journal_entries + journal_lines (branch-owned, append-only, 20.22/22.04). Always balanced (enforced in posting).
-- ════════════════════════════════════════════════════════════════════════════
create table public.journal_entries (
  id                   uuid primary key default public.uuidv7(),
  company_id           uuid not null references public.companies (id) on delete restrict,
  branch_id            uuid not null,
  entry_number         bigint not null,
  entry_date           timestamptz not null default now(),
  source_document_type text not null,
  source_document_id   uuid,
  description          text,
  created_by           uuid references public.users (id) on delete restrict,
  created_at           timestamptz not null default now(),
  unique (company_id, branch_id, entry_number),
  unique (id, company_id),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict
);
create table public.journal_lines (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  journal_entry_id uuid not null,
  account_id       uuid not null,
  debit            numeric(14, 2) not null default 0 check (debit >= 0),
  credit           numeric(14, 2) not null default 0 check (credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  foreign key (journal_entry_id, company_id) references public.journal_entries (id, company_id) on delete restrict,
  foreign key (account_id, company_id)       references public.chart_of_accounts (id, company_id) on delete restrict
);
create index journal_lines_entry_idx on public.journal_lines (journal_entry_id, company_id);
comment on table public.journal_entries is 'GL journal entries (P2-M2B, 20.22). Append-only; written by posting functions only; every entry balances (debits=credits).';

alter table public.journal_entries enable row level security;  alter table public.journal_entries force row level security;
alter table public.journal_lines enable row level security;    alter table public.journal_lines force row level security;
revoke all on public.journal_entries, public.journal_lines from public, anon, authenticated, service_role;
grant select on public.journal_entries, public.journal_lines to authenticated;
create policy journal_entries_select on public.journal_entries for select to authenticated using (public.is_branch_member(branch_id));
create policy journal_lines_select on public.journal_lines for select to authenticated
  using (company_id in (select public.accessible_company_ids()));
-- append-only (financial immutability): block modification for every role
create trigger journal_entries_block_u before update on public.journal_entries for each row execute function public.finance_block_modify();
create trigger journal_entries_block_d before delete on public.journal_entries for each row execute function public.finance_block_modify();
create trigger journal_lines_block_u before update on public.journal_lines for each row execute function public.finance_block_modify();
create trigger journal_lines_block_d before delete on public.journal_lines for each row execute function public.finance_block_modify();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. pos_record_sale — the governed weigh-sale: ONE atomic transaction (20.17 + 20.16/20.09 + 22.06/26.07).
--    p_lines = jsonb array of {product_id, finished_goods_batch_id, weight_kg}. Server recomputes prices from
--    `products` (no client price trust). Paid cash sale. Idempotent on (company_id, idempotency_key).
-- ════════════════════════════════════════════════════════════════════════════
create function public.pos_record_sale(
  p_branch_id uuid, p_lines jsonb, p_tender_cash numeric, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid; v_actor uuid; v_existing uuid; v_line jsonb;
  v_pid uuid; v_fg uuid; v_qty numeric; v_price numeric; v_cost numeric;
  v_subtotal numeric := 0; v_cogs numeric := 0;
  v_order uuid; v_invoice uuid; v_entry uuid;
  a_cash uuid; a_sales uuid; a_cogs uuid; a_fg uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'pos.sell') then raise exception 'permission denied: pos.sell' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(p_branch_id) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;

  -- Idempotency (B5): a retry returns the prior invoice, never a second sale.
  select i.id into v_existing from public.sales_orders so join public.invoices i on i.sales_order_id = so.id
    where so.company_id = v_company and so.idempotency_key = p_idempotency_key;
  if v_existing is not null then return v_existing; end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'empty sale' using errcode = 'check_violation'; end if;
  perform public.pos_ensure_accounts(v_company);

  v_order := public.uuidv7();
  insert into public.sales_orders (id, company_id, branch_id, order_number, sales_channel, status, subtotal, total_amount, idempotency_key, created_by)
    values (v_order, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'order'), 'Farm Gate', 'Completed', 0, 0, p_idempotency_key, v_actor);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pid := (v_line ->> 'product_id')::uuid;
    v_fg  := (v_line ->> 'finished_goods_batch_id')::uuid;
    v_qty := (v_line ->> 'weight_kg')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'weight must be > 0' using errcode = 'check_violation'; end if;
    -- price authority: server reads the selling price + cost; client values are ignored.
    select pr.retail_per_kg into v_price from public.products pr where pr.id = v_pid and pr.company_id = v_company and pr.status = 'Active';
    if v_price is null then raise exception 'unknown/inactive product' using errcode = 'foreign_key_violation'; end if;
    select fg.cost_per_unit into v_cost from public.finished_goods_batches fg where fg.id = v_fg and fg.company_id = v_company;
    if v_cost is null then raise exception 'unknown finished-goods batch' using errcode = 'foreign_key_violation'; end if;
    -- no oversell (20.17 revenue-integrity): available is derived from the ledger.
    if public.fg_available(v_fg) < v_qty then raise exception 'insufficient stock for batch %', v_fg using errcode = 'check_violation'; end if;

    insert into public.sales_order_items (company_id, sales_order_id, product_id, finished_goods_batch_id, quantity, unit_price, line_total, unit_cost)
      values (v_company, v_order, v_pid, v_fg, v_qty, v_price, round(v_qty * v_price, 2), v_cost);
    -- deduct stock via the controlled movement ledger (M2A)
    insert into public.inventory_movements (company_id, branch_id, finished_goods_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, actor_user_id)
      values (v_company, p_branch_id, v_fg, 'Sales', v_qty, v_cost, round(v_qty * v_cost, 2), 'SalesInvoice', v_order, v_actor);
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_cogs := v_cogs + round(v_qty * v_cost, 2);
  end loop;

  if p_tender_cash is null or p_tender_cash < v_subtotal then raise exception 'insufficient cash tendered' using errcode = 'check_violation'; end if;

  update public.sales_orders set subtotal = v_subtotal, total_amount = v_subtotal where id = v_order;
  v_invoice := public.uuidv7();
  insert into public.invoices (id, company_id, branch_id, sales_order_id, invoice_number, invoice_type, total, tender_cash, change_amount, status, created_by)
    values (v_invoice, v_company, p_branch_id, v_order, public.pos_next_seq(v_company, p_branch_id, 'invoice'), 'cash', v_subtotal, p_tender_cash, round(p_tender_cash - v_subtotal, 2), 'Paid', v_actor);

  -- Automatic, atomic, BALANCED posting (22.06/26.07): Dr Cash/Cr Sales ; Dr COGS/Cr FG Inventory.
  select id into a_cash  from public.chart_of_accounts where company_id = v_company and account_code = 'CASH';
  select id into a_sales from public.chart_of_accounts where company_id = v_company and account_code = 'SALES';
  select id into a_cogs  from public.chart_of_accounts where company_id = v_company and account_code = 'COGS';
  select id into a_fg    from public.chart_of_accounts where company_id = v_company and account_code = 'FG_INVENTORY';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, p_branch_id, public.pos_next_seq(v_company, p_branch_id, 'journal'), 'SalesInvoice', v_invoice, 'POS sale', v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_cash,  v_subtotal, 0),
    (v_company, v_entry, a_sales, 0, v_subtotal);
  if v_cogs > 0 then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_cogs, v_cogs, 0),
      (v_company, v_entry, a_fg,   0, v_cogs);
  end if;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, p_branch_id, v_actor, 'Business', 'pos.sale_recorded', 'pos', 'invoices', v_invoice);
  return v_invoice;
end; $$;
comment on function public.pos_record_sale(uuid, jsonb, numeric, text) is 'Phase 2 M2B: atomic weigh-sale — sales_order + invoice + inventory Sales movement + COGS + balanced GL posting (22.06/26.07). pos.sell + branch member; server price authority; no oversell; idempotent (B5); audited (M5).';
revoke all on function public.pos_record_sale(uuid, jsonb, numeric, text) from public;
grant execute on function public.pos_record_sale(uuid, jsonb, numeric, text) to authenticated;
