-- Migration T3.1 (owner directive 2026-07-19: "finish and deploy the deferred money path") — Vendor
-- master + Cost Schedule + Vendor ledger (Accounts Payable). Reverses an earlier YAGNI deferral
-- ("supplier/AP master — cash-only purchases", recorded in the Phase 2 gap-check). Ported from Repo B
-- (`pick-ur-veggie-farm - GLM Version`, 20260716170000_t3_1_vendors_and_ledger.sql, guard 8/8,
-- cloud-verified) under the standing two-repo port lane — verbatim, no Repo-A-specific schema
-- conflicts found (chart_of_accounts / has_permission / is_branch_member / pos_next_seq / uuidv7 /
-- set_updated_at / audit_events are all foundational and identical between the two repos).
--
-- Mirrors the customer-side architecture in P2-M9A (2026-07-03):
--   - Master table for vendors (id, company_id, code, name, contact, address, tax_id, terms, status)
--   - Cost-schedule rate card (per vendor × product × effective date range)
--   - Vendor invoice header + lines, each line carrying the chosen expense account_id
--   - Vendor payment header + allocations (a payment can split across multiple invoices)
--   - DERIVED AP standing per vendor (read-only function; balances never stored)
--   - Journal entries are written append-only + balanced per entry (22.07 invariant)
--   - Functions are SECURITY DEFINER with `set search_path = ''`, gated on the vendor.read /
--     vendor.manage permissions. The expense account per line is the caller's choice but must
--     belong to the company; the AP credit account is always the company's 'AP' account.
--
-- PERMISSIONS: seeds `vendor.read` and `vendor.manage` (new keys). New keys fold under the existing
-- 3-state Access panel (module = "Vendors") — no seed_standard_roles change needed; the owner grants
-- per role via the Roles tab Access dialog, same as any other module.
--
-- AUTHORITY: B7 §6 lifecycle · M4 §4 audit · 22.07 (balances are derived, never stored) ·
--            AGENTS.md §2 (money-path gate: vendor invoice writes GL; sign-off: owner 2026-07-19).
-- RISK: High (new write surface on a money path). Guard battery required.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Permission seeds
-- ════════════════════════════════════════════════════════════════════════════
insert into public.permissions (permission_key, description, module) values
  ('vendor.read',   'View vendors, their cost schedules, and AP standing',       'Vendors'),
  ('vendor.manage', 'Create and edit vendors, cost schedules, and AP postings', 'Vendors')
on conflict (permission_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. AP account bootstrap (mirrors pos_ensure_accounts; gated on vendor.manage).
-- ════════════════════════════════════════════════════════════════════════════
create function public.vendor_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_permission(p_company, 'vendor.manage') then
    raise exception 'permission denied: vendor.manage' using errcode = 'insufficient_privilege';
  end if;
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance, status) values
    (p_company, 'AP', 'Accounts Payable', 'Liability', 'credit', 'Active')
  on conflict (company_id, account_code) do nothing;
end;
$$;
comment on function public.vendor_ensure_accounts(uuid) is 'T3.1: seed the AP account row for a company (idempotent). vendor.manage-gated. Call once per company after the migration is applied.';
revoke all on function public.vendor_ensure_accounts(uuid) from public, anon;
grant execute on function public.vendor_ensure_accounts(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. vendors master
-- ════════════════════════════════════════════════════════════════════════════
create table public.vendors (
  id            uuid primary key default public.uuidv7(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  vendor_code   text not null,
  name          text not null,
  contact       text,
  address       text,
  tax_id        text,
  payment_terms text,
  notes         text,
  status        text not null default 'Active' check (status in ('Active', 'Archived')),
  created_by    uuid references public.users (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, vendor_code),
  unique (id, company_id)
);
create index vendors_company_idx on public.vendors (company_id, status);
create trigger vendors_set_updated_at before update on public.vendors
  for each row execute function public.set_updated_at();
comment on table public.vendors is 'T3.1 (2026-07-19): vendor master. Written only by vendor_upsert. AP balances are DERIVED from vendor_invoices + vendor_payments via vendor_ap_standing, never stored.';
alter table public.vendors enable row level security;
alter table public.vendors force row level security;
revoke all on public.vendors from public, anon, authenticated, service_role;
grant select on public.vendors to authenticated;
create policy vendors_select on public.vendors for select to authenticated
  using (public.has_permission(company_id, 'vendor.read'));

-- ════════════════════════════════════════════════════════════════════════════
-- 4. cost_schedule (per vendor × product × effective date range)
-- ════════════════════════════════════════════════════════════════════════════
create table public.cost_schedule (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  vendor_id        uuid not null references public.vendors (id) on delete restrict,
  product_id       uuid not null references public.products (id) on delete restrict,
  unit_cost        numeric(14, 2) not null check (unit_cost >= 0),
  effective_from   date not null,
  effective_to     date,
  notes            text,
  created_by       uuid references public.users (id) on delete restrict,
  created_at       timestamptz not null default now()
);
create index cost_schedule_lookup_idx on public.cost_schedule (company_id, vendor_id, product_id, effective_from);
comment on table public.cost_schedule is 'T3.1: vendor rate card. unit_cost is vendor X''s price for product P starting effective_from. effective_to = null means still active.';
alter table public.cost_schedule enable row level security;
alter table public.cost_schedule force row level security;
revoke all on public.cost_schedule from public, anon, authenticated, service_role;
grant select on public.cost_schedule to authenticated;
create policy cost_schedule_select on public.cost_schedule for select to authenticated
  using (public.has_permission(company_id, 'vendor.read'));

-- ════════════════════════════════════════════════════════════════════════════
-- 5. vendor_invoices + vendor_invoice_lines
-- ════════════════════════════════════════════════════════════════════════════
create table public.vendor_invoices (
  id              uuid primary key default public.uuidv7(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  branch_id       uuid not null references public.branches (id) on delete restrict,
  vendor_id       uuid not null references public.vendors (id) on delete restrict,
  invoice_number  text not null,
  invoice_date    date not null,
  due_date        date,
  total           numeric(14, 2) not null default 0 check (total >= 0),
  paid_amount     numeric(14, 2) not null default 0 check (paid_amount >= 0),
  status          text not null default 'Approved' check (status in ('Draft', 'Approved', 'Paid', 'Cancelled', 'Partial')),
  notes           text,
  journal_entry_id uuid,
  created_by      uuid references public.users (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (paid_amount <= total)
);
create unique index vendor_invoices_unique_number
  on public.vendor_invoices (company_id, vendor_id, invoice_number) where status <> 'Cancelled';
create index vendor_invoices_company_idx on public.vendor_invoices (company_id, vendor_id, invoice_date);
create trigger vendor_invoices_set_updated_at before update on public.vendor_invoices
  for each row execute function public.set_updated_at();
comment on table public.vendor_invoices is 'T3.1: vendor bills. status Approved means the journal entry is posted and AP is open; Paid means fully allocated; Partial means partially paid.';
alter table public.vendor_invoices enable row level security;
alter table public.vendor_invoices force row level security;
revoke all on public.vendor_invoices from public, anon, authenticated, service_role;
grant select on public.vendor_invoices to authenticated;
create policy vendor_invoices_select on public.vendor_invoices for select to authenticated
  using (public.has_permission(company_id, 'vendor.read'));

create table public.vendor_invoice_lines (
  id                uuid primary key default public.uuidv7(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  vendor_invoice_id uuid not null references public.vendor_invoices (id) on delete restrict,
  product_id        uuid references public.products (id) on delete restrict,
  description       text,
  quantity          numeric(14, 3) not null check (quantity >= 0),
  unit_cost         numeric(14, 2) not null check (unit_cost >= 0),
  line_total        numeric(14, 2) not null check (line_total >= 0),
  expense_account_id uuid not null references public.chart_of_accounts (id) on delete restrict,
  cost_schedule_id  uuid references public.cost_schedule (id) on delete restrict,
  created_at        timestamptz not null default now()
);
create index vendor_invoice_lines_invoice_idx on public.vendor_invoice_lines (vendor_invoice_id);
comment on table public.vendor_invoice_lines is 'T3.1: vendor invoice lines. Each line picks its expense account (in company, Asset/Expense type). product_id is nullable for utility/non-stock lines.';
alter table public.vendor_invoice_lines enable row level security;
alter table public.vendor_invoice_lines force row level security;
revoke all on public.vendor_invoice_lines from public, anon, authenticated, service_role;
grant select on public.vendor_invoice_lines to authenticated;
create policy vendor_invoice_lines_select on public.vendor_invoice_lines for select to authenticated
  using (public.has_permission(company_id, 'vendor.read'));

-- ════════════════════════════════════════════════════════════════════════════
-- 6. vendor_payments + vendor_payment_allocations
-- ════════════════════════════════════════════════════════════════════════════
create table public.vendor_payments (
  id              uuid primary key default public.uuidv7(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  branch_id       uuid not null references public.branches (id) on delete restrict,
  vendor_id       uuid not null references public.vendors (id) on delete restrict,
  payment_date    date not null,
  amount          numeric(14, 2) not null check (amount > 0),
  method          text not null default 'Cash' check (method in ('Cash', 'Bank', 'Check', 'Other')),
  reference       text,
  notes           text,
  journal_entry_id uuid not null,
  created_by      uuid references public.users (id) on delete restrict,
  created_at      timestamptz not null default now()
);
create index vendor_payments_company_idx on public.vendor_payments (company_id, vendor_id, payment_date);
comment on table public.vendor_payments is 'T3.1: vendor payments. Each payment posts ONE journal entry (debit AP, credit CASH) and is allocated across one or more vendor_invoices via vendor_payment_allocations.';

create table public.vendor_payment_allocations (
  id                 uuid primary key default public.uuidv7(),
  company_id         uuid not null references public.companies (id) on delete restrict,
  payment_id         uuid not null references public.vendor_payments (id) on delete restrict,
  vendor_invoice_id  uuid not null references public.vendor_invoices (id) on delete restrict,
  amount             numeric(14, 2) not null check (amount > 0),
  created_at         timestamptz not null default now()
);
create index vendor_payment_allocations_payment_idx on public.vendor_payment_allocations (payment_id);
create index vendor_payment_allocations_invoice_idx on public.vendor_payment_allocations (vendor_invoice_id);
comment on table public.vendor_payment_allocations is 'T3.1: links a payment to the invoices it settles. A single payment can split across invoices; an invoice can be paid by multiple payments (partials).';

alter table public.vendor_payments enable row level security;
alter table public.vendor_payments force row level security;
alter table public.vendor_payment_allocations enable row level security;
alter table public.vendor_payment_allocations force row level security;
revoke all on public.vendor_payments from public, anon, authenticated, service_role;
revoke all on public.vendor_payment_allocations from public, anon, authenticated, service_role;
grant select on public.vendor_payments to authenticated;
grant select on public.vendor_payment_allocations to authenticated;
create policy vendor_payments_select on public.vendor_payments for select to authenticated
  using (public.has_permission(company_id, 'vendor.read'));
create policy vendor_payment_allocations_select on public.vendor_payment_allocations for select to authenticated
  using (public.has_permission(company_id, 'vendor.read'));

-- ════════════════════════════════════════════════════════════════════════════
-- 7. RPCs
-- ════════════════════════════════════════════════════════════════════════════

create function public.vendor_upsert(
  p_company uuid, p_id uuid, p_vendor_code text, p_name text,
  p_contact text default null, p_address text default null, p_tax_id text default null,
  p_payment_terms text default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company, 'vendor.manage') then
    raise exception 'permission denied: vendor.manage' using errcode = 'insufficient_privilege';
  end if;
  if trim(coalesce(p_name, '')) = '' then
    raise exception 'a vendor name is required' using errcode = 'check_violation';
  end if;
  if trim(coalesce(p_vendor_code, '')) = '' then
    raise exception 'a vendor code is required' using errcode = 'check_violation';
  end if;
  if p_id is null then
    insert into public.vendors (company_id, vendor_code, name, contact, address, tax_id, payment_terms, notes, created_by)
      values (p_company, trim(p_vendor_code), trim(p_name), nullif(trim(p_contact), ''), nullif(trim(p_address), ''), nullif(trim(p_tax_id), ''), nullif(trim(p_payment_terms), ''), nullif(trim(p_notes), ''), v_actor)
      returning id into v_id;
  else
    update public.vendors set
      vendor_code = trim(p_vendor_code), name = trim(p_name),
      contact = nullif(trim(p_contact), ''), address = nullif(trim(p_address), ''),
      tax_id = nullif(trim(p_tax_id), ''), payment_terms = nullif(trim(p_payment_terms), ''),
      notes = nullif(trim(p_notes), '')
    where id = p_id and company_id = p_company
    returning id into v_id;
    if v_id is null then raise exception 'vendor not found in this company' using errcode = 'raise_exception'; end if;
  end if;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (p_company, v_actor, 'Business', 'vendor.upserted', 'Vendors', 'vendors', v_id);
  return v_id;
end; $$;
comment on function public.vendor_upsert(uuid, uuid, text, text, text, text, text, text, text) is 'T3.1: create or edit a vendor. vendor.manage required. Returns the vendor id.';
revoke all on function public.vendor_upsert(uuid, uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.vendor_upsert(uuid, uuid, text, text, text, text, text, text, text) to authenticated;

create function public.cost_schedule_upsert(
  p_company uuid, p_id uuid, p_vendor_id uuid, p_product_id uuid,
  p_unit_cost numeric, p_effective_from date, p_effective_to date default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_id uuid; v_prior_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company, 'vendor.manage') then
    raise exception 'permission denied: vendor.manage' using errcode = 'insufficient_privilege';
  end if;
  if p_unit_cost < 0 then raise exception 'unit_cost must be >= 0' using errcode = 'check_violation'; end if;
  if p_effective_to is not null and p_effective_to < p_effective_from then
    raise exception 'effective_to must be on or after effective_from' using errcode = 'check_violation';
  end if;
  select id into v_prior_id from public.cost_schedule
   where company_id = p_company and vendor_id = p_vendor_id and product_id = p_product_id
     and effective_to is null and effective_from < p_effective_from
   order by effective_from desc limit 1;
  if v_prior_id is not null then
    update public.cost_schedule set effective_to = p_effective_from - interval '1 day'
     where id = v_prior_id;
  end if;
  if p_id is null then
    insert into public.cost_schedule (company_id, vendor_id, product_id, unit_cost, effective_from, effective_to, notes, created_by)
      values (p_company, p_vendor_id, p_product_id, p_unit_cost, p_effective_from, p_effective_to, nullif(trim(p_notes), ''), v_actor)
      returning id into v_id;
  else
    update public.cost_schedule set
      unit_cost = p_unit_cost, effective_from = p_effective_from, effective_to = p_effective_to,
      notes = nullif(trim(p_notes), '')
    where id = p_id and company_id = p_company
    returning id into v_id;
    if v_id is null then raise exception 'cost_schedule row not found' using errcode = 'raise_exception'; end if;
  end if;
  return v_id;
end; $$;
comment on function public.cost_schedule_upsert(uuid, uuid, uuid, uuid, numeric, date, date, text) is 'T3.1: add or edit a rate-card row. Auto-closes the prior active row for the same (vendor, product).';
revoke all on function public.cost_schedule_upsert(uuid, uuid, uuid, uuid, numeric, date, date, text) from public, anon;
grant execute on function public.cost_schedule_upsert(uuid, uuid, uuid, uuid, numeric, date, date, text) to authenticated;

create function public.cost_schedule_lookup(p_company uuid, p_vendor_id uuid, p_product_id uuid, p_on_date date)
returns table(unit_cost numeric, schedule_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission(p_company, 'vendor.read') then
    raise exception 'permission denied: vendor.read' using errcode = 'insufficient_privilege';
  end if;
  return query
    select cs.unit_cost, cs.id
      from public.cost_schedule cs
     where cs.company_id = p_company and cs.vendor_id = p_vendor_id and cs.product_id = p_product_id
       and cs.effective_from <= p_on_date
       and (cs.effective_to is null or cs.effective_to >= p_on_date)
     order by cs.effective_from desc limit 1;
end; $$;
comment on function public.cost_schedule_lookup(uuid, uuid, uuid, date) is 'T3.1: return the effective rate-card unit_cost + row id for (vendor, product) on a given date. vendor.read-gated.';
revoke all on function public.cost_schedule_lookup(uuid, uuid, uuid, date) from public, anon;
grant execute on function public.cost_schedule_lookup(uuid, uuid, uuid, date) to authenticated;

create function public.vendor_invoice_record(
  p_company uuid, p_branch_id uuid, p_vendor_id uuid,
  p_invoice_number text, p_invoice_date date, p_due_date date,
  p_lines jsonb, p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_invoice_id uuid; v_ap uuid; v_entry uuid;
  v_total numeric := 0; v_line_total numeric; v_line record; v_expense_ok boolean;
  v_debits numeric := 0; v_credits numeric := 0;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company, 'vendor.manage') then
    raise exception 'permission denied: vendor.manage' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(p_branch_id) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one line is required' using errcode = 'check_violation';
  end if;
  if trim(coalesce(p_invoice_number, '')) = '' then
    raise exception 'invoice_number is required' using errcode = 'check_violation';
  end if;
  select id into v_invoice_id from public.vendor_invoices
   where company_id = p_company and vendor_id = p_vendor_id and invoice_number = trim(p_invoice_number)
     and status <> 'Cancelled' limit 1;
  if v_invoice_id is not null then return v_invoice_id; end if;
  perform public.vendor_ensure_accounts(p_company);
  perform public.inventory_ensure_accounts(p_company); -- lines validate against RAW_MATERIALS/EQUIPMENT/OPERATING_EXPENSES — seed even if no purchase/sale ever ran
  select id into v_ap from public.chart_of_accounts where company_id = p_company and account_code = 'AP';
  if v_ap is null then raise exception 'AP account missing — vendor_ensure_accounts failed' using errcode = 'raise_exception'; end if;
  insert into public.vendor_invoices (company_id, branch_id, vendor_id, invoice_number, invoice_date, due_date, status, notes, created_by)
    values (p_company, p_branch_id, p_vendor_id, trim(p_invoice_number), p_invoice_date, p_due_date, 'Approved', nullif(trim(p_notes), ''), v_actor)
    returning id into v_invoice_id;
  for v_line in
    select (l->>'product_id')::uuid as product_id,
           nullif(trim(l->>'description'), '') as description,
           (l->>'quantity')::numeric as quantity,
           (l->>'unit_cost')::numeric as unit_cost,
           (l->>'expense_account_id')::uuid as expense_account_id,
           nullif(l->>'cost_schedule_id', '')::uuid as cost_schedule_id
      from jsonb_array_elements(p_lines) l
  loop
    if v_line.expense_account_id is null then
      raise exception 'each line must have an expense_account_id' using errcode = 'check_violation';
    end if;
    select (a.company_id = p_company and a.account_type in ('Asset', 'Expense'))
      into v_expense_ok
      from public.chart_of_accounts a where a.id = v_line.expense_account_id;
    if v_expense_ok is null or not v_expense_ok then
      raise exception 'expense_account_id must belong to this company and be Asset or Expense' using errcode = 'foreign_key_violation';
    end if;
    if v_line.quantity < 0 or v_line.unit_cost < 0 then
      raise exception 'quantity and unit_cost must be >= 0' using errcode = 'check_violation';
    end if;
    v_line_total := round(v_line.quantity * v_line.unit_cost, 2);
    insert into public.vendor_invoice_lines (company_id, vendor_invoice_id, product_id, description, quantity, unit_cost, line_total, expense_account_id, cost_schedule_id)
      values (p_company, v_invoice_id, v_line.product_id, v_line.description, v_line.quantity, v_line.unit_cost, v_line_total, v_line.expense_account_id, v_line.cost_schedule_id);
    v_total := v_total + v_line_total;
  end loop;
  v_total := round(v_total, 2);
  update public.vendor_invoices set total = v_total where id = v_invoice_id;
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, p_company, p_branch_id, public.pos_next_seq(p_company, p_branch_id, 'journal'), 'VendorInvoice', v_invoice_id, 'Vendor invoice: ' || trim(p_invoice_number), v_actor);
  for v_line in
    select expense_account_id, line_total from public.vendor_invoice_lines where vendor_invoice_id = v_invoice_id
  loop
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit)
      values (p_company, v_entry, v_line.expense_account_id, v_line.line_total, 0);
    v_debits := v_debits + v_line.line_total;
  end loop;
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit)
    values (p_company, v_entry, v_ap, 0, v_total);
  v_credits := v_total;
  if round(v_debits - v_credits, 2) <> 0 then
    raise exception 'internal: vendor invoice journal is not balanced (debits=%, credits=%)', v_debits, v_credits using errcode = 'check_violation';
  end if;
  update public.vendor_invoices set journal_entry_id = v_entry where id = v_invoice_id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (p_company, p_branch_id, v_actor, 'Business', 'vendor.invoice.recorded', 'Vendors', 'vendor_invoices', v_invoice_id,
            jsonb_build_object('total', v_total, 'lines', jsonb_array_length(p_lines)));
  return v_invoice_id;
end; $$;
comment on function public.vendor_invoice_record(uuid, uuid, uuid, text, date, date, jsonb, text) is 'T3.1: record a vendor invoice. Writes a single balanced journal entry (per-line debit + AP credit for the total). Idempotent on (company, vendor, invoice_number). vendor.manage-gated.';
revoke all on function public.vendor_invoice_record(uuid, uuid, uuid, text, date, date, jsonb, text) from public, anon;
grant execute on function public.vendor_invoice_record(uuid, uuid, uuid, text, date, date, jsonb, text) to authenticated;

create function public.vendor_payment_record(
  p_company uuid, p_branch_id uuid, p_vendor_id uuid,
  p_payment_date date, p_amount numeric, p_allocations jsonb,
  p_method text default 'Cash', p_reference text default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_payment_id uuid; v_entry uuid; v_ap uuid; v_cash uuid;
  v_total_alloc numeric := 0; v_alloc record; v_paid_after numeric;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company, 'vendor.manage') then
    raise exception 'permission denied: vendor.manage' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(p_branch_id) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;
  if p_amount <= 0 then raise exception 'payment amount must be > 0' using errcode = 'check_violation'; end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'at least one allocation is required' using errcode = 'check_violation';
  end if;
  perform public.vendor_ensure_accounts(p_company);
  perform public.inventory_ensure_accounts(p_company); -- CASH lives on the shared seed — guarantee it even if no sale/purchase ever ran
  select id into v_ap from public.chart_of_accounts where company_id = p_company and account_code = 'AP';
  select id into v_cash from public.chart_of_accounts where company_id = p_company and account_code = 'CASH';
  if v_ap is null or v_cash is null then raise exception 'AP / CASH accounts missing' using errcode = 'raise_exception'; end if;
  v_entry := public.uuidv7();
  insert into public.vendor_payments (id, company_id, branch_id, vendor_id, payment_date, amount, method, reference, notes, journal_entry_id, created_by)
    values (v_entry, p_company, p_branch_id, p_vendor_id, p_payment_date, p_amount, p_method, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), v_entry, v_actor)
    returning id into v_payment_id;
  for v_alloc in
    select (a->>'vendor_invoice_id')::uuid as invoice_id,
           (a->>'amount')::numeric as amount
      from jsonb_array_elements(p_allocations) a
  loop
    if v_alloc.invoice_id is null or v_alloc.amount is null or v_alloc.amount <= 0 then
      raise exception 'each allocation must have vendor_invoice_id and amount > 0' using errcode = 'check_violation';
    end if;
    perform 1 from public.vendor_invoices
     where id = v_alloc.invoice_id and company_id = p_company and vendor_id = p_vendor_id
     for update;
    if not found then raise exception 'invoice not found in this company/vendor' using errcode = 'raise_exception'; end if;
    v_paid_after := (select paid_amount from public.vendor_invoices where id = v_alloc.invoice_id) + v_alloc.amount;
    if v_paid_after > (select total from public.vendor_invoices where id = v_alloc.invoice_id) + 0.005 then
      raise exception 'allocation exceeds outstanding balance for invoice %', v_alloc.invoice_id using errcode = 'check_violation';
    end if;
    update public.vendor_invoices set paid_amount = round(v_paid_after, 2) where id = v_alloc.invoice_id;
    insert into public.vendor_payment_allocations (company_id, payment_id, vendor_invoice_id, amount)
      values (p_company, v_payment_id, v_alloc.invoice_id, v_alloc.amount);
    v_total_alloc := v_total_alloc + v_alloc.amount;
  end loop;
  v_total_alloc := round(v_total_alloc, 2);
  if v_total_alloc <> round(p_amount, 2) then
    raise exception 'allocations total (%) must equal payment amount (%)', v_total_alloc, p_amount using errcode = 'check_violation';
  end if;
  update public.vendor_invoices
    set status = case when paid_amount >= total - 0.005 then 'Paid' else 'Partial' end
    where id in (select vendor_invoice_id from public.vendor_payment_allocations where payment_id = v_payment_id)
      and status in ('Approved', 'Partial');
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, p_company, p_branch_id, public.pos_next_seq(p_company, p_branch_id, 'journal'), 'VendorPayment', v_payment_id, 'Vendor payment: ' || coalesce(p_reference, ''), v_actor);
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (p_company, v_entry, v_ap, p_amount, 0),
    (p_company, v_entry, v_cash, 0, p_amount);
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (p_company, p_branch_id, v_actor, 'Business', 'vendor.payment.recorded', 'Vendors', 'vendor_payments', v_payment_id,
            jsonb_build_object('amount', p_amount, 'allocations', jsonb_array_length(p_allocations)));
  return v_payment_id;
end; $$;
comment on function public.vendor_payment_record(uuid, uuid, uuid, date, numeric, jsonb, text, text, text) is 'T3.1: record a vendor payment. Allocates across one or more invoices (sum must equal amount). Writes one balanced journal entry (debit AP, credit CASH). vendor.manage-gated.';
revoke all on function public.vendor_payment_record(uuid, uuid, uuid, date, numeric, jsonb, text, text, text) from public, anon;
grant execute on function public.vendor_payment_record(uuid, uuid, uuid, date, numeric, jsonb, text, text, text) to authenticated;

create function public.vendor_ap_standing(p_company uuid, p_vendor_id uuid default null)
returns table(vendor_id uuid, name text, status text, total_invoiced numeric, total_paid numeric, outstanding_ap numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission(p_company, 'vendor.read') then
    raise exception 'permission denied: vendor.read' using errcode = 'insufficient_privilege';
  end if;
  return query
    select v.id, v.name, v.status,
           coalesce(sum(vi.total) filter (where vi.status in ('Approved', 'Partial', 'Paid')), 0)::numeric as total_invoiced,
           coalesce(sum(vi.paid_amount) filter (where vi.status in ('Approved', 'Partial', 'Paid')), 0)::numeric as total_paid,
           coalesce(sum(vi.total - vi.paid_amount) filter (where vi.status in ('Approved', 'Partial')), 0)::numeric as outstanding
      from public.vendors v
      left join public.vendor_invoices vi on vi.vendor_id = v.id and vi.company_id = v.company_id
     where v.company_id = p_company
       and (p_vendor_id is null or v.id = p_vendor_id)
     group by v.id, v.name, v.status
     order by v.name;
end; $$;
comment on function public.vendor_ap_standing(uuid, uuid) is 'T3.1: per-vendor outstanding AP (total invoiced - paid, derived from vendor_invoices). vendor.read-gated. Balances are never stored.';
revoke all on function public.vendor_ap_standing(uuid, uuid) from public, anon;
grant execute on function public.vendor_ap_standing(uuid, uuid) to authenticated;
