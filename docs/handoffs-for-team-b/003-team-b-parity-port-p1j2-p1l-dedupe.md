# Handoff 003 — Reverse-parity port FROM Repo B (P1J.2 + P1L + dedupeByUser), 2026-07-16

**Direction note:** unlike handoffs 001/002, this documents Team A porting FROM Team B (owner parity
order 2026-07-16: "implement a feature, a bug fix and a security feature they have and we dont have").
Team B already has all three — **nothing here needs porting back.** It exists so B can see (a) that
parity landed, (b) the small deltas where our implementations diverge, and (c) what we deliberately
did NOT take.

## What landed in Repo A

| # | Category | Item | B origin | A files |
|---|----------|------|----------|---------|
| 1 | Bug fix | Role-change duplicate-row (`dedupeByUser`) | 8c4447a §2 | `app/features/organization/memberships/memberships.tsx` |
| 2 | Security | `resolve_login_email` hardening (your "Finding-1 vs Repo A") | f49c1d3 / your P1J | `supabase/migrations/20260716090000_p1j2_resolve_login_email_hardening.sql` + `scripts/guards/auth-lifecycle-security.sql` (+3 assertions) |
| 3 | Feature | P1L self-service Profile (username/email/password) + Data & Backup `company.manage` gate | f0249fa | `supabase/migrations/20260716110000_p1l_self_service_username.sql`, `scripts/guards/p1l-self-service-username.sql`, `app/features/profile/ProfileScreen.tsx`, `session.tsx`, `router.tsx`, `AppShell.tsx`, `SettingsScreen.tsx` |

## Deltas vs your implementations (informational)

- **P1J.2 is a separate migration here** (`create or replace` + `revoke ... from authenticated`) because
  our P1J had already shipped to production with the wider shape; you shipped the narrow shape inside
  P1J itself. End state is identical: Active-only filter, anon-only grant.
- **Our P1L guard runs under BEGIN/ROLLBACK** (our battery convention) instead of committing permanent
  fixtures — audit rows + users roll back together, so the FK/append-only conflict your header describes
  never arises. Same G1-G7 assertions, plus a G1b that asserts the Security-class audit row.
- **We did NOT port** f0249fa item 4 (sync-button always-clickable + 700ms min spin) since you yourselves
  superseded it with the 5ab18eb `uiSyncing` overlay — that overhaul is queued as its own item here.

## Verification (Repo A, first-hand)

tsc clean · 92/92 vitest · build clean · clean-reset battery: 19 guard files ALL PASS + static + drift ·
live browser E2E: username change persisted+audited, changed-username login works end-to-end,
`suspendedharvest` username → generic "Invalid login credentials", Expired+Active membership pair renders
as ONE directory row, Data & Backup owner-only.

## Note for Team B

Your handoff 006's URGENT ask (cross-vendor review of your P1D `assign_membership_with_payroll`) is
seen and queued on our side — it was outside this port order's scope and needs its own session.
