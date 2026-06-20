# Stage B6 — Audit Immutability, Event Contracts & System Integration Boundaries Specification

**Type:** Stage B foundation specification (integrity/integration) · **Status:** Specification complete (design only)
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Resolves:** findings **P3-05** (audit immutability — policy without mechanism), **P4-03** (integration mechanism & contracts unspecified), **P4-04** (offline-sync/integration specified across multiple docs — no canonical authority)
**Authority basis:** [ADR-001](ADR_001_Architecture_Ratification.md), ODR-001…005. Consolidates Sections 11, 20, 22, 23, 25, 26. Builds on [B1](Stage_B1_RLS_Specification.md)–[B5](Stage_B5_Idempotent_Transactions_and_Offline_Sync_Specification.md).
**Scope note:** architecture documentation only. **No code, migrations, triggers, buses, queues, or services.**

---

## 0. Assumptions challenged

- **Audit immutability was asserted as policy, never as a mechanism** (P3-05). `11.04` says records "shall never be edited or deleted" but specifies no enforcement. This document defines the enforcement.
- **The audit schema is fragmented** across `11.04` (policy), `20.28` (table), `10.04` (architecture) — three partial definitions (P3-05/P2-01). B6 declares a **single canonical audit model**; the others defer to it.
- **The dependency map (`26.08`) is excellent but has no contracts** (P4-03). Logical ownership is defined; the *mechanism* by which modules communicate (and the guarantee they cannot reach into each other's data) is not. Defined here.
- **Offline-sync/integration is specified in several docs with no declared authority** (P4-04: `20.29`/`26.10`/`25.10`/`05.02`). B6 names the canonical authority (B5 for sync semantics; B6 for cross-module contracts); the rest defer.

---

## 1. Audit philosophy & non-repudiation

**Every meaningful business action leaves a permanent, trustworthy, explainable history.** Each audited action answers: **who** (user), **when** (server-authoritative time, B5), **where** (device/origin), **what** (before → after), **why** (reason/justification), **whether approved** (approval reference), **which system** processed it (module/integration/AI). If the system cannot answer these, the action is **not enterprise-compliant** (`11.04`/`26.01`) and must not be the basis of a financial/inventory effect.

## 2. Audit record classification

| Class | Examples |
|---|---|
| **Security** | login/logout, failed auth, MFA challenges (ODR-003), permission/role changes, branch reassignment, account-status changes, break-glass (§9) |
| **Business** | inventory movements, sales, purchases, production activities, financial postings, payroll events |
| **System** | synchronization (B5), background processing, integration calls, data migration (ODR-001) |
| **Administrative** | configuration changes, emergency access, master-data changes |

All classes share one canonical audit record (§3) and are tenant-scoped (B1) and immutable. Severity/sensitivity tags drive enhanced auditing for high-risk actions (`11.04`).

## 3. Audit immutability rules (the enforcement P3-05 lacked)

**Canonical audit record (single model; `11.04`/`20.28`/`10.04` defer to this):** audit_id, company_id, branch_id, actor (user_id), actor_role/permission used, device/session id, event class, module/source, entity + record id, action, **previous value**, **new value**, reason/justification, approval reference, **server timestamp**, source idempotency key (B5), and (recommended) a **tamper-evidence chain field** (§ below).

**Enforcement (not just policy):**
- **Append-only.** The audit store accepts INSERT only. **UPDATE and DELETE are denied for every application role** at the database layer (deny-by-default, consistent with B1) — enforced by policy/constraint, not by convention.
- **No bypass.** Even privileged/Developer roles cannot edit/delete audit rows through the application; the only path is a controlled, separately-audited maintenance procedure (§9) — and even it cannot rewrite content, only archive.
- **Tamper evidence (recommended):** hash-chaining (each record includes a hash of the prior record) so any retroactive alteration is detectable. This raises "tamper-resistant" (`11.04`) to "tamper-evident."
- **Retention & archiving:** financial/security audit retained long-term (Phase 3.5 / `26.15`); archival moves rows to cold storage **without altering content**; archived audit remains verifiable. Retention respects legal/audit holds (no purge of held evidence).
- **Correction rule:** *incorrect history is corrected by adding history, not rewriting it* — corrections are new audit/business events (consistent with B2/B4/`26.07`). No audited fact is ever erased.

## 4. Event contract philosophy

Modules communicate through **explicit, versioned business event contracts** — never by reaching into another module's tables.

- A module **publishes** domain events about **its own** data; it **consumes** others' events to react.
- Example — **Inventory** may publish *InventoryMovementOccurred*, *StockAdjusted*, *BatchConsumed*; it **may not** modify accounting balances or payroll. **Accounting** may publish *JournalPosted*, *PaymentReceived*, *PeriodClosed*; it **may not** modify inventory quantities or production records.
- **Contract = a stable event schema** (name, version, payload fields, the owning module, idempotency key, company/branch/actor context). Consumers depend on the contract, not on the producer's internal schema. Contracts are **versioned**; breaking changes ship a new version.

## 5. System-of-record ownership (one owner per domain)

Re-affirms `26.08` and makes it a hard rule (no duplicated ownership):

| Domain owner | Owns (authoritative) |
|---|---|
| Inventory | stock quantity history, batch movement history |
| Accounting | journal history, financial statements, account balances (derived per B4) |
| Production | crop activities, yield records, production costs |
| HR | employee records, attendance, payroll inputs |
| Security | users, roles, permissions, audit (canonical, §3) |

A module references another's data by **id + consumed events**, never by owning a second copy (`26.08` "store the id, retrieve from the owner"). Snapshots (B4) are derived, not second owners.

## 6. Cross-module transaction rules

Cross-boundary workflows use an **event/outbox pattern** (design intent; not implemented here):

- Example — **purchase receiving:** Inventory commits a stock movement → emits *InventoryMovementOccurred* (transactionally, via an outbox) → Accounting consumes it and posts the financial impact → Audit records the whole chain. Each step is **idempotent** (B5 key) so retries don't double-apply.
- Define per cross-module flow: **owner** of each step, **event sequence**, **failure handling** (compensating events, never edits), and **idempotency** (B5). Financial impact is posted by Accounting from the event — operational modules never write journals directly (B2/`26.07`).
- **Atomicity:** an event and its outbox record commit together; downstream consumption is idempotent and eventually-consistent — no distributed two-phase lock required at V1 scale (ODR-005).

## 7. External integration boundaries

Payment gateways, IoT devices, AI systems, third-party APIs, future extensions:

- External systems **submit requests / supply data**; they **never become a source of truth**. Inbound data is recorded as events owned by the relevant internal module after validation (B1 authz, B5 idempotency).
- Example — a GCash/Maya payment happens **outside** the ERP; the ERP **records** it (per `22` "ERP is not a bank") as an internal event; the external confirmation is evidence, not the ledger.
- IoT sensor data is owned by the IoT module (`26.08`); unreliable readings are flagged, not trusted (`26.13`).
- Every external integration passes RLS/tenant scoping (B1) and is audited as a System event (§2).

## 8. AI & automation boundaries

Re-affirms `26.11`/`23.06` as a hard contract:

- **AI may:** analyze, recommend, forecast, detect anomalies, draft.
- **AI may not:** alter financial records, modify inventory/production history, override approvals, or change permissions — **without explicit human or governed authorization**.
- AI acts **through the same event contracts and RLS** as any actor (B1 §AI; `11.03`), under the user's permissions; AI-initiated actions are audited with the AI service + initiating user + human approval decision (`11.04`). AI is never a source of truth (`26.08`).

## 9. Emergency & administrative operations

- **Break-glass** (per B1 §8 / `26.09`): explicit, time-boxed elevation via permission overrides; MFA re-auth (ODR-003); secondary approval for high-impact scopes; **enhanced audit** of every elevated action; automatic expiration.
- **Administrative overrides** (e.g. inventory emergency, urgent correction) require reason, approval, and audit; they create corrective **events**, never silent edits.
- **Audit maintenance** (the only path that touches audit storage) is controlled, separately authorized, archival-only, and itself audited — it cannot rewrite audit content (§3).

## 10. Integration failure & recovery

Consistent with B5 exactly-once:

- **Partial workflow failure:** compensate with reversing events; never leave a half-applied financial effect; never edit to "fix."
- **Duplicate requests:** deduplicated by idempotency key (B5); a replayed event yields the same committed result.
- **Failed external communications:** retried with backoff/backpressure (B5); permanently-failed integration messages go to a dead-letter state for investigation (B5 §10).
- **Consistency model:** eventually-consistent across modules via idempotent events; each module's own state is transactionally consistent.

## 11. Monitoring & compliance

- **Audit review:** periodic review of high-risk audit events; reconciliation that audit chain (§3 hash) is intact.
- **Anomaly detection:** unusual access, large financial adjustments, mass exports, abnormal inventory changes (`11.04`/`26.13`).
- **Failed-transaction & integration health monitoring:** dead-letter counts, contract-version mismatches, event lag (with B3 §9 governance).
- **Security monitoring:** failed auth, cross-tenant attempts (B1), break-glass usage.
- Compliance posture: the canonical audit (§3) is the evidence base for any future regulatory/financial review (ODR-001 V2 archive included).

## 12. Future implementation guidance (design only)

- **Event naming:** `<Domain><PastTenseFact>` (e.g. `InventoryMovementOccurred`, `JournalPosted`, `PeriodClosed`); versioned; carry company/branch/actor/idempotency context.
- **Ownership documentation:** every entity lists its owning module (§5); a published ownership map is the single reference (supersedes scattered restatements).
- **Integration contracts:** each cross-module event has a documented contract + consumers; breaking change = new version.
- **Testing expectations:** audit cannot be updated/deleted (negative test); hash-chain tamper detection; cross-module workflow idempotency (B5); AI-action authorization + audit; break-glass expiry + audit.
- **Compliance validation:** CI/architecture guard that audit tables are append-only and that no module writes another module's owned tables (ownership lint).
- **No code now** — contracts, ownership, and enforcement rules only.

---

## 13. Findings resolved / dependencies

- **P3-05** (audit immutability) → **Resolved (Stage B6)**: §3 defines the enforcement mechanism (DB-level append-only, UPDATE/DELETE denied for all roles, optional hash-chaining, archival-only maintenance) and a single canonical audit model (`11.04`/`20.28`/`10.04` defer).
- **P4-03** (integration mechanism & contracts) → **Resolved (Stage B6)**: §4–§6 (versioned event contracts, outbox pattern, cross-module rules) supply the mechanism `26.08` lacked.
- **P4-04** (offline-sync/integration — no canonical authority) → **Resolved (Stage B6)**: canonical authority declared — **B5** governs sync/conflict semantics, **B6** governs cross-module contracts; `20.29`/`26.10`/`25.10`/`05.02` defer (B5 already corrected `26.10`).
- **Dependencies:** **B5** idempotency underpins §6/§10; **B1** authorizes all integration/AI; **B2/B4** keep financial posting + balances owned by Accounting. **Phase 7 §E** load/compliance tests validate at scale.
- **No contradictions** with Sections 11/20/22/23/25/26; B6 supplies the audit-enforcement and integration-contract layers those documents declared but did not specify.
