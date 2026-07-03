# Phase 2 — Module 4 · Accounting — reconciled specification

**Type:** Operational module design · **Status:** implementing (M4A) · **Date:** 2026-07-03 ·
**Branch:** `feature/phase-0-foundation`
**Authority:** prototype `src/features/Accounting.tsx` (89KB) = **workflow-logic authority** (owner standing
decision 2026-07-02) · Systems **22.02** financial boundary / **22.03** chart of accounts / **22.04/22.05** GL +
double-entry / **22.06** automatic posting / **22.09** cash management / **22.22** statement generator / **22.24**
audit trail & record lock / **26.09** permission matrix = **structural authority**.

## 1. The central reconciliation finding (anti-"second ERP", same discipline as POS/Inventory)

The mock **recomputes financial statements by re-scanning raw source tables** (`transactions`, `expenses`,
`wages`, `cashEntries`) every render — it has no GL. **V3 already has a real, posted GL** (`journal_entries` +
`journal_lines`, built in M2B and posted-to automatically by every POS sale/settlement/void and every M3A
purchase/adjustment — exactly 22.06 "automatic ERP transaction posting"). Therefore Module 4's job is **not** to
build a parallel computation — it is to (a) close the one remaining posting gap (non-operating cash movements
the mock calls "Cash Ledger"), and (b) **read the real GL** to produce the statements the mock displays. This is
strictly better than the mock: V3's numbers are provably balanced and traceable to a journal entry; the mock's
are a same-render recomputation with no ledger to audit against.

## 2. Canonical mapping

| Mock concept | Canonical structure | M4 disposition |
|---|---|---|
| `transactions`/`expenses` (COGS, revenue) | already posted GL (M2B/M2E `pos_record_sale`, M3A `inventory_record_purchase`) | **REUSE — no new write path.** Income statement reads `journal_lines` grouped by account + month. |
| `cashEntries` (Owner Investment / Other Income / Loan Received / Loan Payment / Owner's Drawings) | **22.09** cash management — "cash movement automatically updates Debit Cash / Credit related account" | **NEW, minimal:** `cash_entries` header table (mirrors the `purchase_receivings` pattern) + governed `record_cash_entry()` posting the balanced journal. **"Equipment Purchase" is explicitly excluded** from the categories here — it is already `inventory_record_purchase`'s domain (Dr EQUIPMENT/Cr CASH); adding a second manual path to the same GL effect would be exactly the "second ERP" duplication this reconciliation exists to prevent. |
| Mock "Delete cash entry" | **22.24** — approved financial records cannot be deleted; corrections are adjustment/reversal transactions | `void_cash_entry()` — audited reversing journal (mirrors `pos_void_sale`), reason mandatory. No hard delete. |
| Chart of Accounts (22.03 full hierarchy) | `chart_of_accounts` table exists (M2B), seeded minimally (CASH/SALES/COGS/FG_INVENTORY/AR by POS, +RAW_MATERIALS/EQUIPMENT/SHRINKAGE by M3A) | `accounting_ensure_accounts()` extends the seed with the remaining 22.03 accounts actually exercised by M4 (OWNER_EQUITY, RETAINED_EARNINGS is derived not stored, LOANS_PAYABLE, OTHER_INCOME). AR/AP/bank/wallet/fixed-asset sub-accounts beyond what's posted today are **not** seeded speculatively (C1 §4 ladder — add when a real posting needs them). |
| Income Statement (monthly, retail/wholesale split, COGS, labor, opex, net income/margin) | **22.05/22.22** | `income_statement_monthly(company, branch, year)` — SQL aggregate over `journal_lines` joined to `journal_entries.entry_date`; retail-vs-wholesale split derived by joining the source invoice's `sales_order_items.is_bulk` (no new GL accounts, no touch to `pos_record_sale` — that function is pending the owner's cross-vendor money review from M2E and gets zero additional risk here). **Labor cost = 0/reserved** — Payroll module doesn't exist yet in V3 (no `wages` equivalent); documented, not faked. |
| Balance Sheet | derived from cash position + `cash_entries` categories + accumulated net income (mock's exact formula, now GL-truth-derived) | `balance_sheet(company, branch, as_of_date)`: Assets = Cash balance (from `journal_lines` CASH account) + FG/Raw-Material inventory value (at cost, from the M2A/M3A ledgers) + Equipment (at cost); Liabilities = Loans Received − Loan Payments; Equity = Owner Investment + Retained Earnings (cumulative net income − Owner's Drawings). |
| Trial Balance | **22.04** | `trial_balance(company, branch, as_of_date)` — one row per account, debit/credit totals from `journal_lines`; total debits = total credits is a live proof the GL is balanced (not just asserted by the app). |
| Chart of Accounts screen | read `chart_of_accounts` | plain member-read table view (already RLS'd since M2B). |
| Dashboard KPIs + 2 charts (net-income trend, sales-vs-opex) | **22.22** "Executive Dashboard" | computed client-side from `income_statement_monthly()`'s 12 rows — identical shape to the mock's chart data. |
| Statement of Cash Flows, Schedule of Cost of Production, Statement of Operations, Retained Earnings (standalone tab), Management Reports tab (cash report/purchase summary/monthly cost/fund statement/sales summary), Ledgers tab (GL drill-down/cash book/currency/vendor-customer) | 22.11 reconciliation, 22.08 AP, 20.11 partners | **Explicitly deferred to M4C+** (recorded, not forgotten). Cash-flow-statement inflow/outflow categorization by `source_document_type` is real work; AR "vendor/customer ledger" needs the 20.11 partners master (already deferred by the Inventory spec). Retained earnings *value* ships now (on the balance sheet); its own printable statement tab does not. |

## 3. Cross-module finding: M3A purchase categorization vs 22.03 (fixed in M4A, additive)

Building the Income Statement surfaced a real defect in M3A: `inventory_record_purchase()` posts **every**
consumable category — including `utilities`/`transport`/`misc` — to the single `RAW_MATERIALS` **inventory
asset** account. But per 22.03's Chart of Accounts, Utilities/Fuel/Office are **Operating Expense** accounts
(6110/6120/6150) — there is no physical stock of electricity to warehouse. Left uncorrected, real spending in
those categories would sit invisibly as unrecognized "inventory" forever and never appear on the P&L — a
financial-statement correctness bug, not a cosmetic gap. **Fix (this migration, additive, small):**
`inventory_record_purchase()` is evolved (drop+recreate, same M2C/M2E pattern) so the debit account depends on
category: `seeds`/`substrate`/`packaging` → `RAW_MATERIALS` (unchanged — becomes COGS through a future Production
consumption event); `utilities`/`transport`/`misc` → new `OPERATING_EXPENSES` account (immediate expense);
`equipment` → `EQUIPMENT` (unchanged). No table changes; `inventory_adjust_material`/guard:inventory FIFO/shrinkage
behavior is untouched (adjustments only ever apply to physical stock — the newly-expensed categories were never
FIFO-tracked to begin with, matching the mock, which also never adjusts "electricity stock").

## 3.1 Second cross-module finding: opening finished-goods balances never post to the GL

Writing the balance-sheet unit tests surfaced a second gap, upstream of M4: **M2A's `record_opening_finished_
goods()` creates cost-bearing stock (`finished_goods_batches` + an `Opening` movement) but never touches
`chart_of_accounts`/`journal_entries` at all** — it predates the GL (M2B came after). Consequence: `FG_INVENTORY`
on the balance sheet would be understated by exactly the value of every opening balance ever recorded (sales
correctly *credit* FG_INVENTORY via COGS release, but nothing ever *debited* it for the stock in the first
place) — Assets ≠ Liabilities + Equity, proven by a failing unit test before this was ever attacked against a
real database. **Fix (same migration, additive, small):** `record_opening_finished_goods()` is evolved
(drop+recreate, same signature) to also post **Dr FG_INVENTORY / Cr OWNER_EQUITY** for `quantity × unit_cost`
when that value is non-zero (skipped when zero — a 0/0 journal line violates the existing balanced-line CHECK
constraint, same precedent as `pos_record_sale`'s `if v_cogs > 0` guard). Treating pre-existing/opening stock as
a capital contribution in kind (Cr OWNER_EQUITY) is the standard accounting treatment for an ERP go-live
conversion (ODR-001's stated purpose for this function) and mirrors `inventory_record_purchase`'s Dr-asset/
Cr-offsetting-account shape.

## 4. New permissions (26.09 Financial Authority category)

`accounting.read` (view statements/dashboard/chart of accounts/cash ledger — **not** granted to Operator/Employee
per the mock's `hasFeatureAccess`, matching 26.09's "Worker: Cannot view financial reports" / "Operator: no
accounting"), `accounting.manage` (record/void cash entries). Reads are also company-membership-scoped
(`accessible_company_ids`); these permissions are the *additional* gate financial data always needs beyond mere
membership (26.09 §Permission Categories → Financial Authority).

## 5. Milestones

| Milestone | Scope |
|---|---|
| **M4A — DB spine** | migration `p2m4a_accounting_core`: `cash_entries` table + `record_cash_entry()`/`void_cash_entry()` (atomic, balanced, idempotent, audited) + `accounting_ensure_accounts()` + read functions `trial_balance()`/`income_statement_monthly()`/`balance_sheet()` (STABLE, security definer, permission-gated) + 2 permissions; new `guard:accounting` CI gate. |
| **M4B — UI** | Accounting screen: Dashboard (4 KPI cards + 2 charts), Financial Statements (Income Statement / Balance Sheet / Trial Balance / Chart of Accounts sub-tabs, year selector, print-friendly), Cash Ledger (log/void non-operating cash movements). Nav entry (`/accounting`, gated `accounting.read`). |

**Verification cadence (unchanged):** db reset → all guards (…/inventory/pos/**accounting**/drift) → tsc/vitest/build
→ browser E2E (M4B) → LOCAL commit → owner push gate → CI audit. **Money path** (new posting function
`record_cash_entry`/`void_cash_entry`): cross-vendor reviewer before lock, per charter §4.6 — same as every
financial-logic change this phase.
