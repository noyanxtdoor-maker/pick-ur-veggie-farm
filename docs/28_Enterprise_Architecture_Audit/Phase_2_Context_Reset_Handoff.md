# Phase 2 — Context Reset Handoff (STANDING continuity artifact — keep updated every session)

**Type:** Continuity artifact (not a summary) · **Updated:** 2026-07-04 · **Branch:** `feature/phase-0-foundation`
**Owner standing instruction (2026-07-02):** *always update this handoff for the next AI session before usage runs out.*

> Read this FIRST in a fresh session. Verify git reality, then continue at §6 (Immediate next step).
> Supersedes `Stage_D_Phase_1_Context_Reset_Handoff.md` (historical) for day-to-day resumption.

## 0. ⚡ 2026-07-04 SESSION STATE (owner review day — read before §6)
- **PUSH IS NO LONGER OWNER-GATED-BY-PASTE:** owner authorized pushing ("push it and paste the CI run") AND this
  environment can now **fetch CI itself** via the stored git credential (`git credential fill` → GitHub API).
  Pushed `362657f..6efaea4`, then `6efaea4..7de5077`. **CI audit of run 28689841036 (@6efaea4): Verify ✅ ·
  DB guards ✅ · Secret scan ❌ = FALSE POSITIVE** (Gitleaks generic-api-key on prose in the Play-readiness doc —
  reworded in `7de5077`; NO real secret). Follow-up run `28691850328` (@7de5077) — check conclusion at session start
  via the API; expect green.
- **Owner review 2026-07-04 → `Phase_2_Owner_Review_2026-07-04_Plan.md` is the ACTIVE WORK PLAN** (phases A–D to
  Google Play). Built this session (commit `884b138`): POS drawer strip removed (manual drawer at launch; M2C DB
  machinery untouched) · dark toggle in top bar · Cosmic Mint → calm "Midnight Farm" (#7cb98f/#131614) · Green
  Pastures revised distinct (#1e7a3f/#eef7e8) · new `farm-card` surface token (all 32 bg-white swapped — dark mode
  recolours everything) · Inventory "Log Stock Usage" (worker flow → governed adjust, "Used:" reason).
- **Phase A.1 DONE (`155691a`):** Operations hub — Schedules/Crops/Projects under one nav entry with
  Accounting-style tabs; Crops keeps sub-tabs; legacy paths redirect; nav 12→9 entries. Browser-verified.
- **Phase A.2 DONE (`b18136e`):** mobile bottom nav — 4 customizable shortcut slots (puv_mobile_nav pref,
  pin/unpin sheet, PINNED badges) + More sheet with all sections; rail hidden on phones; safe-area handled.
  Browser-verified at 375×812 incl. live customization persistence.
- **Phase A.3+A.4 DONE (`9b645eb`) → PHASE A COMPLETE.** 375px audit: zero overflow across all 8 screens;
  Sign Out icon-only on phones; Inventory split into "Buy Stock" / "Log Expense" doors (utilities prefill +
  live where-does-the-money-land hint); pre-order checkout states the numpad is optional (Skip-Weigh flow).
- **Phase B.1 DONE (`ad9eb3f` db / `3d0470e` app) — payroll self-visibility (M5C).** Additive
  `employees.user_id` + three `*_select_self` OR-policies (read-only self view; M5A untouched) +
  `payroll_link_employee_user` (manage-gated, member check, audited). guard:payroll **19/19** (5 new
  M5C attacks) · full suite **157 PASS / 0 defects** · vitest 74/74 · browser-verified ("My Payroll"
  self view + roster Link-User modal). Migrations immutable through `20260704090000_p2m5c`.
- **Phase B.2 DONE (`8fb9977`) — schedule visibility tiers (M6C).** calendar_events.visibility
  General|Management + grantable `schedule.read_private` (WHO sees management plans = a per-role setting in
  Roles, per owner ask). guard:scheduling **11/11** (investor meeting hidden from staff; read_private reveals;
  branch isolation holds) · full suite **160 PASS/0** · vitest 74/74 (29 perm keys) · browser-verified (tier
  filters, "Who can see this?" select, Mgmt chip). Migrations immutable through `20260704120000_p2m6c`.
- **Phase B.3 DONE (`071d368`) — project timelines on the calendar.** App-only overlay (projectOverlay.ts pure
  date logic, 4 tests): month-grid stripes across each project's [start,end] span (red on finish day), day-panel
  "Projects on this day" block with % + finish date, linked to the board. vitest 78/78; browser-verified.
- **Phase B.4 DONE (`623e5d2`) — Approvals Admin screen.** Owner-screenshot flow over the real RBAC engine
  (no new DB surface): pending-approvals panel (signup queue = cloud phase), users directory with hierarchy-
  filtered role dropdown (reassign = expire+insert, membership.manage gate unchanged), role-authority text,
  Revoke/Reactivate + self-protection, Set Permissions → Roles. Per-user overrides deliberately deferred
  (would evolve the locked has_permission resolver). Default tab of /organization. Browser-verified.
- **B-report DONE (`ad3c58c`) — Purchase Summary.** New Inventory tab: spend by category + by source
  (Lazada/Shopee/TikTok/physical) with % + period filter; pure `purchaseSummary`/`filterByPeriod` (5 tests).
  Also fixed a real tab-isolation bug (equipment block was the bare `else`, leaked under the new tab). 82/82.
- **⏭ PHASE B COMPLETE. NEXT:** remaining plan = Phase C (money-path, GATED on cross-vendor review: B2
  digital payments, credit-limit enforcement, delivery settle edits) + Phase D (owner/infra: Supabase project
  + hosting, signup-approval queue, Bubblewrap→Play packaging). Also open: calendar Google-style day view w/
  time indicator + drag (B-polish), hint-text sweep continuation.
  B.3 projects↔calendar (project timelines as calendar entries; per-project edit setting).
  B.4 Roles & Approvals screen per owner screenshots (role dropdown + appointment hierarchy Dev→Owner→Admin,
  per-feature view/edit overrides — UI over existing roles/role_permissions; company/branch kept).
  Phase C money-path stays gated on the cross-vendor review (B2 digital-payments spec committed).
  Phase D = Supabase project + hosting + signup-approval queue + Play packaging (PWA foundation shipped).

## 1. What this project IS now (course-corrected)
An **operational farm ERP centered on the Weigh POS**, per the accepted ERP Traceability Audit. The **Google AI
Studio prototype in `src/` is BOTH the workflow authority for operational modules AND the visual authority**
(owner decision 2026-06-28; `docs/14_UI_References` set aside for now). Enterprise docs **Systems 10–26 are the
technical authority** (esp. 20 schema, 22 accounting, 03 inventory, 26 posting/permissions) — see
`ERP_Knowledge_Traceability_Audit.md` + `POS_Enterprise_Reconciliation_Audit.md` (why: prevent "a second ERP
inside the ERP"). Org-admin + Crop-catalog modules are **FROZEN** (supporting, not the product).
**Priority order:** POS → Inventory → Dashboard → Accounting → Payroll → Scheduling → Projects → Settings.
- **Refined mockup (owner, 2026-07-03):** a newer, more complete Google AI Studio mockup ("95% accurate to my
  target") lives at `C:\Users\sherl\Documents\UI and System Workflow Reference\` (35 screenshots, intentionally NOT
  in git). Catalogued in **`Phase_2_Mockup_Reference_and_Backlog.md`** — read that before building any remaining
  module. It confirms the built modules and reveals deferred features now **backlogged (priority order unchanged)**:
  customer master + credit standing, GCash/Maya/bank digital payments, full accounting statements + management
  reports, plus unbuilt modules Schedules/Projects/Payroll/Settings and a future **VeggieGenius AI Copilot**
  (local LM Studio AI — recorded intent, **owner decides timing later**; security stance unchanged: AI assists,
  ERP authorizes, runs under the user's permissions, never bypasses RLS/finance).

## 2. Git state (verify on session start)
- Branch `feature/phase-0-foundation`. Protected: `develop`=`d1c1f04`, `main`=`7833c9f` (NEVER touch).
- **Pushed (origin tip `375f8ad`, pushed 2026-07-02 on owner go):** M1–M6 (locked #11–#21) · P2-M1 org backend
  (locked #23) · M1B/M1C docs · `5daee3d` M1D app · `a67ca58` crops · `439421e` M2-prep docs · `147d37b` **M2A** ·
  `0c327ae` **M2B** · `7f3b7cd` weigh-POS UI · `8f8daf5` AI-Studio design + journal + KPIs · `9aa75f3` farm-theme
  sweep + M2C spec · `1c5417d` **M2C-a** (migration `20260702090000_p2m2c…` + guard:pos 15/15) · `11d8db0`
  **M2C-b** (pre-order/settle/void/cash-session UI, browser-E2E) · docs/charter commits.
  **⚠️ CI FOR THIS PUSH (and the prior `0c327ae` push) NEVER AUDITED** — owner pastes the Actions run (this env
  cannot fetch Actions); audit per §5 before declaring M1D/crops/M2A/M2B/M2C *locked*. One green run at `375f8ad`
  covers the whole tree. Never assert CI green unseen.
- **Pushed 2026-07-02 evening (origin tip `169eed8`, owner "continue in order"):** everything through M2E —
  M2D dashboard reads (`cfda1da`) · M2E prototype-parity farm pricing + bulk (`ea7c2ac` db / `5157aed` app) ·
  docs/chore commits.
- **Pushed 2026-07-03 (origin tip `362657f`, owner "go continue"):** **Module 3 Inventory** — spec (`ccf70f9`) ·
  M3A materials/equipment db spine (`e6f999a`, guard-proven) · M3B Inventory UI + real Low-Stock tile (`de05e5e`,
  browser-verified). **CI for ALL THREE pushes (`375f8ad`, `169eed8`, `362657f`) still awaiting owner paste +
  audit — one green run at `362657f` covers the entire tree through Module 3.**
- **Local-only (ahead 11, push = owner gate):** M4 (`9de0d51`/`912b0fc`/`5555078`) · `f975f26` handoff ·
  `7a3bda8` **mockup reference + backlog** · M5 Payroll (`ad4f81a` spec / `f68b634` db / `661f949` app) ·
  `bdb80af` handoff · M6 Scheduling (`1da7d60` spec+db / `e9c27ad` app) ·
  M7 Projects (`93b626e` spec / `390e3f4` db / `3f7a38b` app) · `57ab658` handoff ·
  M8 Settings Hub (`216c01b` spec / `d590a91` app — client-only, no db) · `1f6fe06` handoff ·
  `6960615` external ERP reference scan · M4C accounting reports (`77d2a5d` — app-only, read-only over GL) ·
  `8147da1` handoff · M4D cash flow statement (`984560f` db + guard / `8d22a43` app — guard-proven, ties by construction).
  `e37dc04` handoff · M9A Customers & Credit (`8928769` db+guard / `7680b05` app — B1, guard-proven, non-money) ·
  `75e96b8`/`04b4b6c` M9A statement-of-account · B7 export (`3b8fbb3`) + `effbc67` handoff · `c3949b1` deepened scan ·
  **`c80f167` security fix (export excludes outbox) · `c896566` PWA foundation (manifest+SW+icons, Google Play step 1).**
- **Migrations immutable through `20260703180000_p2m9a` (cash_flow_statement fn + customers master + additive
  invoices.customer_id).**
- **Security sweep (2026-07-03, clean):** no committed secrets (only `.env.example`; anon-key-only from env,
  service_role never bundled); no XSS sinks (no dangerouslySetInnerHTML/innerHTML/eval in `app/`); **all 38 tables
  RLS enabled + forced**, zero `anon` grants; `purgeCache` covers every cached table (outbox intentionally kept);
  M9A customer/credit fns are search_path-empty SECURITY DEFINER with actor + `has_permission` + cross-tenant guards.
  One real fix applied: `exportLocalData` no longer dumps the write-ahead outbox (shared-terminal leak vector).
- **Modules feature-complete locally: 2 POS (M2A–M2E) · 3 Inventory (M3A+M3B) · 4 Accounting (M4A+M4B) ·
  5 Payroll (M5A+M5B) · 6 Scheduling (M6A+M6B) · 7 Projects (M7A+M7B) · 8 Settings (M8, client-only).**
  ✅ **ALL 8 ROADMAP CORE MODULES COMPLETE.** Migrations immutable through `20260703160000_p2m7a`
  (M8 adds none).

## 3. What is BUILT
- **DB (pushed):** M1–M6 foundation; org setup; crop catalog (frozen); **M2A** `products` + `finished_goods_batches`
  (qty DERIVED from `inventory_movements` — append-only, function-only, tamper-proof) + `record_opening_finished_
  goods()` + `fg_available()`; **M2B** `pos_record_sale()` → atomic sales_order+invoice+stock-decrement+COGS+
  **balanced GL** (chart_of_accounts CASH/SALES/COGS/FG_INVENTORY/AR; journals append-only). Guards: static/db/
  rls(23)/bootstrap(8)/org(13)/crop(11)/inventory(12)/pos(8)/drift — all green locally pre-push.
- **DB (local commit `1c5417d`, VERIFIED — guard:pos 15/15):** **M2C-a** — preorder→AR (`invoice_type=credit/
  status=Unpaid`, server-applied 10% discount + delivery_fee + customer_note; Dr AR/Cr Sales + COGS pair),
  `pos_settle_sale` (Dr Cash/Cr AR, status-idempotent), `pos_void_sale` (append-only reversing journal +
  stock-return movements, reason mandatory, `pos.void` = 26.09 approval tier, idempotent), `cash_sessions`
  open/close (SERVER-derived expected cash, variance needs reason, one Open per branch), +3 permission keys
  (`pos.settle`/`pos.void`/`cash.session`). Note: cash-session guard test derives expected as postgres because
  `now()` is fixed per transaction in the guard's single-tx run.
- **App (local commits):** V3 `app/` on M1B stack; **runs with no cloud** (mock adapter auto-on when Supabase
  unconfigured; demo login = any credentials); weigh-POS terminal (grid/weigh/slip/checkout/receipt) + Historical
  Sales Journal + dashboard ₱ KPIs; whole app in the **prototype farm theme** (tokens in `app/index.css`:
  farm-green #003e1c etc.). `pos_record_sale` charges `products.retail_per_kg` (server price authority — the
  prototype's 10% "farm discount" display was NOT faked; dual pricing = future owner decision).
  Launch: `.claude/launch.json` → `v3-app` (auto-port; `npm run dev` = port 3000). Tests 22/22; tsc clean; build OK.
- **App (local `cfda1da`): M2D dashboard reporting reads** — app-only (NO migration/permission; reads reuse
  member RLS; cross-branch owner reporting reserved behind future `pos.read.all`; spec `Phase_2_M2D_Dashboard_
  Reporting_Spec.md`). Pure `summarizeSales()` (`app/features/pos/report.ts`, 7 unit tests): voided excluded,
  receivables = all-Unpaid balance, Today/7d/30d periods, 7-day trend (honest zeros), top products ₱+kg,
  by-branch/by-cashier. `posApi.fetchSalesReport()`: canonical selects online (30d window + all Unpaid; cashier
  names only via users RLS `user.read`); mock/offline → device cache labeled "this device". Dashboard: receivables
  KPI, voided-exclusion bug fixed, recharts trend (lazy chunk), insights panel, recent-sales stream.
  Browser E2E: paid 240 + preorder 263 (10% disc + 20 fee) + prior void → KPIs 878/3/263 exact.
- **M2E (local `ea7c2ac` db + `5157aed` app): PROTOTYPE-LOGIC PARITY** (spec `Phase_2_M2E_Prototype_Parity_
  Spec.md`; owner ordered "fully follow the mock's logic"). DB: `pos_record_sale` charges the **FARM price
  round(retail×0.90,2)** per weighed line (retail snapshotted in `sales_order_items.retail_unit_price`); **bulk
  Skip-Weigh lines** `{product_id, bulk_price}` = revenue-only (no movement/COGS — spec §3 reconciliation);
  pre-order 10% stacks on the farm subtotal (mock formula); `pos_void_sale` skips bulk lines. guard:pos **18/18**
  (farm 270/263/237/740 + bulk batteries); all other tiers green; drift clean. App: dual-price grid (farm +
  struck-through Reg), Skip Weigh flow, Farm-Discount-Saved on slip+receipt (+cashier/permit lines), journal
  Sale-Type filter + Type/Posted-By columns + CSV export, **Crop Pricing Menu** (product.manage; add/reprice/
  archive — prototype Delete = Archive), dashboard Retail/Wholesale split. tsc clean; vitest 25/25; build OK;
  live E2E: 2kg Tomato 216 farm + bulk 500 → 716/saved 24; pricing menu loop; dashboard 878/716 split.

- **Module 3 Inventory (local `e6f999a` db + `de05e5e` app; spec `Phase_2_M3_Inventory_Module_Spec.md`):**
  **M3A** — item_categories (mock set seeded)/inventory_items (identity only; reorder_level = mock limit)/
  purchase_receivings (20.12; PO+partners reserved)/material_batches (FIFO, qty DERIVED); the locked M2A
  `inventory_movements` evolved additively into the ONE ledger (item_id/material_batch_id, fg-XOR-material);
  functions inventory_record_purchase (atomic receiving+item+batch+movement+Dr RAW_MATERIALS|EQUIPMENT/Cr CASH
  +asset), inventory_adjust_material (reason mandatory; FIFO drain + shrinkage at consumed cost; increase =
  zero-cost found stock), equipment_log_check; +2 permissions (inventory.purchase/equipment.manage; snapshot=18).
  guard:inventory **24/24** (+12: FIFO order, idempotent purchase, function-only writes, one-domain ledger).
  **M3B** — prototype-parity Inventory UI (category cards/low-stock/purchase modal w/ autocomplete/audit
  adjustment/equipment checklist + history) + **real Dashboard Low-Stock tile** (consumables only). Browser E2E:
  seeds 12pcs/₱600 → Sufficient; pump ₱3500 → checklist → Needs Maintenance; adjust −7 → 5pcs Critical + banner;
  tile = 1. Tests 30/30.

- **Module 4 Accounting (local `912b0fc` db + `5555078` app; spec `Phase_2_M4_Accounting_Module_Spec.md`):**
  central finding — V3 already has a real posted GL (journal_entries/lines since M2B); Accounting does NOT
  recompute like the mock, it (a) closes the one posting gap (non-operating cash movements) and (b) **reads**
  the GL for statements. **M4A** — `cash_entries` (22.09: Owner Investment/Other Income/Loan Received/Loan
  Payment/Owner's Drawings; Equipment Purchase deliberately excluded — already `inventory_record_purchase`'s
  domain) + `record_cash_entry`/`void_cash_entry` (atomic balanced; reason-mandatory reversal not delete, 22.24)
  + `trial_balance`/`income_statement_monthly`/`balance_sheet` (STABLE SECURITY DEFINER, company-wide + optional
  branch filter, permission-gated); +2 permissions (`accounting.read`/`accounting.manage`; snapshot=20).
  **Two cross-module GL-completeness bugs found+fixed:** M3A was posting utilities/transport/misc purchases to
  the RAW_MATERIALS inventory asset (per 22.03 those are opex) — evolved to a new `OPERATING_EXPENSES` account;
  M2A's `record_opening_finished_goods` (predates the GL) never posted anything — evolved to post Dr
  FG_INVENTORY/Cr Owner's Equity (capital-in-kind, ODR-001). **A third bug — `balance_sheet()` double-subtracting
  Owner's Drawings from `total_equity` — was caught by the guard's own non-zero-drawings fixture** (invisible in
  earlier all-zero-drawings manual testing); fixed in both the SQL and the mock (`mockLedger.ts` had the same bug).
  guard:accounting **17/17**; all other tiers green; drift clean. **M4B** — Dashboard (4 KPIs + net-income-trend
  + sales-vs-opex charts), Financial Statements (Income Statement/Balance Sheet/Trial Balance/Chart of Accounts,
  year+branch filters), Cash Ledger (log/void, mandatory reason). `mockLedger.ts` reconstructs the same figures
  from existing Dexie caches for the no-cloud demo path (documented approximation; SQL guard is the audited
  truth). vitest 40/40. Browser E2E: POS sale → accounting picks up revenue/COGS exactly; Owner Investment entry
  → Balance Sheet/Trial Balance tie out to the peso; void reverses exactly; **Owner's Drawings scenario
  (₱8,200=₱8,200) independently confirms the same fix the SQL guard proved.**
  **Deferred (spec §2, recorded not forgotten):** Statement of Cash Flows, Cost Schedule, Statement of
  Operations, standalone Retained Earnings tab, Management Reports tab, GL/vendor ledgers (need 20.11 partners).
  These + customer-credit + digital-payments are now consolidated in `Phase_2_Mockup_Reference_and_Backlog.md`
  (§4 B1–B9) as the reconciled backlog — priority order unchanged.

- **Module 5 Payroll (local `f68b634` db + `661f949` app; spec `Phase_2_M5_Payroll_Module_Spec.md`):** lean
  daily-wage payroll matching the prototype. **M5A** — `employees` (company master, payroll.manage RLS) +
  `cash_advances` + `wage_payments` (branch-owned, function-only) + `payroll_record_cash_advance` (Dr Employee
  Advances/Cr Cash) + `payroll_disburse_wage` (gross = days×rate server-recomputed = wage authority; Dr Wages/Cr
  Cash net/Cr Employee Advances deduction; net≥0; deduction≤outstanding) + `employee_advance_balance` (derived,
  never stored); +2 permissions (payroll.read/manage — salary reads hidden from Worker/Operator). **22.20
  integration:** evolved `income_statement_monthly` (+wages OpEx) and `balance_sheet` (+Employee Advances asset,
  new column) additively. guard:payroll **14/14**; all tiers green; drift clean. **M5B** — Payroll screen (roster
  w/ live undeducted-advance pill, Hire/Log-Advance/Disburse-Wage modals w/ gross/net preview, Wage Journal,
  resign/reactivate); threaded payroll into the mock accounting reconstruction + added the Employee-Advances
  balance-sheet row. vitest 46/46. Browser E2E: hire Juan 550/day → advance 500 → wage 2d (gross 1100, deduct 500,
  net 600) → journal exact → **balance sheet ties 3,100=3,100 with Employee Advances asset + wages in RE**.
  **Money path → cross-vendor review before lock (charter §4.6), same as M2E/M4A.**

- **Module 6 Scheduling (local `1da7d60` db + `e9c27ad` app; spec `Phase_2_M6_Scheduling_Module_Spec.md`):**
  first **non-money** operational module (no GL, no cross-vendor review). `calendar_events` (branch-owned, 20.19:
  event_type/title/description/event_date/priority/status; project_id reserved for M7). Plain RLS-gated writes
  (schedule.manage) + branch-member read (schedule.read), audited; +2 permissions. guard:scheduling **8/8** (tenant
  + branch isolation, write/read gating, audit). M6B: month-grid calendar (per-day type-colored dots) + selected-day
  list + New-Event modal + mark-complete/delete; nav `/schedules`. vitest 50/50. Browser E2E: create Planting event →
  renders on grid + day panel, branch-scoped. Deferred (spec §2): datetime ranges, per-role visibility, automation,
  assignment/crop/zone/equipment refs, week/day views.

## 4. Environment & constraints
Windows + PowerShell/Git-Bash. Supabase local needs **Docker Desktop** (`npx supabase db reset`); `psql` NOT on
PATH → run guards via `docker exec -i supabase_db_pick-ur-veggie-farm psql -U postgres -d postgres -v
ON_ERROR_STOP=1 -q < scripts/guards/<file>.sql`. **Cannot fetch GitHub Actions** (owner pastes; you audit).
Cloud Supabase project `jabjyvdkadcbfocaerno` is **linked, remote schema EMPTY** (8+ migrations local-only;
`supabase db push` is a separate, owner-gated deploy decision). Subagents/workflows may hit session limits —
prefer solo + behavioral guards for migrations. **Cadence:** Build → Attack (db reset + guards) → Verify (guards +
tsc/vitest/build) → LOCAL commit → owner pushes → owner pastes CI → audit → lock. Locked migrations are immutable;
evolve via new migrations (`create or replace` / additive `alter` — the M4/M2C pattern).

## 5. CI audit checklist (when owner pastes a run)
verify: npm ci · tsc · vitest (50 tests at `e9c27ad`) · build, no skips/continue-on-error.
secrets: full-history gitleaks. db-guards: realistic non-cached `supabase start` (~2-3m) → db reset applying ALL
migrations → guard steps static/db/rls/bootstrap/org/crop/**inventory**/**pos**/**accounting**/**payroll**/
**scheduling**/drift each visibly executed → stop. No `|| true`.

## 6. Immediate next step (in order)
**✅ ALL 8 ROADMAP CORE MODULES ARE FEATURE-COMPLETE LOCALLY** (POS · Inventory · Dashboard · Accounting ·
Payroll · Scheduling · Projects · Settings). The operational build is done; what remains is owner gates +
backlog, not new core modules.

0. **Google Play (owner asked "how close?") — see `Phase_2_Google_Play_Readiness.md`.** Path = PWA → Trusted Web
   Activity → AAB. **Step 1 SHIPPED (`c896566`):** installable-PWA foundation (manifest + service worker + icons,
   prod-only SW registration, browser-verified). **Remaining is owner/infra, not app code:** stand up Supabase +
   HTTPS hosting (app still runs mock-mode, no `VITE_SUPABASE_*` set) → PNG icons + Bubblewrap wrap → assetlinks.json
   → Play account/privacy-policy/data-safety paperwork. Also a **security sweep ran clean** this session (see §2) —
   one fix landed (`c80f167`, export no longer dumps the outbox).
1. **Owner gates (cannot self-serve):** paste CI for the `362657f` push (one green run audits everything through
   Module 3 → lock M1D/crops/M2A–M2E/M3A/M3B) · **money-path cross-vendor review (charter §4.6) still pending on
   THREE items before their locks: M2E farm pricing, M4A cash-entry/balance-sheet postings, and M5A wage/advance
   postings** · authorize push of the **local commits** (M4 + docs + mockup + M5 + M6 + M7 + M8) → CI → audit →
   lock M4/M5/M6/M7/M8.
   **B3 accounting-reports arc DONE:** M4C (`77d2a5d`) Management Reports tab (expense/revenue breakdown + equity
   roll-forward, read-only over GL) **and** M4D (`984560f`/`8d22a43`) Statement of Cash Flows — a guard-proven
   read-only `cash_flow_statement` fn (direct method, ties by construction) + a Cash Flows statement in the app.
   guard:accounting now 19. Only Cost Schedule + vendor/customer subledgers remain deferred (the latter need
   customer/supplier masters = money-path B1, owner-timed).
2. **Backlog progress (building in priority order, non-money slices first):**
   - **B1 customer credit — first slice DONE (M9A, `8928769`/`7680b05`):** customers master + read-only AR/credit
     standing + non-money invoice attribution; guard:customers 6. *Deferred (money path → review):* credit-limit
     ENFORCEMENT in the sale.
   - **B7 governed export — first slice DONE (`3b8fbb3`):** the Settings "Data & Backup" card downloads a JSON copy
     of this device's local records (read-only, client-only, no server/money/permission). Restore/import + governed
     cloud backup deferred (import overwrites data = the reviewed follow-up).
   - **Remaining — mostly money-path or owner-timed:** **B2** GCash/Maya/bank digital payments (MONEY path — needs
     Bank/e-wallet financial_accounts + modified pos_record_sale/pos_settle + the cross-vendor review); credit-limit
     enforcement (money path); customer statements-of-account / payment allocation; then the **VeggieGenius AI
     Copilot** (local LM Studio). **The safe non-money backlog is now largely exhausted** — building more money-path
     modules locally before the owner runs the pending review + push on the ~30 accumulated commits just compounds
     the unreviewed money surface. Supplier/AP master is NOT worth building yet (all purchases are cash → no AP; YAGNI).
   **Settings (M8) is DONE** — live theme switcher (light/dark/cream/green via `html[data-theme]` CSS-var
   overrides) + per-device station labels consumed by the shell; client-only, no migration/permission/RLS;
   browser-verified; committed `216c01b` (spec) / `d590a91` (app).
## 7. Owner's engineering loop (standing): Objective → Define → Challenge → Attack → Defend → Audit → Revise →
Decision → Version Lock. Roles: architect/engineer/backend/frontend/tester all in-session. Keep memory
(`stage-d-phase1-continuity.md`) AND this handoff current every session.
