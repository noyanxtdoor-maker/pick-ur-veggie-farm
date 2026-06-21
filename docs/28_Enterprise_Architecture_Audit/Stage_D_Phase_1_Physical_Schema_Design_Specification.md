# Stage D — Phase 1 Physical Schema Design Specification

**Type:** Phase 1 physical schema blueprint (target schema; no SQL / no migrations) · **Status:** In force (design)
**Date:** 2026-06-21 · **Branch:** `feature/phase-0-foundation`
**Obeys:** [Phase 1 ADS](Stage_D_Phase_1_Architectural_Design_Specification.md), [Conceptual Schema](Stage_D_Phase_1_Schema_Design_Specification.md), [B1](Stage_B1_RLS_Specification.md), [B2](Stage_B2_Money_and_Financial_Precision_Specification.md), [B3](Stage_B3_Indexing_Partitioning_Scalability_Specification.md), [B6](Stage_B6_Audit_Immutability_and_Integration_Contracts_Specification.md), [B7](Stage_B7_Authentication_Hardening_and_Disaster_Recovery_Specification.md), [C3](Stage_C3_Database_Migration_Governance_and_Schema_Evolution.md), C5–C8.

## 0. Authority & Purpose

This document defines the **target physical schema** for Stage D Phase 1. It has **no independent architectural authority**; the ADS, Conceptual Schema, B-series, and C-series remain authoritative; ADR/ODR are supreme. **If it conflicts with any higher authority, the higher authority is correct and this document is corrected.** It defines no new security/governance principles.

It is the bridge: `Conceptual Schema → Physical Schema (this) → Migration design (C3) → SQL`. It **contains no** SQL/DDL, migration files/ordering, Supabase configuration, seed scripts, RLS policy code, API, or UI. It specifies tables, columns, types, keys, constraints, indexes, and partition-readiness — the *target*, not the *migration*.

## 1. Physical schema philosophy
Deny-by-default tenancy, permission-based authorization, append-only audit, and offline-first identifiers are built into the **first** tables (C8 §2). Every operational table carries its tenant key and ships with its RLS in the **same** migration (B1 §2, C3 §4).

## 2. Locked decisions implemented
1. **Identity separation** — `auth.users` (Supabase) owns credentials/MFA/sessions/providers; ERP `users` owns business identity and links by the **stable auth id**; no credential columns in ERP.
2. **Primary keys — UUID, variant UUIDv7.** Globally unique, client-generatable (offline-first, B5), non-sequential. **v7 chosen over v4** for **time-ordered index locality** on append-heavy tables (audit), while remaining non-guessable for enumeration resistance (B1). Generation source (DB function vs client) is a migration detail; the type/variant is fixed here. (B3 §3 "UUID primary keys".)
3. **Tenant ownership** — every operational table declares it (Company / Branch); no tenant-ambiguous operational table.
4. **Permission-based authorization** — relational `roles` / `permissions` / `role_permissions`; role-name authorization forbidden.
5. **Append-only audit** — `audit_events` INSERT-only; UPDATE/DELETE denied for every role.
6. **Account lifecycle** — `account_status` participates in authorization; soft lifecycle (no hard delete).
7. **No floating-point money** — recorded standard (§9); Phase 1 builds no money tables.

## 3. Conventions
- snake_case tables/columns; `_id` keys; `_at` timestamps (**`timestamptz`, server-set**); `_status` lifecycle; `_code`/`_key` business identifiers.
- Status fields use a constrained domain (enum-style check), values listed per table.
- Snapshots use `jsonb`. No money columns in Phase 1; when money arrives it uses the single canonical Money type (§9), never float.
- ERP `users` lives in the application schema and is **distinct from** `auth.users`.

## 4. Table specifications

> Types are conceptual-physical (Postgres). Columns shown as **name · type · notes**. PK = primary key; FK = foreign key; UQ = unique constraint.

### 4.1 `companies` — tenant root · ownership: company · growth: Low
| Column | Type | Notes |
|---|---|---|
| id | UUID (v7) | PK |
| company_code | text | UQ (global, B3 §3) |
| name | text | |
| base_currency_code | text | default `'PHP'` (B2 §3; currency-ready, constrained to base in V1) |
| status | text | {Active, Suspended, Archived} — deactivate, never delete |
| created_at / updated_at | timestamptz | server-set |

PK `id` · UQ `company_code` · **RLS:** company-owned (a user sees only companies they belong to). Audited.

### 4.2 `branches` — ownership: company · growth: Low
| Column | Type | Notes |
|---|---|---|
| id | UUID (v7) | PK |
| company_id | UUID | FK→companies, NOT NULL (**tenant key**) |
| branch_code | text | UQ per company |
| name | text | |
| status | text | {Active, Suspended, Archived} |
| created_at / updated_at | timestamptz | |

PK `id` · FK `company_id` · UQ `(company_id, branch_code)` · index `(company_id)` · **RLS:** company-owned + branch assignment.

### 4.3 `users` — ERP business identity · ownership: personal + company-admin · growth: Low
| Column | Type | Notes |
|---|---|---|
| id | UUID (v7) | PK (the stable **business** id referenced by memberships + audit) |
| auth_user_id | UUID | UQ; logical link to `auth.users.id` (stable auth id). **No credential/MFA/session columns.** |
| display_name | text | business identity |
| account_status | text | {Active, Suspended} (B1 §3) |
| created_at / updated_at | timestamptz | |

PK `id` · UQ `auth_user_id` · partial index on `account_status` · **RLS:** personal (a user reads/updates own row, matched via `auth_user_id = auth.uid()`) **+** company-scoped administrative read by permission (resolved via `user_branch_roles`). *Not* itself company-keyed — one identity may hold memberships in several companies.

### 4.4 `user_branch_roles` — membership · ownership: company/branch · growth: Low–Medium
| Column | Type | Notes |
|---|---|---|
| id | UUID (v7) | PK |
| user_id | UUID | FK→users, NOT NULL |
| company_id | UUID | FK→companies, NOT NULL (**tenant key**) |
| branch_id | UUID | FK→branches, NOT NULL (**tenant key**, branch-scoped) |
| role_id | UUID | FK→roles, NOT NULL |
| assignment_status | text | {Active, Expired} |
| expires_at | timestamptz | nullable (time-boxed assignments) |
| created_at / updated_at | timestamptz | |

PK `id` · UQ `(user_id, company_id, branch_id, role_id)` (no duplicate assignment) · index `(user_id)` and composite `(company_id, branch_id, user_id)` (B3 §3 — RLS derivation) · partial on `assignment_status` · **RLS:** company-owned (branch-scoped). Integrity: `branch_id` must belong to `company_id`.

### 4.5 `roles` — ownership: company · growth: Low
| Column | Type | Notes |
|---|---|---|
| id | UUID (v7) | PK |
| company_id | UUID | FK→companies, NOT NULL (**tenant key**) |
| role_key | text | UQ per company (label/grouping — **never** an authorization key) |
| description | text | |
| status | text | {Active, Deprecated} — deprecate, never delete |
| created_at / updated_at | timestamptz | |

PK `id` · FK `company_id` · UQ `(company_id, role_key)` · **RLS:** company-owned. Roles may begin from system-default sets seeded per company at bootstrap.

### 4.6 `permissions` — global/system reference catalog · ownership: global · growth: Low
| Column | Type | Notes |
|---|---|---|
| id | UUID (v7) | PK |
| permission_key | text | UQ (global) — the **authorization enforcement key** |
| description | text | |
| status | text | {Active, Deprecated} |
| created_at / updated_at | timestamptz | |

PK `id` · UQ `permission_key` · **RLS:** global/system reference — read-all-authenticated; writes are system/developer-only (no tenant writes). Seeded idempotently (system reference data, C3 §9). **No `company_id`** (the capability catalog is system-defined; *which roles grant which* is tenant-scoped via §4.7).

### 4.7 `role_permissions` — role→permission mapping · ownership: company · growth: Low
| Column | Type | Notes |
|---|---|---|
| id | UUID (v7) | PK |
| company_id | UUID | FK→companies, NOT NULL (**tenant key**, denormalized for index-served RLS, B3 §8) |
| role_id | UUID | FK→roles, NOT NULL |
| permission_id | UUID | FK→permissions, NOT NULL |
| created_at | timestamptz | |

PK `id` · UQ `(role_id, permission_id)` · index `(company_id, role_id)` · **RLS:** company-owned. Integrity: `company_id` must equal `roles.company_id`.

### 4.8 `audit_events` — security/audit record · ownership: tenant-scoped · growth: **Extreme** (partition-ready)
| Column | Type | Notes |
|---|---|---|
| id | UUID (v7) | PK (time-ordered) |
| company_id | UUID | nullable (platform/pre-tenant security events e.g. failed login); set for tenant-scoped events |
| branch_id | UUID | nullable |
| actor_user_id | UUID | FK→users, nullable (unknown for failed auth) |
| actor_auth_id | UUID | the auth identity, when ERP user not yet resolved |
| event_class | text | {Security, Business, System, Administrative} (B6 §2) |
| event_type | text | action performed |
| module | text | source module/system |
| entity_type / entity_id | text / UUID | affected record |
| previous_value / new_value | jsonb | **self-describing snapshots** (truthful independent of mutable rows) |
| reason | text | justification |
| approval_reference | text | nullable |
| source_idempotency_key | text | (B5) |
| server_timestamp | timestamptz | **server-authoritative** time (B5) |
| prev_hash / record_hash | text | tamper-evidence hash-chain (B6 §3, recommended) |

PK `id` · **INSERT-only; no UPDATE/DELETE for any role** (enforced by RLS having no update/delete policy + a DB-level guard) · indexes `(company_id, branch_id, server_timestamp)` and `(entity_type, entity_id)` (forensic), kept lean (append-heavy, B3 §3) · **partition-ready:** partition key `server_timestamp` (range/time) + `company_id`, carried from day one (B3 §5). Reads permission-gated; corrections by addition only.

## 5. Relationship integrity
```
companies ──< branches
companies ──< roles ──< role_permissions >── permissions (global)
companies ──< user_branch_roles >── users ──(auth_user_id)── auth.users (Supabase)
                    │
                 branches, roles
audit_events ──(self-describing; references users/tenant by stable id, snapshots values)
```
- **Referential integrity enforced** for all live operational relationships (FKs above).
- **No hard delete** + **soft lifecycle** ⇒ FK targets are deactivated/deprecated, never removed ⇒ references never dangle.
- **Audit** references by stable id **and** stores value snapshots ⇒ stays truthful even after referenced rows change.

## 6. Lifecycle & historical integrity
| Entity | Delete? | Strategy |
|---|---|---|
| users / companies / branches | No | **deactivate** (`status`/`account_status`); attribution preserved (B7 §6) |
| roles / permissions | No | **deprecate** (`status`); audit references stay meaningful |
| audit_events | **Never** (no UPDATE/DELETE) | append-only; corrections = new events (B6 §3) |

`account_status` participates in authorization (suspension cuts access on next request — B1 §3); removing roles is not suspension.

## 7. RLS preparation (no SQL)
| Table | RLS | Policy class (B1 §4) | Tenant column(s) |
|---|---|---|---|
| companies | Yes | company-owned | id (membership) |
| branches | Yes | company-owned + branch | company_id |
| users | Yes | personal + company-admin | (via auth_user_id / membership) |
| user_branch_roles | Yes | company-owned (branch) | company_id, branch_id |
| roles | Yes | company-owned | company_id |
| permissions | Yes | global/system reference | — (read-all-authenticated) |
| role_permissions | Yes | company-owned | company_id |
| audit_events | Yes | append-only, tenant-scoped, read permission-gated | company_id, branch_id |

**Every operational table's RLS is created in the same migration as the table** (deny-by-default; B1 §1, C3 §4). Authorization decisions derive from the **centralized resolver** (membership → role → permissions); policies call it, never re-derive or check role names.

## 8. Index & scalability strategy (B3)
- **Tenant-leading composite indexes** on every operational table (`(company_id, …)` / `(company_id, branch_id, …)`) so RLS predicates are index-served (B3 §3/§8).
- `user_branch_roles`: `(user_id)` + `(company_id, branch_id, user_id)` for resolver lookups; resolver helpers marked stable/cacheable per statement (B3 §8).
- **Partial indexes** on `account_status` / `assignment_status` / `status` for the common "active only" filter.
- **Tenant-scoped uniqueness** (company_code global; branch_code per company; role_key per company; permission_key global).
- `audit_events`: lean `(company_id, branch_id, server_timestamp)` + `(entity_type, entity_id)`; **Extreme tier → partition-ready now, partition-activated only on a B3 §5 trigger.**
- Growth tiers: companies/branches/users/roles/permissions/role_permissions = **Low**; audit_events = **Extreme**. Pagination = keyset with mandatory tenant filter (B3 §6).

## 9. Money readiness standard (B2 — no money tables in Phase 1)
When money arrives (Phase 4): a single canonical **Money** type — fixed-precision decimal `NUMERIC(18,2)` scale-2 for amounts; scale-4 for rates; scale-3 for quantities; scale-6 FX (dormant). **Float is forbidden** for any monetary value (B2 §1/§2). Recorded now so the **no-float-money CI guard** is active from migration #1 and Phase 4 inherits the standard. No money columns are defined in Phase 1.

## 10. Tier-2 CI guard alignment (with migration #1)
This design supports, and the first migration's PR must bring: **RLS-enabled on every operational table** · **tenant-ownership present** · **no role-name authorization** · **audit immutability (no UPDATE/DELETE)** · **no floating-point money** · **migration-drift detection** (C3 §12, C6 §8).

## 11. Five-year validation
At 1,000 farms / millions of records / many countries & providers / employees / accountants / auditors / AI agents / offline devices: growth = **more rows, tenants, permissions, modules**. UUIDv7 ids support offline generation + index locality; tenant keys + RLS hold isolation; relational permissions evolve by data; append-only partition-ready audit absorbs volume; providers link to existing identities. **No redesign of identity, tenancy, authorization, audit, or money representation. PASS.**

## 12. Migration boundary
This document defines the **target schema only**. It contains no SQL/DDL, migration files/names/ordering, Supabase configuration, seed scripts, RLS policy code, APIs, services, or UI. Migration design proceeds separately under **C3 governance** (version-controlled, deterministic, Local→Test→Staging→Prod, rollback strategy declared; money/RLS/audit/tenancy migrations are always High-risk review).
