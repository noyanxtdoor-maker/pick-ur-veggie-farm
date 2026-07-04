# Phase 2 — B2 Digital Payments (Bank / GCash / Maya): Reconciliation & Spec

**Type:** Reconciliation + design spec (NO code in this deliverable) · **Status:** Design — implementation gated on the
cross-vendor money-path review · **Date:** 2026-07-03 · **Branch:** `feature/phase-0-foundation`
**Owning authority:** System **20.24** (`financial_accounts` schema) + System **22.10** (Bank/GCash/Maya wallet ledger)
+ 22.02 financial boundary + 22.03 chart of accounts + 22.06 automatic posting + 26.09 permissions.
**Why spec-first (not code):** B2 is a **money path**. CLAUDE.md §6 requires reading the owning spec before changing
the domain, and the POS module set the precedent — M2A was preceded by the POS Enterprise Reconciliation Audit, not
blind code. This doc is that reconciliation; the code is deferred to the charter §4.6 review (see §6).

---

## 1. What the authority says (20.24 + 22.10)
- A **`financial_accounts`** table holds every company monetary account: `account_type ∈ {Cash, Bank, Digital Wallet}`,
  plus `bank_name`, `account_number`, `currency`, `status`, per `company_id` + `branch_id`.
- **Architecture rule (20.24):** *"Cash balances shall be calculated from transaction history. Manual changes to
  balances are prohibited."* Every movement (Deposit/Withdrawal/Transfer/Payment/Receipt) **links to a Journal Entry**,
  user, branch, supporting docs.
- **22.10 principle:** *"The ERP does NOT hold money; it records the financial movement."* Transfers between accounts
  (e.g. GCash→Bank) move balance with **no income/expense**. Payment-gateway processing stays outside the ERP.
- Multi-branch: per-branch and consolidated balances; separate permissions per account; approval for large transfers.

## 2. Reconciliation with what we already have
Our GL **already embodies the hard part** and must NOT be duplicated:
- We have `chart_of_accounts` with a single `CASH` asset account; balances are **derived from `journal_lines`**
  (`balance_sheet`, `trial_balance`, `cash_flow_statement`) — exactly 20.24's "balances calculated from transaction
  history, manual change prohibited." So a per-account balance is a `sum(debit−credit)` over that account's journal
  lines. **We do not need a separate `current_balance` store** (and must not add one — that would be the "second ERP"
  the POS audit rejected: 20.24 lists `current_balance` as a field, but our append-only-GL stance treats it as a
  DERIVED read, never a stored mutable column).
- The **cleanest mapping:** each `financial_accounts` row is backed by (or *is*) a `chart_of_accounts` **Asset** account.
  Cash→`CASH` (exists); each Bank/Wallet → a new asset account (e.g. `BANK_BPI`, `WALLET_GCASH`). `financial_accounts`
  becomes a thin **registry/metadata** table (display name, bank_name, account_number, type, status) keyed to a COA
  account_code — NOT a parallel balance ledger. Per-account balance = the COA account's derived balance.

## 3. Where money currently posts to CASH (every touch-point B2 must generalise)
Each of these debits/credits `CASH` today and would instead target the **chosen financial account**:
| Function | Today | Under B2 |
|---|---|---|
| `pos_record_sale` (paid) | Dr CASH | Dr {chosen account} (cash drawer / GCash / bank) |
| `pos_settle_sale` (AR receipt) | Dr CASH / Cr AR | Dr {chosen account} / Cr AR |
| `record_cash_entry` (owner/loans/etc.) | Dr/Cr CASH | Dr/Cr {chosen account} |
| `inventory_record_purchase` | Cr CASH | Cr {chosen account} |
| `payroll_disburse_wage` / advance | Cr CASH | Cr {chosen account} |
| **NEW** account transfer | — | Dr {to} / Cr {from}, no P&L (22.10) |
- **Reads to generalise:** `balance_sheet` (split "Cash" into Cash + Bank + Wallets, or a "Cash & equivalents" group);
  `cash_flow_statement` (its "cash" account set becomes all `financial_accounts`-backed asset codes — opening/closing
  still tie); `cash_sessions` reconciliation is drawer-only (Cash type), unaffected by digital accounts.

## 4. Minimal first slice (when implementation is authorised)
Keep it simple and additive, mirroring how M2E/M4A evolved posting functions (drop+recreate, no locked file edit):
1. `financial_accounts` registry table (branch-owned; RLS; `finance.account.manage`/`read`) + seed `CASH` mapping;
   backing COA asset accounts created on demand (like `inventory_ensure_accounts`).
2. Add `p_financial_account_id` (default = the branch CASH account) to `pos_record_sale` + `pos_settle_sale`; route the
   cash-side debit to that account's COA code. Store the account on the invoice for display.
3. Generalise `balance_sheet` + `cash_flow_statement` to treat all financial-account COA codes as cash-equivalents
   (ties preserved by construction).
4. `financial_account_transfer(from, to, amount)` → Dr/Cr, no P&L; audited; approval flag for large amounts.
5. UI: payment-method/account picker at checkout; a "Cash & Accounts" screen showing each account's derived balance
   (per-branch + consolidated) and a transfer action.

## 5. Guard obligations (Tier-2, before this can lock)
- A GCash sale posts to `WALLET_GCASH`, not `CASH`; `balance_sheet` total assets unchanged vs. an equivalent cash sale
  (only the composition shifts); `cash_flow` closing = Σ all financial-account balances.
- A transfer moves balance between two accounts with **zero** net change to total assets and **no** P&L line.
- Per-account permission + branch isolation; cross-tenant denial; balances remain derived (no writable balance column).

## 6. Explicitly DEFERRED — implementation gated
**No code is written in this deliverable.** B2 modifies `pos_record_sale`, `pos_settle_sale`, `record_cash_entry`,
`inventory_record_purchase`, and the payroll disbursement — the same money paths already **pending the cross-vendor
money-path review (charter §4.6)** for M2E/M4A/M5A. Implementing B2 now would expand that unreviewed surface across
every posting function at once. Correct sequence: **(a) owner runs the pending review + push on the accumulated work →
(b) author the B2 migration/guard against this spec → (c) review B2 → lock.** This matches the POS precedent
(reconcile → build → review → lock) and keeps us from shipping a parallel balance ledger.
