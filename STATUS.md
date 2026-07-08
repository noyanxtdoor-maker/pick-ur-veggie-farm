# STATUS.md — PickUrVeggie ERP V3 (source of truth for review)

**Owner of this file:** the coding agent (Claude). **Consumer:** a separate reviewer model (GLM) that decides what
to review based on what this file marks "Done." **Rule: never round up.** If a flow was not tested end-to-end by
the agent, or a reviewer has an open issue against it, it is **In Progress** — not Done.

_Last updated: 2026-07-08 · HEAD `be1243d` · branch `feature/phase-0-foundation` (in sync with origin once the §14 commit is pushed)._

---

## 0. READ THIS FIRST — branch & deploy reality (affects every row)

- **Everything below is pushed to `origin/feature/phase-0-foundation` (local HEAD == remote, in sync).**
- **NONE of it is on `origin/main`.** The feature branch is **190 commits ahead of `origin/main`, unmerged.**
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
| All 12 guard batteries (behavioral SQL security tests) | ✅ **164 PASS / 0 DEFECT** |
| `tsc --noEmit` (type check) | ✅ clean |
| `vitest` unit tests | ✅ **89 / 89** |
| `vite build` | ✅ ok |
| Latest CI run on the feature branch (`a327cc9`, HEAD) | ✅ green (install · tsc · test · build · DB guards · secret scan) |
| CI runs a browser? | ❌ no — E2E is manual, mock-mode only |

Guard battery counts: rls-behavior 23 · inventory 24 · payroll 19 · accounting 19 · pos 18 · org 13 · scheduling 15 ·
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
| **Calendar / Scheduling** (M6A events + RLS, M6C visibility tiers, M6D times + now-line + drag, **full DayFlow: Year/Month/Week/Day view set, cross-day drag, all-day rows in every view, event detail panel with CRUD reachable from every view, per-role read-only UX**) | Done (pushed) | 2026-07-06 | **guard** scheduling 15 (tenant/branch/tier isolation, timed-event + end>start, **+ cross-day move allowed+audited for schedule.manage / denied→0 rows for read-only**). **browser-mock** full E2E: create timed + all-day → both render in Day AND Week; edit via detail→modal persists; mark done↔reopen; delete removes from DB; cross-day drag Mon→Tue persisted `event_date` 07-06→07-07 (times preserved); read-only role (schedule.read only) sees events + opens detail to READ but gets "View only" (no New Event, no Management filter, no edit/drag). CAL-1 resolved — see §3. |

### Not built / blocked (for completeness — reviewer should not expect these)
| Item | Status | Note |
|---|---|---|
| B2 digital payments (GCash/Maya/bank) | Not started (Blocked) | Money path. Spec written (`Phase_2_B2_...`); **cross-vendor review now DELIVERED** (`Phase_2_Cross_Vendor_Money_Path_Review.md`, 2026-07-06) = **GO for design**, but implementation is explicitly gated: owner must first sign off the M2E/M2C/M4A/M5A locks (§9), then authorize B2 build against the spec ("do not invert", §6.4). Not startable by the agent. |
| Credit-limit enforcement in sale · delivery-settle tender/change edits | Not started (Blocked) | Money path — owner review/sign-off gate (same review). |
| Cloud signup→approval queue | Not started | Owner-designated cloud phase. |
| Supabase project + HTTPS hosting + Play packaging (AAB/assetlinks) | Not started | Owner infra decisions. |

---

## 3. Open issues (unresolved — block "Done" on the named feature)

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
  The two `XXXXXXX` placeholders in the prior commit (handoff §14 title, this STATUS header) were folded into `be1243d` and then re-folded into `da1db9a` in the amend step; this STATUS entry is the matching append-only maintenance log row.
