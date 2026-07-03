# Phase 2 — Module 9A: Customers & Credit (spec)

**Type:** Module spec (backlog B1) · **Status:** Built + guard-proven · **Date:** 2026-07-03 · **Branch:** `feature/phase-0-foundation`
**Authority:** `Phase_2_Mockup_Reference_and_Backlog.md` B1 (customer master + credit standing) · System 22.07
(Accounts Receivable lifecycle & credit controls) · 26.09 permission matrix. Owner directed continuing into the backlog.

## 1. What this is
The first slice of B1: a **customer master** with an optional credit limit, per-customer **receivable/credit
standing** (read-only, derived), and **attribution** of unpaid credit sales to a customer.

## 2. Deliberately NON-money-mutating (stays off the C7 §4 tripwire)
This slice adds **no journal-posting path**. It is master data + attribution + a read:
- `customers` table — company-scoped master data (like products/employees), RLS `customer.read`, writes
  function-only (`customer_upsert` / `customer_set_status`, `customer.manage`).
- `invoices.customer_id` — **additive nullable** column (the M3A additive-ALTER idiom; no locked file touched) +
  `pos_assign_invoice_customer(invoice, customer)` which only **tags** an existing invoice — posts NO journal,
  changes NO amount (proven by the guard: journal count unchanged after a tag). Gated `pos.sell` + branch member,
  cross-tenant safe.
- `customer_ar_standing(company, branch?)` — per-customer outstanding AR = Σ unpaid invoice totals; available
  credit = limit − outstanding (null if no limit). **Derived, never stored** (22.07). Gated `customer.read`.
- +2 permissions: `customer.read`, `customer.manage` (mock ALL_KEYS now 28).

## 3. Deferred to the pending cross-vendor money-path review (charter §4.6)
**Credit-limit ENFORCEMENT** — rejecting/blocking a credit sale that would exceed the customer's available credit.
That lives inside `pos_record_sale` (a money path already awaiting review for M2E), so it is NOT in this slice. Today
the standing is informational (an "Over credit limit" flag when available < 0), not a hard stop.

## 4. App
- `customersApi` (mock | RPC | B5 offline-queued): fetchCustomers / fetchStanding / upsert / setStatus /
  fetchUnassignedCredit / assignInvoice. Dexie v9 `customers` store; mock standing derived from cached invoices.
- **Customers & Credit** screen (`/customers`, nav "Customers & Credit"): customer cards with outstanding/limit/
  available + a usage bar and over-limit flag; create/edit modal; archive; an "Unassigned credit sales" section to
  tag unpaid pre-orders to a customer.

## 5. Verification
- **Guard `scripts/guards/customers-security.sql` (6 PASS), wired into `guard:customers` + CI:** customer.manage
  gate, cross-tenant customer write+read denial, credit-sale attribution updates standing (outstanding 270 /
  available 4730) with **no journal posted by the tag**, cross-tenant attribution denied, customer.read gate.
  `supabase db reset` clean; **full guard suite green** (rls 23 / inventory 24 / pos 18 / accounting 19 / payroll
  14 / scheduling 8 / projects 7 / customers 6 / static / db / drift).
- **App:** `tsc` clean · `vitest` **69/69** (customers seam: upsert, validation, attribution→standing math, null
  limit) · build OK. Browser E2E: created a customer (limit ₱5,000), recorded a ₱364.50 pre-order, assigned it →
  Outstanding ₱364.50 / Available ₱4,635.50 (ties).

## 6. Deferred beyond this slice
Credit-limit enforcement (money path, review-gated); statements of account / customer subledger; payment
allocation across multiple invoices; supplier (AP) master — a future symmetric slice.
