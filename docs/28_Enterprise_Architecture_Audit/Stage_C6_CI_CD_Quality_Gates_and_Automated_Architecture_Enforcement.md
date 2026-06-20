# Stage C6 — CI/CD Quality Gates & Automated Architecture Enforcement

**Type:** Stage C engineering-preparation artifact (binding design spec) · **Status:** In force (design); implementation in Stage C6-build/D
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Authority basis:** [C7](Stage_C7_Engineering_Constitution.md) §14 (laws→guards), [C5](Stage_C5_Enterprise_Testing_Architecture.md) §12 (gates), [C4](Stage_C4_Repository_Git_Governance.md) (workflow/risk), [C1](Stage_C1_Development_Environment_and_Toolchain.md) (toolchain), B1–B8, ADR-001, ODR-001…005.
**Scope note:** design specification only. **No GitHub Actions, YAML, CI scripts, lint rule code, `package.json` edits, dependencies, or Supabase config.**

> C7 answered *"what are developers forbidden to break?"* **C6 answers *"how does the system automatically prevent them from breaking it?"*** It converts the C7 §14 matrix and the C5 gates into blocking automation — the automated guardian of everything Stage A/B defined.

---

## 0. Assumptions challenged (feasibility of "lints")

C7 §14 names several checks as "lints." A fresh look shows **not all are pure static lints** — naming the mechanism honestly is required or the guard will be unenforceable:

- **"No-float-money lint" needs a type, not just a regex.** TypeScript represents money, quantities, and counts all as `number`; a linter can't tell them apart. **This guard is only feasible if B2's single canonical `Money` type exists as a branded/opaque type** (e.g. a nominal `Money`/`Decimal` type). The guard then becomes: *money values must be `Money`, arithmetic only via the Money contract; raw `number` in a money position is a type/lint error.* **Dependency: B2 Money type must be implemented first (Stage D foundation).**
- **"RLS-enabled lint" runs against migrations/DB, not TS.** It inspects the schema/migrations to assert every operational table has RLS enabled + policies — a **migration/DB check**, not a source linter.
- **"Idempotency / exactly-once" is a runtime test, not a lint** (retry×100 → 1 effect requires execution against a DB).
- **"Append-only audit" is enforced primarily in the DB** (deny UPDATE/DELETE) and *verified* by a test; the lint only catches obvious app-layer violations.

**Conclusion:** each guard is classified by **mechanism** (§3) — static-lint · type-system · migration/DB-check · runtime-test — and by **when it can first exist** (§8). A guard mislabeled as a cheap lint that actually needs the foundation would create false confidence.

## 1. CI/CD authority model

- **CI is an enforcement mechanism, not a replacement for architecture review.** It mechanically blocks known violations; it does not judge design.
- **Authority sources (unchanged):** C7 = engineering laws; C4 = workflow/merge authority; B1–B8 = technical foundations; ADR/ODR = ratified decisions. CI encodes these; it never overrides them.
- **Passing CI ≠ architectural approval.** A PR that is green but lacks an architecture authority (C4 §4) or touches a High-risk area without senior + architecture review (C4 §5) **does not merge.** Green CI is necessary, not sufficient.

## 2. Pipeline philosophy

Expected stage order (fail-fast — cheapest/most-localized checks first so feedback is fast, C1 §1):

```
Repository validation (secrets scan, lockfile integrity, structure)
        ↓
Formatting standards (Prettier check)
        ↓
Type safety (tsc --noEmit, strict)
        ↓
Architecture lint rules (C7 §14 static guards)
        ↓
Unit tests (money, permissions, validation — C5 §2)
        ↓
Integration tests (RLS, DB, contracts, posting+snapshot — C5)
        ↓
Security validation (cross-tenant denial, no-plaintext — C5 §3)
        ↓
Build verification (vite build)
        ↓
Deployment eligibility (all gates green + C4 approvals satisfied)
```

**Fail-fast:** the first failing stage stops the pipeline and reports clearly; static stages run in seconds so most violations are caught before the expensive DB-backed stages. Pre-push, the same checks run locally (C1 §8 loop) so CI is confirmation, not first discovery.

## 3. Architecture lint / guard enforcement (by forbidden pattern + mechanism)

Each maps to a C7 law and a binding spec. **Mechanism** = how it is actually enforced.

| Forbidden pattern | Authority | Mechanism | Notes / dependency |
|---|---|---|---|
| Floating-point monetary calculation; unauthorized rounding; direct balance manipulation; bypassing the Money contract | **B2** / C7 §4 | **Type-system + lint** | Requires B2 `Money` branded type; raw `number` in money position = error |
| Hardcoded credentials / secrets committed | **B7** / C7 §3 | **Static secret scan** (repository validation stage) | Day-1 feasible; `.gitignore` already excludes `.env*` |
| Plaintext password storage / reversible credential storage | **B7** / C7 §3 | **Lint + review** (no password fields written to DB; Supabase Auth only) | Day-1 lint for obvious cases; review for the rest |
| Role-name string authorization (`role === 'Admin'`) | **B1** / C7 §2 | **Static lint** (ban role-name comparisons; require permission checks) | Day-1 feasible |
| Bypassing tenant authorization; missing `company_id`/`branch_id`; RLS disabled | **B1** / C7 §2 | **Migration/DB check** (every operational table has RLS enabled + tenant columns) + cross-tenant **runtime tests** | Needs schema; before-production |
| Mutable/deleted audit history; untracked admin change | **B6** / C7 §7 | **Migration/DB check** (audit UPDATE/DELETE denied) + **runtime test** | Needs schema |
| Duplicate transaction effects; missing idempotency key; uncontrolled conflict merge | **B5** / C7 §6 | **Runtime test** (retry×100 → 1) + lint (writes carry idempotency key) | Needs DB |
| Cross-domain direct write; module bypassing its system-of-record owner; circular dependency | **B6/26** / C7 §8 | **Static ownership lint** (module may not import/write another module's tables) + **dependency-cycle check** | Day-1 feasible once module structure exists |
| Unbounded query on high-volume table; query ignoring tenant filter; missing pagination | **B3** / C7 §10 | **Lint + integration test** (no unbounded SELECT; tenant filter present) | Partly Day-1 (lint), partly DB |
| Disabling a required check | C7 §13/§14 | **Pipeline policy** (guards cannot be skipped; see §7) | Day-1 |

> A guard may never be downgraded from blocking to warning to "ship faster" — that is an architectural change (§7).

## 4. Testing gates (mapped to foundations — reuses C5 §12)

| Domain | Required automated tests | Authority |
|---|---|---|
| **Security** | RLS isolation; **Company A can never access Company B**; deactivated users lose access; permission enforcement | B1 |
| **Financial** | no floating money; deterministic rounding (V1 §12 cases); **exact debit=credit**; reversal integrity; posted records immutable | B2 |
| **Inventory/Production** | movement-ledger integrity; FIFO correctness; cost-calc consistency; adjustment audit trails | B4/20/22 |
| **Offline** | **same transaction retried 100× → exactly one inventory movement, one financial posting, one audit record**; interruption; delayed sync; conflicts; out-of-order | B5 |
| **Audit/Integration** | append-only audit; event ownership boundaries; integration-contract compliance | B6 |
| **Performance/Reporting** | query efficiency vs B3 budget; snapshot correctness; historical-computation integrity; load + tenant-scale | B3/B4 |
| **Security/Recovery** | authentication flows; MFA requirements; session controls; backup/recovery verification strategy | B7 |

These are the C5 gates; C6 makes each a **required status check** (per risk tier, §5/§8).

## 5. Risk-based CI strategy (aligns C4 §5)

| Risk | Examples | Pipeline expectation |
|---|---|---|
| **Low** | docs, UI styling, text | Format + type + lint + unit (fast lane); standard review |
| **Medium** | screens, forms, reports, business workflows | + integration tests + architecture-compliance review |
| **High** | DB schema, RLS, financial engine, inventory ledger, offline sync, authentication, audit | **Full test suite (all §4 gates) + architecture review + additional approvals (senior, C4 §5)** |

Risk is derived from the PR impact-analysis (C4 §4) and the paths touched (e.g. migrations, money, auth modules auto-flag High). High-risk PRs cannot merge on the fast lane.

## 6. AI-generated code governance

The project uses Claude Code, ChatGPT, Google AI Studio, and future agents (e.g. Google Jules). **AI-generated code has no reduced standards.**

```
Human code → same CI gates
AI code    → same CI gates
```

AI may accelerate implementation but may **never** override ADRs, ODRs, locked designs (`13.02`), the enterprise foundation specs (B1–B8), or the Engineering Constitution (C7). AI-authored changes are PRs (C4 §6) — attributed, reviewed, and subject to every gate. An AI change that fails a gate does not merge; the agent must fix or escalate, never disable the gate.

## 7. Failure & exception policy

- **CI failure blocks merge.** No exceptions for "small" or "urgent" (hotfixes are expedited-reviewed, not gate-skipped — C4 §9).
- **Temporary bypass requires formal architectural approval** (an ADR/owner decision documenting what, why, risk, and expiry) — never a developer's unilateral skip.
- **Disabling a protection to "ship faster" is itself an architectural change** (C7 §13) and goes through §7/C4 review.
- Bypasses are time-boxed and audited; a skipped gate is logged and tracked to re-enable.

## 8. Progressive enforcement strategy

Not every gate can or should exist on Day 1 — some require the foundation to exist first (§0).

**Tier 1 — Stage D minimum (required before any production code begins):**
- Secret scan; lockfile integrity; Prettier; `tsc` strict.
- Static architecture lints feasible without schema: **no-role-name-auth**, **ownership/no-cross-module-write**, **dependency-cycle**, **no-plaintext-password (obvious cases)**, **Money-type** (once B2 `Money` type lands — first foundation task).
- Unit tests: money rounding/precision (B2), permission evaluation (B1).
- Doc-integrity CI: **INDEX freshness + internal link check** (closes the automation owed by audit finding **P2-04** + Stage A6).

**Tier 2 — Required before production (as the schema/modules exist):**
- Migration/DB checks: **RLS-enabled-on-every-operational-table**, **append-only-audit**, tenant-columns-present.
- Integration tests: **cross-tenant denial** (B1), **idempotency retry×100→1** (B5), **debit=credit + immutable posted** (B2), inventory/FIFO (B4), audit immutability (B6), **migration reconciliation** (B8).
- Build verification + deployment eligibility.

**Tier 3 — Future enterprise maturity:**
- Advanced performance/load testing at the ODR-005 envelope (executes **P4.5-09**); large-volume simulation; security scanning enhancements (SAST/dependency-CVE escalation); chaos/DR drill automation.

The spec distinguishes **required immediately (Tier 1) · required before production (Tier 2) · future (Tier 3)** so enforcement grows with the system without blocking its own bootstrap.

## 9. Developer-experience philosophy

> Strict enough to protect the ERP **+** simple enough to keep developers productive.

- Fast lane for low-risk changes; the heavy gates run where the risk is.
- Pre-push local parity (C1 §8) so failures are caught before CI, not after.
- Clear, actionable failure messages (which law/spec, how to fix) — a guard that's cryptic gets worked around.
- Keep the pipeline fast (parallelize independent stages; cache deps); **a CI process so slow that developers routinely bypass it is a failed control.** Speed is a security property here.

---

## 10. Consistency check & status

Reviewed against ADR-001, ODR-001…005, B1–B8, C7, C5, C4, C1: C6 introduces **no new architectural authority** — it operationalizes the C7 §14 matrix and C5 gates, honestly reclassifying mechanisms (§0) and sequencing them (§8). No contradictions; one **dependency surfaced** (the no-float-money guard requires B2's `Money` type to be implemented as the first Stage-D foundation task — recorded, not a conflict).

**Findings:** C6 is a **design** spec; it does not yet *close* findings (enforcement closes them when implemented). It defines the automation that will close **P2-04** (doc-integrity CI) and operationalizes the enforcement intent behind **P5-03** (no plaintext / no role-name auth). Both remain **Open** until the CI is built (Tier 1, Stage C6-build/D). No finding status changed.

**Verification:** documentation only — no workflows, YAML, scripts, `package.json`, dependencies, or Supabase config created.

**Next:** C2 — Supabase Enterprise Foundation, then C3 (migrations) and C8 (implementation sequence).
