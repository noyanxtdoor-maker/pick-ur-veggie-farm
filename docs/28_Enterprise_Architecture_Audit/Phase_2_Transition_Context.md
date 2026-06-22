# Phase 2 — Minimum Viable ERP · Transition Context

**Type:** Transition / kickoff context (documentation only — **no schema, no migration, no code**) · **Date:** 2026-06-22
**Branch:** `feature/phase-0-foundation` · **Predecessor:** `Stage_D_Phase_1_Context_Reset_Handoff.md`

> This records the **direction** for Phase 2 and the **foundation it inherits**. It is not a specification and
> contains no DDL, RLS, functions, or APIs. Building Phase 2 requires **separate explicit authorization** and
> proceeds under the existing authority chain (ADR/ODR → architecture → Stage A → B1–B8 → C1–C8 → CLAUDE.md).
> **First action at Phase 2 kickoff:** reconcile the formal stage/phase numbering with `Master_Execution_Roadmap.md`
> (this doc does not presume a stage label), and confirm/author the Phase 2 design chain (ADS → Conceptual →
> Physical → Migration design) before any migration, exactly as Phase 1 did.

## 0. Status at handoff

**Phase 1 — Core Platform Foundation is COMPLETE (6/6, all CI-verified & locked):**

```
M1 Identity Foundation        ✅ LOCKED (#11)
M2 Tenant Foundation          ✅ LOCKED (#13)
M3 Authorization Foundation   ✅ LOCKED (#15)
M4 Resolver + Tenant RLS      ✅ LOCKED (#17)
M5 Immutable Audit Foundation ✅ LOCKED (#19)
M6 Controlled Bootstrap       ✅ LOCKED (#21)
████████████████████ 100%
```

The security foundation is done: identity (auth-separated), tenant ownership, permission-based authorization,
deny-by-default resolver-driven RLS, append-only audit, and a one-time controlled bootstrap.

## 0.1 Phase 2 — module build progress

| Module | Status | Migration | CI |
|---|---|---|---|
| **M1 — Organization Setup** (DB authorization+data layer) | ✅ **LOCKED** | `a26b667` · `…_p2m1_organization_setup.sql` | **run #23 — all green** |
| M1B — V3 Application Architecture (design-only) | ⏳ **next** | — (no migration) | — |
| M1C — Organization Setup UI | ⬜ pending 1B lock | — | — |
| Crop Management · Inventory · Daily Operations · Basic Reports | ⬜ Phase 2 backlog | — | — |

**M1 lock record (GitHub run #23, commit `a26b667`).** Clean-runner CI audited from owner screenshots + `ci.yml`
+ `package.json` (this env cannot fetch Actions — handoff §8). `verify` (npm ci · `tsc --noEmit` · `vitest` ·
`vite build`) green; `secrets` (gitleaks full-history, no leaks) green; `db-guards` (`supabase start` 2m19s →
`db reset` 37s rebuilding **M1→M2→M3→M4→M5→M6→P2-M1** [7 migrations] → `guard:static` → `guard:db` → `guard:rls`
→ `guard:bootstrap` → **`guard:org` [NEW step "Organization security tests…", 13 behavioral assertions]** →
`guard:drift` → stop) green — no skips, no `continue-on-error`, no `|| true`, realistic non-cached timings; the
only annotation is the known non-blocking Node-20 deprecation (handoff §11). **`guard:org`
(`scripts/guards/org-security.sql`) is now a permanent blocking CI gate**, joining static/db/rls/bootstrap/drift.
M1–M6 migrations unchanged (each still last-touched at its locked hash). The Module-1 diff added exactly four
things: the `p2m1` migration, `org-security.sql`, and the two CI wiring lines (`ci.yml` step + `package.json`
script).

**What M1 delivered (the first authenticated-driven WRITE model — Phase 1 had no authenticated writes):**
resolver-gated company/branch/role/`role_permissions`/membership mutations (column-scoped grants keep identifiers
immutable; M3 composite FKs force same-company); the `invitations` table (single-use, expiring, company/branch/
role-scoped capability tokens) + `invite_user()` / `accept_invitation()` SECURITY DEFINER functions
(`search_path=''`, audited); and +5 permission keys (`company.manage`, `branch.manage`, `role.manage`,
`user.invite`, `membership.manage`) added additively to the M6 catalog.

**Next:** Module **1B — V3 Application Architecture** (design-only decision document → owner review → lock)
*before* any UI module — produces `Phase_2_M1B_V3_Application_Architecture.md` (the authority for Module 1C UI
and every later Phase-2 UI module).

## 1. Phase 2 goal

Create the **first usable farm management system** — the minimum set of operational modules that lets a real
farm run on the platform, built strictly on the locked Phase-1 foundation.

## 2. Starting modules

1. **Organization Setup** — company setup flow · branch setup flow · user invitations · role assignment.
2. **Crop Management** — crop catalog · planting cycles · harvest records.
3. **Inventory** — seeds · fertilizers · pesticides · farm supplies.
4. **Daily Operations** — tasks · worker assignments · activity logs.
5. **Basic Reports** — yield history · inventory status · production tracking.

*(Module scope/sequencing is indicative; the authoritative ordering is `Master_Execution_Roadmap.md` / C8.)*

## 3. Non-negotiable inheritance from Phase 1 (every Phase-2 table/feature)

- **Tenant ownership** — every operational table carries `company_id` (+ `branch_id` where branch-scoped); no
  tenant-ambiguous operational table (the `db-guards` tenant-ownership check enforces this).
- **RLS in the same migration** — deny-by-default; policies **call the M4 resolver**
  (`accessible_company_ids()` / `has_permission(company_id, key)` / `current_app_user_id()`), never re-derive
  access and **never read a role name** (the `no-role-name-auth` static guard + C7 §0).
- **Branch-level isolation now lands** — Phase 2 introduces the first branch-owned operational data, so the
  deferred `is_branch_member()` resolver predicate (handoff §11 M4 carryover) is implemented here (B1 §2).
- **Permissions are data** — new capability keys are **added to the M6 permission catalog** (additive) and gate
  the new operations; the Owner/role assignments evolve by data, not by new authorization architecture.
- **Audit everything meaningful** — business actions write `audit_events` (M5), which remains append-only and
  immutable; corrections are new events, never edits.
- **Money readiness** — no money tables until Phase 4; when they arrive they use the fixed-precision `NUMERIC`
  standard (B2) — the `no-float-money` guard is already active.
- **Offline/idempotency** — business writes reserve the tenant-scoped `(company_id, idempotency_key)` pattern (B5).

## 4. Cadence (unchanged — the proven loop)

```
Design (per the Phase-2 design chain) → Implement migration → Attack it locally (db reset + adversarial)
  → Guards green → Commit → Push → Independent GitHub CI → Lock → Next module
```

Each Phase-2 migration PR carries the full guard suite — `guard:static`, `guard:db`
(rls-enabled · tenant-ownership · audit-immutability), `guard:rls` (extend with **cross-tenant negative tests
per new entity**, C5 §3 / B1 §9 — a **blocking** gate), `guard:bootstrap`, `guard:drift` — and is CI-verified on a
clean runner before locking. M1–M6 migrations remain **locked and unmodified**.

## 5. Recommended actions before building Phase 2 (owner decisions)

- **Open the PR** `feature/phase-0-foundation → develop` to merge the completed Phase-1 foundation (the
  compensating-control flow; handoff §8). New Phase-2 work then branches from the updated base.
- **Confirm the Phase-2 design chain exists** (ADS/Conceptual/Physical/Migration design) or authorize authoring it.
- **Resolve the open follow-ups** that Phase 2 touches (handoff §11): Identity Lifecycle Policy (invitations/leaver
  flow feed Organization Setup), and the permission-catalog growth path.

**This document is context only. No Phase-2 schema, migration, or code is created until explicitly authorized.**
