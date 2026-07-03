# Phase 2 — Module 8: Settings Hub (spec)

**Type:** Module spec · **Status:** Built (M8, client-only) · **Date:** 2026-07-03 · **Branch:** `feature/phase-0-foundation`
**Roadmap position:** LAST core operational module (POS → Inventory → Dashboard → Accounting → Payroll → Scheduling → Projects → **Settings**).
**Workflow authority:** prototype `src/features/Settings.tsx`. **Structural authority:** enterprise Systems 10–26.

## 1. What this module IS
A per-device **Settings Hub**: the signed-in operator personalizes *this browser* — colour theme and register labels —
without touching any tenant record. It is deliberately the smallest honest module in Phase 2: **no migration, no new
permission, no new RLS surface.** A device configuring its own look and labels is not a governed server operation.

## 2. Scope (built)
- **Appearance — theme switcher.** The prototype's four palettes (`light` Fresh Wood / `dark` Cosmic Mint /
  `cream` Warm Retro / `green` Green Pastures), ported verbatim into `app/index.css` as `html[data-theme=…]`
  overrides of the farm CSS variables. Tailwind v4 emits utilities as `var(--color-farm-*)`, so flipping
  `<html data-theme>` recolours the whole app live. Persisted in `localStorage` (`puv_theme`) and applied at boot
  (`initTheme()` in `main.tsx`, before first render → no flash).
- **Station preferences.** `farm_display_name` and `terminal_id`, persisted per-device (`localStorage`, `puv_`
  prefix — same keys the prototype used). Both are **consumed live** by the app shell: the header title shows the
  display-name override (falling back to the company record), and the session pill shows the terminal ID. Save as
  you type. No dead settings — everything stored is surfaced.
- **Data & Backup, Session cards.** Informational: data syncs to the company cloud automatically; sign-out is
  surfaced here as well as the top bar.

## 3. Deliberately deferred (backlog — see `Phase_2_Mockup_Reference_and_Backlog.md`)
The prototype's Settings also did local-only IndexedDB operations that do **not** map to a multi-tenant server app
as client buttons; each becomes a governed, permission-gated feature later:
- **Google-Drive cloud sync / JSON export / import / factory reset** → backlog **B7** (governed backup & export).
- **VAT / tax level, currency policy, receipt footer, wholesale-discount default, scale-simulation mode** → these
  are either server policy (tax, pricing) or unwired hardware config; not persisted as theatre. Revisit when the
  consuming engine exists (e.g. a tax engine, a real scale integration). Farm-discount today is server-fixed (M2E).

## 4. Why no permission / migration
Theme + device labels are client state. They read no tenant rows and write none — so there is nothing for RLS to
guard and no schema to add. Adding a `settings.*` permission or a `user_preferences` table now would be speculative
(YAGNI): if org-level *shared* settings arrive later (e.g. company-wide tax policy), THAT feature brings its own
table + permission + guard. This module intentionally does not.

## 5. Verification
- `tsc` clean · `vitest` (prefs: theme validation/persistence/apply + generic pref fallback) · `build` OK.
- Browser E2E: switch theme → app recolours live and survives reload; edit terminal ID → header pill updates.
- No DB reset / guard battery: there is no SQL surface in this module.
