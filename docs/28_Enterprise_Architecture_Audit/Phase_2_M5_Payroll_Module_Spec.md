# Phase 2 — Module 5 · Payroll (Farm Staff Wages & Advances) — reconciled specification

**Type:** Operational module design · **Status:** spec (Define) — **awaiting owner go to build M5A** ·
**Date:** 2026-07-03 · **Branch:** `feature/phase-0-foundation`
**Authority:** prototype `src/features/Payroll.tsx` = **workflow-logic authority** (owner standing decision
2026-07-02) · Systems **21.02** employee master / **21.10–21.11** salary + payroll-computation engine / **21.12**
cash advance / **21.14** disbursement records / **22.20** payroll→accounting integration / **26.09** permission
matrix (financial + HR authority) = **structural authority**. Foundation reused: M1–M6 · P2-M2 `is_branch_member`
· M2B GL spine (chart_of_accounts / journal_entries / journal_lines / `pos_next_seq`) · M4A `inventory_ensure_
accounts` chart seed.

## 1. Scope — what the mock actually does (and M5 builds)

A lean **daily-wage** payroll. **Roster:** hire a worker (name, position [Harvester/Operator/Packer/Driver],
daily rate ₱, hire date, active) — toggle Active/Resigned. **Cash advances:** log an advance to a worker (amount,
reason). **Wage disbursement:** for a worker, enter days worked + a cash-advance deduction (pre-filled with the
live outstanding balance) + pay-period label + notes → **gross = days × daily rate; net = gross − deduction** →
record. **Wage journal** lists disbursements. The **outstanding-advance balance is never stored** — it's derived
`Σ(advances) − Σ(wage deductions)` per worker.

**Explicitly OUT of M5 scope** (System 21 is a 22-doc enterprise HR suite; the mock is a farm daily-wage tool) —
recorded, not forgotten: attendance/biometric time-in-out (21.06 — days worked is a **manual input**, matching the
mock), shifts (21.07), leave (21.08), overtime/holiday premiums (21.09), performance (21.15), training (21.16),
discipline (21.19), exit workflow (21.20), the **payroll approval workflow** (21.13 — the mock disburses
immediately), **multi-method disbursement** (21.14 bank/GCash — cash only for now; links to backlog B2 digital
payments), and the **employee self-service payslip view** (21.03/21.05 — needs an employee↔`users` link; the mock
fakes it by name-match. Deferred: M5 is a manager/owner/accountant tool).

## 2. Canonical mapping (anti-"second ERP")

| Mock concept | Canonical structure | M5 disposition |
|---|---|---|
| Employee roster | **21.02** employee master | new `employees` (company-scoped master data, like `products`); RLS-gated writes under `payroll.manage`; no GL. |
| Cash advance | **21.12** + **22.20** | `cash_advances` (branch-owned, append-only) + governed `payroll_record_cash_advance()` posting **Dr Employee Advances / Cr Cash** (a real cash outflow creating an employee receivable). |
| Wage disbursement | **21.10/21.11** engine + **21.14** + **22.20** | `wage_payments` (branch-owned, append-only) + governed `payroll_disburse_wage()`: gross = days × rate (server recomputes from the employee's rate — **wage authority**, never trusts a client amount); posts **Dr Wages Expense (gross) / Cr Cash (net) / Cr Employee Advances (deduction)**. |
| Live advance balance | derived, not stored | `employee_advance_balance(employee_id)` = Σ advances − Σ wage deductions (source-table derivation, mirrors the mock). The GL `EMPLOYEE_ADVANCES` account = company total = Σ over employees — reconciles. |
| Active/Resigned toggle | 21.02 status | RLS update (`payroll.manage`); no hard delete (audited). |
| GL accounts | **22.03/22.20** | `payroll_ensure_accounts()` adds **WAGES_EXPENSE** (Expense) + **EMPLOYEE_ADVANCES** (Asset) to the M2B/M4A chart. |
| Branch of payment | 20.24 cash is branch-held | advances/wages are **branch-owned** (`is_branch_member`, GL posts to that branch) — employees stay company-level. UI picks the paying branch (like POS). |

## 3. Double-entry (22.20) — balanced, server-computed

- **Cash advance** (amount A): `Dr EMPLOYEE_ADVANCES A / Cr CASH A`.
- **Wage** (gross G = days × rate; deduction D ≤ min(outstanding advance, G); net N = G − D):
  `Dr WAGES_EXPENSE G / Cr CASH N / Cr EMPLOYEE_ADVANCES D` (the D line only when D > 0 — same
  `if > 0` guard as COGS/shrinkage). Balances by construction: G = N + D.
- Guards: append-only journals (M2B); function-only writes; idempotent (B5); audited (M5); `payroll.manage` +
  branch member; **net ≥ 0** and **deduction ≤ outstanding advance** enforced server-side.

## 4. Payroll → Accounting integration (22.20) — evolve the M4A read functions (additive)

So the statements stay correct the moment payroll posts (both drop+recreate, additive; zero-impact when no payroll
data — existing guard:accounting stays green):
- `income_statement_monthly()` — add **WAGES_EXPENSE** to the operating-expenses bucket (the mock's P&L shows a
  distinct "Labor/Wages (GROSS)" OpEx line).
- `balance_sheet()` — add **EMPLOYEE_ADVANCES** to assets.

## 5. New permissions (26.09 — HR/Financial authority; NOT granted to Worker/Operator)

`payroll.read` (view roster, advances, wage journal — Owner/Admin/Accountant per 26.09) · `payroll.manage`
(hire/deactivate, release advance, disburse wage). Reads also company-membership-scoped.

## 6. Milestones

| Milestone | Scope |
|---|---|
| **M5A — DB spine** | migration `p2m5a_payroll_core`: `employees` + `cash_advances` + `wage_payments` + `payroll_ensure_accounts` + `payroll_record_cash_advance` + `payroll_disburse_wage` + `employee_advance_balance` + evolve `income_statement_monthly`/`balance_sheet` (22.20) + 2 permissions; new `guard:payroll` CI gate. |
| **M5B — UI** | prototype-parity Payroll screen: roster table (live undeducted-advance pill), Hire modal, Log-Advance modal, Disburse-Wage modal (gross/deduction/net preview), Wage Disbursement Journal; nav entry `/payroll` gated `payroll.read`. |

**Verification cadence (unchanged):** db reset → all guards (…/pos/accounting/**payroll**/drift) → tsc/vitest/build
→ browser E2E (M5B) → LOCAL commit → owner push gate → CI audit. **Money path** (wages/advances post GL): the
cross-vendor reviewer runs on `payroll_record_cash_advance`/`payroll_disburse_wage` before M5 locks — same as
M2E/M4A (charter §4.6).
