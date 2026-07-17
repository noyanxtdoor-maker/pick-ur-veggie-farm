# Handoff 006 — P1C3: Section Access redesign + admin default narrowing, 2026-07-17

**Direction note:** this one is NOT a port from either direction — it's original work built in Repo A
in response to an owner directive that superseded our own just-shipped P1C2 ("Module access", itself
ported from your commit `1b3613a`). Sharing because it fixes two bugs your P1C2-equivalent likely
shares, and because the underlying design pattern (a parameterized resolver instead of a module-column
lookup) may be useful if you ever need one permission key to gate more than one UI surface.

## What changed and why

The owner looked at the shipped P1C2 dialog and asked for three things: (1) rename "Module access" to
"Access," regroup by the REAL nav bar instead of the abstract 8-module permission-catalog grouping,
with 3-level progressive disclosure (section Visible/Not-Visible → its tabs' Visible/Not-Visible →
Read or Edit & Manage); (2) admin-and-below on payroll should see only their own pay record by default;
(3) admin should be able to approve pending sign-ups by default, but Revoke/Archive/Access/Reassign
should stay hidden unless granted, and admin should only see the Approvals tab under "Approvals &
Roles" by default.

## Two bugs found and fixed along the way — worth checking your own repo for the same shapes

**Bug 1 — "Not Visible" has never actually worked for a role-holder.** Our P1C2's
`moduleAccessApi.apply()` wrote `effect: null` (clear any override) for the "none" target instead of
`effect: 'deny'`. For anyone whose ROLE already granted baseline access to a module (nearly everyone,
since every module has baseline role coverage) — clearing a nonexistent override does nothing, the
resolver still finds access via the role. The resolver (`user_module_access`) also never checked a
deny override on the READ key, only the manage key. Net effect: clicking "Not Visible" only ever
worked as a no-op, for someone who already had zero access. If your equivalent panel's "apply" logic
writes `null`/clears instead of an explicit `deny` for the lowest tier, you likely have the same gap —
worth a quick check.

**Bug 2 — client-side permission snapshot silently unions in OTHER members' permissions.**
`app/core/permissions/permissions.tsx`'s `loadSnapshot()` queried `user_branch_roles` and
`user_permission_overrides` with no `user_id` filter, on the assumption that RLS restricts results to
"my own rows." It doesn't — both tables have TWO permissive SELECT policies OR'd together: "own row,"
AND "any row in the company if you hold `membership.read`" (or `membership.manage` for overrides). So
anyone with broad read access (admin+) had their client-side `has()` snapshot silently computed as the
UNION of every company member's role permissions they could see — not just their own. We only caught
this because our new redesign made a narrower-than-owner default role (admin) visibly wrong in a live
E2E test: their dashboard showed keys only the OWNER should have. Fix was one explicit
`.eq('user_id', me)` filter (using the existing `current_app_user_id()` RPC) on both queries. **If your
repo has an equivalent client-side permission-snapshot cache, and any table it queries has an
"own-row-OR-broad-visibility-for-managers" RLS shape, check whether the client query filters to the
caller's own user_id explicitly** — ours didn't, for months, and it was invisible until a narrower role
tier actually existed to expose it.

## The technical pattern, if useful to you

P1C2's `user_module_access(company, user, module)` resolver keys everything off a single
`permissions.module` TEXT column — meaning one permission key can only belong to one "module" bucket.
Our redesign needed `membership.manage` to serve as the manage-tier key for THREE different UI tabs
(Approvals/Members/Archived) simultaneously, which a single-column-per-key design can't represent. Our
fix: a second, additive resolver `user_key_tier(company, user, read_key, manage_key)` parameterized
directly on key NAMES instead of a module-column lookup — same none/view/manage logic, just generalized
so the same key can be the manage-tier for as many different UI nodes as needed, no schema change
required. We kept the original `user_module_access`/`permission_modules` defined (harmless, unused by
the new client) rather than migrating/dropping them, to keep the change purely additive.

## Files (Repo A paths, for reference — nothing here needs porting, just checking your equivalents)

| Item | File |
|---|---|
| New resolver + admin narrowing + RPC relaxation | `supabase/migrations/20260717140000_p1c3_nav_access_and_admin_narrowing.sql` |
| Guard battery (11 assertions incl. the Bug-1 regression test) | `scripts/guards/p1c3-nav-access-security.sql` |
| Nav-shaped Access API (was moduleAccess.ts) | `app/features/organization/overrides/access.ts` |
| Access dialog (was ModuleAccessDialog.tsx) | `app/features/organization/overrides/AccessDialog.tsx` |
| Permission snapshot fix (Bug 2) | `app/core/permissions/permissions.tsx` |
| Approvals gating split | `app/features/organization/approvals/ApprovalsScreen.tsx` |

## Verification (Repo A, first-hand)

tsc clean · 92/92 vitest · build clean · clean-reset battery: 24 guard files ALL PASS (23 prior + new
p1c3) + static + drift PASS. Live browser E2E with a real owner + a real fresh admin-tier account
(approved through the actual UI, not a fixture): admin defaults to Approvals-tab-only, self-only
payroll, can approve a fresh signup end-to-end, cannot see Revoke/Archive/Access/Reassign on ANY row
(including a non-self row, proving the gate isn't just self-hiding) — then, after the owner granted
`membership.manage` via the new Access dialog, admin's next load correctly showed Members + Archived
newly visible (Company/Branches/Roles correctly stayed hidden, since those need different keys the
grant didn't touch) plus the four buttons. Pushed + deployed to production 2026-07-17; pre-flight check
confirmed zero production admin-tier members were missing a payroll link before the narrowing shipped.
