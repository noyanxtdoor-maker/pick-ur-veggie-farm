-- Migration M1 — Identity Foundation (Stage D Phase 1)
-- Authority: Phase 1 Physical Schema §4.3 · B1 (RLS, deny-by-default) · B7 (identity; credentials only in Supabase Auth) · C3 (migration governance).
-- Scope (locked): ERP business identity ONLY. No companies/branches, roles/permissions/memberships,
--   resolver, audit, bootstrap, or business modules (those are M2–M6).
-- Risk: High (identity). Rollback: reversible while empty; restore-based once identities exist.

-- ── UUIDv7 generator ──────────────────────────────────────────────────────────
-- Client-generatable + time-ordered identifiers (B5 offline-first; B3 index locality;
-- enumeration-resistant, B1). PG17 has no native uuidv7(); pgcrypto supplies the random source.
create extension if not exists pgcrypto;

create or replace function public.uuidv7() returns uuid
language sql volatile
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
                from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid;
$$;

comment on function public.uuidv7() is 'RFC 9562 UUIDv7 (time-ordered). Canonical primary-key generator; ids may also be client-generated offline (B5).';

-- ── ERP business identity ─────────────────────────────────────────────────────
-- Distinct from auth.users. Holds NO credentials/MFA/sessions/provider data (those live in Supabase Auth, B7).
create table public.users (
  id             uuid primary key default public.uuidv7(),
  auth_user_id   uuid not null unique references auth.users (id) on delete restrict,
  display_name   text,
  account_status text not null default 'Active' check (account_status in ('Active', 'Suspended')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.users is 'ERP business identity (Stage D Phase 1, M1). Separate from auth.users; no credentials. Deactivate via account_status; never hard-delete.';

-- Partial index for the common "active identities" filter (B3 §3).
create index users_active_idx on public.users (account_status) where account_status = 'Active';

-- ── Row-Level Security: deny-by-default + interim own-row policies ─────────────
-- Deny-by-default (B1 §1). Resolver-based / company-admin policies are added in M4 (expand→migrate→contract).
-- No INSERT/DELETE policy: identity creation flows through the governed bootstrap/server path (M6), not direct client writes.
alter table public.users enable row level security;
alter table public.users force row level security;

-- Privileges: deny-by-default. Supabase default privileges over-grant (incl. TRUNCATE, which bypasses RLS),
-- so revoke everything first, then grant precisely.
revoke all on public.users from public, anon, authenticated, service_role;
grant select, update on public.users to authenticated;            -- RLS gates these to the own row
grant select, insert, update on public.users to service_role;     -- governed server/bootstrap path (RLS-exempt); no delete/truncate (no hard delete)

create policy users_select_own
  on public.users for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy users_update_own
  on public.users for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));
