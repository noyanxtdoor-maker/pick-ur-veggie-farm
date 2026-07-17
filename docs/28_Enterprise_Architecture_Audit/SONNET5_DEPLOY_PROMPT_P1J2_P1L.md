# Sonnet 5 execution prompt — push P1J.2 + P1L to production, then deploy (2026-07-16)

Paste everything below the line into a fresh Sonnet 5 session in this repo (or hand it to a delegated
agent). Replace `<DB_PASSWORD>` with the current session-pooler password before running — never commit
a real password to this file (Team B mistakes-journal #10: Push Protection flags secret literals in docs).

---

You are Sonnet 5 working in `C:\Users\sherl\Documents\pick-ur-veggie-farm` (Repo A, Claude team).
Load `.claude/skills/think-like-fable/SKILL.md` first, then read `STATUS.md` (2026-07-16 entry) for
context. The owner has ALREADY authorized this exact task: push the two new migrations to production
and deploy the app. Do not expand scope.

## Context (already done — do not redo)

A Team-B parity port landed and is fully verified locally (tsc clean, 92/92 vitest, build clean,
19 SQL guard files ALL PASS on a clean reset, static+drift PASS, live browser E2E green):

1. `supabase/migrations/20260716090000_p1j2_resolve_login_email_hardening.sql` — resolve_login_email
   gains an `account_status = 'Active'` filter + grant narrowed to anon only (revokes authenticated).
2. `supabase/migrations/20260716110000_p1l_self_service_username.sql` — new `update_own_username(text)`
   SECURITY DEFINER RPC (own-row only, Active gate, server-side format+uniqueness, Security audit row),
   granted to authenticated only.
3. App code: /profile screen, session hooks, dedupeByUser fix, Settings changes (all client-side).

## Your task, in exact order

**Step 0 — preconditions.** Verify Docker Desktop is running and the local Supabase stack is up
(`docker ps | grep supabase_db_pick-ur-veggie-farm`). Verify a clean working state: `npx tsc --noEmit`
exits 0 and `npm test -- --run` is 92/92. If anything fails, STOP and report — do not push.

**Step 1 — push the two migrations to PRODUCTION (project `aqhxhamdwmhcwxmebqbo`).**
The Supabase CLI account cannot see this project (known limitation, STATUS.md) — push via direct psql
through the local container, one file per invocation, IN THIS ORDER:

```bash
MSYS_NO_PATHCONV=1 docker exec -i supabase_db_pick-ur-veggie-farm psql \
  "postgresql://postgres.aqhxhamdwmhcwxmebqbo:<DB_PASSWORD>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  -v ON_ERROR_STOP=1 < supabase/migrations/20260716090000_p1j2_resolve_login_email_hardening.sql

MSYS_NO_PATHCONV=1 docker exec -i supabase_db_pick-ur-veggie-farm psql \
  "postgresql://postgres.aqhxhamdwmhcwxmebqbo:<DB_PASSWORD>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" \
  -v ON_ERROR_STOP=1 < supabase/migrations/20260716110000_p1l_self_service_username.sql
```

Rules: NEVER echo the password in output or write it to any file. NEVER run other statements against
production. If the first file errors, STOP (do not run the second) and report the exact error.
(Pooler host/port: if 5432 fails to connect, try 6543 — both have been used from this machine.)

**Step 2 — verify live (read-only).** Same psql route, read-only checks:

```sql
-- P1J.2 shape: function body contains the Active filter; grants are anon-only
select pg_get_functiondef('public.resolve_login_email(text)'::regprocedure);
select has_function_privilege('anon', 'public.resolve_login_email(text)', 'execute') as anon_ok,
       has_function_privilege('authenticated', 'public.resolve_login_email(text)', 'execute') as auth_must_be_false;
-- P1L exists with the right grant
select has_function_privilege('authenticated', 'public.update_own_username(text)', 'execute') as auth_ok,
       has_function_privilege('anon', 'public.update_own_username(text)', 'execute') as anon_must_be_false;
```

Expected: body contains `account_status = 'Active'`; anon_ok=t, auth_must_be_false=f, auth_ok=t,
anon_must_be_false=f. If any check disagrees, STOP and report — do not deploy the app.

**Step 3 — deploy the app.** `npx vercel deploy --prod` from the repo root (project is linked;
deploys local file state). Wait for READY. Confirm the alias `pick-ur-veggie-farm.vercel.app` updated.

**Step 4 — post-deploy smoke (read-only, NO writes to production data).** Open
https://pick-ur-veggie-farm.vercel.app in the browser tools: login page renders, zero console errors,
all assets 200. Do NOT create accounts or submit forms on production.

**Step 5 — record.** Update STATUS.md's 2026-07-16 entry: change "NOT yet pushed to production" to the
push/deploy record with timestamps and the Step-2 verification results. Then remind the owner to
ROTATE the DB password now that the push is done (ephemeral-use convention, STATUS 2026-07-13 entry).

## Hard rules

- Repo B (`- GLM Version` sibling folder) is read-only; do not touch it at all in this task.
- No git commit/push unless the owner separately asks.
- Report exact command outputs — never claim success without the Step-2 evidence.
- If the pooler password is rejected, STOP and ask the owner — do not retry variations.
