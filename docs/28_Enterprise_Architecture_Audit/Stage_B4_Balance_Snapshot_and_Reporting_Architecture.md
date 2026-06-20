# Stage B4 — Balance Snapshot, Reporting & Historical Computation Architecture

**Type:** Stage B foundation specification (financial/scalability) · **Status:** Specification complete (design only)
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Resolves:** findings **P4.5-03** (compute-from-history has no snapshot counterpart), **P4.5-04** (reporting scalability undesigned)
**Authority basis:** [ADR-001](ADR_001_Architecture_Ratification.md), [ODR-005](ODR_005_Progressive_Scaling_Strategy.md). Consolidates Section 20 (Schema), 22 (Accounting), 26 (Integration). Builds on [B2](Stage_B2_Money_and_Financial_Precision_Specification.md), [B3](Stage_B3_Indexing_Partitioning_Scalability_Specification.md).
**Scope note:** architecture documentation only. **No SQL, views, materialized views, jobs, or code.**

---

## 0. Assumptions challenged

- **"Compute from history" and "fast reports" are presented as opposites — they are not.** The resolution is a **derived-snapshot layer**: history stays the only truth; snapshots make reading it fast. This document defines that layer (the partner B3 §7 referenced).
- **`20.24` stores an editable `current_balance` — forbidden.** B2 already ruled stored balances may exist *only* as derived checkpoints. B4 makes `current_balance` (and every stored balance) a **snapshot value owned by this mechanism**, never hand-edited, always rebuildable from events.
- **A stored balance that can drift from history is a latent corruption.** Therefore every snapshot is **verifiable against** and **reconstructable from** the event history; a snapshot is disposable, history is not.

---

## 1. Source-of-truth hierarchy

```
LEVEL 1 — IMMUTABLE EVENT HISTORY   (the only truth)
  journal entry lines · inventory movements · production events ·
  payroll events · sales/purchasing events
        │  (append-only; corrections = new reversing/adjusting events, never edits)
        ▼
LEVEL 2 — DERIVED SNAPSHOTS / CHECKPOINTS   (performance only; disposable)
  account balance snapshots · inventory quantity snapshots ·
  cost-accumulation snapshots · period summaries
        │  (always = a deterministic function of Level 1; rebuildable; verifiable)
        ▼
LEVEL 3 — REPORTS & ANALYTICS   (read views)
  consume: latest snapshot + deltas since · historical snapshots ·
  or raw history when correctness/audit requires it
```

**Rule:** Level 2 and 3 are **derived**. If they ever disagree with Level 1, Level 1 wins and Level 2 is rebuilt.

## 2. Snapshot philosophy

- **Snapshots improve performance; they never replace historical truth.**
- **Disposable:** any snapshot can be deleted and rebuilt from events with an identical result (determinism, per B2).
- **Verifiable:** a snapshot can be recomputed from history and compared; mismatch = defect → rebuild + investigate.
- **Never manually edited:** no UI, API, or admin path edits a snapshot value (extends B2 "balances are not editable").
- **Corruption-safe:** losing/corrupting all snapshots cannot lose financial truth — only performance, until rebuilt.
- **Money rules apply:** snapshot values use B2 decimal precision and rounding (exact sums of already-rounded events; no float).

## 3. Snapshot types

| Domain | Snapshot examples | Grain / key |
|---|---|---|
| **Financial** | Account balance (daily), monthly balance, **fiscal-period closing snapshot** | `company_id, account_id, [branch_id], as_of_period` |
| **Inventory** | Daily stock balance, batch-level position, branch/warehouse position | `company_id, branch_id, item_id, [batch_id], as_of` |
| **Agricultural production** | Crop-block cost accumulation, production-cycle summary, yield/cost analytics | `company_id, branch_id, crop_block_id, cycle` |
| **Operational** | Sales summary, purchase summary, labor/payroll summary | `company_id, branch_id, period` |

Each snapshot row records: the derived value(s), the `as_of` boundary, and a **watermark** (the last event id/timestamp included) so "deltas since" (§5) is exact. Snapshots are tenant-scoped and indexed per B3.

## 4. Snapshot generation strategy

Two complementary mechanisms (define both; neither alone suffices):

- **Incremental (event-driven):** as Level-1 events post, the affected running snapshot advances by the event delta (e.g. a posted journal line updates the account's running balance checkpoint). Keeps "current" cheap. Must be **idempotent** (a re-applied event via offline retry must not double-count — ties B5/P4-01; snapshots advance by watermark, not by blind increment).
- **Scheduled / boundary (authoritative):** end-of-day and **period-close** generate point-in-time snapshots that become the immutable historical reference for that boundary. These are the recompute-from-history checkpoints that bound all later "deltas since."
- **Manual rebuild:** an operator-triggered full recompute from events for a tenant/account/range, used after suspected corruption, restore (Stage 3.5), or migration (ODR-001). **Full reconstruction from Level-1 events must always be possible** — this is the safety net for the entire layer.

Incremental keeps it fast; scheduled/boundary keeps it correct and bounded; manual rebuild keeps it recoverable.

## 5. Reporting architecture

| Report kind | Computation path |
|---|---|
| **Current period** | nearest prior snapshot + **deltas since its watermark** (bounded scan, B3-indexed) — never a full-history scan |
| **Historical / closed period** | the period's **closing snapshot** directly (no recomputation; closed periods are stable) |
| **Audit / forensic** | **direct Level-1 history** (bypass snapshots) — correctness and traceability outrank speed here |
| **Cross-period / multi-year** | chain of period closing snapshots + final-period delta |
| **Multi-company consolidation** | per-company snapshots aggregated by an authorized reporting path (not cross-tenant raw reads, per B1) |

**When reports MUST bypass snapshots:** audit/forensic queries, snapshot-reconciliation runs (§6), and any report whose correctness is in question — these read raw history. Everything else reads snapshots + bounded deltas. Heavy/historical reports run in the **background**; dashboards read cached snapshot values with a stated freshness (B3 §7).

## 6. Reconciliation & verification

- **Verification routine:** recompute a snapshot from Level-1 history and compare to the stored snapshot (exact decimal equality, B2). Run on a schedule and on demand; any mismatch flags the snapshot for rebuild and raises an audit/security event (B1 §7 / B6).
- **Gap detection:** the watermark scheme detects missing/unapplied events (gap between max event id and snapshot watermark) and failed incremental processing.
- **Rebuild procedure:** delete + recompute affected snapshots from events; deterministic result (B2). Rebuild is safe at any time because history is untouched.
- **Reconciliation reports:** periodic "snapshot vs history" diff per tenant; for financials, a trial-balance recomputation confirming Σ debits = Σ credits and snapshot balances tie to journal history.
- Reconciliation **reads raw history** (a legitimate full-scan exception, §5), scheduled off-peak.

## 7. Financial closing relationship

- **Closing does not delete history** — it produces an **immutable period closing snapshot** and locks the period (`22.25`/`26.07`).
- **Adjustments create new transactions** — post-close corrections are new reversing/adjusting journal entries in an open period (`20.22`/`26.07`); the closed period's history and its closing snapshot remain unchanged.
- **Reproducibility:** any historical report is reproducible from its period's closing snapshot (or recomputable from history), so a report run today for a past period matches the original.
- Closing snapshots are the backbone of historical reporting (§5) and the bounding checkpoints for deltas (§4).

## 8. Offline & synchronization considerations

- **Devices may cache snapshots** for the user's authorized branches (B1 §6 scoping) to render offline dashboards — as **provisional, read-only** values.
- **Offline calculations are provisional:** offline figures use the B2 canonical rules so they match, but the **server is the sole authority for final balances** — snapshots are authoritative only after server-side posting + snapshot update.
- **Refresh:** device snapshots refresh on sync; stale offline snapshots are clearly provisional, never treated as confirmed balances.
- **No offline snapshot is a source of truth** — it is a cached projection of server Level-2 data, itself derived from Level-1.

## 9. Scalability strategy

- **Bounded reads:** snapshot + delta-since-watermark means a current balance touches only events since the last checkpoint, not millions of rows (resolves P4.5-03/04 at scale).
- **No duplicate truth:** snapshots are explicitly derived/disposable, so there is exactly one source of truth (Level 1) — avoids the "two stored balances drift" failure.
- **Consistent results:** determinism (B2) + watermarks ⇒ the same report yields the same numbers regardless of which snapshot/delta path served it.
- **Aligns with B3 partitioning:** snapshot cadence and period boundaries align to the date-partition boundaries of the extreme-tier ledgers, so closed partitions back closed snapshots.
- **Multi-company:** consolidation aggregates per-tenant snapshots; no cross-tenant raw scans.
- **Deferred (ODR-005):** OLAP store / read replica for very heavy analytics is a future option, not V1.

## 10. Future implementation guidance (design only)

- **Naming:** snapshot tables/values carry domain + grain + cadence (e.g. `account_balance_snapshot`, `inventory_position_snapshot`) and always include `as_of` + `watermark`. One documented convention; no ad-hoc balance columns.
- **Validation:** CI/architecture guard that no balance is hand-editable and that every stored balance has a defined rebuild path; verification routine (§6) is a required job in implementation.
- **Rebuild:** every snapshot type ships with a documented, tested full-rebuild-from-events procedure before it is relied upon.
- **Monitoring:** snapshot freshness/lag, reconciliation mismatch count (target 0), rebuild duration, delta-scan size vs B3 budgets.
- **Testing standards:** (a) rebuild determinism — delete + rebuild = identical; (b) snapshot == recompute-from-history (exact); (c) idempotent incremental under replayed events (no double-count, ties B5); (d) closed-period report reproducibility; (e) large-volume delta read stays within B3 latency budget; (f) offline provisional vs server-authoritative reconciliation.
- **No code now** — contracts and procedures only; implementation in Stage C/D.

---

## 11. Findings resolved / dependencies

- **P4.5-03** (compute-from-history without snapshots) → **Resolved (Stage B4)**: §1–§4 define the derived-snapshot layer (incremental + boundary + rebuild), making the `20.24` stored-balance a managed derived checkpoint, never editable (closes the B2-deferred item).
- **P4.5-04** (reporting scalability) → **Resolved (Stage B4)**: §5 (snapshot+delta / closing-snapshot / raw-history-for-audit), §9 (bounded reads, no duplicate truth).
- **Dependencies:** **B5** owns idempotent posting that §4 incremental snapshots rely on (P4-01). **B6** owns audit immutability for reconciliation events (§6). **B3** indexes the delta scans and snapshot tables. **Phase 7 §E** load-tests reporting at volume (P4.5-09 remains open until then).
- **No contradictions** with `20`/`22`/`26`; this spec resolves the `20.24` editable-balance conflict and supplies the reporting-scale mechanism those documents lacked.
