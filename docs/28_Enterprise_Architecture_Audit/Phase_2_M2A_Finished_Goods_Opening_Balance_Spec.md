# Phase 2 — Module 2A · Finished-Goods & Opening-Balance Spine (POS prerequisite)

**Type:** Operational module specification (design only — **no code, no migration, no schema, no UI**) ·
**Status:** 🟠 **PROPOSED — POS co-requisite; awaiting owner review** · **Date:** 2026-06-23 · **Branch:** `feature/phase-0-foundation`
**Authority basis:** `POS_Enterprise_Reconciliation_Audit.md` §0.4 + Systems **20.15** Harvest Batch Traceability ·
**20.16** Finished Goods Inventory · **20.09** Inventory Movement Ledger · **03.02/03.03** Harvest/FIFO ·
**22.16/22.19** Inventory-Accounting/COGS · **ODR-001** (V3 opening state) · locked **M1–M6** + **P2-M2**
(`is_branch_member`, audit trigger) · **B5** offline · **B2** NUMERIC.

> **Why this exists.** The POS reconciliation proved a sale **cannot exist without finished-goods stock** to deduct
> (20.17 revenue-integrity; 20.16/20.09 "balances come only from movements"). POS therefore has a **co-requisite**: a
> *thin* finished-goods + movement-ledger spine, seeded by an **opening balance** (ODR-001), so the farm can start
> selling existing harvested produce without first building the full Production module. This is the **minimum** of
> Systems 03/20 that POS needs — **not** the full Inventory module (that is a later, larger module).

---

## 1. Scope (deliberately minimal)

**In scope (only what POS must deduct against):**
- `finished_goods_batches` (20.16) — the sellable produce stock.
- `inventory_movements` (20.09) — the **single source of truth** for finished-goods balances (Opening, Sales, Adjustment, Disposal).
- `harvest_batches` (20.15) — minimal, incl. an **Opening-Balance origin** so 20.16's "every finished good links to a harvest batch" holds without the Production module.
- An **opening-balance procedure** (ODR-001) and the **POS deduction + COGS** contract.

**Out of scope (deferred to the full Inventory/Production modules):** purchase/receiving (20.12), raw-material inventory
(03.01/20.07), unit conversion (20.10), branch transfers, production events (20.14), crop blocks/biological assets
(20.13), grading/packaging workflows, full FIFO across many batches at scale, reservations beyond a simple hold.

---

## 2. Entities (reuse / extend the canonical schema — minimal columns)

| Table | Authority | Minimal columns for this spine | Notes |
|---|---|---|---|
| `harvest_batches` | **20.15** | id, company_id, branch_id, harvest_code, **origin** (`field_harvest` \| `opening_balance`), crop_id?/variety_id? (nullable for opening), net_weight, production_cost, cost_per_kg, status, audit | Opening rows satisfy traceability without a crop block; `crop_block_id` **nullable only when origin=opening_balance** (relaxes 20.15's "no harvest without a crop block" *solely* for ODR-001 opening stock — flagged). |
| `finished_goods_batches` | **20.16** | id, company_id, branch_id, finished_goods_code, **harvest_batch_id** (FK, same-company), product_id/variety_id, product_name, unit_of_measure (kg), cost_per_unit (NUMERIC), status (Available/Reserved/Sold/Expired), audit | **No quantity columns are authoritative** — qty is **derived from `inventory_movements`** (20.16: "manual quantity changes prohibited"). |
| `inventory_movements` | **20.09** | id, company_id, branch_id, **item/finished_goods_batch_id**, movement_type (`Opening`\|`Sales`\|`AdjustmentIncrease`\|`AdjustmentDecrease`\|`Disposal`), quantity (NUMERIC), unit_cost, total_cost, **source_document_type** (`OpeningBalance`\|`SalesInvoice`\|`Adjustment`), source_document_id, approved_by, created_by, created_at, reason | The **balance ledger**; append-only; never deleted; corrections = reversal/adjustment movements (20.09). |

**Derived balance (20.09 rule):** `available = Σ inbound − Σ outbound` over `inventory_movements` for a finished-goods
batch. No manually-stored quantity is trusted; "if inventory changed but no movement record exists, the data is
invalid" (20.09).

---

## 3. Opening-balance procedure (ODR-001)

A governed, audited, one-direction-safe entry to establish starting stock from a physical count:
- `record_opening_finished_goods(branch_id, items[])` — SECURITY DEFINER, `search_path=''`, gated by **`inventory.opening`**
  (high-risk → reason mandatory + audit, per 20.09 adjustment-protection). For each item it atomically:
  1. creates (or reuses) an **`opening_balance` harvest_batch** (cost basis = the verified opening cost),
  2. creates the **`finished_goods_batches`** row (cost_per_unit),
  3. records an **`inventory_movements`** row (`movement_type=Opening`, `source_document_type=OpeningBalance`, quantity,
     unit_cost, approved_by, reason),
  4. (when Accounting GL is live) posts the opening inventory asset (Dr Finished-Goods Inventory / Cr Opening Equity),
     per 22.16/26.07 — else records the financial_accounts/journal stub the spine requires.
- **Idempotent** on `(company_id, idempotency_key)` (B5); **branch-scoped** (`is_branch_member`); **audited** (M5).

---

## 4. POS integration contract (what POS calls — no parallel tables)

On `pos_record_sale()` (POS spec §0.2), per sale line the governed function **also**:
- selects available finished-goods (FIFO across batches, **03.03/22.19**) for the product;
- writes an **`inventory_movements`** row (`movement_type=Sales`, `source_document_type=SalesInvoice`,
  `source_document_id=<invoice id>`, quantity = sold kg, unit_cost = batch cost) → **decrements available** (derived);
- releases **COGS** = Σ(quantity × unit_cost) for the journal (Dr COGS / Cr Finished-Goods Inventory), atomic with the sale;
- **rejects the sale if available < quantity** (20.17 revenue-integrity: "a sale cannot exceed available inventory").

Reservation (optional, simple): a pre-order may place a `Reserved` hold (a movement or status) so concurrent sales
can't oversell the same stock; full reservation semantics deferred to the Inventory module.

---

## 5. Cross-cutting (reuse locked foundation)
- **Authorization (26.09 → M4):** `inventory.read` (member-scoped), `inventory.opening` (Owner/Accountant; high-risk),
  `inventory.adjust` (approval). POS deduction runs inside `pos_record_sale` (gated `pos.sell` + `is_branch_member`).
- **Branch isolation (P2-M2):** finished-goods + movements are **branch-owned** (`is_branch_member(branch_id)`); a
  branch sells only its own stock.
- **Audit (M5):** every opening, sale-deduction, adjustment, disposal → immutable `audit_events` (SECURITY-DEFINER
  trigger, the P2-M2 pattern).
- **Offline (B5):** opening entries + sale deductions carry idempotency keys; `(company_id, idempotency_key)` unique;
  at-most-once.
- **Money (B2):** all cost/qty NUMERIC; no float.

---

## 6. Security attack surface (→ extends `guard:pos` / a `guard:inventory`)
| Attack | Defense |
|---|---|
| **Oversell** (sell more than on hand) | derived balance check in `pos_record_sale`; `available < qty` → reject (20.17). |
| **Manual balance edit** | no authoritative quantity column; balance only from `inventory_movements` (20.09/20.16); no UPDATE grant on movements. |
| **Phantom stock** (finished goods with no movement) | architecture rule (20.09): no movement ⇒ invalid; opening requires the governed function. |
| **Cross-branch / cross-tenant stock** | `is_branch_member` + composite FKs (same-company harvest/finished-goods). |
| **Unapproved / unaudited opening** | `inventory.opening` permission + mandatory reason + M5 audit (20.09 adjustment-protection). |
| **History rewrite** | movements append-only; corrections = reversal/adjustment movements, never delete (20.09). |
| **Negative / zero quantity** | CHECK quantity > 0 on movements; cost ≥ 0. |

---

## 7. Implementation placement
This spine is **M2A** (the POS reconciliation's revised plan): build the finished-goods + movement ledger + opening
procedure **first**, then **M2B** layers `pos_record_sale` (sales_order + invoice + Sales movement + COGS + journal)
on top. Same cadence: build → attack (`guard:inventory`/`guard:pos`) → verify (db reset + guards + tsc/test/build) →
local commit → CI → lock. **No locked migration modified.**

---

## 8. Open decision for the owner (flagged, not assumed)
**Opening-balance traceability relaxation.** 20.15 says "no harvest without a crop block." To let the farm sell its
*current* produce before the Production module exists, this spec allows `harvest_batches.crop_block_id` to be **null
only for `origin='opening_balance'`** rows. Alternatives: (a) build a minimal crop-block stub now, or (b) accept the
opening-origin relaxation (recommended — matches ODR-001 "migrate opening balances, start a clean ledger"). **Owner
decision required before M2A migration.**

---

## Status
Design-only; **no code, migration, schema, commit, or push.** This is the POS prerequisite spine; it + the reconciled
POS spec (`Phase_2_M2_POS_Operational_Specification.md` §0) define M2A/M2B. Implementation begins only on explicit owner go.
