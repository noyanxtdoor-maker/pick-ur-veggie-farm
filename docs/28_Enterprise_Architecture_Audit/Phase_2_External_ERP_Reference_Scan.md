# Phase 2 — External ERP Reference Scan

**Type:** Reference / research note (informational — changes NO plan, spec, or security control) · **Date:** 2026-07-03
**Why:** owner asked to "find out more about how the ERP system works" from 12 working open-source ERPs, as
*additional ideas* — "we are gonna use our own unique ERP system … just make it simple, still stick to our plans."
**Method:** GitHub REST API — repo metadata, README feature/module sections, and top-level directory structure for
all 12 (full source not read). Honest scope: a landscape scan of how these products *decompose an ERP* and how they
structure code, not a line-by-line audit.

> Bottom line: the scan **confirms our design**. Every one of these systems is built on the same handful of
> mechanics we already implement (documents post to a general ledger; inventory is a perpetual movement ledger;
> a shared master-data spine; permission-gated modules; multi-tenant). Nothing here requires changing our
> architecture or security stance. The genuinely useful borrowings are all things already on our backlog.

## 1. The 12 repos at a glance
| Repo | Stack | What it is |
|---|---|---|
| **frappe/erpnext** | Python (Frappe) | The reference-grade full suite: Accounting, Order Management, Manufacturing, Asset Management, Projects. |
| **idurar/idurar-erp-crm** | MERN (Node/Express/Mongo/React + AntD) | Simple ERP/CRM: Invoice / Quote / Accounting / Inventory / HR. |
| **inforkgodara/store-pos** | Java (JavaFX) | Retail/wholesale **POS**: Purchase, Sale, Inventory done; finance "later". Closest to our POS-first shape. |
| **hossainchisty/FreshGerium-ERP-Platform** | (early) | SaaS-for-SMEs ERP platform (aspirational; thin). |
| **hubleto/erp** | PHP | ERP/CRM "platform of apps", customizable, plugin-style. |
| **auroravirtuoso/erp-crm** | Node/React | Headless ERP/CRM/e-commerce/accounting — idurar-family. |
| **nareshkumaralaria/rkbm-erp-software** | CSS/JS | Intern-built small ERP (learning-grade). |
| **cocox888/idurar-erp-crm** | Node/React | Fork/derivative of idurar. |
| **maruf-pfc/erp-system** | C# | "Mini ERP" (small). |
| **selfmadecode/NextGen-ERP** | C# | Org-efficiency ERP (C#/.NET). |
| **nocobase/nocobase** | TypeScript | No-code/plugin platform — "everything is a composable plugin." |
| **ever-co/ever-gauzy** | TypeScript (NestJS + Angular) | Business platform: CRM, **HRM + time-tracking**, PM, Financial/Invoicing, Inventory/Supply-chain/Production. |

Note: several (auroravirtuoso, cocox888) are idurar derivatives, so the *distinct* references are really
ERPNext (full suite), idurar (lean MERN), store-pos (POS), ever-gauzy (HRM/time-heavy), nocobase (plugin platform).

## 2. Per-repo deep-dive — modules, architecture, and the one thing we take (or reject)

### 2.1 frappe/erpnext (Python/Frappe) — the reference-grade full suite
- **Modules** (README "Key Features" + its well-known app layout `erpnext/{accounts, stock, buying, selling,
  manufacturing, assets, projects, support, crm}`, with HR/Payroll split into the separate `frappe/hr` app):
  Accounting, Order Management (stock + sales orders + **customers + suppliers** + shipments + fulfillment),
  Manufacturing (BOM, material consumption, capacity planning, subcontracting), Asset Management (purchase→disposal),
  Projects (tasks, **timesheets**, issues).
- **Architecture:** metadata-driven "DocType" model on the Frappe framework — every business object is a DocType with
  auto-generated forms, list views, and a posted GL behind sales/purchase/stock documents. Its accounting is a real
  double-entry ledger; stock is a perpetual ledger (Stock Ledger Entry). Single-app, server-rendered, role-permissioned.
- **What we take:** its module *decomposition* validates ours (accounting as the hub; customers+suppliers as first-class
  masters; manufacturing = BOM+consumption → our Phase-3 production ledger). **What we reject:** the DocType meta-runtime
  (huge; we prefer explicit typed tables + governed functions). Its Manufacturing/Assets breadth is Phase-3+ for us.

### 2.2 idurar / auroravirtuoso / cocox888 (MERN + AntD) — the lean CRM-invoicing family
- **Modules:** Invoice, Quote, Payment, Accounting, Inventory, HR, basic CRM (clients/leads). "Simple to use" is the
  explicit pitch. auroravirtuoso adds a "headless / e-commerce" spin; cocox888 is a straight fork.
- **Architecture:** Node/Express REST + MongoDB (document store) + React/Redux SPA. Money and balances live as
  **fields on Mongo documents** (invoice totals, payment status) — no independent double-entry GL; the invoice *is*
  the record of truth. CRUD-controller per entity.
- **What we take:** the **Quote → Invoice → Payment** lifecycle is a clean, minimal AR flow (our M2C pre-order→AR→settle
  already mirrors it; a formal *Quote* stage is a light future add). **What we reject — hard:** money-as-document-fields
  with no GL. That is exactly the "second ERP with float money" failure our C7 §4 forbids; we post every sale to a
  balanced journal instead.

### 2.3 inforkgodara/store-pos (Java/JavaFX desktop) — closest to our POS-first shape
- **Structure:** a classic desktop app (`src`, `database/STOREPOS.DMP` Oracle dump, `screenshots`, NetBeans project).
  README: **Purchase, Sale, Inventory** modules done; **finance/accounting explicitly "may be developed later."**
- **What we take:** strong validation of **operational-first sequencing** — a real, used POS shipped Purchase+Sale+
  Inventory *before* finance. That is our exact order (POS→Inventory→…→Accounting). **What we reject:** shipping sales
  without the posting behind them — we wired the GL in from M2B so accounting is never a bolt-on. Desktop/Oracle stack N/A.

### 2.4 ever-co/ever-gauzy (NestJS + Angular; TypeORM) — the HRM/time-tracking-heavy platform
- **Modules:** ERP, CRM, HRM (with **time-tracking, activity/productivity monitoring, screenshots**), ATS, Project/Task
  Management, Sales, Financial/Cost (Accounting, Invoicing, Estimates), Inventory/Supply-chain/Production.
- **Architecture:** `packages/*` monorepo — a **plugin core** (`plugin`, `plugins`, `plugin-ui`), a `scheduler`, an
  `mcp-server`, and heavy **desktop apps** (`desktop-*`) plus web. Multi-DB via TypeORM (SQLite demo → Postgres/MySQL/…).
  Multi-tenant at the app layer.
- **What we take:** its center of gravity is **employee time → cost → payroll/invoicing**; confirms *timesheets/attendance*
  is the natural next depth for our daily-wage payroll (already M5-deferred). Its plugin core echoes nocobase. **What we
  reject:** the desktop-app + screenshot-tracking surface (not our farm use-case); breadth we don't need.

### 2.5 nocobase/nocobase (TypeScript) — no-code / plugin platform
- **Architecture:** "everything is a composable plugin"; data models, pages, workflows, and **permissions** are
  configured visually; strong AI-agent integration angle (Claude Code/Cursor/n8n/Dify connectors). It's a *framework to
  build ERPs*, not a fixed ERP.
- **What we take:** the discipline that **modules are uniform, permission-gated units** (our per-module + `has_permission`
  design is the hand-written version of this). Its visual permission model is a nice north-star for a future admin UI.
  **What we reject:** a runtime no-code/plugin engine now — pure speculative flexibility (YAGNI); we add modules as code.

### 2.6 The learning-grade small repos (hubleto PHP · rkbm backend/frontend · maruf client/server/docs · NextGen C# · FreshGerium)
- **Structure:** conventional split stacks (rkbm = `backend`/`frontend`; maruf = `client`/`server`/`docs`; NextGen = C#
  `src`; hubleto = a multi-repo PHP "apps" framework you compose). FreshGerium is an early SaaS-for-SMEs shell.
- **What we take:** confirmation that the *minimum viable ERP* everyone converges on is **auth + org → catalog/inventory
  → sales/invoicing → basic accounting → HR/payroll** — precisely our built order. **What we reject:** nothing to copy;
  these are thinner than what we already have (real RLS, posted GL, guards).

## 3. Capability matrix — reference set vs. ours
Legend: ✅ have · ◑ partial/deferred · ⬜ not built · — N/A. "Refs" = how common across the distinct references.

| Capability | Refs (common?) | Ours today |
|---|---|---|
| Multi-tenant + branch, RBAC | ◑ (mostly app-layer, single-tenant) | ✅ DB-enforced RLS + composite FKs (stricter) |
| Double-entry GL behind documents | ◑ (ERPNext/gauzy yes; MERN no) | ✅ append-only journals, balances derived |
| Perpetual inventory ledger | ✅ (ERPNext, store-pos) | ✅ `inventory_movements` + FIFO batches |
| POS / weigh-sale | ◑ (store-pos) | ✅ weigh-POS with farm pricing (M2) |
| Customers master + AR / credit | ✅ | ✅ **M9A** master + AR standing (enforcement ◑ deferred) |
| Suppliers master + AP | ✅ | ⬜ (intentional: all purchases are cash → no AP yet) |
| Quote → Order → Invoice | ✅ | ◑ pre-order→AR→settle (formal Quote ⬜) |
| Statements (P&L, BS, **Cash Flow**), mgmt reports | ◑ (ERPNext full; others partial) | ✅ **M4A–M4D** GL-truth statements + reports |
| Payroll | ◑ (gauzy strong; others basic) | ✅ daily-wage (M5); attendance/timesheets ◑ deferred |
| Time-tracking / timesheets | ◑ (gauzy core) | ⬜ deferred (M5 note) |
| Manufacturing / BOM | ◑ (ERPNext) | ⬜ Phase 3 (harvest-batch production ledger) |
| Digital payments (e-wallet/bank) | ◑ (idurar payments) | ⬜ **B2** (money-path, review-gated) |
| Scheduling / calendar | ⬜ (rare) | ✅ **M6** (a farm-specific edge we add) |
| Projects / task board | ✅ | ✅ **M7** checklist board |
| Theming / device settings | ⬜ | ✅ **M8** |
| Data export/backup | ◑ | ◑ **B7** client JSON export (governed cloud backup ⬜) |
| No-code/plugin runtime | ◑ (nocobase/gauzy) | ⬜ (rejected — YAGNI) |

Reading of the matrix: we are **at or ahead** of the reference set on the things that matter for a farm operation
(ledger integrity, tenant isolation, POS, statements, scheduling), **on par** on customers/projects/payroll, and the
only ⬜ gaps are either deliberately Phase-3 (manufacturing), money-path-and-review-gated (digital payments), or
rejected speculation (no-code runtime).

## 4. How an ERP works — the common mechanics (what the scan actually teaches)
Across all of them, the same five patterns recur — and we already do each:

1. **Documents drive everything, and post to a general ledger.** Invoices, orders, receipts, journal entries are
   the unit of work; accounting is the hub every operational module feeds. → *We do this:* `pos_record_sale`,
   `inventory_record_purchase`, `record_cash_entry`, payroll fns all emit **balanced double-entry journals**
   into one append-only GL (M2B onward).
2. **Inventory is a perpetual movement ledger, not a stored number.** → *We do this:* `inventory_movements` is
   append-only, function-only; quantities are **derived** (`fg_available`, FIFO `material_batches`). M2A/M3A.
3. **A shared master-data spine.** Customers, suppliers, items, employees, chart of accounts — referenced by
   every module. → *We have:* products, employees, chart_of_accounts, branch spine. *Gap they fill richer:*
   customer & supplier masters (see §3).
4. **Modules are permission-gated and composable.** ERPNext apps, nocobase plugins, hubleto apps. → *We do this:*
   module-by-module with `has_permission()` keys (now 26) and per-module screens/routes.
5. **Multi-tenant / multi-branch with RBAC.** → *We do this at the DB:* RLS + `is_branch_member()` +
   composite tenant FKs — stronger isolation than most of these carry (many are single-tenant app-layer only).

## 5. Simple ideas worth borrowing — all already on our backlog (no plan change)
The scan surfaced nothing that isn't already captured. Mapping, so future work stays "stick to our plans":
- **Customer & Supplier masters + credit (AR/AP).** ERPNext Order Management, idurar invoicing. → **customer master +
  AR/credit standing now BUILT (M9A, B1)**; credit-limit *enforcement* is the money-path follow-up. Supplier/AP master
  intentionally deferred — all purchases are cash today, so there is no AP to show (YAGNI).
- **Quote → Order → Invoice flow.** idurar, ever-gauzy proposals. → we already have pre-order→AR (M2C); a formal
  *quote* stage is a light future add, not core.
- **Timesheets / attendance feeding payroll.** ever-gauzy's core strength. → already listed *deferred* in the M5
  Payroll spec (attendance/shifts/leave/overtime). Our payroll stays daily-wage until then.
- **Manufacturing / BOM / material consumption.** ERPNext Manufacturing. → maps to our deferred harvest-batch /
  production ledger, which the roadmap already places in **Phase 3**.
- **Plugin/composable modules.** nocobase. → we already build module-by-module with permission keys; no rearchitecture
  warranted (adding a plugin runtime now would be speculative — YAGNI).

## 6. What we deliberately do NOT copy
- **Money as app-layer floats / balances stored on rows** (common in the lean MERN ones) — we keep GL-derived,
  no-float money and append-only journals. Non-negotiable (C7 §4).
- **Single-tenant, app-only authorization** — we keep DB-enforced RLS multi-tenancy.
- **Kitchen-sink breadth** (ERPNext/gauzy carry dozens of modules) — we stay operational-first and simple; breadth
  arrives only as backlog items with their own spec + guard.

**Conclusion:** our unique, farm-focused ERP is architecturally in the same family as these proven systems, and on
the parts that matter (ledger integrity, tenant isolation) it is stricter. Keep building to the roadmap + backlog;
this scan adds confidence, not scope.
