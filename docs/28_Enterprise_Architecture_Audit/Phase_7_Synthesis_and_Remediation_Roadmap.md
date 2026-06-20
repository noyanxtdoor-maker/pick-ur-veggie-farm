# Phase 7 — Synthesis & Prioritized Remediation Roadmap

**Phase:** 7 of 9 (final)
**Branch:** `architecture-audit`
**Date of record:** 2026-06-20
**Auditor:** Chief Enterprise Architect & System Auditor
**Governing assumptions:** ADR-001 (enterprise layer 10–26 canonical; permission-first RBAC; dependency-driven build; preserve V1→V2→V3 lineage).
**Method:** Synthesis of Phases 0–6. No new corpus reads; consolidates the master findings register. No source code modified.

---

## 1. Executive summary

PickUrVeggie ERP V3 is an **ambitious, design-rich enterprise architecture built on a working V2 prototype.** Across 28 documentation domains (283 files, ~26k lines) the audit found **0 Critical, 19 High, 28 Medium, 7 Low, and 5 Improvement** findings (59 total). There are **no foundation-breaking (Critical) defects** — but the system is **not yet ready to begin enterprise implementation.**

The reason is consistent across every phase: **the vision and the high-level design are strong, but the enforcement, precision, and scale-engineering specifications that turn the design into a buildable system do not yet exist.** The security model names RLS as the "final authority" but never specifies it; the accounting design is sound but money has no defined precision; the scale targets are ratified but there is no indexing, partitioning, or snapshot strategy; the migration plan is well-framed but has no data-mapping.

**Readiness verdict:**
> **CONDITIONALLY READY to proceed to a Foundation-Design stage — NOT READY to begin module coding.**
> The enterprise direction is sound and ratified (ADR-001). Before any V3 code is written, the High-severity *design specifications* below (RLS, money/precision, indexing/partitioning, balance snapshots, data migration, DR mechanics, governance reconciliation) must be authored. Implementation may then proceed foundation-first per `27.03`/`18.05`.

This is the expected and healthy outcome of auditing **before** building: the weaknesses were found on paper, where they are cheap to fix.

---

## 2. Audit statistics

### By phase
| Phase | Title | C | H | M | L | Imp |
|---|---|---|---|---|---|---|
| 0 | Charter & Inventory | 0 | 1 | 2 | 2 | 1 |
| 1 | Governance & Source-of-Truth | 0 | 2 | 4 | 0 | 0 |
| 2 | Doc Consistency & Cross-Reference | 0 | 2 | 2 | 4 | 0 |
| 3 | Data & Security | 0 | 3 | 4 | 0 | 0 |
| 3.5 | Data Lifecycle & DR | 0 | 2 | 4 | 0 | 1 |
| 4 | System/Integration/Modules | 0 | 1 | 3 | 0 | 1 |
| 4.5 | Performance & Scalability | 0 | 4 | 4 | 0 | 1 |
| 5 | Doc-to-Code Drift | 0 | 2 | 3 | 0 | 1 |
| 6 | Migration & Roadmap | 0 | 2 | 2 | 1 | 0 |
| **Total** | | **0** | **19** | **28** | **7** | **5** |

### By status
| Status | Count |
|---|---|
| Open | 54 |
| Accepted (ADR-001) | 5 |
| Resolved | 0 |
| Rejected | 0 |

---

## 3. Cross-cutting themes

**Theme 1 — One root cause behind most inconsistency: the unreconciled dual-layer corpus.**
The documentation grew as a lean **foundation layer (00–08)** plus a later **enterprise expansion (10–26)** that was never reconciled with the original. This single fact produced the stale manifest (P0-01), the five competing governing authorities (P1-01), the duplicated accounting/data/security domains (P2-01), the contradictory role taxonomy (P3-03), and the misleading status doc (P5-02). **ADR-001 resolves the direction** (enterprise canonical); the mechanical reconciliation is Stage A below.

**Theme 2 — The design is strong; the enforcement/precision layer is missing.**
Repeatedly, an excellent principle lacks its implementing specification: RLS is "final authority" but unspecified (P3-02); audit is "immutable" but no mechanism (P3-05); money is double-entry-disciplined but untyped (P3-01); balances are integrity-preserving compute-from-history but have no performance counterpart (P4.5-03). The gap is consistently between *intent* and *spec*.

**Theme 3 — Scale is a ratified goal with no engineering plan.**
`20.01` mandates hundreds of branches / millions of records, yet the corpus has zero indexing, partitioning, materialization, pagination, or load testing (Phase 4.5). These must be designed **into the first migrations**, because retrofitting them after data exists is the most expensive class of fix.

**Theme 4 — The integration architecture (Section 26) is the model to build toward.**
The dependency map, layering, offline rulebook, AI authority matrix, and resilience stress suite are enterprise-grade. The reconciliation should pull the rest of the corpus **up** to Section 26's standard, not average it down.

**Theme 5 — Code is V2; V3 is a foundation rebuild, not an in-place refactor.**
The `src/` prototype is honest, working V2 (correctly catalogued by `27.01`), but it is architecturally divergent from canonical V3 (P5-01). The migration must be framed as "rebuild the foundation, port the proven business logic" (P6-01), with a real data-migration mapping (P6-02).

---

## 4. Top risk register (highest enterprise impact)

| # | Risk | Source findings | If unaddressed |
|---|---|---|---|
| R1 | **Money corruption** — untyped money + no rounding + duplicate auto-postings under offline retry | P3-01, P4-01, P6-02 | Wrong financial statements; unbalanced ledger; the owner's worst case |
| R2 | **Tenant data leakage** — RLS named final authority but never specified | P3-02, P3-04, P4.5-01 | Cross-company/branch data breach in a multi-tenant system |
| R3 | **Performance collapse at scale** — no indexing/partitioning; compute-from-history without snapshots; on-the-fly reporting | P4.5-01..04 | System becomes unusable as data grows |
| R4 | **Data loss** — 24h RPO, unencrypted backups, no restore procedure, un-synced offline data | P3.5-01..05 | Permanent loss of financial/operational data |
| R5 | **Wasted/throwaway build** — migration mis-framed as in-place; no data mapping; prototype extended as V3 | P5-01, P6-01, P6-02 | Months of effort on the wrong foundation |
| R6 | **Governance ambiguity** — competing authorities, conflicting locked-set & sequences (direction set by ADR-001, mechanics pending) | P1-01, P1-02, P2-02 | Contradictory implementation decisions |
| R7 | **Backup channel breach** — full DB + PII exported to Drive without encryption/access control | P3.5-02 | Backup becomes the easiest exfiltration path, bypassing in-app security |

---

## 5. Prioritized remediation roadmap

Sequenced per ADR-001 Decision 4 (dependency-driven) and the sound `27.03`/`18.05` order. **Each stage gates the next.**

### Stage A — Governance reconciliation (do first; cheap, unblocks everything)
*Mostly editorial; executes ADR-001. No code.*
- A1. Establish the authority hierarchy & intra-enterprise precedence; add an "Authority & Precedence" clause to each governing doc. *(P1-01)*
- A2. Create one canonical **locked-designs registry** (home: `13.02`) reconciling `13.02`/`19.02`. *(P1-02)*
- A3. Designate the single canonical role model (data-driven, permission-first) and controlled role vocabulary. *(P3-03, P2-03, P4-05)*
- A4. Designate the canonical build sequence = `27.03` + `18.05`; fix `26.08`'s priority list; redirect `08.02`/`16.03`. *(P2-02, P4-02, P5-04, P6-04, P6-05)*
- A5. Replace `13.01` status with a Designed/Implemented/Verified model; let `27.01` be the V2 baseline of record. *(P5-02)*
- A6. Auto-generate the documentation index/manifest in CI; deprecate the stale manifests; add a link-integrity check. *(P0-01, P0-02, P2-04)*
- A7. Foundation-layer re-scope (00–08 → vision/history/summary) + structural cleanups: rename `18_Project Build`→`18_Project_Build`, fix `18.01` markdown, rename `26.02–26.06`, merge `23.04`/`23.20`, confirm numbering gaps, label `14_UI_References` provenance, scope the `22.13` V2 reference. *(ADR-001 D2; P0-03/04/05/06, P2-05/06/07/08)*

### Stage B — Foundation design specifications (must precede any coding)
*The High-severity specs that are currently missing. No code yet — these are the blueprints.*
- B1. **RLS policy specification** — JWT claims (company_id, branch set, role), deny-by-default template per branch-scoped table, override/account-status handling, `service_role` stance, cross-tenant access tests. *(P3-02, P3-04, R2)*
- B2. **Money & precision specification** — `NUMERIC(18,2)`, canonical `round2`, `currency_code`+`exchange_rate` on journal lines, derived (not editable) balances. Port from `money.ts`. *(P3-01, P5-06, R1)*
- B3. **Indexing & partitioning specification** — tenant/FK/composite indexes; time/company partitioning for high-volume tables; designed into the initial migrations. *(P4.5-01, P4.5-02, R3)*
- B4. **Balance snapshot / reporting-aggregation design** — period-close snapshots + movements-since; materialized/roll-up reporting layer + read path. *(P4.5-03, P4.5-04, R3)*
- B5. **Idempotent financial posting + tiered conflict resolution** — exactly-once posting keyed on source event; auto-resolve true duplicates; human review only for genuine/financial conflicts; sync batching/backpressure. *(P4-01, P4.5-05, P4.5-06, R1)*
- B6. **Audit immutability + integration contracts** — append-only/triggered audit, single canonical audit schema; inter-module event contracts (outbox pattern, schemas, idempotency). *(P3-05, P4-03, P4-04)*
- B7. **Auth hardening + backup/DR mechanics** — MFA for privileged/financial roles, password policy, Developer-role constraints; RPO/RTO + PITR, encrypted backups w/ access control, restore runbooks (incl. tenant-scoped), offline-data durability, DR runbook/ownership. *(P3-06, P3-07, P3.5-01..06, R4, R7)*
- B8. **Data-migration mapping + migrate-vs-fresh decision** — field-level V2→V3 mapping, tenant back-assignment, float→numeric, flat→double-entry (or opening balances), reconciliation gate. *(P6-02, P6-01, R5)*

### Stage C — Implementation foundation scaffolding (first code)
*Per `27.03` Phases 1–2 / `18.05`.*
- C1. Supabase project; base migrations embedding B2/B3 (money types, indexes, partitions).
- C2. RLS policy framework (B1) with deny-by-default + cross-tenant tests.
- C3. Supabase Auth + RBAC tables (data-driven roles, B-aligned); repository/service layer; offline sync queue + audit foundation.
- C4. App restructure (modules/services/repositories/routing) per `27.02`. Rename package off `react-example`. *(P5-05, P5-03 do-not-port enforced)*

### Stage D — Module build (canonical sequence, per-module gates)
*`27.03` order: Master Data → Inventory → Production → Financial → HR/Payroll → AI → IoT → Mobile.* Each module passes a gate: RLS tested, money precise, indexed/partitioned, idempotent postings, conflict policy, audit complete, ported logic reconciled to `money.ts`.

### Stage E — Pre-production hardening
- E1. Load/performance stress scenarios + SLOs (mass concurrent sync, reporting under volume, peak POS). *(P4.5-09)*
- E2. Full DR drill (restore from encrypted backup; tenant-scoped restore). *(P3.5-03/06)*
- E3. Security review (RLS cross-tenant, auth, backup access). *(R2, R7)*
- E4. Storage lifecycle (time-series rollup, object storage, retention/hold). *(P4.5-07, P3.5-07)*

---

## 6. Outstanding owner decisions

ADR-001 resolved the layer/role/sequence direction. These remain for the owner:

1. **Migrate historical V2 data vs. start V3 fresh (archive V2)?** — gates B8/P6-02; the single biggest open decision.
2. **Multi-currency scope for v1** — full FX on journal lines now, or PHP-only with currency-ready columns? — shapes B2.
3. **MFA scope at launch** — all users vs privileged/financial roles only? — shapes B7.
4. **Intra-enterprise precedence specifics** — confirm the exact precedence order among enterprise governing docs (09/11/13/19/20) — refines A1.
5. **Target scale envelope for v1** — realistic near-term (e.g. ≤10 branches) vs designing now for hundreds — calibrates how much of B3/B4 is built immediately vs designed-but-deferred.

---

## 7. Definition of enterprise-ready (exit criteria)

V3 may begin module coding (Stage D) when:
- Stage A complete (single authority hierarchy; canonical role/sequence/status; generated index).
- Stage B specs authored & owner-approved (RLS, money, indexing/partitioning, snapshots/reporting, idempotent posting/conflict, audit/contracts, auth/DR, data-migration).
- Stage C foundation scaffolded with passing cross-tenant RLS tests and money-precision tests.
- The §12-style verification tests (money math, CA-balance, accounting) are re-expressed against the V3 schema and pass.

V3 is **enterprise production-ready** when Stages D–E complete with all High findings Resolved, a successful DR drill, and load tests meeting SLOs.

---

## 8. Finding → remediation traceability

| Stage | Findings addressed |
|---|---|
| A (Governance) | P0-01,02,03,04,05,06 · P1-01,02,03,04,05,06 · P2-01..08 · P3-03 · P4-02,05 · P5-02,04 · P6-04,05 |
| B (Foundation specs) | P3-01,02,04,05,06,07 · P3.5-01..07 · P4-01,03,04 · P4.5-01..08 · P6-01,02,03 |
| C (Scaffolding) | P5-01,03,05 |
| D (Modules) | per-module application of B specs |
| E (Pre-prod) | P4.5-09 · P3.5-03,06,07 |

---

## 9. Closing statement

The audit's purpose was to find architectural weaknesses **before** implementation. It succeeded: the V3 foundation is **conceptually strong and now has a single ratified authority (ADR-001)**, but it is **not yet buildable** until the missing enforcement, precision, scale, DR, and migration specifications (Stage B) are authored. There are no Critical defects and nothing requiring a redesign of the vision — the path forward is to **raise the whole corpus to the standard already set by Section 26**, author the foundation specs, scaffold foundation-first, and build module-by-module against per-module quality gates.

The enterprise architecture audit (Phases 0–7) is **complete**. This package is the permanent record; the master findings register in the [package README](README.md) tracks remediation status going forward.

**Audit status: COMPLETE.** Recommended next action: schedule Stage A (governance reconciliation) and Stage B (foundation specs) as the immediate pre-implementation work, and make the §6 owner decisions.
