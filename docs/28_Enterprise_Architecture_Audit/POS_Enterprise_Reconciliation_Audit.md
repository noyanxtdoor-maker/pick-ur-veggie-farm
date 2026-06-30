# POS ↔ Enterprise Authority Reconciliation Audit

**Type:** Read-only reconciliation audit (no code, no migration, no schema, no commit) · **Date:** 2026-06-23 ·
**Branch:** `feature/phase-0-foundation`
**Reviewed authority (read in full):** **20.16** Finished Goods · **20.17** Sales Orders & Invoices · **20.24** Cash/
Bank/Digital Wallets · **22.06** Automatic ERP Posting · **22.07** AR Customer Ledger · **22.09** Cash Drawer · **22.10**
Bank/GCash/Maya · **22.16** Inventory-Accounting Integration · **26.07** Financial Posting Rules · **26.09** Permission
Matrix · **03.03** FIFO Engine · (+ session knowledge of 20.09/20.11/20.18/20.22/20.23, 22.19, 25.x, 07.x, 02.x, M1–M6/B5).
**Subject under review:** `Phase_2_M2_POS_Operational_Specification.md`.

> **Method note.** A parallel multi-agent extraction+verification workflow was attempted but every subagent hit the
> account session limit (resets 11:40 Asia/Singapore), so this audit was completed by direct reading of the authority
> docs in the main session. Conclusions are grounded in verbatim authority text, per the rule **"trust the enterprise
> authority, not the prototype or the POS spec."**

## 0. Verdict in one line
🔴 **M2A must be REDESIGNED before any implementation.** The current POS spec creates a **parallel sales/finance/cash
subsystem** (`pos_sales`, `pos_sale_items`, `pos_payments`, `cash_drawers`, `payment_methods`, `receivables`,
`receipts`, per-branch `slip_no`) that **duplicates canonical enterprise tables** and **contradicts** the automatic-
posting, revenue-integrity, and inventory-accounting rules. Building it as written **is the "second ERP inside the
ERP"** this audit exists to prevent.

---

## SECTION 1 — Current POS Design Summary (what the spec proposes)

| POS element | As specified (prototype-derived) |
|---|---|
| **Products / price list** | New `products` table: vegetable name + `retail_per_kg` (NUMERIC) + status; the cashier grid. |
| **POS Sales** | New `pos_sales` header (slip_no, sale_type retail/wholesale, status Paid/Preorder/Voided, totals, tender_cash, change) + `pos_sale_items` (weight × farm price). |
| **Payments** | New `pos_payments` table for pre-order settlement; cash/change captured on the sale; "tender" implied cash/GCash/Maya. |
| **Receipts** | Printed thermal "slip"; spec implies a receipt/slip artifact tied to the sale. |
| **Preorders** | A **status on `pos_sales`** (unpaid delivery) + optional 10% discount + delivery fee + vendor note; settle later. |
| **Voids** | `pos_void_sale()` appends a reversal; sale marked voided. |
| **Offline sales** | Client `uuidv7` idempotency key + `UNIQUE(company_id, idempotency_key)`; write-ahead outbox; server-assigned slip. |
| **Pricing** | Farm discount `farmPerKg = retail × 0.9`; server recomputes from `products`. |
| **Inventory link** | **"v1 = no inventory decrement"** (deferred to a future finished-goods ledger). |
| **Accounting link** | **"POS emits source facts; Accounting (Phase 4) derives GL later."** |
| **Permissions** | New keys `pos.sell`, `pos.void`, `product.manage` (invented, not mapped to a matrix). |

---

## SECTION 2 — Enterprise Authority Mapping

`POS capability → existing System authority → existing DB object → existing workflow → existing accounting impact`

| POS capability | System authority | DB object (existing) | Existing workflow | Accounting impact (existing) |
|---|---|---|---|---|
| **Sellable item (what POS sells)** | **20.16** Finished Goods | `finished_goods_batches` (qty_available/reserved/sold, cost_per_unit, harvest_batch_id) | Crop Block→Harvest→Grading→Packaging→**Finished Goods**→Sales | Finished goods = inventory asset |
| **POS Sale / order** | **20.17** Sales Orders & Invoices · **26.05** ERM Sales-Financial | `sales_orders` (order_number, customer_id, **sales_channel** incl. *Farm Gate*, status, subtotal/discount/tax/delivery_fee/total) + line items | Customer→Sales Order→Inventory reserve→**Invoice**→Payment→Delivery→Revenue | Revenue recognized |
| **Invoice / receipt** | **20.17** | `invoices` ("the legal financial transaction"; cash/credit/partial) | Sales Order → Invoice → Payment | Revenue + AR/Cash |
| **Auto-posting** | **22.06** Automatic ERP Posting · **26.07** Posting Rules | `journal_entries` (20.22) | **"Operational activity AUTOMATICALLY creates the journal"**; *Sale → Invoice → Revenue → Inventory reduced → COGS* | **Dr Cash/AR, Cr Revenue; Dr COGS, Cr Inventory** |
| **Inventory reduction** | **20.16 · 22.16 · 03.03 FIFO · 20.09** | `inventory_movement_ledger` (20.09); finished_goods qty | Sale → controlled stock movement; **"a sale cannot exceed available inventory"** | Inventory ↓, COGS ↑ (FIFO, 22.19) |
| **Cash drawer / cash session** | **22.09** Cash Drawer · **20.24** | `financial_accounts` (account_type=Cash, "POS Cash Drawer") | Opening balance→cash sales→count→**reconciliation**; variance→manager approval | Dr Cash / Cr Revenue or AR |
| **GCash / Maya / Bank tender** | **22.10 · 20.24** | `financial_accounts` (Digital Wallet/Bank) | "ERP records the financial movement"; per-account ledger | Dr Wallet / Cr Revenue or AR |
| **Payment methods** | **20.24** | `financial_accounts` (Cash/Bank/Digital Wallet rows) | money movement = a financial_accounts transaction linked to journal/user/branch | balances **derived from history; manual changes prohibited** |
| **Pre-order / credit (receivable)** | **22.07** AR · **20.23** | `accounts_receivable` / customer ledger | **"Retail cash = no receivable; wholesale/credit = receivable"**; Invoice→AR→Payment→Cash | Dr AR / Cr Revenue; later Dr Cash / Cr AR |
| **Customer (delivery/vendor)** | **20.11** Suppliers/Customers | `customers` | customer master + ledger | — |
| **Delivery (pre-order)** | **20.18** Delivery Logistics | delivery records | Sales Order → Delivery → Invoice | — |
| **Permissions** | **26.09** Permission Matrix | role/permission catalog (M3) | 9 roles; **"permissions > role names"**; Financial/Approval categories | void/refund = Approval Authority |
| **Authorization (enforcement)** | **M4** resolver | `has_permission` / `is_branch_member` | deny-by-default RLS | — |
| **Audit** | **M5** | `audit_events` (immutable) | append-only | — |
| **Offline / idempotency** | **B5** (corrects 26.10) | outbox + `(company_id, idempotency_key)` | at-most-once commit | — |

---

## SECTION 3 — Conflict Analysis

### Duplicated entities
| POS table | Duplicates | Severity |
|---|---|---|
| `pos_sales` / `pos_sale_items` | **`sales_orders` + `invoices` + line items (20.17)** — two sources of revenue truth | **CRITICAL** |
| `pos_payments` | **`financial_accounts` transactions (20.24) + AR payment application (22.07)** | **HIGH** |
| `cash_drawers` | **`financial_accounts` (account_type=Cash) (20.24) + cash-session controls (22.09)** | **HIGH** |
| `payment_methods` | **`financial_accounts` (20.24)** (Cash/GCash/Maya are rows, not a new enum/table) | **HIGH** |
| `receivables` (preorder status) | **AR customer ledger (22.07) / `accounts_receivable` (20.23)** | **HIGH** |
| `receipts` | a **render of the invoice (20.17)** — not a financial table | **MEDIUM** |
| `products` (standalone price list) | the **product/finished-goods/crop master (20.16 / 20.06)** — divorced from harvest traceability | **MEDIUM** |
| `slip_no` (per-branch) | **`order_number` / invoice numbering (20.17)** | **MEDIUM** |

### Conflicting accounting assumptions
- **POS spec: "emit source facts; Accounting derives GL later (Phase 4)."** **CONFLICTS** with **22.06** ("operational
  activity **automatically** creates the journal") and **26.07** ("**financial records must never be partially
  posted**"). A committed sale must atomically post **Dr Cash/AR, Cr Revenue; Dr COGS, Cr Inventory** — not be deferred.
  **Severity: HIGH.**
- **POS spec treats preorder as a sale status with cash captured on the header.** **CONFLICTS** with **22.07** (credit/
  preorder = **AR**, retail cash = no receivable) and the canonical *Invoice→AR→Payment→Cash* trail. **Severity: HIGH.**

### Conflicting inventory assumptions
- **POS spec: "v1 = no inventory decrement."** **CONFLICTS** with **20.17 Revenue Integrity Rule** ("a sale cannot
  exceed available inventory; inventory must be deducted through controlled stock movements"), **22.06** (sale →
  inventory reduced → COGS), **20.16** (finished-goods qty controlled by movements; manual changes prohibited), and
  **22.16** ("every inventory movement has physical **and** financial impact"). Selling with no decrement produces
  **revenue with no COGS and untracked stock** — a financial-integrity break. **Severity: CRITICAL.**

### Conflicting workflows
- POS spec flow (tap → weigh → checkout → `pos_sales`) bypasses the canonical **Customer → Sales Order (channel) →
  Finished Goods → Invoice → Payment → AR/Cash → Posting** chain and the **traceability rule** (every sale → finished-
  goods batch → harvest batch → crop block, 20.17). **Severity: HIGH.**
- POS permissions invented ad hoc; **26.09** is the canonical matrix (9 roles, Financial/Approval categories,
  "permissions > role names"). Void/refund = **Approval Authority**, not a flat `pos.void`. **Severity: MEDIUM.**

### Missing integrations (the POS spec ignores)
COGS/FIFO (**03.03 / 22.19**); finished-goods reservation & movement (**20.16 / 20.09**); AR (**22.07 / 20.23**);
auto-posting (**22.06 / 26.07 / 20.22**); cash session/reconciliation (**22.09**); financial_accounts tender
(**20.24 / 22.10**); customer master (**20.11**); delivery (**20.18**); permission matrix (**26.09**). **Severity:
HIGH (collectively).**

---

## SECTION 4 — Required Changes (per proposed table)

| Table | Verdict | Source of truth | Justification |
|---|---|---|---|
| **products** | **C — extend existing** | **20.16 Finished Goods** (+ crop master 20.06) | POS must sell **finished-goods** (traceable to harvest), not a free-floating price list. Keep only a thin **selling-price book** layer keyed to the product/finished-goods master; do not divorce it from traceability. |
| **pos_sales** | **D — remove / B — reuse** | **20.17 sales_orders + invoices** | A "POS sale" is a `sales_order` with `sales_channel='Farm Gate'/retail` + an `invoice`. A parallel `pos_sales` = two revenue truths and breaks the traceability + posting chain. Reuse 20.17; POS is a fast UI over it. |
| **pos_payments** | **B — reuse** | **20.24 financial_accounts txns + 22.07 AR** | Payments/receipts are `financial_accounts` transactions linked to the invoice; preorder settlement = **AR payment application**. No parallel payment table. |
| **receipts** | **D — remove** | **20.17 invoices** | The slip is a **print/render of the invoice**. Optional thin "print log" metadata only — never a financial record. |
| **cash_drawers** | **C — extend** | **20.24 financial_accounts (Cash) + 22.09** | Reuse `financial_accounts` for the POS Cash Drawer balance; add a small **cash-session** (open/close/count/variance) per 22.09. Do **not** invent a parallel cash ledger (highest fraud-risk asset). |
| **payment_methods** | **B — reuse** | **20.24 financial_accounts** | Cash/GCash/Maya/Bank are **rows in `financial_accounts`**, not a new table/enum. |
| **receivables** | **B — reuse** | **22.07 AR + 20.23** | Pre-order/credit = an **AR entry** against a customer (retail cash = none). Reuse AR; remove any POS-local receivable concept. |

**New that legitimately remains (A):** the **offline outbox / idempotency** plumbing (B5, already built in M1D), the
**weigh-POS UI**, the **selling-price book** thin extension, and a **cash-session** record (extends 20.24) — these have
no enterprise duplicate.

---

## SECTION 5 — Final POS Architecture (Source-of-Truth Matrix)

| Concern | Source of truth |
|---|---|
| Sellable item / Finished Goods | **System 20.16** (`finished_goods_batches`) |
| Selling price (price book) | **extend 20.16 / 20.06** (thin new layer) |
| Sale / Order (channel = Farm Gate) | **System 20.17** (`sales_orders`) |
| Invoice / Receipt | **System 20.17** (`invoices`; slip = render) |
| Sale line items → batch | **System 20.17** (→ 20.16 → 20.15 harvest) |
| Inventory reduction / movement | **System 20.09 + 20.16 + 03.03 FIFO** |
| COGS | **System 22.19 + 22.16** |
| Posting logic (auto) | **System 22.06 + 26.07 → 20.22 GL** |
| Cash Drawer / cash session | **System 22.09 + 20.24** |
| GCash / Maya / Bank | **System 22.10 + 20.24** |
| Payment methods | **System 20.24** (`financial_accounts`) |
| Receivables (pre-order/credit) | **System 22.07 + 20.23** |
| Customer | **System 20.11** |
| Delivery (pre-order) | **System 20.18** |
| Permissions (catalog) | **System 26.09** Permission Matrix |
| Authorization (enforcement) | **M4** resolver (`has_permission` / `is_branch_member`) |
| Audit | **M5** (`audit_events`) |
| Offline / idempotency | **B5** (corrects 26.10) |
| Branch isolation | **P2-M2** `is_branch_member` |

---

## SECTION 6 — Implementation Recommendation

### Must M2A be redesigned first? → **YES. Do NOT proceed unchanged.**

**Exact reasons:**
1. **Duplication (CRITICAL/HIGH):** `pos_sales`, `pos_payments`, `cash_drawers`, `payment_methods`, `receivables`,
   `receipts` each duplicate a canonical enterprise table (20.17, 20.24, 22.07/20.23). Building them creates a second,
   divergent financial subsystem — the exact failure this audit prevents.
2. **Accounting conflict (CRITICAL):** "defer GL to Phase 4" violates **22.06 / 26.07** — posting must be **automatic
   and atomic** with the sale (Revenue + COGS + Cash/AR), never partial.
3. **Inventory conflict (CRITICAL):** "no inventory decrement in v1" violates **20.17 / 20.16 / 22.16** — a sale must
   deduct finished-goods via a controlled movement and recognize COGS, or it manufactures revenue with no cost and
   untracked stock.
4. **Permission conflict (MEDIUM):** POS keys must be derived under **26.09** (Financial/Approval categories; void =
   approval), not invented ad hoc.

### What the redesign should do (and the dependency it exposes)
Redesign **M2A** so the POS is a **fast weigh-and-sell UI over the canonical schema**, at minimum-viable depth:
- **Sell from finished-goods (20.16)** → record a **`sales_order` (channel = Farm Gate) + `invoice` (20.17)**;
- **tender** → a **`financial_accounts` transaction (20.24)** (Cash drawer / GCash / Maya), inside a **cash session
  (22.09)**;
- **credit/pre-order** → **AR (22.07)** against a **customer (20.11)**;
- **inventory** → a **controlled finished-goods movement (20.09/20.16, FIFO 03.03)**;
- **posting** → **automatic journal (22.06/26.07 → 20.22)**: Dr Cash/AR · Cr Revenue · Dr COGS · Cr Inventory;
- **permissions** → keys under **26.09**; **enforcement M4**, **audit M5**, **offline B5**, **branch P2-M2**.

**Exposed dependency (important):** POS **cannot sell from nothing** — it draws down **finished-goods inventory
(20.16)**, which originates from **harvest (20.15) / production (02)**. Therefore the minimal POS slice **requires a
minimal finished-goods stock path** (either a small harvest/finished-goods entry or an **opening finished-goods
balance**, per ODR-001 opening-balance procedures). This means **POS and a minimal Inventory/Finished-Goods capability
are co-requisites**, not POS-then-Inventory. The operational-first priority still holds (POS is the visible goal), but
the build must include the thin finished-goods + auto-posting spine beneath it.

### Concrete next step
**Revise `Phase_2_M2_POS_Operational_Specification.md`** to (a) replace `pos_*` financial tables with reuse/extension
of 20.16/20.17/20.24/22.07, (b) adopt **automatic posting (22.06/26.07)** and **inventory decrement + COGS
(20.16/22.16/22.19/03.03)** as mandatory at sale commit, (c) map permissions to **26.09**, and (d) define the **minimal
finished-goods/opening-balance** prerequisite. Only then author **M2A** against the reconciled spec.

---

## Stop condition
Delivered: **POS_Enterprise_Reconciliation_Audit.md** (Sections 1–6 + source-of-truth matrix + redesign
recommendation). **No implementation, migrations, schema, code, commits, or pushes.** The POS spec is **not** approved
for implementation as written; it requires the redesign above so the build extends the existing ERP instead of
duplicating it.
