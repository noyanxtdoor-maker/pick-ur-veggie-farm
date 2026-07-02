# Phase 2 — Module 3 · Inventory (Materials & Equipment) — reconciled specification

**Type:** Operational module design · **Status:** implementing (M3A) · **Date:** 2026-07-02 ·
**Branch:** `feature/phase-0-foundation`
**Authority:** prototype `src/features/Inventory.tsx` = **workflow-logic authority** (owner standing decision
2026-07-02) · Systems **20.07** item master / **20.08** batches+FIFO / **20.09** movement ledger / **20.11**
partners / **20.12** purchase receiving / **20.25** equipment assets / **22.16** inventory-accounting sync =
**structural authority** (System 03 files are one-line stubs; 20.x carries the substance). Foundation reused:
M1–M6 + P2-M2 `is_branch_member` + **M2A movement-ledger pattern** + M2B GL spine.

## 1. Scope — what the mock actually does (and V3 must do)

Two tabs. **Consumables & Seed Stocks:** "Add Material/Expense Purchase" (date, Consumables|Equipment, category
[Seeds/Seedlings · Substrate & Nutrients · Packaging · Water/Electricity · Transport · Miscellaneous], item
description w/ autocomplete from past purchases, qty pcs, online[Lazada/Shopee/TikTok]|physical source + contact,
total ₱) → live per-category stock cards (Σ pcs, cumulative ₱, last restock + source, Quick Restock prefill),
low-stock alert vs a configurable limit (default 10), and **Manual Stock Audit Adjustment** (± qty, reason
MANDATORY, zero acquisition cost). **Heavy Equipment:** purchase auto-registers the asset; catalog table
(OPERATIONAL/OUT-OF-ORDER, cost, last checked); **condition checklist** (working|broken, needs-maintenance flag,
inspector, remarks) appending to an inspection history log. Purchases "log as a cost transaction in accounting".

## 2. Canonical mapping (anti-"second ERP", same discipline as the POS audit)

| Mock concept | Canonical structure | M3 disposition |
|---|---|---|
| Purchase entry | **20.12** receiving → batch → movement ("stock increases only via receiving") | governed `inventory_record_purchase()` = minimal **direct receiving** (header + batch + movement + GL, atomic). The PO/approval pipeline (Draft→Approved→Ordered→Partial) is enterprise depth the mock lacks → **deferred additive**; `purchase_order_id` reserved nullable. |
| Category cards (Σ pcs) | **20.07** `item_categories` → `inventory_items` (master defines identity, never quantity) | real tables, mock's 6 categories + Equipment seeded idempotently per company (`inventory_ensure_categories`, chart-of-accounts pattern); items find-or-created by (category, name) at purchase; UI aggregates item balances to category cards. |
| Live counts | **20.09** ledger = single source of truth | REUSE the locked M2A `inventory_movements` table — **additive alter**: nullable `item_id` + `material_batch_id`, movement_type CHECK extended (+`PurchaseReceiving`), CHECK exactly-one-of (fg batch | material batch). Balance = derived (`material_available()`), never stored. |
| FIFO | **20.08/03.03** | `material_batches` (branch-owned; NO remaining qty column — derived, M2A pattern); negative adjustments (and future production consumption) drain oldest received batch first, one movement per batch drained. |
| Audit adjustment | **20.09** adjustment protection | `inventory_adjust_material()`: reason mandatory; increase = zero-cost batch (found stock, conservative); decrease = FIFO drain + **Dr SHRINKAGE / Cr RAW_MATERIALS at FIFO cost** — the mock posts no value on adjustments, but money treatment follows the enterprise rule (22.16); reuses the existing `inventory.adjust` permission. |
| Low-stock limit | **20.07** `reorder_level` per item | per-item `reorder_level` (default 10 = the mock's default); UI alerts when item/category balance ≤ level. |
| Accounting note | **22.16/22.06** | purchase posts atomically: Dr **RAW_MATERIALS** (Consumable) or **EQUIPMENT** (asset) / Cr **CASH** (mock pays cash on purchase; AP comes with Accounting). `inventory_ensure_accounts()` adds RAW_MATERIALS/EQUIPMENT/SHRINKAGE to the M2B chart. |
| Equipment + checklist | **20.25** `equipment_assets` + `equipment_maintenance_logs` | asset auto-registered on Equipment purchase (condition Good); `equipment_log_check()` appends the log + updates condition (working→Good, needs-maint→Needs Maintenance, broken→Broken). Depreciation/IoT fields deferred. |
| Source / supplier | **20.11** business_partners | NOT built yet (mock uses free text + platform dropdown): source_type/name/contact **snapshotted on the receiving**; `supplier_id` reserved nullable for the future partners master (Accounting/AP phase). |

**Explicitly out of M3 scope** (recorded, not forgotten): PO approval workflow, business_partners master, unit
conversion (20.10 — everything is `pcs` in the mock), expiration tracking, branch transfers, depreciation.
**Finished goods stay on the locked M2A spine** (`products`/`finished_goods_batches`) — the 20.07 ideal of one
item master covering finished goods is a possible future unification, not a rebuild now (minimal change).

## 3. New permissions (26.09-additive)

`inventory.purchase` (record material/equipment purchases) · `equipment.manage` (register/checklist equipment).
`inventory.adjust` (exists since M2A) gates adjustments. Reads = `is_branch_member` (items/categories: company member).

## 4. Milestones

| Milestone | Scope |
|---|---|
| **M3A — DB spine** | migration `p2m3a_materials_inventory`: tables (`item_categories`, `inventory_items`, `material_batches`, `purchase_receivings`, `equipment_assets`, `equipment_maintenance_logs`) + ledger alter + 3 governed functions + `material_available()` + accounts + permissions; `guard:inventory` extended (same CI step). |
| **M3B — UI** | prototype-parity Inventory screen (tabs, category cards + low-stock, purchase modal w/ autocomplete + Quick Restock, audit modal, equipment table + checklist + history); Dashboard **Low-Stock tile becomes real** (was reserved in M2D); mock adapter + Dexie v4; nav entry. |

**Verification cadence (unchanged):** db reset → all guards (static/db/rls/bootstrap/org/crop/**inventory+M3A**/pos/drift)
→ tsc/vitest/build → browser E2E (M3B) → LOCAL commit → owner push gate → CI audit → lock.
