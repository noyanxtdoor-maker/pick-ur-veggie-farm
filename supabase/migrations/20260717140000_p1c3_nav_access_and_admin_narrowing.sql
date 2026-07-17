-- Migration P1C3 — Section Access redesign + admin default narrowing (owner directive 2026-07-17,
-- redesigning the just-shipped P1C2 "Module access" panel). Three server-side pieces:
--
--   1. A new permission key `membership.approve`, and a new generalized resolver
--      `user_key_tier(company, user, read_key, manage_key)` parameterized directly on key names
--      instead of the `permissions.module` column P1C2 used. Needed because the new nav-shaped Access
--      tree requires `membership.manage` to serve as the "manage" key for THREE different tabs
--      (Approvals / Members / Archived) at once — a single scalar `module` column can't represent
--      that. Additive alongside `user_module_access`/`permission_modules` (not touched, not dropped).
--
--      This resolver also fixes a bug already live in the P1C2 resolver: it never checked a deny
--      override on the READ key, only the manage key — combined with the client's `apply()` writing
--      `effect: null` (not `deny`) for the "none" target, "Not Visible" has never actually been able
--      to suppress a role-derived grant. This resolver checks deny on BOTH keys; the client-side
--      `apply()` fix (writing `deny`, not `null`, for "none") ships in the same session, see
--      app/features/organization/overrides/access.ts.
--
--   2. `seed_standard_roles()` evolves: admin gains `membership.approve` (can now approve/reject
--      pending sign-ups — previously impossible, admin lacked `membership.manage` entirely, the sole
--      gate on the whole Pending Account Approvals card); admin LOSES `payroll.read`/`payroll.manage`
--      (admin becomes self-payroll-only by default via the existing M5C RLS self-visibility policies,
--      unchanged — full-roster access is now something an owner explicitly grants via the Access
--      panel, not a default). Backfilled onto existing companies: additive INSERT for
--      membership.approve (P1H.1-style), and a scoped DELETE for payroll.read/payroll.manage — the
--      FIRST migration in this project to delete an existing role_permissions row rather than only
--      add one. Scoped exactly to role_key='admin'; nothing else touched. A DELETE (not a mass
--      deny-override seed) because role_permissions is the tier-wide default policy and
--      user_permission_overrides is for individual exceptions (rank-checked, audited,
--      self-override-forbidden) — this is a policy change, and DELETE auto-covers admins promoted
--      AFTER this migration too, where a one-time override seed would not. Any admin with an
--      INDIVIDUAL override grant of payroll.read/manage keeps it (deliberate).
--
--   3. Three RPCs relaxed from a hardcoded `membership.manage`-only gate to accept the lighter
--      `membership.approve` where appropriate: `list_pending_users()`, `reject_pending_user()`, and
--      `assign_membership_with_payroll()` (the single RPC used for BOTH approving a new signup and
--      reassigning an existing member's role — branched so only the "no prior active membership"
--      path accepts `membership.approve`; reassigning an EXISTING member still requires full
--      `membership.manage`, unchanged, so an approve-tier admin cannot reach reassignment by calling
--      this RPC directly even though the client button stays hidden for them). All three also get an
--      explicit `revoke ... from public, anon` — confirmed via direct read that all three currently
--      end with a bare `revoke all ... from public` (missing `, anon`), the same gap class this
--      session already found and fixed in P1M/P1M.1: production's default ACLs grant anon EXECUTE
--      directly on new functions in a way `revoke ... from public` alone does not strip.

-- 1) New permission key.
insert into public.permissions (permission_key, description, module) values
  ('membership.approve', 'Approve or reject pending sign-up requests', 'organization')
on conflict (permission_key) do nothing;

-- 2) New generalized (read_key, manage_key) resolver — see header for why this exists alongside
-- user_module_access rather than replacing it. READ-ONLY; writes still go through
-- set_user_permission_override.
create function public.user_key_tier(p_company_id uuid, p_user_id uuid, p_read_key text, p_manage_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_manage    bool;
  v_manage_denied bool;
  v_has_read      bool;
  v_read_denied   bool;
begin
  -- Does the target user hold the manage key (via role or override grant)?
  select exists (
    select 1 from public.user_branch_roles ubr
    join public.roles r on r.id = ubr.role_id and r.company_id = ubr.company_id
    join public.role_permissions rp on rp.role_id = r.id and rp.company_id = ubr.company_id
    join public.permissions p on p.id = rp.permission_id
    where ubr.user_id = p_user_id and ubr.company_id = p_company_id
      and ubr.assignment_status = 'Active'
      and (ubr.expires_at is null or ubr.expires_at > now())
      and p.permission_key = p_manage_key and p.status = 'Active'
  ) or exists (
    select 1 from public.user_permission_overrides o
    join public.permissions p on p.id = o.permission_id
    where o.user_id = p_user_id and o.company_id = p_company_id
      and p.permission_key = p_manage_key and o.effect = 'grant'
  ) into v_has_manage;

  -- Is the manage key explicitly denied to the user?
  select exists (
    select 1 from public.user_permission_overrides o
    join public.permissions p on p.id = o.permission_id
    where o.user_id = p_user_id and o.company_id = p_company_id
      and p.permission_key = p_manage_key and o.effect = 'deny'
  ) into v_manage_denied;

  -- Does the target user hold the read key (via role or override grant)? Only meaningful when a read
  -- key is actually defined for this node — some nodes are manage-only (no separate weaker tier).
  select (p_read_key is not null) and (exists (
    select 1 from public.user_branch_roles ubr
    join public.roles r on r.id = ubr.role_id and r.company_id = ubr.company_id
    join public.role_permissions rp on rp.role_id = r.id and rp.company_id = ubr.company_id
    join public.permissions p on p.id = rp.permission_id
    where ubr.user_id = p_user_id and ubr.company_id = p_company_id
      and ubr.assignment_status = 'Active'
      and (ubr.expires_at is null or ubr.expires_at > now())
      and p.permission_key = p_read_key and p.status = 'Active'
  ) or exists (
    select 1 from public.user_permission_overrides o
    join public.permissions p on p.id = o.permission_id
    where o.user_id = p_user_id and o.company_id = p_company_id
      and p.permission_key = p_read_key and o.effect = 'grant'
  )) into v_has_read;

  -- Is the read key explicitly denied? (Bug-A fix — the P1C2 resolver this generalizes never checked
  -- a deny on the read key, only the manage key.)
  select (p_read_key is not null) and exists (
    select 1 from public.user_permission_overrides o
    join public.permissions p on p.id = o.permission_id
    where o.user_id = p_user_id and o.company_id = p_company_id
      and p.permission_key = p_read_key and o.effect = 'deny'
  ) into v_read_denied;

  if v_has_manage and not v_manage_denied then
    return 'manage';
  elsif (v_has_read and not v_read_denied) or (v_has_manage and not v_manage_denied) then
    return 'view';
  else
    return 'none';
  end if;
end;
$$;
comment on function public.user_key_tier(uuid, uuid, text, text) is 'P1C3: READ-ONLY resolver for the nav-shaped Access panel, generalizing user_module_access (P1C2) to accept explicit (read_key, manage_key) pairs instead of a module-column lookup, since one key (e.g. membership.manage) now serves as the manage tier for multiple different nav nodes. Checks deny overrides on BOTH keys. Writes go through set_user_permission_override, unchanged.';
revoke all on function public.user_key_tier(uuid, uuid, text, text) from public, anon;
grant execute on function public.user_key_tier(uuid, uuid, text, text) to authenticated;

-- 3) seed_standard_roles(): admin gains membership.approve, loses payroll.read/payroll.manage.
create or replace function public.seed_standard_roles(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_role uuid; v_owner_role uuid;
begin
  update public.roles set rank = 50 where company_id = p_company_id and role_key = 'owner' and rank <> 50;

  for r in
    select * from (values
      ('employee', 10, 'Enter individual sales only, check own pay and schedule',
        array['pos.sell','schedule.read','project.read']),
      ('operator', 20, 'Data entry inputs, POS cashier, view schedules',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read','project.read']),
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

  -- P1D.1: owner always gets the full current catalog too — re-synced on every call, not just at bootstrap.
  select id into v_owner_role from public.roles where company_id = p_company_id and role_key = 'owner';
  if v_owner_role is not null then
    insert into public.role_permissions (company_id, role_id, permission_id)
      select p_company_id, v_owner_role, p.id from public.permissions p where p.status = 'Active'
      on conflict (role_id, permission_id) do nothing;
  end if;
end; $$;
comment on function public.seed_standard_roles(uuid) is 'P1C §2.2, evolved through P1D/P1D.1/P1H/P1H.1/P1C3: idempotently seeds the 5-tier standard roles with their exact permission sets. Additive-only for INSERTs (never removes a mapping via this function) — P1C3''s payroll narrowing needed a separate explicit backfill DELETE for existing companies (see below), since this function alone cannot retract a grant it previously made. service_role/bootstrap path only.';
revoke all on function public.seed_standard_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_standard_roles(uuid) to service_role;

-- Backfill for EXISTING companies (seed_standard_roles is additive-only; re-running it alone would not
-- retroactively remove payroll.read/payroll.manage from admin's existing role_permissions rows).
insert into public.role_permissions (company_id, role_id, permission_id)
  select r.company_id, r.id, p.id
  from public.roles r, public.permissions p
  where r.role_key = 'admin' and p.permission_key = 'membership.approve'
on conflict (role_id, permission_id) do nothing;

delete from public.role_permissions
  where role_id in (select id from public.roles where role_key = 'admin')
    and permission_id in (select id from public.permissions where permission_key in ('payroll.read', 'payroll.manage'));

-- 4) Relax the three RPCs that hardcode membership.manage server-side, independent of any client
-- gating — approving a brand-new signup only needs membership.approve; reassigning an EXISTING
-- member's role still requires the full membership.manage, unchanged.

create or replace function public.list_pending_users()
returns table(user_id uuid, display_name text, email text, requested_role text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not exists (
    select 1 from public.user_branch_roles ubr
    where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
      and (public.has_permission(ubr.company_id, 'membership.approve') or public.has_permission(ubr.company_id, 'membership.manage'))
  ) then
    raise exception 'permission denied: membership.approve' using errcode = 'insufficient_privilege';
  end if;
  return query
  select u.id, u.display_name, u.email,
         nullif(trim(au.raw_user_meta_data ->> 'requested_role'), '') as requested_role,
         u.created_at
  from public.users u
  join auth.users au on au.id = u.auth_user_id
  where u.account_status = 'Active'
    and not exists (
      select 1 from public.user_branch_roles ubr
      where ubr.user_id = u.id and ubr.assignment_status = 'Active'
    )
  order by u.created_at;
end; $$;
comment on function public.list_pending_users() is 'P1B, evolved P1C3: the approval queue with the sign-up''s REQUESTED role (a wish from auth metadata — grants nothing; the approver assigns the actual role). membership.approve OR membership.manage required (was membership.manage only).';
revoke all on function public.list_pending_users() from public, anon;
grant execute on function public.list_pending_users() to authenticated;

create or replace function public.reject_pending_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not exists (
    select 1 from public.user_branch_roles ubr
    where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
      and (public.has_permission(ubr.company_id, 'membership.approve') or public.has_permission(ubr.company_id, 'membership.manage'))
  ) then
    raise exception 'permission denied: membership.approve' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.users u
    where u.id = p_user_id and u.account_status = 'Active'
      and not exists (select 1 from public.user_branch_roles ubr where ubr.user_id = u.id and ubr.assignment_status = 'Active')
  ) then
    raise exception 'this account is not a pending signup (already assigned, already rejected, or not found)' using errcode = 'raise_exception';
  end if;
  update public.users set account_status = 'Suspended' where id = p_user_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (null, v_actor, 'Administrative', 'user.signup_rejected', 'organization', 'users', p_user_id);
end;
$$;
comment on function public.reject_pending_user(uuid) is 'P1F, evolved P1C3: turns away a pending signup (account_status -> Suspended). membership.approve OR membership.manage required (was membership.manage only); only reachable while the target is still genuinely pending.';
revoke all on function public.reject_pending_user(uuid) from public, anon;
grant execute on function public.reject_pending_user(uuid) to authenticated;

create or replace function public.assign_membership_with_payroll(
  p_company_id uuid, p_target_user_id uuid, p_branch_id uuid, p_role_id uuid,
  p_employee_name text default null, p_position_id uuid default null, p_daily_rate numeric default null,
  p_exempt boolean default false
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; v_role_rank int; v_existing_employee uuid; v_prior_membership uuid; v_new_membership uuid; v_employee_id uuid; v_has_prior boolean;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;

  -- P1C3: branch on whether the target already has an active membership. Approving a brand-new
  -- pending signup (no prior membership) accepts the lighter membership.approve tier; reassigning an
  -- EXISTING member's role still requires full membership.manage, unchanged — an approve-tier admin
  -- must not be able to reach reassignment by calling this RPC directly.
  select exists (
    select 1 from public.user_branch_roles
    where user_id = p_target_user_id and company_id = p_company_id and assignment_status = 'Active'
  ) into v_has_prior;

  if v_has_prior then
    if not public.has_permission(p_company_id, 'membership.manage') then
      raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
    end if;
  else
    if not (public.has_permission(p_company_id, 'membership.approve') or public.has_permission(p_company_id, 'membership.manage')) then
      raise exception 'permission denied: membership.approve' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- same rank rule as direct assignment (P1C user_branch_roles_insert_manage) — never a peer-or-above role.
  if not public.outranks_role(p_company_id, p_role_id) then
    raise exception 'permission denied: you can only assign a role below your own tier' using errcode = 'insufficient_privilege';
  end if;

  select rank into v_role_rank from public.roles where id = p_role_id and company_id = p_company_id;
  if v_role_rank is null then raise exception 'role not found in this company' using errcode = 'raise_exception'; end if;

  if v_role_rank < 40 then
    select id into v_existing_employee from public.employees where company_id = p_company_id and user_id = p_target_user_id;
    if v_existing_employee is null and not p_exempt then
      if p_employee_name is null or trim(p_employee_name) = '' or p_position_id is null or p_daily_rate is null or p_daily_rate <= 0 then
        raise exception 'payroll setup required: name, position, and a positive daily rate must all be provided (or pass exempt)' using errcode = 'raise_exception';
      end if;
      insert into public.employees (company_id, employee_code, name, position_id, daily_rate, user_id)
        values (p_company_id, 'EMP-' || upper(right(replace(public.uuidv7()::text, '-', ''), 6)), trim(p_employee_name), p_position_id, p_daily_rate, p_target_user_id)
        returning id into v_employee_id;
      insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
        values (p_company_id, v_actor, 'Administrative', 'payroll.employee_created_via_approval', 'payroll', 'employees', v_employee_id);
    elsif v_existing_employee is null and p_exempt then
      update public.users set payroll_exempt = true where id = p_target_user_id;
      insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
        values (p_company_id, v_actor, 'Administrative', 'payroll.exemption_set', 'organization', 'users', p_target_user_id);
    end if;
    -- else: already linked — nothing payroll-related to do (role-change on an already-hired member).
  end if;

  select id into v_prior_membership from public.user_branch_roles
    where user_id = p_target_user_id and company_id = p_company_id and assignment_status = 'Active';
  if v_prior_membership is not null then
    update public.user_branch_roles set assignment_status = 'Expired' where id = v_prior_membership;
  end if;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (p_target_user_id, p_company_id, p_branch_id, p_role_id)
    returning id into v_new_membership;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (p_company_id, p_branch_id, v_actor, 'Administrative',
            case when v_prior_membership is not null then 'membership.reassigned' else 'membership.assigned' end,
            'organization', 'user_branch_roles', v_new_membership);

  return v_new_membership;
end;
$$;
comment on function public.assign_membership_with_payroll(uuid, uuid, uuid, uuid, text, uuid, numeric, boolean) is 'P1D §Part1, evolved P1C3: the one governed entry point for approving/reassigning a member; enforces the payroll-link rule for eligible (rank<40) roles. Atomic. Approving a brand-new signup (no prior active membership) accepts membership.approve OR membership.manage; reassigning an EXISTING member''s role still requires membership.manage, unchanged.';
revoke all on function public.assign_membership_with_payroll(uuid, uuid, uuid, uuid, text, uuid, numeric, boolean) from public, anon;
grant execute on function public.assign_membership_with_payroll(uuid, uuid, uuid, uuid, text, uuid, numeric, boolean) to authenticated;
