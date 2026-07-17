-- Migration P1O — POS product removal approval workflow (owner directive 2026-07-17): "In POS in the
-- 'Crop Pricing Menu' ... replace the word 'Archive' with 'Remove'. And add a confirmation button/screen
-- when removing it. Employee and operator they can click/tap the remove but it will send a notif
-- confirmation for admin and above (this is the default) ... with our new 2-in-1 'Set Permission' and
-- 'Override' system we can customize it."
--
-- CURRENT STATE: the whole "Crop Pricing Menu" dialog (add/edit-price/archive) is gated on product.manage
-- (admin/co_owner/owner by default). employee/operator have no access to it at all today.
--
-- DESIGN (new lesser permission key, tiered like P1M.2's owner-instant-revoke, not separation-of-duties
-- like P1M — the two tiers here are "can act instantly" vs "can only request", not "two peers checking
-- each other"):
--   product.remove — new, lesser key. Default: employee + operator. Lets a user open a scoped view of
--     the Crop Pricing Menu (price list + a "Remove" action only — no add, no edit price) and request a
--     product's removal. The request queues Pending; a product.manage holder must approve or reject it.
--   product.manage — unchanged, existing key (admin/co_owner/owner by default). Removing is instant: no
--     queue. For a single consistent audit trail (same reasoning as P1M.2), an instant removal still
--     writes an already-Approved row to the new request table (requested_by = decided_by = actor).
--
--   request_product_removal(product, reason) — product.manage OR product.remove required. product.manage
--     holder: archives immediately, writes an Approved row. product.remove-only holder: writes a Pending
--     row, does NOT archive. One Pending request per product at a time. Reason required (mirrors P1M's
--     "reason mandatory" convention — the approver needs to know why).
--   list_pending_product_removals() — product.manage-gated read for the POS panel.
--   approve_product_removal(req_id) — product.manage required; archives the product; approver != requester
--     defensively (structurally the requester never holds product.manage in the common flow, but this
--     guards the edge case the same way P1M's revoke workflow does).
--   reject_product_removal(req_id, reason) — product.manage required; no archive; approver != requester.
--
-- Authority: owner directive 2026-07-17, POS module (P2-M2A products table). Risk: Low-Medium (new write
-- surface gated by an existing table's existing product.manage RLS for the instant path; a brand-new
-- Pending-only path for the new lesser key). Guard battery required.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. New permission key (additive, idempotent)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.permissions (permission_key, description) values
  ('product.remove', 'Request a product be removed from the cashier grid — needs product.manage approval unless the holder also has product.manage')
on conflict (permission_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. seed_standard_roles(): evolve employee + operator to include product.remove, so NEW companies
--    bootstrapped after this migration get it too (not just a one-time backfill for existing ones).
--    Identical to the P1C3 version otherwise (same admin/co_owner/owner behavior, unchanged).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.seed_standard_roles(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_role uuid; v_owner_role uuid;
begin
  update public.roles set rank = 50 where company_id = p_company_id and role_key = 'owner' and rank <> 50;

  for r in
    select * from (values
      ('employee', 10, 'Enter individual sales only, check own pay and schedule',
        array['pos.sell','schedule.read','project.read','product.remove']),
      ('operator', 20, 'Data entry inputs, POS cashier, view schedules',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read','project.read','product.remove']),
      ('admin', 30, 'POS, financial statements, core ledgers, setup',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read',
              'pos.void','product.manage','crop.manage','equipment.manage','accounting.read','accounting.manage',
              'finance.account.read','finance.account.manage','customer.read','customer.manage',
              'project.read','project.manage','schedule.manage','schedule.read_private','user.read','membership.read','audit.read',
              'job_title.manage','membership.approve']),
      ('co_owner', 40, 'All access — edit everything except developer configurations',
        null)
    ) as t(role_key, rank, description, keys)
  loop
    insert into public.roles (company_id, role_key, description, rank)
      values (p_company_id, r.role_key, r.description, r.rank)
      on conflict (company_id, role_key) do update set rank = excluded.rank, description = excluded.description;
    select id into v_role from public.roles where company_id = p_company_id and role_key = r.role_key;
    insert into public.role_permissions (company_id, role_id, permission_id)
      select p_company_id, v_role, p.id
      from public.permissions p
      where p.status = 'Active' and (r.keys is null or p.permission_key = any (r.keys))
      on conflict (role_id, permission_id) do nothing;
  end loop;

  select id into v_owner_role from public.roles where company_id = p_company_id and role_key = 'owner';
  if v_owner_role is not null then
    insert into public.role_permissions (company_id, role_id, permission_id)
      select p_company_id, v_owner_role, p.id from public.permissions p where p.status = 'Active'
      on conflict (role_id, permission_id) do nothing;
  end if;
end; $$;
comment on function public.seed_standard_roles(uuid) is 'P1C §2.2, evolved through P1D/P1D.1/P1H/P1H.1/P1C3/P1O: idempotently seeds the 5-tier standard roles with their exact permission sets. Additive-only for INSERTs (never removes a mapping via this function). service_role/bootstrap path only.';
revoke all on function public.seed_standard_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_standard_roles(uuid) to service_role;

-- Backfill for EXISTING companies (seed_standard_roles is additive-only per-call, but existing
-- companies won't get product.remove until it's re-invoked for them — this INSERT does that directly).
insert into public.role_permissions (company_id, role_id, permission_id)
  select r.company_id, r.id, p.id
    from public.roles r, public.permissions p
   where r.role_key in ('employee', 'operator') and p.permission_key = 'product.remove'
on conflict (role_id, permission_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. product_removal_requests table
-- ════════════════════════════════════════════════════════════════════════════
create table public.product_removal_requests (
  id              uuid primary key default public.uuidv7(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  product_id      uuid not null references public.products (id) on delete restrict,
  requested_by    uuid not null references public.users (id) on delete restrict,
  reason          text not null,
  status          text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  decided_by      uuid references public.users (id) on delete restrict,
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.product_removal_requests is 'P1O: queued product-removal requests. A product.remove-only holder (employee/operator by default) may request; a product.manage holder approves/rejects, or removes instantly (writes an already-Approved row for a single consistent audit trail, mirroring P1M.2). One Pending row per product at a time. No row is ever deleted.';
create unique index product_removal_requests_one_pending_per_product
  on public.product_removal_requests (company_id, product_id) where status = 'Pending';
create index product_removal_requests_company_pending_idx
  on public.product_removal_requests (company_id, status, created_at);
create trigger product_removal_requests_set_updated_at before update on public.product_removal_requests
  for each row execute function public.set_updated_at();

alter table public.product_removal_requests enable row level security;
alter table public.product_removal_requests force row level security;
revoke all on public.product_removal_requests from public, anon, authenticated, service_role;
grant select on public.product_removal_requests to authenticated;
-- RLS: product.manage holders see every request in their company; a requester sees their own rows.
create policy product_removal_requests_read on public.product_removal_requests as permissive for select to authenticated
  using (
    public.has_permission(company_id, 'product.manage')
    or requested_by = public.current_app_user_id()
  );
-- Writes are function-only (SECURITY DEFINER RPCs below). No direct insert/update/delete grant.

-- ════════════════════════════════════════════════════════════════════════════
-- 4. request_product_removal(p_product_id, p_reason) — request or instantly execute a removal
-- ════════════════════════════════════════════════════════════════════════════
create function public.request_product_removal(p_product_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor    uuid;
  v_company  uuid;
  v_existing uuid;
  v_status   text;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select p.company_id, p.status into v_company, v_status
    from public.products p where p.id = p_product_id;
  if v_company is null then
    raise exception 'unknown product' using errcode = 'foreign_key_violation';
  end if;
  if v_status = 'Archived' then
    raise exception 'this product is already removed' using errcode = 'raise_exception';
  end if;
  if not (public.has_permission(v_company, 'product.manage') or public.has_permission(v_company, 'product.remove')) then
    raise exception 'permission denied: product.remove' using errcode = 'insufficient_privilege';
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required' using errcode = 'raise_exception';
  end if;
  if exists (
    select 1 from public.product_removal_requests
     where company_id = v_company and product_id = p_product_id and status = 'Pending'
  ) then
    raise exception 'a Pending removal request already exists for this product' using errcode = 'raise_exception';
  end if;

  if public.has_permission(v_company, 'product.manage') then
    update public.products set status = 'Archived' where id = p_product_id;
    insert into public.product_removal_requests (company_id, product_id, requested_by, reason, status, decided_by, decided_at)
      values (v_company, p_product_id, v_actor, trim(p_reason), 'Approved', v_actor, now())
      returning id into v_existing;
    insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
      values (v_company, v_actor, 'Business', 'product.removal_approved', 'pos', 'products', p_product_id);
    return v_existing;
  end if;

  insert into public.product_removal_requests (company_id, product_id, requested_by, reason, status)
    values (v_company, p_product_id, v_actor, trim(p_reason), 'Pending')
    returning id into v_existing;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Business', 'product.removal_requested', 'pos', 'product_removal_requests', v_existing);
  return v_existing;
end;
$$;
comment on function public.request_product_removal(uuid, text) is 'P1O: product.manage holder removes instantly (writes an already-Approved request row); product.remove-only holder queues a Pending request. One Pending per product, reason required. Returns the request id.';
revoke all on function public.request_product_removal(uuid, text) from public, anon;
grant execute on function public.request_product_removal(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. list_pending_product_removals() — product.manage-gated queue read
-- ════════════════════════════════════════════════════════════════════════════
create function public.list_pending_product_removals()
returns table (
  id uuid, product_id uuid, product_name text, requested_by uuid, requester_name text,
  reason text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'product.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: product.manage' using errcode = 'insufficient_privilege';
  end if;
  return query
    select prr.id, prr.product_id, pr.name as product_name,
           prr.requested_by, ru.display_name as requester_name,
           prr.reason, prr.created_at
      from public.product_removal_requests prr
      join public.products pr on pr.id = prr.product_id
      join public.users ru on ru.id = prr.requested_by
     where prr.company_id = v_company and prr.status = 'Pending'
     order by prr.created_at;
end;
$$;
comment on function public.list_pending_product_removals() is 'P1O: returns the Pending product-removal queue for the actor''s company. product.manage-gated.';
revoke all on function public.list_pending_product_removals() from public, anon;
grant execute on function public.list_pending_product_removals() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. approve_product_removal(p_request_id) — archive the product.
-- ════════════════════════════════════════════════════════════════════════════
create function public.approve_product_removal(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor        uuid;
  v_company      uuid;
  v_product      uuid;
  v_requested_by uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'product.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: product.manage' using errcode = 'insufficient_privilege';
  end if;
  select prr.company_id, prr.product_id, prr.requested_by
    into v_company, v_product, v_requested_by
    from public.product_removal_requests prr
   where prr.id = p_request_id and prr.status = 'Pending' and prr.company_id = v_company
   for update of prr;
  if not found then
    raise exception 'removal request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  if v_actor = v_requested_by then
    raise exception 'you cannot approve your own removal request — ask another product manager' using errcode = 'insufficient_privilege';
  end if;
  update public.products set status = 'Archived' where id = v_product;
  update public.product_removal_requests
    set status = 'Approved', decided_by = v_actor, decided_at = now()
    where id = p_request_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Business', 'product.removal_approved', 'pos', 'products', v_product);
end;
$$;
comment on function public.approve_product_removal(uuid) is 'P1O: approve a queued product removal. product.manage + approver != requester required. Archives the product, audited.';
revoke all on function public.approve_product_removal(uuid) from public, anon;
grant execute on function public.approve_product_removal(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. reject_product_removal(p_request_id, p_reason) — no archive.
-- ════════════════════════════════════════════════════════════════════════════
create function public.reject_product_removal(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor        uuid;
  v_company      uuid;
  v_requested_by uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'product.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: product.manage' using errcode = 'insufficient_privilege';
  end if;
  select prr.requested_by into v_requested_by
    from public.product_removal_requests prr
   where prr.id = p_request_id and prr.status = 'Pending' and prr.company_id = v_company
   for update of prr;
  if not found then
    raise exception 'removal request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  if v_actor = v_requested_by then
    raise exception 'you cannot reject your own removal request — ask another product manager' using errcode = 'insufficient_privilege';
  end if;
  update public.product_removal_requests
    set status = 'Rejected', decided_by = v_actor, decided_at = now(), decision_reason = trim(coalesce(p_reason, ''))
    where id = p_request_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Business', 'product.removal_rejected', 'pos', 'product_removal_requests', p_request_id);
end;
$$;
comment on function public.reject_product_removal(uuid, text) is 'P1O: reject a queued product removal. product.manage + approver != requester required. No archive; audited.';
revoke all on function public.reject_product_removal(uuid, text) from public, anon;
grant execute on function public.reject_product_removal(uuid, text) to authenticated;
