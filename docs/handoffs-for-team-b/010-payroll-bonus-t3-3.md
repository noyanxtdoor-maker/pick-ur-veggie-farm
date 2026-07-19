# Handoff 010 — Payroll: optional bonus/incentive on Disburse Wage (T3.3), 2026-07-19

**Direction note:** original work in Repo A — not in your build, not a port either direction. Sharing
because the evolution pattern (append a defaulted argument, don't touch existing call sites) is one
we've now used three times on the same function family and it's held up cleanly each time; may be a
useful template if you extend your own `payroll_disburse_wage` equivalent later.

## What/why

Owner asked for an optional bonus/incentive amount when disbursing a wage — the owner may delegate day
rate work but still wants to add a discretionary top-up (e.g. a performance bonus) at the moment of
payout, without it looking like a data-entry error against the computed days×rate gross.

## Design

`payroll_disburse_wage` evolved with `p_bonus_amount numeric default 0`, appended **last** — the same
evolution shape T3.2 used on `inventory_record_purchase` (append the new arg, default it, existing
positional call sites keep working unchanged, no migration of historic rows needed). Server computes:

```
v_gross := round(p_days_worked * v_rate, 2) + coalesce(p_bonus_amount, 0)
```

everything downstream (deduction bounds against the outstanding cash-advance balance, net calculation,
the balanced double-entry posting — Dr `WAGES_EXPENSE`, Cr `CASH` + Cr `EMPLOYEE_ADVANCES`) is
unchanged. A `bonus_amount` column was added to `wage_payments` for an honest audit trail — a payslip
showing only "days × rate" would otherwise silently absorb an unexplained bonus into what looks like a
miscalculated gross.

**App side:** `PayrollScreen.tsx`'s Disburse Wage dialog (already carrying a "By Exact Amount" entry
mode from an earlier same-session change) gained one more optional field, "Bonus / Incentive (₱)",
shown as a separate "+ Bonus" line in the breakdown rather than folded silently into Gross — the owner
was explicit that the breakdown should stay transparent, not just correct.

## Guard

Extended `payroll-security.sql` with two assertions: a bonus amount correctly adds to gross and posts in
the balanced journal entry; omitting it (the default `0`) behaves identically to every pre-existing
disbursement path — a pure regression check, since this function is on the money path and already had
extensive existing coverage that had to keep passing unmodified.

## Files (Repo A paths)

| Item | File |
|---|---|
| Migration | `supabase/migrations/20260719090000_t3_3_payroll_wage_bonus.sql` |
| Guard (2 new assertions, rest of `payroll-security.sql` unmodified) | `scripts/guards/payroll-security.sql` |
| App wiring | `app/features/payroll/PayrollScreen.tsx`, `app/features/payroll/api.ts` |
