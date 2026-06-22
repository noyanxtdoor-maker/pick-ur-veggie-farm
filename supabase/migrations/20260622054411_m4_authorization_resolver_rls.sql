-- Migration M4 — Central Authorization Resolver + Tenant RLS (Stage D Phase 1)
-- Authority: Migration Design M4 · ADS §2 (security chain) / §4 (invariants) / §6 (single authz source) ·
--   B1 §2–§3/§9 (isolation model, derivation helpers, deny-by-default, account_status=Active) · C7 §0
--   (permissions determine authority — never role-name strings) · C5 §3 (cross-tenant negative tests, blocking) ·
--   B3 (index-served RLS predicates) · C3 (migration governance; expand→migrate→contract).
-- Scope (locked): the authorization resolver + member-scoped RLS ONLY. NO audit (M5), NO bootstrap/seed rows (M6),
--   NO business modules. M1/M2/M3 migration files are NOT modified; this migration evolves their interim RLS
--   (expand→migrate→contract, C3 §7): interim deny-all/own-row → resolver-based policies.
-- Risk: High (RLS / authorization). Rollback: structurally reversible, but security is NEVER weakened.
--
-- THE single authorization source = the three SECURITY DEFINER resolver functions below. Every policy CALLS the
-- resolver; no policy re-derives access or inspects a role name. The resolver runs as owner (RLS-exempt) so it can
-- read the membership/permission tables, but it answers only for the CALLER (auth.uid() is the caller's JWT, not
-- changed by SECURITY DEFINER). search_path is pinned empty + every object fully-qualified (definer hardening).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Resolver functions (the single authorization source — ADS §6)
-- ════════════════════════════════════════════════════════════════════════════

-- The active ERP user for the current JWT, or NULL. account_status=Active is enforced HERE (B1 §3): a Suspended
-- user resolves to NULL → every downstream check fails → zero access (incl. own row).
create function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where u.auth_user_id = (select auth.uid())
    and u.account_status = 'Active'
$$;
comment on function public.current_app_user_id() is 'Resolver: active ERP user id for the current auth.uid(), or NULL if no Active user (B1 §3). SECURITY DEFINER, search_path pinned.';

-- Tenant-visibility resolver: the set of company_ids the caller may access (active, non-expired membership in an
-- Active company). Evaluated once per statement via `company_id IN (select ...)` → index-served, no per-row re-derive.
create function public.accessible_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ubr.company_id
  from public.user_branch_roles ubr
  join public.companies c on c.id = ubr.company_id
  where ubr.user_id = public.current_app_user_id()
    and ubr.assignment_status = 'Active'
    and (ubr.expires_at is null or ubr.expires_at > now())
    and c.status = 'Active'
$$;
comment on function public.accessible_company_ids() is 'Resolver: company_ids the caller may access (Active membership, non-expired, Active company). Tenant-isolation boundary (B1 §2).';

-- Permission resolver: does the caller hold permission_key in company_id? Decision is PERMISSION-BASED — it joins
-- role → role_permissions → permissions and matches permission_key; it NEVER reads role_key / a role name (C7 §0,
-- ADS §4). Enforces Active company/role/permission and non-expired membership. A role with no role_permissions
-- (e.g. "SuperAdmin" label) therefore grants ZERO authorization.
create function public.has_permission(p_company_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_branch_roles ubr
    join public.companies c        on c.id = ubr.company_id
    join public.roles r            on r.id = ubr.role_id and r.company_id = ubr.company_id
    join public.role_permissions rp on rp.role_id = r.id and rp.company_id = ubr.company_id
    join public.permissions p      on p.id = rp.permission_id
    where ubr.user_id = public.current_app_user_id()
      and ubr.company_id = p_company_id
      and ubr.assignment_status = 'Active'
      and (ubr.expires_at is null or ubr.expires_at > now())
      and c.status = 'Active'
      and r.status = 'Active'
      and p.status = 'Active'
      and p.permission_key = p_permission_key
  )
$$;
comment on function public.has_permission(uuid, text) is 'Resolver: does the caller hold permission_key in p_company_id? Permission-based (never role-name); enforces Active company/role/permission + non-expired membership (ADS §4/§6, C7 §0).';

-- Resolver is callable only by authenticated (deny-by-default). Functions reveal only the caller's own access.
revoke all on function public.current_app_user_id() from public;
revoke all on function public.accessible_company_ids() from public;
revoke all on function public.has_permission(uuid, text) from public;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.accessible_company_ids() to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. RLS evolution — interim deny-all/own-row → resolver-based (expand→migrate→contract)
--    Phase 1 has no business writes: authenticated gets member-scoped SELECT only; all writes remain on the
--    governed service_role path (bootstrap/admin). No interim deny-all/USING(true) path survives.
-- ════════════════════════════════════════════════════════════════════════════

-- users (personal + company-admin). Contract M1's interim own-row (which lacked the account_status check) and
-- re-express via the resolver. Self read/update require Active (B1 §3); company-admin read requires 'user.read'
-- in a company the target user belongs to. The M1 column-scoped UPDATE(display_name) grant is unchanged.
drop policy users_select_own on public.users;
drop policy users_update_own on public.users;

create policy users_select_self on public.users
  for select to authenticated
  using (auth_user_id = (select auth.uid()) and account_status = 'Active');

create policy users_select_company_admin on public.users
  for select to authenticated
  using (exists (
    select 1 from public.user_branch_roles t
    where t.user_id = users.id                               -- the row under test (qualified to avoid t.id shadowing)
      and public.has_permission(t.company_id, 'user.read')
  ));

create policy users_update_self on public.users
  for update to authenticated
  using (auth_user_id = (select auth.uid()) and account_status = 'Active')
  with check (auth_user_id = (select auth.uid()) and account_status = 'Active');

-- companies — visible to its active members.
grant select on public.companies to authenticated;
create policy companies_select_member on public.companies
  for select to authenticated
  using (id in (select public.accessible_company_ids()));

-- branches — company structure visible to active members of the owning company (branch-owned BUSINESS data gets
-- per-branch narrowing when those tables arrive in Phase 2; the branch directory itself is company-scoped, B1 §4).
grant select on public.branches to authenticated;
create policy branches_select_member on public.branches
  for select to authenticated
  using (company_id in (select public.accessible_company_ids()));

-- roles — company-owned, visible to active members.
grant select on public.roles to authenticated;
create policy roles_select_member on public.roles
  for select to authenticated
  using (company_id in (select public.accessible_company_ids()));

-- role_permissions — company-owned mapping, visible to active members.
grant select on public.role_permissions to authenticated;
create policy role_permissions_select_member on public.role_permissions
  for select to authenticated
  using (company_id in (select public.accessible_company_ids()));

-- user_branch_roles — own memberships always; others only with the 'membership.read' permission (sensitive).
grant select on public.user_branch_roles to authenticated;
create policy user_branch_roles_select_own on public.user_branch_roles
  for select to authenticated
  using (user_id = public.current_app_user_id());
create policy user_branch_roles_select_admin on public.user_branch_roles
  for select to authenticated
  using (public.has_permission(company_id, 'membership.read'));

-- permissions — unchanged from M3: global capability catalog, read-all-authenticated (B1 §4 global/system).
-- No authenticated WRITE policies/grants on any table: Phase 1 writes stay on the governed service_role path.
