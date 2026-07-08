# Phase 2 — Owner Decision Package (5 tracks · audit-ready)

**Type:** Owner-facing decision package (5 sign-off sheets in one place) · **Date:** 2026-07-08
**Branch:** `feature/phase-0-foundation` (tip `3bb498b`, in sync with origin)
**Reviewer:** GLM 5.2 via Hermes CLI · **Audience:** Owner + reviewer
**Authority invoked:** `AI_Company_Charter.md §4.4` (owner gates) · `CLAUDE.md §0` (governance hierarchy) ·
`CLAUDE.md §6` (high-risk domain tripwires)

---

## 0. Why this doc exists

`Phase_2_Context_Reset_Handoff.md §9` already surfaces the five owner-gated tracks as a table.
This package is the **executable form** of that table: one sign-off sheet per track, with the
**exact source document**, the **exact decision the owner must make**, the **exact evidence the
reviewer needs to see**, and the **exact next-step the agent will take after sign-off**.

The agent cannot self-serve any of these — every track is owner-gated per
`AI_Company_Charter.md §4.4`. The agent's only job here is to make the gate **decision-ready
for the owner** and **audit-ready for GLM 5.2**.

**No code, no schema, no RLS surface, no migration.** This is a coordination document.

---

## 1. Track A — Money-path sign-off (locks M2E/M2C/M4A/M5A; unblocks B2)

**Source artifact:** `docs/28_Enterprise_Architecture_Audit/Phase_2_Cross_Vendor_Money_Path_Review.md` (294 lines, owner-delivered 2026-07-06)

**Status:** review delivered; §9 checkboxes all unchecked. Per §1 of that doc (verbatim, lines 43–82) and §7 (lines 254–268):

| Path | Verdict | Source section |
|---|---|---|
| M2E — `pos_record_sale` (live weigh-sale) | **GO** | review §1 |
| M2C — `pos_settle_sale` + `pos_void_sale` (settlement + reversal) | **GO** | review §2 |
| M4A — `record_cash_entry`/`void_cash_entry` + balance-sheet postings | **GO** (with §3.4 fresh-launch notice) | review §3 |
| M5A — `payroll_record_cash_advance` + `payroll_disburse_wage` | **GO** | review §4 |
| B2 — Digital Payments (Bank/GCash/Maya) | **GO for design**; implementation gated on this sign-off | review §6 |

**Cross-cutting holds (verified once, apply to every path):** review §5, lines 208–226.

**Owner decision required:** five checkboxes at review §9, lines 285–291 (verbatim):

- [ ] M2E — lock and push
- [ ] M2C — lock and push
- [ ] M4A — lock and push (with the §3.4 fresh-launch confirmation noted above)
- [ ] M5A — lock and push
- [ ] B2 — authorize implementation against `Phase_2_B2_Digital_Payments_Reconciliation_Spec.md`

**Evidence the reviewer needs:** none beyond the review itself — the deterministic proof
(pos 18 + accounting 19 + payroll 19 + inventory 24 = 80 PASS, plus rls-behavior 23 + the other
batteries = 164 total / 0 defect) is already on `8e1f064` per `STATUS.md §1`. Review §8
explicitly distinguishes what this review is NOT (it is not a substitute for the guards, and
not an end-to-end live-cloud test — that is Phase D).

**What the agent does AFTER owner sign-off:** in the next session, the first action is
`git push` of the local-only commits referenced in `Phase_2_Context_Reset_Handoff.md §2`, then
`supabase db push` to the linked cloud project `jabjyvdkadcbfocaerno` (owner-gated per
handoff §4), then a Phase D cloud E2E run.

**Risk to flag for the reviewer:** B2 is the highest-leverage decision here. Per review §6
("B2 — DESIGN-ONLY review") and handoff §6 ("**Phase C money-path** (B2 GCash/Maya/bank
payments, credit-limit enforcement in the sale, delivery-settle tender/change edits) — blocked
on the **cross-vendor money-path review (charter §4.6)** the owner must run"), B2 has
implementation surface that does NOT exist yet. Signing off B2 today authorizes the
*next* session to start implementation against `Phase_2_B2_Digital_Payments_Reconciliation_Spec.md`.

---

## 2. Track B — CAP-VG1 owner decisions (D1–D4)

**Source artifact:** `docs/28_Enterprise_Architecture_Audit/CAP_VG1_VeggieGenius_AI_Copilot_Spec.md` (179 lines, design-only, owner-timed)

**Status:** spec delivered; D1–D4 owner decisions all pending. The spec itself states (verbatim, lines 8–10):

> "**Precedent:** this mirrors the B2 digital-payments spec — design first, then `spec → review → build → attack → owner-gate → lock` like every other module. **No code is written in this deliverable.**"

**Cross-audit reference:** `docs/28_Enterprise_Architecture_Audit/AI_Feature_Cross_Audit_and_PEGASUS_Reconciliation.md` §3 (recommendation: keep CAP-VG1 as-is).

**Owner decisions required (verbatim from CAP-VG1 §7, lines 146–156):**

- [ ] **D1 — timing GO:** authorize CAP-VG1 implementation. Steps 1–4 are local-only; step 5 waits for the cloud phase.
- [ ] **D2 — model choice:** which LM Studio model(s) — reasoning vs. writing vs. coding profile. The spec is model-agnostic; the answer is a Settings preference.
- [ ] **D3 — RAG corpus:** which docs go in the grounding store — architecture docs (28_Enterprise), SOPs, the schedule/inventory/crop masters? Owner decides what the Copilot is *allowed to know*.
- [ ] **D4 — audit retention:** the C7 §7 default applies; if the owner wants a different retention for `copilot.turn` events, state it now.

**What each decision unlocks (verbatim from CAP-VG1 §6, lines 126–143):**

- **D1 alone** unlocks steps 1–4 (Settings wiring → CopilotPanel shell + client history → grounding + Morning Brief in mock → LM Studio call). All local-only, no money-path crossing, no Supabase dependency.
- **D2** is a Settings UI choice, not a code change — it determines which model field the user picks in the Copilot settings card.
- **D3** determines the doc corpus ingested at step 3; it can be answered with a list of file globs (`docs/28_Enterprise_Architecture_Audit/**/*.md` is the obvious default).
- **D4** is optional — only answer if the C7 §7 default retention is wrong.

**Evidence the reviewer needs:** the spec's §5 guard list (lines 110–122) enumerates the 5 Tier-2 guards that must be added to `scripts/guards/` before the capability can lock. If D1 is granted, the implementer will add those guards as part of the build, and the reviewer should see the guards in the next CI run.

**What the agent does AFTER D1 sign-off:** in the next session, create `app/features/copilot/`, add the 5 guards, ship steps 1–4 through the normal `spec → review → build → attack → owner-gate → lock` cadence. D2/D3/D4 are consumed during the same session as Settings-state additions.

**Risk to flag for the reviewer:** the cross-audit (§3) already recommends (a) keep CAP-VG1 as-is, (b)/(c) rejected. The reviewer should confirm the recommendation against the actual implementation when it lands, not against the spec — the spec is the *design* being audited today, the implementation is the *build* being audited later.

---

## 3. Track C — Supabase project + HTTPS hosting (Phase D cloud prerequisite)

**Source artifacts:**
- `Phase_2_Context_Reset_Handoff.md §4` (line 237–242) — environment + cloud state
- `Phase_2_Google_Play_Readiness.md` "Remaining before a Play upload" #1 (lines 22–25)
- `STATUS.md §0` (lines 11–22) — branch + deploy reality, mock-mode caveat
- Cloud project ID (per handoff §4 line 238): `jabjyvdkadcbfocaerno` — **linked, remote schema EMPTY**

**Current state (honest):**
- App runs in **mock/offline mode** (no `VITE_SUPABASE_*` set)
- Cloud project is **linked** (the agent can `supabase db push` against it) but **remote schema is empty** — 8+ migrations local-only
- Status.md §0 line 22: "**real-cloud path** (online Supabase PostgREST + RPC) for every feature is proven **only by the SQL guard batteries** … — it has **never been tested end-to-end by the app against a live Supabase.** That end-to-end cloud test is a launch-phase task."

**Owner actions required (in order):**

1. [ ] **Provision the Supabase project's API keys** (publishable key + service role key) into a `.env` file. Service role key must NEVER be committed (already in `.env.example`; service role never bundled per handoff §2 security sweep).
2. [ ] **Set up HTTPS hosting for the built SPA** (Vercel / Netlify / Cloudflare Pages). The build output is `dist/` from `npm run build`. Owner decision: which host.
3. [ ] **Authorize `supabase db push`** to apply the local migrations to the cloud project. This is the load-bearing step — until this happens, the linked-but-empty cloud project remains empty.
4. [ ] **Run a real-cloud E2E** of the critical paths (POS sale → accounting pick-up → AR settle). This is the one path `STATUS.md §0` marks unproven.

**What the agent does AFTER owner authorization:**

- For step 1+2: receive env keys from owner via secure channel (NOT in chat); the agent writes them to `.env` and tests the build with `VITE_SUPABASE_URL` set.
- For step 3: the agent issues `supabase db push` against the linked project. This is reversible via migration history, but should still be done in a maintenance window.
- For step 4: the agent exercises the POS → accounting flow against the live cloud, then writes the result to `STATUS.md §1` and updates §4 (cloud-stamped, append-only log).

**Evidence the reviewer needs:** after the E2E, `STATUS.md §1` should have a new row showing live-cloud verification; the handoff §4 should record the env keys are set (without revealing the keys).

**Risk to flag for the reviewer:** `db push` is a **financial-domain tripwire** per `CLAUDE.md §6` (B2/C7 §4). The 164-guard battery must have been re-run on the cloud's freshly-pushed schema before any money-path code is touched. The money-path review (Track A) must be signed off before B2 implementation starts against the live cloud.

---

## 4. Track D — Branch protection (Phase 1 precondition)

**Source artifact:** `docs/28_Enterprise_Architecture_Audit/Stage_D_Branch_Protection_Precondition.md` (89 lines, BINDING)

**Current state (honest, from §18–25 of the source):**
- `main` and `develop` branch protection: **NOT YET ENABLED**
- A **Temporary Solo-Founder Enforcement Exception** is active (per source §49–76) — single-owner repo, GitHub Free cannot enforce on private repos
- Compensating controls are in place: `main` is release-only, `develop` requires PR + CI + owner merge
- The exception auto-expires the moment a second contributor exists, Pro becomes available, or product maturity hits production

**Owner actions required (the source spec is binding; UI steps are operational at apply-time):**

1. [ ] **Decide: enable real protection now, or continue under the exception?**
2. [ ] If yes: GitHub Settings → Rules → Rulesets (or classic branch protection, if available) → apply the **Approved Branch Protection Configuration** from source §27–47 to `main` and `develop`. Required status checks: `verify`, `secrets` (exact names from a real Actions run).
3. [ ] If exception continues: re-evaluate at every Stage D phase boundary (already a standing rule in source §73).

**Evidence the reviewer needs:** the source's "Approved Branch Protection Configuration" (§27–47) is the durable standard. The reviewer should see either (a) a screenshot/curl proof of the GitHub settings showing the config applied, or (b) the exception is still valid and compensating controls are documented in the next handoff revision.

**What the agent does AFTER owner decision:**

- If real protection enabled: the next session can proceed to Phase 1 (Identity/Tenant/Security) without the exception.
- If exception continues: the next session records the re-evaluation in the handoff §4 and continues under compensating controls.

**Risk to flag for the reviewer:** per source §81–84, **if branch protection is disabled and no valid exception is active, Phase 1 authorization MUST BE DENIED.** This is a hard gate, not a soft one. The current "exception is active" status means Phase 1 is not blocked today, but every re-evaluation is a checkpoint.

---

## 5. Track E — Play Console account (AAB submission)

**Source artifact:** `docs/28_Enterprise_Architecture_Audit/Phase_2_Google_Play_Readiness.md` (47 lines, TL;DR at lines 6–12)

**Current state (from source §6–12, "TL;DR — how close?"):**
- Step 1 (PWA foundation: manifest, SW, icons, prod-only SW registration) **SHIPPED** in commit `c896566`, browser-verified
- Steps 2–6 (PNG icons, Bubblewrap wrap, assetlinks, Play Console paperwork, pre-launch hardening) all **pending** — all owner/infra, not code

**Owner actions required (verbatim from source §22–38, in order):**

1. [ ] **(Track C prerequisite) Backend + HTTPS hosting** — Play/TWA needs the PWA live at a real HTTPS origin.
2. [ ] **PNG icon set for Bubblewrap** — 48–512 px + a 512 maskable. Generate from the existing SVG at wrap time.
3. [ ] **Wrap to AAB** with **Bubblewrap** (`@bubblewrap/cli init --manifest https://<host>/manifest.webmanifest`) or PWABuilder → signed `.aab`.
4. [ ] **Digital Asset Links** — host `/.well-known/assetlinks.json` with the app's signing-key SHA-256 so the TWA runs full-screen.
5. [ ] **Play Console paperwork** — $25 developer account, app listing, **Privacy Policy URL** (required: we handle financial + staff PII), **Data Safety** form, content rating, current Android target SDK requirement, closed or internal test track.
6. [ ] **Pre-launch hardening** — money-path items, branch protection, CI audit of the pushed tree (per Track A/D + the standing CI-audit rule in handoff §0).

**Evidence the reviewer needs:** after the AAB is signed and uploaded to the internal test track, the Play Console URL is the proof. The assetlinks.json file should be served at `https://<host>/.well-known/assetlinks.json` and validated by Google's TWA validator.

**What the agent does AFTER Track C lands and the owner gives the AAB command:**

- The agent generates the PNG icons from the existing SVG (a one-time `sharp` or `puppeteer` script — no new dependency commitment, the script is one-shot).
- The agent runs `npx @bubblewrap/cli init` against the live manifest URL, then `npx @bubblewrap/cli build`.
- The agent writes `assetlinks.json` to the host's `public/.well-known/` directory and rebuilds.
- The agent does NOT touch the Play Console account itself (account credentials are owner-only).

**Risk to flag for the reviewer:** the Privacy Policy and Data Safety form are *legal* artifacts, not engineering. The owner should not skip them. Per the source's "Honest risk notes" (§40–46), the offline-write attribution on shared terminals (B5) is the only outstanding operational risk; it's not a launch-blocker for a single-operator farm, but it's a flagged item.

---

## 6. What the agent will NOT do without explicit owner GO

Per `AI_Company_Charter.md §4.4` ("Owner gates: push, deploy (`db push`), migrations to cloud, module starts — explicit go only") and `CLAUDE.md §3` ("Do not commit or push without explicit approval"):

- **No `supabase db push`** without owner authorization (Track A sign-off + Track C step 3).
- **No CAP-VG1 implementation** without D1 GO.
- **No B2 implementation** without the §9 sign-off on the money-path review.
- **No force-push or history rewrite** on `main`/`develop`.
- **No edits to Systems 10–26, B1–B8, C1–C8, or any locked architecture** without a new ADR/ODR.
- **No new dependency** without justification per `CLAUDE.md §4` ("Every new dependency requires written justification at review time").

---

## 7. What GLM 5.2 should verify

If you are auditing this package:

1. **Track A (money-path):** the review doc at `Phase_2_Cross_Vendor_Money_Path_Review.md` is the source of truth. Confirm that §1 verdict = GO, §2 = GO, §3 = GO (with §3.4 notice), §4 = GO, §6 = GO for design. Confirm the 5 checkboxes at §9 are unchecked. Confirm `STATUS.md §1` shows the 164-guard battery still green.
2. **Track B (CAP-VG1):** the spec is design-only. Confirm §5 lists 5 guards. Confirm §6 has 5 steps with steps 1–4 local-only. Confirm §7 lists 4 owner decisions. Confirm `AI_Feature_Cross_Audit_and_PEGASUS_Reconciliation.md §3` recommends (a).
3. **Track C (Supabase+hosting):** confirm the handoff §4 records the cloud project as linked-but-empty, and that `STATUS.md §0` line 22 honestly states the real-cloud path is unproven end-to-end.
4. **Track D (branch protection):** confirm `Stage_D_Branch_Protection_Precondition.md §18–25` records the current NOT-YET-ENABLED state and the active exception.
5. **Track E (Play Console):** confirm `Phase_2_Google_Play_Readiness.md §6–12` ships Step 1 (`c896566`) and that §22–38 lists the 6 remaining steps.

**Honest gaps to flag if you find any:**
- Track A's §3.4 fresh-launch notice has NOT been confirmed by the owner yet. This is the only conditional GO in the whole review.
- Track C step 1 (provisioning env keys) has no documented mechanism for the owner to send keys to the agent securely. Recommend a channel (1Password shared vault, encrypted email, etc.) before the owner authorizes this track.
- Track E step 2 (PNG icons) requires a one-shot script. The agent has not yet written it; it will be created when Track C lands.

---

## 8. Change log

- **2026-07-08** — created. First version of the consolidated decision package; no other files modified. The 5 tracks here mirror `Phase_2_Context_Reset_Handoff.md §9` "Owner-gated actions surfaced this session" (lines 354–362), expanded with the exact source, exact decision text, exact reviewer-evidence requirement, and exact post-sign-off next step for each.
