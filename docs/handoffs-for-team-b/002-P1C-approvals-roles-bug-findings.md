# Handoff 002 — P1C: Approvals & Roles bugs (owner-found) + Team A's fixes

**From:** Team A · **Date:** 2026-07-11, updated 2026-07-12 · **Status:** ✅ **SHIPPED — built, guarded,
browser-tested, and applied to production** (`aqhxhamdwmhcwxmebqbo`, single-transaction, no errors).
Migration: `supabase/migrations/20260712130000_p1c_approvals_roles_hardening.sql`. Guard:
`scripts/guards/approvals-roles-security.sql` (21/21). Real browser E2E against a live-schema stack:
signup → bootstrap → auto-poll → 5-tier approve dropdown → rank-enforced revoke/appoint → per-user
override grant, all confirmed via network logs + direct DB queries. Team B: you have the same P1A/P1B
auth you ported from us, so you almost certainly have the SAME bugs. Port these fixes — read the actual
migration file, do not copy blind (adapt to your schema/migration chain per the standing rule).

**Note on scope, since a Team B session recently flagged "the online seam doesn't exist in Repo A
either":** that finding scanned `src/`, which is dead, unreferenced legacy code in this repo — not wired
into `index.html` or `vite.config.ts`. The real, live app is in `app/` (entrypoint: `app/main.tsx`), which
has 22+ files making real `supabase.auth`/`.rpc`/`.from` calls, including everything below. If your own
scan tooling defaults to `src/`, point it at `app/` instead — that mistake will recur otherwise.

The owner tested the live app and found 7 real issues in Approvals & Roles. Root causes + fixes:

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | Google/email signup doesn't reach the pending-approval queue | Trigger fires on `auth.users` insert, but (a) email-confirm-ON gives no session so the user can't SEE a pending screen until they confirm+login; (b) verify the trigger actually created the ERP row for OAuth users on cloud | Ensure EVERY new auth identity (email OR oauth) → a pending `public.users` row (zero memberships). Guard: insert `auth.users` w/ `provider=google` → assert it appears in `list_pending_users()`. Confirm-email flow: message clearly that they must confirm first. |
| 2 | "Review & approve" shows only 1 role | Bootstrap seeds only the `owner` role; the 5-tier menu is only a signup-request LABEL, not real DB roles | Seed 5 standard roles per company (Employee/Operator/Admin/Co-Owner/Owner) with correct permission-key sets, in bootstrap + a backfill for the existing tenant |
| 3 | After approval, the approved user's app doesn't update | Their permission snapshot only reloads on manual refresh | App-side: AwaitingApproval polls `permissions.refresh()` every ~15s + on window-focus → auto-enters the app when a membership appears |
| 4 | "Granular Custom Feature Permissions Override" is Dexie-only (screenshot) | The mockup stores per-user overrides in IndexedDB = **security theater** (user edits IndexedDB, grants self anything) | Server-enforced `user_permission_overrides` table (company+user+permission_key+grant/deny), RLS `membership.manage`, folded into `has_permission` (DENY wins). This EVOLVES the locked M4 resolver → gated auth change: spec → guard → owner sign-off → build. View-Only vs Edit-&-Manage = read-key vs manage-key pairs. |
| 5 | Anyone with membership.manage can revoke anyone | `membership.manage` is all-or-nothing; no rank check | Governed revoke/assign function enforces actor-rank > target-rank; only Owner/Co-Owner revoke Admin/Operator/Employee; only Owner creates Co-Owner |
| 6 | Invitations don't email | `invite_user()` writes a row; nothing sends email (Supabase invite API never wired). Also Supabase free-tier "email rate limit exceeded" throttles ALL emails | Ship "Copy invite link" (accept-token URL, zero infra) now; wire Supabase Auth `inviteUserByEmail` via Edge Function (service_role server-side) later. **Owner-side: configure custom SMTP** (Resend/SendGrid) — the free-tier email cap (~2–4/hr) is why confirmation/invite/reset emails "don't arrive." |
| 7 | Sign-out button clutter in top bar | — | Remove from top bar; keep logout in Settings → Session only |

## The one that matters most for you (Team B): #4 is a SECURITY LEAK

If you ported the mockup's per-user permission panel and it writes to Dexie/IndexedDB only, **a user can
open browser devtools, edit the IndexedDB record, and grant themselves any permission** — because the
client is the only enforcer. RLS on the server still gates the actual tables IF your reads/writes go
through `has_permission`, but any client-side "can this button show / can this action run" check based on
the Dexie override is bypassable. The fix is to make the override a SERVER row that `has_permission`
consults, so RLS itself honors it. Do not ship per-user permissions that live only in the browser.

## Cross-team note

Team A's build of P1C is verified against Team A's guards before it's called done (auth domain = money-
adjacent = full-suite attack + owner sign-off). When you port, write YOUR own guard battery and attack
YOUR reset — do not trust our green as yours. The `has_permission` evolution is the highest-risk part;
guard it hardest (deny-override actually blocks a role-granted key; overrides never cross tenants).

## Port map (2026-07-12) — where each fix actually lives

- **#1 (signup→queue):** `handle_new_auth_user()` trigger in the P1C migration — display-name now falls
  back through `display_name` → `full_name` → `name` (OAuth) → email local-part. The "doesn't reach the
  queue" symptom for Google specifically is a Supabase/Google-Console provider-config issue, not a code
  defect — check your OAuth provider is actually enabled and redirect URIs match before assuming a code bug.
- **#2 (5-role dropdown):** `seed_standard_roles()` in the migration — ranks 10/20/30/40/50, called from
  `bootstrap_initial_tenant()` AND run once as a backfill (`select seed_standard_roles(id) from companies`).
  Exact permission-key sets per tier are in the function body — copy the INTENT, adapt the keys to your
  own permission catalog (yours may not have identical key names).
- **#3 (auto-poll):** already shipped 2026-07-10, unchanged by P1C — `AwaitingApproval` component, `app/`.
- **#4 (server-enforced overrides, THE security leak):** `user_permission_overrides` table +
  `set_user_permission_override()` RPC in the migration, folded into `has_permission()`. App UI:
  `app/features/organization/overrides/overrides.tsx` (new file) wired into
  `app/features/organization/approvals/ApprovalsScreen.tsx` via an "Overrides" button per row.
- **#5 (rank-based revoke):** `actor_rank()`/`outranks_role()` functions + rewritten RLS policies on
  `user_branch_roles` (insert/update), `roles` (insert/update), `role_permissions` (insert) — all in the
  migration. **Gotcha we hit and you will too:** a naive "actor must strictly outrank target" check on
  UPDATE also blocks an owner suspending their OWN membership (a pre-existing, legitimate capability our
  own `org-security.sql` guard already proved). Fix: exempt `user_id = current_app_user_id()` from the
  rank check on UPDATE only (self-management can't escalate — the only mutable columns are
  assignment_status/expires_at) while still requiring `membership.manage`. Check your own self-suspend
  path before assuming rank-gating is a pure add.
- **#6 (invite link):** ~~`app/features/organization/invitations/invitations.tsx` — copies
  `${origin}/accept?token=${token}` (a full clickable URL), not the bare token.~~ **STALE as of
  2026-07-19 — Invitations was removed from Repo A entirely on 2026-07-13** (owner decision, see
  STATUS.md's 2026-07-13 entries): `invite_user`/`accept_invitation` EXECUTE revoked (kept, not
  dropped — never-hard-delete), and `invitations.tsx`/`AcceptInvitation.tsx` plus their routes/nav tab
  deleted outright. Row #6 above (and this fix note) describe a feature that no longer exists in Repo A
  — if you're weighing whether to build real invite-email delivery for row #6's original "wire
  `inviteUserByEmail` later" TODO, know that we ended up ripping the whole feature out instead (a real
  bug in `accept_invitation()` — a same-browser admin testing their own invite link silently
  self-attached the invitation — was the immediate trigger; self-signup + admin approval was already the
  well-tested path and Invitations was the newer, more confusing, bug-prone one). This is not a
  recommendation to do the same in your repo — just flagging that this specific fix note is dead.
- **#7 (top-bar sign-out):** shipped 2026-07-10; a stale line of Settings-screen copy referencing the
  removed button was also cleaned up 2026-07-12 (`app/features/settings/SettingsScreen.tsx`).
