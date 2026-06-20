# Stage B5 — Idempotent Transactions, Offline Synchronization & Conflict Resolution Specification

**Type:** Stage B foundation specification (integrity/offline) · **Status:** Specification complete (design only)
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Resolves:** findings **P4-01** (idempotent financial posting), **P4.5-05** (conflict resolution at scale), **P4.5-06** (sync-queue growth / reconnect thundering-herd)
**Authority basis:** [ADR-001](ADR_001_Architecture_Ratification.md), [ODR-001](ODR_001_V2_to_V3_Migration_Strategy.md), [ODR-005](ODR_005_Progressive_Scaling_Strategy.md). Consolidates Section 20 (Schema), 25 (Mobile/Offline), 26 (Integration). Builds on [B1](Stage_B1_RLS_Specification.md), [B2](Stage_B2_Money_and_Financial_Precision_Specification.md), [B4](Stage_B4_Balance_Snapshot_and_Reporting_Architecture.md).
**Scope note:** architecture documentation only. **No code, migrations, SQL, sync engines, endpoints, or workers.**

---

## 0. Assumptions challenged

- **`26.10`'s conflict rule is unsafe as written for retries and financials.** It says detect duplicate → **"preserve both"** → supervisor review. For a network **retry of the same event**, "preserve both" would **duplicate inventory/journal entries** — the exact P4-01 failure. **Corrected standard:** a retry of the *same business event* (same idempotency key) is **auto-deduplicated to one commit**, never "preserve both." "Preserve both + review" applies only to *genuinely distinct* events that conflict — and **never auto-merges financial history**.
- **Device clocks are untrusted** (`26.10` already notes this). Therefore ordering/causality must **not** rely on device timestamps for correctness (§9).
- **Offline is a cache, not a second source of truth** (`26.10`/`20.29`/B4) — restated as an enforced rule here: an offline device never holds authoritative balances or final acceptance.
- **`20.29` defines a sync_queue but not exactly-once semantics.** This spec supplies the idempotency, causality, and conflict model that `20.29`/`26.10` lacked.

---

## 1. Idempotency philosophy

**A business event is recorded exactly once, regardless of how many times a device attempts to synchronize it.**

Worked case (the canonical requirement): a device sends an inventory-receiving event; first attempt commits server-side but the ack is lost; the device retries 5×. Final state: **one** inventory movement, **one** accounting impact, **one** audit record, **one** snapshot increment (B4). Never duplicate inventory, journals, or production events.

Exactly-once is achieved as **at-most-once commit (idempotency key + unique constraint) + at-least-once delivery (retry)**. Retries are safe by construction, not by luck.

## 2. Global transaction identity

Every business event carries, from the moment it is created (offline-capable):

| Identifier | Purpose |
|---|---|
| **Idempotency key** | Client-generated UUID, **one per business event**, created at the moment of the action (offline). The dedup key. Stable across all retries of that event. |
| **Local temp id** | Device-local row id before sync; maps to the server UUID after commit (`26.10`). |
| **Device id** | Registered device identity (`11.05`) — provenance + per-device sequencing. |
| **Per-device sequence** | Monotonic counter per device, for causal ordering within a device (not a global clock). |
| **Server event id (UUID)** | Authoritative permanent id assigned at commit; returned to the device. |

**Duplicate recognition:** the server enforces **uniqueness on `(company_id, idempotency_key)`**. A second arrival with an existing key is recognized as a retry: the server **does not re-commit**; it returns the original authoritative result. Identity lifecycle: `created offline → assigned sync identity → transmitted → committed (server UUID) → confirmed to device`.

## 3. Event ownership & authority

| Class | Examples | Mutation rule |
|---|---|---|
| **Append-only immutable events** | inventory movements, journal entries, production records, payroll events, audit events | **Never updated/deleted.** Corrections = new reversing/adjusting events (B4 / `26.07` / `20.22`). Idempotency key makes their creation exactly-once. |
| **Mutable business documents (pre-commit)** | drafts, pending requests, personal notes, unsubmitted quotations | May be updated locally; carry a **version**; last-writer-wins is acceptable *only while still a draft* (no financial/inventory effect yet). |
| **Submitted documents** | a submitted order/invoice/approval | Becomes an immutable event chain; further changes are new events (amendments/reversals), not edits. |

Rule of thumb: **anything with an inventory, financial, or audit effect is append-only and idempotent**; only effect-free drafts are freely mutable.

## 4. Offline data model

- **What may be cached:** only data the user is authorized to read for their **assigned branches** (B1 §6) + the user's personal workspace. Reference/master data for those branches; recent operational context. **Never** the entire accounting DB, all salaries, or company-wide confidential reports (`26.10`).
- **Branch restriction:** cached rows retain `company_id`/`branch_id`; offline scope = the device user's authorized branches at last sync. No new branch access offline (`11.05`).
- **Expiration / lifecycle:** cache has a TTL and a freshness marker; stale caches are flagged; on revocation, scoped data is purged on reconnect (B1 §6).
- **Storage limits:** bounded local footprint (oldest non-pending data evicted first); **pending (unsynced) events are never evicted** until confirmed (data-safety, ties Phase 3.5 P3.5-05).
- **Not a source of truth:** offline storage is a temporary operational cache; authoritative state lives server-side only.

## 5. Synchronization lifecycle

```
Create locally (assign idempotency key + local temp id)
   ↓
Validate locally (provisional business rules; B2 money rules for display)
   ↓
Enqueue (sync_queue, status=Pending)
   ↓
Transmit batch to server
   ↓
Server: authentication + RLS authorization (B1)        ← rejects out-of-scope
   ↓
Server: idempotency check (company_id, idempotency_key) ← retry → return prior result, stop
   ↓
Server: causal readiness check (§9)                    ← dependency missing → hold (Pending-Wait)
   ↓
Server: business validation (stock, period open, balances)
   ↓
Commit immutable event (atomic with its financial posting + snapshot delta, B2/B4)
   ↓
Return authoritative result (server UUID, final effect)
   ↓
Device: map local temp id → server UUID, mark Confirmed
```

Each queued event is processed **independently and idempotently**, so a batch can partially succeed safely (§10).

## 6. Conflict classification

| Class | Example | Default handling |
|---|---|---|
| **Retry (not a real conflict)** | same idempotency key arrives again | **Auto-dedup** → one commit, return prior result (§2) |
| **Data conflict** | two users edit the same *draft* | Version check; last-writer-wins for drafts, or surface to user if both submitted |
| **Inventory conflict** | two branches/devices act on stale stock; would oversell | Server re-validates against authoritative balance; if shortage → **block or manual** (§7) |
| **Permission conflict** | user loses permission/branch access while offline | Server rejects on sync (B1); event quarantined for review, not committed |
| **Time / ordering** | dependent events arrive out of sequence | Causal hold + reorder (§9); never trust device clock |
| **Financial / period** | event targets a **closed** accounting period | **Never auto-applied**; rejected → adjustment in an open period (B4/§7) |

## 7. Conflict resolution rules

- **Automatic resolution — only when deterministic and safe:** identical retries (same key) → dedup; idempotent re-application that yields the identical committed result. That is the safe automatic set.
- **Deterministic merge — narrow, non-financial:** independent fields of a mutable draft may merge if provably non-conflicting. Not for any effecting event.
- **Manual resolution — required for:** inventory shortages, financial discrepancies, conflicting approvals, closed-period/regulatory records, and any genuine semantic conflict between distinct events. Routed to an authorized reviewer with full context + audit (§11).
- **Hard rules:** the system **never silently changes financial history**; financial conflicts are **never** auto-merged or "preserved both"; a true duplicate is **never** preserved as two. This directly corrects `26.10` (§0).
- **Scale of manual review (P4.5-05):** because true retries auto-dedup and only genuine conflicts escalate, the human-review queue is bounded by *actual* business conflicts, not by sync volume — so the review path scales (it was the unbounded part of `26.10`).

## 8. Server authority model

- **The server is the final authority.** Offline devices may **propose** transactions, run **provisional** validation, and **display estimated** results (B2 rules) — nothing more.
- The server alone determines **final acceptance, final inventory impact, final accounting impact, and final audit history**. A provisional offline result is never treated as confirmed until the server returns the authoritative result (§5).
- Consistent with B4: balances are server-derived; offline shows provisional projections only.

## 9. Ordering & causality

- **Dependency-aware application:** an event referencing a parent (harvest → crop block; payment → invoice; movement → item/batch) is committed only after its dependency exists server-side. Missing dependency ⇒ **hold in a causal-wait state** and retry when the parent arrives — **not** reject (the parent may simply be later in the same offline batch).
- **Ordering key is causal, not chronological:** use per-device sequence + explicit parent references to order dependent events; **device timestamps are recorded but not trusted for correctness** (`26.10` clock rule). Offline creation time is metadata/audit, not an authority for ordering.
- **Idempotent + causal** together mean events can arrive late, repeated, or out of order and still converge to one correct state.

## 10. Sync failure & recovery

- **Partial batch:** per-event idempotency means a batch that fails midway is re-sent wholesale safely — already-committed events dedup, only the unprocessed ones commit.
- **Retry policy (P4.5-06):** **exponential backoff with jitter**, client batching, and server-side **backpressure / rate-limiting** so a mass reconnect (many devices after a regional outage) does not thundering-herd the DB. Critical entities may be prioritized in the queue.
- **Dead-letter queue:** events failing permanently (e.g. repeated validation failure, unresolved conflict) move to a dead-letter state for investigation — never silently dropped, never blocking the rest of the queue.
- **Administrative recovery tools:** authorized, audited tools to inspect, re-drive, or resolve dead-lettered/quarantined events; all actions audited (§11). No tool can edit committed financial history (only reverse/adjust).

## 11. Audit & traceability

Every synchronized event records: **original device**, **original creator (user)**, **offline creation time** (metadata), **server acceptance time** (authoritative), **synchronization history** (attempts, statuses), and **resolution actions** (auto-dedup, manual decision, dead-letter). Audit records are immutable (B6) and tenant-scoped (B1). This makes every event answerable to the `26.01`/`11.04` questions: who, which company/branch, what, when (server time), why, how.

## 12. Testing & validation standards (required)

1. **Same transaction sent 100×** → exactly **one** commit (inventory, journal, audit, snapshot).
2. **Device offline 30 days** → full queue drains correctly on reconnect; bounded by backpressure.
3. **Two devices modifying related records** → causal ordering holds; genuine conflict escalates, retries dedup.
4. **Network interruption during financial posting** → no duplicate/partial journal; either fully committed once or safely retried.
5. **Thousands of sync events / mass reconnect** → no thundering-herd collapse (backpressure/backoff); throughput within B3 budgets.
6. **Out-of-order dependents** (harvest before crop block) → held then applied; never wrongly rejected or duplicated.
7. **Permission revoked while offline** → queued out-of-scope events rejected at sync (B1); quarantined, not committed.
8. **Closed-period event** → rejected; correction via adjustment in open period (B4).

These extend `26.13` stress scenarios with **load + idempotency** dimensions (the gap noted in P4.5-09).

## 13. Future implementation guidance (design only)

- **Sync queue architecture:** durable per-device queue (`20.29`) with statuses Pending / Pending-Wait (causal) / Uploading / Confirmed / Conflict / Dead-letter; tenant-indexed (B3).
- **Idempotency key management:** client generates at action time; server unique constraint `(company_id, idempotency_key)`; keys retained long enough to cover max offline window (≥ the 30-day test) + margin.
- **Retry/backpressure:** exponential backoff + jitter; batch size limits; server rate-limit; priority lanes for critical entities.
- **Monitoring/dashboards:** queue depth per device/branch, oldest-pending age, conflict rate, dead-letter count (target low), dedup hit rate, sync latency — feeding B3 §9 governance.
- **Testing:** §12 scenarios are a mandatory gate before any offline-write module ships (Stage D/E).
- **No code now** — contracts and policies only.

---

## 14. Findings resolved / dependencies

- **P4-01** (idempotent financial posting) → **Resolved (Stage B5)**: §1–§3, §5 (idempotency key + unique constraint + at-most-once commit, atomic with posting/snapshot), §7 hard rules. Corrects the `26.10` "preserve both" hazard.
- **P4.5-05** (conflict resolution at scale) → **Resolved (Stage B5)**: §6–§7 tiered model — auto-dedup retries, narrow deterministic merge, human review only for genuine conflicts → review queue bounded by real conflicts, not sync volume.
- **P4.5-06** (sync growth / thundering herd) → **Resolved (Stage B5)**: §10 (backoff+jitter, batching, backpressure, dead-letter, priority) + §4 bounded cache.
- **Dependencies:** **B4** snapshot increments rely on §1–§2 idempotency; **B1** authorizes every sync; **B2** governs the money in committed events; **B6** provides audit immutability for §11. **Phase 7 §E** load-tests §12 at volume (P4.5-09 remains open until load testing executes).
- **No contradictions** with B1/B2/B4; **corrects** `26.10`'s conflict rule (documented in §0) to prevent duplicate financial/inventory effects.
