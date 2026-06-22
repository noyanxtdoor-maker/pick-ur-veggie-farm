-- Migration M5 — Immutable Audit Foundation (Stage D Phase 1)
-- Authority: Physical Schema §4.8 · Migration Design M5 · ADS §4 (audit invariant) / §8 (exit gates) ·
--   B6 §3 (append-only enforcement: UPDATE/DELETE denied for every app role at the DB layer; corrections by
--   addition; server-authoritative time; tamper-evidence hash-chain recommended/optional) · B1 (RLS, reads
--   permission-gated) · B3 (lean append-heavy indexes, partition-ready) · C3 (migration governance).
-- Scope (locked): the audit store ONLY — audit_events + its append-only security model + reads via the M4
--   resolver. NO bootstrap (M6), NO seeds, NO business modules, NO auto-auditing of other tables, NO event
--   processors/dashboards. M1–M4 migration files are NOT modified.
-- Risk: High (audit). Rollback: restore-based once audit rows exist — NEVER delete audit; structural reversal
--   is valid only while the table is empty (B6 §3, Migration Design M5).
--
-- Immutability is enforced in THREE independent layers (B6 §3 "mechanism, not convention"):
--   (1) column-scoped INSERT grant → server controls id/server_timestamp/hashes (no client backdating);
--   (2) NO UPDATE/DELETE/TRUNCATE grant to any app role (anon/authenticated/service_role);
--   (3) a trigger that raises on UPDATE/DELETE/TRUNCATE — blocks even the table owner / an admin mistake.
-- The dormant CI guard (db-guards.sql Guard 4) becomes ACTIVE the moment this table exists.

-- ── audit_events — the canonical, append-only security/audit record (§4.8, B6 §3) ──
-- company_id/branch_id/actor_user_id are nullable: platform/pre-tenant events (e.g. failed login) have no
-- tenant or resolved actor. FKs are ON DELETE RESTRICT so a referenced tenant/actor can never be hard-deleted
-- out from under the history (no orphan audit, history survives — Attack 6). The row is self-describing
-- (previous_value/new_value snapshots) so it stays truthful even if a referenced row later changes.
create table public.audit_events (
  id                     uuid primary key default public.uuidv7(),                 -- time-ordered (uuidv7)
  company_id             uuid references public.companies (id) on delete restrict,  -- nullable: platform events
  branch_id              uuid references public.branches (id)  on delete restrict,  -- nullable
  actor_user_id          uuid references public.users (id)     on delete restrict,  -- nullable: unknown for failed auth
  actor_auth_id          uuid,                                                       -- raw auth identity (may be unverified) — no FK
  event_class            text not null check (event_class in ('Security', 'Business', 'System', 'Administrative')),
  event_type             text not null,                                              -- the action performed
  module                 text,                                                       -- source module/system
  entity_type            text,                                                       -- affected record type
  entity_id              uuid,                                                       -- affected record id
  previous_value         jsonb,                                                      -- self-describing before-snapshot
  new_value              jsonb,                                                      -- self-describing after-snapshot
  reason                 text,                                                       -- justification
  approval_reference     text,
  source_idempotency_key text,                                                       -- B5
  server_timestamp       timestamptz not null default now(),                         -- server-authoritative (NOT client-set; see INSERT grant)
  prev_hash              text,                                                       -- tamper-evidence chain (B6 §3, population deferred)
  record_hash            text,
  -- Actor attribution (Attack 3): an actioned event must name an actor; only System/Security events (e.g. a
  -- failed login with no known user, a background job) may be actor-less.
  constraint audit_actor_attribution check (
    actor_user_id is not null or actor_auth_id is not null or event_class in ('System', 'Security')
  )
);
comment on table public.audit_events is 'Canonical append-only audit record (Stage D Phase 1, M5; B6 §3). INSERT-only — no UPDATE/DELETE/TRUNCATE for any app role (grants + trigger). server_timestamp is server-set. Reads permission-gated via the M4 resolver. Partition-ready (server_timestamp + company_id); partitioning activated later on a B3 §5 trigger.';

-- Forensic indexes (§4.8; carried from day one because retro-indexing a grows-forever table is costly, B3 §5):
--   tenant + time-range, and entity lookup. Actor-search index is deferred until an audit-query feature exists.
create index audit_events_company_branch_time_idx on public.audit_events (company_id, branch_id, server_timestamp);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

-- ── Immutability trigger (layer 3) — append-only, enforced even against the table owner ──
create function public.audit_events_block_modify() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only (B6 §3): % is not permitted; correct history by adding events', tg_op
    using errcode = 'restrict_violation';
end;
$$;
comment on function public.audit_events_block_modify() is 'Append-only enforcement (B6 §3): raises on UPDATE/DELETE/TRUNCATE of audit_events. Corrections are new events.';

create trigger audit_events_no_update_delete
  before update or delete on public.audit_events
  for each row execute function public.audit_events_block_modify();

create trigger audit_events_no_truncate
  before truncate on public.audit_events
  for each statement execute function public.audit_events_block_modify();

-- ── Row-Level Security: append-only, reads permission-gated (B1, B6 §3) ──────
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

-- Deny-by-default, then grant precisely. NO UPDATE/DELETE/TRUNCATE to anyone (immutability layer 2).
revoke all on public.audit_events from public, anon, authenticated, service_role;

-- authenticated: read only, gated by the 'audit.read' permission for the row's company (M4 resolver). Platform
-- events (company_id IS NULL — e.g. failed logins) are NOT visible to tenant users; only the server/operators.
grant select on public.audit_events to authenticated;
create policy audit_events_select_permitted
  on public.audit_events for select to authenticated
  using (company_id is not null and public.has_permission(company_id, 'audit.read'));

-- service_role (governed server write path; RLS-exempt): read + column-scoped INSERT. The excluded columns
-- (id, server_timestamp, prev_hash, record_hash) are server-controlled → the writer cannot forge time or id.
-- NO update/delete grant → service_role can append but never rewrite history (Attack 5).
grant select on public.audit_events to service_role;
grant insert (
  company_id, branch_id, actor_user_id, actor_auth_id, event_class, event_type, module,
  entity_type, entity_id, previous_value, new_value, reason, approval_reference, source_idempotency_key
) on public.audit_events to service_role;
-- No INSERT/UPDATE/DELETE policy for authenticated; audit is written only by the governed server (service_role).
