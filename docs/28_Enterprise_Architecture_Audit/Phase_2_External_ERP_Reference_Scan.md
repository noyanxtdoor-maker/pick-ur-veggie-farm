# Phase 2 — External ERP Reference Scan

**Type:** Reference / research note (informational — changes NO plan, spec, or security control) · **Date:** 2026-07-03
**Why:** owner asked to "find out more about how the ERP system works" from 12 working open-source ERPs, as
*additional ideas* — "we are gonna use our own unique ERP system … just make it simple, still stick to our plans."
**Method:** GitHub REST API metadata + README feature sections for all 12 (full source not read). Honest scope: this
is a landscape scan of how these products *decompose an ERP*, not a code audit.

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

## 2. How an ERP works — the common mechanics (what the scan actually teaches)
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

## 3. Simple ideas worth borrowing — all already on our backlog (no plan change)
The scan surfaced nothing that isn't already captured. Mapping, so future work stays "stick to our plans":
- **Customer & Supplier masters + credit (AR/AP).** ERPNext Order Management, idurar invoicing. → our **backlog B1**
  (customer credit standing) + `business_partners` deferred in the M3 spec. The GL already has an AR account.
- **Quote → Order → Invoice flow.** idurar, ever-gauzy proposals. → we already have pre-order→AR (M2C); a formal
  *quote* stage is a light future add, not core.
- **Timesheets / attendance feeding payroll.** ever-gauzy's core strength. → already listed *deferred* in the M5
  Payroll spec (attendance/shifts/leave/overtime). Our payroll stays daily-wage until then.
- **Manufacturing / BOM / material consumption.** ERPNext Manufacturing. → maps to our deferred harvest-batch /
  production ledger, which the roadmap already places in **Phase 3**.
- **Plugin/composable modules.** nocobase. → we already build module-by-module with permission keys; no rearchitecture
  warranted (adding a plugin runtime now would be speculative — YAGNI).

## 4. What we deliberately do NOT copy
- **Money as app-layer floats / balances stored on rows** (common in the lean MERN ones) — we keep GL-derived,
  no-float money and append-only journals. Non-negotiable (C7 §4).
- **Single-tenant, app-only authorization** — we keep DB-enforced RLS multi-tenancy.
- **Kitchen-sink breadth** (ERPNext/gauzy carry dozens of modules) — we stay operational-first and simple; breadth
  arrives only as backlog items with their own spec + guard.

**Conclusion:** our unique, farm-focused ERP is architecturally in the same family as these proven systems, and on
the parts that matter (ledger integrity, tenant isolation) it is stricter. Keep building to the roadmap + backlog;
this scan adds confidence, not scope.
