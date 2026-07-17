# Handoff 004 — Reverse-parity port FROM Repo B: revoke-approval workflow (P1M), 2026-07-17

**Direction note:** like handoff 003, this documents Team A porting FROM Team B. Nothing here needs
porting back to B — it's a parity record.

## What landed in Repo A

Team B's commit `c014423` (2026-07-17, labeled "P1J" on their chain) closed a real gap: a single
co_owner/owner could unilaterally revoke any account's access with one click. B's fix makes revoke a
two-person workflow — request (with a reason) queues, a **different** co_owner/owner must approve.

We had the identical gap (same `membership.manage` tier design in both repos) and ported the same fix.

| Item | B origin | A files |
|---|---|---|
| `revoke_requests` table + 4 RPCs | `supabase/migrations/20260716120000_p1j_revoke_approval_workflow.sql` | `supabase/migrations/20260717090000_p1m_revoke_approval_workflow.sql` |
| Guard battery (6 assertions) | `scripts/guards/p1j-revoke-approval-security.sql` | `scripts/guards/p1m-revoke-approval-security.sql` |
| API module | `app/features/organization/revoke-requests/revokeRequests.ts` | same path |
| Approvals UI (reason dialog + Pending Revoke Approvals box) | `ApprovalsScreen.tsx` diff in `c014423` | `ApprovalsScreen.tsx` |

## Deltas vs your implementation (informational)

- **Relabeled P1J → P1M.** Your commit calls this "P1J," but P1J already means username-login on our
  chain (shipped weeks earlier). Porting your label verbatim would have collided with our own history,
  so ours is P1M — same design, different id. Worth knowing if either of us ever cross-references
  migration ids in a shared doc.
- **MOCK_MODE handling differs.** Your `revokeRequestsApi.request/approve/reject` don't guard
  `MOCK_MODE` — they'd throw against a real RPC call in a demo build. Since our demo mode has exactly
  one seeded user, there is no second person who could ever be the required separate approver, so we
  made the write methods throw an honest "Demo mode has only one account" message instead of trying to
  fake a two-person flow with one person.
- **Guard fixtures use temp company codes `P1MCO`/`P1MBR`** instead of your `P1JCO`/`P1JBR` — purely
  cosmetic, same structure (bootstrap_initial_tenant + seed_standard_roles + two co_owners + one
  employee, all in one BEGIN/ROLLBACK).

## Verification (Repo A, first-hand)

tsc clean · 92/92 vitest · build clean · clean-reset battery: 20 guard files ALL PASS (sibling guards
pos/approvals-roles/accounting re-ran green, no regression) + static + drift PASS · live browser E2E
with **three real signed-up accounts** (not fixtures alone): owner queued a revoke on an employee with
a reason, the employee stayed Active until a *different*, separately-signed-in co-owner approved it —
audit trail (`revoke.requested` + `revoke.approved`) confirmed via direct query.

**Pushed + deployed to production 2026-07-17.** Post-push live verification caught a real gap in our
own port: `has_function_privilege('anon', ...)` returned true on all 4 new RPCs. Root cause — this
Supabase project has an `ALTER DEFAULT PRIVILEGES` rule granting EXECUTE to `anon` DIRECTLY on every
new function; `revoke all ... from public` (what our P1M wrote, matching your original) doesn't touch
a direct per-role grant, only PUBLIC's. Your P1J presumably has the identical gap on your project
unless your default-ACL setup differs — worth checking `pg_default_acl` on your side too. Fixed here
with a same-session follow-up migration (`20260717100000_p1m1_revoke_approval_anon_hardening.sql`,
explicit `revoke execute ... from anon`) plus a new grant-shape guard assertion. Also surfaced, while
sanity-checking: our own `archive_user_account` (P1G, weeks older) has the same gap in production —
unrelated to this port, not fixed tonight, flagged for a dedicated audit.
