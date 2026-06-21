# Stage D — Phase 1 Schema Design Specification (Conceptual Data Model)

**Type:** Phase 1 conceptual data model (bridge artifact) · **Status:** In force (conceptual; no physical schema / no migrations)
**Date:** 2026-06-21 · **Branch:** `feature/phase-0-foundation`
**Assembles / obeys:** [Phase 1 ADS](Stage_D_Phase_1_Architectural_Design_Specification.md), [B1](Stage_B1_RLS_Specification.md), [B6](Stage_B6_Audit_Immutability_and_Integration_Contracts_Specification.md), [B7](Stage_B7_Authentication_Hardening_and_Disaster_Recovery_Specification.md), [C3](Stage_C3_Database_Migration_Governance_and_Schema_Evolution.md), C5–C8.

## 0. Authority & Purpose

This document records the **conceptual data model** for Stage D Phase 1. It has **no independent architectural authority**. The Phase 1 ADS, B1/B6/B7, and the C-series remain authoritative; ADR/ODR are supreme. **If this document conflicts with any higher authority, the higher authority is correct and this document must be corrected.** It defines **no** new security principles and introduces **no** physical schema.

It is the bridge layer:
```
Architecture (ADS / B / C) → Conceptual Data Model (this document) → Physical Schema → Migrations (C3)
```
It answers: *what entities exist · what each owns · how they relate conceptually · what lifecycle and security boundaries apply · why these are permanent.* It does **not** answer *how PostgreSQL/Supabase implements them.*

## 1. Implementation Boundary (zero leakage)

This document contains **no** SQL, DDL (`CREATE`/`ALTER`), PostgreSQL/Supabase syntax, RLS policy code, functions, **column names, data types, key strategies (e.g. UUID vs integer), foreign-key/constraint/index/partition definitions, table-naming conventions**, migration filenames/ordering/rollback, or any API/route/service/repository/UI. Those belong to physical schema and migration design under C3. Tenant ownership and relationships below are expressed **conceptually** (e.g., "owned by a Company"), never as physical fields.

## 2. Entity Set (the eight Phase 1 entities)

### 2.1 Company
- **Purpose:** the **tenant root** — the top of every ownership chain.
- **Owns:** company-scoped configuration and, transitively, all operational data of its branches.
- **Never owns:** another company's data; authentication credentials.
- **Permanent because:** every operational entity inherits company ownership; introducing the tenant root after operational data exists forces a destructive backfill + retroactive RLS across every table.

### 2.2 Branch
- **Purpose:** the sub-tenant operational scope within a company.
- **Owns:** branch-scoped operational records.
- **Relationship:** belongs to exactly one Company.
- **Never owns:** company-global data; cross-company data.
- **Exists even with one farm because:** branch-scoped ownership and per-branch authority are structural; retrofitting the branch dimension onto branch-owned data later is destructive. The single farm is Company #1 → Branch #1.

### 2.3 ERP User
- **Purpose:** the **business identity** — the stable, provider-independent actor referenced by memberships and audit.
- **Owns:** business identity, account lifecycle status, and the link to its authentication identity.
- **Never owns:** passwords, credentials, MFA factors, sessions, or provider identities — **these belong only to Supabase Auth.**
- **Permanent because:** decoupling business identity from the auth provider keeps lifecycle, audit attribution, and future providers stable; collapsing it into the provider record causes an identity migration later.

### 2.4 User-Branch-Role
- **Purpose:** the **membership** that binds an identity to authority within a tenant scope.
- **Owns:** the association of one User to one Branch (within its Company) with one Role, plus the assignment's own lifecycle (active/expired).
- **Never owns:** permission definitions; identity; tenant configuration.
- **Preserves the invariant:** **Authenticated ≠ Authorized.** A User may exist with **zero** memberships and therefore **zero** ERP access (orphan identity sees nothing).

### 2.5 Role
- **Purpose:** a **named grouping of permissions** — the assignment abstraction.
- **Owns:** its identity as a bundle; the set of permissions it groups (via §2.7).
- **Never owns:** the authorization decision.
- **Must state:** roles are **labels/groupings**; a role name is **never** an authorization decision.

### 2.6 Permission
- **Purpose:** the **authorization key** — the actual unit evaluated to allow or deny.
- **Owns:** the definition of a discrete capability.
- **Never owns:** identity or tenancy.
- **Permanently forbidden:** role-name authorization, e.g. `if (user.role === "Owner") allow()`. Such a check is an architectural violation; permissions — resolved through the centralized resolver — are the only authorization authority.

### 2.7 Role-Permission Relationship
- **Purpose:** attaches permissions to roles through a **transparent, queryable, evolvable** association.
- **Why a relationship (not an opaque blob):** permission membership must be auditable, evaluable by the authorization model, and able to evolve (add/deprecate permissions) without rewriting roles.
- **Conceptual only:** the physical realization of this association is migration-level and not defined here.

### 2.8 Audit Event
- **Purpose:** the **immutable historical record** of security-sensitive actions — non-repudiation.
- **Owns:** the self-describing facts of an action (actor, scope, before→after, reason, approval, server time, source).
- **Never owns:** mutable current state; analytics or reporting concerns.
- **Must state:** audit history is **append-only**; it is **never** recreated after the fact; corrections occur by **adding** records, never by destroying or rewriting history.

## 3. Conceptual Relationship Model

Cardinality is conceptual only (no foreign keys, cascades, or constraints):

- A **Company** owns **many Branches**; each Branch belongs to **one** Company.
- An **ERP User** links to **one** authentication identity (Supabase Auth) and may hold **many** memberships across companies/branches.
- A **User-Branch-Role** binds **one** User to **one** Branch (within its Company) with **one** Role (a many-to-many of users↔branches, carrying a role).
- A **Role** groups **many Permissions**; a **Permission** may belong to **many** Roles (many-to-many via §2.7).
- Authorization is computed by the **centralized resolver** from membership + role → permissions, never from role names.
- **Audit Events** reference actors/tenant scope by stable identifier but remain **self-describing** so they stay truthful even if referenced records later change.

```
Company ──< Branch
   │           │
   │           └──< User-Branch-Role >── Role ──< Role-Permission >── Permission
   │                      │
ERP User ──(stable link)──┘            (resolver computes permissions; RLS enforces)
Supabase Auth ──(identity)── ERP User
Audit Event ──(self-describing references to actor + tenant)
```

## 4. Security Boundaries (conceptual — B1 §4 policy categories)

For each entity: ownership class · RLS required? · conceptual policy category. **No RLS SQL — boundaries only.**

| Entity | Class | RLS | Conceptual policy category (B1 §4) |
|---|---|---|---|
| Company | tenant root | Yes | company-owned (a user sees only their companies) |
| Branch | company-owned | Yes | company-owned + branch assignment |
| ERP User | identity (personal-read of own record; company-scoped admin access by permission) | Yes | personal + company-owned (per permission) |
| User-Branch-Role | company/branch-owned | Yes | company-owned (branch-scoped) |
| Role | company-scoped (may begin from system-seeded defaults) | Yes | company-owned |
| Permission | system/global reference (the catalog of capabilities) | Yes | global/system reference (read-all-authenticated; defined by the system, not tenants) |
| Role-Permission | company-scoped (which permissions a role grants) | Yes | company-owned |
| Audit Event | security/audit-owned, tenant-scoped | Yes | append-only; read permission-gated; **UPDATE/DELETE denied for every role** |

All operational entities are **deny-by-default**; a table without an RLS boundary is a defect (B1 §1). *(Conceptual nuance: the permission **catalog** is system-defined reference; **which roles exist and what each grants** is tenant-scoped — the physical design must honor both.)*

## 5. Lifecycle Rules

**Account lifecycle.** Minimum Phase 1 states: **Active**, **Suspended**. Authorization evaluation (via the resolver) must consider account status. **Removing roles is not suspension** — suspension cuts existing access on the next request and is a single, clearly audited event.

**Historical integrity.**
- Audit records are **never deleted**.
- Business identities (User, Company, Branch) are **deactivated, not destroyed** (attribution survives).
- Roles and permissions are **deprecated, not erased** (so audit references stay meaningful).
- Historical attribution must survive all future changes.

## 6. Controlled Bootstrap Model (conceptual)

The initial system-ownership process:
- **No default credentials**; **no first-user-wins** ownership.
- The owner **creates their own authentication identity** (Supabase Auth).
- The bootstrap is **authenticated**, executes **exactly once**, and **permanently disables itself** once ownership exists.
- It creates **Company #1, Branch #1, the Owner role assignment** as **business records through the application boundary** (under RLS/audit), and records **immutable audit events**.
- Ownership is never obtained by being the first registrant; no second bootstrap may create ownership.

## 7. Seed Data Classification

**Legitimate seed (framework / reference only):** the role framework · the permission catalog · system reference data. **Conditions:** idempotent · version-controlled · environment-reproducible · **no credentials · no tenant business records.**

**Not seed data:** **Company #1, Branch #1, and the Owner identity are business records** — created by the controlled bootstrap process (§6), never injected as seeds (C3 §9).

## 8. Schema Evolution Boundary

**Permanently locked** (irreversible once real records exist): identity separation · stable identity linkage (ERP identity ↔ auth identity by stable id) · tenant ownership model (Company → Branch) · permission-based authorization · deny-by-default RLS · append-only audit · account-lifecycle enforcement · **no floating-point money values** (B2 — established now so Phase 4 inherits it, though Phase 1 has no money entities).

**May safely evolve** (by addition, under expand→migrate→contract, C3 §7): additional entities · new permissions · new relationships that respect the foundation · performance optimization · future business modules.

## 9. Foundation Dependency Order (conceptual)

Conceptual dependency, **not** migration ordering or task lists:
```
Identity → Tenant → Authorization → Audit → Bootstrap → Future Business Modules
```
(RLS is not a later step — every operational entity carries its deny-by-default boundary from creation; the centralized resolver precedes the policies that call it.)

## 10. Five-Year Compatibility

At thousands of farms, multiple countries, multiple identity providers, employees, auditors, external integrations, and AI-generated code, the model scales by **adding entities, permissions, relationships, and modules** — **never** by replacing identity, tenancy, authorization, or audit history. Providers link to existing identities; tenants and roles are data; AI and external actors pass through RLS + permissions + audit (B6). **Scales by addition, not replacement.**
