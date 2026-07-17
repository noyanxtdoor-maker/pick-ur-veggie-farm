# Handoff 005 — Reverse-parity ports FROM Repo B: username onboarding (P1N), Batch 1 fixes,
# Reports/Crops-deletion/sync-animation (Phase A), merged permissions panel (P1C2 / item C, Phase B)
# 2026-07-17

**Direction note:** like handoffs 003/004, this documents Team A porting FROM Team B (plus one
self-discovered fix along the way, called out explicitly). Nothing here needs porting back to B — it's
a parity record.

## What landed in Repo A

### P1N — post-approval username onboarding

| Item | B origin | A files |
|---|---|---|
| `set_chosen_username` RPC + `users.username_chosen_at` gate | B's onboarding migration | `supabase/migrations/20260717110000_p1n_post_approval_username_onboarding.sql` |
| Guard battery (5 assertions) | — | `scripts/guards/p1n-username-onboarding-security.sql` |
| API + screen + router gate | — | `app/features/auth/onboarding.ts`, `app/pages/ChooseUsername.tsx`, `RequireUsernameOnboarding` in `router.tsx` |

An approved user with `username_chosen_at IS NULL` is redirected to `/onboarding/username` before
reaching the app; one-time-only (the RPC raises on re-entry). MOCK_MODE skips the gate.

**Known inherited limitation** (same shape as B's own shipped code, not fixed): the gate's `useEffect`
only depends on `[status]`, not on membership/approval changes within the same tab session — a user
approved while their tab is already open bypasses onboarding until a full reload. Documented, not
silently patched, since the mission was faithful parity, not exceeding B's own product decision here.

**Pushed + deployed to production 2026-07-17** (deploy hit a transient Vercel `ECONNRESET`, 7 attempts,
resolved on retry — not a Vercel-side incident, see STATUS.md maintenance log for the full diagnosis).

### Batch 1 — display gates + one real permission-grant fix

1. **Awaiting-approval "0.5s peek" fixed** (ported from B `5ab18eb`/`241badb`) — `AppShell.tsx` now
   blocks `<Outlet/>` from mounting during the resolving window in real (non-mock) mode.
2. **Role-key regex bug** (self-discovered, not from B) — `codeSlug` in `organization.ts` was
   uppercase-only while its own error message promised "A–Z, 0–9, dash"; a naturally-typed lowercase
   key like `cashier` was silently rejected. No server-side case constraint exists; regex relaxed.
3. **Four role-visibility gates** (Dashboard org-stats+Quick-Actions, POS branch-picker+Export-CSV,
   Reports nav, Schedules "General" chip) — gated to admin+ (`has('membership.read')`/
   `has('accounting.read')`), matching the owner's own screenshot.
4. **`project.read` gap, self-discovered** — our `seed_standard_roles()` granted employee/operator zero
   project keys (B's schema grants read to all roles). New migration
   `20260717120000_p1h1_project_read_all_roles.sql` (adds `project.read` to employee+operator + a
   direct backfill INSERT for existing companies) + guard `p1h1-project-read-all-roles-security.sql`.

**NOT yet pushed to production** — awaiting the owner's explicit push authorization.

### Phase A — Reports placeholder, Crops & Plans deletion, sync-button animation

1. **Reports placeholder** rewritten with Reports-specific honest copy (`app/pages/Placeholder.tsx`).
2. **Crops & Plans tab deleted entirely** (owner's explicit final instruction, not archived) — 8 files
   removed under `app/features/crops/` + `app/schemas/crops.ts`; route subtree + lazy imports removed
   from `router.tsx`; legacy `/crops/*` redirect retargeted to `/dashboard`. Offline Dexie `crop_*`
   tables/types/mock seeders deliberately retained (purging risks an offline-migration break on
   installed on-device Dexie DBs — the dead tables are harmless).
3. **Sync button animation** — `AppShell.tsx` TopBar gets a decoupled `uiSyncing` state (700ms minimum
   spin) + a new full-screen `.syncoverlay` shimmer/pulse in `index.css`, so a tap visibly reacts across
   the whole screen, not just the icon.

**NOT pushed to production** — local-only, app-code changes (no new migration in this phase).

### Phase B — item C: the merged 3-state permissions panel

Ported from your commit `1b3613a` (server, `20260716140000_p1c2_module_access_overrides.sql`, which you
labeled "part 1 of 2") plus your subsequent client build (`moduleAccess.ts` + `ModuleAccessDialog.tsx`).

| Item | B origin | A files |
|---|---|---|
| `permissions.module` column + backfill + `permission_modules` view + `user_module_access()` resolver | `1b3613a` | `supabase/migrations/20260717130000_p1c2_module_access_overrides.sql` |
| Guard battery (7 assertions) | — | `scripts/guards/p1c2-module-access-security.sql` |
| `moduleAccessApi` (catalog/tier/apply) | `app/features/organization/overrides/moduleAccess.ts` | same path |
| `ModuleAccessDialog` (8 module rows, 3-state toggle, keys disclosure) | `app/features/organization/overrides/ModuleAccessDialog.tsx` | same path |

**Deltas vs your implementation (informational):**

- **Different wiring target.** Your `ModuleAccessDialog` opens from a new "Set module access" button
  you added additively inside `memberships.tsx`'s `EditMembership` panel — it doesn't touch your
  Approvals screen. Our owner's actual complaint named a specific on-screen label — "reduce the buttons
  on the **Active POS User Directory**" — which is the table in *our* `ApprovalsScreen.tsx`, not
  `memberships.tsx`. So we wired the merged panel there instead: replaced the two existing buttons
  ("Set Permissions" link to Roles + the old per-key binary "Overrides" dialog) with ONE "Access"
  button on that exact table. `memberships.tsx` in Repo A was not touched.
- **The old key-level Overrides dialog is gone, not kept alongside.** Your Approvals screen still keeps
  both the old "Set Permissions" link and the old "Overrides" dialog next to the new module-access
  button on the Members tab — three permission-adjacent affordances total across two screens. We fully
  retired the old `overrides.tsx` (`OverridesDialog`/`overridesApi`) once the module panel replaced its
  only call site (confirmed via grep before deleting) — one merged control, one screen, matching the
  owner's literal "reduce the buttons" instruction rather than adding a fourth affordance.
- **9-module catalog, not 8.** Our schema has `finance.account.read`/`.manage` (P2-B2A digital
  payments) which your 31-key catalog doesn't carry — bucketed into `accounting` rather than the vague
  `system` catch-all, keeping the *named* module count at your screenshot's 8 (accounting/customers/
  inventory/organization/payroll/pos/projects/scheduling), with `system` as a 9th UI-hidden catch-all
  for `crop.manage` (idle since our Crops tab deletion, Phase A above) — matching your own "system"
  bucket concept, just with one more real key routed into a named module instead of the catch-all.
- **Explicit anon-revocation on the view too, not just the function** — self-caught lesson from our
  P1M/P1M.1 port (see handoff 004): this Supabase project's production default-ACL grants EXECUTE/SELECT
  to `anon` broadly on new relations, in a way local dev does not replicate. We wrote
  `revoke all on public.permission_modules from public, anon` from the start rather than discovering the
  gap after a production push. Worth checking whether your `permission_modules` view has the same
  default-ACL exposure on your project.

## Verification (Repo A, first-hand)

tsc clean · 92/92 vitest · build clean · full clean-reset battery — **22 SQL guard files ALL PASS**
(p1n, p1h1, p1c2 all new and green; no regression on the other 19) + static-guards + drift both PASS.

**Live browser E2E against the real local Postgres** (not mock) — two freshly signed-up accounts: an
owner bootstrapped via `bootstrap_initial_tenant`, an employee approved through the real Approvals UI.
Confirmed:
- The Active POS Users Directory row shows exactly one "Access" button (down from two).
- Opening it reads the employee's *real* resolved state live: `pos`/`projects`/`scheduling` = View-only
  (from their seeded role's `pos.sell`/`project.read`/`schedule.read`), all other modules = Not Visible.
- Toggling `accounting` to View-only and saving produced, confirmed by direct DB query:
  `accounting.read = grant`, `accounting.manage = deny`, and `user_module_access()` immediately
  resolving `accounting` to `view` — a full live round trip through the real UI → RPCs → resolver, not
  just a compile check. Zero console errors during the flow.

All E2E fixtures (test company + both accounts) wiped via a final `supabase db reset`.

**Pushed + deployed to production 2026-07-17.** P1H.1 and P1C2 both applied cleanly via the session
pooler, single-transaction each, zero errors — P1C2's backfill row counts matched the local run exactly.
Read-only post-push checks against `aqhxhamdwmhcwxmebqbo` confirmed the role backfill, the grant shape
(anon excluded from both the resolver and the view), and — a live functional check against the real
production owner, not a fixture — `user_module_access()` correctly resolving `manage` on all 9 modules
for them. App deployed and smoke-tested clean. Phase A had no migration (app-code only), shipped in the
same deploy.
