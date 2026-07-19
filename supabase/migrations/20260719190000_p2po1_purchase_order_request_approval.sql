-- Migration P2PO1 — Purchase-order request/approval workflow (owner backlog item: "Purchase-order
-- approval workflow — request→approve, distinct from the existing Buy Stock 'already happened'
-- purchase-receiving flow").
--
-- AUTHORITY: docs/20_Supabase_Master_Database_Schema/20.12_Purchase_Receiving_System.md describes
-- the full enterprise pipeline (Supplier -> Purchase Request -> Approval Workflow -> Purchase Order
-- -> Delivery -> Receiving Inspection -> Inventory Batch Creation -> Stock Movement Entry), with a
-- `purchase_orders` table carrying order_number/expected_delivery_date/subtotal-discount-tax-
-- shipping/multi-status (Draft/Submitted/Approved/Ordered/Partially Received/Completed/Cancelled)
-- and multi-line receiving-vs-ordered reconciliation. docs/28_Enterprise_Architecture_Audit/
-- Phase_2_M3_Inventory_Module_Spec.md (line 26/36) explicitly calls this "enterprise depth the mock
-- lacks" and lists "PO approval workflow" as an EXPLICITLY DEFERRED additive, noting
-- `purchase_receivings.purchase_order_id` is reserved nullable for it.
--
-- SCOPE DECISION: this migration builds the single-item request/approve/reject LAYER the owner
-- asked for (separation of duties before money is spent), NOT the full 20.12 multi-line/partial-
-- delivery/quality-inspection procurement system — that remains real future depth, not silently
-- dropped. It does NOT claim the reserved `purchase_receivings.purchase_order_id` column (that
-- column implies a future `purchase_orders` table matching 20.12's full field set); this migration
-- adds its own `purchase_order_request_id` column instead, so a later full-spec build is not boxed
-- in by this MVP's simpler shape.
--
-- DESIGN (mirrors P1O's product-removal-request idiom and P2N2's void-approval idiom):
--   purchase_order.request — new, lesser permission key. Default: employee only (operator/admin+
--     already hold inventory.purchase, the full buy authority, so the request-only tier only adds
--     real value for the one tier — employee — that has no purchase authority at all today).
--   purchase_order_requests table — one row per request; a request queues Pending, an
--     inventory.purchase holder Approves or Rejects it. Approving does NOT itself spend money or
--     touch the stock ledger — it only authorizes; the actual purchase still goes through the
--     existing, unchanged inventory_record_purchase() when goods are actually bought/received
--     (matches 20.12's own "Approval Workflow" step being separate from "Delivery -> Receiving").
--   request_purchase_order(...) — purchase_order.request OR inventory.purchase gated.
--   list_pending_purchase_order_requests() — inventory.purchase-gated approval-queue read.
--   list_approved_purchase_order_requests() — inventory.purchase-gated "ready to buy" read (Approved,
--     not yet Fulfilled) — the Buy Stock screen's source for what's already authorized.
--   list_my_purchase_order_requests() — self-view for the requester (own rows, any status).
--   approve_purchase_order_request(p_request_id, p_notes) — inventory.purchase + approver !=
--     requester (separation of duties, same defensive pattern as P1O/P2N2 even though a
--     structurally-redundant self-approval by an inventory.purchase holder costs nothing real —
--     they could just buy directly instead; consistency with the established codebase idiom wins).
--   reject_purchase_order_request(p_request_id, p_notes) — inventory.purchase + approver != requester,
--     notes (reason) required.
--   inventory_record_purchase(...) gains p_purchase_order_request_id uuid default null (15th arg,
--     appended last — the exact evolution pattern P2U1/T3.2 already proved: existing call sites are
--     completely unaffected). When supplied: the request must be this company's, status='Approved',
--     and its item_id must match the item this purchase resolves to (defends against fulfilling the
--     wrong item's PO) — then marks the request 'Fulfilled' and links fulfilled_receiving_id. Actual
--     received quantity/cost is NOT forced to equal the estimate (real purchasing varies from
--     estimate — matches 20.12's own "Quantity ordered" vs "Quantity received" distinction).
--
-- Authority: 20.12 (spec), Phase_2_M3_Inventory_Module_Spec.md line 36 (explicit deferred-additive
-- note), C7 §5 (inventory ledger integrity — this migration never lets a request itself move stock
-- or post a journal entry; only inventory_record_purchase does that, unchanged). Risk: Low — purely
-- additive table + RPCs, one new optional trailing arg on an existing governed function.
--
-- REAL BUG CAUGHT BY THE FULL GUARD BATTERY, NOT INVENTED: seed_standard_roles() is redefined via
-- `create or replace function` in every migration that touches it, and Postgres replaces the ENTIRE
-- body — copying an OLDER version (P1O's, 2026-07-17) as this migration's starting point silently
-- reverted every later evolution's role-key addition (P2M3B's admin += inventory.reports.read).
-- inventory-security.sql's own guard failed on a fresh reset ("admin lacks inventory.reports.read by
-- default") until this migration's admin array was corrected to build on P2M3B's version, the true
-- latest, not P1O's. Lesson for the next evolution of this function: always diff against the most
-- recent `create or replace function public.seed_standard_roles` in the migrations directory, never
-- an earlier one from memory.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. New permission key (additive, idempotent)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.permissions (permission_key, description) values
  ('purchase_order.request', 'Request a stock purchase for approval — needs an inventory.purchase holder to approve before it can be bought')
on conflict (permission_key) do nothing;

-- Backfill for EXISTING companies (seed_standard_roles below is additive-only per-call).
insert into public.role_permissions (company_id, role_id, permission_id)
  select r.company_id, r.id, p.id
    from public.roles r, public.permissions p
   where r.role_key = 'employee' and p.permission_key = 'purchase_order.request'
on conflict (role_id, permission_id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. seed_standard_roles(): evolve employee to include purchase_order.request for NEW companies.
--    Identical to the P1O version otherwise.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.seed_standard_roles(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_role uuid; v_owner_role uuid;
begin
  update public.roles set rank = 50 where company_id = p_company_id and role_key = 'owner' and rank <> 50;

  for r in
    select * from (values
      ('employee', 10, 'Enter individual sales only, check own pay and schedule',
        array['pos.sell','schedule.read','project.read','product.remove','purchase_order.request']),
      ('operator', 20, 'Data entry inputs, POS cashier, view schedules',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read','project.read','product.remove']),
      ('admin', 30, 'POS, financial statements, core ledgers, setup',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read',
              'pos.void','product.manage','crop.manage','equipment.manage','accounting.read','accounting.manage',
              'finance.account.read','finance.account.manage','customer.read','customer.manage',
              'project.read','project.manage','schedule.manage','schedule.read_private','user.read','membership.read','audit.read',
              'job_title.manage','membership.approve','inventory.reports.read']),
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
comment on function public.seed_standard_roles(uuid) is 'P1C §2.2, evolved through P1D/P1D.1/P1H/P1H.1/P1C3/P1O/P2M3B/P2PO1: idempotently seeds the 5-tier standard roles with their exact permission sets. Additive-only for INSERTs (never removes a mapping via this function). service_role/bootstrap path only.';
revoke all on function public.seed_standard_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_standard_roles(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. purchase_order_requests table
-- ════════════════════════════════════════════════════════════════════════════
create table public.purchase_order_requests (
  id                      uuid primary key default public.uuidv7(),
  company_id              uuid not null references public.companies (id) on delete restrict,
  branch_id               uuid not null,
  item_id                 uuid not null,
  quantity                numeric(12,3) not null check (quantity > 0),
  estimated_unit_cost     numeric(12,2) not null check (estimated_unit_cost >= 0),
  vendor_id               uuid references public.vendors (id) on delete restrict,
  requested_by            uuid not null references public.users (id) on delete restrict,
  notes                   text,
  status                  text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Fulfilled')),
  decided_by              uuid references public.users (id) on delete restrict,
  decided_at              timestamptz,
  decision_notes          text,
  fulfilled_receiving_id  uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict,
  foreign key (item_id, company_id) references public.inventory_items (id, company_id) on delete restrict,
  foreign key (fulfilled_receiving_id, company_id) references public.purchase_receivings (id, company_id) on delete restrict
);
comment on table public.purchase_order_requests is 'P2PO1: queued stock-purchase requests. A purchase_order.request-only holder (employee by default) or an inventory.purchase holder may request; an inventory.purchase holder approves/rejects. Approving only authorizes — the actual purchase still runs through inventory_record_purchase(), which marks this row Fulfilled and links fulfilled_receiving_id. No row is ever deleted.';
create index purchase_order_requests_company_status_idx
  on public.purchase_order_requests (company_id, status, created_at);
create index purchase_order_requests_requester_idx
  on public.purchase_order_requests (company_id, requested_by, created_at);
create trigger purchase_order_requests_set_updated_at before update on public.purchase_order_requests
  for each row execute function public.set_updated_at();

alter table public.purchase_order_requests enable row level security;
alter table public.purchase_order_requests force row level security;
revoke all on public.purchase_order_requests from public, anon, authenticated, service_role;
grant select on public.purchase_order_requests to authenticated;
-- RLS: inventory.purchase holders see every request in their company; a requester sees their own rows.
create policy purchase_order_requests_read on public.purchase_order_requests as permissive for select to authenticated
  using (
    public.has_permission(company_id, 'inventory.purchase')
    or requested_by = public.current_app_user_id()
  );
-- Writes are function-only (SECURITY DEFINER RPCs below). No direct insert/update/delete grant.

-- ════════════════════════════════════════════════════════════════════════════
-- 4. request_purchase_order(...) — queue a Pending request.
-- ════════════════════════════════════════════════════════════════════════════
create function public.request_purchase_order(
  p_branch_id            uuid,
  p_item_id              uuid,
  p_quantity             numeric,
  p_estimated_unit_cost  numeric,
  p_vendor_id            uuid default null,
  p_notes                text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_item_company uuid; v_vendor_company uuid; v_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select b.company_id into v_company from public.branches b where b.id = p_branch_id;
  if v_company is null then raise exception 'branch not found' using errcode = 'foreign_key_violation'; end if;
  if not (public.has_permission(v_company, 'purchase_order.request') or public.has_permission(v_company, 'inventory.purchase')) then
    raise exception 'permission denied: purchase_order.request' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(p_branch_id) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;
  select i.company_id into v_item_company from public.inventory_items i where i.id = p_item_id;
  if v_item_company is null or v_item_company <> v_company then
    raise exception 'inventory item not found in this company' using errcode = 'foreign_key_violation';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'quantity must be > 0' using errcode = 'check_violation'; end if;
  if p_estimated_unit_cost is null or p_estimated_unit_cost < 0 then raise exception 'estimated unit cost must be >= 0' using errcode = 'check_violation'; end if;
  if p_vendor_id is not null then
    select v.company_id into v_vendor_company from public.vendors v where v.id = p_vendor_id;
    if v_vendor_company is null or v_vendor_company <> v_company then
      raise exception 'vendor not found in this company' using errcode = 'foreign_key_violation';
    end if;
  end if;

  insert into public.purchase_order_requests (company_id, branch_id, item_id, quantity, estimated_unit_cost, vendor_id, requested_by, notes)
    values (v_company, p_branch_id, p_item_id, p_quantity, p_estimated_unit_cost, p_vendor_id, v_actor, nullif(trim(coalesce(p_notes, '')), ''))
    returning id into v_id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, p_branch_id, v_actor, 'Business', 'inventory.purchase_order_requested', 'inventory', 'purchase_order_requests', v_id,
            jsonb_build_object('item_id', p_item_id, 'quantity', p_quantity, 'estimated_unit_cost', p_estimated_unit_cost, 'vendor_id', p_vendor_id));
  return v_id;
end;
$$;
comment on function public.request_purchase_order(uuid, uuid, numeric, numeric, uuid, text) is 'P2PO1: queue a Pending purchase-order request. purchase_order.request OR inventory.purchase required. Returns the request id.';
revoke all on function public.request_purchase_order(uuid, uuid, numeric, numeric, uuid, text) from public, anon;
grant execute on function public.request_purchase_order(uuid, uuid, numeric, numeric, uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. list_pending_purchase_order_requests() — inventory.purchase-gated approval queue.
-- ════════════════════════════════════════════════════════════════════════════
create function public.list_pending_purchase_order_requests()
returns table (
  id uuid, branch_id uuid, branch_name text, item_id uuid, item_name text, quantity numeric,
  estimated_unit_cost numeric, vendor_id uuid, vendor_name text,
  requested_by uuid, requester_name text, notes text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'inventory.purchase')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: inventory.purchase' using errcode = 'insufficient_privilege';
  end if;
  return query
    select por.id, por.branch_id, br.name as branch_name, por.item_id, ii.name as item_name, por.quantity,
           por.estimated_unit_cost, por.vendor_id, v.name as vendor_name,
           por.requested_by, ru.display_name as requester_name, por.notes, por.created_at
      from public.purchase_order_requests por
      join public.branches br on br.id = por.branch_id
      join public.inventory_items ii on ii.id = por.item_id
      join public.users ru on ru.id = por.requested_by
      left join public.vendors v on v.id = por.vendor_id
     where por.company_id = v_company and por.status = 'Pending'
     order by por.created_at;
end;
$$;
comment on function public.list_pending_purchase_order_requests() is 'P2PO1: returns the Pending purchase-order-request queue for the actor''s company. inventory.purchase-gated.';
revoke all on function public.list_pending_purchase_order_requests() from public, anon;
grant execute on function public.list_pending_purchase_order_requests() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5b. list_approved_purchase_order_requests() — "ready to buy" queue, same shape/gate as the Pending
--     one above. Requests move Pending -> Approved -> Fulfilled; the approval queue only ever shows
--     Pending (by design, so a decided row disappears from "needs a decision" immediately), so the
--     Buy Stock screen needs its own read of what's authorized-but-not-yet-purchased.
-- ════════════════════════════════════════════════════════════════════════════
create function public.list_approved_purchase_order_requests()
returns table (
  id uuid, branch_id uuid, branch_name text, item_id uuid, item_name text, quantity numeric,
  estimated_unit_cost numeric, vendor_id uuid, vendor_name text,
  requested_by uuid, requester_name text, notes text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'inventory.purchase')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: inventory.purchase' using errcode = 'insufficient_privilege';
  end if;
  return query
    select por.id, por.branch_id, br.name as branch_name, por.item_id, ii.name as item_name, por.quantity,
           por.estimated_unit_cost, por.vendor_id, v.name as vendor_name,
           por.requested_by, ru.display_name as requester_name, por.notes, por.created_at
      from public.purchase_order_requests por
      join public.branches br on br.id = por.branch_id
      join public.inventory_items ii on ii.id = por.item_id
      join public.users ru on ru.id = por.requested_by
      left join public.vendors v on v.id = por.vendor_id
     where por.company_id = v_company and por.status = 'Approved'
     order by por.decided_at;
end;
$$;
comment on function public.list_approved_purchase_order_requests() is 'P2PO1: returns Approved-but-not-yet-Fulfilled purchase-order requests for the actor''s company — the "ready to buy" queue. inventory.purchase-gated.';
revoke all on function public.list_approved_purchase_order_requests() from public, anon;
grant execute on function public.list_approved_purchase_order_requests() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. list_my_purchase_order_requests() — self-view for the requester, any status.
-- ════════════════════════════════════════════════════════════════════════════
create function public.list_my_purchase_order_requests(p_company uuid)
returns table (
  id uuid, branch_id uuid, branch_name text, item_id uuid, item_name text, quantity numeric,
  estimated_unit_cost numeric, vendor_id uuid, vendor_name text, status text,
  decided_by uuid, decider_name text, decision_notes text, notes text, created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not exists (
    select 1 from public.user_branch_roles ubr
     where ubr.user_id = v_actor and ubr.company_id = p_company and ubr.assignment_status = 'Active'
  ) then
    raise exception 'not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  return query
    select por.id, por.branch_id, br.name as branch_name, por.item_id, ii.name as item_name, por.quantity,
           por.estimated_unit_cost, por.vendor_id, v.name as vendor_name, por.status,
           por.decided_by, du.display_name as decider_name, por.decision_notes, por.notes, por.created_at
      from public.purchase_order_requests por
      join public.branches br on br.id = por.branch_id
      join public.inventory_items ii on ii.id = por.item_id
      left join public.vendors v on v.id = por.vendor_id
      left join public.users du on du.id = por.decided_by
     where por.company_id = p_company and por.requested_by = v_actor
     order by por.created_at desc;
end;
$$;
comment on function public.list_my_purchase_order_requests(uuid) is 'P2PO1: self-view of the caller''s own purchase-order requests (any status). Company-membership-gated only, no special permission needed — a requester always sees their own filed requests.';
revoke all on function public.list_my_purchase_order_requests(uuid) from public, anon;
grant execute on function public.list_my_purchase_order_requests(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. approve_purchase_order_request(p_request_id, p_notes) — authorize only, no stock/GL movement.
-- ════════════════════════════════════════════════════════════════════════════
create function public.approve_purchase_order_request(p_request_id uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_requested_by uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'inventory.purchase')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: inventory.purchase' using errcode = 'insufficient_privilege';
  end if;
  select por.requested_by into v_requested_by
    from public.purchase_order_requests por
   where por.id = p_request_id and por.status = 'Pending' and por.company_id = v_company
   for update of por;
  if not found then
    raise exception 'purchase request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  if v_actor = v_requested_by then
    raise exception 'you cannot approve your own purchase request — ask another purchaser' using errcode = 'insufficient_privilege';
  end if;
  update public.purchase_order_requests
    set status = 'Approved', decided_by = v_actor, decided_at = now(), decision_notes = nullif(trim(coalesce(p_notes, '')), '')
    where id = p_request_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Business', 'inventory.purchase_order_approved', 'inventory', 'purchase_order_requests', p_request_id);
end;
$$;
comment on function public.approve_purchase_order_request(uuid, text) is 'P2PO1: approve a queued purchase-order request. inventory.purchase + approver != requester required. Authorizes only — does not create a purchase_receivings row or touch the ledger; the request is later marked Fulfilled by inventory_record_purchase() when the goods are actually bought.';
revoke all on function public.approve_purchase_order_request(uuid, text) from public, anon;
grant execute on function public.approve_purchase_order_request(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. reject_purchase_order_request(p_request_id, p_notes) — reason required, no side effects.
-- ════════════════════════════════════════════════════════════════════════════
create function public.reject_purchase_order_request(p_request_id uuid, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_company uuid; v_requested_by uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'inventory.purchase')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: inventory.purchase' using errcode = 'insufficient_privilege';
  end if;
  if trim(coalesce(p_notes, '')) = '' then
    raise exception 'a reason is required' using errcode = 'raise_exception';
  end if;
  select por.requested_by into v_requested_by
    from public.purchase_order_requests por
   where por.id = p_request_id and por.status = 'Pending' and por.company_id = v_company
   for update of por;
  if not found then
    raise exception 'purchase request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  if v_actor = v_requested_by then
    raise exception 'you cannot reject your own purchase request — ask another purchaser' using errcode = 'insufficient_privilege';
  end if;
  update public.purchase_order_requests
    set status = 'Rejected', decided_by = v_actor, decided_at = now(), decision_notes = trim(p_notes)
    where id = p_request_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Business', 'inventory.purchase_order_rejected', 'inventory', 'purchase_order_requests', p_request_id);
end;
$$;
comment on function public.reject_purchase_order_request(uuid, text) is 'P2PO1: reject a queued purchase-order request. inventory.purchase + approver != requester + reason required. No side effects beyond the audit trail.';
revoke all on function public.reject_purchase_order_request(uuid, text) from public, anon;
grant execute on function public.reject_purchase_order_request(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. inventory_record_purchase(...): append p_purchase_order_request_id (15th arg, default null).
--    Fulfillment link only — first 14 args and all existing behavior are completely unchanged.
--    Argument COUNT is changing, so (matching every prior evolution of this function: T3.2,
--    P2M3B.1, P2U1) the old 14-arg overload must be dropped first — `create or replace` only
--    replaces a function with an IDENTICAL argument list; a different arg count silently creates a
--    second overload instead, which is ambiguous at call time (confirmed live: this guard's own
--    fulfillment call failed with "is not unique" until this drop was added).
-- ════════════════════════════════════════════════════════════════════════════
drop function if exists public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text);
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
  p_purchase_order_request_id    uuid default null
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

  if p_purchase_order_request_id is not null then
    update public.purchase_order_requests
      set status = 'Fulfilled', fulfilled_receiving_id = v_recv
      where id = p_purchase_order_request_id;
  end if;

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, p_branch_id, v_actor, 'Business', 'inventory.purchase_received', 'inventory', 'purchase_receivings', v_recv,
            jsonb_build_object('source_type', p_source_type, 'vendor_id', p_vendor_id, 'item', trim(p_item_name), 'quantity', p_quantity, 'total_cost', p_total_cost, 'bought_by', p_bought_by, 'purchase_order_request_id', p_purchase_order_request_id));
  return v_recv;
end; $$;
comment on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid) is 'P2-M3A + T3.2 + P2M3B.1 + P2U1 + P2PO1 (2026-07-19): record a stock purchase receiving. New optional p_purchase_order_request_id arg (default null, 15th): when supplied, the referenced Approved request must belong to this company and resolve to the same item — marks it Fulfilled and links fulfilled_receiving_id. Does not force received qty/cost to match the estimate. First 14 args unchanged, so all existing call sites still resolve identically.';
revoke all on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid) from public, anon;
grant execute on function public.inventory_record_purchase(uuid, text, text, boolean, numeric, numeric, text, text, text, date, text, uuid, text, text, uuid) to authenticated;
