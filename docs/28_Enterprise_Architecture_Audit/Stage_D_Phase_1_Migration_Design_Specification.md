# Stage D — Phase 1 Migration Design Specification

**Type:** Phase 1 migration plan (conceptual; no SQL / no migration files) · **Status:** In force (design)
**Date:** 2026-06-21 · **Branch:** `feature/phase-0-foundation`
**Obeys:** [Physical Schema](Stage_D_Phase_1_Physical_Schema_Design_Specification.md), [Conceptual Schema](Stage_D_Phase_1_Schema_Design_Specification.md), [ADS](Stage_D_Phase_1_Architectural_Design_Specification.md), [B1](Stage_B1_RLS_Specification.md), [B2](Stage_B2_Money_and_Financial_Precision_Specification.md), [B3](Stage_B3_Indexing_Partitioning_Scalability_Specification.md), [B5](Stage_B5_Idempotent_Transactions_and_Offline_Sync_Specification.md), [B6](Stage_B6_Audit_Immutability_and_Integration_Contracts_Specification.md), [B7](Stage_B7_Authentication_Hardening_and_Disaster_Recovery_Specification.md), [C3](Stage_C3_Database_Migration_Governance_and_Schema_Evolution.md), C5–C8.

## 0. Authority & Purpose

This specification records the **approved migration strategy** for Stage D Phase 1. It carries **no independent architectural authority**. The B-series architecture, C-series governance, ADR/ODR, the Phase 1 ADS, Conceptual Schema, and Physical Schema remain authoritative. **If it conflicts with any higher authority, the higher authority is correct and this document is updated.**

It is the bridge: `Physical Schema → Migration plan (this) → executable migration history (under C3)`. It defines **the order migrations occur, why each exists, their dependencies, pre/postconditions, rollback class, risk class, CI attachment, and seed-vs-bootstrap ownership.** It **does not define SQL**.

## 1. Implementation-leakage boundary
**Allowed:** migration identifiers · purpose · dependencies · preconditions · completion conditions · rollback class · risk class · CI requirements · seed classification · bootstrap responsibility · ordering rationale.
**Forbidden:** SQL · `CREATE/ALTER/DROP` · RLS policy code · function/security-definer code · `GRANT` · PostgreSQL syntax · Supabase config · migration file contents · seed scripts · application code · APIs · UI · implementation tasks.
Answers *"what does this migration accomplish and why,"* never *"how is it implemented."* (Entity names referenced from the Physical Schema; structures/types/indexes are **not** restated here.)

## 2. Migration sequence (locked)

Each migration: **Introduces · Depends on · Preconditions · Completion · RLS posture · Rollback · Risk.** (CI guards are PR-level — §4 — not migrations; an optional **M0 prerequisites** migration exists only if DB-side UUIDv7 generation is chosen, otherwise omitted.)

### M1 — Identity Foundation
- **Introduces:** the ERP identity table + its deny-by-default RLS (interim own-row policy).
- **Depends on:** Supabase Auth (external identity provider); the Tier-2 CI guards present in this PR (§4).
- **Preconditions:** Physical Schema authority; Tier-2 guards attached.
- **Completion:** ERP identity exists, linked to the auth identity by stable id; account lifecycle (Active/Suspended) available; **no credential columns**; RLS enabled.
- **RLS posture:** enabled at creation; interim own-row policy (not resolver-dependent).
- **Rollback:** reversible (additive structural).
- **Risk:** High (identity).

### M2 — Tenant Foundation
- **Introduces:** Company (tenant root) + Branch (subdivision) + deny-by-default RLS (interim **deny-all** until M4 grants member-scoped access).
- **Depends on:** M1.
- **Preconditions:** M1 complete.
- **Completion:** tenant ownership established before any business domain; no future tenant retrofit; RLS enabled.
- **RLS posture:** enabled at creation; interim deny-all (the controlled bootstrap, M6, creates the first rows via a governed server-side path).
- **Rollback:** reversible.
- **Risk:** High (tenancy).

### M3 — Authorization Foundation
- **Introduces:** Role, Permission, Role-Permission mapping, and User-Branch-Role membership + deny-by-default RLS.
- **Depends on:** M1 (identity), M2 (tenant); internally, roles/permissions precede their mapping and membership.
- **Preconditions:** M1, M2 complete.
- **Completion:** permission-based authorization model in place; **role-name authorization impossible** (no role-name path exists); RLS enabled.
- **RLS posture:** enabled at creation; interim policies pending resolver.
- **Rollback:** reversible.
- **Risk:** High (authorization).

### M4 — Central Authorization Resolver (+ RLS refinement)
- **Introduces:** the single authorization-decision source (resolver); evolution of M1–M3 interim RLS to **resolver-based** policies.
- **Depends on:** M3 (membership + role-permission mapping).
- **Preconditions:** M1–M3 complete.
- **Completion:** the resolver is the **single** authorization source; every operational table's policy is resolver-based; account status enforced via the resolver; **no duplicate or legacy authorization path remains**.
- **RLS posture:** **expand** (add resolver-based policies) → **migrate** (switch enforcement) → **contract** (remove interim policies) — C3 §7.
- **Rollback:** structurally reversible **but security is never weakened**; forward-fix preferred; restore-based if integrity is at stake.
- **Risk:** High (RLS / authorization).

### M5 — Immutable Audit Foundation
- **Introduces:** the append-only audit store (INSERT-only; UPDATE/DELETE denied for every role; partition-ready) + its RLS (append-only; read permission-gated).
- **Depends on:** M1–M4 (actors/tenant/permissions to attribute and to permission-gate reads).
- **Preconditions:** M1–M4 complete.
- **Completion:** audit exists **before** bootstrap; security events are permanently attributable; append-only and tamper-evidence preserved; server-authoritative time.
- **Rollback:** restore-based (audit is historical; **never delete audit**; structural reversal only valid before any audit rows exist).
- **Risk:** High (audit).

### M6 — Controlled Bootstrap Mechanism
- **Introduces:** the **guarded, one-time, self-disabling** bootstrap capability + a permanent completion guard.
- **Depends on:** M1–M5 + the seeded permission catalog and role template (§3).
- **Preconditions:** M1–M5 complete; seeds applied.
- **Completion:** a bootstrap capability exists that can run **exactly once** (guarded by "no company exists" + a completion flag) and then permanently disables itself.
- **Does NOT create:** Users · Companies · Branches · Owner records — those are **runtime business events** created through the controlled, audited bootstrap flow (not this migration).
- **Rollback:** the mechanism is reversible (structural); once the runtime bootstrap has executed, the created records are application data (restore-based).
- **Risk:** High (identity/tenant via the mechanism).

## 3. Seed governance
**Allowed seeds** (global · idempotent · re-runnable · non-business): permission catalog · system role template · system reference data. Applied **after** their tables exist (permissions catalog after M3).
**Forbidden seeds (forever):** Users · Owner accounts · credentials · Companies · Branches · tenant ownership records. **Reason:** business ownership must originate from audited runtime flows (the controlled bootstrap), never from seed data (C3 §9; B7 §2).

## 4. Tier-2 CI guardrails (attached to Migration #1's PR — none delayable)
1. RLS-enabled verification · 2. Tenant-ownership verification · 3. No-role-name-authorization verification · 4. Audit-immutability verification · 5. No-floating-point-money verification · 6. Schema-drift detection. (C3 §12, C6 §8.) These are **CI, not migrations**; they gate every migration from #1 onward.

## 5. Risk classification
- **High risk (C3 §3 — formal architecture review + explicit rollback classification):** **all of M1–M6** — each affects identity, tenancy, authorization, RLS, audit, historical integrity, or security boundaries.
- **Medium risk:** reference-data seeds (permission catalog, role template).
Under the active **Solo-Founder Enforcement Exception**, "senior review" = owner architecture review + CI until a second authorized reviewer exists (the 0→≥1 trigger).

## 6. Rollback philosophy
Each migration declares one:
- **Reversible** — pure structural additions (provide the reverse).
- **Restore-based recovery** — changes involving historical data or irreversible transformation (recovery = restore backup + reapply safe migrations, not "undo SQL"; C3 §8).
**Permanent rules:** security may **never** be weakened to perform a rollback · audit history is **never** deleted · identity and tenant integrity are **never** compromised.

## 7. Offline & idempotency readiness (B5 — forward contract)
- Future business events use **tenant-scoped idempotency**; the uniqueness pattern **`(company_id, idempotency_key)`** is reserved as the future standard.
- The audit foundation already carries a source idempotency reference.
- Phase 1 **prepares** the foundation; it does **not** implement offline business transactions (no offline business writes exist yet).

## 8. Migration governance rules (C3)
Every migration is **version-controlled** and **deterministic** (same result Local → Test → Staging → Production, in that order, no skipping). High-risk migrations require explicit review. Schema evolution follows **Expand → Migrate → Contract**. A migration is **not** complete merely because the database accepted it — it must preserve the enterprise guarantees, verified by the §4 gates.

## 9. Migration dependency diagram (conceptual)
```
M1 Identity
   ↓
M2 Tenant
   ↓
M3 Authorization (roles · permissions · role-permission · membership)
   ↓
M4 Resolver & RLS refinement (single authorization source)
   ↓
M5 Audit (append-only; before bootstrap)
   ↓
M6 Bootstrap capability (guarded, one-time, self-disabling)
   ↓
Runtime bootstrap (Company #1 · Branch #1 · Owner membership · company roles — app-created, audited)
   ↓
Future business modules
```
Seeds (permission catalog · role template · reference data) apply after their tables (post-M3), idempotently.

## 10. Five-year destruction test
At thousands of farms / multiple countries / multiple identity providers / employees / accountants / auditors / AI agents / offline devices: growth occurs through **additional migrations, permissions, modules, and providers** (expand→migrate→contract; partition activation on a B3 trigger; providers link to existing identities; offline dedup via `(company_id, idempotency_key)`). **No redesign of identity, tenant ownership, authorization model, RLS boundary, audit history, or money correctness. PASS.**

## 11. Migration boundary
This document is the **plan only**. It contains no SQL/DDL, RLS policy code, function code, migration file contents, seed scripts, Supabase config, APIs, or UI. Executable SQL migration implementation proceeds separately under **C3 governance**, with the §4 Tier-2 guards shipping in Migration #1's PR.
