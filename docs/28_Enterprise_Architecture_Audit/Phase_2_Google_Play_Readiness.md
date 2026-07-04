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
- **This slice adds no dependency** and no money/RLS surface — pure static PWA assets + a prod-only SW registration.
  Workbox / `vite-plugin-pwa` is the upgrade path if we later need precise precache or push notifications.
