# Phase 2 — Google Play Readiness Assessment

**Type:** Readiness assessment (answers owner question: "how close are we to launching on Google Play?") · **Date:** 2026-07-03
**Stack reality:** React 19 + Vite SPA (M1B named it a "Vite **PWA**"). No native code. Distribution path = **PWA → Trusted Web Activity (TWA)** wrapped to an Android App Bundle (AAB) via Bubblewrap / PWABuilder.

## TL;DR — how close?
**Functionally: strong.** The ERP itself is feature-complete for a first release (POS, Inventory, Dashboard,
Accounting + reports + cash-flow, Payroll, Scheduling, Projects, Settings, Customers/credit).
**For Play distribution: early.** Before this slice we had *zero* app-packaging (no manifest, no service worker,
no icons, no Android wrapper). This slice ships the **installable-PWA foundation** — the first hard requirement.
Realistic gap to a Play *internal-testing* upload: **a few focused days**, most of it hosting + wrapping + Play
account/policy paperwork, not app code.

## What this slice delivered (✅ done, browser-verified)
- **Web App Manifest** (`public/manifest.webmanifest`) — name, `standalone` display, `start_url`/`scope` `/`,
  theme `#003e1c`, background `#f7fbef`, `any` + `maskable` icons.
- **Service worker** (`public/sw.js`) — network-first navigation + stale-while-revalidate assets, so the shell
  loads offline and the app is **installable**. Registered in `main.tsx` **production-only** (dev HMR untouched).
- **Icons** (`icon.svg`, `icon-maskable.svg`) + `<link rel=manifest>`, `theme-color`, apple-touch meta in `index.html`.
- Verified: build emits all four artifacts to `dist/`; manifest + sw served `200`; SW registers cleanly; no console errors.

## Remaining before a Play upload (in order)
1. **Backend + HTTPS hosting.** The app currently runs in **mock/offline mode** (Supabase not configured; no
   `VITE_SUPABASE_URL`/`ANON_KEY` set). Play/TWA needs the PWA live at a real HTTPS origin. → stand up the Supabase
   project + host the built SPA (Vercel/Netlify/Cloudflare). *(Owner/infra decision — not a code task.)*
2. **PNG icon set for Bubblewrap.** Chrome installability accepts our SVG icons, but Bubblewrap rasterizes to
   PNG launcher icons (48–512 px) + a 512 maskable. Generate from the SVG at wrap time.
3. **Wrap to AAB** with **Bubblewrap** (`@bubblewrap/cli init --manifest https://<host>/manifest.webmanifest`) or
   PWABuilder → signed `.aab`.
4. **Digital Asset Links** — host `/.well-known/assetlinks.json` with the app's signing-key SHA-256 so the TWA runs
   full-screen (no browser URL bar). Bubblewrap generates the fingerprint.
5. **Play Console paperwork** — $25 developer account, app listing, **Privacy Policy URL** (we handle financial +
   staff PII → required), **Data Safety** form, content rating, the current Android target SDK requirement, and a
   closed or internal test track. (Wording note: this sentence once tripped the CI secret scanner's generic
   pattern — keep it plain prose.)
6. **Pre-launch hardening** — the pending money-path items are **not launch-blockers for the current feature set**,
   but the standing owner gates still apply before a *production* release: CI audit of the pushed tree, the
   cross-vendor money-path review (M2E/M4A/M5A), and branch protection (Stage D precondition).

## Honest risk notes
- **Offline-write attribution on shared terminals** (B5 domain): the outbox is preserved across logout, so an
  offline write queued by cashier A could sync under cashier B's session. Fine for single-operator devices; revisit
  before multi-cashier shared-terminal use (Phase 3 offline-sync work). *(Export no longer leaks the outbox — fixed
  this session.)*
- This slice adds no dependency and no money/RLS surface — pure static PWA assets + a prod-only SW registration.
  Workbox / `vite-plugin-pwa` is the upgrade path if we later need precise precache or push notifications.

---

## 7. Authorization record (2026-07-08 — owner pasted the §12 Track E prompt verbatim)

**Owner authorization (verbatim from `Phase_2_Context_Reset_Handoff.md §12`):**

> "Approve Track E. Track C must land first. Play Console account: [email]. After Track C: next session generates the PNG icons, runs `npx @bubblewrap/cli init` + `build`, hosts `/.well-known/assetlinks.json`, and prepares the AAB for upload (the owner submits via Console UI)."

**Owner decisions (resolved by the prompt's bracketed values, recorded as the agent understood them):**

- [x] **Track C prerequisite ordering** — **APPROVED 2026-07-08**. Track C must land first (the Play/TWA needs the PWA live at a real HTTPS origin per step 1 above). The Track E "next session" actions are sequenced AFTER Track C's `db push` + hosting stand-up.
- [x] **Play Console account email** — **TBD by owner**. The prompt's `[email]` placeholder was not filled. The Play Console account itself is owner-only — the agent does NOT create or touch the Console account, per the §6 "What the agent will NOT do" line of the decision package. The email is needed only so the owner can receive the Bubblewrap signing-key fingerprint and the AAB upload confirmation.
- [x] **Owner submits via Console UI** — **APPROVED 2026-07-08**. Per the prompt and the source spec's "agent does NOT touch the Play Console account itself (account credentials are owner-only)" rule, the owner is the one who clicks the upload button in the Play Console UI. The agent's job ends at "AAB signed and ready at <local path>."

**What was done in this session (the doc-only record half):**

- Added this §7 as the append-only authorization record.
- Added handoff §14 documenting the same.
- Added STATUS.md §4 matching entry.

**What is QUEUED for the next session that has the right environment (the package + upload half of the §12 prompt):**

The §12 prompt's "PNG icons + Bubblewrap + assetlinks + AAB" half cannot start until Track C lands. The implementation sequence (per the spec's own §22–38 steps 2–4, in order) is:

1. **Step 2 (PNG icons, after Track C lands):** generate the 48/96/144/192/256/512 px PNGs + a 512 maskable PNG from the existing `public/icon.svg` + `public/icon-maskable.svg`. One-shot script using `sharp` (or `puppeteer` headless rendering of the SVG); per the decision package §5 honest gaps, this script is NOT yet written and will be created when Track C lands. The script is one-shot, not a new project dependency commitment.
2. **Step 3 (Bubblewrap, after step 2):** run `npx @bubblewrap/cli init --manifest https://<host>/manifest.webmanifest`, then `npx @bubblewrap/cli build` → signed `.aab` at `app-release-signed.aab`. Requires Node + JDK 17 + the `bubblewrap` package.
3. **Step 4 (Digital Asset Links):** Bubblewrap generates the signing-key SHA-256 fingerprint; the agent writes `/.well-known/assetlinks.json` to the host's `public/.well-known/` directory and rebuilds. The TWA validator then confirms the asset-link is live.
4. **Step 5 (Play Console paperwork, owner-only):** $25 developer account, app listing, **Privacy Policy URL** (we handle financial + staff PII → required), **Data Safety** form, content rating, current Android target SDK requirement, internal-test track. The agent does NOT touch the Console UI.
5. **Step 6 (Pre-launch hardening, owner-gated):** the standing owner gates still apply before a production release — CI audit of the pushed tree (handoff §5), the cross-vendor money-path review (Track A), and branch protection (Track D).

**Honest scope note (for GLM 5.2 audit):**

- The Track E "sign-off" half is recorded and on both remotes.
- The Track E "package" half is BLOCKED on Track C and QUEUED. No PNG icons were generated, no Bubblewrap was installed, no assetlinks.json was written, no AAB was built, no Play Console account was touched.
- The "Play Console account: [email]" placeholder is the only open owner input on Track E; the agent has no business creating or accessing that account.
