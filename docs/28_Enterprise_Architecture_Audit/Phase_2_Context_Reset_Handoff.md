# Phase 2 — Context Reset Handoff (STANDING continuity artifact — keep updated every session)

**Type:** Continuity artifact (not a summary) · **Updated:** 2026-07-02 · **Branch:** `feature/phase-0-foundation`
**Owner standing instruction (2026-07-02):** *always update this handoff for the next AI session before usage runs out.*

> Read this FIRST in a fresh session. Verify git reality, then continue at §6 (Immediate next step).
> Supersedes `Stage_D_Phase_1_Context_Reset_Handoff.md` (historical) for day-to-day resumption.

## 1. What this project IS now (course-corrected)
An **operational farm ERP centered on the Weigh POS**, per the accepted ERP Traceability Audit. The **Google AI
Studio prototype in `src/` is BOTH the workflow authority for operational modules AND the visual authority**
(owner decision 2026-06-28; `docs/14_UI_References` set aside for now). Enterprise docs **Systems 10–26 are the
technical authority** (esp. 20 schema, 22 accounting, 03 inventory, 26 posting/permissions) — see
`ERP_Knowledge_Traceability_Audit.md` + `POS_Enterprise_Reconciliation_Audit.md` (why: prevent "a second ERP
inside the ERP"). Org-admin + Crop-catalog modules are **FROZEN** (supporting, not the product).
**Priority order:** POS → Inventory → Dashboard → Accounting → Payroll → Scheduling → Projects → Settings.

## 2. Git state (verify on session start)
- Branch `feature/phase-0-foundation`. Protected: `develop`=`d1c1f04`, `main`=`7833c9f` (NEVER touch).
- **Pushed (origin tip `0c327ae`):** M1–M6 (locked #11–#21) · P2-M1 org backend (locked #23, `a26b667`) ·
  M1B/M1C docs (`3e345d5`/`01e35e0`) · `5daee3d` M1D app · `a67ca58` crops · `439421e` M2-prep docs ·
  `147d37b` **M2A finished-goods spine** · `0c327ae` **M2B POS sale + minimal GL**.
  **⚠️ CI RESULTS FOR THIS PUSH NEVER AUDITED** — owner must paste the GitHub Actions run (this env cannot fetch
  Actions); audit per §5 before declaring M1D/crops/M2A/M2B *locked*. Never assert CI green unseen.
- **Local-only (ahead 3, push needs explicit owner go):** `7f3b7cd` weigh-POS UI · `8f8daf5` AI-Studio design
  adoption + sales journal + dashboard KPIs (E2E-verified in browser) · `9aa75f3` farm-theme sweep + M2C spec.
- **`1c5417d` M2C-a COMMITTED (local, verified):** migration `20260702090000_p2m2c_pos_preorder_
  cashsession.sql` + extended `guard:pos` (15/15 green after Docker restart; static float false-positive fixed via opening_cash rename).
  
  

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
  Launch: `.claude/launch.json` → `v3-app` (npm run dev, port 3000). Tests 14/14; tsc clean; build OK.

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
verify: npm ci · tsc · vitest (14 tests) · build, no skips/continue-on-error. secrets: full-history gitleaks.
db-guards: realistic non-cached `supabase start` (~2-3m) → db reset applying ALL migrations → guard steps
static/db/rls/bootstrap/org/crop/**inventory**/**pos**/drift each visibly executed → stop. No `|| true`.

## 6. Immediate next step (in order)
1. **M2C-b UI** (app-only, local commits): checkout classification (Direct Cash | Pre-order w/ 10% discount toggle +
   delivery fee + note), journal **Mark Paid** + **Void (reason)** actions, cash-session strip; mock paths; tsc/tests/build.
2. Owner gates: paste CI for `0c327ae` (audit → lock) · authorize push of the 4 local commits (7f3b7cd/8f8daf5/9aa75f3/1c5417d).


3. Then: **M2D** dashboard/report reads → **Inventory module** (03/20.07-20.12) → Accounting (22) → Payroll (21)
   → Scheduling → Settings Hub (theme system: dark/cream/green tokens exist in src/index.css; only light ported).




## 7. Owner's engineering loop (standing): Objective → Define → Challenge → Attack → Defend → Audit → Revise →
Decision → Version Lock. Roles: architect/engineer/backend/frontend/tester all in-session. Keep memory
(`stage-d-phase1-continuity.md`) AND this handoff current every session.
