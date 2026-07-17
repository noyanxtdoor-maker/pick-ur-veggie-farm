-- Migration P1M — Revoke-account approval workflow (ported from Team B / Repo B c014423 — labeled
-- "P1J" on their chain, but P1J already means username-login on ours, so this lands as P1M here;
-- owner parity order 2026-07-17). Owner directive: "when revoking always needs permission from
-- owner/co-owner, add a box notif for this like 'Pending Account Approvals' only appear when
-- there's a pending revoke."
--
-- CURRENT STATE: the Revoke button in ApprovalsScreen calls membershipsApi.update(m,
-- {assignment_status:'Expired'}) behind membership.manage. Per the P1C role seed
-- (20260712130000 §2.2), membership.manage is co_owner+/owner ONLY (admin tier does NOT hold it —
-- see approvals-roles-security.sql §2.5 note). So a single co_owner can unilaterally revoke today.
--
-- OWNER INTENT: revoke should NEVER be a one-click unilateral action even at the top tier — it must
-- go through a queue + require a SEPARATE owner/co_owner to approve (separation of duties). The
-- "Pending Revoke Approvals" box appears in the Approvals screen when a request is queued,
-- mirroring the existing "Pending Account Approvals" self-signup queue (P1A pattern).
--
-- DESIGN (no new permission key — membership.manage already = co_owner+/owner tier):
--   request_revoke(target, reason) — any membership.manage holder can QUEUE one. One Pending per
--     target; cannot self-revoke; target must hold an active membership in the actor's company.
--   approve_revoke_request(req_id) — membership.manage required AND approver != requester
--     (separation of duties) AND actor outranks every active role the target holds (all-or-nothing,
--     same as P1G archive). Executes the revoke: every target membership -> Expired, audited.
--   reject_revoke_request(req_id, reason) — membership.manage + approver != requester.
--   list_revoke_requests() — membership.manage-gated read for the Approvals panel.
--
-- Authority: B7 §6 account lifecycle · M1 "never hard-delete" invariant · CLAUDE.md §6 auth tripwire.
-- Risk: Medium (new write surface on the auth/membership boundary). Guard battery required.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. revoke_requests table
-- ════════════════════════════════════════════════════════════════════════════
create table public.revoke_requests (
  id              uuid primary key default public.uuidv7(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  target_user_id  uuid not null references public.users (id) on delete restrict,
  requested_by    uuid not null references public.users (id) on delete restrict,
  reason          text not null,
  status          text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  decided_by      uuid references public.users (id) on delete restrict,
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (target_user_id <> requested_by)  -- cannot self-revoke
);
comment on table public.revoke_requests is 'P1M (ported from Repo B, 2026-07-17): queued account-revoke requests. Any membership.manage holder (co_owner/owner) may request; approve/reject requires a DIFFERENT membership.manage holder (separation of duties + outranks-target). Approve executes the revoke (memberships -> Expired, audited). One Pending row per target at a time (unique partial index). No row is ever deleted.';
create unique index revoke_requests_one_pending_per_target
  on public.revoke_requests (company_id, target_user_id) where status = 'Pending';
create index revoke_requests_company_pending_idx
  on public.revoke_requests (company_id, status, created_at);
create trigger revoke_requests_set_updated_at before update on public.revoke_requests
  for each row execute function public.set_updated_at();

alter table public.revoke_requests enable row level security;
alter table public.revoke_requests force row level security;
revoke all on public.revoke_requests from public, anon, authenticated, service_role;
grant select on public.revoke_requests to authenticated;
-- RLS: membership.manage holders see requests in their company; a target sees their own request row.
create policy revoke_requests_read on public.revoke_requests as permissive for select to authenticated
  using (
    public.has_permission(company_id, 'membership.manage')
    or target_user_id = public.current_app_user_id()
    or requested_by = public.current_app_user_id()
  );
-- Writes are function-only (SECURITY DEFINER RPCs below). No direct insert/update/delete grant.

-- ════════════════════════════════════════════════════════════════════════════
-- 2. request_revoke(p_target_user_id, p_reason) — queue a revoke request
-- ════════════════════════════════════════════════════════════════════════════
create function public.request_revoke(p_target_user_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor   uuid;
  v_company uuid;
  v_existing uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if v_actor = p_target_user_id then
    raise exception 'you cannot request your own revoke' using errcode = 'insufficient_privilege';
  end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'membership.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.user_branch_roles ubr
     where ubr.user_id = p_target_user_id and ubr.company_id = v_company and ubr.assignment_status = 'Active'
  ) then
    raise exception 'target has no active membership in your company to revoke' using errcode = 'raise_exception';
  end if;
  select id into v_existing from public.revoke_requests
   where company_id = v_company and target_user_id = p_target_user_id and status = 'Pending';
  if v_existing is not null then
    raise exception 'a Pending revoke request already exists for this account' using errcode = 'raise_exception';
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required' using errcode = 'raise_exception';
  end if;
  insert into public.revoke_requests (company_id, target_user_id, requested_by, reason, status)
    values (v_company, p_target_user_id, v_actor, trim(p_reason), 'Pending')
    returning id into v_existing;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Administrative', 'revoke.requested', 'organization', 'revoke_requests', v_existing);
  return v_existing;
end;
$$;
comment on function public.request_revoke(uuid, text) is 'P1M (ported from Repo B): queue an account-revoke request. membership.manage required (co_owner/owner), same-company, cannot self-revoke, one Pending per target, reason required. Returns the new request id.';
revoke all on function public.request_revoke(uuid, text) from public;
grant execute on function public.request_revoke(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. list_revoke_requests() — pending queue (membership.manage-gated; Approvals panel reads this)
-- ════════════════════════════════════════════════════════════════════════════
create function public.list_revoke_requests()
returns table (
  id uuid, target_user_id uuid, target_name text, requested_by uuid, requester_name text,
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
     and public.has_permission(ubr.company_id, 'membership.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  return query
    select rr.id, rr.target_user_id, tu.display_name as target_name,
           rr.requested_by, ru.display_name as requester_name,
           rr.reason, rr.created_at
      from public.revoke_requests rr
      join public.users tu on tu.id = rr.target_user_id
      join public.users ru on ru.id = rr.requested_by
     where rr.company_id = v_company and rr.status = 'Pending'
     order by rr.created_at;
end;
$$;
comment on function public.list_revoke_requests() is 'P1M (ported from Repo B): returns the Pending revoke-request queue for the actor''s company. membership.manage-gated.';
revoke all on function public.list_revoke_requests() from public;
grant execute on function public.list_revoke_requests() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. approve_revoke_request(p_request_id) — execute the revoke.
--    membership.manage + approver != requester + actor outranks every active role of the target.
-- ════════════════════════════════════════════════════════════════════════════
create function public.approve_revoke_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor   uuid;
  v_company uuid;
  v_requested_by uuid;
  v_target  uuid;
  v_row     record;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'membership.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  select rr.company_id, rr.target_user_id, rr.requested_by
    into v_company, v_target, v_requested_by
    from public.revoke_requests rr
   where rr.id = p_request_id and rr.status = 'Pending' and rr.company_id = v_company
   for update of rr;
  if not found then
    raise exception 'revoke request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  if v_actor = v_requested_by then
    raise exception 'you cannot approve your own revoke request — ask another owner/co_owner' using errcode = 'insufficient_privilege';
  end if;
  for v_row in select role_id from public.user_branch_roles
                 where user_id = v_target and assignment_status = 'Active' loop
    if not public.outranks_role(v_company, v_row.role_id) then
      raise exception 'you do not outrank one of this account''s active roles — ask the owner' using errcode = 'insufficient_privilege';
    end if;
  end loop;
  update public.user_branch_roles set assignment_status = 'Expired'
    where user_id = v_target and assignment_status = 'Active';
  update public.revoke_requests
    set status = 'Approved', decided_by = v_actor, decided_at = now()
    where id = p_request_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Administrative', 'revoke.approved', 'organization', 'users', v_target);
end;
$$;
comment on function public.approve_revoke_request(uuid) is 'P1M (ported from Repo B): approve a queued revoke. membership.manage + approver != requester + outranks-target required. Executes the revoke: every active membership of the target -> Expired, audited. All-or-nothing.';
revoke all on function public.approve_revoke_request(uuid) from public;
grant execute on function public.approve_revoke_request(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. reject_revoke_request(p_request_id, p_reason) — no revoke executes.
--    membership.manage + approver != requester.
-- ════════════════════════════════════════════════════════════════════════════
create function public.reject_revoke_request(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor   uuid;
  v_company uuid;
  v_requested_by uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'membership.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  select rr.requested_by into v_requested_by
    from public.revoke_requests rr
   where rr.id = p_request_id and rr.status = 'Pending' and rr.company_id = v_company
   for update of rr;
  if not found then
    raise exception 'revoke request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  if v_actor = v_requested_by then
    raise exception 'you cannot reject your own revoke request — ask another owner/co_owner' using errcode = 'insufficient_privilege';
  end if;
  update public.revoke_requests
    set status = 'Rejected', decided_by = v_actor, decided_at = now(), decision_reason = trim(coalesce(p_reason, ''))
    where id = p_request_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Administrative', 'revoke.rejected', 'organization', 'revoke_requests', p_request_id);
end;
$$;
comment on function public.reject_revoke_request(uuid, text) is 'P1M (ported from Repo B): reject a queued revoke. membership.manage + approver != requester required. No revoke executes; the request is marked Rejected + audited.';
revoke all on function public.reject_revoke_request(uuid, text) from public;
grant execute on function public.reject_revoke_request(uuid, text) to authenticated;
