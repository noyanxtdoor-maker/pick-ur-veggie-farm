# Stage C8 — Enterprise Implementation Sequence & Module Construction Roadmap

**Type:** Stage C engineering-preparation artifact (binding design spec) · **Status:** In force (design); governs Stage D execution
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Authority basis:** ODR-004 (precedence), `18.05` (DB order), `27.03` (migration sequence), B1–B8, Section 26 (`26.08` dependency map), [C2](Stage_C2_Supabase_Enterprise_Foundation_and_Infrastructure_Boundaries.md), [C3](Stage_C3_Database_Migration_Governance_and_Schema_Evolution.md), [C6](Stage_C6_CI_CD_Quality_Gates_and_Automated_Architecture_Enforcement.md), [C7](Stage_C7_Engineering_Constitution.md), ADR-001, ODR-001…005.
**Scope note:** design specification only. **No source code, migrations, tables, components, APIs, Supabase projects; no changes to existing architecture docs or locked designs.**

> Stage A answered *who has authority.* Stage B answered *what foundations must exist.* Stage C7/C4/C1/C5/C6/C2/C3 answered *how developers cannot break them.* **C8 answers *in what order we build, so the first line of code is already building the final enterprise system — not another prototype.***

---

## 0. The construction failure this roadmap prevents, and assumptions rejected

**Rejected model:** *"Build screens and modules in parallel and integrate later."* That produces duplicate logic, inconsistent security, conflicting data models, incompatible workflows, and technical debt.

**Correct model — each layer stable before the next depends on it:**
```
Enterprise Foundation → Shared Infrastructure → Core System Records →
Operational Engines → Financial Engines → Reporting & Intelligence → Optimization & Expansion
```

**Assumptions challenged:**
1. **"Add security, audit, and performance after the MVP." — FALSE.** For an ERP these are *foundations*, not enhancements (built in Phase 1, §4).
2. **"More developers ⇒ build everything at once." — FALSE.** Parallelism is allowed *on a shared foundation*, never as competing foundations (§11).
3. **"A module is done when screens save data." — FALSE.** Done = security + audit + offline + performance + financial reconciliation + contracts + docs (§12).

## 1. Implementation authority hierarchy

```
ADR / ODR → Enterprise Architecture (10–26) → B1–B8 Foundation Specs →
Stage C Engineering Controls (C1–C7) → Implementation Roadmap (C8) → Stage D Development
```

**C8 organizes execution; it does not replace architecture authority.** A phase's *order* may not be reinterpreted by convenience; resequencing is an architectural change (C7 §13 / C4 §7).

## 2. Construction principles

- **Build the deepest dependency first** (`26.08` map; ODR-004 / `18.05` order).
- **Never build a module that requires an unfinished foundation.**
- **No feature-first shortcuts; no temporary architectures destined for rewrite.**
- **Security, audit, and financial integrity are built into the first implementation** — not retrofitted.
- Each phase establishes the **foundation invariants** (B1 RLS, B2 money types, B3 indexes/partition-readiness, B6 append-only audit) so everything built later inherits compliance (C6 §0).

## 3. Phase 0 — Development Foundation

**Entry:** Stage C approved · C7 active · C6 enforcement plan defined · repository governance (C4) active.
**Build:** repository cleanup (rename `react-example`, `.nvmrc`/`engines`, `.env.example` contract — C1 action items) · dev environment · **CI/CD implementation (C6 Tier 1 gates)** · local Supabase environment (C2) · tooling · testing framework (C5: Vitest/Playwright).
**Exit:** developers can build safely · **CI blocks architectural violations** (the C7 §14 / C6 Tier-1 guards run) · local environments are reproducible. *(Also lands the no-float-money guard's prerequisite: the B2 `Money` type — C6 §0.)*

## 4. Phase 1 — Identity, Tenant & Security Foundation

**Entry:** Phase 0 complete.
**Build:** Supabase Auth integration (B7/ODR-003) · user profile model · company model · branch model · permission architecture · `user_branch_roles` · role-permission engine · **RLS implementation (B1, deny-by-default)** · audit framework foundation (B6 append-only).
**Exit:** a user can log in · permissions enforced (permission-based, not role-name) · **cross-company access impossible** · **RLS cross-tenant tests pass (C5 §3 / C6)** · audit events exist. Migrations follow C3 (foundation invariants first).

## 5. Phase 2 — Core Master Data Foundation

**Entry:** security foundation complete.
**Build:** crop catalog · units of measure · equipment registry · supplier records · customer records · employee profiles · farm locations · reference data (seed per C3 §9).
**Exit:** all master records **tenant-owned** (`company_id`/`branch_id`, B1) · CRUD respects permissions · history + audit exist. (B8 master-data migration may load approved V2 data here, under ODR-001.)

## 6. Phase 3 — Operational Ledger Foundation

**Entry:** master data complete.
**Build (physical reality):** inventory movement ledger (B4 source-of-truth) · batch tracking + FIFO structures · stock adjustments (transaction-based) · production activity ledger · work/task records · calendar/scheduling foundations · equipment activity history.
**Critical rule:** do **not** build inventory dashboards before the movement ledger exists (B4 — reports read snapshots, not raw, and the ledger must precede them).
**Financial-boundary rule (reconciliation with ODR-004):** Phase 3 builds operational *events*, but these create **no financial consequences yet** — financial posting is wired in Phase 4 once the accounting engine exists. This honors ODR-004's invariant ("no operational module creates a financial consequence before the accounting foundation exists") and the golden rule that a physical event precedes its financial event (`26.01`). The accounting framework skeleton (CoA + journal/posting engine) may be established at the Phase 3→4 boundary; **automatic posting from these events is a Phase 4 deliverable, not Phase 3.**
**Exit:** every physical action creates a traceable digital event · history immutable · **offline synchronization works · idempotency tests pass (B5 — retry×100 → 1, C5 §6)**.

## 7. Phase 4 — Financial Foundation

**Entry:** operational events are reliable (Phase 3 exit).
**Build:** Chart of Accounts · accounting engine · **journal posting engine (double-entry, B2)** · financial-event integration (the governed posting path from operational events — B6 events/outbox, idempotent B5) · cost allocation · opening balances (new V3 entries, B4/B8 — not migrated history).
**Critical rule:** **no module writes directly to financial tables; all financial impact flows through the accounting engine** (B2/B6/C7 §4/§8; C2 §8 backend boundary).
**Exit:** every financial event balances (**exact debit=credit**, B2) · **money-precision tests pass (no float, C5 §4)** · audit trail exists · reversals work (immutable posted records).

## 8. Phase 5 — Business Modules

**Entry:** security + operational ledger + financial engine + audit + offline are stable.
**Build:** purchasing · sales · production workflows · HR operations · payroll · customer workflows — each built **on** the canonical engines (security, inventory ledger, accounting, audit, offline).
**Exit:** modules use the canonical engines (no duplicated business logic) · **integration-contract tests pass (B6)** · financial impacts post via the accounting engine only · per-module Definition of Done (§12) met.

## 9. Phase 6 — Reporting, Analytics & Intelligence

**Entry:** operational and financial data are trustworthy (Phases 3–5).
**Build:** dashboards · reports · KPI systems · AI advisory features · forecasting · recommendations — reading **snapshots/rollups (B4)**, not raw scans (B3).
**Critical principle:** **AI may advise; AI never becomes the source of truth** and acts only through RLS/permissions/audit (B6 §8 / C7 §11).
**Exit:** reports reconcile with source records (B4 reconciliation) · AI actions remain governed/audited.

## 10. Phase 7 — Optimization, Scale & Production Readiness

**Entry:** complete enterprise workflows exist.
**Build:** performance tuning · partition activation **if triggered** (B3 §5 — not before) · **load testing (executes P4.5-09)** · security testing · **DR drills (B7 §12)** · monitoring/observability (C2 §13) · production hardening.
**Exit:** **ODR-005 scale targets validated** · **RPO/RTO targets validated (B7 §9)** · performance budgets met (B3 §9). This is the Stage E pre-production gate.

## 11. Parallel development rules

**Allowed:** independent features on the **same** foundation (e.g. multiple CRUD screens using the same security model).
**Forbidden:** multiple teams creating **competing foundations** — multiple authentication systems, multiple money-calculation methods, multiple inventory engines. Foundations (Phases 0–4) are built once and shared; parallelism scales within a phase's breadth, never by duplicating the depth below it (`26.08` single-owner rule).

## 12. Definition of module completion

A module is **not** complete because screens exist, forms save, or reports display. It is complete only when: security tests pass (B1) · audit events exist (B6) · offline behavior validated (B5) · performance expectations met (B3) · financial impacts reconcile (B2/B4) · integration contracts pass (B6) · documentation updated (C4). (Extends the C5 §11 Definition of Done to the module level.)

## 13. Stage D authorization gate

Stage D (build) may begin only after: **C8 approved · Stage C formally complete · CI enforcement implementation begun (C6 Tier 1) · development foundation exists (Phase 0).** Stage D must follow the C8 phases; **any deviation requires architectural approval** (C7 §13 / C4 §7). The formal **Stage C Completion & Stage D Readiness Gate** is authored before Stage D begins (see §15).

---

## 14. Consistency check

Reviewed against ADR-001, ODR-001…005, B1–B8, Section 26, C1–C7, `18.05`, `27.03`: C8 introduces **no new authority** and is **consistent with ODR-004** — the one apparent ordering tension (operational ledger vs financial foundation) is resolved in §6 by the financial-boundary rule (operational events build first but post no financial consequence until the Phase 4 engine exists), preserving ODR-004's invariant. No contradictions.

## 15. Findings, status & next step

**Findings:** C8 is the executable build roadmap; it does not *close* findings by itself. Its phases are where the remaining Category-B findings close during Stage D — P5-01 (V3 built, Phases 0–5), P5-03 (do-not-port enforced via C6 guards, Phase 0/1), P5-05 (foundation scaffolded, Phase 0–1), P2-04 (doc-integrity CI, Phase 0), P4.5-07/P3.5-07 (storage lifecycle, Phase 7), P4.5-09 (load tests, Phase 7). **No finding status changed here** (they close on implementation).

**Stage C is now fully specified (C1–C8).** Per the mandate, **Stage D is NOT begun automatically.** The next step is a formal **Stage C Completion & Stage D Readiness Gate**, which must answer: (1) Is the engineering environment ready? (2) Are architecture protections enforceable? (3) Is implementation order defined? (4) Are any remaining audit findings blocking Stage D?

**Verification:** documentation only — no code, migrations, components, APIs, Supabase projects, or changes to existing architecture/locked designs.
