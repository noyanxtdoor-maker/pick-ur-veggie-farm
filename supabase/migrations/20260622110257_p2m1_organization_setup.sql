-- Migration P2-M1 — Organization Setup (Phase 2, Module 1)
-- Authority: Phase_2_Transition_Context.md (DB authorization+data layer for Organization Setup; UI deferred to a
--   separate V3 app-architecture decision) · inherits B1 (RLS), C7 §0 (permission-based authz — never role names),
--   M3 (composite-FK tenant integrity), M4 (resolver: has_permission/current_app_user_id), M5 (audit), M6 (catalog).
-- Scope: the FIRST authenticated-driven WRITE model. Phase 1 had no authenticated writes (all writes service_role).
--   This adds owner/manager mutations — company edit, branch + role management, invitations, membership management —
--   each gated by a permission via the M4 resolver. M1–M6 migration files are NOT modified (additive only).
-- NOT in scope: crops/inventory/tasks/reports/finance; any UI/API; `is_branch_member()` (deferred to the first
--   branch-OWNED business table — no consumer here, B3/YAGNI).
-- Risk: High (authorization extension). Rollback: structural while unused.

-- ── Permission catalog additions (additive, idempotent; M6 catalog grows per module) ──
-- The Owner created by the M6 bootstrap receives ALL active catalog permissions, so an owner bootstrapped after
-- this migration automatically holds these. They gate the new authenticated writes below.
insert into public.permissions (permission_key, description) values
  ('company.manage',    'Edit company details within the company'),
  ('branch.manage',     'Create and manage branches within the company'),
  ('role.manage',       'Create and manage roles and their permissions within the company'),
  ('user.invite',       'Invite users to the company'),
  ('membership.manage', 'Assign, suspend, and expire memberships within the company')
on conflict (permission_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- Authenticated WRITE policies — resolver-gated (the first member-driven mutations).
-- Pattern: column-scoped grant (immutable identifiers stay immutable) + RLS policy calling has_permission().
-- M3 composite FKs still force branch/role to belong to the row's company → no cross-tenant writes possible.
-- ════════════════════════════════════════════════════════════════════════════

-- companies: a company.manage holder may edit the NAME only. company_code/base_currency_code/id remain immutable
-- (no grant). Company STATUS stays service_role-only (M2): archiving a company locks out all members incl. the
-- owner — a platform action, not owner self-service.
grant update (name) on public.companies to authenticated;
create policy companies_update_manage on public.companies for update to authenticated
  using (public.has_permission(id, 'company.manage'))
  with check (public.has_permission(id, 'company.manage'));

-- branches: branch.manage may create branches and edit name/status (suspend/archive). branch_code/company_id/id
-- immutable. The INSERT WITH CHECK + the M3 composite-FK target make cross-company branch creation impossible.
grant insert (company_id, branch_code, name) on public.branches to authenticated;
grant update (name, status) on public.branches to authenticated;
create policy branches_insert_manage on public.branches for insert to authenticated
  with check (public.has_permission(company_id, 'branch.manage'));
create policy branches_update_manage on public.branches for update to authenticated
  using (public.has_permission(company_id, 'branch.manage'))
  with check (public.has_permission(company_id, 'branch.manage'));

-- roles: role.manage may create roles and edit description/status (deprecate). role_key/company_id/id immutable.
grant insert (company_id, role_key, description) on public.roles to authenticated;
grant update (description, status) on public.roles to authenticated;
create policy roles_insert_manage on public.roles for insert to authenticated
  with check (public.has_permission(company_id, 'role.manage'));
create policy roles_update_manage on public.roles for update to authenticated
  using (public.has_permission(company_id, 'role.manage'))
  with check (public.has_permission(company_id, 'role.manage'));

-- role_permissions: role.manage may ADD permissions to a role (the mapping is immutable per M3 — no UPDATE/DELETE;
-- to remove, deprecate the role and create a new one — M3 revocation-lifecycle carryover). Composite FK forces the
-- role to belong to company_id; the permission catalog is global.
grant insert (company_id, role_id, permission_id) on public.role_permissions to authenticated;
create policy role_permissions_insert_manage on public.role_permissions for insert to authenticated
  with check (public.has_permission(company_id, 'role.manage'));

-- user_branch_roles: membership.manage may assign a role (INSERT) and suspend/expire (UPDATE
-- assignment_status/expires_at). The subject/scope (user/company/branch/role) is immutable. M3 composite FKs force
-- branch & role into company_id → no cross-company assignment; M4 resolver reflects the change on the next request.
grant insert (user_id, company_id, branch_id, role_id) on public.user_branch_roles to authenticated;
grant update (assignment_status, expires_at) on public.user_branch_roles to authenticated;
create policy user_branch_roles_insert_manage on public.user_branch_roles for insert to authenticated
  with check (public.has_permission(company_id, 'membership.manage'));
create policy user_branch_roles_update_manage on public.user_branch_roles for update to authenticated
  using (public.has_permission(company_id, 'membership.manage'))
  with check (public.has_permission(company_id, 'membership.manage'));

-- ── invitations — company/branch/role-scoped, single-use, expiring capability tokens ──
-- The token IS the capability (no email infrastructure in scope — the token is delivered out of band). Composite
-- FKs force branch & role to belong to company_id → an invite can never target another company's branch/role.
create table public.invitations (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  branch_id        uuid not null,
  role_id          uuid not null,
  email            text,                                                  -- informational (delivery is out of scope)
  token            text not null unique default (gen_random_uuid()::text),-- the capability; the function sets it explicitly
  status           text not null default 'Pending' check (status in ('Pending', 'Accepted', 'Revoked', 'Expired')),
  invited_by       uuid not null references public.users (id) on delete restrict,
  accepted_user_id uuid references public.users (id) on delete restrict,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict,
  foreign key (role_id, company_id)   references public.roles    (id, company_id) on delete restrict
);
comment on table public.invitations is 'User invitations (Phase 2 M1). Single-use, expiring, company/branch/role-scoped capability tokens; written only via invite_user()/accept_invitation(). Composite FKs force same-company branch/role.';
create index invitations_company_status_idx on public.invitations (company_id, status);
create trigger invitations_set_updated_at before update on public.invitations
  for each row execute function public.set_updated_at();

alter table public.invitations enable row level security;
alter table public.invitations force row level security;
revoke all on public.invitations from public, anon, authenticated, service_role;
-- Reads: a user.invite holder sees their company's invitations (management view). Writes go only through the
-- governed SECURITY DEFINER functions below (the invitee never needs to SELECT — they accept by token).
grant select on public.invitations to authenticated;
create policy invitations_select_manage on public.invitations for select to authenticated
  using (public.has_permission(company_id, 'user.invite'));
grant select, insert, update on public.invitations to service_role;

-- ── invite_user — create an invitation (gated by user.invite; audited) ────────
create function public.invite_user(
  p_company_id uuid, p_branch_id uuid, p_role_id uuid, p_email text, p_valid_days int default 7
) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_inviter uuid; v_token text;
begin
  v_inviter := public.current_app_user_id();
  if v_inviter is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company_id, 'user.invite') then
    raise exception 'permission denied: user.invite in this company' using errcode = 'insufficient_privilege';
  end if;
  v_token := gen_random_uuid()::text || gen_random_uuid()::text;   -- 244 bits, unguessable
  -- Composite FKs reject a branch/role that is not in p_company_id (cross-company invite impossible).
  insert into public.invitations (company_id, branch_id, role_id, email, token, invited_by, expires_at)
    values (p_company_id, p_branch_id, p_role_id, p_email, v_token, v_inviter, now() + make_interval(days => p_valid_days));
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type)
    values (p_company_id, p_branch_id, v_inviter, 'Administrative', 'user.invited', 'organization', 'invitation');
  return v_token;
end;
$$;
comment on function public.invite_user(uuid, uuid, uuid, text, int) is 'Phase 2 M1: create a single-use invitation (gated by user.invite; cross-company blocked by composite FK; audited). Returns the capability token.';
revoke all on function public.invite_user(uuid, uuid, uuid, text, int) from public;
grant execute on function public.invite_user(uuid, uuid, uuid, text, int) to authenticated;

-- ── accept_invitation — the invitee redeems a token (single-use, expiring; audited) ──
-- The accepting auth identity (auth.uid()) is linked to an ERP user and granted exactly the invitation's
-- (company, branch, role). The token is the authorization; the scope is fixed by the inviter → no escalation.
create function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_inv public.invitations; v_auth uuid; v_user uuid; v_membership uuid;
begin
  v_auth := (select auth.uid());
  if v_auth is null then raise exception 'not authenticated' using errcode = 'insufficient_privilege'; end if;
  select * into v_inv from public.invitations where token = p_token for update;
  if not found then raise exception 'invalid invitation token' using errcode = 'raise_exception'; end if;
  if v_inv.status <> 'Pending' then
    raise exception 'invitation is not pending (status=%)', v_inv.status using errcode = 'raise_exception';
  end if;
  if v_inv.expires_at <= now() then
    update public.invitations set status = 'Expired', updated_at = now() where id = v_inv.id;
    raise exception 'invitation has expired' using errcode = 'raise_exception';
  end if;
  -- Link/provision the invitee's ERP identity (supports multi-company membership).
  insert into public.users (auth_user_id, display_name) values (v_auth, coalesce(v_inv.email, 'Member'))
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id = v_auth;
  -- Membership at the invitation's exact scope (M3 composite FKs already proven by the invitation's own FKs).
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, v_inv.company_id, v_inv.branch_id, v_inv.role_id)
    on conflict (user_id, company_id, branch_id, role_id) do nothing
    returning id into v_membership;
  update public.invitations set status = 'Accepted', accepted_user_id = v_user, updated_at = now() where id = v_inv.id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_inv.company_id, v_inv.branch_id, v_user, 'Administrative', 'invitation.accepted', 'organization', 'user_branch_roles', v_membership);
  return v_membership;
end;
$$;
comment on function public.accept_invitation(text) is 'Phase 2 M1: redeem an invitation token (single-use via status + row lock; expiry enforced). Links the accepting auth identity to an ERP user and grants exactly the invitation scope (no escalation). Audited.';
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
