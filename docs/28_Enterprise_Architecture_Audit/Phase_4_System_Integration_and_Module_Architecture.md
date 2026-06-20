# Phase 4 — System, Integration & Module Architecture

**Phase:** 4 of 9
**Branch:** `architecture-audit`
**Date of record:** 2026-06-20
**Auditor:** Chief Enterprise Architect & System Auditor
**Governing assumptions:** ADR-001 (enterprise layer 10–26 authoritative; permission-first RBAC; dependency-driven build order).
**Method:** Read-only review of `26.01` (System Architecture Overview), `26.07` (Financial Posting Rules), `26.08` (Module Dependency Map), `26.10` (Offline Sync Rulebook), `26.11` (AI Authority Matrix), cross-referenced with `20.29`, `22.06`, `23.06`, `25.10`. No source code modified. V1 prototype not consulted.

---

## 1. Objective

Assess the system as one integrated whole: module boundaries and ownership, coupling, inter-module data flow, integration contracts, failure isolation, the offline model, and AI/IoT/mobile authority — evaluated against ADR-001 (dependency-driven, permission-first).

## 2. Strengths confirmed (this is the strongest layer of the corpus)

- **Module Dependency Map (`26.08`)** — exemplary: one master owner per data type ("a module should not own information that belongs to another module"), explicit owner/consumer per module, failure-isolation strategy (internet / AI / IoT / device / payment failures each handled gracefully), and explicit circular-dependency prevention.
- **System layering (`26.01`)** — clear 5-layer model (Foundation → Operational → Financial → Intelligence → Field), "digital twin of the farm" philosophy, and Golden Rules (physical-before-financial; AI advises, never controls; nothing permanently deleted; offline continues; company-scoped data).
- **Offline Sync Rulebook (`26.10`)** — mature: explicit offline-**restricted** list (financial approvals, role/permission changes, period closing require online), never-silently-overwrite conflict detection, a **device-clock-manipulation** trust rule, and an offline-storage policy that **forbids caching the entire accounting DB / all salaries locally** (this partially mitigates Phase 3 finding P3-06).
- **AI governance (`26.11`, `26.01` Rule 2)** — consistent across documents: Codex can analyze/draft/recommend but cannot move money, approve payroll, delete records, or change permissions; AI is never the source of truth; graceful AI-failure degradation.
- **Permission-first alignment with ADR-001 Decision 3** — the schema (`20.03`: `roles`, `permissions`, `role_permissions`, `user_permission_overrides`) is genuinely data-driven, satisfying the "no hard-coded roles" directive at the data layer.

This layer demonstrates the architectural maturity the rest of the corpus should be reconciled toward. The findings below are real but narrower than in earlier phases.

---

## 3. Findings

### P4-01 — Automatic financial posting lacks specified idempotency under offline-retry
- **Severity:** High
- **Status:** Open
- **Description:** Operational events automatically post accounting entries ("Accounting receives the financial impact" — `26.01`; "Automatic ERP Transaction Posting" — `22.06`; `26.07` posting flow). Independently, the offline rulebook (`26.10`) retries failed syncs automatically and resolves duplicates by "preserve both records + supervisor review." Nothing specifies **exactly-once** financial posting: if a synced operational event posts a journal entry but the client retries (no ack), the auto-posting could create **duplicate journal entries**. The local-temp-ID→UUID mapping (`26.10`) may dedupe the *operational* record, but idempotency of the *financial posting* derived from it is not specified, and a "preserve both" conflict model applied to financial postings would silently unbalance/duplicate the ledger.
- **Business Impact:** Duplicate or orphaned journal entries corrupt financial statements and cash positions — the highest-stakes failure for an accounting ERP, and hard to detect after the fact.
- **Security Impact:** Financial integrity is a security property; silent double-posting undermines non-repudiation and audit reliability.
- **Scalability Impact:** With many offline branches and frequent retries (Phase 4.5), the probability of duplicate postings rises with volume.
- **Technical Risk:** Auto-posting via triggers/functions without an idempotency key on the source event; retries crossing the offline boundary.
- **Recommended Enterprise Solution:** Define exactly-once posting: a unique idempotency key per source operational event (its UUID), a DB constraint ensuring at most one posting per source event, posting as a transactional side-effect of source-record commit, and an explicit rule that automatic financial postings are **never** subject to the "preserve both" conflict path. Add reconciliation checks (sum of postings per source).
- **Related Documents:** `26.07`, `26.01`, `22.06`, `26.10`, `20.22`, `20.29`.
- **Recommended Priority:** High — design before the posting engine is built.
- **Future Action Required:** Idempotent posting specification; ties to money rules (P3-01).

### P4-02 — `26.08` Integration Priority Order contradicts its own dependency map
- **Severity:** Medium
- **Status:** Open
- **Description:** `26.08`'s "Integration Priority Order" lists **Farm Operations (#3) before Inventory (#4)**, yet the same document states Production "Consumes: Inventory materials" — Production depends on Inventory, so building it first is dependency-unsound (the same defect flagged for `08.02` in P2-02). Likewise it lists **Accounting (#7) before HR/Payroll (#8)**, although the dependency map says Payroll "Provides salary expenses… Used by: Accounting" — Accounting consumes Payroll, so Payroll should precede or accompany Accounting. The build order contradicts the dependency relationships defined a few sections above it.
- **Business Impact:** Even the best integration document gives an internally inconsistent build sequence; teams following its order would hit the same rework/dependency violations P2-02 warns about.
- **Security Impact:** None directly.
- **Scalability Impact:** None directly; correctness/sequencing concern.
- **Technical Risk:** Building consumers before producers forces schema/logic rework.
- **Recommended Enterprise Solution:** Regenerate the integration priority order **from** the dependency map (topological sort), per ADR-001 Decision 4 (dependency-driven). Make the dependency map the single source and derive every sequence from it; reconcile with the canonical build-order document chosen in P2-02 remediation.
- **Related Documents:** `26.08`, `08.02`, `16.03`, `18.01`, `18.06`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Topologically derive the canonical sequence (Phase 5 verifies).

### P4-03 — Inter-module integration mechanism and contracts are unspecified
- **Severity:** Medium
- **Status:** Open
- **Description:** `26.08` defines logical ownership/consumption beautifully but not **how** modules actually communicate. There is no specification of the integration mechanism (DB triggers/functions, Supabase Realtime `12.01`, an event bus, or service-layer calls), no event/message schemas, no idempotency/ordering/failure-handling contract, and no versioning for inter-module contracts. "Accounting receives the financial impact" describes intent, not a contract.
- **Business Impact:** Without contracts, module integrations will be implemented ad hoc and inconsistently, producing exactly the coupling/drift the dependency map tries to prevent.
- **Security Impact:** Undefined integration channels can bypass permission/audit if not designed deliberately (the `26.01` rules require permission validation + audit on every operation, which integration events must honor).
- **Scalability Impact:** The mechanism choice (synchronous calls vs async events) materially affects scale and resilience (Phase 4.5).
- **Technical Risk:** Tight coupling, lost/duplicated events, no contract versioning.
- **Recommended Enterprise Solution:** Specify the integration pattern (recommended: event-driven via DB triggers writing to an outbox / posting queue, consumed transactionally), define event schemas and an idempotency/ordering/retry contract, require every integration event to carry company/branch/user/audit context, and version contracts. Aligns with P4-01.
- **Related Documents:** `26.08`, `12.01`, `22.06`, `26.07`, `20.29`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Integration-contract specification.

### P4-04 — Offline-sync behavior is specified in multiple enterprise documents (intra-enterprise duplication)
- **Severity:** Medium
- **Status:** Open
- **Description:** Offline synchronization is defined across `20.29` (schema/sync_queue), `26.10` (rulebook), and `25.10`/`25.11` (mobile offline storage & sync queue), plus the foundation `05.02`. ADR-001 makes the enterprise layer canonical over the foundation, but it does **not** resolve enterprise-vs-enterprise precedence (e.g., does `20.29` or `26.10` govern conflict resolution?). The specs are largely compatible but their conflict-resolution detail differs in granularity, and no document is declared authoritative.
- **Business Impact:** Implementers may follow different offline specs; conflict-resolution behavior (critical for financial data) could be built inconsistently.
- **Security Impact:** Divergent offline-security statements risk an implementation that follows the weaker one.
- **Scalability Impact:** Conflict-resolution strategy at scale is owed by Phase 4.5; multiple specs complicate that design.
- **Technical Risk:** Conflicting sync state machines.
- **Recommended Enterprise Solution:** Designate one canonical offline-sync specification (recommended: `26.10` rulebook for behavior + `20.29` for schema, explicitly cross-referenced), and have `25.10`/`25.11`/`05.02` reference it. This is the first concrete case of the deferred "intra-enterprise precedence" noted in ADR-001.
- **Related Documents:** `20.29`, `26.10`, `25.10`, `25.11`, `05.02`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Canonical offline-sync designation (feeds Phase 7 intra-enterprise precedence).

### P4-05 — Prose role lists should be reframed as seed-data examples (ADR-001 Decision 3 alignment)
- **Severity:** Improvement Opportunity
- **Status:** Open
- **Description:** The schema (`20.03`) is correctly data-driven (roles/permissions are rows), satisfying ADR-001's "no hard-coded roles" directive. However, prose documents (`11.01`, `20.03` examples) present the role list in a way that reads as a fixed enum. To honor Decision 3 (permission-first, custom/company/branch roles), the documented roles should be explicitly labelled as **default seed data / examples**, not a closed set.
- **Business Impact:** Prevents implementers from hard-coding the role list against the ratified flexibility requirement.
- **Security Impact:** None (positive — encourages permission-based checks over role-name checks).
- **Scalability Impact:** Supports per-company role customization at scale.
- **Technical Risk:** Role-name-based authorization checks instead of permission-based.
- **Recommended Enterprise Solution:** Label documented roles as default seed data; mandate permission-based authorization checks everywhere (never `if role == 'Admin'`); document how companies define custom roles.
- **Related Documents:** `11.01`, `20.03`, `26.09`.
- **Recommended Priority:** Improvement Opportunity.
- **Future Action Required:** Reframe role docs during P3-03 remediation.

---

## 4. Phase 4 summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 0 |
| Improvement Opportunity | 1 |

**Headline:** The integration architecture is the **strongest part of V3** — the dependency map, layering, offline rulebook, and AI authority model are enterprise-grade and should anchor the reconciliation. The material risk is **money integrity under automation + offline retry** (P4-01: exactly-once financial posting is unspecified), plus the need to make integration **mechanisms and contracts** as rigorous as the integration **map** (P4-03), and to derive build order from dependencies rather than restating it inconsistently (P4-02, even `26.08` contradicts itself). Encouragingly, the schema already supports ADR-001's permission-first, data-driven RBAC.

**Cross-phase links:** P4-01 ties to money rules (P3-01); P4-04 conflict-resolution and integration-mechanism scale hand to Phase 4.5; P4-02 sequence reconciliation verified in Phase 5.

**Next phase:** Phase 4.5 — Performance & Scalability Stress.
