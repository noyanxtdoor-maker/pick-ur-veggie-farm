# Phase 2 — M2D · Dashboard & Reporting Reads (design)

**Type:** Milestone design (reads only — **no migration, no schema, no new permissions**) · **Status:** implementing ·
**Date:** 2026-07-02 · **Branch:** `feature/phase-0-foundation`
**Authority:** `Phase_2_M2_POS_Operational_Specification.md` §0.5 / §8 / SECTION 10 (M2D row) · prototype
`src/features/Dashboard.tsx` (workflow + visual authority) · Systems **20.17** (sale objects) / **20.22** (GL) /
**26.09** (permission-gated reads) · M1C §4 global states.

## 1. Scope decision — app-only, zero new attack surface

M2D is **reads over objects M2A–M2C already secured**. Every read target already carries a member-scoped SELECT
policy: `invoices`/`sales_orders` (`is_branch_member`), `sales_order_items` (`accessible_company_ids`), `products`
(member), `users` (`user.read`, M4). Therefore:

- **No migration.** No new tables, views, functions, permissions, or RLS. Locked migrations untouched.
- **Branch scope = the branches the user is a member of** (what RLS returns). Cross-branch reporting for
  non-member owners stays **reserved** behind the future `pos.read.all` (M2 spec §4 note) — not built now.
- **Aggregation is client-side.** Volumes are small (spec §1: 50–300 sales/day/branch); a 30-day window is a few
  thousand rows. `ponytail:` client-side aggregation; the upgrade path when volumes hurt is a read-only SQL
  reporting function — a later additive migration, not a rewrite.

## 2. Data source matrix (same seam as posApi)

| Mode | Source |
|---|---|
| MOCK | Dexie `posInvoices` (existing local cache; single demo cashier) |
| real + online | canonical selects: `invoices` (period + all `Unpaid`), `sales_order_items` + embedded `sales_orders!inner(order_date)` (period filter), `sales_orders` (discount/fee), `products` (names), `branches`, `users` (only when `user.read`) |
| real + offline | Dexie `posInvoices` fallback, honestly labeled “this device” |

Voided-order exclusion for line items is done client-side from the invoices result (invoice ↔ order is 1:1);
`sales_order_items` has no FK to `products` (M2B), so product names are mapped client-side from `fetchProducts`.

## 3. Deliverables

1. **`fetchSalesReport(companyId, sinceIso)`** in `app/features/pos/api.ts` — returns normalized sale rows +
   line rows per the matrix above.
2. **Pure aggregation** `summarizeSales(...)` (exported, unit-tested): excludes `Voided` everywhere; KPIs
   (today volume/orders), 7-day trend buckets, paid/pre-order/pending split, discounts given, delivery fees,
   top products by ₱ and by kg, totals by branch and by cashier, outstanding receivables (= **all** `Unpaid`,
   a balance not a flow).
3. **Dashboard** (`app/pages/Dashboard.tsx`), prototype-faithful bento layout, farm theme:
   - KPI row: Daily Sales Volume · Market Orders · Top Crop Today · **Outstanding Receivables** (Branches tile
     moves to the org row). **Fixes an M2D-scope bug: today’s KPIs currently include `Voided` invoices.**
   - **7-Day Branch Sales Volume Trend** — recharts `AreaChart` (dep already installed). The prototype’s
     `Math.random()` backfill for empty days is demo dressing and is **not** ported — real zeros render as zeros.
   - **Sales insights panel** with a period selector (**Today / 7 Days / 30 Days**) governing: split,
     discounts/fees, top products (₱ + kg), sales by branch, sales by cashier (names only under `user.read`,
     else short ids).
   - **Quick Ledger stream** — most recent sales (slip#, time, total, status) linking to the POS journal.
   - **Reserved (integration contracts, per M2 spec M2D row):** Low-Stock tile + Inventory-Turnover chart →
     Inventory module; Active Roster Staff → Payroll. Not mocked, not faked; noted here as the contract.

## 4. Verification (cadence)

No DB change ⇒ guard suite unaffected (still must stay green). App gate: `tsc` · `vitest` (existing 14 + new
aggregation tests) · `build` · **browser E2E in mock mode** (seed → paid sale + pre-order + void → dashboard
shows correct KPIs/trend/breakdowns; receivable appears; voided excluded). Local commit; owner push gate; CI audit.
