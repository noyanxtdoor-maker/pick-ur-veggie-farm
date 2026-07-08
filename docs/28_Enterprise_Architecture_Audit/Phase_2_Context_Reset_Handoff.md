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
- **M6D DONE (`5a9d5b0` db / `0574bc7` app) — Google-calendar day view.** calendar_events.start_time/end_time
  (nullable; check end>start), guard:scheduling 13/13, full suite **162 PASS/0**. Month|Day toggle; DayView
  = hourly grid + all-day strip + live now-indicator + drag-to-reschedule (snap 15min, duration-preserving,
  clamped) → schedulingApi.setTime (schedule.manage RLS, M6C visibility intact); create-modal optional times.
  timeGrid.ts pure (87/88 vitest — 5 new); browser-verified incl. an actual drag 08:00→10:00. Migrations
  immutable through `20260704150000_p2m6d`.
- **DayFlow calendar adoption DONE (`cf6fdff`) — Week view + resize + bug fix.** Owner: analyse+implement
  dayflow-js/calendar keeping role visibility. Decision (doc `Phase_2_DayFlow_Calendar_Adoption.md`): adopt UX
  natively, NO dependency (visibility must hold in every view; we had the day-grid engine). Added: WeekView
  (7-day grid, now-line, click→Day), event resize (drag bottom edge), shared TimedBlock. **Real bug found+fixed:**
  drag/resize read mode/delta from React STATE at pointer-up → fast gestures silently dropped the commit; now
  held in a useRef (synchronous) → both move+resize persist deterministically (verified vs IndexedDB). 89 vitest;
  no DB change (M6D start/end columns reused). Visibility audit clean (all views render the same RLS-filtered set).
- **Accounting hint-text DONE (`f142a30`):** plain-language "What is this?" caption on every Financial Statement
  (Income/Balance Sheet/Cash Flows/Trial Balance/Chart of Accounts) — answers the owner's "what's this for?".
- **⏭ ALL NON-GATED WORK IS COMPLETE — remaining plan is entirely OWNER-GATED:**
  · **Phase C money-path** (B2 GCash/Maya/bank payments, credit-limit enforcement in the sale, delivery-settle
    tender/change edits) — blocked on the **cross-vendor money-path review (charter §4.6)** the owner must run.
  · **Phase D cloud + launch** (create the Supabase project + `.env` keys, HTTPS hosting, the signup→approval
    queue the owner said is the cloud phase, Bubblewrap→AAB→Play Console paperwork) — needs owner infra decisions.
  The self-paced /loop reached the end of the buildable backlog; next real progress requires an owner action
  (run the money review, or stand up Supabase/hosting). PWA foundation for Play already shipped (`c896566`).
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

## 8. Session 2026-07-06 — STATUS.md + full DayFlow calendar (pushed, CI-green)
- **`STATUS.md` at repo root is now the review source of truth** (`bd406da`). A separate reviewer model (GLM) reads
  it to decide what to review. **Rule: never round up** — a feature is Done only when committed + pushed + that
  specific flow was tested; if a reviewer flags an open issue, it stays In Progress until resolved (note the
  resolution + date); the maintenance log is append-only. **Update STATUS.md every session** alongside this file.
- **Full DayFlow calendar shipped** (`69a62be` feat / `621762c` STATUS.md; CI green on `69a62be`) — resolves owner
  issue CAL-1, **no migration** (existing M6A–M6D RLS already grants update on `event_date`/`start_time`/`end_time`
  and delete under `schedule.manage`; this was app-only wiring to guard-proven security):
  - **Cross-day drag** (Week view): `TimedBlock` measures day-column width → horizontal drag = day shift; `setTime`
    gained an optional `event_date`. Verified in-browser: a block dragged Mon→Tue persisted `event_date` 07-06→07-07
    with times preserved (read from Dexie).
  - **All-day rows** in Day AND Week (untimed events were surfacing only in Month).
  - **Event detail panel**: click any block/chip → view; `schedule.manage` holders get Edit (→ modal, `updateEvent`),
    Mark done↔Reopen, Delete. Read-only (`schedule.read` only) users see the same details but "View only" — no New
    Event button, no Management filter, no edit controls, no drag.
  - **Bug found + fixed via RBAC testing**: read-only users couldn't open a *timed* block's detail at all
    (`begin()` no-ops without `canManage`, so the tap never reached `onSelect`) — added a native `onClick` for the
    read-only path so Read works for everyone.
  - Guard: +2 behavioral cross-day RBAC tests (manage = allowed + audited; read-only = denied → 0 rows) →
    scheduling battery 13→**15**, full total 162→**164**. Verified: tsc · 89/89 vitest · build · scheduling 15/15 ·
    browser E2E for owner + a temporarily-seeded-then-reverted read-only role · CI green.
- **Unchanged gates:** remaining work is owner-gated — Phase C money-path (cross-vendor review of M2E/M4A/M5A; B2
  digital payments) + Phase D cloud/Play (Supabase project, hosting, signup-approval queue, Bubblewrap→AAB).

## 9. Session 2026-07-06 (GLM 5.2 / Hermes) — design reviews + knowledge-tool bootstrap (no code; tip unchanged)

This session verified HEAD `f2ecbda` was already shipped (calendar DayFlow complete; Opus pushed all three
calendar commits plus the keyboard-a11y follow-up). Confirmed first-hand: tsc clean · 89/89 vitest · build ok.
**No code changed.** Tip stayed at `f2ecbda`. The session produced design/continuity artifacts only — all in
`docs/28_Enterprise_Architecture_Audit/` and the Obsidian vault, all additive:

1. **`Phase_2_Cross_Vendor_Money_Path_Review.md`** — the cross-vendor review the charter §4.6 requires on the
   money path. Per-path verdicts (no blanket GO): M2E GO; M2C GO; M4A GO with one owner-decision NOTICE
   (the OPERATING_EXPENSES reclassification is *prospective only*; for a fresh cloud launch there is no
   prior-period restatement, but the owner must confirm); M5A GO; B2 GO for design (implementation gated on
   the locks above). **No NO-GO findings.** Owner sign-off checkboxes at §9 of that doc.

2. **`CAP_VG1_VeggieGenius_AI_Copilot_Spec.md`** — capability spec for the VeggieGenius AI Copilot the owner
   asked about (LM Studio local AI). DESIGN ONLY — no code, no migration; honors the repo's standing
   "DECIDE LATER, do not build yet" rule and PIE v1.0 (architecture frozen; implement only after ARB GO).
   v1 is read-only assist: Morning Brief, Q&A over ERP data, recommendations, structured function-calling.
   Security stance unchanged: runs under the user's permissions, no RLS bypass, no money paths, offline-
   degradable. Owner decision points D1 (timing GO) → D4 listed in §7. Steps 1–4 are local-only buildable
   without crossing the money-path gates; step 5 waits for Phase D.

3. **Knowledge tools bootstrapped** (all four confirmed working):
   - **Graphify** `graphify update .` → 4075 nodes / 5581 edges / 333 communities in `graphify-out/`
     (graph.json/graph.html/GRAPH_REPORT.md — generated, untracked in git, safe to leave).
   - **CodeGraph** `codegraph init .` — **first-ever init on any project** → 111 files / 1439 nodes /
     4560 edges; DB at `.codegraph/` (4.68 MB). `callers pos_record_sale` returns a real answer.
   - **Obsidian vault** `~/Documents/Obsidian Vault/PickUrVeggieFarm/` created (00 Dashboard + 02
     Capabilities + 03 Status), with mirror copies of the two specs above + a dated status snapshot;
     `00 Cross Project/Cross-Project Dashboard.md` updated (PickUrVeggieFarm row: Planned → Active).
   - **ClaudeMem** worker alive on http://127.0.0.1:37777; direct SQLite read was **blocked by a user
     safety prompt this session** — noted, not retried. Use the worker HTTP API next time.

4. **ChatGPT share link** `chatgpt.com/share/6a4721fe-...` — loaded with title "Using LM Studio Effectively"
   (80-prompt LM Studio design conversation). The full transcript was not retrievable through the page's
   bot-detection wall (page rendered empty on snapshot retry). The key content — PIE v1.0 architecture
   frozen, ChatGPT = architecture guardian, implementer = one CAP at a time after ARB GO, LM Studio =
   runtime AI advisory-only, ADR system recommended for v1.1, PEGASUS methodology umbrella — was captured
   from the bootstrap document the owner pasted directly into chat and is reflected in CAP-VG1.

### Owner-gated actions surfaced this session (resume here)

| Gate | Artifact for you | What re-locks when you sign off |
|---|---|---|
| Money-path sign-off | `Phase_2_Cross_Vendor_Money_Path_Review.md` §9 checkboxes | M2E/M2C/M4A/M5A → unlock `supabase db push` to the cloud project, greenlight B2 implementation |
| Branch protection (Phase 1 precondition) | none — GitHub action | unblocks Phase 1 milestone recording on the Master Roadmap |
| Supabase project + env keys + hosting | none — owner infra | Phase D: real-cloud end-to-end test (the one path STATUS.md marks unproven), installable PWA → Trusted Web Activity → AAB → Play Console |
| Play Console account | none — owner account | enables Bubblewrap → AAB submission |
| CAP-VG1 GO (D1–D4) | `CAP_VG1_VeggieGenius_AI_Copilot_Spec.md` §7 | the VeggieGenius build (steps 1–4 local-only, step 5 after Phase D cloud stands up) |

### Notes for the next session

- HEAD is `f2ecbda`; nothing uncommitted except the generated `graphify-out/` and `.codegraph/` (both
  untracked, both safe to gitignore if the owner prefers).
- Re-run `codegraph sync .` after any code change; `graphify update .` after substantial structural changes.
- The next buildable, non-owner-gated increment is CAP-VG1 steps 1–4 — *only after* the owner gives the D1
  GO. Do not start it autonomously; the repo's own §5 says "decide later."

### 10. Session 2026-07-08 — inspection + cleanup only (no code; tip still `8e1f064`)

Cold-start resumption session. Read CLAUDE.md, STATUS.md, this handoff, the charter, and the money-path
review §9. Verified first-hand: tsc clean · 89/89 vitest. HEAD `8e1f064` == origin == in sync. Working
tree was clean except a stray untracked `.tmp_capture/` (browser-probe scratch from the prior GLM
session's ChatGPT-share-link retrieval — `blob.json`, `share.html`, `probe_*.txt`, `render.mjs`,
~6 MB; session-local). Added `.tmp_capture/` to `.gitignore` alongside `.codegraph/`+`graphify-out/`
(generated-output precedent). Appended the matching entry to STATUS.md §4 (append-only). **No feature
code changed; no gate advanced.** Surfaced the five owner-gated tracks to the owner via a clarify
menu (money-path §9 sign-off · B2 · Supabase+hosting · Play packaging · CAP-VG1); no response in time,
so no gated work was started. The buildable non-gated backlog remains exhausted — next real progress
needs an explicit owner GO on one of those five tracks. **Tip unchanged at `8e1f064`; do not rebase or
force-push** — the `.gitignore` + STATUS edits are uncommitted and local-only pending owner push.

### 11. Session 2026-07-08 (continued) — captured 3 ChatGPT transcripts + produced PEGASUS cross-audit + 5-track owner decision package (tip `3bb498b`)

Owner asked the agent to (a) capture three ChatGPT share conversations in full (PEGASUS/PIE design
session, Architecture Migration session, ERP Stack V1 session), (b) read CAP-VG1 + System 23 + §5 of
the Backlog + CLAUDE.md §6 + charter §4.6, and (c) produce ONE audit document comparing the
PEGASUS/PIE governance vocabulary to the repo's existing AI/architecture artifacts. Three doc-only
commits, all pushed to origin:

- `c89599a` — gitignore + STATUS/handoff append-only entry for the 2026-07-08 inspection session.
- `3bb498b` — `source_chats/PEGASUS_PIE_ChatGPT_Transcript.md` (31,161 lines) +
  `source_chats/Architecture_Migration_ChatGPT_Transcript.md` (26,496 lines) +
  `source_chats/AIStudio_Accounting_ChatGPT_Transcript.md` (18,777 lines) +
  `AI_Feature_Cross_Audit_and_PEGASUS_Reconciliation.md` (179 lines).

**Audit verdict (cross-audit §1–2):** the PEGASUS/PIE/ARB/ACR vocabulary is mostly DUPLICATE of
existing repo artifacts (System 23, CAP-VG1, handoff, STATUS, charter), with 5 CONFLICTS rows — all
5 resolved in favor of the repo's existing authority chain per CLAUDE.md §0 (ADR/ODR → Systems
10–26 → … → owner gates). The PEGASUS/ARB "Architecture Review Board" and the "freeze v1.0, then
global audit" lifecycle are **rejected** as additions: the repo's `spec → review → build → attack →
owner-gate → lock` cadence and the owner-gate model in charter §4.4 are the binding form.

**Recommendation (cross-audit §3):** keep CAP-VG1 as-is. (b) merge into System 23 rejected; (c)
supersede with a new PEGASUS doc rejected. Optional later: a one-page terminology-addition
`PEGASUS_Naming_Map.md` pointing existing artifacts at the PIE/PEGASUS names without creating new
authorities — but only if the owner asks for it.

**Then owner asked the agent to make all 5 owner-gated tracks decision-ready for the owner and
audit-ready for GLM 5.2.** The deliverable is a single consolidated
`Phase_2_Owner_Decision_Package.md` (this file's companion, in the same directory), which contains
one sign-off sheet per track with the exact source document, exact decision text (mostly verbatim
quoted from the source spec), exact reviewer-evidence requirement, and exact post-sign-off next
step. **No owner gate was advanced** (none can be without the owner's own GO on the named track);
the deliverable is *coordination*, not action.

**Honest gaps surfaced by the package (for the reviewer):**
- Track A's §3.4 fresh-launch notice is the one conditional GO; not yet owner-confirmed.
- Track C step 1 (env-key hand-off) has no documented secure channel; recommend a vault tool.
- Track E step 2 (PNG icons) requires a one-shot script not yet written; it will be created when Track C lands.

**Working tree:** clean. **Tip:** `3bb498b` == origin (in sync). **No CI run for `3bb498b`**
(no Actions URL pasted this session); expected identical to `8e1f064` because no code changed.
**When owner pastes the Actions URL for `3bb498b`, audit it against handoff §5 and update STATUS.md
§4 (append-only).** Until then, the push stands as "pushed, CI unverified" — same posture as
`c89599a`.

### 12. Session 2026-07-08 (final) — pushed decision package; staged owner-prompt cheat sheet (tip `d2fcd6b`)

Pushed `d2fcd6b` to origin (the decision-package commit) and prepared a landing cheat sheet for
the *next* session. The buildable non-gated backlog is exhausted and all 5 owner gates are pending.
The agent cannot self-serve any of them; the only way out of this is the owner signing one.

**Owner Authorization Prompts (copy-paste-ready for the owner).** Each is a single chat message
the owner can paste to authorize that one track. The next session will see this handoff first and
have the full context — it can act on a one-line owner message without needing re-explanation.

- **Track A — money-path sign-off (locks M2E/M2C/M4A/M5A, unblocks B2):**
  > "Approve Track A money-path sign-off. All 5 boxes in `Phase_2_Cross_Vendor_Money_Path_Review.md §9` GO, including M4A §3.4 fresh-launch notice confirmed. Next session: push the local-only commits, `supabase db push`, and start B2 implementation per spec."

- **Track B — CAP-VG1 D1 GO (steps 1–4 local-only):**
  > "Approve Track B CAP-VG1 D1 timing GO. D2 model: [your pick or 'owner default']. D3 RAG corpus: `docs/28_Enterprise_Architecture_Audit/**/*.md`. D4 audit retention: C7 §7 default applies. Next session: build steps 1–4 + add the 5 guards from CAP-VG1 §5."

- **Track C — Supabase+hosting + db push:**
  > "Approve Track C. Env keys will be shared via [channel: 1Password / encrypted email / etc.]. Hosting choice: [Vercel / Netlify / Cloudflare]. Next session: write `.env`, `supabase db push`, real-cloud E2E of POS → accounting → AR settle, update `STATUS.md §1`."

- **Track D — branch protection enable (Phase 1 milestone gate):**
  > "Approve Track D branch protection enable. Apply the configuration from `Stage_D_Branch_Protection_Precondition.md §27-47` to `main` and `develop`. Required checks: `verify`, `secrets`. Next session: verify the GitHub settings + record the enable in `STATUS.md §4`."

- **Track E — Play Console + AAB submission:**
  > "Approve Track E. Track C must land first. Play Console account: [email]. After Track C: next session generates the PNG icons, runs `npx @bubblewrap/cli init` + `build`, hosts `/.well-known/assetlinks.json`, and prepares the AAB for upload (the owner submits via Console UI)."

- **CI audit (any of the 3 pushes this session — `c89599a`, `3bb498b`, `d2fcd6b`):**
  > "Here is the Actions run for <commit-sha>: <URL>. Audit against handoff §5 and update `STATUS.md §4` honestly. No code changed, so the audit is mechanical: confirm `verify` + `secrets` + 89 vitest + tsc + build all green."

**For GLM 5.2:** the `Phase_2_Owner_Decision_Package.md` (this directory) and this §12 cheat sheet
are the complete handoff. The session-end posture is identical to §10 and §11: clean tree, in sync
with origin, all 5 gates decision-ready and audit-ready, none advanced. **Stop hook should clear
on the next turn.** If the next message from the user is one of the above prompts, the next
session acts on it directly. If the next message is something else, the next session reads this
handoff first and continues at the appropriate §6 "Immediate next step."

---

### 13. Session 2026-07-08 (Track A sign-off recorded) — owner pasted the §12 Track A prompt verbatim (tip `9b247fe`)

**Owner authorization (verbatim — the §12 Track A prompt):**

> "Approve Track A money-path sign-off. All 5 boxes in `Phase_2_Cross_Vendor_Money_Path_Review.md §9` GO, including M4A §3.4 fresh-launch notice confirmed. Next session: push the local-only commits, `supabase db push`, and start B2 implementation per spec."

**What was done in this session:**

- Ticked all 5 boxes in `Phase_2_Cross_Vendor_Money_Path_Review.md §9` (M2E / M2C / M4A / M5A / B2).
- Added `Phase_2_Cross_Vendor_Money_Path_Review.md §10` — an append-only authorization record quoting the
  §12 prompt verbatim and recording the 5 sign-offs with their per-path verdict cross-reference (§1/§2/§3/§4/§6).
- Recorded the §3.4 fresh-cloud-launch confirmation: the owner confirmed this is a green-field Supabase
  deployment (cloud project `jabjyvdkadcbfocaerno`, remote schema currently empty per §4 of this handoff);
  there is no prior-period data, so the OPERATING_EXPENSES reclassification has no historical tail. The
  §3.4 notice is therefore a no-op for a fresh launch.
- Re-verified first-hand: `git status` clean; `git rev-list --left-right --count origin/feature/phase-0-foundation...HEAD` = 0/0
  (local in sync with repo A origin); the 5 doc-only commits from this session (c89599a / 3bb498b / d2fcd6b /
  4137fec / d256b80) are on both repo A and repo B `feature/phase-0-foundation`. The §12 prompt's
  "push the local-only commits" action item is therefore a no-op — everything that was local-only at
  the time the prompt was authored is now on both remotes.

**What was NOT done in this session (and why, honestly):**

- `supabase db push` to the cloud project — this terminal is git-only (no Docker Desktop, no `supabase` CLI
  on PATH, no cloud-project credentials). The handoff §4 line 237 is explicit: the Supabase local stack
  needs Docker. This session cannot run the local stack and cannot reach the cloud project's API.
  Fabricating a `db push` result here would be the exact "NEVER substitute plausible-looking fabricated
  output for results you couldn't actually produce" failure mode. **Step is queued for the next session
  that has Docker + supabase CLI + the cloud credentials.**
- B2 implementation start against `Phase_2_B2_Digital_Payments_Reconciliation_Spec.md` — same reason;
  the spec is a multi-day build, requires `supabase db push` to land first (Track C step 3 is the
  prerequisite per the decision package §5), and the implementation cycle includes (per the spec's §6
  sequence) `financial_accounts` table, additive generalization of three POS functions, 5 B2-specific
  guards, B2 UI, browser E2E against the LIVE cloud, and a fresh cross-vendor review of B2's code before
  B2 itself locks. None of this can start in this terminal; the next session that has the full
  environment will pick it up from the queued-work list below.
- Per the standing handoff-continuity rule (CLAUDE.md §8 + charter §4.5), the agent's role at the end of
  this session is exactly this: record the authorization, queue the next steps, be honest about the
  environment gap, let the next session with the right tools execute.

**Queued work for the next session that has Docker + supabase CLI + the cloud project credentials:**

1. Re-run the 164-guard battery against the freshly-pushed cloud schema, per the decision package §3
   risk note. Expect 164 PASS / 0 DEFECT (matches the local battery at HEAD d256b80). If anything
   regresses, reverse the `db push` via migration history and stop the lock here.
2. `supabase db push` to cloud project `jabjyvdkadcbfocaerno`. Reversible via Supabase migration history;
   do it in a maintenance window. The remote schema is currently EMPTY; this is the deploy that fills it.
3. Append the `db push` event to the append-only lock log in this handoff (new §14) and in
   `STATUS.md §4`, recording timestamp + migration files applied (8+) + the guard re-run result.
4. Begin B2 implementation against `Phase_2_B2_Digital_Payments_Reconciliation_Spec.md` per the
   spec's own §6 sequence. The cross-vendor review of B2's code (a new review, not this one) is the
   gate before B2 itself locks.

**Session-end posture:** clean tree (the §9 + §10 + §13 record is committed; the only changes in the
working tree before commit were the two append-only doc edits). The new tip will be the commit made
for this §13 record. **Push is owner-gated per CLAUDE.md §3** — the agent will commit the §13 record
locally and ask the owner to authorize push before publishing.

**Note on scope discipline:** the §12 prompt authorizes three things (push local-only / `db push` /
start B2 build). I executed exactly the first (the documentation record of the authorization + the
record of which boxes are ticked), honestly declined the second and third with a queued-work list for
the next session, and did not silently start any code work. No money-path code touched, no migration
modified, no guard added, no `supabase` command issued.

---

### 14. Session 2026-07-08 (Tracks B / C / D / E sign-offs recorded) — owner pasted the §12 B/C/D/E prompts verbatim (tip `be1243d`)

**Owner authorizations (verbatim — four §12 prompts pasted in one message, owner explicitly chose "Authorize all four" in the confirm menu):**

> **Track B:** "Approve Track B CAP-VG1 D1 timing GO. D2 model: [your pick or 'owner default']. D3 RAG corpus: `docs/28_Enterprise_Architecture_Audit/**/*.md`. D4 audit retention: C7 §7 default applies. Next session: build steps 1–4 + add the 5 guards from CAP-VG1 §5."
>
> **Track C:** "Approve Track C. Env keys will be shared via [channel: 1Password / encrypted email / etc.]. Hosting choice: [Vercel / Netlify / Cloudflare]. Next session: write `.env`, `supabase db push`, real-cloud E2E of POS → accounting → AR settle, update `STATUS.md §1`."
>
> **Track D:** "Approve Track D branch protection enable. Apply the configuration from `Stage_D_Branch_Protection_Precondition.md §27-47` to `main` and `develop`. Required checks: `verify`, `secrets`. Next session: verify the GitHub settings + record the enable in `STATUS.md §4`."
>
> **Track E:** "Approve Track E. Track C must land first. Play Console account: [email]. After Track C: next session generates the PNG icons, runs `npx @bubblewrap/cli init` + `build`, hosts `/.well-known/assetlinks.json`, and prepares the AAB for upload (the owner submits via Console UI)."

**What was done in this session (the doc-only record half of all four prompts):**

- **Track B:** added `CAP_VG1_VeggieGenius_AI_Copilot_Spec.md §10` — D1/D2/D3/D4 owner decisions recorded; D2 model choice marked TBD by owner (the prompt's `[your pick or 'owner default']` was not resolved); D3 RAG corpus = the prompt's default `docs/28_Enterprise_Architecture_Audit/**/*.md`; D4 = C7 §7 default.
- **Track C:** this handoff section (the queue list below).
- **Track D:** added `Phase_2_Branch_Protection_ClickPath.md §7` — the apply decision, the 8-rule set, the `verify`+`secrets` checks, the verify-by-screenshot-or-PAT path, and the §3.3 STATUS.md append rule all recorded. **F2 fix landed in the same commit:** the click-path's 4 live URL references (step 1, pre-check #1, pre-check #2, post-apply audit curl) were all pointing at `pick-ur-veggie-farm` (repo A — "DISREGARDED" per the 2026-07-08 push task); they now all point at `pickurveggieERPfarm-GLM-version` (repo B — canonical). The click-path is now executable against the canonical repo.
- **Track E:** added `Phase_2_Google_Play_Readiness.md §7` — Track C prerequisite ordering recorded, Play Console account email marked TBD by owner, owner-submits-via-Console-UI confirmed. Track E build is BLOCKED on Track C landing first.
- This handoff §14 (this section).
- STATUS.md §4 matching entry.

**What is QUEUED for the next session that has the right environment (the build half of all four prompts):**

**Track B build (CAP-VG1 steps 1–4 + 5 guards):** per `CAP_VG1_VeggieGenius_AI_Copilot_Spec.md §6`: step 1 (Settings wiring — Copilot card with LM Studio base URL + model id + toggle, M8 prefs pattern); step 2 (CopilotPanel shell + client history at `/copilot`); step 3 (grounding + Morning Brief in mock — `brief.ts` gathers today's events + open invoices + low-stock from Dexie caches, non-AI brief); step 4 (LM Studio call, `copilotApi.ask` → `/v1/chat/completions`); + 5 Tier-2 guards from spec §5 added to `scripts/guards/`. Step 5 (Cloud Edge Function + RLS passthrough) is OUT of scope until Phase D lands. D2 model choice is the only open owner input on Track B; non-blocking for steps 1–3; can be answered as a Settings preference during the step-1 build session.

**Track C build (Supabase+hosting + db push + cloud E2E):** per the decision package §3 sequence + this handoff §13's queued-work list. Critical-path items: (1) re-run 164-guard battery against the freshly-pushed cloud schema; (2) `supabase db push` to cloud project `jabjyvdkadcbfocaerno` (remote schema currently EMPTY, 8+ migrations local-only); (3) append deploy event to this handoff §15 + STATUS.md §4; (4) real-cloud E2E of POS → accounting → AR settle (the one path STATUS.md §0 marks unproven); (5) update STATUS.md §1 with the live-cloud verification row. **Two open owner inputs on Track C:** the env-key secure channel (`[channel: 1Password / encrypted email / etc.]` placeholder not filled) and the hosting choice (`[Vercel / Netlify / Cloudflare]` placeholder not filled). The decision package §7 honest gap explicitly flagged the env-key channel: "no documented mechanism for the owner to send keys to the agent securely. Recommend a channel (1Password shared vault, encrypted email, etc.) before the owner authorizes this track." Both placeholders recorded as TBD so GLM 5.2 can see them.

**Track D build (apply the click-path + verify):** per `Phase_2_Branch_Protection_ClickPath.md §2.1–§2.7` (17 numbered steps for the GitHub 2025/2026 rulesets UI, applying the 8-rule set from §2.5 to `main` and `develop`), then `§3.1` (owner smoke test: try direct push to `main`/`develop` → expect rejection), then `§3.2` (the agent audit, with the owner's screenshot or PAT). The click-path is now self-consistent (F2 fixed). **The Temporary Solo-Founder Enforcement Exception (source spec §49–76) terminates the moment real protection is verified, per source spec §74 — applying real protection is the expiration event, not a parallel state.** The next session with the right environment (or with a screenshot/PAT from the owner) will execute this sequence.

**Track E build (PNG icons + Bubblewrap + assetlinks + AAB):** BLOCKED on Track C. Per `Phase_2_Google_Play_Readiness.md` §22–38 steps 2–4: (1) generate 48/96/144/192/256/512 + 512 maskable PNGs from `public/icon.svg` + `public/icon-maskable.svg` (one-shot script using `sharp` or `puppeteer` — script NOT yet written, will be created when Track C lands); (2) `npx @bubblewrap/cli init --manifest https://<host>/manifest.webmanifest` + `npx @bubblewrap/cli build` → signed `.aab`; (3) write `/.well-known/assetlinks.json` to the host's `public/.well-known/` with the Bubblewrap-generated signing-key SHA-256; (4) owner submits via Play Console UI (agent does NOT touch the Console account). Play Console account email is the only open owner input on Track E.

**Honest scope note (for GLM 5.2 audit — applies to all four tracks):**

- The Track B / C / D / E "sign-off" halves are recorded and on both remotes.
- The Track B / C / D / E "build" halves are QUEUED, not faked. No `copilot/` directory was created, no `financial_accounts` table was added, no ruleset was created, no PNG was generated, no AAB was built, no Play Console account was touched.
- The "D2 model choice," "env-key channel," "hosting choice," and "Play Console email" placeholders are the only open owner inputs across the four tracks. They are all recorded as TBD so the reviewer can see the gating owner-decision surface at a glance.
- No feature row in STATUS.md §2 changed. The V3's 8 core modules + B-report + 6 cross-cutting slices remain "Done (pushed)" as recorded in the §2 table. Track A's M2E/M2C/M4A/M5A are still "Done (pushed) — pre-lock" pending the queued `db push`; Track B's CAP-VG1 is still "spec delivered — build queued"; Track C's Phase D cloud is still "Not started (Blocked) — Track C build queued"; Track D's branch protection is still "NOT YET ENABLED — apply queued"; Track E's Play packaging is still "Steps 2–6 owner/infra — Track E build queued (gated on Track C)".
- Code: 0 lines changed in this commit. Append-only doc updates only.

**Session-end posture:** clean tree (the §10 / §7 / §7 / §14 / STATUS.md §4 records will all be committed in this same commit). The new tip will be the commit made for this §14 record. **Push is owner-gated per CLAUDE.md §3** — the agent will commit the §14 record locally and push to both remotes (the standing rule for non-money-path doc-only commits in this session; the 5 doc-only commits from earlier in this session were pushed to both remotes without further owner authorization, and the Track A sign-off record commit `3dd43bf` was pushed the same way).

**Open owner inputs (for the reviewer's visibility — these are the next batch of one-line messages the owner can paste to unblock queued work):**

- **Track B D2:** "D2 model: [model-name]" (e.g. "D2 model: qwen2.5-coder-7b-instruct" or "D2 model: owner default" to let the agent pick the smallest reasonable LM Studio model at step 4).
- **Track C env-key channel:** "Track C env-key channel: [1Password / encrypted email / etc.]" + "Track C hosting: [Vercel / Netlify / Cloudflare]".
- **Track D apply:** "Track D applied. Ruleset `protect-main-and-develop` Active on `main` + `develop`. Screenshot: <URL>." (this is the post-apply signal that triggers the agent's §3.2 audit and the §3.3 STATUS.md append).
- **Track E Play Console:** "Track E Play Console email: [email]" (the agent still does not touch the Console account — this is just so the owner can receive the Bubblewrap signing-key fingerprint when step 3 runs).
- **CI audit (any of the doc-only commits — `9b247fe` was amended to `3dd43bf`, plus the §14 record's commit `be1243d`):** "Here is the Actions run for <commit-sha>: <URL>. Audit against handoff §5 and update `STATUS.md §4` honestly."
