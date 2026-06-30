# Phase 2 — Module 2 (Operational) · Weigh Point-of-Sale (POS) Operational Specification

**Type:** Operational module specification (design only — **no code, no migration, no schema, no UI**) ·
**Status:** 🟠 **v2 — ENTERPRISE-RECONCILED** (SECTION 0 supersedes the v1 prototype-derived data model / inventory /
accounting / permissions / plan below; awaiting owner review before M2A) · **Date:** 2026-06-23 (reconciled) ·
**Branch:** `feature/phase-0-foundation`
**Reconciliation authority:** `POS_Enterprise_Reconciliation_Audit.md` + Systems **20.16/20.17/20.24**, **22.06/22.07/
22.09/22.10/22.16/22.19**, **26.07/26.09**, **03.03**.
**Authority basis (v1, UX retained):** the accepted **ERP Traceability Audit** (operational-first), the **Google AI Studio prototype**
(`src/features/POS.tsx`, `src/lib/money.ts`, `src/lib/types.ts`, `src/db.ts`) + the prototype screenshots, the
locked **M1–M6** foundation + **P2-M1/P2-M2** (resolver, RLS, audit, bootstrap, `is_branch_member`), **B5**
(offline/idempotency), **B2** (no-float money), **M1B** app architecture, `docs/14_UI_References`.

> **Naming note.** The earlier informal "Module 2 = Crop Management" is **frozen** (administrative master data, per
> the audit). This document re-designates the next *operational* module — **Weigh POS** — as the implementation
> focus. POS is the single most-used screen in the business and the centerpiece of the owner's prototype. This is a
> spec only; nothing is implemented here.

---

## SECTION 0 — Enterprise Reconciliation Override (authoritative; supersedes v1 §4, §5, §6, §9, §10)

> **Why this exists.** `POS_Enterprise_Reconciliation_Audit.md` proved the v1 data model built a **parallel sales/
> finance subsystem** (`pos_sales`, `pos_payments`, `cash_drawers`, `payment_methods`, `receivables`, `receipts`) that
> **duplicates canonical enterprise tables** and **contradicts** the automatic-posting + revenue-integrity rules — "a
> second ERP inside the ERP." The v1 **workflow, screens, pricing, and offline design (§1–§3, §7, §8) are retained**;
> the **data model, inventory, accounting, permissions, and implementation plan are replaced by this section.**

### 0.1 POS is a fast weigh-and-sell UI over the canonical schema — it owns NO financial tables
| Concern | Source of truth (reuse / extend) | v1 table → disposition |
|---|---|---|
| Sellable item (what POS sells) | **20.16** `finished_goods_batches` (traceable to harvest) | `products` → **C: extend** (selling-price book keyed to the product/finished-goods master, not a standalone list) |
| Sale / order | **20.17** `sales_orders` (`sales_channel='Farm Gate'`/retail) | `pos_sales` → **D/B: remove → reuse 20.17** |
| Invoice / receipt | **20.17** `invoices` (slip = a print/render) | `receipts` → **D: remove** (render the invoice) |
| Sale line items | **20.17** line items → 20.16 batch → 20.15 harvest | `pos_sale_items` → **B: reuse 20.17** |
| Inventory movement / decrement | **20.09** `inventory_movement_ledger` + **20.16** qty + **03.03** FIFO | (was deferred) → **mandatory, §0.3** |
| COGS | **22.19** Harvest FIFO COGS + **22.16** | — → **mandatory, §0.3** |
| Posting (auto) | **22.06** + **26.07** → **20.22** GL | (was deferred) → **mandatory, §0.2** |
| Cash drawer / session | **20.24** `financial_accounts` (Cash) + **22.09** open/close/count/variance | `cash_drawers` → **C: extend** (reuse account; add a cash-session record) |
| GCash / Maya / Bank | **22.10** + **20.24** | `payment_methods` → **B: reuse 20.24 rows** |
| Payment methods | **20.24** `financial_accounts` | `payment_methods` → **B: reuse** |
| Receivable (pre-order/credit) | **22.07** AR + **20.23** | `receivables` → **B: reuse AR** (retail cash = no receivable) |
| Customer (delivery/vendor) | **20.11** `customers` | new customer-pick → **B: reuse 20.11** |
| Permissions (catalog) | **26.09** Permission Matrix (Financial/Approval categories) | `pos.sell`/`pos.void`/`product.manage` → **re-derived under 26.09** |
| Authorization · Audit · Offline · Branch | **M4** · **M5** · **B5** · **P2-M2** `is_branch_member` | unchanged (correct) |

**Legitimately NEW (no enterprise duplicate):** the weigh-POS **UI**, the thin **selling-price book**, a **cash-session**
record (extends 20.24), and the **offline outbox / idempotency** plumbing (B5, already built in M1D).

### 0.2 Posting is MANDATORY and ATOMIC at sale commit (replaces v1 "defer GL to Phase 4")
Per **22.06** ("operational activity automatically creates the journal") + **26.07** ("financial records must never be
partially posted"), the governed `pos_record_sale()` commits — **in one transaction** — the `sales_order` + `invoice` +
the finished-goods movement + the journal:
- **Paid:** Dr **Cash/Wallet** (20.24) · Cr **Sales Revenue** · Dr **COGS** · Cr **Finished-Goods Inventory**.
- **Pre-order (credit):** Dr **Accounts Receivable** (22.07) · Cr **Sales Revenue** · Dr **COGS** · Cr **Inventory**;
  settlement appends Dr **Cash** · Cr **AR**.
Posting is never deferred; if the Accounting GL tables aren't yet live, M2A ships the **minimal journal + financial_
accounts + AR** rows the sale requires (the canonical spine), not a "facts-only" stub.

### 0.3 Inventory decrement is MANDATORY (replaces v1 "no decrement in v1")
Per **20.17** revenue-integrity ("a sale cannot exceed available inventory"), **20.16** (qty controlled by movements),
**22.16** ("every movement has physical AND financial impact"), and **03.03** FIFO: every sale **deducts finished-goods**
via a controlled **inventory_movement_ledger** entry and releases **COGS (FIFO, 22.19)**. No sale without stock.

### 0.4 Exposed prerequisite — minimal Finished-Goods / Opening Balance
POS **cannot sell from nothing**: finished goods (20.16) originate from harvest (20.15)/production (02). Therefore M2A
has a **co-requisite**: a **minimal finished-goods stock path** — either a tiny harvest→finished-goods entry, or an
**opening finished-goods balance** (ODR-001 opening-balance procedure). POS and this thin finished-goods/posting spine
are built **together**; operational-first priority is unchanged (POS is the visible goal) but it sits on the spine.

### 0.5 Revised implementation plan (replaces v1 §10)
| Milestone | Scope (all reuse/extend canonical authority) |
|---|---|
| **M2A — Spine + price book** | extend **20.16** finished-goods + a **selling-price book**; minimal **opening finished-goods balance** (§0.4); **financial_accounts** (20.24) Cash drawer; permission keys under **26.09**. |
| **M2B — Governed sale** | `pos_record_sale()` → atomic **sales_order (20.17) + invoice + inventory_movement (20.09/20.16) + COGS (22.19) + journal (22.06/26.07)**; idempotent (B5); branch-gated (`is_branch_member`); audited (M5). Weigh-POS Home/Basket/Checkout/Receipt UI (v1 §3). |
| **M2C — Tender · AR · settlement · void** | `financial_accounts` tender (Cash/GCash/Maya, 20.24/22.10); pre-order → **AR (22.07)**; settlement (Dr Cash/Cr AR); `pos_void_sale()` = audited reversal (no delete); cash-session close/reconcile (22.09). |
| **M2D — Dashboard / reporting** | period/branch/cashier/top-product sales reads from the canonical sale/GL/inventory objects. |

**Verification per milestone (unchanged cadence):** db reset → `guard:static/db/rls/bootstrap/org/crop` + new
**`guard:pos`** (incl. cross-tenant/branch sale, double-sale idempotency, price-authority, posting-balance, no-oversell,
void-reversal) → tsc/test/build → local commit → CI → lock. **No locked migration is modified.**

> **The v1 sections below are retained for the workflow/UX/offline detail. Where v1 §4/§5/§6/§9/§10 describe `pos_sales`,
> `pos_payments`, `cash_drawers`, `payment_methods`, `receivables`, or "deferred posting / no inventory decrement", this
> SECTION 0 governs instead.**

---

## SECTION 1 — Business Purpose

**Why POS exists.** PickUrVeggie sells freshly harvested vegetables **by weight**. The cashier weighs produce,
the system prices it at the **farm price** (a discount off prevailing retail), builds a slip, takes cash (or books a
delivery pre-order), prints a slip, and records the sale. This is the farm's revenue event and the most frequent
action in the entire ERP. Without POS, the V3 app cannot perform the business's core daily transaction.

**Daily users.**
- **Cashier / Operator** — runs the weigh-POS all day (the primary user).
- **Employee** — may process individual sales (prototype: Employee has POS view/edit).
- **Manager / Owner** — sets the vegetable price list, voids erroneous slips, reviews the sales journal.

**Daily transaction volume assumptions.** A small farm stall: ~**50–300 sales/day/branch**, a handful of line items
each, bursts at market hours. Not high-frequency retail — but **every sale is money**, so correctness and
exactly-once recording dominate over raw throughput.

**Offline requirements (hard).** Island/stall connectivity is unstable (B5). POS **must work fully offline**: weigh,
price, slip, take cash, print, and **record the sale locally**, then sync when connectivity returns — **without ever
double-recording a sale**. The cashier must never be blocked by the network.

**Multi-branch requirements.** Each branch sells independently. A sale belongs to **one branch**; a cashier may only
sell in a branch they are a member of (branch isolation, reusing `is_branch_member`). Slip numbers are **per-branch**.
Owners/managers may review across branches (reporting), but selling is branch-scoped.

---

## SECTION 2 — User Workflow (complete)

Derived from `src/features/POS.tsx`. Pricing: `farmPerKg = round2(retail × (1 − 0.10))`,
`lineTotal = round2(weightKg × farmPerKg)`, `retailLine = round2(weightKg × retail)`, `saved = retailLine − lineTotal`.

```
Cashier opens POS (branch context = their active branch)
  → SELECT PRODUCE  : tap a vegetable card in the cashier grid (shows farm ₱/kg, struck-through retail)
  → ENTER WEIGHT    : numpad/scale input in kg (or "Skip Weigh" → bulk wholesale flat price)
  → CALCULATE       : line = weight × farmPerKg (provisional, client-side display)
  → BASKET (slip)   : "Add to active slip" → line appears; repeat for more items; remove/clear allowed
                      running Total Due + "Farm discount saved" shown
  → CHECKOUT        : choose classification:
        (a) PAID (Direct Cash Clearance): enter cash received → change = cash − total (cash ≥ total required)
        (b) PREORDER (Unpaid Delivery): optional 10% discount toggle + optional delivery fee + vendor/route note
  → PAYMENT         : record cash + change (paid) OR mark as receivable (preorder, cash pending)
  → COMMIT SALE     : assign idempotency key (client) → write-ahead enqueue → (online or later) server commits:
                        • server assigns authoritative per-branch slip_no
                        • server recomputes line/total from the product master (price authority)
                        • sale + items persisted (append-only)
  → RECEIPT         : print thermal slip (farm name, date, slip#, cashier, items w/ weight×₱/kg, discount saved,
                        total, cash/change OR "delivery pending", note)
  → INVENTORY EVENT : (reserved) emit "produce sold" movement for a future finished-goods ledger (Module 3) — v1: none
  → ACCOUNTING EVENT: (reserved) sale becomes the source fact the Accounting module (Phase 4) posts to GL:
                        paid → Dr Cash / Cr Sales Revenue; preorder → Dr A/R / Cr Sales Revenue; settle → Dr Cash / Cr A/R
  → AUDIT EVENT     : every sale / settlement / void appends an immutable audit_events row (M5; actor = cashier)
```

**Post-sale lifecycle (append-only):**
- **Preorder → Paid** ("Mark Paid"): a *settlement* (cash + change) is appended; sale status → Paid. The original sale
  is never edited destructively.
- **Void**: `pos.void` holders append a **reversal** (slip marked voided + reason + actor); history is preserved.

---

## SECTION 3 — Screen Specification

All screens reuse the locked **M1B/M1D** shell, components, permission gating, offline outbox, and state surfaces
(card-driven, tablet-first landscape, ≥56 px targets, high contrast, minimal typing — `docs/14_UI_References` +
Section 25). Global states (loading/empty/error/offline/conflict + per-record sync badge) per M1C §4.

### 3.1 POS Home (Weigh Terminal)
- **Layout:** two-pane landscape — **left** = vegetable cashier grid + selected-item weigh pad; **right** = active
  slip (basket) with running total. (Mirrors prototype + GoTyme/MariBank card clarity.)
- **Components:** `ProductGrid` (large vegetable cards: image/icon, name, **farm ₱/kg**, struck-through retail, code #),
  `WeighPad` (numeric input + on-screen Numpad, reuse the V2 `Numpad` pattern), `Slip`/basket list, `TotalBar`
  ("Total Due", "Farm discount saved"), "Crop Pricing Menu" button (gated `product.manage`), an **Offline/Sync badge**.
- **Actions:** select product; enter weight; **Add to slip**; **Skip Weigh** (bulk flat price); remove line; clear slip;
  **Proceed Checkout**.
- **Validation:** weight numeric **> 0** (else inline error); bulk flat price **> 0**; cannot checkout an empty slip.
- **Offline behavior:** fully functional; product grid reads the **local cached price list**; nothing here needs network.
- **Error states:** invalid weight inline; "no products yet → add a vegetable in the Pricing Menu" empty state.

### 3.2 Product Selection (within POS Home / detail)
- **Layout:** selected vegetable panel — name, active farm ₱/kg, weight field + Numpad, live line preview.
- **Actions:** confirm add; switch product; skip-weigh bulk.
- **Validation:** as above. **Offline:** local-only. **Errors:** none beyond weight validation.

### 3.3 Basket (Active Slip)
- **Layout:** right pane — itemized lines (`name`, `weight kg × farm ₱/kg`, line total, remove); footer Total Due +
  saved + Clear + Proceed.
- **Actions:** remove line; clear (confirm); proceed to checkout.
- **Validation:** non-empty to proceed. **Offline:** local. **Errors:** confirm-before-clear (destructive).

### 3.4 Checkout
- **Layout:** modal — classification toggle (**Paid** | **Preorder**); Grand Total Due; **Paid:** cash input +
  Numpad + change-due; **Preorder:** 10%-discount toggle, delivery-fee toggle+amount, vendor/route note.
- **Actions:** select classification; enter cash; **Record Transaction** (→ commit).
- **Validation:** Paid requires **cash ≥ total** (button disabled otherwise); preorder requires no cash; delivery fee ≥ 0.
- **Offline behavior (critical):** on **Record**, the sale is **atomically enqueued** (write-ahead, O1) with a client
  **idempotency key** *before* the receipt shows; the button **disables + debounces** (O4) to prevent a double-tap sale.
- **Error states:** insufficient cash (blocked); on later sync rejection (permission/branch) → the queued sale is
  **Blocked** for review (never silently dropped), surfaced with a sync badge + conflict card.

### 3.5 Receipt (Slip)
- **Layout:** thermal-style slip — farm header, date, **slip #** (or "PENDING SYNC" provisional ref offline), cashier,
  items (weight × ₱/kg), discount saved, **Total**, cash/change OR "delivery pending", note; **Print** + Close.
- **Actions:** print (browser print), close.
- **Offline behavior:** prints immediately with a **provisional reference** when offline; the authoritative server
  `slip_no` is reconciled on sync (badge updates). *(Ceiling: if a final number is required at print time offline,
  the upgrade is pre-allocated per-device slip blocks — reserved, not built in v1.)*
- **Error states:** none (print is local).

### 3.6 Transaction History (Sales Journal)
- **Layout:** filter toolbar (date, type retail/wholesale, status paid/preorder) + table (datetime, slip#, type,
  posted-by, details/note, total, status, actions) + CSV export.
- **Actions:** view/print slip; **Mark Paid** (preorder settlement, gated `pos.sell`/`pos.settle`); **Void** (gated
  `pos.void`); export CSV; per-row **sync badge** (Pending/Confirmed/Conflict).
- **Validation:** settlement cash ≥ outstanding; void requires confirm + reason.
- **Offline behavior:** reads from the **local cache** (branch sales); settle/void are **queued** like any write and
  re-authorized server-side on sync.
- **Error states:** void/settle rejected on sync → Blocked + conflict card.

---

## SECTION 4 — Data Model Mapping (to M1–M6 foundation)

### Already exists (reuse — no change)
| Need | Provided by |
|---|---|
| Identity of the cashier (`sold_by`) | **M1** `public.users`, `uuidv7()`, `current_app_user_id()` |
| Tenant + branch ownership | **M2** `companies`, `branches` (+ composite-FK target `UNIQUE(id, company_id)`) |
| Permission-based authz (never role names) | **M3/M4** `roles`/`permissions`/`role_permissions`/`user_branch_roles` + `has_permission()` |
| Member-scoped reads / tenant isolation | **M4** `accessible_company_ids()` |
| **Branch isolation** (sell only in your branch) | **P2-M2** `is_branch_member(branch_id)` — reuse directly |
| Immutable audit of every sale/void/settle | **M5** `audit_events` (+ the P2-M2 SECURITY-DEFINER audit-trigger pattern) |
| Permission catalog growth | **M6** seed pattern (`insert … on conflict do nothing`) |
| Exactly-once offline writes | **B5** `(company_id, idempotency_key)` unique + outbox (already built in M1D) |
| Fixed-precision money | **B2** `NUMERIC` (no float) |

### New tables required (Phase-2 operational; designed in M2 migrations — NOT created here)
1. **`products`** — POS vegetable **price list** (company-scoped master data; the prototype's `prices`). Columns:
   `id` uuidv7, `company_id` FK→companies, `product_code` (UQ per company), `name`, `retail_per_kg` **NUMERIC(12,2)**,
   `unit` default `'kg'`, `status` Active|Archived, timestamps; `UNIQUE(company_id, product_code)`,
   `UNIQUE(id, company_id)` (composite-FK target). RLS: member read; write gated by **`product.manage`**. Audited.
   *(Independent of the frozen crop catalog; an optional `crop_variety_id` link is reserved, not required.)*
2. **`pos_sales`** — the **sale header** (branch-owned, append-only operational ledger). `id` uuidv7, `company_id`,
   `branch_id`, `slip_no` (per-branch sequence, **server-assigned**), `sale_type` retail|wholesale, `status`
   Paid|Preorder|Voided, `sold_by_user_id` FK→users, `customer_note`, `subtotal`/`discount_amount`/`delivery_fee`/
   `retail_total`/`saved`/`total`/`tender_cash`/`change_amount` **NUMERIC(12,2)**, **`idempotency_key`** (client uuid),
   `occurred_at` (client metadata), `server_committed_at`, timestamps. `UNIQUE(company_id, idempotency_key)` (B5);
   composite FK `(branch_id, company_id)`→branches. RLS: read/write `is_branch_member(branch_id)` + write also
   `has_permission(company_id,'pos.sell')`. Append-only (no destructive edits). Audited.
3. **`pos_sale_items`** — **line items** (append-only). `id`, `company_id`, `sale_id`, `product_id` (nullable for bulk),
   `name_snapshot`, `weight_kg` **NUMERIC(12,3)** nullable (null = bulk flat), `price_per_kg` **NUMERIC(12,2)** nullable,
   `line_total`/`retail_line` **NUMERIC(12,2)**. Composite FK `(sale_id, company_id)`→pos_sales; `(product_id,
   company_id)`→products (same-company). CHECK `weight_kg > 0` when present; `line_total >= 0`. Audited via parent.
4. **`pos_payments`** — preorder settlements (append-only; keeps the sale header immutable). `id`, `company_id`,
   `branch_id`, `sale_id`, `amount`/`change_amount` **NUMERIC(12,2)**, `paid_by_user_id`, `idempotency_key`, timestamps.
5. **Per-branch slip sequence** — a small `pos_branch_counters(company_id, branch_id, next_slip_no)` or a sequence
   keyed per branch, incremented inside the commit function (server authority; avoids offline collisions).

### Governed write functions (SECURITY DEFINER, like `invite_user`/bootstrap)
- `pos_record_sale(...)` — validates `pos.sell` + `is_branch_member`; **recomputes prices from the `products` master**
  (price authority — never trust client amounts); assigns `slip_no`; inserts sale + items atomically; appends audit;
  dedups on `(company_id, idempotency_key)`.
- `pos_settle_sale(sale_id, cash)` — `pos.sell`/`pos.settle`; appends a `pos_payments` row + flips status Paid; audited.
- `pos_void_sale(sale_id, reason)` — `pos.void`; marks voided + reason + actor; audited. (Append-only reversal.)

### New permissions required (added to the M6 catalog, additively)
| Key | Grants | Typical role |
|---|---|---|
| `pos.sell` | process a sale + settle a preorder in a branch you belong to | Cashier / Operator / Employee |
| `pos.void` | void a slip (audited reversal) | Supervisor / Owner |
| `product.manage` | manage the vegetable price list | Owner / Manager |

*(Reads of branch sales = `is_branch_member`; a future `pos.read.all` enables cross-branch reporting for owners.)*

---

## SECTION 5 — Inventory Integration (`POS Sale → Inventory Reduction`)

**Honest finding from the prototype:** POS sells **harvested produce by weight**, while the Stock-Inventory module
tracks **input materials** (fertilizer, substrate, seeds, packaging, equipment). A vegetable sale therefore does **not**
decrement the materials inventory — the two are different stock domains. Inventing a materials decrement on sale would
be wrong.

**Design:**
- **v1 (POS-first):** a sale records produce sold; it touches **no** inventory ledger. (Correct per the prototype.)
- **Reserved contract (for Module 3 — Inventory/Finished-Goods):** each `pos_sale_items` line is a typed
  **"produce sold" movement** (`product_id`, `weight_kg`, `branch_id`, `sale_id`, the **same idempotency key**). When a
  **finished-goods / harvest stock** ledger ships, it consumes these movements **idempotently** to decrement harvested
  stock and re-validates availability at commit (B5 §7 oversell → block/manual). Until then, POS emits the fact and the
  ledger does not exist → no decrement. This makes the integration **reserved and idempotent**, not faked.

---

## SECTION 6 — Accounting Integration (`POS Sale → Ledger Entry`)

The prototype shows a **Grand Sales & Receivables Ledger** and an **Automated Accounting Suite**. Accounting is a
later phase (C8 Phase 4); POS only **produces the source facts**:

| POS event | Accounting posting (derived by the Accounting module, Phase 4) |
|---|---|
| **Paid** sale | Dr **Cash** / Cr **Sales Revenue** (+ contra **Farm Discount** if tracked) |
| **Preorder** (unpaid) sale | Dr **Accounts Receivable** / Cr **Sales Revenue** |
| **Settlement** (`pos_payments`) | Dr **Cash** / Cr **Accounts Receivable** |
| **Void** | reversing entry of the original |

**Design:** the immutable `pos_sales` + `pos_payments` are the **source ledger**. The Accounting module reads them to
generate double-entry GL; **POS does not post GL itself** in v1. Reserve an **account-mapping contract** (Sales Revenue,
Cash, A/R, Discounts) so Phase-4 posting is deterministic and idempotent (keyed by sale/payment id). Honors C8 phasing.

---

## SECTION 7 — Offline Design (B5 compliance)

- **Idempotency.** Each sale carries a client **uuidv7 idempotency key** generated at the *Record* tap; server enforces
  **`UNIQUE(company_id, idempotency_key)`** → at-most-once commit. Settlements carry their own key. Retried/replayed
  sends return the prior authoritative result, never a second sale (B5 §1–§2).
- **Queue behavior.** Reuse the M1D **write-ahead outbox** (`Pending → Uploading → Completed/Failed/Blocked`). The sale
  is **atomically enqueued before the receipt prints** (O1 — a crash/power-loss can't lose a recorded sale). Drains on
  online/foreground (O2); `Uploading` re-driven on restart (O3); double-submit guarded (O4).
- **Conflict handling.** Sales are **append-only** → no edit conflicts. **Settlement** conflict (settled on two devices)
  → idempotency on `pos_payments` + server authority = one settlement. **Void** is idempotent. **Slip number** is
  server-assigned per branch (no offline collision); the printed slip uses a **provisional ref** until sync. **Price**
  is server-recomputed from the product master (client amounts are display-only) → no price-tamper conflict. (Inventory
  oversell conflict is N/A until Module 3, then server re-validates → block/manual, B5 §7.)
- **Retry behavior.** Exponential backoff + jitter, batching, server backpressure, **dead-letter** for permanent
  failures (e.g. lost branch membership) — surfaced for review, never dropped (B5 §10). Permission revoked offline →
  the queued sale is **rejected/quarantined** at sync by RLS, not committed.

**B5 §12 gate:** before M2 locks, run the idempotency/offline battery (same sale 100× → one commit; 30-day offline
drain; crash mid-commit → no dup/partial; mass reconnect → no thundering herd).

---

## SECTION 8 — Dashboard Integration (KPIs unlocked after POS)

From the Home Dashboard screenshot — POS **directly** enables:
- **Daily Sales Volume (₱)** — sum of paid sales for the day/branch.
- **Market Orders** — sale count (retail + wholesale).
- **7-day branch sales-volume trend** (line chart, `recharts`).
- **Retail vs wholesale split**, **farm discount given**, **outstanding receivables (preorders)**.
- **Top-selling vegetables** (by ₱ and by kg), **sales by branch**, **sales by cashier**.
- **Quick ledger real-time stream** (recent sales feed).

**Still need later modules:** **Low-Stock Alerts** (Inventory, Module 3), **Active Roster Staff** (Payroll, Module 5),
**Inventory turnover** (Inventory). The dashboard's operational KPIs become real the moment POS ships — that is the
"this is our ERP" moment.

---

## SECTION 9 — Security Review (attack the design)

| Attack | Defense |
|---|---|
| **Double sale** (double-tap / lost ack / retry) | client idempotency key + **`UNIQUE(company_id, idempotency_key)`** → at-most-once; UI disable+debounce (O4); atomic write-ahead (O1). |
| **Offline replay** | a re-sent queued sale dedups on its key → prior result returned. A forged *new*-key replay is a *new* sale but is **append-only + audited (actor)** and bounded by `pos.sell` + branch membership; correction is an audited void, never a silent edit. |
| **Unauthorized sale** | RLS WITH CHECK `has_permission(company_id,'pos.sell')` **and** `is_branch_member(branch_id)`; anon/insufficient → `42501`. The governed `pos_record_sale()` re-checks. |
| **Cross-tenant sale** | `company_id` from the resolver; RLS isolates; composite FKs force product+branch into the same company → cross-company reference = FK/RLS denial (proven pattern from crop guard). |
| **Branch mismatch** | selling/reading requires `is_branch_member(branch_id)`; `(branch_id, company_id)` composite FK → a sale can't target a foreign/other-company branch (mirrors planting_templates). |
| **Price tampering** (cashier sends a fake low ₱) | **server recomputes** `price_per_kg`/`line_total`/`total` from the authoritative `products` master in `pos_record_sale()`; client amounts are provisional/display-only. |
| **Inventory mismatch / oversell** | N/A in v1 (no decrement). When Inventory ships, the commit re-validates stock server-side → block/manual (B5 §7). |
| **Void abuse / history rewrite** | `pos.void` permission + **append-only** reversal + immutable `audit_events` (M5); no DELETE/UPDATE of committed sales for any app role. |
| **Negative/zero weight or amount** | CHECK `weight_kg > 0` (or null for bulk), bulk flat `> 0`, `total >= 0`. |

**Result target:** 0 critical / 0 high. A new behavioral guard **`scripts/guards/pos-security.sql`** (mirroring
`crop-security.sql`) proves each row above; wired into `ci.yml` as a permanent `guard:pos` gate.

---

## SECTION 10 — Implementation Plan (M2A → M2D)

Each milestone follows the proven cadence — **Design (done) → Build → Attack → Verify (db reset + guards + tsc/test/
build) → Commit → CI → Lock** — on the locked foundation. No locked migration is modified.

| Milestone | Scope | Delivers |
|---|---|---|
| **M2A — Product Price List** | `products` table + RLS + `product.manage` + audit; **Crop Pricing Menu** screen (add/edit/archive vegetables & ₱/kg). | The cashier grid has data; the smallest shippable backend+UI. |
| **M2B — POS Sale + Ledger** | `pos_sales` + `pos_sale_items` + per-branch slip sequence + `pos.sell` + `pos_record_sale()` (price authority, idempotency, audit) + outbox wiring + **POS Home / weigh / basket / checkout / receipt**. | The core weigh-POS — a cashier can sell, offline, exactly-once, and print a slip. |
| **M2C — History · Void · Settlement** | Sales Journal (filters, CSV) + `pos_void_sale()` (`pos.void`) + `pos_payments` + `pos_settle_sale()` (preorder→paid). | Operational completeness: reconcile deliveries, void errors, audit trail. |
| **M2D — Dashboard & Reporting reads** | Operational Dashboard sales tiles + period/branch/cashier/top-product reads; **reserve** the inventory + accounting integration contracts. | The "see value" payoff — real ₱ KPIs replace the admin counts. |

**Verification per milestone:** fresh `db reset` (M1→M6→P2-M1→P2-M2→M2A…), all existing guards
(static/db/rls/bootstrap/org/crop) **+ new `guard:pos`**, drift, then `tsc`/`vitest`/`build`; local commit; CI; lock.
Offline B5 §12 battery is a blocking gate at M2B.

---

## Compliance & stop condition
- **Operational-first:** POS is the focus; Organization/Crop admin stay **frozen** (audit decision).
- **Built from the prototype, not invented:** every workflow, field, price rule, and screen traces to
  `src/features/POS.tsx` + `src/lib/money.ts` + the screenshots.
- **Foundation reused, not rebuilt:** identity/tenant/RBAC/resolver/RLS/audit/`is_branch_member`/outbox/B5 all reused.
- **This is a specification only — no code, migration, schema, UI, commit, or push.** Implementation begins at **M2A**
  on owner go.
</content>
