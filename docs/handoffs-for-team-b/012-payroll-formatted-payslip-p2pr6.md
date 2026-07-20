# Handoff 012 — Payroll: formatted payslip (P2PR6, the last of 6 payroll sub-items), 2026-07-20

**Direction note:** original work in Repo A (owner backlog). Sharing because the "reuse existing FK
relationships via PostgREST embeds instead of a new RPC" approach — and the graceful-degradation
design for when the viewer's RLS blocks the joined row — is a small, reusable pattern if you build
the same self-service payslip feature.

## What/why

Last of the six payroll sub-items the owner asked for. No dedicated payslip spec exists in the
architecture docs — `21.11_Payroll_Computation_Workflow.md` describes a full batch payroll-period
engine (computed OT/allowances, period locking) neither repo has built, so a "real" enterprise
payslip generator is out of scope. What's buildable and honest: a formatted, printable view of an
**existing** `wage_payments` row, using the fields `21.14_Payment_Methods_and_Disbursement_Records.md`
actually specifies (employee, period, amount, method, date, recorded-by, notes).

## Design

**Zero migration, zero RPC.** `wage_payments` already has FKs to `financial_accounts`
(`financial_account_id`, added by our P2PR5) and to `users` (`created_by`, added by our earlier
T3.3). Instead of a new list RPC with server-side LEFT JOINs (the pattern we used for the
disbursement-request queues), the existing plain REST reads got PostgREST relationship embeds added:

```
.select('*, financial_accounts(name, provider), creator:users!wage_payments_created_by_fkey(username)')
```

This resolves the payment-method name and the recording user's username in the same round trip, no
extra query. **The embeds are RLS-gated exactly like a manual join would be** — if the viewer's role
can't SELECT the joined `financial_accounts` or `users` row (RLS returns nothing, not an error),
PostgREST just returns `null` for that nested object. The payslip UI treats `null` as an expected
state, not a bug: it falls back to a generic `"Digital / Bank Account"` label (still distinguishing
from `"Cash"` when `financial_account_id` is actually null) and `"—"` for recorded-by. This matters
because the self-service employee tier typically has `payroll.read` scoped to their own row but not
`finance.account.read` or `user.read` on someone else's — so a linked employee viewing their OWN
payslip legitimately sees a less detailed payment-method label than a payroll manager does. Verified
live with three real users (owner, second admin, zero-permission linked employee), not assumed.

**Print**: reused the app's own existing `#pos-slip` receipt-printing technique (visibility-isolate-
by-id inside `@media print`, `app/index.css`) — added a second id, `#payslip-print`, same pattern,
`window.print()` on click. No new dependency.

## Files (Repo A paths)

| Item | File |
|---|---|
| Type extension (`financial_account_id`, `created_by`, embedded `financial_accounts`/`creator`) | `app/types/db.ts` — `WagePayment` |
| Query embeds | `app/features/payroll/api.ts` — `fetchWages`, `fetchEmployeeWages` |
| Payslip UI (manager + self-service, shared component) | `app/features/payroll/PayrollScreen.tsx` — `EmployeeHistoryTables` |
| Print CSS | `app/index.css` — `@media print` block |
