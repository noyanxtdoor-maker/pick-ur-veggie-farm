# Phase 2 — M2E · POS Prototype-Logic Parity (design)

**Type:** Milestone design (High-risk: changes the charged price) · **Status:** implementing · **Date:** 2026-07-02 ·
**Branch:** `feature/phase-0-foundation`
**Owner decision (2026-07-02):** *"fully follow the logic of the google ai mock app … our architecture plans is
still considered."* → the AI Studio prototype (`src/features/POS.tsx`/`src/lib/money.ts`) is the **workflow-logic
authority**; the enterprise reconciliation (M2 spec SECTION 0, Systems 20/22/26) stays the **structural authority**.
Every gap below is prototype behavior the V3 app lacked.

## 1. The parity gaps (prototype → V3)

| # | Prototype logic (authoritative) | V3 before M2E | M2E disposition |
|---|---|---|---|
| 1 | **Charged price = farm price** `round2(retail × (1−0.10))`; grid shows farm ₱/kg + struck-through retail; slip shows "Farm Discount Saved" = retailLine − lineTotal; receipt prints "Applied 10% farm discount — saved X" | charges `retail_per_kg` (deviation was flagged in M2B, owner deferred) | **Server-side farm pricing** in `pos_record_sale` (constant 0.10, mirror of `DISCOUNT`); `retail_unit_price` snapshot per line for the saved math |
| 2 | **Skip Weigh (Bulk Flat Price)** — bulk wholesale line: `weightKg null`, cashier-entered flat price, name "X (Bulk Pre-order)"; sale `type='wholesale'` when any bulk line | no bulk path (weight > 0 mandatory) | bulk lines `{product_id, bulk_price}`: flat revenue, `is_bulk`, **no inventory movement, no COGS** (see §3) |
| 3 | Pre-order 10% discount computed on the (farm-priced) cart total — **stacks** with the farm discount; + delivery fee | discount applied on retail subtotal | unchanged code path; subtotal is now farm-priced → matches mock formula exactly |
| 4 | Journal: **Sale Type filter** (retail/wholesale) + type pill, **Posted By** column, **CSV export** | date + status filters only | add all three; type derived from `is_bulk` items; posted-by = display-name snapshot (cache) / `created_by` (canonical) |
| 5 | **Crop Pricing Menu** (POS edit access): add vegetable (name + retail ₱/kg), edit price, delete | no price-book UI at all (products only seeded) | modal gated `product.manage`, using the existing M2A client write grants — **no migration needed**; "Delete" maps to **Archive** (enterprise no-hard-delete; status='Archived' drops it from the grid) |
| 6 | Receipt: Cashier line + "Permit Type: Retail PAID / Pre-Order delivery" | absent | added to the slip render |
| 7 | Dashboard `netSales(retail, wholesale)` | paid/pre-order split only | insights adds Retail vs Wholesale row |

## 2. DB change (one additive migration; locked files untouched — M2C pattern)

`20260702180000_p2m2e_prototype_pricing_parity.sql`:
- `sales_order_items` **+** `retail_unit_price numeric(12,2)` (retail snapshot; null for bulk), `is_bulk boolean
  not null default false`, `description text` (bulk name snapshot); `alter column finished_goods_batch_id drop
  not null` (bulk lines have no batch).
- **`pos_record_sale` recreated** (same signature): weighed line charges `round(retail × 0.90, 2)` — the server
  remains the *only* price authority (clients still send no prices); bulk line accepts `bulk_price > 0`
  (negotiated wholesale — the ONLY client-priced path, exactly the mock's workflow), posts revenue with **no
  movement / no COGS**; pre-order discount/fee math unchanged (now stacks on the farm subtotal, mock formula).
- **`pos_void_sale` recreated**: stock-return loop skips `finished_goods_batch_id is null` (bulk) lines;
  reversal amounts otherwise unchanged.

## 3. Reconciliation notes (honest deviations, owner-visible)

- **Bulk lines skip the inventory ledger.** The mock has no weight for bulk sales, so no kg can be deducted
  (20.09 movements are quantity-based). Physical stock is corrected later via `inventory.adjust`
  (22.16 impact deferred, not faked). Ceiling: if bulk-by-weight is ever needed, add an optional
  `bulk_weight_kg` to the line and it becomes a normal movement.
- **Bulk price is client-entered by design** (negotiated wholesale price — the mock's workflow); it is bounded:
  `pos.sell` + branch membership + `> 0` + append-only + audited. Weighed lines remain fully server-priced.
- **Prototype "Delete crop" → Archive** (no hard delete anywhere in the ERP; archived products keep historical
  sales valid and disappear from the grid).
- The 10% farm discount is a **constant in the sale function** (mirror of the mock's `DISCOUNT = 0.10`);
  making it a price-book/company setting is a future additive migration when the owner wants it configurable.

## 4. Guard + verification

`guard:pos` updated to the farm-priced expectations (2 kg @ ₱150 retail → ₱270 revenue; pre-order 270 −10% +20 =
₱263; settle change 237; void reversal 740) **plus** new assertions: bulk sale posts balanced revenue with zero
movements/COGS; `bulk_price <= 0` rejected; mixed weighed+bulk sale deducts only the weighed stock. Cadence:
db reset → all guards → tsc/vitest/build → **browser E2E** (farm-priced weighed sale w/ saved line, bulk pre-order,
journal type filter + CSV, pricing menu add/edit/archive, dashboard split) → LOCAL commit → owner push gate →
cross-vendor money review before lock (charter §4.6).
