# Handoff 011 — Payroll sub-items P2PR1–P2PR5: attendance, leave, overtime, disbursement approval, payout methods, 2026-07-20

**Direction note:** original work in Repo A (owner's own backlog, not a port either direction). Sharing
because two of the five migrations hit real Postgres/Radix gotchas worth knowing before you build the
same shapes, and the self-approval rule design splits into two genuinely different patterns depending
on what the request is *about* — worth getting right the first time rather than copy-pasting one shape
everywhere.

## What/why

The owner's payroll backlog had six named sub-items. Five shipped this session:

1. **P2PR1 — Attendance/shift tracking**: `attendance_records` table, upsert-not-duplicate per employee
   per day, `payroll_record_attendance`/`list_attendance`.
2. **P2PR2 — Leave/absence tracking**: `leave_requests` (date-range, overlap-denial), request/decide/list
   RPCs, zero-permission self-service filing for the linked employee.
3. **P2PR3 — Overtime tracking**: `overtime_requests` (single date, same-date-duplicate-denial), a
   near-structural-copy of P2PR2.
4. **P2PR4 — Wage disbursement approval workflow (the money-path item)**: `payroll_disburse_wage`
   (unilateral, one-click) got a request→approve/reject separation-of-duties layer in front of it,
   mirroring your P2N2 void-approval precedent — inline-not-call the posting logic so the approver
   (not the requester) is the attributed actor on every journal/audit row.
5. **P2PR5 — Multiple payout methods**: extends P2PR4's request/approve path to route to a specific
   `financial_accounts` row (GCash/Bank/Wallet) instead of always CASH, reusing your B2A-equivalent
   `finance_resolve_pay_code()` helper rather than inventing new account-resolution logic.

Sub-item 6 (formatted payslip) is not yet built.

## Two design patterns for self-approval — pick the right one

- **P2PR2/P2PR3 (leave/overtime)**: check whether the **decider's own linked `employee_id`** equals the
  request's beneficiary. A manager filing AND approving a *different* employee's leave/overtime is
  normal single-manager HR work and would be wrongly blocked by a literal requester-check.
- **P2PR4/P2PR5 (wage disbursement, money-moving)**: literal `requester != decider` check — same as
  your own P1O/P2N2 pattern. For money that actually leaves the business, requester and beneficiary
  are essentially always different people, and the real risk is the SAME manager both deciding to pay
  and authorizing the payment.

Using the wrong one either blocks legitimate HR admin work or fails to catch the actual money risk.

## Two Postgres/Radix gotchas hit this session

1. **`CREATE OR REPLACE FUNCTION` cannot change a function's return columns**, even when the argument
   list is unchanged — only the `RETURNS TABLE(...)` shape changed. Postgres raises `cannot change
   return type of existing function (SQLSTATE 42P13)`. Fix: `drop function if exists <name>(<arg
   types>);` before the `create`, same as the already-known "arg count changed → drop first" rule, but
   this one bites even when arg count is identical.
2. **A Radix `Dialog.Content` with no `max-h-[…vh] overflow-y-auto` silently produces an unreachable
   submit button once its content grows taller than the viewport** — no console error, no failed
   network request, the click just lands past the clipped region. Caught live during P2PR5's E2E when
   adding one more field pushed an existing dialog to ~856px on a 720px-tall viewport. If any of your
   dialogs are content-heavy (multi-field forms with a running summary), check they use the equivalent
   of `max-h-[85vh] overflow-y-auto` — five other screens in this repo already had it; this one dialog
   didn't.

## A real bug found and partially fixed (flagged for your own equivalent function)

`payroll_disburse_wage` — and, until P2PR5 rewrote that code path, its P2PR4-era copy inside
`payroll_approve_disbursement_request` — crashes with a `journal_lines` check-constraint violation
whenever a disbursement's cash-advance deduction exactly equals gross (net pay = 0), because the
Cash/pay-account journal line was inserted **unconditionally**, producing an invalid `(debit=0,
credit=0)` row. The EMPLOYEE_ADVANCES line was already correctly guarded on `if v_ded > 0`; the Cash
line had no matching `if v_net > 0` guard. P2PR5 fixed the copy inside
`payroll_approve_disbursement_request` as an in-scope byproduct (that block was already being rewritten
for account-routing). **`payroll_disburse_wage` itself is still unfixed** — worth checking whether your
own equivalent direct-disbursement function has the same unconditional-insert shape.

## Files (Repo A paths)

| Item | File |
|---|---|
| P2PR1 migration / guard | `supabase/migrations/20260720100000_p2pr1_payroll_attendance.sql` / `scripts/guards/p2pr1-payroll-attendance-security.sql` |
| P2PR2 migration / guard | `supabase/migrations/20260720110000_p2pr2_payroll_leave.sql` / `scripts/guards/p2pr2-payroll-leave-security.sql` |
| P2PR3 migration / guard | `supabase/migrations/20260720120000_p2pr3_payroll_overtime.sql` / `scripts/guards/p2pr3-payroll-overtime-security.sql` |
| P2PR4 migration / guard | `supabase/migrations/20260720130000_p2pr4_payroll_disbursement_approval.sql` / `scripts/guards/p2pr4-payroll-disbursement-approval-security.sql` |
| P2PR5 migration / guard | `supabase/migrations/20260720140000_p2pr5_payroll_payout_methods.sql` / `scripts/guards/p2pr5-payroll-payout-methods-security.sql` |
| App wiring | `app/features/payroll/PayrollScreen.tsx`, `app/features/payroll/api.ts` |
