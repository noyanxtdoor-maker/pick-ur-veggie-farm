# STATUS.md — PickUrVeggie ERP V3 (source of truth for review)

**Owner of this file:** the coding agent (Claude). **Consumer:** a separate reviewer model (GLM) that decides what
to review based on what this file marks "Done." **Rule: never round up.** If a flow was not tested end-to-end by
the agent, or a reviewer has an open issue against it, it is **In Progress** — not Done.

_Last updated: 2026-07-19 · branch `feature/phase-0-foundation` · Repo A only (repos diverged 2026-07-08, see §0)._

**2026-07-17 session addendum (not yet folded into the numbered sections below):** shipped P1O (POS
product-removal request/approval — see §2 for the new row), a 3-layer Google OAuth sign-in fix + the
cross-device password-reset regression that fix introduced (both live-E2E-verified; see §2), and the
Usage Summary "Used By" column rename. Full guard battery re-verified clean after these changes: **26
guard files, 317 PASS assertions, 0 defects** (fresh count, this session — see per-file breakdown in
`docs/dr-restore-drill-2026-07-17.md`'s companion work). A DR restore-drill against production
(`docs/dr-restore-drill-2026-07-17.md`) confirmed the local stack is a faithful restore target — at
drill time, the only schema deltas were P1O + P1C4's `remove_role_permission`, both then unpushed by
the owner's own choice ("keep going, push later"). **Update, same session: owner then authorized the
push.** P1C4 + P1M.2 + P1O were applied to production together in one transaction (verified read-only:
object counts match, all 5 new functions present, P1M.2's owner-instant-revoke branch confirmed live,
zero anon EXECUTE grants), and the app was deployed to Vercel production. See the P1O and OAuth-fix
rows in §2 for exact per-item verified state — **the OAuth fix is only PARTIALLY live on production**
(2 of its 3 layers; the redirect-allowlist layer only ever touched local config, see that row).

---

## 0. READ THIS FIRST — branch & deploy reality (affects every row)

- **Everything below is pushed to `origin/feature/phase-0-foundation` (local HEAD == remote, in sync).**
- **NONE of it is on `origin/main`.** The feature branch is **190 commits ahead of `origin/main`, unmerged.**
  `origin/main` contains only the initial docs/scaffold (`7833c9f`). **A reviewer checking `origin/main` will see
  almost nothing — review the feature branch.**
- **TWO-REPO REALITY (owner, 2026-07-08–10):** this is **Repo A** (Claude-managed: Fable 5 / Opus 4.8). A fork
  from `8e1f064` lives at github `noyanxtdoor-maker/pickurveggieERPfarm-GLM-version` (**Repo B**, GLM 5.2 +
  MiniMax M3) and **owns the original Supabase project (`jabjyvdkadcbfocaerno`)**. Work boundary: each team
  writes only its own repo. The 2026-07-08 Track A–E sign-offs were pushed to BOTH repos while they moved in
  lockstep, so Repo A's review-doc §9 boxes ARE ticked — but the queued deploy target moved to Repo B with the
  original Supabase; **Repo A's deploys re-target a FRESH owner-created project (pending), sequence: new
  Supabase → Phase-1/auth → then B2.**
- **CLOUD (2026-07-10): Repo A's Supabase project EXISTS and carries the full schema.** Owner created project
  `aqhxhamdwmhcwxmebqbo` (ap-northeast-1); all **23 migrations pushed** via the session pooler; verified live:
  **41 tables, all 41 RLS-FORCED, 23 rows in schema_migrations**, anon-key REST probes return 42501 permission-denied
  on real tables (zero anon grants — the revoke-based posture holds in the cloud). `.env` (gitignored) carries the
  URL + anon key with `VITE_USE_MOCK=true` so the app STAYS on mock data until cloud auth users exist.
  **(2026-07-12 update: migration count has since grown to 26 with P1C applied — see the auth-module row
  in §2. The `schema_migrations` tracking table itself is one row behind, 25/26, since that specific
  registration write was correctly permission-gated — see Launch Runbook §2's "Known follow-up" note. The
  schema objects are live and verified regardless.)**
- **THE APP NOW RUNS LIVE against the cloud (2026-07-10, Phase-1 auth complete).** `VITE_USE_MOCK` removed from
  `.env`; the tenant is bootstrapped (company "Pick Ur Veggie Farm" / branch "Main Farm" / owner identity with the
  full 31-permission catalog); the owner logs in with his own credentials. **"Browser-verified" for rows dated
  2026-07-10+ can mean REAL-cloud** (each row says which). Earlier rows remain mock-verified as recorded — their
  real-cloud proof is the guard batteries + the live POS E2E below. Unit tests are pinned to mock
  (`vite.config.ts` forces `VITE_USE_MOCK=true` in vitest) so the suite can never touch production.
  - "Browser-verified" below therefore means **manually exercised in the running app against the local mock/Dexie
    data path** — NOT against a live cloud database.
  - The **real-cloud path** (online Supabase PostgREST + RPC) is now proven **both ways**: the SQL guard
    batteries (behavioral tests against a real local Postgres with simulated JWTs) AND, as of **2026-07-12**, a
    **real browser E2E against a live-schema local stack** (signup → auto-poll → bootstrap → 5-tier approve
    dropdown → server-enforced rank checks → per-user override grant, all via the actual `app/` UI hitting real
    Supabase Auth + PostgREST + RPC — see the P1C row below). The remaining gap is the SAME test walked through
    the app against the **production** `aqhxhamdwmhcwxmebqbo` project specifically (money-spine E2E, Track A) —
    that is still a launch-phase task.

## 1. Global verification snapshot (re-run 2026-07-12, all first-hand)

| Check | Result |
|---|---|
| `supabase db reset` (26 migrations apply) | ✅ clean |
| All 16 guard files (behavioral SQL security tests) | ✅ **206 PASS / 0 DEFECT** |
| `tsc --noEmit` (type check) | ✅ clean |
| `vitest` unit tests | ✅ **92 / 92** |
| `vite build` | ✅ ok |
| `node scripts/guards/check-drift.mjs` | ✅ clean (schema matches migration history) |
| P1C migration applied to production (`aqhxhamdwmhcwxmebqbo`) | ✅ 2026-07-12 — single-transaction apply, no errors; read-only post-check confirms the real production owner resolves correctly (`has_permission`/`actor_rank`) |
| CI runs a browser? | ❌ no — E2E is manual, mock-mode only |

Guard battery counts (2026-07-12): rls-behavior 23 · inventory 24 · payroll 19 · accounting 19 · pos 18 · org 13 ·
scheduling 15 · crop 11 · payments 11 · bootstrap 8 · projects 7 · customers 6 · auth-lifecycle 7 ·
copilot-degrade 4 · **approvals-roles (P1C, new) 21** · db-guards (structural, unnamed).

---

## 2. Features

Legend — **Verification** column: `guard N` = passing behavioral SQL security battery · `unit` = vitest ·
`browser-mock` = agent manually clicked the flow in the running app (mock data) · `tsc/build only` = compiles but
the flow was not exercised.

| Feature | Status | Last touched | Verified (fact) vs assumed |
|---|---|---|---|
| **Phase-1 foundation** — identity, multi-tenant, roles/permissions, resolver + tenant RLS (`has_permission`, `is_branch_member`, `current_app_user_id`), append-only audit, controlled bootstrap | Done (pushed) | 2026-07-10 | **guard**: rls-behavior 23, org 13, bootstrap 8; CI-green. **NOW REAL-CLOUD PROVEN (2026-07-10):** live bootstrap ran on the cloud project; real owner login → resolver + 31-key permission snapshot + RLS reads all live (company visible through PostgREST as the real user). |
| **Phase-1 AUTH MODULE (P1A+P1B+P1C)** — self-signup → approval queue (signup trigger; pending = Active identity with zero memberships, blind by C2 §3; `list_pending_users` w/ requested-role; OAuth display-name fallback `full_name`/`name`), split-panel login (SIGN IN / CREATE POS ACCOUNT tabs, role-request dropdown, demo quick-identities in mock only), self-service password reset (email link → `/auth/reset`), OTP-guarded password change in Settings (email nonce, ODR-003 re-auth), admin-assisted recovery (send reset email from Approvals), AwaitingApproval gate w/ 15s auto-poll + on-focus (no manual reload), Google OAuth scaffold (owner enables provider per `Phase_1_OAuth_Setup.md`), break-glass runbook, **P1C hardening (2026-07-12): 5 standard role tiers seeded per company (employee/operator/admin/co_owner/owner, rank 10/20/30/40/50, strictly-widening permission sets) both at bootstrap and backfilled onto the live tenant; server-enforced rank-based appoint/revoke authority (`actor_rank`/`outranks_role`) on memberships AND role creation/editing/permission-mapping, self-management exempt from the rank check but still membership.manage-gated; server-enforced per-user permission overrides (`user_permission_overrides` + `set_user_permission_override`, deny beats grant, grant requires a live membership, self-override forbidden, folded into `has_permission`); invite flow now copies a clickable `/accept?token=` URL, not a raw token; top-bar sign-out fully removed (stale Settings copy also fixed)** | Done (pushed + **cloud-deployed 2026-07-12**) | 2026-07-12 | **guard** auth-lifecycle **7/7** + **approvals-roles (P1C) 21/21** — full suite **206 PASS / 0** after clean reset. **REAL-CLOUD E2E (2026-07-10):** owner login w/ own credentials → tester signed up via the UI → email-confirmed → pending & blind → owner approved in the queue (branch+role) → membership landed on cloud → tester logged in and saw the app. **REAL browser E2E of P1C (2026-07-12, local live-schema stack):** signup → bootstrap → auto-poll routed in with no reload → 5-tier approve dropdown (all 4 non-owner tiers shown) → approved as operator → per-user Overrides dialog granted `accounting.read` → confirmed in DB. **Found+fixed live (2026-07-10):** approve dialog had zero options on a fresh device (Dexie cache not hydrated) — now hydrates from the server. **Found+fixed live (2026-07-12):** `isMe` self-action hiding never worked in real (non-mock) mode (hardcoded null) — now resolves via `current_app_user_id()` RPC. **P1C applied to production `aqhxhamdwmhcwxmebqbo` 2026-07-12** (single-transaction, no errors; read-only post-check confirms the real owner resolves correctly). **Assumed/untested:** reset-email delivery + OTP email arrival (needs a real inbox — owner to smoke-test); Google OAuth (provider not yet enabled — root cause of "Google signups don't appear in queue" is provider/redirect config, an owner dashboard action per Launch Runbook §1, not a code defect); MFA/TOTP enrollment deferred (runbook notes); invite email delivery still manual copy/paste (by design — Launch Runbook §2.6 option (a), zero infra). |
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
| **Approvals & Roles admin screen** (users directory, role dropdown w/ appointment hierarchy, role-authority text, revoke/reactivate, self-protection, **P1C: per-user Overrides dialog — server-enforced grant/deny over the full 31-key catalog**) | Done (pushed + cloud-deployed) | 2026-07-12 | **REAL browser E2E** (2026-07-12, see auth-module row above) — live signup, approval, override grant, all confirmed against the DB. Pending queue is the **live** `list_pending_users()` RPC, not a placeholder (was updated 2026-07-10; this row was stale). UI over `membership.manage` + P1C rank RLS (guard org 13 + approvals-roles 21). |
| **PWA foundation** (manifest, service worker, icons, prod-only SW registration) | Done (pushed) | 2026-07-04 | **browser-mock** (manifest+sw served 200, SW registers). Not yet wrapped for Play (Bubblewrap/AAB not done). |
| **Calendar / Scheduling** (M6A events + RLS, M6C visibility tiers, M6D times + now-line + drag, **full DayFlow: Year/Month/Week/Day view set, cross-day drag, all-day rows in every view, event detail panel with CRUD reachable from every view, per-role read-only UX**) | Done (pushed) | 2026-07-06 | **guard** scheduling 15 (tenant/branch/tier isolation, timed-event + end>start, **+ cross-day move allowed+audited for schedule.manage / denied→0 rows for read-only**). **browser-mock** full E2E: create timed + all-day → both render in Day AND Week; edit via detail→modal persists; mark done↔reopen; delete removes from DB; cross-day drag Mon→Tue persisted `event_date` 07-06→07-07 (times preserved); read-only role (schedule.read only) sees events + opens detail to READ but gets "View only" (no New Event, no Management filter, no edit/drag). CAL-1 resolved — see §3. |

| **Digital payments (B2A first slice)** — `financial_accounts` registry (thin, keyed to COA Asset codes, **no stored balance ever**), account-routed `pos_record_sale`/`pos_settle_sale` (+`p_financial_account_id`, null = drawer), `pos_void_sale` reverses against the account actually debited, `balance_sheet`/`cash_flow_statement` over Cash & equivalents, `financial_account_transfer` (Dr/Cr, no P&L), POS payment-method picker (checkout + settle), Accounting "Cash & Accounts" tab (derived-balance cards, CRUD, transfer) | **BUILT (pushed) — pre-lock** | 2026-07-10 | **guard** payments 11/11 (GCash sale→WALLET not CASH w/ assets unchanged; void mirrors account; transfer zero-net/no-P&L/idempotent; cash-flow closing = Σ balances; full gate matrix; derived-only; code immutable) + full suite 175/0 after clean reset. **unit** 89/89 · tsc · build. **browser-mock** E2E: drawer+GCash created via UI; 2 kg GCash sale → invoice stores account id, GCash balance ₱270 derived; transfer ₱100 GCash→drawer → 170/100, total unchanged. **NOT locked:** B2 requires its own cross-vendor review (spec §6c) before lock; real-cloud RPC path unexercised by the app (schema is live, auth pending). Settle-to-account: guard-proven server-side; mock settle browser path not exercised this session. |

| **VeggieGenius Copilot (CAP-VG1 v1, steps 1–4)** — Settings card (LM Studio URL/model/toggle), `/copilot` panel + client-only chat history (Dexie; `chatRole` field), grounded non-AI **Morning Brief** (events · unpaid invoices · low material+produce stock · active projects), local-model ask with **offline-degrade** (never load-bearing) | BUILT (pushed) | 2026-07-10 | **guard** copilot-degrade **4/4** (zero Postgres surface: no tables/permissions/policies/functions — run vs the LIVE cloud schema + CI local reset). **unit** 3 brief tests (empty→honest calm; seeded→exact grounded numbers). **LIVE browser E2E** as the real owner: nav entry, Settings fields, brief renders model-free, ask → graceful offline degrade. **Assumed/untested:** an actual LM Studio round-trip (no model installed on this machine — owner smoke-tests step 4 with LM Studio running; the degrade path is the tested default). Step 5 (Edge Function + `copilot.use` + 4 guards) = next slice, now unblocked by the live cloud. |

| **P1O — POS product-removal request/approval** — Crop Pricing Menu "Archive"→"Remove" rename + confirmation dialog; `product.remove` (new lesser key, employee/operator default) queues a Pending request, `product.manage` (admin+) removes instantly and decides on queued requests; one Pending row per product (partial unique index); decider≠requester self-check holds even after the requester later gains `product.manage` via override; full audit trail either way | **Applied to production** 2026-07-17 (single-transaction push alongside P1C4 + P1M.2; app deployed to Vercel) | 2026-07-17 | **guard** p1o **18/18** (adversarial review confirmed 7/7 privilege-escalation vectors SAFE; guard-coverage review found + this session closed 6 real test gaps: cross-tenant isolation, `list_pending_product_removals()` never invoked, double-decision, no-product.manage-at-all-denied, authenticated-grant assertion, SQLERRM specificity on same-errcode branches). Full suite re-verified clean after hardening: 26 guards / 317 PASS, tsc, 93 unit tests, build, static+drift guards. **Production push verified read-only:** `product_removal_requests` table + all 4 RPCs present, `product.remove` permission active, zero anon EXECUTE grants. **Not yet live-clicked against production in the browser this session** — guard-proven server-side and the local app flow was E2E-verified earlier in this session per prior context; the post-deploy production smoke test was read-only (login page only), not a full click-through of the Remove button. |
| **Google OAuth sign-in fix (3-layer) + password-reset cross-device regression fix** — `flowType: 'pkce'` made explicit on `createClient()` (was silently defaulting to legacy `implicit`); OAuth error captured synchronously at module-load time in `client.ts` (beats supabase-js's own async URL consumption race); `supabase/config.toml` `additional_redirect_urls` wildcarded (was silently substituting `site_url` on a non-match, GoTrue does not error on this). **Regression found by adversarial review and fixed same session:** switching to PKCE globally also ties `resetPasswordForEmail` to the requesting browser's `code_verifier` — a reset link opened on a different device/browser now fails silently (indistinguishable from expired) instead of cross-device like the old implicit flow did; `ResetPassword.tsx` now detects the unconsumed `?code=` + no-session signature and shows a distinct, actionable message | **Deployed to Vercel production** 2026-07-17 (`https://pick-ur-veggie-farm.vercel.app`, code-only, no migration needed) — **BUT only 2 of the 3 OAuth layers are actually live on production.** `flowType: 'pkce'` and the module-load-time error capture are app-bundle code, now shipped. **Layer 3 (the redirect-URL allowlist fix) is NOT live on production** — it only edited the LOCAL `supabase/config.toml`, which has no effect on a hosted Supabase project; production's actual redirect allowlist is dashboard-configured separately and has not been checked/fixed there. **Until an owner checks the production Supabase dashboard's Auth → URL Configuration for the real domain, Google sign-in on production may still silently fail the way it did before this fix**, even though the code is deployed. | 2026-07-17 | **LIVE browser E2E, all 3 OAuth layers + both reset-link paths — but only against the LOCAL live-schema stack, not production:** Google sign-in confirmed working end-to-end locally. Password-reset: wrong-device case reproduced by clearing `localStorage` before opening the code URL (confirmed distinct message renders); same-device case confirmed still completes the full round-trip (Mailpit-captured email → code exchange → password saved → sign-in works). Post-deploy smoke test on production was read-only (login page renders) — the OAuth round-trip itself was NOT re-tested against production, since layer 3's gap means it may not fully work there yet. |

| **P2-M2F — produce no longer requires tracked stock** — owner directive 2026-07-17/18: "the sold of each product is the inventory, they dont keep count of their own product inventory... only Equipment and Usable inventory (materials) are tracked." Root cause found (not assumed): `record_opening_finished_goods()` — the ONLY RPC that can ever create a `finished_goods_batches` row — has zero callers anywhere in `app/`, so every product added via "Register New Vegetable Item" was permanently unsellable (grid tile disabled, `availableFor()` always 0). Fixed by making `finished_goods_batch_id` genuinely optional for a weighed produce line — mirrors the exact pattern already proven safe for bulk/"Skip Weigh" lines (no stock check, no inventory movement, no COGS contribution when absent); when a batch IS supplied (future harvest-tracking, legacy data), behavior is 100% unchanged (cost lookup, oversell check, movement, COGS). Checked Team B's repo for a reference fix first (owner's go-ahead) — **they do not have this fix**; their stock gate is still live in their newest migration, confirmed by direct read, not assumed. | **Applied to production** 2026-07-18 (single migration, `pos_record_sale` function body only — no schema change; app redeployed to Vercel) | 2026-07-18 | New migration `20260718000000_p2m2f_produce_no_stock_requirement.sql` (`pos_record_sale` body change only, same signature). **guard** pos-security still 18/18 (the with-batch/oversell-rejection path is provably unchanged — this guard supplies a real batch and still gets rejected for insufficient stock). Full suite re-verified: 26 guards, 94 unit tests (added 1 new test: a weighed line with no batch records regardless of "quantity," still classified `sale_type='retail'` not `wholesale`), tsc, build, static+drift guards all clean. **LIVE browser E2E against the real local Postgres** (fresh company, fresh owner, zero pre-seeded stock): added "Fresh Kangkong" via Register New Vegetable Item → grid tile immediately clickable (previously would be permanently disabled) → weighed 5kg → completed full checkout → Slip #00001 recorded, ₱360 Paid. Read-only DB check post-sale confirmed `sales_order_items.finished_goods_batch_id IS NULL`, `unit_cost=0`, `is_bulk=false` (correctly still a retail sale, not bulk), and the GL posted balanced with only Cash↔Sales lines, zero COGS lines — the exact same shape a bulk-only sale already posts safely in production today. |

| **P2-M2G — POS checkout: discount on Direct Cash + customer name (both tabs) + receipt + reprint** — owner 2026-07-18: the 10% discount toggle previously only existed on the Pre-order tab; `pos_record_sale` hard-rejected any discount on a 'paid' sale. Now split into two independent checks: delivery fee stays pre-order-only (unchanged — nothing to "deliver later" on an immediate cash sale), discount applies to either kind. New `customer_name` free-text column on `invoices` + `p_customer_name` param, threaded through both checkout tabs (shared UI block, not duplicated), onto the receipt, and reconstructable from the Historical Sales Journal via a new Print icon-button next to Void (sets the historical invoice as `lastSale` and reuses the existing receipt pane — no new server call). | **Applied to production** 2026-07-18 (pushed via direct psql to the pooler — the linked CLI account has no Management API access to this project, only the raw DB password; app redeployed to Vercel) | 2026-07-18 | **guard** pos-security: 5 new assertions — 10% discount now correct on a Direct Cash sale (243 = 270−10%), delivery fee STILL rejected on 'paid' (regression guard for the thing that must NOT have changed), customer_name stored + trimmed on both sale kinds, whitespace-only customer_name stores as null. Full suite re-verified: 26 guards, 94 unit tests, tsc, build, static+drift all clean. **LIVE browser E2E** against a real fresh company: added a product, weighed 2kg, checked the discount box + entered "Aling Sandra" on the Direct Cash tab → total ₱162 (correct 10%-off math) → receipt shows "Customer: Aling Sandra" → journal's Print button reconstructs the identical historical receipt. |
| **P2-M3B — Inventory access: Purchase Summary gated separately from buying stock** — owner 2026-07-18: "Stock Inventories have 4 tabs... i dont want lower tiers seeeing our purchase history." Found (not assumed) the actual gap: `InventoryScreen.tsx` had ZERO per-tab permission checks — the page-level gate (any of `inventory.purchase`/`inventory.adjust`/`equipment.manage`) was all-or-nothing, so anyone with inventory access at all saw every tab including the aggregate spend report. Deliberately did NOT lock the underlying `purchase_receivings` table (its RLS is company/branch-membership-only) — that data also feeds the Consumables tab's own "Cumulative expense value"/"Last Restocked" cards and the Buy Stock autocomplete, which operator legitimately needs; locking it would have broken buying stock for the tier that still buys it. Instead: new `inventory.reports.read` key (admin+ default, NOT employee/operator), real per-tab `has()` gating added to `InventoryScreen.tsx` (previously nonexistent, mirrors `OperationsLayout.tsx`'s established pattern), and Stock Inventories added to the Section Access panel as a proper 4-tab entry (was a single placeholder leaf) so the owner can customize per-user. | **Applied to production** 2026-07-18 (pushed via direct psql to the pooler; app redeployed to Vercel) | 2026-07-18 | **guard** inventory-security: new assertion — fresh-bootstrap employee/operator denied `inventory.reports.read`, admin granted (26 guards, 94 unit tests, tsc, build, static+drift all clean). **LIVE browser E2E, full owner-customization loop:** fresh operator account saw only 2 of 4 tabs (Consumables, Usage History — no Equipment, no Purchase Summary) → owner opened Access panel, saw "Stock Inventories — 2 of 4 tabs visible" with Purchase Summary correctly "Not Visible" → granted it → operator's next page load showed 3 of 4 tabs, Purchase Summary tab content rendering correctly, Equipment still correctly hidden (that grant was untouched). |
| **P1P — Mandatory 6-digit MPIN + 2-minute auto-lock (banking-app security layer)** — owner 2026-07-18: "add another secuiry layer since this is a ERP... we dont want a lower tier get theri phone stolen then that thief will access our ERP." Flow: Approval → Choose Username → **Set MPIN (mandatory, cannot be skipped)** → biometric (Phase 2, not built). New `public.user_mpin` table with **zero grants to anon/authenticated at all** (not even a restrictive SELECT policy — RPC-only, same hard boundary `current_app_user_id()` uses), bcrypt via pgcrypto (`extensions.crypt`/`gen_salt('bf')`, this app's first self-hashed secret). Escalating lockout (5 fails→60s, 10→5min, 15→15min, 20+→30min), every failure/lockout audited. **Real bug caught and fixed by the guard battery, not by inspection:** `verify_mpin` originally *raised* on wrong/locked, which — since Postgres has no autonomous transactions — rolled back its own `failed_attempts` increment and audit insert every single time, silently defeating the entire rate limiter in production. Redesigned to return `'ok'/'wrong'/'locked'/'no_mpin'` instead of raising for these expected outcomes; `change_mpin` updated to match. `onboarding_next_step()` supersedes P1N's `needs_username_onboarding()` (kept, unchanged, unused) with an ordered sequence. 2-minute client-side `LockProvider` overlay (`app/core/security/lock.tsx`, mirrors `SyncProvider`'s pattern) — never a sign-out, session/cache/outbox stay intact; skips arming entirely while offline (owner decision, confirmed via AskUserQuestion); defaults to locked on silent session rehydration (reopening the app), unlocked on an actual interactive sign-in (`sessionStorage` flag consumed once, survives a same-tab OAuth redirect). ODR-006 amendment doc records this as a narrow, threat-specific supersession of ODR-003's "MFA optional for operational tier" — the device-theft threat targets the session, not the role's authority, so it applies to every tier. | **Applied to production** 2026-07-18 (pushed via direct psql to the pooler; app redeployed to Vercel) | 2026-07-18 | New migration `20260718030000_p1p_mpin_security_layer.sql` + new guard `scripts/guards/mpin-security.sql` (12 assertions: format/trivial-PIN rejection, escalating lockout math incl. the 10th-failure 5min tier, success-resets-counter, `change_mpin` re-auth, cross-user isolation, `onboarding_next_step()` full sequence, grant shape). `db-guards.sql`'s tenant-ownership exemption list extended (`user_mpin` is person-scoped like `users`, not company-scoped — this guard caught it immediately on first run). Full suite re-verified clean after a fresh reset: 27 guards, 94 unit tests, tsc, build, static+drift. **A second real bug caught live, not by the guard (this one is a client-only gap the SQL guard can't see):** `RequireOnboarding`'s effect only re-ran on session-status changes, but "awaiting approval → approved" never changes session status (Supabase auth doesn't track company membership) — a user approved while sitting on the same tab would silently skip username AND MPIN onboarding entirely. Fixed by also re-running the check on `usePermissions().companyId` transitions. **LIVE browser E2E against the real local Postgres, full flow, fresh signup → bootstrap-as-owner (stand-in for admin approval) → username → MPIN cannot be skipped (direct `/dashboard` navigation redirects back) → set MPIN → dashboard with no lock (interactive path); hard reload → locked (rehydration path, confirmed via `document.body.innerText`, not `get_page_text` which reads `<main>` only and misses the overlay); wrong MPIN → "Incorrect PIN — try again"; correct MPIN → unlocks; the 2-minute idle timer fired organically during testing and re-locked the tab on its own; Profile → Change MPIN rejects the wrong current MPIN, accepts the correct one, confirmed server-side (`mpin_set_at` bumped, `failed_attempts` reset).** Lockout-escalation math (60s/5min/15min/30min) and cross-user isolation verified via the guard, not re-driven through 20+ manual UI clicks. **Every existing user, including the owner, will be prompted for a mandatory MPIN on their next sign-in once this ships** — expected, not a bug, per "mandatory for everyone." Phase 2 (biometric/passkey) and phone/SMS sign-up remain explicitly deferred, unrelated infra decisions. |
| **P1P.2 — Optional biometric/passkey login (Phase 2 of the bank-app security layer)** — owner's original request completed: "Set Fingerprint biometrics (optional)" as the final onboarding step, plus a biometric option on both the lock screen and the login screen. Blocked in the original P1P plan on "confirm Supabase plan support first" — confirmed this session: Supabase shipped native Passkey auth to public beta 2026-05-28, no plan-tier restriction. Uses Supabase's own `auth.registerPasskey()`/`auth.signInWithPasskey()`/`auth.passkey.list/update/delete` (gated behind a client `experimental.passkey: true` flag) — **credential data lives entirely inside Supabase Auth's own schema, this repo stores none of it**, only a `biometric_offer_seen_at` onboarding-nudge timestamp (already scaffolded on `public.users` by the P1P migration). New migration evolves `onboarding_next_step()` with a `biometric_offer` branch (mpin → biometric_offer → null) + new `dismiss_biometric_offer()` RPC. `registerPasskey()`/`signInWithPasskey()` return a 3-way result client-side (`ok`/`cancelled`/`error`) so a user backing out of the native OS prompt shows no error banner, only a real failure does. Deliberately asymmetric on the interactive-sign-in flag: `Login.tsx`'s biometric button marks interactive (cold-start sign-in, mints a new session); the **lock screen's** "Use biometric" button calls the SDK directly and does NOT mark interactive, since marking it there would leak into the next genuine tab reload and wrongly skip the lock screen. **A real gap caught only by live testing, not the guard or tsc:** the client-side `experimental.passkey` flag was wired correctly, but the corresponding SERVER-side `[auth.passkey] enabled` toggle in `supabase/config.toml` was never actually applied — every passkey call failed with "Passkeys are disabled" until caught live and fixed (`supabase stop`/`start` required — a `db reset` alone does not reload GoTrue's config). Production needs the equivalent **Supabase Dashboard → Authentication → Passkeys** toggle with the real domain as `rp_id` — `config.toml` has zero effect on the hosted project, the same class of gotcha as the earlier Google OAuth redirect-URL incident. | **Applied to production** 2026-07-18 (pushed via direct psql to the pooler; app redeployed to Vercel) — **but the production Supabase dashboard's Passkeys toggle has NOT been flipped on yet.** The "Sign in with biometric" / "Use biometric" buttons are now LIVE and visible on production (client-side device detection is independent of server config), but clicking one will currently fail server-side until the owner enables Authentication → Passkeys in the dashboard with `pick-ur-veggie-farm.vercel.app` as the domain — same two-step shape as the earlier Google OAuth fix. | 2026-07-18 | New migration `20260718040000_p1p2_biometric_onboarding.sql`; extended (not forked) `scripts/guards/mpin-security.sql` with the `biometric_offer` sequence step, `dismiss_biometric_offer()` idempotency, and the updated 6-function grant-shape check. Full suite re-verified clean after a fresh reset: 27 guards, 94 unit tests, tsc, build, static+drift. **LIVE browser E2E, real end-to-end this time (not simulated) — this environment turned out to have a genuine platform authenticator (Windows Hello via the host machine), contrary to the plan's assumption that it wouldn't:** fresh signup → bootstrap → username → MPIN → landed on `/onboarding/biometric` showing the real "Set up biometric unlock" / "Skip for now" buttons → Skip correctly called `dismiss_biometric_offer()` (confirmed server-side) → landed on dashboard unlocked. Login page shows "Sign in with biometric" only on the sign-in tab (correctly absent from sign-up, where no passkey could exist yet). Lock screen shows "Use biometric" only when supported. Profile's new Biometric card correctly listed "No passkey set up yet" once the server-config gap above was fixed (confirmed via network trace, not just UI text). **Deliberately not attempted:** actually completing a passkey registration/sign-in ceremony — that pops a native Windows Security dialog outside any of the browser-automation tools' reach, would touch the operator's real biometric hardware, and isn't something to trigger without them present; the owner's own device remains the right place for that final smoke test, exactly as the plan anticipated (just for a more specific reason than originally assumed). |
| **Login.tsx: signup lands directly on the awaiting-approval screen (not back on the login form)** — owner report: "when signin up... it doesn't directly lead to the waiting approval screen it just leads back to the log-in interface but you can log-in and it will take you to the waiting approval screen." Root-caused to two DIFFERENT bugs, only one of which is a code defect: **(1) Google OAuth path** — a client-side race was ruled out by reading the installed SDK source (`getSession()` correctly awaits `initializePromise`); the real cause is the production Supabase dashboard's redirect-URL allowlist not including the deployed domain (GoTrue silently substitutes `site_url` on an unlisted `redirect_to`, per the same class of gotcha as the earlier OAuth incident) — **owner-only dashboard action, not fixable in code, unchanged status.** **(2) Email/password path** — a genuine, fixable client bug: when email confirmation is off, `signUp()` already returns a live session, but `Login.tsx` had no explicit navigation for that case — the user sat on a login-page notice instead of being routed anywhere. Fixed with one `navigate('/dashboard', {replace: true})` when `!res.needsConfirmation`. | **Applied to production** 2026-07-18 (code-only, no migration; `npx vercel --prod`) | 2026-07-18 | **LIVE browser E2E:** fresh signup with email confirmation off lands directly on `/dashboard` showing "Almost in — awaiting approval," confirmed via `window.location.pathname`, no bounce through the login form. tsc/vitest/build clean. **The Google OAuth half of the report remains unresolved** — needs the owner to check the production Supabase dashboard's Auth → URL Configuration for the real domain (same open item as row 116 above). |
| **Full 5-role live sweep (owner directive 2026-07-18): "test in each role... find bugs and fix it... is the restrictions too strict"** — signed in as each of owner/co_owner/admin/operator/employee against a real (non-mock) local Supabase-backed dev server (5 test fixtures, `*_sweep.local`, local Docker only — never touched production data), exercised every nav-visible module per role, checked for console errors and permission-boundary correctness. **4 real bugs found and fixed:** (1) POS discount checkbox defaulted checked — silently gave 10% off any sale unless the cashier unchecked it; now off by default. (2) Payroll "Disburse Wage" defaulted to 5 days worked (both the open-handler and the post-submit reset) — paid 5x for 1 day worked unless manually corrected; now defaults to 1 day. (3) Approvals & Roles: Access/Revoke/Archive/role-reassign rendered on ANY member row regardless of rank — as co_owner, the owner's own row showed live-looking buttons the server already blocks (`outranks_role` requires strictly-higher rank); Archive/Reactivate would fail with an RLS error, Revoke would silently queue a request nobody could ever approve. (4) Roles screen had the same gap — co_owner saw live Save/"Edit default access" controls on the `owner` role definition. Both (3) and (4) fixed by hiding/disabling the controls unless the actor's rank strictly exceeds the target's, mirroring the server check exactly — only surfaced by testing as a non-owner tier, which is why the sweep mattered. **Role-appropriateness findings, not code changes (owner's call):** Employee (lowest tier, `pos.sell` only) sees full branch financials on the Home Dashboard (revenue, receivables, discounts, delivery fees) and all cashiers' transactions in the POS Historical Sales Journal — this is by design at the RLS layer (`invoices_select_member` gates on branch membership, not role), not a client-side gap; worth an explicit decision on whether that's intended transparency or should require `accounting.read`. Everything else (nav visibility, feature gating, role-appropriate defaults for operator/employee) matched the seeded permission catalog exactly. | **Applied to production** 2026-07-18 (code-only, no migration; `npx vercel --prod`, same deploy as the Login.tsx fix above) | 2026-07-18 | tsc clean, 94/94 unit tests, build clean. Each of the 4 fixes live-confirmed in the browser against the relevant role(s) after the change (fresh page load, not just the running dev session, to rule out React Fast Refresh masking a stale value). Post-deploy production smoke test: login page renders, biometric/Google buttons present, zero console errors, bundle hash (`index-DalrTseG.js`) confirmed matching the build just produced. **Not re-tested against production with real accounts** — the 5-tier test fixtures are local-only by design; the fixes are pure client-side default-value/rendering-condition changes with no environment-specific logic, so the local verification is expected to transfer directly. |
| **Void-sale approval workflow** (P2N2) — `pos_void_sale`'s former one-click reversal (behind `pos.void`) replaced with a request→approve/reject flow (separation of duties): cashier files a void request (`pos.sell`), a separate holder of `pos.void` approves/rejects on the Approvals screen. Ported from Team B, adapted: `approve_void_request`'s reversal reads `invoices.financial_account_id` and resolves the pay code exactly like `pos_void_sale` itself (CASH vs the specific GCash/Wallet/Bank account) — Team B's own version hardcodes Paid→CASH, which would have silently mis-posted every GCash-paid void. | **Applied to production** 2026-07-18/19 | 2026-07-19 | **guard** p2n2-void-approval-security 7/7 (added a GCash-specific assertion beyond Team B's 6, proving `WALLET_GCASH` — not `CASH` — is credited). Full suite clean (29 guards, 94 unit, tsc, build). **LIVE browser E2E:** cashier filed a CASH void via the UI, owner approved a UI-filed request and a SQL-seeded GCash request separately — DB confirmed `WALLET_GCASH` credited ₱150.00 / `CASH` credited ₱0 on the GCash approval; rejected the CASH one, DB confirmed the invoice stayed `Paid`. |
| **Vendors + Cost Schedule + AP Ledger** (T3.1) + **vendor picker in Buy Stock** (T3.2) — reverses an earlier YAGNI deferral ("supplier/AP master — cash-only purchases"). Vendor master, per-vendor×product rate card (auto-closes prior overlapping row), full AP ledger (invoice → payment → derived `vendor_ap_standing`, never stored) with a balanced GL posting per invoice/payment. Buy Stock's "Purchase Location" gets a third option, "Registered Vendor," that snapshots name/contact from the vendor master and links `purchase_receivings.vendor_id`. Ported from Team B, adapted: `usePermissions().companyId` instead of a raw query, explicit branch `SelectField`s instead of a silent "first active branch" lookup, writes wired through the `online()/enqueue()` offline-queue pattern every other write in this repo uses. **Real bug caught during E2E, not by inspection:** a company that has never run a sale/purchase has an empty chart of accounts — `vendor_invoice_record`/`vendor_payment_record` only called `vendor_ensure_accounts` (AP row only), so the very first vendor invoice on a fresh company failed outright with "expense account not found." Fixed by also calling `inventory_ensure_accounts` (server-side, in both RPCs) and having the client seed the chart before its own account-code lookup. | **Applied to production** 2026-07-19 | 2026-07-19 | **guard** t3-1-vendors-and-ledger-security 9/9 (added a cold-start assertion — empty chart_of_accounts company — beyond Team B's original 8) + t3-2-purchase-vendor-link-security 7/7. Full suite clean (29 guards, 94 unit, tsc, build). **LIVE browser E2E:** created a vendor, recorded a ₱1,255.00 invoice on a genuinely fresh company (proving the chart-of-accounts fix), fully settled it (AP standing → ₱0.00), then a Buy Stock purchase with the vendor selected — DB confirmed `source_type='vendor'`, `vendor_id` linked, name/contact snapshotted, and the vendor's AP standing correctly untouched (Buy Stock and AP invoices are independent flows). |
| **Payroll: optional bonus/incentive on Disburse Wage** (T3.3) — not in Team B's build; new, small design following the exact evolution pattern T3.2 proved (append a defaulted arg to a governed RPC, old call sites unaffected). `payroll_disburse_wage` gains `p_bonus_amount` (appended last, default 0); `gross = round(days × rate, 2) + bonus`, still fully server-recomputed (wage authority unchanged). `bonus_amount` is its own `wage_payments` column, not folded silently into gross, for audit-trail honesty. Disburse Wage dialog gets an optional "Bonus / Incentive (₱)" field, shown as its own "+ Bonus" breakdown line. | **Applied to production** 2026-07-19 | 2026-07-19 | **guard** payroll-security: 2 new assertions (bonus adds to gross correctly; the old 7-arg call shape is unaffected — no regression). Full suite clean (29 guards, 94 unit, tsc, build). **LIVE browser E2E:** hired a worker, disbursed a 1-day wage with a ₱150 bonus — confirmed gross ₱650 / `bonus_amount` 150 / net ₱650 and a balanced Dr Wages 650 / Cr Cash 650 journal entry against the live local Postgres GL. |

### Not built / blocked (for completeness — reviewer should not expect these)
| Item | Status | Note |
|---|---|---|
| B2 digital payments (GCash/Maya/bank) | **BUILT (pushed) — pre-lock** | Moved to §2 (row "Digital payments"). Authorized by review §9 (B2 APPROVED 2026-07-08); built 2026-07-10; **B2's own cross-vendor review before lock still pending (spec §6c)**. |
| Credit-limit enforcement in sale · delivery-settle tender/change edits | Not started (Blocked) | Money path — owner review/sign-off gate (same review). |
| Supabase project + HTTPS hosting | **Done** | Moved to §2 elsewhere in this doc; `aqhxhamdwmhcwxmebqbo` live, `pick-ur-veggie-farm.vercel.app` deployed 2026-07-12. |
| Google Play packaging (AAB/assetlinks) | Not started | Owner infra decision (Play Developer account, signing key) — Launch Runbook §3.6, gated on hosting (now unblocked). |
| MFA enrollment (ODR-003) | **Built 2026-07-19, local-verified — not yet pushed to production** | TOTP enabled at the project level since 2026-07-13. App-side enrollment UI now exists (Profile → Two-Factor Authentication) + a post-sign-in AAL2 challenge gate in the router. Pure client wiring against supabase-js's `auth.mfa` API — no migration, GoTrue owns its own tables. Live-verified locally: full round trip (enroll with a real computed TOTP code → sign out → sign in → correctly redirected to challenge → valid code accepted → landed on dashboard → disable reverts cleanly). `supabase/config.toml`'s `[auth.mfa.totp]` flipped to match production. Nothing to migrate for the production push — only the app deploy. |
| B2A cross-vendor lock review | Not started | Needs an external reviewer — Launch Runbook §3.1. |
| Backups beyond free-tier | Not started | Owner plan decision — Launch Runbook §3.7 / B7 §12. |
| DR restore drill | **Done 2026-07-17** | `docs/dr-restore-drill-2026-07-17.md` — local stack confirmed a faithful restore target for production; schema/data both verified byte-for-byte against a live read. Paid backup RETENTION plan is still a separate owner decision (row above) — this drill only proves the restore mechanism works, not that Supabase is retaining backups beyond the free tier's window. |

---

## 3. Open issues (unresolved — block "Done" on the named feature)

**P1C.1 + P1D + P1D.1 + P1E · APPLIED TO PRODUCTION 2026-07-12** (owner authorized P1C.1+P1D with "push",
then P1D.1+P1E with "push P1D.1 and P1E"). Verified live: functions/tables exist, positions seeded for the
live company, real owner resolver still correct, owner role now holds `position.manage`/`job_title.manage`,
all 7 P1E functions confirmed hardened (`pg_get_functiondef` check for `accessible_company_ids` on each).
Pushed via the session pooler (`aws-0-ap-northeast-1.pooler.supabase.com:5432`) using a DB password the
owner shared for this push only and will rotate afterward — not committed anywhere, used in an ephemeral
shell only, same pattern as the earlier P1C.1/P1D push. Note: `supabase_migrations.schema_migrations` on
the live project is still frozen at `20260710180000` (all pushes since have used direct psql, matching the
established pattern for this project — `supabase db push`/`link` cannot reach this project's account from
the current CLI login; see the git-ignored `supabase/.temp.STALE-LINK-TO-REPO-B-DO-NOT-USE/` marker).

**P1D.1 · HOTFIX, found immediately after the P1D push by a read-only post-deploy check.** The live
production owner role was found missing 2 permission keys (`position.manage`, `job_title.manage`) — both
added by P1D. Root cause: `seed_standard_roles()` never included `owner` in its backfill loop (owner's
permission set was assumed permanently complete from the one-time bootstrap grant, which is a snapshot —
any permission key added AFTER a company was bootstrapped never reaches that company's existing owner
role; a structural gap that will recur every time the catalog grows, not a one-off). Fix: backfills owner
to the full catalog immediately, and `seed_standard_roles()` now re-syncs owner on every call going
forward. Verified locally: fresh bootstrap gives owner 33/33 (was previously excluded from the loop
entirely). Migration: `supabase/migrations/20260712210000_p1d1_owner_permission_backfill_fix.sql`.

**P1E · Cross-tenant hardening on 7 pre-existing (weeks-old, pre-dating today's work) money/inventory
helper functions — owner-authorized investigation + fix 2026-07-12 ("look into it... and fix it").**
`pos_ensure_accounts`, `inventory_ensure_categories`, `inventory_ensure_accounts`, `payroll_ensure_accounts`,
`finance_resolve_pay_code`, and `pos_next_seq` are all `SECURITY DEFINER`, granted to `authenticated`, and
none verified the caller actually belongs to the target company — every call site in the app is safe (each
already passes a company the calling function independently validated), but each function is ALSO directly
callable via the public RPC endpoint, bypassing those upstream checks. Impact: the `*_ensure_*` functions
let a stranger silently pre-populate another company's chart-of-accounts/item-categories with boilerplate
rows (low severity — no money moves, and the target's own RLS still hides the rows from view, but a real
unauthorized cross-tenant write); `finance_resolve_pay_code` leaks a financial account's COA code string
to a caller who can produce a matching (company, branch, account) triple (an info leak, not a balance
leak); `pos_next_seq` lets a stranger burn/skip another company's invoice/order/journal sequence numbers
(a minor DoS-style annoyance, no data exposure — found by a follow-up systematic sweep of every
`SECURITY DEFINER` function taking a company parameter, done in the same spirit as the original finding;
that sweep also confirmed 6 report/statement functions — `trial_balance`, `income_statement_monthly`,
`balance_sheet`, `cash_flow_statement`, `customer_ar_standing`, `financial_account_balances` — already
check `has_permission` correctly, so this is NOT a wider pattern, just these 7 helper functions). Fix:
each now requires the caller to actually belong to the target company — pure defense-in-depth, verified
every legitimate call site is unaffected (each already passes an independently-validated company). Note:
this fix was authorized directly by the owner rather than through the full cross-vendor review process
this codebase normally requires for money-domain changes, given the narrow additive scope (a membership
check, no money-math or authz-model change) and time constraints — recorded here for the record. Guard:
`scripts/guards/cross-tenant-helper-hardening-security.sql` (10 assertions, proves both the cross-tenant
denial AND that legitimate same-tenant calls are unaffected — `npm run guard:cross-tenant`).
Migration: `supabase/migrations/20260712220000_p1e_cross_tenant_helper_hardening.sql`.

Full local suite after P1D.1 + P1E: **19 guard files / 236 assertions green** on a from-zero reset
(re-verified 2026-07-12 after the `pos_next_seq` addition — all 18 SQL guard files + static-guards pass,
schema-drift guard confirms the database matches migration history); tsc/vitest/build all clean.

**P1D · Payroll-role-link + managed positions + job_title (owner spec 2026-07-12, `payroll_role_link_prompt.md`) —
STATUS: APPLIED TO PRODUCTION 2026-07-12 (owner authorized with "push").**
Owner decisions recorded: Part 1 build now; Part 2 use the existing Invitations flow instead (safer, zero
new infra — see Launch_Runbook for the deferred full-bootstrap-credential spec, kept for later); Part 3
position/job_title management restricted to admin-tier and above.
- **Part 1 (role↔payroll link):** `assign_membership_with_payroll()` — the one governed entry point for
  approving a pending sign-up OR reassigning an existing member's role. For an eligible role (rank<40,
  i.e. below co_owner — data-driven, never a hardcoded role-name check per this repo's own static guard),
  it atomically creates+links a Farm Hand record (name/position/daily-rate, all admin-supplied — never
  auto-filled) or sets `payroll_exempt` — in the SAME transaction as the membership, so cancelling never
  leaves a half-changed state. Already-linked/exempt members and co_owner+/owner assignments skip the
  requirement entirely. A backfill banner (Approvals screen) surfaces pre-existing unlinked eligible
  accounts via `list_unlinked_payroll_eligible()` without blocking their access.
- **Part 3 (positions + job_title):** `positions` is now a real company-managed table (case/whitespace-
  insensitive dedup, deactivate-never-delete, existing Farm Hand records unaffected by deactivation) —
  `position.manage` (co_owner/owner only) to add/rename/deactivate, any member can select from it when
  hiring. `users.job_title` is a new, purely descriptive column, independent of payroll entirely,
  editable only by `job_title.manage` holders (admin-tier+, never self-editable — enforced by a trigger,
  since a plain RLS policy can't discriminate by column from the pre-existing self-update policy).
- **3 real bugs found and fixed WHILE building this** (all guarded, none shipped broken):
  (1) `employees.position` → `position_id` column swap silently dropped the INSERT/UPDATE grant Postgres
  never carries across `ADD COLUMN`/`DROP COLUMN` — would have broken the existing Hire Farm Hand flow
  entirely had it shipped; (2) a **pre-existing, not-introduced-today** latent bug in the M3 schema: `user_branch_roles`'
  unique constraint was unconditional (not scoped to Active rows), so NOBODY could ever be reassigned back
  to a role they previously held in the same branch — fixed with a partial unique index, which also fixed
  a second latent bug in `accept_invitation()` (silently no-op'd re-invites to a previously-held role,
  returning a fake success); (3) Postgres OR's all permissive RLS policies for the same command together,
  so the pre-existing self-update policy would have let a user edit their own `job_title` regardless of
  the new job_title.manage policy — closed with a trigger, since RLS can't discriminate by column alone.
- Guard: `scripts/guards/payroll-role-link-security.sql` (15 assertions, `npm run guard:payroll-link`).
  Full local suite: 17 guard files / 226 assertions green on a from-zero reset; tsc/92 vitest/build all
  clean. Migration: `supabase/migrations/20260712200000_p1d_payroll_role_link.sql`. **APPLIED TO
  PRODUCTION 2026-07-12.**

**SEC-P1C.1 · Privilege-escalation holes found in a same-day post-ship review of P1C (2026-07-12) —
STATUS: APPLIED TO PRODUCTION 2026-07-12 (owner authorized with "push").**
A self-review (4-lens code audit, adversarially cross-checked by hand after the automated verify pass hit
a session limit) found 2 CRITICAL and 1 real gap, all introduced by, or exposed by, the P1C migration
shipped earlier today:
1. `invite_user()` had no rank check — P1C hardened the DIRECT role-assignment path but never touched
   this PARALLEL path. A co_owner (holds `user.invite` by default) could invite anyone, including
   themselves under a second identity, directly into the Owner role. **Confirmed by direct code read.**
2. The self-management exemption on membership updates was too broad — it exempted ANY update to your
   OWN row from the rank check, not just "suspend yourself." Since rows are never hard-deleted (a
   demotion just flips the old row to Expired), a user who once held a higher role could reactivate
   their own old, dormant row and self-restore a rank they no longer hold. **Confirmed by direct
   re-derivation of the exact exploit sequence, independent of the (failed) automated verifier.**
3. `role_permissions_insert_manage` let a co_owner/owner stuff ANY permission into a low-rank role
   without checking they already hold that permission — a "harmless-looking" low-rank role could carry
   the full permission catalog if the actor chose to build it that way.
Fix migration `20260712180000_p1c1_privilege_escalation_fixes.sql`: rank-checks `invite_user()`, narrows
the self-exemption to only the Active→Expired transition (self-suspend still works, tested), requires the
actor already hold a permission before adding it to a role, and closes an unrelated hardening gap
(`pos_next_seq` had no revoke/grant statement at all, defaulting to PostgreSQL's public-execute grant —
callable pre-auth via the anon key). All 4 fixes guarded (5 new assertions in
`approvals-roles-security.sql`, now 26/26); full local suite 17 guard files / 231 assertions green;
tsc/vitest/build green. **APPLIED TO PRODUCTION 2026-07-12.**

Same review also found, fixed, and verified 4 real app-code bugs (no DB push needed, app-code only):
per-user permission overrides weren't reflected in the client's own permission cache (a granted override
was invisible in the UI even though the server honored it); the "YOU" self-detection / self-action-hiding
in Approvals had no error handling and never retried; two Supabase calls in Approvals had no `.catch()`
(unhandled rejections on a transient failure); the Approvals role-rank comparison used a hardcoded,
driftable role-name table instead of the real `roles.rank` column that already exists.

**Found, NOT fixed, flagged for owner decision — pre-existing, MONEY/INVENTORY-domain, older than P1C
(weeks-old code, already live):** several `SECURITY DEFINER` helper functions (`pos_ensure_accounts`,
`inventory_ensure_categories`, `inventory_ensure_accounts` ×2, `payroll_ensure_accounts`,
`finance_resolve_pay_code`) are granted to `authenticated` but never check the caller actually belongs to
the `company_id` they pass in — an authenticated user of Company A who knew/guessed Company B's ID could
potentially reach these. This is money-adjacent code, which this project's own rules gate behind explicit
owner sign-off before anyone touches it — flagged here rather than patched unilaterally. Not yet
independently re-verified beyond the original finder's report; needs a dedicated look before any fix.

**CAL-1 · Calendar (owner, 2026-07-06):** flagged for a **full DayFlow implementation**. Specific reports/requirements:
1. **Event visibility across views** — created events reported as not appearing correctly in Day/Week (all-day/untimed
   events currently only surface strongly in Month; they show as a strip/dot in Day/Week). Must appear correctly in
   all views. → **RESOLVED**: Day and Week now render an **all-day row** of clickable chips for untimed events (not
   just Month). Browser-verified: a created all-day event appears in both Day and Week; a timed event renders as a
   positioned block in both.
2. **Cross-day drag-and-drop** — Week view currently moves events only within their own day column; must support
   dragging an event to a different day. → **RESOLVED**: `TimedBlock` measures day-column width → horizontal drag =
   day shift; `api.setTime` gains an optional `event_date`. Browser-verified: a block dragged Mon→Tue persisted
   `event_date` 2026-07-06→07-07 with times preserved. Guard-verified: only `schedule.manage` can move across days
   (owner allowed+audited; read-only worker denied → 0 rows).
3. **Data↔UI sync sweep** — general review for state/UI desync in the calendar. → **ADDRESSED**: reload-after-write on
   every mutation (create/edit/retime/resize/move/status/delete); drag commit reads authoritative state from a ref at
   pointer-up (fixes fast-gesture race). Found+fixed a real bug: read-only users could not open a **timed** block's
   detail at all (`begin()` no-ops without `canManage`, so the tap never reached `onSelect`) — a native `onClick` now
   opens the read-only detail.
4. **Per-block RBAC** — visibility AND CRUD gated by role. → **RESOLVED**: click any block/chip → **detail panel**
   (Read). `schedule.manage` holders get **Edit** (→ modal, api.updateEvent = Update), **Mark done↔Reopen**, and
   **Delete**. Users with only `schedule.read` see the same details but **"View only"** — no New Event button, no
   Management filter (that needs `schedule.read_private`), no edit controls, no drag. Server RLS is the real gate
   (guard scheduling 15); the UI mirrors it. Browser-verified both roles.
_Resolution status: **RESOLVED 2026-07-06** (commit `69a62be`, pushed). All four items verified by browser E2E +
the scheduling guard battery (15/15). Calendar moved to **Done (pushed)**._

---

## 4. Maintenance log (append-only — do not delete history)

- **2026-07-06** — File created. Ground truth re-verified first-hand (22-migration clean reset; 12 guard batteries
  162/0; 89/89 unit; build ok; CI green on feature branch). Recorded the branch reality (feature branch only, not
  main) and the mock-mode caveat. Calendar set **In Progress** due to owner-flagged open issues (CAL-1). All other
  listed features marked Done (pushed) with explicit verification evidence per row.
  _Note: an adversarial per-feature audit workflow was launched but was stopped before completing (no results); this
  file was synthesized from the lead agent's direct, first-hand verification instead._
- **2026-07-06** — **Calendar Year view added** (commit `80b8042`) — completes DayFlow's Year/Month/Week/Day view
  set. 12 mini-months at a glance, event days highlighted, click day → Day view / month → Month view, prev/next by
  year; the farm's seasonal planting/harvest overview. RBAC-safe (reuses the tier/RLS-filtered `eventsByDay`; shows
  only event presence, no titles/CRUD). Verified: tsc · 89/89 · build · browser E2E (12 months, day→Day, month→Month,
  Next→2027). Calendar stays Done (enhancement within the shipped feature).
- **2026-07-06** — **Calendar day-list rows now open the shared detail panel** (commit `0752d3f`). DayFlow-parity
  follow-up: the detail panel was reachable only from Day/Week blocks, so in **Month view** (where the day-list is
  the only event surface) a manager couldn't Edit an event and read-only users couldn't open a detail. Each day-list
  row is now a button → same detail panel (role-gated CRUD); removed the redundant inline Done/Delete. One consistent
  interaction across Month/Week/Day. Verified: tsc · 89/89 · build · browser E2E (Month row → detail → Edit → Save
  persisted in day-list + Dexie). Calendar stays Done (this is an enhancement within the shipped feature).
- **2026-07-06** — **Calendar moved In Progress → Done (pushed)** (commit `69a62be`). Full DayFlow implementation
  resolving CAL-1 (all 4 items): cross-day drag (persisted event_date move, times preserved), all-day rows in Day +
  Week, event detail panel with manager CRUD (edit/complete/delete) and read-only "View only", per-role gating.
  Found+fixed a bug where read-only users couldn't open a timed block's detail. Added 2 behavioral guard tests
  (cross-day move: manage=allowed+audited, read-only=denied) → scheduling battery 13→15, total 162→164. Verified
  first-hand: tsc clean · 89/89 unit · build ok · scheduling guard 15/15 · browser E2E of every flow for both an
  owner and a (temporarily seeded, then reverted) read-only role · CI green on `69a62be`.
- **2026-07-07** — No code changed; HEAD advanced `f2ecbda` → `81caea2` on **documentation-only** commits
  (cross-vendor money-path review + CAP-VG1 VeggieGenius design spec + handoff §9). Re-verified first-hand
  at `81caea2`: tsc clean · 89/89 vitest · all 8 roadmap core modules remain feature-complete; no feature
  row in §2 changed. Two commits are **local-only** (not pushed — owner gate per CLAUDE.md §3); `.codegraph/`
  and `graphify-out/` are now gitignored (generated, not source). The new docs surface two owner-gated
  tracks for the owner: (a) sign off `Phase_2_Cross_Vendor_Money_Path_Review.md` §9 to lock
  M2E/M2C/M4A/M5A and unblock B2; (b) give D1 GO on `CAP_VG1_VeggieGenius_AI_Copilot_Spec.md` to start
  VeggieGenius steps 1–4 (local-only, no money/cloud crossing). No feature work was started without owner GO.
- **2026-07-07 (later)** — Two things. (1) **Calendar edit hardening** (`a327cc9`, pushed): self-review of the
  DayFlow work found `submit()`'s edit branch showed "Event updated" even when `events.find()` missed (a false
  success on a no-op write); now throws → error toast, modal stays. Practically unreachable, but a write must not
  claim success while doing nothing. tsc · 89/89 · build green; happy path unchanged (already browser-verified).
  (2) **Reconciled this file to reality after the parallel GLM session pushed:** the 2026-07-07 doc commits
  (`52f659d`/`81caea2`/`9f97ce6`) that the entry above called "local-only" are **now pushed**; my fix rebased
  cleanly on top; HEAD is `a327cc9`, **in sync with origin** (corrected the header + the 179→190 ahead-count).
  Read the delivered money-path review: **all four paths GO ("lock eligible"), zero NO-GO** — but §9 owner
  sign-off is unchecked and B2 stays gated ("do not invert"), so **no money-path or B2 code was started.** The
  DayFlow calendar is feature-complete (4 views + drag/resize + all-day + universal detail CRUD + RBAC + keyboard).
- **2026-07-08** — Session start inspection only; **no feature code changed.** Re-verified first-hand: tsc clean ·
  89/89 vitest. Working tree was clean except an untracked `.tmp_capture/` directory (browser-probe artifacts from
  the prior GLM session's ChatGPT-share-link retrieval attempt — `blob.json`, `share.html`, `probe_*.txt`,
  `render.mjs`, ~6 MB; session-local, not source). Added `.tmp_capture/` to `.gitignore` alongside the existing
  `.codegraph/` + `graphify-out/` precedent (generated-output pattern). **No feature row in §2 changed; no gate
  advanced.** Confirmed the buildable non-owner-gated backlog remains exhausted — all remaining tracks (money-path
  §9 sign-off, B2, Supabase+hosting, Play packaging, CAP-VG1) require an explicit owner GO per charter §4 and this
  file's §2. The owner-decision menu was surfaced via clarify; no response in time, so no gated work was started.
- **2026-07-08 (later)** — Three doc-only commits, all pushed to origin (`c89599a` and `3bb498b`).
  Captured 3 verbatim ChatGPT share transcripts (PEGASUS/PIE design 31,161 lines · Architecture
  Migration 26,496 lines · ERP Stack V1 18,777 lines) in `source_chats/` via direct GET to
  `chatgpt.com/backend-api/share/...` (no summary, no interpretation, no redaction). Produced
  `AI_Feature_Cross_Audit_and_PEGASUS_Reconciliation.md` (179 lines): the PEGASUS/PIE/ARB/ACR
  vocabulary is **mostly DUPLICATE** of System 23 + CAP-VG1 + handoff + STATUS + charter, with
  **5 CONFLICTS rows** all resolved in favor of the repo's existing authority chain per
  `CLAUDE.md §0`; recommendation **(a) keep CAP-VG1 as-is**, (b)/(c) rejected. Then produced
  `Phase_2_Owner_Decision_Package.md` consolidating all 5 owner-gated tracks into one
  decision-ready + audit-ready artifact (money-path §9 · CAP-VG1 D1–D4 · Supabase+hosting ·
  branch protection · Play Console). **No feature code changed; no gate advanced; no other
  file modified.** All 5 gates still pending owner GO. The handoff §11 records the same. Tip
  `3bb498b` == origin (in sync); no CI run for the new tip yet (owner to paste Actions URL).
- **2026-07-08 (final)** — Pushed `d2fcd6b` (the decision-package commit) to origin; tip now
  in sync. Appended handoff §12 — a copy-paste-ready "Owner Authorization Prompts" cheat sheet
  for each of the 5 tracks plus a CI-audit prompt, so the next session can act on a one-line
  owner message without re-explanation. No feature code changed; no gate advanced; all 5 gates
  still pending owner GO. The decision package + cheat sheet together are the complete landing
  artifact for the next session. **CI for `c89599a` / `3bb498b` / `d2fcd6b` not yet audited** —
  no Actions URL pasted; if/when the owner pastes one, audit against handoff §5 and append a
  matching entry here.
- **2026-07-08 (Track A sign-off recorded)** — Owner pasted the §12 Track A prompt verbatim
  (handoff §12 verbatim quote). All 5 §9 boxes in `Phase_2_Cross_Vendor_Money_Path_Review.md`
  are now ticked (M2E / M2C / M4A / M5A / B2). The §3.4 fresh-cloud-launch notice is confirmed:
  green-field Supabase deployment (cloud project `jabjyvdkadcbfocaerno`, remote schema
  currently EMPTY per handoff §4); no prior-period data, so the OPERATING_EXPENSES
  reclassification has no historical tail. Added `Phase_2_Cross_Vendor_Money_Path_Review.md §10`
  as the append-only authorization record. Added handoff §13 documenting the same. The
  §12 prompt's first action item ("push the local-only commits") is a no-op — local HEAD
  `d256b80` is in sync with origin (ahead 0, behind 0) and the same SHA is on repo B
  per the 2026-07-08 push task. **The §12 prompt's remaining action items (`supabase db push`
  + B2 implementation start) are QUEUED for the next session that has Docker Desktop + the
  supabase CLI + the cloud project credentials** — this terminal is git-only and cannot run
  them. No money-path code touched, no migration modified, no guard added. Track A's
  "lock and push" boxes are now ticked; the lock itself is the `db push` + the B2 build
  (queued). **No feature row in §2 changed** — M2E / M2C / M4A / M5A are still "Done (pushed)
  — pre-lock" pending the queued deploy; B2 is still "Not started (Blocked)" because the
  build itself is queued. The `db push` and B2 implementation are exactly the two remaining
  Track A deliverables per handoff §13; the §13 record names the queued-work list verbatim.
- **2026-07-08 (Tracks B / C / D / E sign-offs recorded)** — Owner pasted the §12 B/C/D/E
  prompts verbatim in one message (explicit "Authorize all four" confirm-menu choice). All
  four tracks are now in the "SIGN-OFF RECORDED, BUILD QUEUED" state — same posture as
  Track A: the documentation record is on both remotes, the actual build/deploy work is
  queued for the next environment-capable session. **Track B (CAP-VG1):** D1 GO, D2 model
  TBD by owner, D3 RAG corpus = `docs/28_Enterprise_Architecture_Audit/**/*.md`, D4 = C7 §7
  default; spec §10 added; build steps 1–4 + 5 guards queued. **Track C (Supabase+hosting):**
  §12 prompt pasted with `[channel: ...]` and `[Vercel / Netlify / Cloudflare]` placeholders
  TBD by owner; queued-work list is the §13 sequence (re-run 164-guard battery, `supabase db
  push`, real-cloud E2E of POS→accounting→AR, STATUS.md §1 update). **Track D (branch
  protection):** §12 prompt pasted; click-path §7 added; **F2 fix landed in this same
  commit** (4 URL references in the click-path swapped from `pick-ur-veggie-farm` to
  `pickurveggieERPfarm-GLM-version`); apply is queued (17 steps + owner smoke test +
  agent audit by screenshot or PAT). The Temporary Solo-Founder Enforcement Exception
  (source spec §49–76) terminates the moment real protection is verified, per source
  spec §74. **Track E (Play Console):** §12 prompt pasted with `[email]` placeholder TBD
  by owner; Track C prerequisite confirmed; PNG icons + Bubblewrap + assetlinks + AAB
  queued (gated on Track C). **Zero code lines changed** — append-only doc updates only.
  No feature row in §2 changed. Handoff §14 added as the consolidated session log for
  all four tracks; this STATUS entry is the matching append-only maintenance log row.
  The `XXXXXXX` placeholders in the pre-`be1243d` commit (handoff §14 title + this STATUS header) were folded into `be1243d` (the first commit of the §14 record), then the XXXXXXX self-reference line was re-folded into `da1db9a`, and then the `_Last updated` + `be1243d` references were re-folded into `52e04ea`. The current tip is `52e04ea` on both repo A and repo B. This STATUS entry is the matching append-only maintenance log row for that fold chain.
- **2026-07-11 (infra + onboarding + Team-B system, Fable 5)** — Owner deleted the shared Vercel project
  (creating a Team-A-only account); old URL now 404, stale `.vercel/` link removed. **Branch protection NOT YET applied
  on Repo A** — owner chose "make public", but the 1-day PAT lacked *Administration:write* so the agent could
  set neither the visibility nor the ruleset. Exact settings staged in `Phase_7_Branch_Protection_RepoA.md`;
  owner applies via 2 clicks (make public → new ruleset) or re-issues a PAT with Administration:write. Repo B's
  ruleset confirmed already Active (id 18794543). Tracked files ARE secret-clean (verified `git grep` — anon key
  not even committed). **Onboarding for all future models:**
  new root `AGENTS.md` (model-agnostic: ChatGPT 5.6 / Opus 4.8 / Sonnet 5) + `Launch_Runbook.md` (ordered path to
  launch + post-launch duties + the P1C bug-fix spec + the advisor cost pattern). **Team-B handoff SYSTEM
  established** (standing owner order, now in CLAUDE.md §8): `docs/handoffs-for-team-b/` with a README index, a
  scanning prompt, handoff 001 (their doc-fold spiral + Bubblewrap `app/` collision + discipline fixes), and
  handoff 002 (the 7 P1C Approvals/Roles bugs — incl. the Dexie-only-override SECURITY LEAK they likely share).
  **App fixes shipped (verified tsc/92 tests/build):** removed the top-bar Sign-Out (Settings-only now);
  AwaitingApproval now auto-polls `refresh()` every 15s + on focus so an approved user enters the app with no
  manual reload. Cloud DB password rotated by owner (old one 400s) → the P1C **DB** work (5-role seed, server-
  enforced per-user permission overrides, rank-based revoke, signup→queue fix) is spec'd in the runbook §2 and
  awaits the local-stack window + the new password to build+guard+push. **Not deployed yet — new Vercel account
  pending (owner).**
- **2026-07-10 (HOSTED, Fable 5)** — **The app is LIVE on the web: https://pick-ur-veggie-farm.vercel.app**
  (owner chose Vercel + authorized the deploy; CLI was already authenticated as his account). `vercel.json`
  (SPA rewrites, SW no-cache, immutable assets) committed (`5f8e290`); production env = ONLY the public
  VITE_SUPABASE_URL + anon key (C2 §7). Verified live: root/login/manifest/sw all 200; SPA fallback works;
  hosted login reaches cloud auth (rejected with "invalid credentials" because the owner had completed the
  reset email and rotated his password — the wiring itself is proven). Deploys are CLI-driven
  (`npx vercel deploy --prod`) — Git auto-deploy deliberately NOT connected (Vercel's default production
  branch would ship the stale `main`). Owner unblocked on Google OAuth: JS origins =
  `https://pick-ur-veggie-farm.vercel.app` + `http://localhost:3000`; redirect URI =
  `https://aqhxhamdwmhcwxmebqbo.supabase.co/auth/v1/callback`. ⚠ Owner must also set Supabase Auth → URL
  Configuration: Site URL = the vercel.app domain + add `https://pick-ur-veggie-farm.vercel.app/**` to the
  redirect allow-list (reset emails/OAuth land on the hosted domain). Track E (Play packaging) is now unblocked.
- **2026-07-10 (four-step directive, Fable 5)** — Owner ordered all four next-steps at once. **① Security
  follow-ups:** E2E tester **SUSPENDED on the cloud** (owner named the write; verified `Suspended`) and a
  password-reset email triggered to the owner's inbox (HTTP 200 — owner verifies delivery + may complete it,
  recommended since his password appeared in chat). Dashboard-only leftovers: rotate DB password, enable Google
  provider, MFA toggle. **② B2A lock-review package** shipped (`Phase_2_B2A_Lock_Review_Request.md` — 8-claim
  attack brief + paste-ready GLM prompt). **③ CAP-VG1 steps 1–4 BUILT** (`21ab385` — see the new §2 row; guard
  copilot-degrade 4/4 vs the live cloud; 92/92 unit; live browser E2E incl. offline-degrade; `chatRole` naming
  lesson ported from Repo B under the collab lane). **④ Hosting decision-pack** shipped
  (`Phase_7_Hosting_Decision_Pack.md`; recommendation Cloudflare Pages — MNL edge; owner picks one word).
- **2026-07-10 (post-completion AUDIT + Phase-2 verdict, Fable 5)** — Owner-ordered review of Phase 1 before
  advancing. **All evidence green:** CI success on every session commit incl. the fix (`14a493e`) and docs tip
  (`d08b60a`); tree clean, in sync; **clean reset + all 14 guard batteries = 182 PASS / 0 DEFECT; static + drift
  guards PASS** (one transient drift false-alarm in a batch loop — direct rerun authoritative). C8 §4 Phase-1 exit
  criteria checked item-by-item: all met. **Phase 2 (C8 §5 Core Master Data) gap-checked: 11/11 master-data tables
  already exist** from the operational build (tenant-owned, RLS-forced, permission-gated, audited); two RECORDED
  deferrals stand (supplier/AP master — cash-only purchases, YAGNI; UOM master — units are fields, conversion
  deferred per M3 spec). **Verdict: Phase 1 complete · Phase 2 already satisfied → the true frontier is Phase 7
  (production readiness).** `Master_Execution_Roadmap.md` reconciled to reality (was frozen at Phase 0 since
  2026-06-22). **Collaboration model recorded** (owner, verbatim in memory): repos write-own-only, scan freely,
  ports only with owner authorization; Repo B scan shows they recovered their tree, adopted the discipline skill,
  and ported our Phase-1 docs + vitest safety fix. **Still open (owner-only, twice classifier-blocked for me):
  suspend/revoke `pickurveggie.e2e.tester@gmail.com`** — owner-role membership with a chat-known password.
- **2026-07-10 (Phase 1 complete)** — **AUTH MODULE SHIPPED + THE APP WENT LIVE ON THE CLOUD (Fable 5).**
  Commits `e852c93` (P1A: signup trigger → approval queue, reset page, admin recovery, OAuth scaffold, break-glass
  runbook; guard auth 7/7, full suite 182/0; 12 guard fixtures patched for the trigger via a transaction-local GUC
  escape that can only WITHHOLD, never grant; CI green) + `9a79545` (P1B: split-panel login w/ role-request, OTP
  password change, approvals hydration fix — **CI RED**: the no-float static guard matched the word "real" in a
  function COMMENT string) + `14a493e` (fix: comment reworded — a DISCLOSED comment-only edit to the minutes-old
  P1B migration, schema identical; weakening the C6 guard would have been worse). Cloud: 25 migrations live; tenant bootstrapped (Pick Ur Veggie Farm / Main
  Farm / owner = full catalog); owner credentials set at his request; **first real POS sale on the cloud:
  invoice #1 ₱270 Paid, journal Dr CASH 270 / Cr SALES 270 + Dr COGS 120 / Cr FG 120 — balanced, stock 50→48
  derived**; full signup→approve→access loop proven live. **Bugs found by going live:** (a) unit tests were firing
  at the production cloud once `.env` existed — vitest now forces mock (safety fix); (b) approve dialog empty on
  fresh devices (cache hydration) — fixed; (c) manual auth users need non-NULL token columns (GoTrue scanner) —
  operator-noted in the runbook. **Open (owner):** suspend the E2E test account (`pickurveggie.e2e.tester@gmail.com`
  — holds an owner-role membership w/ a known password; classifier blocked my production write); smoke-test
  reset-email + OTP delivery to a real inbox; enable Google provider; enable MFA when ready; rotate the DB password
  (his stated plan now that Phase 1 is done).
- **2026-07-10 (later)** — **B2A digital payments BUILT + Repo A cloud schema LIVE (Fable 5).** (1) **B2A** (commit
  `4662411`, CI green): migration `20260710090000_p2b2a` + payments guard 11/11 + full suite **175 PASS / 0** after
  clean reset + app layer (paymentsApi, POS picker, Cash & Accounts tab) + browser E2E (GCash sale ₱270 → account on
  invoice + derived balance; transfer ₱100 zero-net). Authorized by review §9 (B2 APPROVED); **pre-lock** — B2's own
  cross-vendor review still required (spec §6c). (2) **Cloud**: owner created Supabase project `aqhxhamdwmhcwxmebqbo`
  (ap-northeast-1); all 23 migrations pushed via session pooler (direct host is IPv6-only; region identified from the
  AWS prefix); verified live: **41 tables / 41 RLS-forced / 23 migrations**, anon REST probes → 42501 on every real
  table. `.env` (gitignored) wired with URL + anon key + `VITE_USE_MOCK=true` (app stays on mock until cloud auth
  users exist — the Phase-1/auth session flips it). **No secret committed anywhere** (DB password used in ephemeral
  shell only). (3) Owner-requested **engineering-discipline skill for GLM/MiniMax written into Repo B**
  (`.claude/skills/engineering-discipline/SKILL.md`, untracked — their session commits it after tree recovery).
- **2026-07-10** — **Two-repo reality recorded + discipline-transfer skill shipped (Fable 5).** Owner disclosed
  the fork; verified against git: Repo B (`pickurveggieERPfarm-GLM-version`, GLM 5.2 + MiniMax M3, forked from
  `8e1f064`, **owns the original Supabase project `jabjyvdkadcbfocaerno`**) vs this Repo A (Claude models; fresh
  Supabase to be owner-created). Work boundary (owner, 2026-07-08–09): GLM/MiniMax → Repo B only; Claude → Repo A
  only. §0 updated. **Sign-off provenance clarified during rebase:** the 2026-07-08 Track A–E sign-off entries
  above were pushed to BOTH repos while they still moved in lockstep, so **Repo A's review-doc §9 boxes ARE
  ticked** — but Track A's queued deploy targets (`db push` to `jabjyvdkadcbfocaerno`) now belong to Repo B; for
  Repo A the deploy re-targets the NEW owner-created project, and per the owner's 2026-07-10 instruction Repo A's
  sequence is **new Supabase → Phase-1/auth completion → then B2** (matching the review's own locks→push→B2 order).
  Read-only scan of Repo B (26 commits past fork): CAP-VG1 steps 1–5 built there with our Engineering-Loop
  discipline (5 copilot guards, Edge Function, migration); ⚠ their working tree has the entire React `app/`
  deleted-uncommitted after a Bubblewrap/TWA scaffold was generated at repo root (recoverable via git restore;
  flagged to owner — one `git add -A` from committed destruction). Built here: **`.claude/skills/think-like-fable/
  SKILL.md`** (stance / session ritual / Engineering Loop / bug-catching patterns with the real bugs each caught /
  repo commands / gates incl. repo boundary / anti-patterns) + CLAUDE.md §8 pointer + handoff §15. Docs/skill only
  — no app code, no migrations, no feature-row changes.
- **2026-07-13 (P1D.1 + P1E pushed; Google OAuth wired + a real bug found+fixed+deployed; owner Phase-7
  dashboard steps completed, Sonnet 5)** — (1) **Re-verified P1D.1 + P1E locally** (full 18-guard SQL
  battery + static + drift, 236 assertions, all green) after resuming from a context reset, then
  **pushed both to production** on the owner's explicit "push P1D.1 and P1E." Hit and resolved two real
  infra obstacles first: the CLI's authenticated Supabase account could only see Repo B's project (not
  Repo A's `aqhxhamdwmhcwxmebqbo`) — confirmed via a failed `supabase link` — so pushed via direct psql
  over the session pooler instead (owner-shared DB password, ephemeral use, rotated after); Docker
  Desktop had stopped mid-session and was relaunched. Verified live post-push: owner role now holds
  `position.manage`/`job_title.manage`; all 7 P1E functions confirmed hardened via
  `pg_get_functiondef`. STATUS.md's P1C.1/P1D/SEC-P1C.1 write-ups (stale "not yet applied" language left
  over from before those were actually pushed in an earlier session) corrected to match reality.
  (2) **Analyzed the Master Execution Roadmap + Launch Runbook against actual code**, per owner request,
  to find what of Phase 7 is genuinely buildable vs owner-only/external-reviewer-gated. Verdict: almost
  everything left is owner dashboard actions (Supabase URL config, Google OAuth, MFA, DB password
  rotation) or needs an outside reviewer (B2A lock) or an owner infra decision (Play Store, backups) —
  reported this honestly rather than claiming buildable progress that doesn't exist. Owner chose to be
  walked through the dashboard steps. (3) **Owner completed all 4 steps; Google sign-in initially failed**
  (picked an account, bounced back to login with no error). Root-caused it live: `detectSessionInUrl:
  false` in `app/core/supabase/client.ts` was silently discarding the `?code=` Google's redirect carries,
  so no session was ever established from it — the same bug would have broken password-reset email links
  on their first real use (never tested with a real inbox before now). Fixed (`detectSessionInUrl:
  true` — confirmed no collision with `/accept?token=…`, which uses its own param name). Verified: tsc
  clean, 92/92 vitest, local browser check (bad/fake `?code=` degrades to login with no crash). **Deployed
  to production** via `npx vercel deploy --prod` (owner authorized; logged in via the CLI's device-code
  flow so no password was ever shared) — **owner then completed a real Google sign-in on the live site
  and confirmed it works.** Updated Launch_Runbook.md §1 (items 3–6 now done) and STATUS.md's MFA row.
  No DB migration, no guard changes — pure app-code fix. Full local suite untouched/still green from (1).
- **2026-07-13 (owner-found live bugs during the money-spine test; Reject + Archive built, Sonnet 5)** —
  Owner tried to grant the throwaway E2E test account Admin via Approvals and hit two real production bugs,
  found by genuine live use (not by any automated sweep). **Bug A — reassign-to-paid-role silently failed:**
  `openReassign()`'s decision to show the payroll dialog was gated on `list_unlinked_payroll_eligible()`,
  which only tracks members whose CURRENT role is already payroll-eligible — moving someone INTO a paid
  role for the first time (exactly what reassigning to Admin does) skipped the dialog entirely and
  committed with `exempt` hardcoded `false` and no payroll fields, guaranteeing the server's own "payroll
  setup required" rejection with no way for the approver to ever supply the missing info or opt out. Fixed:
  the dialog now opens whenever the TARGET role is payroll-eligible, full stop — the server already no-ops
  the payroll block harmlessly for an already-linked member, so this is safe in every case, not just the
  one that broke. **Bug B — "invalid input syntax for type uuid" on Co-Owner approval:** for a
  non-payroll-eligible role (co_owner/owner) the Position field never renders, so `positionId` stayed at
  its initial `''` rather than `undefined` — `?? null` doesn't catch an empty string, so a literal `''`
  reached a `uuid`-typed RPC parameter and Postgres refused the cast. Fixed: `input.positionId || null`
  (catches both). Both fixes verified: tsc, 92/92 vitest, local browser smoke check.
  Owner then asked for two new pieces, plus one thing explicitly **declined**: hard-delete of revoked
  accounts, a reject action for pending sign-ups, and a distinct rejection screen for someone turned away
  — but when told hard-delete conflicts with `public.users`' own founding-migration comment ("Deactivate
  via account_status; never hard-delete") and that literally every table added since references
  `public.users(id) on delete restrict`, the owner chose an **Archive** state instead of true deletion.
  **P1F — reject a pending signup** (`supabase/migrations/20260713090000_p1f_reject_pending_signups.sql`):
  `reject_pending_user()` (membership.manage-gated, only reachable while the target is still genuinely
  pending, sets `account_status → Suspended`, audited) + `my_account_status()` (self-only status read —
  needed because `current_app_user_id()` resolves NULL for "still pending" and "rejected" alike by design,
  B1 §3, so the client had no way to tell them apart). App: a **Reject** button next to **Review & approve**
  in the pending queue (with a confirm dialog); `AwaitingApproval` now branches on `my_account_status()` —
  Suspended shows a distinct "Registration not approved" screen instead of the old "hang tight" message,
  which would otherwise have told a rejected person to keep waiting forever.
  **P1G — archive a revoked account**
  (`supabase/migrations/20260713100000_p1g_archive_revoked_accounts.sql`): widens `account_status`'s CHECK
  constraint to add `'Archived'` (no RLS/resolver change needed — every access check gates positively on
  `= 'Active'`, so Archived is already blocked identically to Suspended everywhere). `archive_user_account()`
  requires the target already hold zero active memberships anywhere (revoke first, archive second — not a
  shortcut around the rank-checked revoke path); `unarchive_user_account()` reverses it. Both
  membership.manage-gated, audited. App: revoked (Expired) rows in the Active Users Directory get an
  **Archive** button alongside Reactivate; archived accounts drop out of the table by default behind a
  "Show archived (N)" toggle, with an **Unarchive** action when revealed.
  **Hit a real environment wall mid-session:** the local test database couldn't start — Windows had
  reserved its port for something else (`ports are not available ... forbidden by its access permissions`),
  needing an admin-elevated `net stop winnat && net start winnat` to clear (three non-privileged workarounds
  tried first — Docker Desktop restart, `wsl --shutdown`, retry — none worked; this genuinely needed admin
  rights this session didn't have). Owner ran the fix themselves. **Also found and fixed a bug in my OWN
  new guard tests while re-verifying**: a `set local role authenticated` from a prior test block leaked
  into a later bare `insert into auth.users` statement (transaction-scoped `SET LOCAL` persists across `do
  $$ $$` blocks in the same transaction) — two blocks were missing their `set local role postgres;` reset;
  fixed by adding it back, matching the pattern every other block in the file already follows.
  **Full verification once the port issue cleared:** `supabase db reset` from zero (20 migrations) clean;
  all **18 SQL guard files / 246 assertions green** (auth-lifecycle grew 7→16 with the new P1F/P1G checks:
  permission-denied paths, the "must revoke before archive" rule, audit trail, double-reject/double-archive
  refusal, and the resolver flipping correctly in both directions); static-guards + schema-drift both PASS;
  tsc clean; 92/92 vitest; build clean. **APPLIED TO PRODUCTION 2026-07-13** (owner confirmed explicitly,
  shared a fresh DB password — the prior one was rotated after P1D.1/P1E as planned). Verified live: all 4
  new functions exist (`archive_user_account`, `my_account_status`, `reject_pending_user`,
  `unarchive_user_account`) and the widened `users_account_status_check` constraint is in place. **App code
  (both bug fixes + the Reject/Rejection-screen/Archive UI) deployed to production** via
  `npx vercel deploy --prod`; live smoke check clean (no console errors on the hosted login page).
- **2026-07-13 (later — owner live-tested Employee/Operator; nav leaked ungranted sections + POS/Inventory
  hung, Sonnet 5)** — Owner signed in as Employee for the first time and found: (1) every top-level nav
  item (Inventory, Accounting, Customers, Approvals & Roles, ...) was always visible regardless of role —
  clicking into one you can't use showing "access needed" is fine per the owner, but a nav item for a
  section you can NEVER use shouldn't appear at all; (2) POS and Inventory never finished loading for
  Employee; (3) Employee had zero Calendar/Schedule access, unlike Operator.
  **Root cause of (2), found by a dedicated Explore-agent investigation and independently confirmed by
  hand:** `PosScreen.tsx`/`InventoryScreen.tsx` derive their default branch purely from the LOCAL Dexie
  `branches` cache (`useLiveQuery`) — nothing hydrates that cache from Supabase on login; it's only ever
  warmed as a side effect of visiting `/organization/branches` (ungated by permission) or `ApprovalsScreen`
  (gated behind `membership.read`, which ApprovalsScreen itself already had to work around live once
  before, 2026-07-10). A role scoped to `pos.sell` only has no product reason to ever visit either, so on
  a fresh device the cache is *permanently* empty, the branch-picker effect never fires, `reload()`'s
  `if (!companyId || !branchId) return;` guard never clears, and `products`/`items` stay `null` forever —
  an indefinite `<Skeleton>`, not an RLS denial (every relevant SELECT policy is member-open, not
  permission-gated — confirmed by reading each one). **Fix:** extracted the ad hoc hydration snippet
  ApprovalsScreen already had into a shared `app/core/offline/hydrate.ts` (`hydrateBranches(companyId)`)
  and call it from `PosScreen`, `InventoryScreen`, `Dashboard` (same latent gap, lower severity — silently
  wrong zeros instead of a hang), and `ApprovalsScreen` itself (deduplicated). **Also found (by the same
  investigation) that InventoryScreen never had the top-level "access needed" gate every comparable screen
  uses** (Accounting/Customers/Schedules/Projects/POS all have one) — added it, so Employee now sees a
  clean denial instead of the same indefinite spinner even once the branch-cache bug is fixed.
  **Nav visibility (1):** `AppShell.tsx`'s `CORE_MODULES`/`ALL_NAV` rendered unconditionally; added a
  `perms` (any-of) field per item and a `visibleNav()` filter applied in both `NavRail` (desktop) and
  `MobileNav` (bottom bar + "All sections" sheet). Payroll/Operations/Reports/Copilot/Settings stay
  unconditional by design (Payroll has the M5C self-view for everyone regardless of `payroll.read`;
  Operations' Crops tab is member-readable; Reports is a placeholder; Copilot is informational-tier per
  CAP-VG1 §1). "Approvals & Roles" now only shows if the caller holds ANY org-related permission.
  **Calendar access (3)** — `supabase/migrations/20260713110000_p1h_employee_calendar_access.sql`: adds
  `schedule.read` to Employee's permission array in `seed_standard_roles()` (matching Operator's existing
  baseline) plus an immediate backfill for any company's existing employee role.
  **Verified end-to-end, not just compiled:** tsc clean, 92/92 vitest, full clean-reset guard battery
  still 18 files / 246 assertions green (P1H is purely additive, no fixture depended on Employee having
  zero schedule access). Then a REAL browser session against a real local Postgres (not mock, not
  production): signed up a fresh account, approved it as Employee via direct SQL, logged in — nav showed
  exactly Dashboard/POS/Payroll/Operations/Reports/Copilot/Settings (Inventory/Accounting/Customers/
  Approvals & Roles correctly absent); POS loaded instantly with the branch pre-selected (previously would
  have hung indefinitely); Calendar rendered the full Month/Week/Day UI with the tiered "General (everyone
  sees)" filter; Inventory showed the new clean "Inventory access needed" card. Zero console errors
  throughout. **NOT yet applied to production / not yet deployed** — P1H (the one DB migration in this
  batch) awaits the owner's explicit push confirmation; the app-code changes (nav filtering + the loading
  fix, no migration needed) await a deploy confirmation, same pattern as every other change this session.
- **2026-07-13 (later still — Archive bug fixed, Archived tab built, signup role picker removed, Invite +
  real-time sync investigated with plans presented, Sonnet 5)** — Owner reported Archive kept refusing
  with "still holds an active membership" even after revoking. **Reproduced locally** (created a real test
  company/user, revoked, then called `archive_user_account()` directly) — the SQL logic itself was
  correct; the real problem is the two-step "revoke, then archive" design was fragile: an account can
  accumulate MORE than one `user_branch_roles` row over its life (different branches, repeated
  reassignment), and the old check looked for ANY active row anywhere — revoking the one row visible in
  the directory doesn't help if a second, easy-to-miss row is still Active elsewhere.
  **Fix** (`supabase/migrations/20260713120000_p1g1_archive_auto_revoke.sql`): `archive_user_account()`
  now auto-revokes every remaining active membership itself, in the same atomic call — no separate manual
  revoke step. Still rank-gated exactly like a normal revoke (all-or-nothing: if the actor doesn't outrank
  even one of the target's active roles, nothing is touched). UI: "Archive" now works directly from an
  Active row too, not just an already-revoked one, with a confirm dialog explaining it revokes access
  immediately. Guard rewritten to reproduce the exact reported bug (two active memberships across two
  branches) and prove both get cleaned up in one call — `scripts/guards/auth-lifecycle-security.sql`,
  auth-lifecycle battery still 15/15 (one fewer than before: the old "refuses a live membership" test no
  longer applies, replaced by the auto-revoke proof).
  **Archived accounts tab** (owner request: "store them properly, see them properly"): new
  `app/features/organization/archived/ArchivedAccountsScreen.tsx`, wired as its own `/organization/archived`
  tab in `ORG_TABS` (membership.read-gated) instead of the old inline "Show archived" toggle inside the
  main directory, which is now removed — the main "Active POS Users Directory" table always excludes
  Archived rows unconditionally; they only ever appear in the new tab, with Unarchive there.
  **Signup role picker removed** (owner: "redundant and not necessary") — `app/pages/Login.tsx`'s
  "Create POS Account" form no longer has the 5-tier role dropdown; signup is now just name/email/password.
  The requested-role wish mechanism itself (server-side, `requested_role` column, the Approvals queue's
  "wants: X" badge) is untouched — just never populated by the public form anymore, so the badge simply
  won't appear for new signups. `signUp()`'s `requestedRole` param stays optional (unchanged) for API
  compatibility with anything else that might call it.
  **Invitations — investigated, NOT changed yet, plan below (owner asked "show me a plan... or should we
  remove entirely").** Confirmed a real bug by reading `accept_invitation()`
  (`20260622110257_p2m1_organization_setup.sql:137`, re-defined identically in P1D): it links whichever
  account is CURRENTLY SIGNED IN when `/accept?token=…` is opened — with ZERO check that the signed-in
  account's email matches the invitation's intended recipient. If the admin who created the invite tests
  their own "copy invite link" while still signed in as themselves, the invite silently attaches to the
  ADMIN'S OWN account, creating a stray membership nobody is using — exactly what the owner reported.
  Presented 3 options (not yet built, awaiting the owner's choice): (A) minimal fix — make email required
  on the invite form and add an email-match check to `accept_invitation()`; (B) build real automatic email
  delivery via a Supabase Edge Function + Auth admin API (bigger lift, new infra, matches Launch Runbook
  §2.6 option (b)); (C) remove Invitations entirely and rely solely on the already-solid self-signup +
  approval flow. Recommendation given: (C), since self-signup+approve already fully covers onboarding and
  is the well-tested path; Invitations is the newer, more confusing, currently-unused, bug-prone one.
  **Real-time auto-sync — investigated, NOT built yet, plan presented (owner: approving/POS sales don't
  show elsewhere without a manual browser refresh).** Confirmed: `useSync` (`app/core/offline/sync.tsx`)
  is outbox-drain only (pushes local writes up on reconnect/focus) — nothing pulls down OTHER sessions'
  changes; zero code anywhere calls `supabase.channel()`/`postgres_changes`, even though Realtime is
  already `enabled = true` in `supabase/config.toml`. This is a from-scratch feature, not a bug fix.
  Presented a phased plan (not yet built): start with Supabase Realtime subscriptions on the two screens
  the owner actually flagged (Approvals pending queue + directory; POS sales feed / Dashboard), each
  updating the local Dexie cache on a change event so the existing `useLiveQuery` re-renders automatically
  and offline-first behavior is preserved; broader coverage as a later phase once the pattern is proven,
  rather than rewriting every screen at once. Awaiting the owner's go-ahead before building.
  **Verified:** tsc clean, 92/92 vitest, full clean-reset guard battery 18 files / 245 assertions green
  (auth-lifecycle net -1 from the archive test rewrite), static-guards + drift both PASS. Live browser
  check confirmed the signup form no longer shows a role picker.
- **2026-07-13 (final — owner chose Invitations option C; login redesigned; everything pushed, Sonnet 5)**
  Owner decided: remove Invitations entirely (option C); push everything; redesign the login screen per 3
  mockups (mobile/tablet/laptop); accept email OR username at sign-in.
  **Invitations removed** (`supabase/migrations/20260713130000_p1i_remove_invitations.sql`): `invite_user`/
  `accept_invitation` EXECUTE revoked from `authenticated` — kept, not dropped (never-hard-delete, same as
  P1F/P1G). App: `/organization/invitations` route, `/accept` route, the nav tab, and the two screen files
  (`invitations.tsx`, `AcceptInvitation.tsx`) deleted outright — they had no other caller. Two guard files
  had invite/accept woven into their fixtures and had to be rewritten, not just trimmed: `org-security.sql`'s
  happy path now proves the same company/branch/role-management + isolation guarantees via a direct
  governed membership grant instead of invite+accept, plus a new assertion proving both retired RPCs are
  genuinely unreachable; the invite-specific attack blocks (replay, expired-token, cross-company invite)
  were removed since they tested now-dead code — the rank/isolation mechanisms they exercised are still
  covered elsewhere (`approvals-roles-security.sql`). **Found and fixed a real bug in my own test rewrite
  while doing this**: `INSERT ... RETURNING ... INTO` on a FORCE-RLS table requires the actor to also pass
  the table's SELECT policy for the just-inserted row, not only the INSERT policy — Postgres reports this
  as the same "violates row-level security policy" error as an outright insert denial, which sent me
  chasing the wrong theory for a while (isolated repros without a `RETURNING` clause kept succeeding,
  which is what eventually pointed at it). Fix: the fixture owner's granted-permission list was missing
  `membership.read` (a real production owner always has it via `seed_standard_roles()`; the hand-built
  fixture just hadn't kept up) — added it, one line.
  **Login screen redesigned** (`app/pages/Login.tsx`) to the owner's 3 mockups: stacked hero-photo-over-
  dark-card on mobile (42vh hero) and tablet (46vh hero), true 50/50 split with a vertically-centered form
  on laptop+ (`lg:` breakpoint) — verified via computed-style checks at 375px/820px/1280px (not just visual
  inspection, since the browser tool's screenshot action was flaky this session): `flex-direction` is
  `column` at the two narrow breakpoints and `row` at desktop, hero/panel are exactly 50/50 width at
  desktop. Dark theme (`#0c0c0c`/`#121212`), emerald accent, person/eye icons on the fields, Google "G"
  icon inlined as SVG (no new asset/dependency). The hero photo itself references `public/login-hero.jpg`
  (not supplied — no photo asset was available to fetch or generate) with a CSS gradient fallback so the
  page still looks intentional if that file is never added; owner can drop a real photo in at that path
  whenever. **Email/username field**: relabeled "Email / Username", validation relaxed to accept either
  shape — but only email actually authenticates today. True username→email resolution needs a genuinely
  new decision: it requires a pre-auth (before login) lookup, which Supabase Auth doesn't support
  natively, and the two real ways to build it are (a) the app's first-ever grant to the `anon` role — a
  deliberate change to the "zero anon grants" security posture this project's own guards test for — or (b)
  a new Supabase Edge Function holding service_role server-side (real infra, not yet built anywhere in
  this project). Neither was silently chosen; flagged for the owner rather than picked unilaterally, given
  it's a genuine security-architecture trade-off in a High-risk domain (CLAUDE.md §6, Authentication).
  **Verified:** tsc clean, 92/92 vitest, production build clean, full clean-reset guard battery 18 files /
  244 assertions green (org-security net -8: two whole invite-attack blocks removed, one new P1I-retirement
  assertion added; approvals-roles net -2: the invite-rank-check block removed), static-guards + drift both
  PASS. Live-browser-verified: login form renders correctly with no role picker; nav/loading fixes from
  earlier still intact.
  **PUSHED TO PRODUCTION AND DEPLOYED** (owner: "yes push all"): all three pending migrations —
  P1H (employee schedule.read), P1G.1 (archive auto-revoke), P1I (Invitations retirement) — applied to
  `aqhxhamdwmhcwxmebqbo` via the session pooler; app code (nav filtering, POS/Inventory loading fix,
  Employee calendar access, Archive-from-Active-row + Archived tab, signup role-picker removal, Invitations
  removal, the redesigned login screen) deployed via `npx vercel deploy --prod`. Live smoke check after
  deploy: hosted login page loads clean, no console errors.
  **Still open, owner has NOT yet given a go-ahead:** real-time auto-sync (the phased plan above — start
  with Approvals + POS/Dashboard) remains unbuilt pending the owner's decision; the username→email
  resolution mechanism (anon grant vs. Edge Function) remains unbuilt pending the owner's decision.
- **2026-07-13 (final round — username login built, real-time sync built (verification blocked locally),
  Google added to signup, dead Invitations links cleaned up, Sonnet 5)** — Owner: "yes add the username
  login and go build the auto sync, also include the google sign in in the Create POS Account tab." Chose
  the anon-grant approach for username login (not the Edge Function alternative) given the narrower scope.
  **Username login** (`supabase/migrations/20260713140000_p1j_username_login.sql`): `public.users` gains a
  `username` column (case-insensitive unique via `lower()` index, format-checked), auto-derived + deduped
  at signup (email local-part, numeric suffix on collision) inside `handle_new_auth_user()`. New
  `resolve_login_email(text)` — the first-ever `anon` grant in this schema, deliberately and narrowly
  scoped: given a username returns only that account's email or NULL; an email-shaped input passes through
  untouched with no lookup. `account_status` is NOT filtered (a Suspended/Archived user must still be able
  to authenticate and see why they're blocked, exactly as if they'd typed the email — same as always).
  Client (`session.tsx`): `signIn()` now resolves a non-email identifier before calling
  `signInWithPassword`, falling back to the raw input on any failure so Supabase's own generic "invalid
  credentials" surfaces rather than a distinguishable unknown-username signal. 5 new guard assertions
  (`auth-lifecycle-security.sql`): dedup on signup, email-shaped passthrough, case-insensitive resolution,
  NULL for unknown usernames, and a blast-radius check proving `anon` still cannot read `public.users`
  directly — this is the only new anon surface, nothing else widened.
  **Google added to the Create POS Account tab** — same `signInWithOAuth` call as Sign In (it was already
  provider-agnostic; only the button was missing from that tab).
  **Real-time auto-sync, phase 1, BUILT but NOT verified end-to-end**
  (`supabase/migrations/20260713150000_p1k_realtime_sync.sql`, `app/core/offline/realtime.ts`): adds
  `user_branch_roles`, `users`, and `invoices` to the `supabase_realtime` publication (started empty —
  confirmed via `pg_publication_tables` before this migration) and wires a `useRealtimeRefresh` hook into
  Approvals (user_branch_roles scoped by company_id; users UNSCOPED since that table has no company_id —
  a real bug caught and fixed before shipping, found by checking `\d public.users` rather than assuming)
  and Dashboard (invoices, scoped). **Caught a second real bug in the same review**: the original hook
  signature applied one shared `company_id` filter to every watched table uniformly; redesigned to
  `RealtimeWatch[]` so each table can opt out of scoping. **Verification wall, disclosed rather than
  hidden:** attempted a live two-session proof (real signup via the browser, a second session inserting
  rows directly, watching for the change without a manual refresh) three separate ways — direct table
  insert, direct UPDATE, and a bare debug channel with no company filter at all — and got zero events
  every time, despite the channel reporting `SUBSCRIBED`, the publication correctly listing all 3 tables,
  `wal_level = logical`, and the `supabase_realtime_replication_slot_` showing `active = t`. Restarted just
  the Realtime container, then the entire local stack (`supabase stop` + `start`) — no change. The
  Realtime container's own logs show zero evidence of consuming the WAL stream (only health-check/billing
  noise) despite every prerequisite being correctly configured — this points at a local Supabase CLI
  Realtime quirk, not the migration or the client code, but it could NOT be proven locally in this
  session. Production runs Supabase's fully-managed cloud Realtime (different infrastructure, not the
  local Docker container this was tested against), so this may well work correctly once deployed — but
  that is genuinely unverified, not just "probably fine." **Recommend the owner (or the next session)
  confirm with two real browser tabs on the live site before treating this as done.**
  **Also found and fixed while testing**: a leftover "New members can also join via Invitations" link on
  the empty pending-queue message (a dead route, missed during the Invitations removal) — reworded, no
  link. Dashboard had two more dead references: an "Invite User" action tile linking to the removed route,
  and a permanently-zero "Pending invites" stat gated on the now-dead `user.invite` permission — both
  replaced with a "Pending approvals" count (reusing `list_pending_users()`, the same source Approvals
  already uses) and a "Review Approvals" tile, which is more useful than what it replaced, not just a
  deletion.
  **Verified:** tsc clean, 92/92 vitest (one test updated for the new "Sign In" button label — the
  redesign renamed it from "Log in to ERP"), production build clean, full clean-reset guard battery 18
  files / 250 assertions green, static-guards + drift both PASS. Real-time itself: NOT end-to-end verified
  (see above) — everything else in this batch was.
- **2026-07-13 (manual sync backup, Sonnet 5)** — Owner tested real-time live and it still required a manual
  browser refresh ("nah i til have to refresh the browser"); paused the real-time root-cause investigation
  for launch time and asked instead for an explicit backup: "add manual sync, make the wifi icon on the top
  bar be the sync button just tap it then sync... auto sync still lives were just gonna add just for
  backup." Pure app-code, no migration. `SyncValue` (`app/core/offline/sync.tsx`) gained `refreshTick`
  (increments on each tap) and `manualSync()` (calls the existing `triggerSync()` outbox drain, then bumps
  `refreshTick`). The top-bar wifi button (`AppShell.tsx`) now calls `manualSync` instead of `triggerSync`
  directly. Every screen with its own `reload()`-style fetch now includes `refreshTick` in that effect's
  dependency array, so one tap re-fetches whatever is currently on screen: Accounting, AccountsTab,
  Copilot, the shared crop hook (`useSyncedCrop` — covers Categories/Varieties/Profiles/Templates in one
  edit), Customers, Inventory, Approvals, Archived Accounts, Memberships, Payroll, POS, Projects,
  Schedules, and both of Dashboard's fetch effects (sales report + members/pending counts) plus
  CropDashboard's cache-warm effect — 15 screens total. **Verified:** tsc clean, 92/92 vitest, production
  build clean. Live browser E2E against a from-scratch local Supabase fixture (real signup through the UI,
  hand-bootstrapped into an Active owner membership since the local DB had been reset to empty earlier in
  the session): inserted a new pending signup directly via SQL while already sitting on the Approvals
  screen (simulating another device/employee signing up), confirmed it was correctly absent before syncing,
  tapped the wifi button, and the new signup appeared with no page reload — reproducing and fixing the
  owner's exact original complaint. All QA fixture data (company/branch/roles/users) removed afterward;
  local DB confirmed back to empty. Real-time auto-sync code is untouched and still wired — this is
  additive only, per the owner's explicit instruction not to replace it.
- **2026-07-16 (Team-B parity port — one feature + one bug fix + one security fix, owner order)** — Owner:
  "scan their local repo and live web ... implement a feature, a bug fix and a security feature they have
  and we dont have ... i want exact same thing team B has." Ran a 5-scanner comparative sweep over Repo B
  (handoffs-for-team-a docs, git log since 07-13, migrations+guards, app tree, live site) with per-claim
  adversarial verification against our code. Three ports landed (Repo B read-only throughout):
  **(1) BUG FIX — role-change duplicate-row (B 8c4447a §2):** our `membershipsApi.fetch` returned ALL
  `user_branch_roles` rows unfiltered, so a role change (expire old + insert new) showed BOTH rows —
  "looked like a new account." Confirmed present here by reading the fetch body before porting. B's
  `dedupeByUser()` now applied on both mock + real paths: one row per user, Active preferred, else most
  recent Expired (Reactivate still works); DB audit rows untouched.
  **(2) SECURITY — P1J.2 `resolve_login_email` hardening (`20260716090000`):** B's guard literally names
  our shape "Finding-1 vs Repo A" — our anon-granted username resolver returned a Suspended/Archived
  user's EMAIL (deactivated-account harvest surface). Now: `account_status = 'Active'` filter (deactivated
  usernames resolve NULL → generic "invalid credentials", same as unknown) + grant narrowed to anon only
  (authenticated revoked — login is pre-auth). P1J's original contrary rationale is reconciled in the
  migration header: a deactivated user still signs in BY EMAIL and still sees the honest block screen.
  3 new guard assertions in auth-lifecycle (Suspended→NULL, Archived→NULL, grant shape).
  **(3) FEATURE — P1L self-service Profile (B f0249fa):** new `/profile` ("My Profile" nav, no permission
  gate — self-service): change own username (new `update_own_username` SECURITY DEFINER RPC, migration
  `20260716110000` — own-row by construction, Active gate, server-side format+uniqueness, Security audit
  row), change own email (Supabase Auth confirm-to-new-address), OTP password change MOVED here from
  Settings; Google-only users get manage-at-Google messaging. Settings' Data & Backup export is now
  owner-tier only (`company.manage` gate — B item 5, owner directive). New guard
  `scripts/guards/p1l-self-service-username.sql` (8 assertions, G1-G7 + audit check; ported to our
  BEGIN/ROLLBACK convention — B's committed permanent fixtures) + `guard:p1l` in package.json + CI step.
  **Deliberately NOT ported (B's own commit, superseded or separate):** f0249fa's sync-button tweak (B
  later replaced it with the 5ab18eb overlay — queued as its own item).
  **Verified:** tsc clean · 92/92 vitest · build clean · full clean-reset battery: 19 SQL guard files ALL
  PASS (auth-lifecycle now 23 notices incl. 3×P1J.2; new p1l 8/8) + static-guards PASS + drift PASS ·
  live browser E2E on local real mode: signup → owner bootstrap → Profile renders → username change
  persisted + audited → Approvals directory shows the Expired+Active fixture ONCE (dedupe) → owner sees
  Data & Backup, password card gone from Settings → signed out → `suspendedharvest` username login =
  generic "Invalid login credentials" (no enumeration) → login with the CHANGED username `portowner_new`
  lands on Dashboard (P1L→P1J chain end-to-end). Fixtures wiped via final db reset (0 rows).
  **PUSHED + DEPLOYED to production 2026-07-16 ~12:02 UTC (owner "go", executed by Sonnet 5 per
  `docs/28_Enterprise_Architecture_Audit/SONNET5_DEPLOY_PROMPT_P1J2_P1L.md`).** Both migrations applied
  to `aqhxhamdwmhcwxmebqbo` via direct psql over the session pooler, one file per invocation, in order —
  P1J.2 (`CREATE FUNCTION` / `COMMENT` / `REVOKE`, no errors) then P1L (`CREATE FUNCTION` / `COMMENT` /
  `REVOKE` / `GRANT`, no errors). **Live-verified read-only before deploying the app** (not assumed):
  `pg_get_functiondef('public.resolve_login_email(text)')` confirmed the production function body
  contains `account_status = 'Active'`; grant-shape checks on both functions returned exactly the
  expected shape — `resolve_login_email`: anon=true/authenticated=false; `update_own_username`:
  authenticated=true/anon=false. App deployed via `npx vercel deploy --prod` → READY, aliased to
  `pick-ur-veggie-farm.vercel.app` (deployment `dpl_2UwQM2iWdSaSskkUBFrrrB8kZkaE`). Post-deploy smoke
  (read-only, no writes): login page renders correctly, zero console errors, all 7 asset/document
  requests 200 including `login-hero.jpg`. **Owner: rotate the `aqhxhamdwmhcwxmebqbo` session-pooler
  password now** — it was shared in chat for this one push per the established ephemeral-use
  convention (2026-07-13 precedent) and must not be reused.
  **Queued next (confirmed B-has-A-lacks, owner to order):** awaiting-approval "peek" fix (privileged UI
  flashes ~0.5s while permissions load — CONFIRMED present in our AppShell, B fixed in 5ab18eb + regression
  test; top pick), POS customer picker at checkout (0dd8f60), POS manual sale "sold IS the inventory"
  (7ede41c), receipt paper sizes 58/80mm + journal reprint (5ab18eb), sync-button UX overhaul (spin/overlay),
  PNG app-icon set + apple-touch-icon (PWA/iOS), global mobile font shrink (e118332), P1K realtime
  live-proof script + publication guard (closes OUR "events unproven" gap), pg_dump backup/DR runbook +
  backups/ gitignore, B's MISTAKES_JOURNAL lessons. B's uncommitted paid-discount work (P2M2F) was seen
  but NOT ported (unshipped WIP; money-path — needs its own review). Also on B's ask-list: cross-vendor
  review of THEIR P1D migration (URGENT per their handoff 006).
- **2026-07-17 (P1M revoke-approval workflow ported from Repo B, LOCAL ONLY — not yet pushed)** — Owner
  re-ran the "search Repo B thoroughly" scan; B had shipped one more commit since the prior scan
  (`c014423`, dated 2026-07-17 00:19): a separation-of-duties workflow for account revocation. Checked
  our own code first — confirmed the same gap: `membership.manage` is co_owner+/owner only (same tier
  in both repos), and our `ApprovalsScreen.tsx` Revoke button executed `setStatus(m,'Expired')` directly
  off a single confirm dialog — one person, one click, done. Owner said "sure go."
  **Ported as P1M, not P1J** — B labeled their commit "P1J," but P1J already means username-login on
  our chain; reusing B's label here would have collided with our own migration history, so this landed
  as `20260717090000_p1m_revoke_approval_workflow.sql` instead. Same design: new `revoke_requests`
  table (RLS enabled AND forced, function-only writes, one-Pending-per-target unique partial index,
  self-revoke blocked by a CHECK constraint) + 4 SECURITY DEFINER RPCs — `request_revoke` (queues,
  does not execute), `list_revoke_requests` (membership.manage-gated read), `approve_revoke_request`
  (membership.manage + **approver != requester** + outranks-every-active-role-of-target, all-or-nothing —
  the `approver != requester` check is the actual enforcement, not a new permission key),
  `reject_revoke_request` (same gate, no-op). New guard `scripts/guards/p1m-revoke-approval-security.sql`
  (ported from B's, adapted to our fixture conventions — `bootstrap_initial_tenant` + `seed_standard_roles`
  for a real owner + two co_owners + one employee, all inside one BEGIN/ROLLBACK): 6/6 PASS (2 happy +
  4 sad: employee denied, self-approve denied, duplicate-pending denied, self-revoke denied). Sibling
  guards (pos, approvals-roles, accounting) re-ran green — no regression, matching B's own claim.
  App: new `app/features/organization/revoke-requests/revokeRequests.ts` API module (online-only RPCs,
  no Dexie cache — same convention as Overrides/Invitations); `ApprovalsScreen.tsx`'s Revoke button now
  opens a reason-required dialog that queues instead of executing, and a new "Pending Revoke Approvals"
  card renders only when the queue is non-empty (mirrors "Pending Account Approvals"). One deliberate
  divergence from B's diff: B's `request`/`approve`/`reject` don't guard `MOCK_MODE` at all, which would
  throw against a fake localhost RPC in the demo build; ours explicitly throws a clear
  "Demo mode has only one account" message instead, since MOCK_MODE's single demo user makes a genuine
  two-person approval literally impossible to simulate honestly.
  **Verified:** tsc clean, 92/92 vitest, build clean, full clean-reset battery — 20 SQL guard files
  ALL PASS (19 prior + new p1m) + static-guards + drift both PASS. **Live browser E2E, the full
  separation-of-duties path with three real signed-up accounts** (not fixtures alone): Owner Co1
  (bootstrapped owner) clicked Revoke on employee e2e-emp → reason dialog → request queued → e2e-emp
  stayed Active in the directory (access unaffected) → signed out → signed in as a SEPARATE real
  account (Real Co2, granted co_owner via SQL) → saw the "Pending Revoke Approvals" box with Owner
  Co1's name and reason → clicked "Approve revoke" → e2e-emp's status flipped to Expired, the box
  disappeared (queue empty), and `audit_events` shows both `revoke.requested` and `revoke.approved`
  rows, `revoke_requests.status = 'Approved'` with `decided_by` set. All fixtures wiped via a final
  `supabase db reset`; local DB confirmed back to 0 rows.
- **2026-07-17 (P1M pushed + deployed to production; self-caught anon-grant hardening, P1M.1)** — Owner
  gave the DB password and "go." First push attempt used a wrong password (auth rejected, nothing
  touched); owner supplied a corrected one and the push succeeded cleanly.
  **Post-push live verification caught a real grant-hygiene bug in my own migration**, not assumed
  clean: `has_function_privilege('anon', 'public.request_revoke(uuid,text)', 'execute')` returned
  `true` on all 4 new RPCs. Root-caused via `pg_default_acl` before touching anything further: this
  Supabase project has an `ALTER DEFAULT PRIVILEGES` rule that grants EXECUTE on every NEW function to
  `anon` as a DIRECT per-role grant — `revoke all ... from public` (what P1M wrote) never touches a
  direct grant, only a PUBLIC-pseudo-role grant. P1J.2/P1L got this right (`from public, anon`); P1M
  missed the `, anon` and shipped anon-executable. Sanity-checked this wasn't project-wide breakage by
  testing a known-good function (`update_own_username` — correctly anon=false) against a known-old one
  (`archive_user_account`, P1G — **also anon=true**, a pre-existing gap predating this session, noted
  but explicitly NOT touched — out of scope for tonight, flagged for a future dedicated pass).
  **Fixed immediately, same session, before calling P1M done:** new migration
  `20260717100000_p1m1_revoke_approval_anon_hardening.sql` (`revoke execute ... from anon` on all 4
  RPCs) + a new grant-shape assertion appended to `p1m-revoke-approval-security.sql` so this exact
  regression class can never land silently again. Practical exposure was LOW throughout (every RPC
  calls `current_app_user_id()` first, which resolves NULL for a no-session anon caller and rejects
  before touching data) — this was a grant-shape/defense-in-depth fix, not a live-data incident.
  Re-verified locally (clean reset, full 20-guard battery + static + drift, all green, including the
  new assertion) before pushing the fix to production and re-confirming live: all 4 functions now
  correctly show anon=false/authenticated=true. **Both migrations (P1M + P1M.1) now live in
  production**, app deployed via `vercel deploy --prod` → READY, aliased to `pick-ur-veggie-farm.vercel.app`
  (deployment `dpl_D7fcRTNgNUnnNjkaMxdCixxHJ6CG`). Post-deploy smoke (read-only): login page renders
  correctly, zero console errors, all requests 200. **Owner: rotate the `aqhxhamdwmhcwxmebqbo`
  session-pooler password now** (same ephemeral-use convention).
  **New, out-of-scope finding for a future session:** `archive_user_account` (P1G, weeks-old) is
  anon-executable in production via the same default-ACL mechanism — worth a dedicated audit of every
  governed RPC's grant shape, not just the ones touched recently.
- **2026-07-17 (P1N push — deploy blocked by transient ECONNRESET, resolved) + Batch 1 of the owner's
  full Team-B-parity backlog, LOCAL ONLY — not yet pushed)** — Owner directive: "build these features
  we dont have, fix bugs, fix security leaks," relaying the full prompt history they gave Team B plus
  Team B's own status report. Triaged the whole ask against both repos' current state (table in the
  session record); most of it maps to B commits already reviewed, three items have no reference
  implementation anywhere (void-approval, crop-pricing-approval, the merged permissions-panel
  redesign — B's own "item C," which B itself declined to rush), and one (10% discount on paid POS
  sales) is money-path-gated pending the owner's cross-vendor sign-off.
  **P1N deploy:** the app build stuck on a persistent Vercel `ECONNRESET` (7 attempts, ~38s hang each
  before reset) while the P1N database migration was already safely live. Confirmed via
  `vercel whoami` + direct curl to `api.vercel.com` that this was not a broader connectivity/auth
  failure and not a Vercel-side incident (status page: all green) — isolated to the large
  deployment-upload POST specifically, most likely a local network path issue (VPN/AV/NAT). Resolved
  itself on a later retry; deployed clean, READY.
  **Batch 1 (display-only gates + one real permission-grant fix, all ported from Team B commits
  5ab18eb/241badb, or self-discovered):**
  1. **Awaiting-approval "0.5s peek" fixed** — `AppShell.tsx`: added `if (!MOCK_MODE && loading) return
     <Loading/>` before the companyId check, so `<Outlet/>` never mounts during the resolving window.
     B's own 239-line regression test wasn't ported (mirrors a B-specific mock-test pattern with no
     counterpart in our repo, since our P1C architecture diverged — screen-gated vs. B's global wire);
     verified instead via live browser E2E on every fresh navigation this session.
  2. **Role-key regex bug fixed** — `organization.ts`: `codeSlug` was uppercase-only
     (`[A-Z0-9]`) while its own error message only promised "A–Z, 0–9, dash"; a naturally-typed
     lowercase key like "cashier" was silently rejected. Confirmed no server-side case constraint
     exists (plain text column) before relaxing the regex. **Verified live**: created a role named
     `cashier` (lowercase) as owner — persisted in the DB exactly as typed.
  3. **Four role-visibility gates** (Dashboard org-stats+Quick-Actions, POS branch-picker+Export-Journal-CSV,
     Reports nav, Schedules "General" chip) — all `has()`-gated to admin+, matching the owner's own
     pasted screenshot verbatim (which named the whole Quick Actions block, "Weigh a Sale" included,
     as "must not be visible" — operators keep full POS access via the main nav sidebar regardless).
  4. **NEW finding, not from B — `project.read` gap**: while verifying B's "no UI change needed"
     claim for the Project Checklist ("all roles read, admin+ manage"), found our `seed_standard_roles()`
     grants employee/operator ZERO project keys (unlike B's schema). New migration
     `20260717120000_p1h1_project_read_all_roles.sql` — evolves `seed_standard_roles()` (adds
     `project.read` to employee+operator, matching P1H's precedent pattern) + a direct backfill
     INSERT for existing companies (same shape as P1H's schedule.read backfill) + new guard
     `p1h1-project-read-all-roles-security.sql` (4 assertions: employee/operator hold project.read,
     neither holds project.manage) bootstrapped via the real `seed_standard_roles()` path, not
     hand-built fixtures.
  **Also found in passing**: Team B has started "item C" server-side — a new commit `1b3613a`
  (`20260716140000_p1c2_module_access_overrides.sql`, a read-only `user_module_access()` resolver +
  `permission_modules` view) they explicitly label "part 1 of 2," UI not yet landed. Noted for when
  item C is eventually built here — does not change or supersede the `project.read` fix above (the
  resolver reads FROM role_permissions/overrides; it doesn't touch the seed itself).
  **Verified:** tsc clean, 92/92 vitest, build clean, full clean-reset battery — 22 SQL guard files
  ALL PASS (21 prior + new p1h1) + static-guards + drift both PASS. **Live browser E2E** with two real
  signed-up accounts (owner + operator, distinct sessions): owner dashboard shows all 4 org stat cards
  + Quick Actions + Reports nav + POS branch picker + Export Journal; operator's dashboard shows NONE
  of those (replaced by the honest "some widgets are hidden" hint), operator's nav has no Reports link,
  operator's POS has no branch picker/no Export button, operator's Schedules shows only "All events"
  (no redundant "General" chip), and operator CAN see the Project Checklist board (read) but has no
  "New Project" create action (no manage) — every gate confirmed both ways, not just "gate exists."
  All E2E fixtures wiped via a final `supabase db reset`; local DB confirmed back to 0 rows.
  **NOT pushed to production** — one new migration (P1H.1) + a batch of app-code changes, awaiting the
  owner's explicit push authorization. **Still queued from the full triage**: POS UX batch (manual
  sale, customer picker, receipt sizes/print, sync animation, Log Expense merge), the two
  original-design items (void-approval, crop-pricing-approval), the money-path-gated 10% discount, and
  the permissions-panel redesign (item C) — sequencing as previously reported to the owner.

- **2026-07-17 (Phase A: Reports placeholder, Crops & Plans tab deletion, sync-button animation, LOCAL
  ONLY — not yet pushed) + Phase B: item C, the merged 3-state permissions panel, ported from Team B
  commit `1b3613a` (server) and their in-progress client build (UI))** — Owner directive continuing the
  same backlog: honest Reports placeholder, delete Crops & Plans entirely (owner's words evolved from
  "archive" to "actually delete the crop & plan tab" mid-message — the later, more specific instruction
  is authoritative), animate the sync button on tap ("doesn't animate, glitches on tap"), and "analyze
  more about repo B, their 'approval & roles' section is more updated and secured, ours is a joke" —
  which is what surfaced item C as B's actual most-recent work.
  **Phase A:**
  1. **Reports placeholder** — `Placeholder.tsx` rewritten with Reports-specific honest copy (names
     what's coming: daily sales, best-selling vegetables, cash reconciliation, payroll totals, inventory
     turnover; links to Dashboard/Accounting/POS) instead of a generic "coming soon."
  2. **Crops & Plans tab deleted** — 8 files removed (`CategoriesScreen`/`CropDashboard`/`CropsLayout`/
     `ProfilesScreen`/`TemplatesScreen`/`VarietiesScreen`/`api.ts`/`shared.tsx` under
     `app/features/crops/`, plus `app/schemas/crops.ts`); `OperationsLayout.tsx` tab removed;
     `router.tsx` route subtree + 6 lazy imports removed, legacy `/crops/*` redirect retargeted to
     `/dashboard`. Offline Dexie `crop_*` tables/types/mock seeders deliberately RETAINED — purging them
     would force an offline-migration risk on installed on-device Dexie DBs; the dead tables are
     harmless. Confirmed zero remaining references via grep; tsc clean; bundle shrank as expected.
  3. **Sync button animation** — `AppShell.tsx` TopBar: new `uiSyncing` local state (700ms minimum
     spin, ignores re-tap mid-spin) decoupled from the underlying `syncing` state, plus a new
     full-screen `.syncoverlay` (top-edge shimmer sweep + pulsing status pill) in `index.css` so the
     whole screen visibly reacts to a tap, not just the icon. Verified live: mid-spin shows
     `disabled=true` + `aria-busy=true` + the spin class + the overlay; clears fully after 700ms+.
  **Confirmed already-live from prior sessions** (re-verified, not rebuilt): the role-change
  duplicate-account bug (`dedupeByUser`, fixed 2026-07-16), the self-service Profile screen
  (username/email/password, P1L), OTP password-change living in Profile (not Settings), and Data &
  Backup export already gated out for admin-and-below (`company.manage`).
  **Phase B — item C, the merged permissions panel:**
  Server: `20260717130000_p1c2_module_access_overrides.sql` — adds `permissions.module text` (additive,
  nullable) + backfills the 33 active keys under 8 UI modules (organization/inventory/pos/accounting/
  payroll/scheduling/projects/customers) plus a `system` catch-all for `crop.manage` (idle since the
  Crops tab deletion above); a `permission_modules` view (one row per module, picks a representative
  `.read`/`.manage` key via `distinct on`); and `user_module_access(company_id, user_id, module)` — a
  READ-ONLY SECURITY DEFINER resolver returning `none`/`view`/`manage`. Writes still go through the
  existing proven `set_user_permission_override` RPC (one call per representative key) — the resolver
  is purely additive, no new write path, so the money-path-adjacent M4 `has_permission` resolver is
  untouched. **Deviation from a blind port**: our schema has `finance.account.read`/`.manage` (P2-B2A
  digital payments) which B's 31-key catalog doesn't — bucketed into `accounting` rather than the vague
  `system` catch-all, keeping the module count at the screenshot's 8 named modules (+ `system`, 9
  total — the guard asserts `>= 8`, live count is 9). Self-caught lesson applied from P1M/P1M.1 earlier
  this session (production's `ALTER DEFAULT PRIVILEGES` grants anon broadly on new relations/functions
  in a way local dev does NOT replicate): explicit `revoke ... from public, anon` on both the function
  AND the new view from the start, not discovered after the fact.
  New guard `p1c2-module-access-security.sql` (7 assertions: view has >= 8 modules; employee holding
  only `pos.sell` resolves `pos` to `view`; that same employee resolves `accounting` to `none`; a
  co_owner with the full catalog resolves `accounting` to `manage`; an explicit deny override on
  `accounting.manage` drops a co_owner from `manage` to `view`; an unknown module string resolves to
  `none`; `anon` has neither EXECUTE on the resolver nor SELECT on the view) — all PASS after fixing
  three instances of the same PL/pgSQL "ambiguous column reference" bug (a local variable named the
  same as a temp-table column; same bug class self-caught and fixed in the p1m/p1h1 guards earlier this
  session).
  Client: `app/features/organization/overrides/moduleAccess.ts` (catalog/tier/apply API, mock catalog
  verified byte-for-byte against a live query of the local DB's `permission_modules` view + full key
  list) and `ModuleAccessDialog.tsx` (Radix Dialog, 8 module rows, 3-state segmented control per module,
  a "keys" disclosure listing the underlying permission keys for transparency, dirty-state tracking,
  "Save changes"). **Wired into `ApprovalsScreen.tsx`'s "Active POS Users Directory"** — the exact
  screen the owner named ("reduce the buttons on the Active POS User Directory") — replacing the two
  separate buttons ("Set Permissions" link to the Roles tab + the per-key binary "Overrides" dialog)
  with ONE "Access" button. The old `overrides.tsx` (`OverridesDialog`/`overridesApi`) is now fully
  unreferenced (confirmed via grep before deleting) and was removed rather than left as dead code.
  **Verified:** tsc clean, 92/92 vitest, build clean, full clean-reset battery — 22 SQL guard files ALL
  PASS + static-guards + drift both PASS. **Live browser E2E against the real local Postgres** (not
  mock — two freshly signed-up accounts, an owner bootstrapped via `bootstrap_initial_tenant` and an
  employee approved through the real Approvals UI): confirmed the Active POS Users Directory row shows
  exactly one "Access" button; opening it against the live resolver showed the employee's real state
  (`pos`/`projects`/`scheduling` = View-only from their seeded role's `pos.sell`/`project.read`/
  `schedule.read`, all other modules = Not Visible); toggled `accounting` to View-only and saved;
  confirmed in the DB the write produced `accounting.read = grant` + `accounting.manage = deny` via
  `set_user_permission_override`, and that `user_module_access()` immediately resolved `accounting` to
  `view` — a full, live round trip through the real UI, RPCs, and resolver, not just a compile check.
  Zero console errors during the flow. All E2E fixtures (test company + both accounts) wiped via a
  final `supabase db reset`.
  **Pushed + deployed to production 2026-07-17** (owner: "push it now"). Both migrations applied via the
  session pooler in order (P1H.1 then P1C2), single-transaction each, zero errors — the P1C2 backfill's
  `UPDATE` row counts matched the local run exactly (10/4/5/4/2/3/2/2/1 = 33 keys). Read-only post-push
  verification against `aqhxhamdwmhcwxmebqbo`: employee/operator hold `project.read` and not
  `project.manage` across every seeded company; `permission_modules` has 9 distinct modules; grant shape
  correct (`anon` has neither EXECUTE on the resolver nor SELECT on the view, `authenticated` has both);
  and — a live functional check against the **real production owner**, not a fixture — calling
  `user_module_access()` for the real owner/company resolved `manage` on all 9 modules, proving the
  resolver works end-to-end against real data with zero writes performed. App deployed via
  `vercel deploy --prod` (commit `31f6397`), READY, aliased to `pick-ur-veggie-farm.vercel.app`;
  post-deploy smoke test (read-only): login page renders, zero console errors, all assets 200.
  **Password used for this push has been shown in chat and must be rotated now** (ephemeral-use
  convention — same as every prior production push this session).

- **2026-07-17 (P1C3 — Section Access redesign + admin default narrowing; pushed + deployed to
  production)** — Owner directive, looking at the just-shipped P1C2 "Module access" dialog: rename to
  "Access", group by real nav **sections** (not the flat 8-module permission-catalog grouping),
  3-level progressive disclosure (section Visible/Not-Visible → its tabs' Visible/Not-Visible → Read
  or Edit & Manage). Plus two behavior changes: admin-and-below on payroll see only their own pay
  record by default (full roster only via explicit grant); admin can approve pending sign-ups by
  default but Revoke/Archive/Access/Reassign stay hidden unless granted, and admin only sees the
  Approvals tab under Approvals & Roles by default. Scope agreed with owner: Home Dashboard/
  VeggieGenius/Settings Hub/My Profile excluded from the tree (always-visible, unchanged); multi-tab
  section visibility is DERIVED from its tabs (no new keys); route-guard hardening for the many
  already-unguarded routes deferred to a follow-up.
  **Two real bugs found and fixed as part of this same change, not treated as separate work:**
  1. **The P1C2 "Not Visible" toggle has never actually worked** for anyone whose role already granted
     baseline access (nearly everyone) — `moduleAccessApi.apply()` wrote `effect: null` (clear) for the
     "none" target instead of `deny`, and the resolver never checked a deny override on the read key.
     Fixed in the new resolver (`user_key_tier`, checks deny on both keys) and the new `access.ts`
     `apply()` (writes `deny` on both keys for "none"). The old P1C2 objects are left defined but the
     client no longer calls them — flagged to the owner as a heads-up, not fixed in place.
  2. **A pre-existing, previously-invisible client-side permission bug**: `permissions.tsx`'s
     `loadSnapshot()` queried `user_branch_roles`/`user_permission_overrides` with no `user_id` filter,
     assuming RLS restricted results to "own rows only" — but both tables' RLS is two permissive
     policies OR'd together (own row, OR any row in the company if you hold `membership.read`/
     `membership.manage`). Anyone with broad read access (admin+) had their own snapshot silently
     UNION every other visible member's role_permissions/overrides too — found live during this
     session's own E2E when an admin's dashboard showed the owner's full catalog. Fixed with an
     explicit `user_id` filter (via `current_app_user_id()`) on both queries. This was blocking, not
     cosmetic — the entire premise of narrower-default roles depends on `has()` reflecting only the
     calling user's own keys.
  **Server** (`supabase/migrations/20260717140000_p1c3_nav_access_and_admin_narrowing.sql`): new
  permission key `membership.approve`; new additive resolver `user_key_tier(company, user, read_key,
  manage_key)` (parameterized on explicit key names, not a module-column lookup — needed because
  `membership.manage` now serves as the manage key for THREE different tabs at once, which P1C2's
  single-`module`-column design can't represent); `seed_standard_roles()` evolves (admin +membership.
  approve, −payroll.read/−payroll.manage) with a scoped backfill — **the first migration in this
  project to DELETE an existing `role_permissions` row rather than only add one**, deliberately (a
  tier-wide default-policy change belongs in `role_permissions`, not a mass `user_permission_overrides`
  seed — see the migration's own header for the full reasoning); three RPCs relaxed
  (`list_pending_users`, `reject_pending_user`, `assign_membership_with_payroll` — the last one
  branches on whether the target already has an active membership, so an approve-tier admin can
  approve a FRESH signup but still cannot reassign an EXISTING member's role, which stays locked to
  `membership.manage`); all three also got the explicit `revoke ... from public, anon` this session's
  P1M incident already taught (confirmed via direct read they were missing it — a real, independently
  live gap on all three, not hypothetical).
  **Client:** `moduleAccess.ts`/`ModuleAccessDialog.tsx` → `access.ts`/`AccessDialog.tsx` (static
  curated nav-shaped tree, no more DB-queried module catalog); `ApprovalsScreen.tsx` gets `canApprove`
  (gates the Pending Account Approvals card + its data fetches; Revoke/Archive/Access/Reassign/Pending-
  Revoke-Approvals stay on `canManage`, unchanged); `OperationsLayout.tsx` gains permission-gated tabs
  (previously had ZERO permission awareness — a real gap, closed as part of this pass since it's the
  same nav-shaped-tree work); `AppShell.tsx`'s `ORG_TABS` re-gated per-tab (Approvals→
  `membership.approve`; Company/Branches/Roles→their own `.manage` keys, previously ungated entirely;
  Members/Archived→`membership.manage`, was `membership.read`) + `ORG_LINK` updated to match; router
  guard on `/organization/approvals` updated to `membership.approve`.
  **New guard `p1c3-nav-access-security.sql`** (11 assertions covering: approve-only tier resolves
  correctly; admin resolves `none` on Company/Branches/Roles/Members/Archived by default; admin loses
  payroll.read/manage; `list_pending_users`/`assign_membership_with_payroll`/`reject_pending_user`
  accept the lighter tier for a fresh approval but `assign_membership_with_payroll` still rejects a
  reassignment attempt; `set_user_permission_override` stays locked to full manage; one
  `membership.manage` override correctly flips THREE different tabs to manage together; an explicit
  deny on a read-only key correctly overrides a role-derived grant [the Bug-1 regression test]; grant
  shape) — required fixing the by-now-familiar ambiguous-column-reference bug (temp table `g`'s columns
  colliding with local PL/pgSQL variable names) in two blocks before it passed clean. Also required
  fixing two now-STALE assertions in the pre-existing `payroll-role-link-security.sql` guard, which
  had encoded the OLD "admin always needs full membership.manage" behavior as correct — updated both
  to assert the new, intentional behavior instead (admin CAN now approve a fresh signup via
  `membership.approve`; admin can NO LONGER call `list_unlinked_payroll_eligible`, since that also
  requires `membership.manage`/`payroll.manage` and admin now holds neither by default).
  **Verified:** tsc clean, 92/92 vitest, build clean, full clean-reset battery — 24 SQL guard files ALL
  PASS (23 prior + new p1c3, plus the 2 corrected payroll-role-link assertions) + static + drift both
  PASS. **Live browser E2E against the real local Postgres** (owner + fresh admin-tier account,
  approved through the real UI, then a second pending signup for the admin to approve): confirmed (a)
  admin sees ONLY the Approvals tab under Approvals & Roles by default; (b) admin's Payroll page shows
  the self-only "not linked" empty state, not a full roster; (c) admin successfully approved the second
  pending signup end-to-end (client button → relaxed RPC → real membership created); (d) admin sees
  neither Revoke, Archive, Access, nor the reassign-role dropdown on ANY row including a non-self
  (owner's) row, proving the gate is `canManage`-driven and not just self-hiding; (e) after the owner
  granted `membership.manage` to admin via the new Access dialog, admin's next load showed Members AND
  Archived tabs newly visible (Company/Branches/Roles correctly still hidden, since those need
  DIFFERENT keys the grant didn't touch) plus the four action buttons on other rows. This is the exact
  sequence the redesign was built around, proven live end-to-end, not just at the guard-battery layer.
  **Pushed + deployed to production 2026-07-17** (owner: "continue DB pass is still the same" —
  reused the P1H.1/P1C2 push's password). Pre-flight check (read-only): zero admin-tier production
  members lack a payroll link, so the payroll-narrowing default change has no blank-page fallout.
  Migration applied clean (`DELETE 2` matched the expected admin-tier row count exactly). Read-only
  post-push verification: grant shape correct on all 4 new/touched functions; the real production
  admin role confirmed to have lost payroll.read/payroll.manage and gained membership.approve; a live
  functional check against the real production owner resolved `manage` on the Approvals/Company/POS
  node pairs. App deployed via `vercel deploy --prod` (commit `31f6397`), READY, aliased to
  `pick-ur-veggie-farm.vercel.app`; post-deploy smoke test clean (zero console errors, all assets 200).
  **Password reused per owner instruction — still due for rotation**, same as the P1H.1/P1C2 push it
  was reused from.

- **2026-07-17 (P1C3.1 — owner/co_owner membership.approve backfill hotfix, pushed to production
  same-session)** — Owner reported losing access to Approvals & Roles immediately after the P1C3 push,
  and asked for a destructive fix (delete all accounts, recreate their own with a password supplied in
  chat) — **declined**: permanently deleting accounts and entering a password into any field are both
  hard-prohibited regardless of instruction, per this project's own safety rules. Investigated instead
  (read-only production query) and found the real cause in under a minute: P1C3's backfill only added
  the new `membership.approve` key to existing **admin** roles — co_owner/owner are supposed to hold
  the full permission catalog automatically, but that only actually re-applies when
  `seed_standard_roles()` is CALLED, which P1C3 never did for this already-bootstrapped production
  company. Confirmed live: the real owner's `owner` AND `co_owner` role rows were both missing
  `membership.approve`, and `AppShell.tsx`'s `ORG_TABS` gates the Approvals tab on that single key with
  no OR-fallback — so the owner was silently locked out of their own primary admin screen, a real
  self-inflicted regression, not a hypothetical.
  **Fix**: `supabase/migrations/20260717150000_p1c3_1_owner_approve_backfill_fix.sql` — one additive
  `insert ... where role_key in ('co_owner','owner') and permission_key='membership.approve') on
  conflict do nothing`, same backfill shape as P1C3's own admin backfill. Verified locally first by
  simulating the exact production scenario (bootstrap a company, strip `membership.approve` from
  owner/co_owner to mimic "seeded before this key existed," confirm the backfill statement restores it
  for both roles) before touching production. **Pushed to production immediately** (owner: "fix it") —
  `INSERT 0 2`, matching the real owner's two role memberships (owner in one company, co_owner in
  another). Read-only post-push verification: both roles now show `has_membership_approve = true`; a
  live functional check via `user_key_tier` confirms the Approvals node now resolves `manage` for the
  real owner. No app deploy needed — pure data backfill, the already-deployed P1C3 client code was
  correct all along. Advised the owner that a stale locally-cached permission snapshot (offline
  support) may still require a sign-out/sign-in or hard refresh on their end even though the server
  side is now fixed.
- **2026-07-19 — Production incident (owner lockout) diagnosed and fixed; standing rule established.**
  Owner reported being locked out of production while inside the app: their own real account (`test212`)
  showed role/branch as raw UUIDs and status `Expired`, and basic actions (adding a product) failed with
  an RLS violation. **Root cause, confirmed via read-only investigation:** `test212`'s owner-tier
  `user_branch_roles` row flipped `Active` → `Expired` with **no corresponding `audit_events` row** —
  every governed path in this schema (`assign_membership_with_payroll`, `request_revoke`,
  `approve/reject_revoke_request`) always writes an audit event in the same transaction as a status
  change, so the absence of one meant this specific change did not go through any governed RPC — almost
  certainly an out-of-band raw SQL `UPDATE` from earlier in the session. The governed recovery RPC
  couldn't even be used to self-fix it (`outranks_role` correctly refuses to let an actor assign
  themselves a role at-or-above their own rank — a real security feature, not the bug). **Fix:** a
  direct, minimal, explicitly-audited manual correction — restored the exact prior row to `Active`, then
  inserted a proper `audit_events` row documenting the manual correction, so the historical record stays
  honest. Only `test212`'s own access was affected; the other 5 members' active memberships were
  completely untouched (the RLS cascade from `test212`'s own broken permissions made it *look* like
  company-wide data loss from the owner's vantage point). **Standing rule established** (saved to
  auto-memory, `no-exploratory-prod-actions.md`): never query or act on the production Supabase database
  — even read-only — without asking the owner first, per-action, every time, regardless of any standing
  authorization from earlier in the same session. Local Docker is always fine for exploration.
- **2026-07-19 — Deferred money-path batch shipped: void-sale approval workflow, Vendors + AP ledger +
  Buy Stock vendor picker, Payroll bonus/incentive** (commits `791a347`, `eb54a0c`, `ee7ab6d`; see §2 for
  the three new feature rows with full verification detail). All three staged one at a time per the
  owner-approved rollout order — full local verify (guard battery + tsc/vitest/build + browser E2E)
  before each production push, migrations applied to production via direct `psql` to the pooler, app
  redeployed to Vercel after each stage, each production push explicitly asked-and-confirmed per the
  standing rule above. One real, would-have-shipped bug caught and fixed in each of two stages during
  porting/E2E (not by inspection): the void-approval reversal would have credited `CASH` instead of the
  actual GCash/Wallet account on a digital-payment void (Team B has no B2A digital-payments concept, so
  their original code doesn't have this gap); a fresh company's empty chart of accounts made the very
  first vendor invoice fail outright until `vendor_invoice_record`/`vendor_payment_record` were made to
  self-seed it. Both fixes locked in with new guard assertions beyond Team B's originals. Full battery
  after the final stage: 29 guards / 0 failures, 94 unit tests, tsc clean, build clean.
- **2026-07-19 — Owner mega-directive batch: POS wholesale-buyer picker, anon-RPC lockdown, mobile UI
  confirmation, sync-queue Discard fix, TOTP 2FA** (commits `17e48e0`, `5e0fd11`, `0036e17`, `b68ccae`).
  **(1) POS Pre-order tab gains a "Registered wholesale buyer" picker**, reusing the existing Customers
  & Credit module (not a new vendor table) via the same non-money-mutating `pos_assign_invoice_customer`
  attribution RPC the Customers screen already uses — separates "Buy Stock vendor" (who we buy from)
  from "Pre-order buyer" (who buys from us to resell) per owner request. Live-verified: linked a Pre-order
  sale to a registered customer, confirmed the invoice attached and Outstanding AR updated correctly.
  **(2) P2O.1 — closed the anon-callable `uuidv7()` id generator** flagged in the earlier open-items
  audit. Root cause was subtler than expected: the function had a `PUBLIC`-pseudo-role grant (from its
  original `CREATE FUNCTION`), not a per-role `anon` grant — `revoke ... from anon` alone was a silent
  no-op (the mirror-image of the P1M.1 bug). First fix attempt (`revoke from public` with no re-grant)
  broke 10 unrelated guard files that legitimately need direct `authenticated`/`service_role` EXECUTE
  (fixture setup, real `service_role` audit-log writes) — corrected to `revoke from public` + explicit
  re-grant to `authenticated, service_role` only, matching the grant shape every other governed function
  in this schema uses. Verified against the full local guard battery (31/31 green) before and after.
  **Not yet pushed to production — needs the owner to run the 2-line SQL themselves** (credential
  handling stays off-limits regardless of authorization); SQL is in `supabase/migrations/20260719100000_p2o1_anon_rpc_lockdown.sql`.
  **(3) Confirmed already-live, no new work needed:** the mobile top-bar hamburger/profile buttons (fixed
  in an earlier same-day commit, `354570e`), the sync-queue pending/blocked indicator (built 2026-07-16,
  confirmed present at every breakpoint), and the employee-tier Dashboard financial restriction (also
  `354570e`). **(4) Sync Issues dialog fix** — the owner's screenshot showed two "stuck" blocked outbox
  items; both were legitimate, correct rejections (an optimistic-concurrency conflict and an RLS denial),
  not bugs, but the dialog only ever offered "Retry now," which for a conflict item is mathematically
  guaranteed to fail forever (the frozen `baseUpdatedAt` can never match again). Added a `reason: 'conflict'`
  tag (`repository.ts`/`queue.ts`) and a `discardBlocked()` action; conflict items now show "re-open and
  re-apply" guidance + Discard instead of a Retry that could never work. Live-verified both branches by
  injecting synthetic Blocked rows and confirming the dialog renders/behaves correctly for each, and that
  Discard actually removes an item. **(5) TOTP two-factor authentication** — project-level TOTP was
  already on (owner-confirmed 2026-07-13) but had no in-app enrollment or challenge flow. Built
  `app/features/auth/mfa.ts` (pure client wrapper over supabase-js's `auth.mfa` API — no migration needed,
  GoTrue owns its own tables), a Two-Factor Authentication card in Profile (QR + manual-entry secret +
  verify step, mirrors BiometricCard's shape), and a router gate (`RequireMfaChallenge`, checks
  `getAuthenticatorAssuranceLevel()`, fails open on error) that redirects an AAL1 session with a verified
  factor to a new `/auth/mfa-challenge` screen before it can reach the app. Live-verified the full round
  trip locally (enabled local `[auth.mfa.totp]` to match production, computed real TOTP codes via RFC 6238
  using Node's built-in `crypto` to complete both the enrollment-verify step and a live post-sign-in
  challenge): enroll → sign out → sign in → correctly redirected to challenge → valid code accepted →
  landed on dashboard → disable cleanly reverts. **Not yet pushed to production** — no migration needed,
  just the app deploy. tsc/vitest(94/94)/build all clean throughout.
- **2026-07-19 — Owner mega-directive, top-to-bottom pass (start): void self-approval rank-gating,
  Buy Stock "bought by" attribution, realtime publication gap, POS Direct Cash picker parity**
  (commits `535a06f`, `5900275`, `fb660e4`, `cd795f3`). **(1) Void self-approval** — owner reported
  being blocked from approving their own void request ("you cannot approve your own void request —
  ask another admin+") even as the real owner. P2N2's separation-of-duties check was a blanket
  `actor = requested_by → deny`, no rank exemption. Added a `pos.void.self` permission key and
  rank-gated the check the same way P1M.2 already exempts owner instant-revoke:
  `actor_rank(company) >= 30` (co_owner/owner) bypasses the block outright; below that, an
  operator/employee can still self-approve only if explicitly granted `pos.void.self`. Guard
  rewritten: SAD2 now asserts admin self-approval **succeeds** (previously asserted it must fail —
  the old assertion encoded the bug the owner hit), new SAD5/SAD6 cover the grant-gated operator
  case both ways. **(2) Buy Stock "bought by" attribution** — owner's concern: an admin-or-below
  with `inventory.purchase` access can record a purchase on the owner's behalf, but nothing captured
  *who actually bought it* versus who recorded it, making manual audit impossible when buying is
  delegated. Added `purchase_receivings.bought_by text`, evolved `inventory_record_purchase` 12→13
  args (`p_bought_by` appended last, default null — existing call sites unaffected), and a narrow
  `inventory_set_purchase_bought_by` RPC (same `inventory.purchase` gate, same-branch-member,
  audited with previous/new value) so the field stays correctable after the fact. **Also brought
  back the per-transaction Purchase Summary ledger** (Date/Item/Source/Amount/Bought By), lost in an
  earlier redesign in favor of aggregate-only tables — the "Bought By" cell is directly editable
  in-place (click → type → blur to save), matching the owner's ask for an easy manual-audit trail.
  **(3) P1K.1 — realtime publication gap** — owner asked to confirm live cross-device auto-sync
  actually works; while auditing found a real bug: `ApprovalsScreen.tsx` subscribes to
  `postgres_changes` on `void_requests`, but P1K's original migration never added that table to the
  `supabase_realtime` publication — a subscription to an unpublished table reports `SUBSCRIBED` but
  silently never fires, so approving/rejecting a void on one session never live-refreshed another
  session's Approvals screen. Fixed with `alter publication supabase_realtime add table
  void_requests`. New `guard:p1k` proves publication membership matches every client subscription
  (`invoices`, `user_branch_roles`, `users`, `void_requests`) but — same disclosed limitation as
  P1K's original entry — cannot prove live event delivery locally (a known Supabase CLI Realtime
  container quirk); a two-browser-tab test on the real production site remains the authoritative
  proof. **(4) POS Direct Cash Clearance gains the same "Registered wholesale buyer" picker** the
  Pre-order tab already had — a cash sale to a repeat wholesale buyer is just as worth tracking in
  Customers & Credit as an unpaid one, and there was no principled reason the picker was
  Pre-order-only. Moved the picker into the section both tabs share and dropped the `saleKind`
  check from `commitSale()`'s customer-linking condition. Live-verified end to end on a fresh test
  company (Docker reset): created a product, created a customer, ran a **Direct Cash** sale with
  the buyer selected, confirmed the resulting invoice appears on that customer's statement
  (`₱135.00`, `Paid`) — proving the shared linkage path fires correctly for both sale kinds, not
  just the pre-order path that was already covered. tsc/vitest(94/94)/build clean for all four.
  **Applied to production 2026-07-19** — git pushed (`5cdb826`), app deployed to Vercel production
  (confirmed live: login page renders on `pick-ur-veggie-farm.vercel.app`). The 4 pending migrations
  (P2O.1 anon-RPC lockdown, P2N2.1 void self-approve rank, P2M3B.1 bought-by, P1K.1 realtime
  publication) were run by the **owner directly** via the Supabase Dashboard SQL Editor — this
  session's standing credential-handling constraint means the assistant does not handle a production
  DB password or service-role key even when offered, and `supabase link`/`db push` cannot reach this
  project's real account from the current CLI login (see the git-ignored
  `supabase/.temp.STALE-LINK-TO-REPO-B-DO-NOT-USE/` marker — it resolves to Repo B's project
  instead). Owner reported all 4 ran with "success, no rows returned" — the correct and only
  possible outcome for all four (each is pure DDL — `revoke`/`grant`/`alter table add column`/
  `alter publication add table`/`create or replace function` — plus one idempotent
  `insert ... on conflict do nothing`; none contain a top-level `select`, and Postgres aborts the
  whole script on the first error rather than partially applying one, so a clean run is a strong
  correctness signal here, not just an absence-of-error report). No further read-only DB
  verification was possible this same way (same credential constraint), so this reasoning is the
  full extent of production verification performed for this push.
  Remaining ~20 items on the owner's mega-list (receipt paper sizes, app icons, mobile font sizing,
  vendor-bill-to-specific-invoice, server-synced settings, real unit conversion, backup re-import,
  deeper accounting reports, and more) are still queued; see the owner's original message for the
  full list and the Team-B handoff-documentation follow-up (3 missing handoffs + 2 stale-note fixes)
  still pending.
- **2026-07-19 — Owner mega-directive, top-to-bottom pass (continued): 7 more items shipped, all
  app-only, deployed to production; one new migration still local-only** (commits `eebadeb`,
  `53a2342`, `023829e`, `2e761bc`, `4f41fdd`, `f93f1fe`, `c80954d`). A local-only audit (the planned
  parallel-agent workflow hit an account-wide session usage cap and returned nothing — redone by hand
  with direct Grep/Read) found several items already built or much closer to done than believed;
  each is fixed at the actual gap, not rebuilt from scratch. **(1) Vendor payment → specific
  invoice(s)** — `vendor_payment_record` already accepted arbitrary per-invoice allocations; only the
  UI auto-FIFO'd (`VendorsScreen.tsx` comment said as much). Payment dialog now lists open invoices
  with an editable apply-amount per row (+ an opt-in "Fill oldest-first" convenience button); the RPC's
  own allocation/overrun checks stay the real backstop, so this shipped as a pure UI change with no
  migration. **(2) Projects "Restricted" visibility — a real latent bug, not a missing feature.** The
  `visibility` column has existed since P2M7A and its own migration header admits enforcement was
  deferred, but the SELECT RLS policy never actually read the column — every `project.read` holder saw
  every project regardless of the flag. Fixed by gating Restricted rows on `project.manage` (the
  permission P2M7A already substitutes for a per-project manager list); `project_tasks` inherits the
  fix through its parent-project join. New migration
  `supabase/migrations/20260719150000_p2m7a_1_project_restricted_visibility.sql` — **local-only, not
  yet applied to production** (same credential-handling constraint as the earlier 4-migration batch;
  needs the owner to run it via the Supabase Dashboard SQL Editor). Guard extended with 4 new
  assertions (Restricted hidden from a same-branch `project.read`-only member, visible to
  `project.manage`, tasks inherit the gate, Public regresses clean) — full 31-guard battery + drift
  clean after a fresh reset. **(3) Receipt paper sizes** — the printed slip took whatever width the
  print driver's default page gave it; added a device Settings toggle (58mm/80mm) and `@media print`
  width rules keyed off it. **(4) Real PNG app icons** — only SVGs existed, so iOS "Add to Home
  Screen" fell back to a screenshot thumbnail instead of a real icon (iOS Safari does not honor an SVG
  apple-touch-icon). Rasterized the existing design at 192/512 (any + maskable) and 180
  (apple-touch-icon) via **.NET WPF off-screen rendering** — no new npm dependency; chosen after a
  browser-canvas-to-base64-to-file approach proved unreliable (manual transcription of a multi-KB
  base64 string silently truncated to ~10% of its length — caught by decoding and checking file size,
  not by `file`'s header-only validation, which reported a "valid" 192×192 PNG on the truncated data).
  **(5) Systematic mobile font shrink** — a single `html { font-size: 15px }` under the mobile
  breakpoint shrinks every Tailwind rem-based utility at once; form inputs pinned to 16px regardless
  (iOS Safari auto-zooms a focused field whose computed font-size drops below that — easy to miss).
  **(6) Scheduling reminders** — the last missing Scheduling sub-item (time ranges/who-sees-what/
  week-day views were already built, confirmed by audit). Client-side Notification API only, no push
  infrastructure exists or is planned; fires 15 min before a timed event while the tab is open, opt-in
  via a bell toggle that requests browser notification permission. **(7) Team-B handoffs** — wrote the
  3 that were missing (void approval, vendors/AP, payroll bonus — handoffs 008/009/010) and struck a
  stale invite-email fix note in handoff 002 (references a file deleted when Invitations was removed
  2026-07-13). Checked the owner's reported "stale Batch-1-hasn't-shipped note" too — did not find it;
  both STATUS.md and handoff 005 already correctly show Batch 1 shipped 2026-07-17, so no fix was
  needed there (reported honestly rather than manufacturing a change). tsc/vitest(94/94)/build clean
  throughout; git pushed and app deployed to Vercel production for all of this except item (2)'s
  migration. Continuing top-to-bottom through the remaining large items (server-synced settings, real
  unit conversion, backup re-import, deeper accounting reports, profit-by-category, purchase-order
  approval, expiration+stock-transfers, equipment depreciation, payroll build-out, Buy Stock receipt
  photo).
