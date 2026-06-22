-- Migration M2 — Tenant Foundation (Stage D Phase 1)
-- Authority: Phase 1 Physical Schema §4.1–§4.2 · Migration Design M2 · B1 (RLS deny-by-default) ·
--   B3 (indexing) · B6 (historical preservation) · C3 (migration governance).
-- Scope (locked): tenant structure ONLY — companies + branches. No identity changes (users untouched),
--   no memberships/roles/permissions/resolver, no audit, no bootstrap rows, no business modules.
-- Risk: High (tenancy). Rollback: reversible while empty; restore-based once tenant data exists.

-- ── Shared updated_at maintenance (M2 tables only; users is M1 and stays untouched) ──
create or replace function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── companies — tenant root ───────────────────────────────────────────────────
-- The only operational table without a company_id (it IS the tenant). company_code/base_currency_code
-- are immutable (enforced below via column-scoped UPDATE grant). Deactivate via status; never hard-delete.
create table public.companies (
  id                 uuid primary key default public.uuidv7(),
  company_code       text not null unique,
  name               text not null,
  base_currency_code text not null default 'PHP',
  status             text not null default 'Active' check (status in ('Active', 'Suspended', 'Archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.companies is 'Tenant root (Stage D Phase 1, M2). company_code & base_currency_code immutable. Deactivate via status; never hard-delete.';

create trigger companies_set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

-- ── branches — company-owned operational units ────────────────────────────────
create table public.branches (
  id           uuid primary key default public.uuidv7(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  branch_code  text not null,
  name         text not null,
  status       text not null default 'Active' check (status in ('Active', 'Suspended', 'Archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, branch_code)
);
comment on table public.branches is 'Company-owned operational unit (Stage D Phase 1, M2). company_id/branch_code immutable. Deactivate via status; never hard-delete.';
-- No standalone index on company_id: the UNIQUE(company_id, branch_code) composite already serves company_id-prefix scans (B3).

create trigger branches_set_updated_at before update on public.branches
  for each row execute function public.set_updated_at();

-- ── Row-Level Security: deny-by-default, no authenticated access ──────────────
-- Memberships (M3), resolver (M4) do not exist yet, so no member-scoped policy can be expressed.
-- M2 is deny-all: RLS enabled+forced, no authenticated policy. Member-scoped policies arrive in M4
-- (expand→migrate→contract). USING(true) and any interim fake-membership logic are forbidden.
alter table public.companies enable row level security;
alter table public.companies force row level security;
alter table public.branches  enable row level security;
alter table public.branches  force row level security;

-- ── Privileges: deny-by-default, then grant minimally ─────────────────────────
revoke all on public.companies from public, anon, authenticated, service_role;
revoke all on public.branches  from public, anon, authenticated, service_role;

-- authenticated & anon: NO access until M4 introduces member-scoped policies.
-- service_role (governed bootstrap/admin path; RLS-exempt): create + read + update mutable fields only.
-- Column-scoped UPDATE enforces immutability of company_code / base_currency_code / branch_code / id at the privilege layer.
grant select, insert on public.companies to service_role;
grant update (name, status) on public.companies to service_role;
grant select, insert on public.branches to service_role;
grant update (name, status) on public.branches to service_role;
-- No DELETE / TRUNCATE to any role (no hard delete). FK on delete restrict prevents cascade orphaning.
