-- Migration P1C — Approvals & Roles hardening (owner's 2026-07-11 production bug list; owner sign-off
-- 2026-07-12 "go" on the Launch_Runbook §2 spec).
-- Authority: Launch_Runbook §2 (the P1C spec) · B7 §6 (account lifecycle) · C2 §3 (auth ≠ authz) ·
--   B1 (RLS boundary) · C7 §0 (permission-based authz — role RANK below is explicit governed DATA on the
--   role row, never a role-name string match) · ODR-003 · CLAUDE.md §6 Phase-1 row (gated auth domain).
-- Gated changes declared: (a) has_permission gains per-user overrides (evolves the locked M4 resolver —
--   spec'd in Launch_Runbook §2.4, guarded in scripts/guards/approvals-roles-security.sql, owner-approved);
--   (b) bootstrap_initial_tenant now also seeds the 4 standard non-owner roles (M6 mechanism unchanged:
--   still one-time, still audited, owner still gets the full catalog).
-- Pattern: ADDITIVE + governed replaces (locked migration FILES untouched; functions evolve via
--   create-or-replace exactly like P1B did). Risk: High (auth domain). Every change guarded.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Role rank — explicit authority-tier DATA on the role row (§2.5)
--    NOT a role-name decision: policies compare the rank COLUMN, never role_key.
--    Tiers: employee 10 · operator 20 · admin 30 · co_owner 40 · owner 50. Custom roles default 0.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.roles add column rank int not null default 0 check (rank >= 0 and rank <= 100);
comment on column public.roles.rank is 'P1C: authority tier (0–100). Governs who may assign/revoke memberships of this role and edit it (actor''s max rank must be strictly higher). Explicit governed data — never derived from the role name (C7 §0).';

-- The caller's highest active rank in a company (−1 when no active membership).
create function public.actor_rank(p_company_id uuid)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(max(r.rank), -1)
  from public.user_branch_roles ubr
  join public.companies c on c.id = ubr.company_id
  join public.roles r on r.id = ubr.role_id and r.company_id = ubr.company_id
  where ubr.user_id = public.current_app_user_id()
    and ubr.company_id = p_company_id
    and ubr.assignment_status = 'Active'
    and (ubr.expires_at is null or ubr.expires_at > now())
    and c.status = 'Active'
    and r.status = 'Active'
$$;
comment on function public.actor_rank(uuid) is 'P1C: the caller''s highest Active-role rank in the company, or -1. Feeds the rank checks in membership/role policies (§2.5).';

-- Does the caller strictly outrank the given role? (missing role → max int → false, deny-by-default)
create function public.outranks_role(p_company_id uuid, p_role_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.actor_rank(p_company_id) >
         coalesce((select r.rank from public.roles r
                   where r.id = p_role_id and r.company_id = p_company_id), 2147483647)
$$;
comment on function public.outranks_role(uuid, uuid) is 'P1C: caller''s rank strictly above the target role''s rank (deny when the role is unknown). The server-side appointment-hierarchy check (§2.5).';

revoke all on function public.actor_rank(uuid) from public;
revoke all on function public.outranks_role(uuid, uuid) from public;
grant execute on function public.actor_rank(uuid) to authenticated;
grant execute on function public.outranks_role(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Standard 5-tier role seed (§2.2) — per company, idempotent, additive-only on permissions
-- ════════════════════════════════════════════════════════════════════════════
create function public.seed_standard_roles(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_role uuid;
begin
  -- the bootstrap 'owner' role carries the top tier
  update public.roles set rank = 50 where company_id = p_company_id and role_key = 'owner' and rank <> 50;

  for r in
    select * from (values
      ('employee', 10, 'Enter individual sales only, check own pay',
        array['pos.sell']),
      ('operator', 20, 'Data entry inputs, POS cashier, view schedules',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read']),
      ('admin', 30, 'POS, financial statements, core ledgers, setup',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read',
              'pos.void','product.manage','crop.manage','equipment.manage','accounting.read','accounting.manage',
              'finance.account.read','finance.account.manage','payroll.read','payroll.manage','customer.read','customer.manage',
              'project.read','project.manage','schedule.manage','schedule.read_private','user.read','membership.read','audit.read']),
      ('co_owner', 40, 'All access — edit everything except developer configurations',
        null)                       -- null = the FULL active catalog (owner-equivalent keys; rank still below owner)
    ) as t(role_key, rank, description, keys)
  loop
    insert into public.roles (company_id, role_key, description, rank)
      values (p_company_id, r.role_key, r.description, r.rank)
      on conflict (company_id, role_key) do update set rank = excluded.rank;
    select id into v_role from public.roles where company_id = p_company_id and role_key = r.role_key;
    insert into public.role_permissions (company_id, role_id, permission_id)
      select p_company_id, v_role, p.id
      from public.permissions p
      where p.status = 'Active' and (r.keys is null or p.permission_key = any (r.keys))
      on conflict (role_id, permission_id) do nothing;
  end loop;
end; $$;
comment on function public.seed_standard_roles(uuid) is 'P1C §2.2: idempotently seeds the 5-tier standard roles (employee/operator/admin/co_owner; owner exists from bootstrap and gets rank 50) with their exact permission sets. Additive-only (never removes a mapping). service_role/bootstrap path only.';
revoke all on function public.seed_standard_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_standard_roles(uuid) to service_role;

-- Backfill: every existing company gets the standard tiers (the live tenant currently has only 'owner').
select public.seed_standard_roles(id) from public.companies;

-- Bootstrap evolution (M6 mechanism unchanged — still one-time/audited/self-disabling): new tenants get the
-- 5 tiers immediately, so the approve dialog is never a single-option dropdown again.
create or replace function public.bootstrap_initial_tenant(
  p_owner_auth_user_id uuid,
  p_owner_display_name  text,
  p_company_code        text,
  p_company_name        text,
  p_branch_code         text,
  p_branch_name         text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_branch  uuid;
  v_user    uuid;
  v_role    uuid;
begin
  if (select completed from public.bootstrap_state where id) or exists (select 1 from public.companies) then
    raise exception 'bootstrap has already completed; the initial tenant can be created exactly once'
      using errcode = 'raise_exception';
  end if;

  insert into public.companies (company_code, name) values (p_company_code, p_company_name) returning id into v_company;
  insert into public.branches (company_id, branch_code, name) values (v_company, p_branch_code, p_branch_name) returning id into v_branch;

  insert into public.users (auth_user_id, display_name) values (p_owner_auth_user_id, p_owner_display_name)
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id = p_owner_auth_user_id;

  insert into public.roles (company_id, role_key, description, rank) values (v_company, 'owner', 'Tenant owner (bootstrap)', 50) returning id into v_role;
  insert into public.role_permissions (company_id, role_id, permission_id)
    select v_company, v_role, p.id from public.permissions p where p.status = 'Active';

  -- P1C §2.2: the standard non-owner tiers exist from day one.
  perform public.seed_standard_roles(v_company);

  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, v_company, v_branch, v_role);

  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id) values
    (v_company, null,     v_user, 'Administrative', 'company.bootstrapped', 'bootstrap', 'company', v_company),
    (v_company, v_branch, v_user, 'Administrative', 'branch.bootstrapped',  'bootstrap', 'branch',  v_branch),
    (v_company, v_branch, v_user, 'Administrative', 'owner.assigned',       'bootstrap', 'user_branch_roles', v_user);

  update public.bootstrap_state set completed = true, completed_at = now(), company_id = v_company, owner_user_id = v_user where id;

  return v_company;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Per-user permission overrides — SERVER-enforced (§2.4; replaces the mockup's Dexie-only theater)
-- ════════════════════════════════════════════════════════════════════════════
create table public.user_permission_overrides (
  id            uuid primary key default public.uuidv7(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  user_id       uuid not null references public.users (id) on delete restrict,
  permission_id uuid not null references public.permissions (id) on delete restrict,
  effect        text not null check (effect in ('grant', 'deny')),
  created_by    uuid not null references public.users (id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, user_id, permission_id)
);
comment on table public.user_permission_overrides is 'P1C §2.4: per-user permission overrides, folded into has_permission (deny beats role grant; grant adds a key the role lacks but ONLY while the user holds an Active membership in the company). Written exclusively via set_user_permission_override(). Company-scoped — can never cross tenants.';
create index user_permission_overrides_user_idx on public.user_permission_overrides (company_id, user_id);
create trigger user_permission_overrides_set_updated_at before update on public.user_permission_overrides
  for each row execute function public.set_updated_at();

alter table public.user_permission_overrides enable row level security;
alter table public.user_permission_overrides force row level security;
revoke all on public.user_permission_overrides from public, anon, authenticated, service_role;
grant select on public.user_permission_overrides to authenticated;
-- own overrides (the app shows the user their effective access) + membership managers of the company
create policy user_permission_overrides_select_own on public.user_permission_overrides
  for select to authenticated
  using (user_id = public.current_app_user_id());
create policy user_permission_overrides_select_admin on public.user_permission_overrides
  for select to authenticated
  using (public.has_permission(company_id, 'membership.manage'));
grant select on public.user_permission_overrides to service_role;

-- The ONLY write path: governed, rank-checked, audited. p_effect: 'grant' | 'deny' | null (= clear).
create function public.set_user_permission_override(
  p_company_id uuid, p_user_id uuid, p_permission_key text, p_effect text
) returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_perm uuid; v_target_rank int; v_prior text;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company_id, 'membership.manage') then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = v_actor then
    raise exception 'you cannot override your own permissions' using errcode = 'insufficient_privilege';
  end if;
  if p_effect is not null and p_effect not in ('grant', 'deny') then
    raise exception 'effect must be grant, deny, or null (clear)' using errcode = 'raise_exception';
  end if;
  select p.id into v_perm from public.permissions p where p.permission_key = p_permission_key and p.status = 'Active';
  if v_perm is null then
    raise exception 'unknown permission key: %', p_permission_key using errcode = 'raise_exception';
  end if;
  -- target must be an ACTIVE member of this company, and the actor must strictly outrank the target (§2.5)
  select max(r.rank) into v_target_rank
  from public.user_branch_roles ubr
  join public.roles r on r.id = ubr.role_id and r.company_id = ubr.company_id
  where ubr.user_id = p_user_id and ubr.company_id = p_company_id
    and ubr.assignment_status = 'Active'
    and (ubr.expires_at is null or ubr.expires_at > now())
    and r.status = 'Active';
  if v_target_rank is null then
    raise exception 'target is not an active member of this company' using errcode = 'raise_exception';
  end if;
  if public.actor_rank(p_company_id) <= v_target_rank then
    raise exception 'permission denied: you can only override users below your tier' using errcode = 'insufficient_privilege';
  end if;

  select o.effect into v_prior from public.user_permission_overrides o
    where o.company_id = p_company_id and o.user_id = p_user_id and o.permission_id = v_perm;

  if p_effect is null then
    delete from public.user_permission_overrides
      where company_id = p_company_id and user_id = p_user_id and permission_id = v_perm;
  else
    insert into public.user_permission_overrides (company_id, user_id, permission_id, effect, created_by)
      values (p_company_id, p_user_id, v_perm, p_effect, v_actor)
      on conflict (company_id, user_id, permission_id) do update set effect = excluded.effect, updated_at = now();
  end if;

  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, previous_value, new_value)
    values (p_company_id, v_actor, 'Administrative',
            case when p_effect is null then 'permission.override.cleared' else 'permission.override.set' end,
            'organization', 'user_permission_overrides', p_user_id,
            jsonb_build_object('permission_key', p_permission_key, 'effect', v_prior),
            jsonb_build_object('permission_key', p_permission_key, 'effect', p_effect));
end; $$;
comment on function public.set_user_permission_override(uuid, uuid, text, text) is 'P1C §2.4: the only write path for per-user overrides. membership.manage + strict rank-above-target required; self-override forbidden; audited with before/after. null effect clears the override.';
revoke all on function public.set_user_permission_override(uuid, uuid, text, text) from public;
grant execute on function public.set_user_permission_override(uuid, uuid, text, text) to authenticated;

-- has_permission evolution (the gated M4-resolver change, §2.4): deny-override beats everything; a
-- grant-override applies ONLY while the caller holds an Active membership in an Active company (an override
-- row can never manufacture access for a non-member, an expired member, or across tenants); otherwise the
-- original role-based derivation answers. Signature, language, volatility, and grants unchanged.
create or replace function public.has_permission(p_company_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.user_permission_overrides o
      join public.permissions p on p.id = o.permission_id
      where o.user_id = public.current_app_user_id()
        and o.company_id = p_company_id
        and p.permission_key = p_permission_key
        and p.status = 'Active'
        and o.effect = 'deny'
    ) then false
    when exists (
      select 1
      from public.user_permission_overrides o
      join public.permissions p on p.id = o.permission_id
      where o.user_id = public.current_app_user_id()
        and o.company_id = p_company_id
        and p.permission_key = p_permission_key
        and p.status = 'Active'
        and o.effect = 'grant'
    ) then exists (
      select 1
      from public.user_branch_roles ubr
      join public.companies c on c.id = ubr.company_id
      where ubr.user_id = public.current_app_user_id()
        and ubr.company_id = p_company_id
        and ubr.assignment_status = 'Active'
        and (ubr.expires_at is null or ubr.expires_at > now())
        and c.status = 'Active'
    )
    else exists (
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
  end
$$;
comment on function public.has_permission(uuid, text) is 'Resolver (M4, evolved by P1C §2.4): per-user override fold-in — deny beats role grant; grant requires a live Active membership; otherwise the permission-based role derivation (never role-name). SECURITY DEFINER, search_path pinned.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Rank-enforced membership & role governance (§2.5) — policy evolutions (expand→migrate→contract)
-- ════════════════════════════════════════════════════════════════════════════
-- Memberships: assigning a NEW membership (insert = granting initial access to someone) now ALSO requires
--   strictly outranking the target role. Consequences (all intended): an admin-tier manager can never
--   appoint a peer/superior admin; only owner appoints co_owner.
--   Editing an EXISTING membership (update = suspend/reactivate/reassign) requires the same rank check when
--   the target is SOMEONE ELSE — an admin-tier manager can never touch a peer/superior's access. The target's
--   OWN row is exempt from the rank check (still gated by membership.manage): the mutable columns are only
--   assignment_status/expires_at, which can never grant more than the caller's existing role already has, so
--   self-management is not an escalation path — and this preserves the pre-existing, guard-proven capability
--   for an owner/manager to suspend or reactivate their own membership (org-security.sql).
drop policy user_branch_roles_insert_manage on public.user_branch_roles;
create policy user_branch_roles_insert_manage on public.user_branch_roles
  for insert to authenticated
  with check (public.has_permission(company_id, 'membership.manage')
              and public.outranks_role(company_id, role_id));
drop policy user_branch_roles_update_manage on public.user_branch_roles;
create policy user_branch_roles_update_manage on public.user_branch_roles
  for update to authenticated
  using (public.has_permission(company_id, 'membership.manage')
         and (user_id = public.current_app_user_id() or public.outranks_role(company_id, role_id)))
  with check (public.has_permission(company_id, 'membership.manage')
              and (user_id = public.current_app_user_id() or public.outranks_role(company_id, role_id)));

-- Roles: creating a role caps its rank BELOW the creator's (nobody manufactures a peer/superior tier);
-- editing a role (description/status) requires outranking it (a co_owner with role.manage can no longer
-- deprecate the owner role out from under the owner). rank itself has no UPDATE grant — changing a tier's
-- rank is a service_role/platform action (matches the role_permissions immutability doctrine).
grant insert (rank) on public.roles to authenticated;
drop policy roles_insert_manage on public.roles;
create policy roles_insert_manage on public.roles
  for insert to authenticated
  with check (public.has_permission(company_id, 'role.manage')
              and rank < public.actor_rank(company_id));
drop policy roles_update_manage on public.roles;
create policy roles_update_manage on public.roles
  for update to authenticated
  using (public.has_permission(company_id, 'role.manage')
         and public.outranks_role(company_id, id))
  with check (public.has_permission(company_id, 'role.manage')
              and public.outranks_role(company_id, id));

-- Role→permission mappings: adding a permission to a role requires outranking THAT role — closes the
-- self-escalation path where a role.manage holder pads their own role's permission set.
drop policy role_permissions_insert_manage on public.role_permissions;
create policy role_permissions_insert_manage on public.role_permissions
  for insert to authenticated
  with check (public.has_permission(company_id, 'role.manage')
              and public.outranks_role(company_id, role_id));

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Signup trigger: OAuth display-name extraction (§2.1)
--    Google/OAuth identities carry full_name/name in raw_user_meta_data, not display_name — without this the
--    ERP row falls back to the email local-part. Trigger coverage itself verified working (every auth.users
--    INSERT fires it, any provider); the missing-Google-signup symptom is provider/redirect config, which is
--    an owner dashboard action (Launch_Runbook §1 steps 3–4).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.p1a_skip_signup_trigger', true), '') = '1' then return new; end if;
  insert into public.users (auth_user_id, display_name, email)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),   -- Google OAuth
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),        -- generic OAuth
      split_part(coalesce(new.email, 'member'), '@', 1)
    ),
    new.email
  )
  on conflict (auth_user_id) do nothing;
  return new;
end; $$;
comment on function public.handle_new_auth_user() is 'P1A trigger, P1C-evolved (§2.1): auth.users insert → public.users identity for EVERY provider; display name from display_name → full_name → name → email local-part. Idempotent vs invite-accept.';
