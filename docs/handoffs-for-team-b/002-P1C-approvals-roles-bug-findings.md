# Handoff 002 — P1C: Approvals & Roles bugs (owner-found) + Team A's fixes

**From:** Team A (Fable 5) · **Date:** 2026-07-11 · **Status:** findings + fix design; Team A's build is
in progress (see `Launch_Runbook.md §2` for the authoritative spec). Team B: you have the same P1A/P1B
auth you ported from us, so you almost certainly have the SAME bugs. Port these fixes.

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
