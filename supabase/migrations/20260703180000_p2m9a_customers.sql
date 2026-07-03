-- Migration P2-M9A — Customers & Credit (Phase 2, Module 9A / backlog B1)
-- Authority: Phase_2_Mockup_Reference_and_Backlog.md B1 (customer master + credit standing) · System 22.07
--   (Accounts Receivable lifecycle & credit controls) = structural authority · 26.09 permission matrix.
-- Scope of THIS slice (deliberately NON-money-mutating, so it stays off the C7 §4 money-path tripwire):
--   (a) a customers master table (company-scoped master data, like products/employees);
--   (b) an additive nullable invoices.customer_id + a governed ATTRIBUTION function that only tags an existing
--       invoice with a customer — it posts NO journal, changes NO amount;
--   (c) a read-only customer_ar_standing() deriving each customer's outstanding AR from unpaid invoices.
-- DEFERRED to the pending cross-vendor money-path review (charter §4.6): credit-limit ENFORCEMENT inside the sale
--   (rejecting a credit sale over the limit) — that touches pos_record_sale, a money path. Not in this slice.
-- Pattern: ADDITIVE ONLY — no locked file modified (invoices is ALTERed additively, the M3A idiom). Risk: Low
--   (master data + attribution + a read; no GL posting).

-- ── Permission catalog (26.09) ──
insert into public.permissions (permission_key, description) values
  ('customer.read',   'View customers and their receivable/credit standing'),
  ('customer.manage', 'Create and edit customers and their credit limits')
on conflict (permission_key) do nothing;

-- ── customers master ──
create table public.customers (
  id           uuid primary key default public.uuidv7(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  name         text not null,
  contact      text,
  credit_limit numeric(14, 2) check (credit_limit is null or credit_limit >= 0),  -- null = no explicit limit
  notes        text,
  status       text not null default 'Active' check (status in ('Active', 'Archived')),
  created_by   uuid references public.users (id) on delete restrict,
  created_at   timestamptz not null default now(),
  unique (id, company_id)  -- enables the composite (id, company_id) FK from invoices (tenant integrity)
);
create index customers_company_idx on public.customers (company_id, status);
comment on table public.customers is 'P2-M9A (B1/22.07): customer master with optional credit limit. Written only by customer_upsert/customer_set_status; receivable balances are DERIVED from invoices (customer_ar_standing), never stored.';
alter table public.customers enable row level security;
alter table public.customers force row level security;
revoke all on public.customers from public, anon, authenticated, service_role;
grant select on public.customers to authenticated;
create policy customers_select_member on public.customers for select to authenticated
  using (public.has_permission(company_id, 'customer.read'));

-- ── invoices.customer_id (additive; nullable — existing/walk-in sales have no customer) ──
alter table public.invoices add column customer_id uuid;
alter table public.invoices add constraint invoices_customer_fk
  foreign key (customer_id, company_id) references public.customers (id, company_id) on delete restrict;
create index invoices_customer_idx on public.invoices (customer_id, company_id) where customer_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- customer_upsert — create (p_id null) or edit. customer.manage. Returns the customer id.
-- ════════════════════════════════════════════════════════════════════════════
create function public.customer_upsert(
  p_company uuid, p_id uuid, p_name text, p_contact text, p_credit_limit numeric, p_notes text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company, 'customer.manage') then raise exception 'permission denied: customer.manage' using errcode = 'insufficient_privilege'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'customer name is required' using errcode = 'check_violation'; end if;
  if p_credit_limit is not null and p_credit_limit < 0 then raise exception 'credit limit cannot be negative' using errcode = 'check_violation'; end if;

  if p_id is null then
    insert into public.customers (company_id, name, contact, credit_limit, notes, created_by)
      values (p_company, trim(p_name), nullif(trim(coalesce(p_contact, '')), ''), p_credit_limit, nullif(trim(coalesce(p_notes, '')), ''), v_actor)
      returning id into v_id;
  else
    update public.customers set
      name = trim(p_name), contact = nullif(trim(coalesce(p_contact, '')), ''), credit_limit = p_credit_limit, notes = nullif(trim(coalesce(p_notes, '')), '')
      where id = p_id and company_id = p_company
      returning id into v_id;
    if v_id is null then raise exception 'customer not found in this company' using errcode = 'foreign_key_violation'; end if;
  end if;

  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (p_company, v_actor, 'Business', case when p_id is null then 'customer.created' else 'customer.updated' end, 'customers', 'customers', v_id);
  return v_id;
end; $$;
comment on function public.customer_upsert(uuid, uuid, text, text, numeric, text) is 'P2-M9A: create/edit a customer (credit limit optional). customer.manage; audited. No GL.';
revoke all on function public.customer_upsert(uuid, uuid, text, text, numeric, text) from public;
grant execute on function public.customer_upsert(uuid, uuid, text, text, numeric, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- customer_set_status — archive/reactivate. customer.manage.
-- ════════════════════════════════════════════════════════════════════════════
create function public.customer_set_status(p_customer_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if p_status not in ('Active', 'Archived') then raise exception 'invalid status' using errcode = 'check_violation'; end if;
  select company_id into v_company from public.customers where id = p_customer_id;
  if v_company is null then raise exception 'customer not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'customer.manage') then raise exception 'permission denied: customer.manage' using errcode = 'insufficient_privilege'; end if;
  update public.customers set status = p_status where id = p_customer_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Administrative', 'customer.status_changed', 'customers', 'customers', p_customer_id);
end; $$;
revoke all on function public.customer_set_status(uuid, text) from public;
grant execute on function public.customer_set_status(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- pos_assign_invoice_customer — ATTRIBUTION ONLY: tag an existing invoice with a customer. Posts NO journal and
--   changes NO amount (not a money mutation). pos.sell (it happens in the sale/receivables flow) + branch member.
-- ════════════════════════════════════════════════════════════════════════════
create function public.pos_assign_invoice_customer(p_invoice_id uuid, p_customer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid; v_branch uuid; v_cust_company uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select company_id, branch_id into v_company, v_branch from public.invoices where id = p_invoice_id;
  if v_company is null then raise exception 'invoice not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'pos.sell') then raise exception 'permission denied: pos.sell' using errcode = 'insufficient_privilege'; end if;
  if not public.is_branch_member(v_branch) then raise exception 'not a member of this branch' using errcode = 'insufficient_privilege'; end if;
  if p_customer_id is not null then
    select company_id into v_cust_company from public.customers where id = p_customer_id;
    if v_cust_company is null or v_cust_company <> v_company then raise exception 'customer not in this company' using errcode = 'foreign_key_violation'; end if;
  end if;
  update public.invoices set customer_id = p_customer_id where id = p_invoice_id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_branch, v_actor, 'Business', 'customer.invoice_assigned', 'customers', 'invoices', p_invoice_id);
end; $$;
comment on function public.pos_assign_invoice_customer(uuid, uuid) is 'P2-M9A: tag an invoice with a customer (attribution only — no GL, no amount change). pos.sell + branch member. Cross-tenant safe (customer must share the invoice company).';
revoke all on function public.pos_assign_invoice_customer(uuid, uuid) from public;
grant execute on function public.pos_assign_invoice_customer(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- customer_ar_standing — read: outstanding receivable per customer (Σ unpaid invoice totals) + available credit.
--   Balances are DERIVED here, never stored (22.07). customer.read.
-- ════════════════════════════════════════════════════════════════════════════
create function public.customer_ar_standing(p_company uuid, p_branch_id uuid default null)
returns table(customer_id uuid, name text, status text, credit_limit numeric, outstanding_ar numeric, available_credit numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission(p_company, 'customer.read') then
    raise exception 'permission denied: customer.read' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, c.name, c.status, c.credit_limit,
           coalesce(sum(i.total) filter (where i.status = 'Unpaid'), 0)::numeric as outstanding,
           case when c.credit_limit is null then null
                else (c.credit_limit - coalesce(sum(i.total) filter (where i.status = 'Unpaid'), 0))::numeric end
    from public.customers c
    left join public.invoices i on i.customer_id = c.id and i.company_id = c.company_id
      and (p_branch_id is null or i.branch_id = p_branch_id)
    where c.company_id = p_company
    group by c.id, c.name, c.status, c.credit_limit
    order by c.name;
end; $$;
comment on function public.customer_ar_standing(uuid, uuid) is 'P2-M9A: per-customer outstanding AR (Σ unpaid invoices) + available credit (limit − outstanding, null if no limit). Derived, never stored. customer.read.';
revoke all on function public.customer_ar_standing(uuid, uuid) from public;
grant execute on function public.customer_ar_standing(uuid, uuid) to authenticated;
