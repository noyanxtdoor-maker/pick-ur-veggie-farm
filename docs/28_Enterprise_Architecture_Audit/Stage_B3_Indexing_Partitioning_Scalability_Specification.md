# Stage B3 — Enterprise Database Indexing, Partitioning & Scalability Specification

**Type:** Stage B foundation specification (scalability) · **Status:** Specification complete (design only)
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Resolves:** findings **P4.5-01** (no indexing strategy), **P4.5-02** (no partitioning strategy)
**Authority basis:** [ADR-001](ADR_001_Architecture_Ratification.md), [ODR-005](ODR_005_Progressive_Scaling_Strategy.md). Consolidates Section 20 (Schema), 22 (Accounting), 25 (Mobile/Offline), 26 (Integration). Builds on [B1](Stage_B1_RLS_Specification.md), [B2](Stage_B2_Money_and_Financial_Precision_Specification.md).
**Scope note:** architecture documentation only. **No SQL, index DDL, partition DDL, or optimization code.**

---

## 0. Assumptions challenged

- **Compute-from-history without indexes is the worst case.** `20.09`/`20.24`/`20.22` compute balances by aggregating full history (P4.5-03). Unindexed, that is repeated full scans. Indexing here is the *necessary* partner of B4 snapshots: B3 makes the aggregations fast; B4 bounds how much history each aggregation touches.
- **RLS makes tenant columns the hottest predicate.** Per B1, nearly every query carries `company_id` (+ `branch_id`). Therefore tenant columns are not optional secondary indexes — they are the **leading** columns of nearly every operational index. An RLS design without matching indexes (P3-02 + P4.5-01) guarantees full scans.
- **"Partition later" must not mean "redesign later."** Tables must be **partition-ready from day one** (carry a stable partition key, avoid cross-partition unique assumptions) so adopting partitioning is non-breaking. Designing partition-readiness is a V1 requirement; *activating* partitioning is deferred.
- **The schema currently has neither.** No index or partition is specified anywhere in `20.*` (verified Phase 4.5). This document is the missing layer.

---

## 1. Scalability philosophy

1. **Design for growth before it arrives; defer complexity until measured.** Foundations (indexes, partition-readiness, pagination) are built in V1; advanced infrastructure (sharding, distribution) waits for evidence (ODR-005).
2. **Optimize predictable access patterns** (§2) — index the queries the system actually runs, not hypothetical ones.
3. **Integrity over raw speed** — never trade correctness, immutability, or tenant isolation for performance.
4. **Measure, then escalate** — partitioning/replication are triggered by metrics (§9), not guesses.
5. **Tenant-first** — every operational index leads with the tenant key so RLS filtering is index-served.

## 2. Query ownership & access patterns

Indexes are justified by patterns, classified by frequency × volume:

| Pattern class | Examples | Filter shape (→ index lead) |
|---|---|---|
| **Operational (very frequent)** | "my branch inventory", "today's harvest", "pending POs", POS lookups | `company_id, branch_id, [status\|date]` |
| **Financial (periodic, heavy)** | "account transactions this period", "monthly P&L", trial balance | `company_id, [account_id], transaction_date` |
| **Administrative (infrequent)** | "all branches of company", "active users & permissions" | `company_id, [active_status]` |
| **Sync (bursty)** | drain offline queue on reconnect | `company_id, device_id, status` |
| **Audit/forensic (write-heavy, read-rare)** | "who changed X", security review | `company_id, branch_id, created_at`, `record_id` |

**Highest-volume / hottest:** inventory movement ledger, journal lines, audit log, sync queue, IoT sensor data — these get the most deliberate index + partition-readiness design (§4–§5).

## 3. Enterprise indexing strategy

**Primary keys & uniqueness:**
- UUID primary keys (per `20.*`).
- Business-unique constraints are **tenant-scoped**: `company_code` unique globally; `branch_code` unique per company; `journal_number` unique per company per fiscal year; idempotency key (B5) unique per source event. Uniqueness never spans tenants in a way that leaks existence.

**Tenant-isolation indexes (mandatory, every operational table):**
- Leading composite on `(company_id, branch_id, …)` for branch-owned tables; `(company_id, …)` for company-owned tables. This single rule is what makes B1's RLS predicate index-served and prevents full scans.
- The RBAC membership table `user_branch_roles` is indexed on `(user_id)` and `(company_id, branch_id, user_id)` so the RLS permission-derivation lookup (B1 §3) is fast.
- **Partial indexes** on `active_status`/`account_status` so the common "active rows only" filter is cheap.

**Composite indexes (define per access pattern, §2):**
- Ledgers: `(company_id, branch_id, transaction_date)` and `(company_id, account_id, transaction_date)`.
- Lifecycle queries: `(company_id, branch_id, status, updated_at)`.
- FK + lifecycle: `(foreign_key_id, status)` where a child is queried by parent + state.
- Index column **order = filter/sort order** (equality columns first, range/sort column last).

**Audit & history indexes:** journal lines, inventory movements, production events, sync queue, audit log each indexed on `(company_id, branch_id, created_at)` plus a `record_id`/`source_id` lookup index for forensic retrieval. These are append-heavy; keep index count lean (index for the few real read paths, not every column) to protect write throughput.

**Discipline:** every table ships with its indexes defined alongside it; no table without its tenant index. Over-indexing append-heavy tables is a defect (write cost) — index the measured read paths only.

## 4. High-volume table classification

| Growth tier | Tables (examples) | Growth behavior | Index expectation | Archival |
|---|---|---|---|---|
| **Extreme** | inventory movement ledger (`20.09`), journal lines (`20.22`), audit log (`20.28`), sync queue (`20.29`), IoT sensor readings (`24.04`) | Append-only, unbounded, dominant volume | Tenant + date composite; minimal extra indexes; **partition-ready** | Time-based archival/rollup (B4 / Stage 3.5); sync queue purged after confirmed sync |
| **Medium** | sales transactions, purchase transactions, production records, notifications | Steady operational growth | Tenant + date + status composites | Periodic archival of closed/old records |
| **Low** | companies, branches, users, roles, permissions, crop/item/supplier/customer master | Bounded, slow | PK + tenant + unique business keys | None (reference data) |

For extreme-tier tables, growth is the design driver: lean indexing (protect writes), partition-readiness now, partition activation later (§5), and reporting served from snapshots/rollups not raw scans (§7, B4).

## 5. Partitioning strategy

**Partition-ready in V1 (design), partition-activated later (trigger):**

- **Partition-ready now:** extreme-tier tables carry a stable partition key from day one — primarily `created_at`/`transaction_date` (time) and `company_id` (tenant). Avoid designs that assume a single physical table (no cross-table-spanning unique constraints that block partitioning; keep the partition key in every unique/PK where required).
- **Methods to evaluate (when triggered):**
  - **Date-based (range)** — recommended default for ledgers/audit/sensor (monthly or yearly); aligns with archival and period reporting.
  - **Tenant-based (list/hash on `company_id`)** — for the largest companies, or to isolate a heavy tenant.
  - **Hybrid** — tenant then time (sub-partition) for the biggest extreme-tier tables at the high end of the ODR-005 envelope.
- **Activation triggers (move from indexed table → partitioned):** any of — table approaches ~10–50M rows; maintenance windows (vacuum/reindex) become disruptive; or the §9 query-latency SLO is breached on that table despite correct indexing. **Do not partition before a trigger fires** (premature partitioning adds complexity with no benefit at V1 volumes).
- V1 expected volumes (millions, ODR-005) are served by **indexes alone**; partitioning is the prepared next step, not a V1 deliverable.

## 6. Pagination & query standards

**Prohibited:** unbounded `SELECT` over operational/history tables; loading full history into memory; infinite scroll without a hard limit; client-side filtering of server-unbounded result sets.

**Required:**
- **Keyset (cursor) pagination** for history/large lists (stable, index-served, no deep-offset cost); offset pagination only for small bounded admin lists.
- **Mandatory tenant filter** (`company_id` [+ `branch_id`]) on every operational query — enforced by RLS, expressed in queries so the index is used.
- **Mandatory date/range bound** on history queries (no "all journal lines ever"); default to a recent window.
- **Sort on indexed columns** only; the page sort key matches the index order.
- Documented **default and max page size**.

## 7. Reporting & analytics performance

- Heavy reports (P&L, balance sheet, trial balance, inventory valuation, production analytics, multi-year analysis) are **not** computed by scanning raw ledgers on demand (the P4.5-04 failure mode).
- **Served from precomputed summaries / period-close snapshots / rollups** — the mechanism is owned by **Stage B4** (balance snapshots, reporting/historical computation). B3 provides the indexes those rollups read; B4 defines the rollups.
- **Background generation** for large/historical reports; interactive dashboards read cached/rolled-up data with a defined freshness.
- **Read-replica / analytical store** is a deferred option (ODR-005) for when reporting load contends with OLTP — not a V1 build.

## 8. RLS performance relationship

- **Indexes exist to serve RLS.** Because B1 makes `company_id`/`branch_id` the universal predicate, the leading tenant index (§3) is what keeps RLS-filtered queries off full scans.
- **Branch-level optimization:** branch-owned queries use the `(company_id, branch_id, …)` composite; multi-branch users' "authorized branches" filter resolves via the indexed `user_branch_roles`.
- **Stable derivation helpers:** B1's permission/tenant helper functions should be marked stable/cacheable within a statement so RLS does not re-derive per row.
- **No full-table scans on tenant tables** is a measurable invariant (§9): a query plan doing a seq scan on an extreme/medium-tier tenant table is a defect to investigate.

## 9. Monitoring & performance governance

- **Metrics:** p95/p99 query latency per major access pattern; index-hit vs seq-scan ratio on tenant tables; table/index size growth; sync-drain throughput; slowest statements.
- **Slow-query threshold:** flag statements over a documented budget (e.g., operational reads target < ~100–200 ms p95; report queries have their own budget). Thresholds are documented constants, tuned with data (calibration knob — real workloads differ from paper).
- **Capacity planning:** track row counts of extreme-tier tables against the §5 partition-activation thresholds; review at defined growth milestones (e.g., each order-of-magnitude, or each added 10 branches).
- **Performance review checkpoints:** a pre-production load test (Phase 7 §E / P4.5-09) and recurring reviews; new high-volume tables require an index + access-pattern review before ship.

## 10. Future scalability boundaries (intentionally deferred — ODR-005)

Not built in V1 unless a measured trigger justifies it: database sharding; distributed/multi-region databases; global replication; microservices adopted solely for scale; complex distributed event systems. These are prepared-for (clean tenant keys, partition-readiness) but not implemented; activating them is a future, separately-approved decision.

---

## 11. Findings resolved / dependencies

- **P4.5-01** (no indexing strategy) → **Resolved (Stage B3)**: §3 (primary/tenant/composite/audit indexes, tenant-leading rule), §6 (pagination/query standards), §8 (RLS-serving indexes).
- **P4.5-02** (no partitioning strategy) → **Resolved (Stage B3)**: §4 (volume classification), §5 (partition-readiness now + method options + activation triggers).
- **Dependencies forward:** **B4** owns balance snapshots + reporting rollups (§7; P4.5-03/04). **B5** owns idempotency-key uniqueness used by indexes (P4-01). **B7/Phase 3.5** own archival/retention that partition boundaries align to. **Phase 7 §E** owns the load tests that validate these thresholds (P4.5-09 remains open until load testing).
- **No contradictions** with `20.*`/`22`/`25`/`26`; this spec supplies the index/partition layer those documents omitted, and is the performance partner to B1 (RLS) and B4 (snapshots).
