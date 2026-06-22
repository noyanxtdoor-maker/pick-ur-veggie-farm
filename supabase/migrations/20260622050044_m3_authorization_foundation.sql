-- Migration M3 — Authorization Foundation (Stage D Phase 1)
-- Authority: Phase 1 Physical Schema §4.4–§4.7 · Migration Design M3 · ADS §2–§4/§6 ·
--   B1 (RLS deny-by-default) · B3 (indexing) · B6 (historical preservation) · C3 (migration governance) ·
--   C7 §2 / ADS §4 (permission-based authorization; role names are NEVER an authorization decision).
-- Scope (locked): authorization relationships ONLY — permissions (global catalog), roles (per company),
--   role_permissions (role→permission mapping), user_branch_roles (membership). NO resolver (M4), NO audit (M5),
--   NO bootstrap (M6), NO business modules. M1 (users) and M2 (companies/branches) are LOCKED and untouched,
--   except ONE additive UNIQUE constraint on branches required as a composite-FK target (no data/ownership change).
-- Risk: High (authorization). Rollback: reversible while empty; restore-based once authorization data exists.
--
-- Cross-tenant integrity is enforced DECLARATIVELY via composite foreign keys (not triggers / app code):
-- a membership's branch and role must belong to the SAME company as the membership, and a role_permission's
-- role must belong to its company. This makes cross-company privilege escalation structurally impossible.

-- ── permissions — global/system capability catalog (no tenant key) ────────────
-- permission_key is the authorization ENFORCEMENT key. Global reference data: every authenticated user may
-- READ the catalog (non-sensitive — it lists capabilities, not who holds them); only the governed system /
-- developer path (service_role) writes it (seeded idempotently, post-M3). NOT company-owned → it is in the
-- tenant-ownership guard's exempt list. permission_key is immutable (enforced via column-scoped UPDATE grant).
create table public.permissions (
  id             uuid primary key default public.uuidv7(),
  permission_key text not null unique,
  description    text,
  status         text not null default 'Active' check (status in ('Active', 'Deprecated')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.permissions is 'Global authorization capability catalog (Stage D Phase 1, M3). permission_key is the enforcement key (immutable). Read-all-authenticated; system/developer writes only. Deprecate via status; never hard-delete.';

create trigger permissions_set_updated_at before update on public.permissions
  for each row execute function public.set_updated_at();

-- ── roles — per-company grouping of permissions (a label, never an authz key) ──
-- role_key is a grouping label only; authorization is by permission, never by role name (C7 §2 / ADS §4).
create table public.roles (
  id          uuid primary key default public.uuidv7(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  role_key    text not null,
  description text,
  status      text not null default 'Active' check (status in ('Active', 'Deprecated')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, role_key),   -- no duplicate role label per company; also serves company_id-prefix scans (B3)
  unique (id, company_id)          -- composite-FK target so children can prove "same company" (redundant for uniqueness; required by the FK)
);
comment on table public.roles is 'Per-company role = grouping of permissions (Stage D Phase 1, M3). role_key is a label, NEVER an authorization decision (C7 §2). company_id/role_key immutable. Deprecate via status; never hard-delete.';

create index roles_active_idx on public.roles (company_id) where status = 'Active';

create trigger roles_set_updated_at before update on public.roles
  for each row execute function public.set_updated_at();

-- ── role_permissions — role → permission mapping (company-owned) ──────────────
-- company_id is denormalized (tenant key for index-served RLS, B3 §8) and CONSTRAINED to equal the role's
-- company via the composite FK → a role cannot be granted a permission under a foreign company.
create table public.role_permissions (
  id            uuid primary key default public.uuidv7(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  role_id       uuid not null,
  permission_id uuid not null references public.permissions (id) on delete restrict,
  created_at    timestamptz not null default now(),
  unique (role_id, permission_id),                                                                 -- no duplicate mapping
  foreign key (role_id, company_id) references public.roles (id, company_id) on delete restrict    -- role belongs to this company
);
comment on table public.role_permissions is 'Role->permission mapping (Stage D Phase 1, M3). Immutable mapping (no updated_at). Composite FK forces role_id + company_id to the same company. No hard delete.';

create index role_permissions_company_role_idx on public.role_permissions (company_id, role_id);

-- ── branches: additive composite-FK target (M2 table — ADDITIVE only) ─────────
-- branches already has PK(id); this UNIQUE(id, company_id) lets user_branch_roles prove a branch belongs to
-- the membership's company. Additive constraint added in M3; the M2 migration file is NOT modified, no data
-- or ownership changes, tenant boundaries only strengthened.
alter table public.branches add constraint branches_id_company_uq unique (id, company_id);

-- ── user_branch_roles — membership: user ↔ (company, branch, role) ────────────
-- The first authorization relationship. company_id is the tenant key; branch_id and role_id are FORCED to
-- belong to that same company via composite FKs → cross-company / cross-branch assignment is impossible.
create table public.user_branch_roles (
  id                uuid primary key default public.uuidv7(),
  user_id           uuid not null references public.users (id) on delete restrict,
  company_id        uuid not null references public.companies (id) on delete restrict,
  branch_id         uuid not null,
  role_id           uuid not null,
  assignment_status text not null default 'Active' check (assignment_status in ('Active', 'Expired')),
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, company_id, branch_id, role_id),                                                  -- no duplicate assignment
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict, -- branch belongs to this company
  foreign key (role_id, company_id)   references public.roles    (id, company_id) on delete restrict  -- role belongs to this company
);
comment on table public.user_branch_roles is 'Membership: user-(company,branch,role) assignment (Stage D Phase 1, M3). Composite FKs force branch and role to the membership''s company (no cross-tenant escalation). Subject/scope immutable; expire via assignment_status, never hard-delete.';

-- Tenant-leading composite for RLS / resolver derivation of active memberships (B3 §3/§8). (user_id)-prefix
-- lookups are served by the UNIQUE(user_id, …) above, so no standalone user_id index — same rationale as M2's
-- branches(company_id). Partial-on-active: the resolver's hot path is active assignments only.
create index user_branch_roles_active_idx
  on public.user_branch_roles (company_id, branch_id, user_id)
  where assignment_status = 'Active';

create trigger user_branch_roles_set_updated_at before update on public.user_branch_roles
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row-Level Security & privileges — deny-by-default (B1 §1). Member-scoped reads
-- arrive with the centralized resolver in M4 (expand→migrate→contract); USING(true)
-- and interim fake-membership logic are forbidden on tenant tables. Supabase default
-- privileges over-grant (incl. TRUNCATE, which bypasses RLS) → revoke all first, then
-- grant precisely. service_role is BYPASSRLS (governed server path): its column-scoped
-- UPDATE grants are what enforce immutability since RLS does not apply to it. No
-- DELETE/TRUNCATE to any app role anywhere (no hard delete).
-- ════════════════════════════════════════════════════════════════════════════

-- permissions: global reference — read-all-authenticated; system/developer writes only.
alter table public.permissions enable row level security;
alter table public.permissions force row level security;
revoke all on public.permissions from public, anon, authenticated, service_role;
grant select on public.permissions to authenticated;                       -- read the global capability catalog (non-tenant, non-sensitive)
grant select, insert on public.permissions to service_role;                -- seed / maintain catalog (governed path)
grant update (description, status) on public.permissions to service_role;  -- permission_key is the enforcement key -> immutable
create policy permissions_select_all
  on public.permissions for select to authenticated
  using (true);                                                            -- global catalog: every authenticated user may read it (ADS §3; Physical Schema §4.6/§7)

-- roles: company-owned — interim deny-all (no authenticated policy) until the M4 resolver.
alter table public.roles enable row level security;
alter table public.roles force row level security;
revoke all on public.roles from public, anon, authenticated, service_role;
grant select, insert on public.roles to service_role;
grant update (description, status) on public.roles to service_role;        -- company_id / role_key / id immutable

-- role_permissions: company-owned mapping — interim deny-all. Immutable mapping (no UPDATE).
alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;
revoke all on public.role_permissions from public, anon, authenticated, service_role;
grant select, insert on public.role_permissions to service_role;          -- no UPDATE (immutable mapping); no DELETE (no hard delete)

-- user_branch_roles: company-owned membership (branch-scoped) — interim deny-all.
alter table public.user_branch_roles enable row level security;
alter table public.user_branch_roles force row level security;
revoke all on public.user_branch_roles from public, anon, authenticated, service_role;
grant select, insert on public.user_branch_roles to service_role;
grant update (assignment_status, expires_at) on public.user_branch_roles to service_role;  -- subject/scope (user/company/branch/role) immutable; expire, never reassign
