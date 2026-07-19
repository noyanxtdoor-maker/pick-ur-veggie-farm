# Handoff 008 — Reverse-parity port FROM Repo B: void-sale approval workflow (P2N2), 2026-07-19

**Direction note:** like handoffs 003/004/005, this documents Team A porting FROM Team B — your
`void_requests` table, `request_void`, `list_void_requests`, `reject_void_request` ported near-verbatim.
**One piece did NOT port verbatim and is worth checking your own repo for the equivalent gap:** the
approval/reversal function needed a real adaptation, not a copy, because of a schema difference between
the two repos.

## The gap: `approve_void_request`'s reversal must be payment-account-aware

Your `approve_void_request` inlines a copy of the void-reversal body (a comment in your own migration
explains why — a `SECURITY DEFINER` caller would impersonate the requester via
`current_app_user_id()` if it called `pos_void_sale` directly). Your inlined reversal always credits
`CASH` or `AR`, full stop — because Repo B hasn't built digital payments (B2A) yet, so every sale is
either cash-paid or unpaid-on-credit; there's no third case.

Repo A's `pos_void_sale` (`supabase/migrations/20260710090000_p2b2a_digital_payments.sql:439-494`) is
**payment-account-aware**: it reads `invoices.financial_account_id` and reverses against whatever
account was actually debited — CASH, or a specific GCash/Wallet/Bank account. Porting your
`approve_void_request` verbatim would have approved a void on a GCash-paid sale by crediting CASH
instead — silently corrupting both balances (GCash never decreases; CASH incorrectly increases) while
the journal entry still "balances" in the trivial debit=credit sense, so nothing about the transaction
itself would look wrong. This is exactly the class of bug that only surfaces later, at reconciliation
time, as an unexplained CASH/GCash mismatch — not at the moment of the void.

**If you ever build a comparable digital-payments layer,** check whether any of your existing
"reversal" logic (void, refund, cancel) hardcodes CASH/AR as the only two accounts a transaction could
have touched. The fix here was mechanical once found: read `v_fa := invoices.financial_account_id`,
resolve the pay code the same way `pos_void_sale` itself does (`v_fa is null → 'CASH'`, else look up
`financial_accounts.coa_code`), and use that resolved code everywhere the reversal posts, instead of a
hardcoded literal.

## What's new here that your build doesn't have: rank-based self-approval

Separately (owner directive 2026-07-19, not from your build): the owner — as the real company owner —
hit `approve_void_request`'s separation-of-duties check ("you cannot approve your own void request")
on their own request and asked for a rank ladder: owner/co_owner/admin (rank ≥ 30) can approve their
own void requests; operator/employee cannot unless explicitly granted a new `pos.void.self` permission
key. This mirrors the pattern already used for `P1M.2`'s owner-instant-revoke exemption — a rank
threshold bypasses a check that otherwise applies uniformly, with a narrower explicit-grant escape hatch
for below-threshold actors. If your own separation-of-duties checks (if you build an equivalent) ever
produce the same "but I'm the owner" complaint, this is the shape to reach for.

## Files (Repo A paths — your port is its own migration/commit, not a reference to these)

| Item | File |
|---|---|
| P2N2 migration (ported base) | `supabase/migrations/20260718060000_p2n2_void_approval_workflow.sql` |
| P2N2.1 migration (rank self-approve, new) | `supabase/migrations/20260719120000_p2n2_1_void_self_approve_rank.sql` |
| Guard (financial-account-aware reversal + rank assertions) | `scripts/guards/p2n2-void-approval-security.sql` |
| App wiring | `app/features/pos/PosScreen.tsx`, `app/features/organization/ApprovalsScreen.tsx` |
