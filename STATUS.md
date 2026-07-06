# STATUS.md — PickUrVeggie ERP V3 (source of truth for review)

**Owner of this file:** the coding agent (Claude). **Consumer:** a separate reviewer model (GLM) that decides what
to review based on what this file marks "Done." **Rule: never round up.** If a flow was not tested end-to-end by
the agent, or a reviewer has an open issue against it, it is **In Progress** — not Done.

_Last updated: 2026-07-06 · HEAD `8893583` · branch `feature/phase-0-foundation`._

---

## 0. READ THIS FIRST — branch & deploy reality (affects every row)

- **Everything below is pushed to `origin/feature/phase-0-foundation` (local HEAD == remote, in sync).**
- **NONE of it is on `origin/main`.** The feature branch is **177 commits ahead of `origin/main`, unmerged.**
  `origin/main` contains only the initial docs/scaffold (`7833c9f`). **A reviewer checking `origin/main` will see
  almost nothing — review the feature branch.**
- **The app currently runs in MOCK / OFFLINE mode** (no Supabase project configured; `VITE_SUPABASE_*` unset).
  - "Browser-verified" below therefore means **manually exercised in the running app against the local mock/Dexie
    data path** — NOT against a live cloud database.
  - The **real-cloud path** (online Supabase PostgREST + RPC) for every feature is proven **only by the SQL guard
    batteries** (behavioral tests run against a real local Postgres with simulated JWTs) — it has **never been
    tested end-to-end by the app against a live Supabase.** That end-to-end cloud test is a launch-phase task.

## 1. Global verification snapshot (re-run 2026-07-06, all first-hand)

| Check | Result |
|---|---|
| `supabase db reset` (22 migrations apply) | ✅ clean |
| All 12 guard batteries (behavioral SQL security tests) | ✅ **162 PASS / 0 DEFECT** |
| `tsc --noEmit` (type check) | ✅ clean |
| `vitest` unit tests | ✅ **89 / 89** |
| `vite build` | ✅ ok |
| Latest CI run on the feature branch (`f142a30`) | ✅ green (install · tsc · test · build · DB guards · secret scan) |
| CI runs a browser? | ❌ no — E2E is manual, mock-mode only |

Guard battery counts: rls-behavior 23 · inventory 24 · payroll 19 · accounting 19 · pos 18 · org 13 · scheduling 13 ·
crop 11 · bootstrap 8 · projects 7 · customers 6 · db-guards 1.

---

## 2. Features

Legend — **Verification** column: `guard N` = passing behavioral SQL security battery · `unit` = vitest ·
`browser-mock` = agent manually clicked the flow in the running app (mock data) · `tsc/build only` = compiles but
the flow was not exercised.

| Feature | Status | Last touched | Verified (fact) vs assumed |
|---|---|---|---|
| **Phase-1 foundation** — identity, multi-tenant, roles/permissions, resolver + tenant RLS (`has_permission`, `is_branch_member`, `current_app_user_id`), append-only audit, controlled bootstrap | Done (pushed) | 2026-06-22 | **guard**: rls-behavior 23, org 13, bootstrap 8; CI-green. **Assumed/untested:** the mock app does NOT exercise real auth/RLS (it uses a mock session) — real-cloud login/RLS unproven end-to-end. |
| **Organization setup** (company/branch/role/membership writes, invitations, invite/accept) | Done (pushed) | 2026-06-22 | **guard** org 13; **browser-mock** (org screens render/CRUD in mock). Real invite email flow untested (needs cloud). |
| **Crop management** (categories/varieties/profiles/templates) — FROZEN master data | Done (pushed) | 2026-06-23 | **guard** crop 11; browser-mock. |
| **POS — Weigh sale engine** (M2A finished-goods spine w/ append-only movement ledger; M2B `pos_record_sale` atomic + **balanced double-entry GL**; M2C pre-order→AR / settle / void reversing-journal / cash-session; M2E farm pricing + bulk lines) + Active Slip Counter UI | Done (pushed) | 2026-07-04 | **guard** pos 18 + inventory 24; **browser-mock** full sale → receipt → journal, multiple sessions. Real-cloud sale RPC unproven end-to-end. |
| **POS — cash-drawer strip removed** (owner: manual drawer at launch; `cash_sessions` DB kept, dormant) | Done (pushed) | 2026-07-04 | **browser-mock** (sale posts with no drawer). |
| **Inventory** (M3A materials/receivings w/ source Lazada/Shopee/TikTok + pcs, FIFO batches, governed purchase/adjust, **Log Stock Usage**, equipment catalog + monthly condition checklist, low-stock alerts) | Done (pushed) | 2026-07-05 | **guard** inventory 24; **browser-mock** buy/log-usage. |
| **Inventory — Purchase Summary report** (spend by category + source, period filter) | Done (pushed) | 2026-07-05 | **unit** purchase-summary.test; **browser-mock** (logged a purchase → grouped correctly). Fixed a real tab-isolation bug during this. |
| **Accounting** (M4A GL-truth reads: trial balance / income statement / balance sheet; cash_entries; M4C reports: expense/revenue breakdown + equity roll-forward w/ ties-check; M4D Statement of Cash Flows; plain-language "What is this?" captions) | Done (pushed) | 2026-07-06 | **guard** accounting 19; **unit** accounting-reports (incl. cash-flow ties); **browser-mock** statements + reports + captions. |
| **Payroll** (M5A employees/advances/wages + **balanced GL**, derived advance balance, server-recomputed wage authority; M5C self-visibility: staff see only their own pay, `payroll_link_employee_user`, My Payroll view) | Done (pushed) | 2026-07-04 | **guard** payroll 19 (incl. 5 M5C self-visibility attacks); **browser-mock** roster + link modal. |
| **Projects** (M7 board + task checklists, %-complete, `project.read/manage` RLS; projects↔calendar timeline overlay) | Done (pushed) | 2026-07-04 | **guard** projects 7; **unit** project-overlay; **browser-mock** create project → appears on calendar. |
| **Settings** (M8 theme switcher light/dark/cream/green via `html[data-theme]`, per-device station prefs, boot theme) — client-only, no DB | Done (pushed) | 2026-07-04 | **unit** prefs; **browser-mock** theme switch persists + recolors app. |
| **Customers & Credit** (M9A master, `credit_limit`, `customer_ar_standing` derived, invoice-customer attribution, statement of account) — **non-money slice of B1** | Done (pushed) | 2026-07-04 | **guard** customers 6; browser-mock (prior session). **Deferred (not built):** credit-limit ENFORCEMENT in the sale (money path). |
| **Data export** (B7 — client-side JSON dump of local tables, outbox excluded) | Done (pushed) | 2026-07-04 | **unit** export.test; **browser-mock**. Import/restore + governed cloud backup NOT built. |
| **Operations hub** (Schedules+Crops+Projects under one nav entry w/ tabs; legacy path redirects) | Done (pushed) | 2026-07-04 | **browser-mock** (tabs + redirects verified). |
| **Mobile bottom nav** (4 customizable slots + More sheet, safe-area) + responsive pass + dark-mode top-bar toggle | Done (pushed) | 2026-07-05 | **browser-mock** at 375px (bar, customize, persistence). |
| **Approvals & Roles admin screen** (users directory, role dropdown w/ appointment hierarchy, role-authority text, revoke/reactivate, self-protection) | Done (pushed) | 2026-07-05 | **browser-mock** (renders, self-protection). **Note:** UI over existing `membership.manage` RLS (guard org 13); the "Pending approvals" panel is a **placeholder** — the self-signup queue is a cloud-phase item, NOT built. |
| **PWA foundation** (manifest, service worker, icons, prod-only SW registration) | Done (pushed) | 2026-07-04 | **browser-mock** (manifest+sw served 200, SW registers). Not yet wrapped for Play (Bubblewrap/AAB not done). |
| **Calendar / Scheduling** (M6A events + RLS, M6C visibility tiers, M6D times + Month/Day views + now-line + drag, DayFlow Week view + resize) | **In Progress** | 2026-07-06 | **guard** scheduling 13 (tenant/branch/tier isolation, timed-event + end>start). **⚠ OPEN ISSUES raised by owner 2026-07-06 — see §3.** Do NOT mark Done until resolved. |

### Not built / blocked (for completeness — reviewer should not expect these)
| Item | Status | Note |
|---|---|---|
| B2 digital payments (GCash/Maya/bank) | Not started (Blocked) | Money path — spec written (`Phase_2_B2_...`), code gated on cross-vendor money-path review (owner). |
| Credit-limit enforcement in sale · delivery-settle tender/change edits | Not started (Blocked) | Money path — owner review gate. |
| Cloud signup→approval queue | Not started | Owner-designated cloud phase. |
| Supabase project + HTTPS hosting + Play packaging (AAB/assetlinks) | Not started | Owner infra decisions. |

---

## 3. Open issues (unresolved — block "Done" on the named feature)

**CAL-1 · Calendar (owner, 2026-07-06):** flagged for a **full DayFlow implementation**. Specific reports/requirements:
1. **Event visibility across views** — created events reported as not appearing correctly in Day/Week (all-day/untimed
   events currently only surface strongly in Month; they show as a strip/dot in Day/Week). Must appear correctly in
   all views.
2. **Cross-day drag-and-drop** — Week view currently moves events only within their own day column; must support
   dragging an event to a different day.
3. **Data↔UI sync sweep** — general review for state/UI desync in the calendar.
4. **Per-block RBAC** — visibility AND CRUD (create/read/update/delete) on events gated by role hierarchy
   (Owner / Investor / Supervisor / Manager). Sensitive schedules hidden from unauthorized roles.
   (Foundation exists: M6C `schedule.read` / `schedule.read_private` / `schedule.manage` + branch RLS, guard-proven —
   but the owner wants it fully wired to the DayFlow UX incl. an editable event detail panel; clicking a block is
   currently a no-op.)
_Resolution status: OPEN — work starting 2026-07-06. Calendar stays **In Progress** until each item is verified._

---

## 4. Maintenance log (append-only — do not delete history)

- **2026-07-06** — File created. Ground truth re-verified first-hand (22-migration clean reset; 12 guard batteries
  162/0; 89/89 unit; build ok; CI green on feature branch). Recorded the branch reality (feature branch only, not
  main) and the mock-mode caveat. Calendar set **In Progress** due to owner-flagged open issues (CAL-1). All other
  listed features marked Done (pushed) with explicit verification evidence per row.
  _Note: an adversarial per-feature audit workflow was launched but was stopped before completing (no results); this
  file was synthesized from the lead agent's direct, first-hand verification instead._
