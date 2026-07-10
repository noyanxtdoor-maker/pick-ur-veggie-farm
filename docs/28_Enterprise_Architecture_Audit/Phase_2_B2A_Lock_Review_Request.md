# B2A Digital Payments — Cross-Vendor Lock-Review Request

**Type:** Review request (charter §4.6 / B2 spec §6c: "review B2 → lock") · **Date:** 2026-07-10
**Requester:** Repo A build agent (Fable 5) · **Reviewer:** GLM 5.2 (the charter's independent cross-vendor role)
**Subject commit:** `4662411` (feat/b2a) on `feature/phase-0-foundation` · CI green · built under the owner's
2026-07-08 §9 authorization ("B2 — authorize implementation against the spec").

## Artifacts under review (read these, in this order)

1. `docs/28_Enterprise_Architecture_Audit/Phase_2_B2_Digital_Payments_Reconciliation_Spec.md` — the spec it must match (§4 scope, §5 guard obligations).
2. `supabase/migrations/20260710090000_p2b2a_digital_payments.sql` — the money-path change itself.
3. `scripts/guards/payments-security.sql` — 11 behavioral proofs (run it yourself: db reset + docker-exec psql).
4. App layer (client honesty only — server is the authority): `app/features/finance/api.ts`,
   `app/features/pos/api.ts` (recordSale/settle deltas), `app/features/accounting/AccountsTab.tsx`,
   `app/features/pos/PosScreen.tsx` (picker).
5. Evidence trail: STATUS.md §2 "Digital payments (B2A)" row + §4 log 2026-07-10.

## What to verify (per-path verdicts, never a blanket number — money-review house style)

| # | Claim to attack | Where |
|---|---|---|
| 1 | `financial_accounts` is a THIN registry — **no stored balance anywhere**; every balance is derived (20.24) | migration §2, §8 |
| 2 | New COA codes can't collide with existing accounts (SALES/FG_INVENTORY hijack impossible); code immutable after creation | migration §5; guard RESERVED + IMMUTABLE tests |
| 3 | `pos_record_sale`/`pos_settle_sale` account routing changes ONLY the cash-leg account — amounts, pricing, COGS, idempotency byte-identical to M2E/M2C | migration §11–12 vs `20260702180000` / `20260702090000` |
| 4 | `pos_void_sale` reverses against the account ACTUALLY debited (C7 §4 mirror) incl. archived-account voids | migration §13; guard VOID test |
| 5 | Transfers: Dr/Cr two Asset codes, ZERO P&L, zero net assets, idempotent, same-branch only | migration §9; guard TRANSFER test |
| 6 | `balance_sheet`/`cash_flow_statement` treat CASH ∪ registry codes as cash-equivalents; transfers net out; ties preserved by construction | migration §14–15 |
| 7 | Permission/tenancy: finance.account.read/manage gates; cross-tenant + cross-branch + archived + preorder-account denials | guard GATES matrix |
| 8 | Preorder sales cannot carry an account at sale time (money lands at settlement) | migration §11 check; guard |

## Verdict format (mirror `Phase_2_Cross_Vendor_Money_Path_Review.md`)

Per-path GO / NO-GO with findings; owner sign-off checklist at the end; NOTICE items separated from defects.
On GO + owner sign-off: B2A is LOCKED (its migration becomes immutable-by-convention like M2E/M4A/M5A).

---

## 📋 Paste-ready prompt for the owner → GLM session

```
REVIEW TASK (cross-vendor, charter §4.6). Repo A built B2A digital payments and requests the
lock review per B2 spec §6c. READ-ONLY on Repo A — you review, you do not edit their repo.
Open Repo A at ../pick-ur-veggie-farm and read, in order:
docs/28_Enterprise_Architecture_Audit/Phase_2_B2A_Lock_Review_Request.md  (the full brief)
then the artifacts it lists. Attack the 8 claims in its table — do not take the guard's word
for anything you can independently derive; run their payments guard against a clean local
reset of THEIR schema if your environment allows, else review the SQL logic line-by-line.
Deliver: a per-path GO/NO-GO verdict document in the exact format of
Phase_2_Cross_Vendor_Money_Path_Review.md (findings → cross-cutting table → summary verdict →
owner sign-off checklist), written into YOUR repo (Repo B) as
docs/.../Phase_2_B2A_Lock_Review.md, and tell the owner your one-line verdict.
```
