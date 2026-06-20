# Phase 4.5 — Performance & Scalability Stress

**Phase:** 4.5 of 9 (owner-added)
**Branch:** `architecture-audit`
**Date of record:** 2026-06-20
**Auditor:** Chief Enterprise Architect & System Auditor
**Governing assumptions:** ADR-001 (enterprise layer 10–26 authoritative).
**Stress baseline (owner-specified):** hundreds of branches · thousands of users · millions of records.
**Method:** Corpus-wide keyword coverage scan + read of `20.01` (DB Philosophy), `20.09` (Inventory Movement Ledger), `22.22` (Financial Statement Generator), `26.13` (Integration Stress Test Scenarios), cross-referenced with `20.22`, `20.24`, `20.28`, `24.04`. No source code modified. V1 prototype not consulted.

---

## 1. Objective

Stress the architecture against enterprise scale. Evaluate: database indexing, partitioning, query scalability, reporting scalability, offline-sync growth, conflict resolution at scale, and storage growth.

## 2. Coverage scan (objective)

Files mentioning each concept (excluding this audit package):

| Concept | Files | | Concept | Files |
|---|---|---|---|---|
| partitioning | **0** | | materialized views | **0** |
| DB indexing | **0** (only the TOC "Master Project Index") | | pagination | **0** |
| query optimization | **0** | | sharding | **0** |
| load testing | **0** | | throughput / latency | **0** |
| "scalability" (aspirational) | 9 | | "performance" (mostly HR/crop "performance") | 36 |

The scale **goal is explicit and ratified** (`20.01 §9`: "Hundreds of companies, Hundreds of branches per company, Thousands of users, Millions of records… schemas must avoid assumptions that the system will only operate as a single farm"), but **no concrete scalability mechanism is documented anywhere.** Scalability is an aspiration without an engineering plan.

## 3. Strengths confirmed

- **Multi-tenant discipline is the right foundation for scale** — mandatory `company_id`/`branch_id` on every operational record (`20.01`, `20.02`) is exactly the partition key a sharded/partitioned design needs.
- **Compute-from-history integrity** (`20.09` inventory, `20.24` cash, `20.22` GL) is an excellent correctness pattern (no mutable stored balances to drift) — it only lacks a performance counterpart.
- **Resilience stress testing (`26.13`)** — 12 well-chosen failure scenarios (internet loss, duplicate records, clock fraud, lost device, unauthorized access, inventory overdraw, AI error, IoT failure, offboarding, payment dispute, DB outage, malicious deletion) with a strong closing principle.

---

## 4. Findings

### P4.5-01 — No database indexing strategy
- **Severity:** High
- **Status:** Open
- **Description:** No document specifies database indexes. Every query is multi-tenant-filtered by `company_id`/`branch_id`, and RLS policies (P3-02) must consult `user_branch_roles`; without indexes on these columns (and composite indexes for common access paths, e.g. `(company_id, branch_id, item_id)` on movements, `(company_id, branch_id, transaction_date)` on journals), queries degrade to full scans.
- **Business Impact:** The app becomes unusably slow as data grows — the POS counter, dashboards, and reports all stall, directly harming daily operations.
- **Security Impact:** Unindexed RLS predicates make the security layer itself the performance bottleneck, creating pressure to weaken/bypass RLS for speed (a security regression).
- **Scalability Impact:** This is the single most certain scale failure — full scans over millions of rows per query.
- **Technical Risk:** Tables created without indexes; RLS subqueries un-indexed; N+1 patterns.
- **Recommended Enterprise Solution:** Author an indexing specification: index all FK and tenant columns, composite indexes for documented access paths, partial indexes for status filters, and a rule that every table ships with its indexes defined. Benchmark RLS-filtered queries against representative volumes.
- **Related Documents:** all `20.*` schema docs, `11.01`, `20.03` (RLS), `22.22`.
- **Recommended Priority:** High — define with the schema, not after.
- **Future Action Required:** Indexing spec + RLS query benchmarks.

### P4.5-02 — No partitioning strategy for high-volume tables
- **Severity:** High
- **Status:** Open
- **Description:** The highest-growth tables — `inventory_movements` (`20.09`), `journal_lines` (`20.22`), `audit_log` (`20.28`), sensor readings (`24.04`), `sync_queue` (`20.29`), notifications (`20.26`) — have no partitioning strategy, though they will reach millions–tens of millions of rows across hundreds of branches.
- **Business Impact:** Unpartitioned mega-tables slow every read/write and make maintenance (vacuum, reindex, archival) increasingly disruptive.
- **Security Impact:** None directly.
- **Scalability Impact:** Core scale concern — query planning, index size, and maintenance windows all degrade without partitioning.
- **Technical Risk:** Table bloat; slow archival; lock contention on hot tables.
- **Recommended Enterprise Solution:** Define partitioning: time-based (monthly/yearly) for ledger/audit/sensor tables and/or list partitioning by `company_id` for the largest tenants; pair with a partition-aware archival/retention plan (links Phase 3.5).
- **Related Documents:** `20.09`, `20.22`, `20.28`, `20.29`, `20.26`, `24.04`, `26.15`.
- **Recommended Priority:** High.
- **Future Action Required:** Partitioning + archival design.

### P4.5-03 — "Compute balances from history" has no performance counterpart (no snapshots/materialization)
- **Severity:** High
- **Status:** Open
- **Description:** Balances are mandated to be computed from full movement/transaction history — inventory ("stock levels calculated from movement history", `20.09`), cash ("balances calculated from transaction history", `20.24`), GL (`20.22`). This is correct for integrity but, without **balance snapshots/checkpoints or materialized aggregates**, computing a current balance is an O(n)-over-all-history aggregation on every read — catastrophic at millions of movements. Notably this also reconciles the Phase 3 contradiction (P3-01: `20.24` stores `current_balance` while the same doc says compute-from-history): at scale a cached balance is required, but it must be a **derived checkpoint**, never a manually editable field.
- **Business Impact:** Inventory lookups, cash positions, and the executive dashboard get slower over time until routine operations time out.
- **Security Impact:** Integrity vs performance tension; pressure to store editable balances (a correctness/audit risk) if not solved properly.
- **Scalability Impact:** Read latency grows linearly with history — the system gets slower the longer it succeeds.
- **Technical Risk:** Full-history SUMs per read; or, the wrong fix (editable cached balances that drift).
- **Recommended Enterprise Solution:** Introduce periodic balance snapshots (e.g. per item/account per period close) and compute current = latest snapshot + movements since; or maintain incrementally-updated materialized balances reconciled to history. Define the snapshot cadence at period close (aligns with `22.25`).
- **Related Documents:** `20.09`, `20.24`, `20.22`, `22.25`, and P3-01.
- **Recommended Priority:** High.
- **Future Action Required:** Balance-snapshot/materialization design (resolves P3-01 stored-vs-derived).

### P4.5-04 — Reporting and dashboard scalability is undesigned
- **Severity:** High
- **Status:** Open
- **Description:** `22.22` states the purpose is to "convert **millions of transactions** into financial information" and produce Trial Balance, P&L, Balance Sheet, Cash Flow with filters (date/location/crop/block/department/business-unit) plus a live Executive Dashboard the owner "should immediately see." There is no pre-aggregation, period-close roll-up, materialized reporting layer, OLAP/read-replica, or caching — these reports would scan millions of journal lines on demand across branches.
- **Business Impact:** Dashboards and statements that are meant to be instant become multi-second/minute queries at scale, undermining the system's core value (decision-making).
- **Security Impact:** Heavy reporting queries on the primary DB can degrade transactional availability (resource contention).
- **Scalability Impact:** Multi-dimensional reporting over millions of rows is the classic OLTP-vs-OLAP scale wall.
- **Technical Risk:** Full-scan aggregations; dashboard timeouts; primary-DB contention.
- **Recommended Enterprise Solution:** Design a reporting layer: period-close roll-up/summary tables, materialized views for common reports, a read replica or analytical store for heavy/historical queries, and dashboard caching with defined freshness. Reconcile with the snapshot strategy (P4.5-03).
- **Related Documents:** `22.22`, `22.23`, `22.25`, `23.17`, `20.30`.
- **Recommended Priority:** High.
- **Future Action Required:** Reporting/aggregation architecture.

### P4.5-05 — Offline conflict resolution does not scale
- **Severity:** Medium
- **Status:** Open
- **Description:** The conflict model is "detect duplicate → preserve both → **supervisor review**" (`26.10`, `26.13` Scenario 2). This is safe for rare conflicts but does not scale: island farms with intermittent connectivity producing bulk re-syncs across many devices could generate large volumes of conflicts, each demanding human review — an unmanageable bottleneck. No deterministic/automated resolution (e.g. idempotent dedupe on source identity, last-writer-wins with vector clocks for non-financial fields, field-level merge) is defined for high-frequency conflicts.
- **Business Impact:** Supervisors drowning in conflict queues; delayed data finalization across branches.
- **Security Impact:** Pressure to bulk-approve conflicts undermines the careful review intent.
- **Scalability Impact:** Human-in-the-loop per conflict is O(conflicts) human work.
- **Technical Risk:** Conflict backlog; inconsistent manual resolutions.
- **Recommended Enterprise Solution:** Tier conflict handling: idempotent dedupe on source/operation identity (auto-resolve true duplicates), automated deterministic merge for safe field classes, and reserve human review for genuine semantic conflicts and all financial records. Define per-entity conflict policy.
- **Related Documents:** `26.10`, `26.13`, `20.29`, and P4-01.
- **Recommended Priority:** Medium.
- **Future Action Required:** Tiered conflict-resolution design.

### P4.5-06 — Sync-queue growth and reconnect "thundering herd"
- **Severity:** Medium
- **Status:** Open
- **Description:** After a prolonged outage, each device's `sync_queue` may hold thousands of operations; many devices reconnecting simultaneously will replay large backlogs at once. Combined with automatic financial posting (P4-01) and per-record conflict detection, this is a thundering-herd risk on the primary DB. No batching, backpressure, throttling, or ordering/priority strategy is specified.
- **Business Impact:** Reconnect storms could slow or stall the system exactly when many branches come back online.
- **Security Impact:** None directly.
- **Scalability Impact:** Burst load proportional to (devices × backlog) with no smoothing.
- **Technical Risk:** Connection exhaustion; lock contention; posting duplication under load.
- **Recommended Enterprise Solution:** Batch sync uploads, apply server-side backpressure/rate-limiting, prioritize critical entities, process idempotently (P4-01), and define ordering guarantees. Size connection pooling for burst (P4.5-08).
- **Related Documents:** `20.29`, `26.10`, `26.13`, P4-01.
- **Recommended Priority:** Medium.
- **Future Action Required:** Sync batching/backpressure spec.

### P4.5-07 — Storage growth for time-series and large objects is undesigned
- **Severity:** Medium
- **Status:** Open
- **Description:** High-frequency IoT sensor data (`24.04`), photos/attachments (`20.27`), and audit logs (`20.28`) grow unboundedly in live storage. No downsampling/rollup for time-series, no tiering/cold-storage for old media, and no TTL/rollup for audit beyond retention principles (`26.15`). Phase 3.5 (P3.5-07) covered backup growth; this is the live-storage and query-over-time-series dimension.
- **Business Impact:** Rising storage cost and slowing queries over ever-larger time-series/media tables.
- **Security Impact:** None directly (retention/hold handled in Phase 3.5).
- **Scalability Impact:** Time-series and BLOB volume typically dominates storage at scale.
- **Technical Risk:** Sensor tables become the largest/slowest; media bloats the DB if stored in-row rather than object storage.
- **Recommended Enterprise Solution:** Store large media in object storage (not the DB), adopt time-series rollups/downsampling (or a hypertable approach) for sensor data, and define audit-log rollup/partition + tiered retention.
- **Related Documents:** `24.04`, `20.27`, `20.28`, `26.15`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Time-series + large-object storage design.

### P4.5-08 — No concurrency, connection-pooling, caching, or pagination strategy
- **Severity:** Medium
- **Status:** Open
- **Description:** With thousands of concurrent users, nothing addresses connection pooling (PgBouncer/Supabase pooler), read replicas, caching, or **API pagination**. List-heavy screens (sales journal, inventory, audit, notifications) imply unbounded result sets; `pagination` appears in 0 documents.
- **Business Impact:** Connection exhaustion under load and unbounded list queries cause timeouts/crashes during peak operations.
- **Security Impact:** None directly; availability concern.
- **Scalability Impact:** Concurrency and result-set size are first-order scale limits.
- **Technical Risk:** Too many direct connections; full-table list queries; no cache for hot reads.
- **Recommended Enterprise Solution:** Mandate server-side pagination (keyset/cursor) for all list endpoints, use the Supabase connection pooler, add caching for hot/reference data, and route heavy reads to a replica (P4.5-04).
- **Related Documents:** schema/UI list specs, `12.01`, `22.22`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Concurrency/caching/pagination spec.

### P4.5-09 — Stress testing covers failure-correctness but not load/performance
- **Severity:** Improvement Opportunity
- **Status:** Open
- **Description:** `26.13` (and the per-module stress-test docs `21.22`, `22.27`, `23.24`, `24.14`, `25.16`) test failure-mode **correctness** thoroughly but include **no load/performance scenarios** (e.g. 500 devices syncing after a regional outage, P&L over 5M journal lines, peak-hour POS concurrency, dashboard under volume).
- **Business Impact:** The system could pass all resilience tests yet fail under real production load.
- **Security Impact:** None directly.
- **Scalability Impact:** Without load scenarios, scale regressions go undetected until production.
- **Technical Risk:** No performance baseline or regression gate.
- **Recommended Enterprise Solution:** Add load/performance stress scenarios with target thresholds (RPO/RTO from Phase 3.5, query latency SLOs) and make them a pre-production gate (`18.10`).
- **Related Documents:** `26.13`, `21.22`, `22.27`, `23.24`, `24.14`, `25.16`, `18.10`.
- **Recommended Priority:** Improvement Opportunity.
- **Future Action Required:** Author load-test scenarios + SLOs.

---

## 5. Phase 4.5 summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 4 |
| Medium | 4 |
| Low | 0 |
| Improvement Opportunity | 1 |

**Headline:** V3 **declares** enterprise scale as a ratified goal but contains **no engineering plan to achieve it.** The foundation is right (tenant keys everywhere; integrity-preserving compute-from-history), but the four High findings are near-certain production failures at the stated scale: no indexing (P4.5-01), no partitioning (P4.5-02), no balance snapshots for the compute-from-history pattern (P4.5-03), and on-the-fly reporting over millions of rows (P4.5-04). These are the most consequential scalability gaps in the audit and must be designed **with** the schema, because retrofitting indexing/partitioning/snapshots after data exists is expensive and risky. The resilience stress suite is strong; it needs a performance/load counterpart (P4.5-09).

**Cross-phase links:** P4.5-01 amplifies P3-02 (RLS); P4.5-03 resolves P3-01 (stored-vs-derived balance); P4.5-05/06 extend P4-01/P4-04 (offline posting & conflict); P4.5-02/07 extend Phase 3.5 archival.

**Next phase:** Phase 5 — Doc-to-Code Drift & Implementation Readiness.
