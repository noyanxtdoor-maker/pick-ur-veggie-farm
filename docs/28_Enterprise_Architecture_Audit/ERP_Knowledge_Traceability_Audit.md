# ERP Knowledge Traceability Audit (Repository Knowledge Recovery)

**Type:** Read-only knowledge-recovery audit (no code, no migration, no implementation, no commit) ·
**Date:** 2026-06-23 · **Scope:** all `docs/` Systems **00–28** (294 files, 29 sections) + the AI Studio prototype +
UI references.
**Authority basis:** `docs/README.md` (governance precedence), **ADR-001**, the **Stage A Governance Precedence
Model**, the generated `docs/INDEX.md`, the accepted **ERP Traceability (operational-first) Audit**, and the locked
**M1–M6 / P2-M1 / P2-M2** foundation.

> **Why this exists.** The repository holds **years of ERP design** across 28 numbered Systems. The recent
> implementation (Org admin → Crop catalog) and even the operational specs (M1B/M1C, the POS spec) have leaned on the
> *foundation* (B1–B8, M1–M6, B5) but **have not yet drawn on the deep enterprise-layer module designs** (the master
> schema **20**, accounting core **22**, inventory/FIFO **03**, payroll **21**, integration/posting **26**). This audit
> proves which of those assets are authoritative, maps each System to the modules/screens/DB objects that will consume
> it, and names the **unused-but-authoritative inputs** that must feed the next builds — so the accumulated design is
> *used*, not re-invented.

---

## 0. Governance recap (the precedence that drives classification)

Per `docs/README.md` + ADR-001 + Stage A:
- **Enterprise layer — Sections 10–26 = canonical TECHNICAL authority.**
- **Foundation layer — Sections 00–08 = vision / history** (concept summaries; superseded where the enterprise layer
  re-specifies the same domain — audit finding **P2-01**).
- **Section 28 = ratified governance + the B1–B8 foundations, C1–C8 controls, ADR/ODR, roadmap, and the Phase-1/2
  specs** (supreme operational authority).
- Known **internal conflicts** (must be reconciled, not ignored): **P2-01** dual-layer entity-model duplication
  (04 ↔ 22; 05.01/10/20.30/26); **P2-02** contradictory build orders (08.02 ↔ 16.03 ↔ 18.01 ↔ 20-flow) → reconcile to
  **C8** + the operational-first audit; **26.10** "preserve both" offline rule → **corrected by B5**.

**No System 00–28 is OBSOLETE.** Every section retains at least reference value; the weakest are *Superseded*
(content absorbed by a canonical successor) or *Historical/Vision*. Proof is given per row in §2.

---

## 1. Authority Classification Matrix

| Classification | Systems | Meaning |
|---|---|---|
| **ACTIVE AUTHORITY** | **20** (master schema), **22** (accounting core), **03** (inventory/FIFO), **21** (HR/payroll), **26** (integration/posting), **02** (agricultural core), **06** (UI/UX), **11** (security/RBAC/audit), **14** (UI references), **25** (mobile/offline field), **07** (stress testing), **28** (governance + B/C/ADR/ODR/roadmap) | Canonical, drives the next builds. |
| **SUPPORTING AUTHORITY** | **05** (architecture — mostly realized in M1–M6), **10** (DB blueprint → absorbed by 20), **17** (impl prep → realized in M1B), **18** (build: **18.06** dependency map is key), **19** (selective rules: **19.06** inv/acct protection, **19.05** offline, **19.07** field UI), **16** (glossary/arch-map), **12** (12.01 realtime, 12.02 Drive backup), **27** (**27.01** V2 audit = operational reference) | Real but secondary / cross-check inputs. |
| **HISTORICAL REFERENCE (vision)** | **00** (vision/mission/principles), **01** (foundation business modules) | The "why"; not technical authority. |
| **SUPERSEDED** (by a canonical successor) | **04** → 22 · **08** → C8/Master_Execution_Roadmap · **09** → CLAUDE.md + C-series · **13** → 28 + roadmap · **15** → CLAUDE.md + C4/C6 · **01.03** calendar → 20.19 | Keep as concept summaries; build from the successor. |
| **DEFERRED — FUTURE PHASE (NOT obsolete)** | **23** (AI/Codex — Phase 6), **24** (IoT smart-farm — later), parts of **12** (12.05 weather, 12.06 IoT, 12.08 payment, 12.09 AI) | Designed, scheduled later by the roadmap; **not** rejected. |
| **CONTRADICTED — RECONCILE** | **26.10** (offline "preserve both" → corrected by B5) · **08.02/16.03/18.01/20-flow** (build-order conflict, P2-02) · **04 ↔ 22 / 05.01↔10↔20.30↔26** (entity-model duplication, P2-01) | Internally inconsistent; the named successor wins. |

---

## 2. System 00–28 Mapping Matrix

`System · Name · Status · Used By · Future Module · Priority` (priority is relative to the operational-first sequence:
POS → Inventory → Dashboard → Accounting → Payroll → Scheduling → Projects → Settings).

| # | System | Status | Used By (modules) | Future Module | Priority |
|---|---|---|---|---|---|
| 00 | Project Constitution (Vision/Mission/Principles/Rules) | Historical (vision) | All (the "why") | — | LOW |
| 01 | Business Modules (User/Security · Workspace · Calendar engine) | Superseded → 11/20.04/20.19 | Auth, Scheduling | Scheduling | LOW |
| 02 | **Agricultural Core** (Crop Lifecycle · Biological Asset · Crop Loss) | **ACTIVE** | Production, Inventory(harvest), Accounting(bio-asset) | Crop Production / Harvest | HIGH (Production) |
| 03 | **Inventory System** (Raw Material · Harvest Batch · **FIFO Engine** · Storage/Traceability) | **ACTIVE** | Inventory, Accounting(COGS), Procurement, Production, Reporting | **Inventory** | **HIGH** |
| 04 | Accounting (COA/GL/AR-AP/Statements) | Superseded → 22 | Accounting | Accounting | LOW (use 22) |
| 05 | System Architecture (Entity Model · Offline Sync · Security/Audit · **Multi-branch/tenant**) | Supporting (mostly built in M1–M6; 05.02 → B5) | Foundation, all | — (done) | MED |
| 06 | **UI/UX** (Dashboard · Calendar · **Field Tablet Interface**) | **ACTIVE** | Dashboard, Scheduling, every screen | **Dashboard / all UI** | **HIGH** |
| 07 | **Stress Testing** (Accounting · Farm · Security attacks) | **ACTIVE** | every module's guard/test suite | all (testing) | MED-HIGH |
| 08 | Roadmap (Phase Plan · Module Sequence) | Superseded → C8 + Master_Execution_Roadmap; **P2-02 conflict** | — | — | LOW |
| 09 | AI Development Constitution | Superseded → CLAUDE.md + C-series | AI agents | — | LOW |
| 10 | Database Blueprint (Master Entities · Roles/Perms · Relationship Map · Audit · Sync) | Supporting → absorbed by 20 (P2-01) | Foundation, all | — | MED |
| 11 | **Security/Access Control** (**RBAC** · Approval Workflow · Privacy · **Audit Trail** · **Session/Device**) | **ACTIVE** (M1–M6 realized) | ALL (auth, POS cashier, Approvals, BYOD) | all (cross-cutting) | **HIGH** |
| 12 | Integration Architecture (Realtime · Drive Backup · G-Cal · Chat · Weather · IoT · Notif · **Payment** · AI) | Supporting (12.01/12.02) / Deferred (12.05/06/08/09) | Settings(backup), POS(payment later), Scheduling(G-Cal) | Settings / later | MED |
| 13 | Project Status (Maturity · Locked · In-Progress · Future · Change Control) | Superseded → 28 + roadmap (stale) | — (status) | — | LOW |
| 14 | **UI References** (Approved Screens · External inspirations · New/Old UI) | **ACTIVE** (visual authority) | every screen | **all UI** | **HIGH** |
| 15 | Claude Code Onboarding | Superseded → CLAUDE.md + C4/C6 | AI agents | — | LOW |
| 16 | Master Project Index (Overview · Arch Map · **Dev Order** · Rules · Glossary) | Supporting (glossary/arch-map); 16.03 in P2-02 conflict | navigation | — | LOW-MED |
| 17 | Implementation Preparation (Stack · Frontend · Backend · Migration · **API/Service** · **State** · **Offline** · Test · Deploy) | Supporting (realized in **M1B**) | all (app layer) | all | MED |
| 18 | Project Build (Build Order · Std · Component Arch · DB Order · **Module Dependency Map** · Git · Quality Gates) | Supporting (**18.06** key); 18.01 in P2-02 conflict | sequencing, all | all | MED |
| 19 | Claude Code Master OS (Arch Protection · DB Rules · **Offline** · **Inventory/Accounting Protection** · **Field UI**) | Supporting (selective active; rest → CLAUDE.md) | Inventory, Accounting, field UI | Inventory/Accounting | MED |
| 20 | **Supabase Master Database Schema** (30 docs: tenant, users, locations, **crop master**, **inventory item/batch/FIFO/movement/units**, **suppliers/customers**, **purchase/receiving**, **crop blocks/production/harvest**, **finished goods**, **sales orders/invoices**, **delivery**, **calendar**, **accounting COA/GL/AR-AP/cash**, equipment, notif, files, **audit**, **offline queue**, ERM) | **ACTIVE — CANONICAL** | **ALL** | **POS, Inventory, Production, Accounting, Scheduling** | **CRITICAL** |
| 21 | **Human Resources / Payroll Architecture** (22 docs: employee master, attendance, shifts, leave, OT, **salary/payroll engine**, **cash advance**, approval, disbursement, performance, analytics) | **ACTIVE** | Payroll, HR, Accounting(payroll posting), Dashboard(roster) | **Payroll** | HIGH (Payroll) |
| 22 | **Accounting Financial Core** (27 docs: COA, GL, **double-entry engine**, **automatic ERP posting**, **AR/AP**, **cash drawer**, **GCash/Maya**, reconciliation, **inventory-accounting**, **crop cost**, **bio-asset IAS41**, **harvest FIFO COGS**, **payroll posting**, tax, statements, profitability, period closing) | **ACTIVE — CANONICAL** | **POS, Inventory, Payroll, Production, Accounting, Reporting** | **Accounting (+ posting hooks NOW)** | **CRITICAL** |
| 23 | AI Intelligence / Automation (Codex companion, multi-AI gateway, vision, document AI, forecasting, briefings, offline AI) | **Deferred — Phase 6** (NOT obsolete; the prototype's "Codex" button) | future Codex across all | Phase 6 Intelligence | LOW now / HIGH later |
| 24 | IoT Sensors / Smart Farm (ESP32 gateway, environmental, water, EC/pH, pumps, alerts, offline buffering) | **Deferred — later** (NOT obsolete; poly-tunnel fertigation) | Production, Dashboard(realtime) | later | LOW now / MED later |
| 25 | **Mobile / Offline Field Operations** (16 docs: mobile-first, dashboards, **worker task**, **time/attendance**, **fast entry**, camera, push, BYOD, **offline storage/sync**, auth/biometrics, **accessibility/field usability**, stress) | **ACTIVE** | ALL field screens, offline engine | **every operational module** | **HIGH** |
| 26 | **Master System Integration** (16 docs: **ERM layers** [farm-ops, inventory-supply, **sales-customer-financial**], **Financial Posting Rules**, **Module Dependency Map**, **Permission Matrix**, **Offline Sync Rulebook**, AI authority, device trust, risk, retention, **backup/DR**) | **ACTIVE — CANONICAL** (26.10 corrected by B5) | **ALL** | **POS + every integration boundary** | **CRITICAL** |
| 27 | V2→V3 Migration Roadmap (**V2 audit** · refactor strategy · migration order · deprecated replacement) | Supporting (**27.01** = operational reference) / partly historical | operational modules | POS/Inventory (master-data migration) | MED |
| 28 | **Enterprise Architecture Audit** (ADR-001, Phase 0–7 audit, **Stage A governance**, **B1–B8**, **C1–C8**, **ODR**, **Master Roadmap**, **M1B/M1C/M2-POS specs**, handoffs) | **ACTIVE — SUPREME** | **ALL** | all | **CRITICAL** |

---

## 3. Traceability Matrix
`System → Business Workflow → ERP Module → UI Screen → Database Objects → Future Build Phase`
(focused on the operational sequence the owner prioritized.)

| System(s) | Business workflow | Module | UI screen | Database objects (System 20/22) | Build phase |
|---|---|---|---|---|---|
| **20.17, 20.16, 20.11, 20.24 · 22.06/22.07/22.09/22.10 · 26.05/26.07/26.09 · 06.01 · 25.05** | Weigh produce → price → basket → checkout → cash/preorder → slip → post revenue/AR → audit | **POS** | POS Home · Basket · Checkout · Receipt · Sales Journal | `products`/finished-goods, **sales_orders/invoices (20.17)**, **finished_goods (20.16)**, customers (20.11), cash/wallets (20.24), journal_entries (20.22), AR (20.23) | **M2 (now)** |
| **03.01–03.04 · 20.07–20.12 · 22.16/22.19 · 19.06 · 26.04** | Receive material → store → consume/usage → FIFO COGS → movement ledger → low-stock | **Inventory** | Inventory Hub · Movement Ledger · Receive/Use | item_master (20.07), batches_FIFO (20.08), **movement_ledger (20.09)**, units (20.10), purchase_receiving (20.12) | **#2** |
| **06.01 · 21.21 · 22.22/22.23 · 24.09 · 26.06** | At-a-glance KPIs (sales, orders, low-stock, roster, trends) | **Dashboard** | Home Dashboard | reads of sales/inventory/payroll/GL (views) | **#3** |
| **04→22 (all) · 26.07 · 20.21–20.24** | Auto double-entry posting from POS/Inventory/Payroll → statements/period close | **Accounting** | Accounting Ledgers · Statements · Cash Flow | COA (20.21/22.03), GL (20.22/22.04), AR/AP (20.23/22.07-08), cash (20.24/22.09-10) | **#4** |
| **21 (all 22 docs) · 22.20 · 25.04** | Roster → attendance → wage/advance → disburse → payroll posting | **Payroll** | Salaries & Payroll · Wage Journal | employee_master, attendance, payroll_runs, disbursements; payroll journal (22.20) | **#5** |
| **01.03 · 20.19/20.20 · 06.02 · 12.03 · 21.07 · 02.01** | Plan cropping/pickups/shifts on a calendar | **Scheduling** | Schedules & Plans (calendar) | calendar_event_engine (20.19), workspace_calendar (20.20) | **#6** |
| **01.02 · 02.01 · 13.04** | Farm build/planting campaigns with step checklists | **Project Checklists** | Campaign Boards | projects/tasks (to be specced) | **#7** |
| **12.02 · 26.15/26.16 · 11.05 · 05.04** | Branch/POS hardware, theme, language, **Google Drive backup**, account | **Settings Hub** | Settings Hub | config/meta, device/session, backup jobs | **#8** |
| **02.01–02.03 · 20.05/06/13/14/15 · 22.17/22.18/22.19** | Crop block → production events → harvest batch → bio-asset value → COGS | **Crop Production / Harvest** | Production/Harvest screens | crop_blocks (20.13), production_events (20.14), harvest_batch (20.15) | Phase 3/5 |
| **M1–M6 · 11 · 05.03/05.04 · 20.02/03/28/29 · 26.10→B5** | Identity · tenant · RBAC · audit · offline queue (built) | **Foundation** | (cross-cutting) | companies/branches/roles/permissions/user_branch_roles/audit_events | **DONE (locked)** |

---

## 4. Future Dependency Map (what each upcoming module must consume)

```
POS (M2 — NOW)
  ├─ 20.17 Sales_Orders_Invoices   ← the canonical sale/receivable schema (NOT yet in the POS spec)
  ├─ 20.16 Finished_Goods_Inventory ← what POS actually sells (harvested produce stock)
  ├─ 20.11 Suppliers_Customers      ← delivery/vendor party for pre-orders
  ├─ 20.24 Cash_Bank_Digital_Wallets ← cash drawer + GCash/Maya tender
  ├─ 22.06 Automatic_ERP_Transaction_Posting ← sale → GL posting contract
  ├─ 22.07 AR_Customer_Ledger / 22.09 Cash_Drawer / 22.10 GCash_Maya ← tender + receivable
  ├─ 26.05 ERM Sales-Customer-Financial / 26.07 Financial_Posting_Rules / 26.09 Permission_Matrix
  └─ 06.01 Dashboard · 25.05 Fast_Data_Entry · B5 offline · the AI Studio prototype (authoritative screen)

INVENTORY (#2)  ← 03.* (FIFO/harvest/traceability) · 20.07–20.12 · 22.16/22.19 · 19.06 · 26.04
DASHBOARD (#3)  ← 06.01 · 21.21 · 22.22/22.23 · 26.06 · 24.09(later)
ACCOUNTING (#4) ← 22.* (canonical) · 26.07 · 20.21–24 · (04 = concept summary only)
PAYROLL (#5)    ← 21.* (all) · 22.20 · 25.04 · 26.09
SCHEDULING (#6) ← 20.19/20 · 06.02 · 01.03 · 12.03 · 21.07
PROJECTS (#7)   ← 01.02 · 02.01 · 13.04 (needs a fresh spec)
SETTINGS (#8)   ← 12.02 · 26.15/16 · 11.05 · 05.04
PRODUCTION/HARVEST (Phase 3/5) ← 02.* · 20.05/06/13/14/15 · 22.17/18/19
DEFERRED        ← 23 AI/Codex (Phase 6) · 24 IoT (later) · 12.05/06/08/09
```

---

## 5. GOAL — repository assets currently UNUSED but that SHOULD become authoritative inputs

The implementation and even the operational specs have drawn on the **foundation** (B1–B8, M1–M6, B5, 25, 14) but have
**not yet consumed the deep enterprise-module designs**. These are the "years of design" at risk of being ignored —
each should become a **mandatory input** before its module is built:

1. **System 20 (Master Schema)** — the canonical table designs. **Unused so far.** Must drive POS (20.16/20.17/20.11/
   20.24), Inventory (20.07–20.12), Production (20.05/06/13/14/15), Accounting (20.21–24), Scheduling (20.19/20).
2. **System 22 (Accounting Core)** — posting, cash drawer, GCash/Maya, AR/AP, FIFO-COGS, payroll posting. **Unused.**
   Required by POS (posting/tender), Inventory (COGS), Payroll, Accounting.
3. **System 03 (Inventory/FIFO)** — the FIFO + harvest-batch + traceability engine. **Unused.** Inventory + COGS.
4. **System 26 (Integration)** — **26.07 Financial Posting Rules, 26.05 Sales-Financial ERM, 26.08 Dependency Map,
   26.09 Permission Matrix.** **Unused.** Govern POS posting, module sequence, and the permission catalog growth.
5. **System 21 (HR/Payroll)** — the complete payroll engine. **Unused.** The Payroll module.
6. **System 02 + 22.17/18** — biological-asset / crop-cost accounting. **Unused.** Production.
7. **System 06 + 25** — Dashboard/Calendar/field-UX rules (partially used in M1B/M1C). Extend for Dashboard/Scheduling.
8. **System 07** — stress-test scenarios. Should seed each module's **attack guard** (POS already plans `guard:pos`).

### ⚠️ Most actionable finding (the POS spec)
The just-written **`Phase_2_M2_POS_Operational_Specification.md`** was grounded in the **AI Studio prototype** (correct
for UX) but **did not reconcile against** the canonical sale/finance schema — **20.16 Finished_Goods, 20.17
Sales_Orders_Invoices, 20.24 Cash/Wallets, 22.06 Auto-Posting, 22.07 AR, 22.09 Cash Drawer, 22.10 GCash/Maya, 26.05/
26.07/26.09**. **Before M2A implementation**, the POS spec should get a **reconciliation pass** that (a) maps its
`pos_sales`/`pos_sale_items`/`pos_payments` to **20.17 / 20.16 / 20.23-24** naming and (b) adopts the **26.07 posting
rules + 26.09 permission matrix**. This single step prevents the prototype-led POS from diverging from the enterprise
schema the owner already designed.

---

## 6. "No system is obsolete" — proof summary
- **23 (AI), 24 (IoT)** — *deferred*, not obsolete: scheduled by the roadmap for later phases; 23 is the prototype's
  visible "Codex" assistant; 24 is the poly-tunnel sensor/fertigation design.
- **00, 01, 04, 08, 13, 16** — *historical/superseded*, still valuable: 00/01 = vision; 04 = accounting concept summary
  (build from 22); 08/13/16 = early plans/status reconciled to C8 + 28 + the roadmap.
- **05, 10, 17, 18, 19** — *supporting*, largely realized in M1–M6/M1B and still cited (18.06 dependency map, 19.06
  inventory/accounting protection).
- Everything else is **active authority**. The only thing genuinely retired is the **deprecated `MANIFEST.json`** (a
  tool artifact, not a System), already superseded by `INDEX.md`.

---

## Stop condition
Delivered: (1) this **ERP Knowledge Traceability Audit**, (2) the **System 00–28 Mapping Matrix** (§2), (3) the
**Authority Classification Matrix** (§1), (4) the **Future Dependency Map** (§4) + traceability matrix (§3) + the
unused-but-authoritative answer (§5). Also added the **Preach My Gospel** app to
`docs/14_UI_References/External_App_UI_Inspirations/` as an **inspiration-tier** UI reference (lowest authority).
**No code, migrations, implementation, commits, or pushes.**
