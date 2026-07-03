# Phase 2 — Module 4D: Statement of Cash Flows (spec)

**Type:** Module spec (extends M4 Accounting) · **Status:** Built + guard-proven · **Date:** 2026-07-03
**Authorized by:** owner's B3 accounting-reports arc (continues M4C). **Structural authority:** Systems 22.22 / 22.04.

## 1. What this is
A direct-method **Statement of Cash Flows** — the last of the M4-spec-§2 deferred statements. One new **read-only**
GL function (`cash_flow_statement`) plus a "Cash Flows" statement in the Accounting → Financial Statements tab.

## 2. Method (why it always ties)
Every journal **entry** that moves CASH is classified into exactly one activity + line by the counterpart accounts
in that same entry, and the entry's net cash delta (Σ CASH debit − credit) is attributed to it:
- **Investing** ⇐ counterpart `EQUIPMENT`
- **Financing** ⇐ counterpart `OWNER_EQUITY` or `LOANS_PAYABLE`
- **Operating** ⇐ everything else (customer receipts, supplier payments, employee payments, other income)

Because each cash-moving entry lands in exactly one bucket, **Operating + Investing + Financing = Closing − Opening
cash** by construction — the statement reconciles, it is not asserted to. Opening cash = net cash movement strictly
before the period (0 for the all-time view); Closing = Opening + net change.

## 3. Scope
- **Migration `20260703170000_p2m4d_cash_flow_statement.sql`** — one `stable security definer` function,
  `accounting.read`-gated, `p_company / p_branch_id / p_year` (year null = all-time). **No table, no new permission,
  no posting path** (reads the already-posted GL). Additive; no locked file touched.
- **Mock mode** (`mockCashFlowStatement` in mockLedger.ts) — reconstructs the same classification from the raw
  Dexie caches, so the offline/demo view matches. All-time (no as-of filter), Opening = 0.
- **UI** — a "Cash Flows" statement: Operating/Investing/Financing sections with line items + subtotals, Net change
  in cash, and the Opening→Closing reconciliation, with a visible warning if it fails to reconcile.

## 4. Verification
- **Guard (`scripts/guards/accounting-security.sql`, now 19 PASS):** posts an equipment purchase and asserts
  (1) Operating+Investing+Financing = Closing − Opening, (2) Closing = the balance sheet's independently-derived
  CASH balance, (3) the equipment purchase classifies as Investing −8000, (4) owner investment makes Financing a
  net inflow, and (5) a worker without `accounting.read` is denied. `supabase db reset` clean; **full guard suite
  green** (static/db/rls 23/bootstrap 8/org 13/crop 11/inventory 24/pos 18/accounting 19/payroll 14/scheduling 8/
  projects 7/drift).
- **App:** `tsc` clean · `vitest` **65/65** (mock cash flow: classification + ties to ₱39,270 closing) · build OK.
  Browser E2E: Cash Flows statement renders and reconciles (₱0 opening + ₱270 operating = ₱270 closing).

## 5. Still deferred (M4 spec §2)
Cost Schedule and vendor/customer subledgers — the latter wait on customer/supplier masters (backlog B1).
