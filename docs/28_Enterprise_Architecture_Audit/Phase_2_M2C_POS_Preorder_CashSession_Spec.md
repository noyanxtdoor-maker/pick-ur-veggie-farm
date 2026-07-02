# Phase 2 — Module 2C · POS Pre-orders, Settlement, Void & Cash Sessions (Specification)

**Type:** Operational module specification (design only — **no code, no migration, no schema, no UI**) ·
**Status:** 🟠 **PROPOSED — awaiting owner go before the M2C migration** · **Date:** 2026-06-28 · **Branch:** `feature/phase-0-foundation`
**Authority basis:** the reconciled POS spec (`Phase_2_M2_POS_Operational_Specification.md` §0) + `POS_Enterprise_
Reconciliation_Audit.md` (source-of-truth matrix) · Systems **22.07** AR customer ledger · **22.09** cash management/
cash drawer · **22.10/20.24** wallets/financial accounts · **22.24** financial record lock · **26.07** posting rules ·
**26.09** permission matrix · **20.11** customers · **20.18** delivery · the **AI Studio prototype** (`src/features/
POS.tsx` pre-order/Mark-Paid/void flows — the workflow authority) · locked **M2A/M2B** (this builds directly on them).

> **Scope.** M2B shipped the PAID retail cash sale. M2C completes the prototype's remaining POS lifecycle:
> **pre-order (unpaid delivery) sales → AR**, **settlement ("Mark Paid")**, **void (audited reversal)**, and the
> **cash session** (open/count/close/variance) that 22.09 requires around cash handling. Everything reuses/extends
> the canonical tables — no new parallel financial entities.

---

## 1. Pre-order (unpaid delivery) sale — reuses M2B tables as designed

**Prototype workflow (authoritative):** checkout offers *Direct Cash Clearance* | *Pre-order (Unpaid Delivery)*;
pre-order supports an optional **10% discount** toggle, an optional **delivery fee**, and a **vendor/route note**;
no cash is taken at recording; the slip prints as "Pre-Order delivery · cash collection pending".

**Design (no new tables — M2B reserved the fields):**
- `pos_record_sale()` gains optional args: `p_sale_kind` (`'paid'` default | `'preorder'`), `p_discount_rate`
  (0 or 0.10 — **server-applied**, never a client amount), `p_delivery_fee numeric >= 0`, `p_customer_note text`,
  `p_customer_id uuid null` (20.11 — optional walk-in vendor name lives in the note until the customer master ships).
- Pre-order path: `sales_orders.discount = subtotal × p_discount_rate`, `total_amount = subtotal − discount +
  delivery_fee`; **`invoices.invoice_type='credit'`, `status='Unpaid'`, `tender_cash=0`** (fields already exist in M2B).
- **Inventory + COGS post immediately** (goods leave the farm on delivery — 20.17 revenue integrity unchanged).
- **Posting (22.06/26.07, atomic):** Dr **AR** / Cr **Sales Revenue** (net of discount, incl. delivery fee) ·
  Dr **COGS** / Cr **FG Inventory**. (The AR account already exists in the M2B chart seed.)
- `sales_orders` gains `delivery_fee numeric(14,2) not null default 0` (the one additive column M2B lacks).

## 2. Settlement — `pos_settle_sale(invoice_id, cash, idempotency_key)`
Prototype: "Mark Paid" with cash ≥ outstanding, change given.
- Gated **`pos.settle`** + `is_branch_member`; idempotent on `(company_id, idempotency_key)`; audited (M5).
- Validates `invoices.status='Unpaid'`; records cash/change on the invoice → `status='Paid'` (column-scoped, via the
  SECURITY DEFINER function only); **posting:** Dr **Cash** / Cr **AR** for the invoice total. Never edits the
  original sale/journal — settlement is a **new** journal entry (22.24/26.07 corrections-by-addition).

## 3. Void — `pos_void_sale(invoice_id, reason, idempotency_key)`
Prototype: "VOID slip … this will revert any financial impacts."
- Gated **`pos.void`** (26.09: void/refund = *Approval Authority* — Owner/Manager tier, NOT the cashier's
  `pos.sell`); mandatory `reason`; audited with actor + reason.
- Marks `invoices.status='Voided'` (function-only path) and **appends reversing records** — never deletes/edits:
  * reversing **journal entry** (Cr Cash|AR / Dr Sales; Cr COGS / Dr FG Inventory),
  * reversing **inventory movement** (`AdjustmentIncrease`, source `VoidedInvoice`) returning the stock.
- A settled invoice must be un-settled first? **No** — void of a Paid invoice reverses Cash; void of an Unpaid one
  reverses AR. One function, branch on status. Voiding twice → idempotent no-op (status check).

## 4. Cash session (22.09) — the control around the drawer
**Purpose:** cash variance is the #1 farm fraud/error surface; 22.09 requires open/close counting.
- **New table `cash_sessions`** (branch-owned, append-only lifecycle): `id`, `company_id`, `branch_id`,
  `opened_by`/`opened_at`/`opening_float numeric(14,2)`, `closed_by`/`closed_at`/`counted_cash numeric(14,2)`,
  `expected_cash numeric(14,2)` (opening float + Σ cash sales − Σ change + Σ settlements while open — **derived at
  close by the function, never client-supplied**), `variance numeric(14,2)` (counted − expected), `variance_reason`,
  `status Open|Closed` (one Open session per branch — partial unique index). RLS: `is_branch_member` read; writes via
  functions only. Audited.
- **Functions:** `cash_open_session(branch, opening_float)` / `cash_close_session(session, counted_cash, reason?)`
  — gated **`cash.session`**; close computes expected/variance server-side; variance ≠ 0 → audit event
  `cash.variance` (Administrative, reason mandatory — 26.09 approval surface).
- **v1 linkage (lazy-correct):** sales are *not* FK-bound to a session; expected-cash derives from invoice
  timestamps within the session window per branch. (Ceiling noted: session_id FK on invoices when shift-level
  reporting matters.)

## 5. Permissions (additive to the M6 catalog, mapped to 26.09)
| Key | Grants | 26.09 tier |
|---|---|---|
| `pos.settle` | settle a pre-order (cash → AR clear) | Financial — Operator/Cashier |
| `pos.void` | void a slip (reversal) | **Approval Authority** — Owner/Manager |
| `cash.session` | open/close the branch cash session | Financial — Operator+ |

## 6. UI (prototype-styled, extends the M2B-2 terminal)
- **Checkout pane:** the prototype's two-tab classification (*Direct Cash Clearance* | *Pre-order Unpaid Delivery*);
  pre-order shows the 10%-discount toggle, delivery-fee toggle+amount, vendor/route note textarea.
- **Journal:** status filter gains *Pre-orders (Unpaid)*; rows get **Mark Paid** (gated `pos.settle`, opens
  cash+numpad settlement pane) and **Void** (gated `pos.void`, confirm + mandatory reason) actions; voided rows
  render struck-through with a VOID pill (prototype).
- **Cash session strip** above the terminal: "Drawer: Open since 6:02 · float ₱2,000 · [Close & Count]" — close
  flow = counted-cash numpad → variance shown → reason if ≠ 0.
- Offline: settlement/void queue through the outbox (idempotent RPCs); session open/close **online-preferred**,
  queued with the same pattern if offline.

## 7. Attack surface (→ extends `guard:pos` + new assertions)
Double-settle (idempotent + status check) · settle-without-permission (42501) · void-by-cashier (26.09 tier, 42501)
· void-twice (no-op) · discount tamper (server-applied rate only) · negative delivery fee (CHECK) · cross-branch
settle/void (`is_branch_member`) · session close with client-supplied "expected" (impossible — derived) · unbalanced
reversal (balance check in function) · journal/movement edits (append-only triggers already block).

## 8. Milestones
- **M2C-a:** migration (delivery_fee column + cash_sessions + 3 permission keys + extended/new functions) +
  `guard:pos` extension (~10 new assertions) — **needs owner go (migration)**.
- **M2C-b:** terminal UI (checkout classification, Mark Paid, Void, session strip) — app-only, local commits.

**Verification cadence unchanged:** db reset → all guards → tsc/tests/build → local commit → owner push → CI audit.

---
*Design only. No code, migration, schema, or push. M1–M6 + P2-M1/M2/M2A/M2B remain locked/unmodified.*
