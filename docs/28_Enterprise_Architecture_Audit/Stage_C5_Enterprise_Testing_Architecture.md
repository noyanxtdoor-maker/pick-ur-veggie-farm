# Stage C5 — Enterprise Testing Architecture & Quality Verification Framework

**Type:** Stage C engineering-preparation artifact (binding) · **Status:** In force
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Authority basis:** ADR-001, ODR-001…005, B1–B8, [C7](Stage_C7_Engineering_Constitution.md), [C4](Stage_C4_Repository_Git_Governance.md); paired with [C1](Stage_C1_Development_Environment_and_Toolchain.md).
**Scope note:** governance documentation only. **No test code, frameworks installed, fixtures, or schema.**

Defines the evidence that proves the software obeys the architecture. Every gate here becomes a C6 required CI check (the C7 §14 enforcement matrix made executable).

---

## 1. Testing philosophy

- **Critical systems require proof, not assumptions.** Money, RLS, and offline correctness are *proven* by tests, never asserted.
- **Automated testing is mandatory** — untested high-risk code does not merge (C4 §5).
- **The cost of a bug scales with business impact** — test investment is proportional to risk (financial/security/inventory get the most).

## 2. Testing pyramid

| Layer | Covers | Tooling (recommended defaults) |
|---|---|---|
| **Static verification** | type checking, linting, **architecture rule validation** | `tsc --noEmit` (strict, C1); ESLint incl. the C7 §14 architecture lints (no-float-money, no-role-name-auth, ownership, no-unbounded-query) |
| **Unit** | calculations, validation logic, permission evaluation | Vitest (reuses the existing Vite config — no separate runner to maintain; ponytail) |
| **Integration** | database interactions, RLS policies, API/event contracts, posting+snapshot flows | Vitest against an ephemeral local Supabase/Postgres (C1 §6) |
| **End-to-end** | complete business workflows, permissions, offline sync | Playwright |

Pyramid shape: many static+unit, fewer integration, fewest E2E — but the **high-risk** integration/E2E tests (§3–§7) are non-negotiable regardless of cost.

## 3. Security testing — ref **B1**

Mandatory, deny-by-default verified:
- **Multi-tenancy:** Company A can **never** read/write Company B data (negative tests per entity).
- **Branch isolation:** a user assigned to branch B1 cannot touch B2.
- **RLS:** unauthorized access fails (no existence leak); **deactivated users lose access** on next request; permissions enforced at the DB, not just UI/API.
- **service_role discipline:** server paths using `service_role` apply equivalent tenant checks; `service_role` never reachable from the client.
Cross-tenant negative tests are a **blocking** gate (C6).

## 4. Financial testing — ref **B2** *(highest priority)*

- **No floating-point money** anywhere end-to-end (representation test).
- **Correct rounding:** half-up, round-once-per-line, exact-sum totals; reuse the V1 §12 cases (₱120/kg → ₱108.00/kg; 1.2 kg → ₱129.60) re-expressed against `journal_lines`.
- **Balanced journals:** Σ debits = Σ credits **exactly** (no float epsilon); unbalanced entries rejected.
- **Reversal integrity:** corrections are reversing/adjusting entries; **posted records immutable** (edit/delete attempts fail).
- **Determinism:** identical inputs → identical results across backend / frontend-preview / offline.

## 5. Inventory & production testing — ref **B4, Sections 20/22**

- **Movement-ledger integrity:** balances = sum of movements (no editable stored balance).
- **FIFO correctness:** batch consumption order verified.
- **Cost-calculation consistency:** extended cost rounding per B2; allocation sums exactly (largest-remainder).
- **Adjustment audit trails:** stock changes only via approved transactions; each adjustment produces an audit record (B6); historical movements cannot be edited.

## 6. Offline & sync testing — ref **B5**

Critical scenarios (blocking gate):
- **Same transaction sent 100×** → exactly **one** business effect (inventory + journal + audit + snapshot).
- **Network interruption** during financial posting → no duplicate/partial journal.
- **Delayed synchronization** (device offline for an extended period) → queue drains correctly.
- **Device conflicts** → genuine conflicts escalate; retries auto-dedup; financial history never auto-merged.
- **Out-of-order events** (harvest before crop block) → causal hold then apply; never wrongly rejected or duplicated.
- Device clock manipulation → not trusted for ordering.

## 7. Audit & event testing — ref **B6**

- **Audit records cannot be altered** — UPDATE/DELETE on the audit store fails for every role; optional hash-chain tamper detection.
- **Events follow ownership contracts** — a module cannot write another module's tables (ownership lint + integration test).
- **Cross-module communication respects boundaries** — financial effects post only via Accounting through events; idempotent (B5).

## 8. Performance testing — ref **B3, B4, ODR-005**

- **Load testing:** representative concurrency (hundreds of users V1 → thousands target).
- **Large-volume simulation:** millions of inventory movements / journal lines; verify tenant-filtered queries stay within the B3 latency budget and reports use snapshots (B4), not full scans.
- **Tenant-scale testing:** many companies/branches; confirm RLS-filtered queries are index-served (no seq scans on tenant tables).
- This is the **execution** that closes audit finding **P4.5-09** (specs exist; tests must run) — a pre-production gate (Stage E).

## 9. AI & automation verification

- **AI-generated code receives the same testing requirements** as human code (no exemptions).
- **AI cannot bypass architecture validation** — the same static/security/financial gates apply; an AI change that fails a gate does not merge.
- **AI changes remain traceable** (C4 §6/§11): authored via PR, attributed, reviewed.

## 10. Test data governance

- **Forbidden:** real customer data · production exports (C7 §3 / C1 §7).
- **Required:** synthetic datasets · controlled fixtures · reproducible test states (seed roles/permissions/currency master per B1/B2). Tests are deterministic and isolated (no shared mutable state between tests/tenants).

## 11. Definition of Done

A feature is **not** done because it compiles. It is done only when:
1. **Architecture authority identified** (which spec authorizes it — C4 §4).
2. **Code follows C7** (no forbidden patterns).
3. **Tests pass** (the relevant gates §2–§8).
4. **Security boundaries verified** (RLS/tenant negative tests, B1).
5. **Financial/inventory integrity proven** (B2/B4 tests) where applicable.
6. **Documentation updated** if behavior/architecture changed (C4 §7).

---

## 12. Relationship to C6 & enforcement mapping

C1 = *what tools/environment*; C5 = *what evidence proves correctness*; **C6 automates these as blocking PR gates.** Mapping (the C7 §14 matrix, made testable):

| Gate | Spec | C5 section | Blocking in C6 |
|---|---|---|---|
| Type + lint + architecture lints | C7 | §2 | yes |
| RLS / cross-tenant | B1 | §3 | yes |
| Money precision / balanced / reversal | B2 | §4 | yes |
| Inventory ledger / FIFO / allocation | B4 | §5 | yes |
| Idempotency / exactly-once / conflict | B5 | §6 | yes |
| Audit immutability / ownership | B6 | §7 | yes |
| Migration reconciliation | B8 | (release) | yes (migration PRs) |
| Performance / load | B3/B4 | §8 | pre-production gate (Stage E) |

## 13. Consistency & status

Consistent with ADR-001, ODR-001…005, B1–B8, C7, C4 — every gate derives from a foundation spec; no new authority introduced. Recommended frameworks (Vitest/Playwright) are defaults, not mandates — chosen to reuse the existing Vite toolchain (C1). **In force** as of this commit; the gates become executable in **C6**.

**Next:** C6 — CI/CD Quality Gates & Automated Architecture Enforcement.
