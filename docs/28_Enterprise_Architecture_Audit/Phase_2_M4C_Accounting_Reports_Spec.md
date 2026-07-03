# Phase 2 — Module 4C: Accounting Management Reports (spec)

**Type:** Module spec (extends M4 Accounting) · **Status:** Built (app-only, read-only) · **Date:** 2026-07-03
**Authorized by:** owner picked "Build accounting reports (B3)" after the 8-module roadmap completed.
**Workflow authority:** prototype `src/features/Accounting.tsx`. **Structural authority:** enterprise Systems 22 (accounting).

## 1. What this is
A **Management Reports** tab on the Accounting screen. It delivers three of the items the M4 spec §2 deferred —
expense-category P&L, revenue-by-account, and a retained-earnings / equity roll-forward — as **read-only views**.

**Key design choice (ponytail / simplicity):** these add **NO new SQL, NO migration, NO money-writing path**. They
are pure app-layer compositions over the *already-audited* GL read-functions (`trial_balance`, `balance_sheet`)
that M4A shipped. Nothing is recomputed from raw tables; the reports only re-shape figures the balanced ledger
already produced. This keeps them off the money-path tripwire (C7 §4) — no cross-vendor review needed — because
they mutate nothing.

## 2. Scope (built — `app/features/accounting/reports.ts` + a 4th Accounting tab)
- **Expense breakdown** ("Where the money goes") — trial-balance rows of type `Expense`, netted on the debit side
  (`debit − credit`), sorted desc, each with its % share of total expense. COGS, Wages, Operating Expenses, etc.
- **Revenue breakdown** ("Where the money comes from") — same for type `Revenue` (Sales, Other Income), netted on
  the credit side.
- **Statement of Changes in Equity** — roll-forward from the balance sheet's own equity figures:
  `Owner Investment + Retained Earnings (accumulated net income) − Owner's Drawings = Total Equity`. Renders a
  `ties` check: if the roll-forward does not equal the balance sheet's `total_equity`, it shows a visible warning
  (a cheap self-check against upstream ledger drift).
- Honours the existing per-branch statement filter; mock mode composes from `mockLedger`, real mode from the GL RPCs.

## 3. Deliberately still deferred (unchanged from M4 spec §2)
- **Full Statement of Cash Flows** (operating/investing/financing) — a proper indirect-method statement is more than
  a re-shape of the trial balance; left reserved rather than half-built. Cost Schedule and vendor/customer ledgers
  likewise remain deferred (the latter wait on customer/supplier masters, backlog B1).

## 4. Verification
- `tsc` clean · `vitest` **63/63** — `tests/accounting-reports.test.ts` proves the breakdown netting/sorting/shares
  and that the equity roll-forward ties (and flags a non-tying balance sheet).
- Browser E2E: posted a live weigh-sale (₱270 revenue / ₱120 COGS) → Reports tab shows Sales Revenue ₱270 and COGS
  ₱120 with % bars, and the equity roll-forward ₱4,200 + ₱150 − ₱0 = ₱4,350 ties. Empty demo shows the correct
  "Nothing posted yet" state.
- No DB reset / guard battery: no SQL surface added (the underlying read-functions are already guarded 17/17).
