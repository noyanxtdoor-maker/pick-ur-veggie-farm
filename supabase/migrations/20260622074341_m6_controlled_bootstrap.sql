-- Migration M6 — Controlled Bootstrap Mechanism (Stage D Phase 1)
-- Authority: Migration Design M6 (guarded, one-time, self-disabling capability + permanent completion guard;
--   does NOT create company/branch/user/owner rows — those are RUNTIME audited events) · ADS §5 (bootstrap
--   one-time invariant: no default credentials; ownership never granted by first registrant) · §3 seed governance
--   (allowed: permission catalog + role template; forbidden forever: users/companies/branches/owner seeds) ·
--   B7 §2 (ownership originates from audited runtime flows) · B6 (bootstrap actions are audited) · C3.
-- Scope (locked): the MECHANISM ONLY — the permission catalog seed, a completion-guard, and the bootstrap
--   function. This migration creates NO company/branch/user/owner/tenant rows (those are produced by CALLING
--   the function at runtime). M1–M5 migration files are NOT modified.
-- Risk: High (identity/tenant via the mechanism). Rollback: structural while unused; restore-based once the
--   runtime bootstrap has executed (the created rows are application data).

-- ── Permission catalog seed (the ONLY allowed seed — global, idempotent, non-business; §3) ──
-- The Phase-1 enforcement keys actually checked by M4/M5 policies. The catalog grows additively as modules add
-- enforcement points (Phase 2+); it is NEVER tenant/business data.
insert into public.permissions (permission_key, description) values
  ('user.read',       'Read user records within the company'),
  ('membership.read', 'Read membership (user_branch_roles) within the company'),
  ('audit.read',      'Read the audit log within the company')
on conflict (permission_key) do nothing;

-- ── Completion guard — a permanent, single-row, self-disabling flag ──────────
-- Singleton: id is a constant true with a PK, so only one row can ever exist. The trigger below makes
-- completion irreversible (true never returns to false) and the row undeletable → "impossible to re-enable
-- through normal application paths". No app role gets any grant; only the SECURITY DEFINER function touches it.
create table public.bootstrap_state (
  id            boolean primary key default true check (id),  -- singleton row (id = true)
  completed     boolean not null default false,
  completed_at  timestamptz,
  company_id    uuid references public.companies (id),
  owner_user_id uuid references public.users (id)
);
comment on table public.bootstrap_state is 'Singleton completion guard for the one-time tenant bootstrap (Stage D Phase 1, M6). completed flips false→true exactly once and is irreversible (trigger); no app-role grants. Not tenant data → guard-exempt.';
insert into public.bootstrap_state (id) values (true);

create function public.bootstrap_state_guard() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'bootstrap_state is permanent and cannot be deleted' using errcode = 'restrict_violation';
  end if;
  if old.completed and not new.completed then
    raise exception 'bootstrap completion is irreversible' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger bootstrap_state_no_reset
  before update or delete on public.bootstrap_state
  for each row execute function public.bootstrap_state_guard();

-- RLS: enabled+forced, no policies, no app-role grants → fully internal (only the definer function / owner).
alter table public.bootstrap_state enable row level security;
alter table public.bootstrap_state force row level security;
revoke all on public.bootstrap_state from public, anon, authenticated, service_role;

-- ── The bootstrap capability — runs EXACTLY ONCE, atomically, fully audited ──
-- Authorization: EXECUTE granted to service_role ONLY (the governed server/operator path). anon/authenticated
-- cannot invoke it (Attack 3). SECURITY DEFINER (runs as owner) so it can write across the locked tables, but
-- every row it writes still satisfies the M3 composite FKs and M5 immutability. One plpgsql function = one
-- atomic unit: any failure rolls the whole thing back (Attack 4). The owner is the auth identity the operator
-- explicitly passes in — ownership is NOT granted by being the first registrant (ADS §5).
create function public.bootstrap_initial_tenant(
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
  -- One-time guard (both conditions): completion flag AND "no company exists". Either being set blocks re-run.
  if (select completed from public.bootstrap_state where id) or exists (select 1 from public.companies) then
    raise exception 'bootstrap has already completed; the initial tenant can be created exactly once'
      using errcode = 'raise_exception';
  end if;

  -- Company #1, then Branch #1 (note: created BEFORE the owner user, so a bad owner id fails AFTER these exist,
  -- proving full rollback — Attack 4).
  insert into public.companies (company_code, name) values (p_company_code, p_company_name) returning id into v_company;
  insert into public.branches (company_id, branch_code, name) values (v_company, p_branch_code, p_branch_name) returning id into v_branch;

  -- Owner ERP business identity (links the operator-supplied auth identity; FK to auth.users enforces it exists).
  insert into public.users (auth_user_id, display_name) values (p_owner_auth_user_id, p_owner_display_name)
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id = p_owner_auth_user_id;

  -- Owner role + the initial Owner permission set = the full active permission catalog (no caller-supplied
  -- template → no injected/escalated permissions, Attack 6). Composite FK forces role_permissions to this company.
  insert into public.roles (company_id, role_key, description) values (v_company, 'owner', 'Tenant owner (bootstrap)') returning id into v_role;
  insert into public.role_permissions (company_id, role_id, permission_id)
    select v_company, v_role, p.id from public.permissions p where p.status = 'Active';

  -- Owner membership (satisfies M3 composite FKs: branch & role belong to v_company).
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, v_company, v_branch, v_role);

  -- Immutable audit trail (M5) — the first tenant creation is traceable forever (Attack 5). Actor = the owner.
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id) values
    (v_company, null,     v_user, 'Administrative', 'company.bootstrapped', 'bootstrap', 'company', v_company),
    (v_company, v_branch, v_user, 'Administrative', 'branch.bootstrapped',  'bootstrap', 'branch',  v_branch),
    (v_company, v_branch, v_user, 'Administrative', 'owner.assigned',       'bootstrap', 'user_branch_roles', v_user);

  -- Self-disable: flip the completion flag (irreversible via the guard trigger).
  update public.bootstrap_state set completed = true, completed_at = now(), company_id = v_company, owner_user_id = v_user where id;

  return v_company;
end;
$$;
comment on function public.bootstrap_initial_tenant(uuid, text, text, text, text, text) is 'One-time, self-disabling tenant bootstrap (Stage D Phase 1, M6; ADS §5). service_role-only. Atomically creates Company#1/Branch#1/owner user/owner role+permissions/owner membership + audit, then permanently disables itself. Re-run impossible (completion flag + no-company guard).';

revoke all on function public.bootstrap_initial_tenant(uuid, text, text, text, text, text) from public;
grant execute on function public.bootstrap_initial_tenant(uuid, text, text, text, text, text) to service_role;
