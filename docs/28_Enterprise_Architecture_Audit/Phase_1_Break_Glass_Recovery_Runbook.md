# Phase 1 — Break-Glass & Account Recovery Runbook (SaaS super-admin)

**Type:** Operational runbook (B7 §5 break-glass · §11 credential-compromise · §13 named-owner requirement)
**Date:** 2026-07-10 · **Owner of this runbook:** the business owner (solo-founder = Security owner + DR owner).
**Standing rule (B7):** every path below is audited, time-boxed where possible, and never edits history.

## Recovery ladder — always use the HIGHEST rung that works

| # | Situation | Path | Who |
|---|---|---|---|
| 1 | Member forgot password | Login → "Forgot password?" → email link → `/auth/reset` | member (self-service, B7 §2) |
| 2 | Member locked out / no reset email | Organization → Approvals → "Help a member who is locked out" → send reset email | any membership manager |
| 3 | Member compromised | Approvals → Revoke access (membership Expired) → then rung 2 after cleanup; suspend identity via rung 5 if needed | membership manager |
| 4 | Owner forgot password | Same as rung 1 (owner's own email) | owner |
| 5 | Owner email lost / TOTAL lockout (break-glass) | Supabase **dashboard** (dashboard login is a separate identity): *Authentication → Users* → select the account → "Send password recovery" or "Update user" to set a new email. If the dashboard itself is unreachable, the **SQL editor / DB password** is the last resort (below). | owner ONLY |
| 6 | Suspend a compromised identity NOW | SQL editor: `update public.users set account_status='Suspended' where email='<who>';` — resolver dies instantly (guard-proven); reverse with 'Active'. | owner ONLY |

## Break-glass rules (B7 §5 — read before using rung 5/6)

1. **Announce first, act second:** note date/time/reason (a line in STATUS.md's log qualifies) BEFORE acting.
   The DB has no way to audit dashboard/SQL actions as *you* — the note IS the audit trail.
2. **Never** edit financial rows, journal rows, or audit rows from the SQL editor. Break-glass is for
   identity/access recovery only. History is immutable (C7 §4/§7); corrections go through the app's
   reversal paths.
3. **Time-box:** finish the recovery, then verify normal login works, then STOP using privileged access.
4. **After any rung-5/6 use:** rotate the DB password (Settings → Database → Reset password) and update
   your own records. The anon key in `.env` is unaffected by a DB-password rotation.
5. **Credential-compromise drill (B7 §11):** revoke sessions (dashboard → Authentication → Users → sign out
   user), suspend identity (rung 6), send reset (rung 2), review what that account touched via
   `audit_events` (read-only!), then reactivate.

## What does NOT exist yet (honest gaps, owner-timed)

- MFA/TOTP enrollment (ODR-003 V1 mandates it for privileged roles) — Supabase supports it; enable in
  dashboard *Authentication → Multi-Factor* and enroll the owner account when ready. App-side enforcement
  UI is a follow-up.
- Automated backups beyond Supabase's built-ins / PITR (B7 §8–§10) — free tier has daily backups only;
  PITR needs a paid plan. Revisit at launch.
- Dormant-account auto-flagging (B7 §6) — manual review for now.
