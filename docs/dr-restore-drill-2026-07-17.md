# DR Restore-Drill — 2026-07-17

**Goal:** Confirm the local Supabase stack is a faithful restore target for the
linked production project `aqhxhamdwmhcwxmebqbo`, so a worst-case "cloud is
unreachable, lose the database, need to rebuild from a backup" scenario
doesn't surprise the owner. Mirrors Team B's own drill (`docs/dr-restore-drill-2026-07-17.md`
in the sibling GLM repo), adapted for this repo's schema and migration history.

**Method (in order):**
1. Add `backups/` to `.gitignore` *before* creating any dump — these files contain real
   production user rows and must never be committed (Team B's spec carries this same warning).
2. Dump the live production schema to `backups/cloud-pre-drill-schema.sql`
   (`pg_dump --schema-only --schema=public --no-owner --no-privileges`, run via the local
   Postgres container's bundled `pg_dump` v17.6 against the production pooler connection string
   — avoids needing a host-level Postgres client install).
3. Dump the live production data to `backups/cloud-data-20260717-144723.sql`
   (`pg_dump --data-only --schema=public --no-owner --no-privileges --disable-triggers`).
4. Reset the local stack to apply all migrations cleanly (`npx supabase db reset`).
5. Count tables, functions, RLS-forced tables, and active permission keys in both stacks.
6. Diff the actual table/function/permission **name lists** (not just counts) between local
   and production, to confirm every delta is explained rather than assumed.
7. Read back row counts on the key business tables directly against production, and
   cross-check those counts against the data dump file's own `COPY` block sizes.

**Result — schema counts (local is intentionally ahead by unpushed migrations):**

| Surface                 | Local | Production | Diff | Explained by |
|--------------------------|-------|------------|------|--------------|
| Public tables            | 45    | 44         | +1 local | `product_removal_requests` (P1O, not yet pushed) |
| Public functions (app)   | 82    | 78         | +4 local net | see function diff below |
| Public functions (managed) | 0   | 1          | +1 prod | `rls_auto_enable` — Supabase-cloud-managed auto-RLS-enable event trigger, not part of the migration chain (confirmed via `pg_get_functiondef`: `SECURITY DEFINER`, owned by `postgres`, fires on `CREATE TABLE` in `public` — platform-installed, not app code) |
| RLS-forced tables        | 45    | 44         | +1 local | `product_removal_requests` is RLS-forced from creation |
| Active permission keys   | 35    | 34         | +1 local | `product.remove` (P1O) |

**Function name diff (the exact objects behind the "+4 local net / +1 prod" above):**

```
Functions only in LOCAL:
  approve_product_removal, list_pending_product_removals,
  reject_product_removal, request_product_removal   (P1O — 4 functions)
  remove_role_permission                              (P1C4 — 1 function)
Functions only in PRODUCTION:
  rls_auto_enable                                     (Supabase platform, not app code)
```
Net: 5 local-only − 1 prod-only = +4, matching the raw count diff (82 − 78 = 4) exactly.

**Result — production data (read back live, cross-checked against the dump file):**

| Table                      | Production (live query) | Production (dump file `COPY` count) | Match |
|-----------------------------|--------------------------|--------------------------------------|-------|
| companies                   | 1                        | 1                                    | ✓ |
| branches                    | 1                        | 1                                    | ✓ |
| users                       | 8                        | 8                                    | ✓ |
| user_branch_roles           | 11                       | 11                                   | ✓ |
| roles                       | 5                        | 5                                    | ✓ |
| permissions                 | 34                       | 34                                   | ✓ |
| products                    | 2                        | 2                                    | ✓ |
| invoices (POS)               | 1                        | 1                                    | ✓ |
| audit_events                | 102                      | 102                                  | ✓ |
| employees                   | 3                        | 3                                    | ✓ |
| wage_payments                | 0                        | 0                                    | ✓ |
| revoke_requests              | 0                        | 0                                    | ✓ |
| user_permission_overrides    | 66                       | 66                                   | ✓ |

All 13 tables match exactly between a live read and the dump file — the dump is a faithful
snapshot, not a partial or corrupted one.

**Findings:**

1. **The local Supabase stack is a faithful restore target.** Every schema/function/permission
   delta is fully explained by migrations written this session that haven't been pushed to
   production yet (P1O product-removal approval workflow, P1C4's `remove_role_permission`), plus
   one Supabase-platform-managed function (`rls_auto_enable`) that isn't part of the app's
   migration chain at all. There is no unexplained drift in either direction.
2. **Data dump is faithful.** `backups/cloud-data-20260717-144723.sql` (940 lines, 113,392 bytes)
   — every one of its 13 checked `COPY` blocks matches a live count against production exactly.
3. **Schema dump is faithful.** `backups/cloud-pre-drill-schema.sql` (8,038 lines, 343,657 bytes)
   — produced with `--schema-only`, includes all `CREATE TABLE`/`CREATE FUNCTION`/RLS policy
   statements for the `public` schema.
4. **Checksums** (for integrity verification before any future restore):
   - `cloud-pre-drill-schema.sql`: `sha256:88e877ed5e2ba2772d4093791f5396481148ba9b2b6f8f0ab17ddc657ffbeca6`
   - `cloud-data-20260717-144723.sql`: `sha256:27148eca71b547ec232de7413f94f5c833711c4e4bd6cf87455561dee42e2523`
5. **`backups/` is gitignored.** Verified via `git check-ignore -v backups/test.sql` *before* any
   dump file was created. Per the standing rule carried over from Team B's spec (dump files
   contain real user rows), these files must never be committed.

**Restore procedure (for a future DR event):**

```bash
# 1. From a fresh local stack with no migrations applied yet:
cd "C:\Users\sherl\Documents\pick-ur-veggie-farm"
npx supabase db reset   # applies every migration in supabase/migrations/ — the "schema" path
# OR — to restore from a real production backup instead of re-running migrations:
# 1a. apply the schema dump:
docker exec -i supabase_db_pick-ur-veggie-farm psql "postgresql://postgres:postgres@127.0.0.1:5432/postgres" -v ON_ERROR_STOP=1 -f - < backups/cloud-pre-drill-schema.sql
# 1b. apply the data dump:
docker exec -i supabase_db_pick-ur-veggie-farm psql "postgresql://postgres:postgres@127.0.0.1:5432/postgres" -v ON_ERROR_STOP=1 -f - < backups/cloud-data-<date>.sql

# 2. Verify the restore is faithful by running the full guard battery (26 files as of this
#    drill: accounting, approvals-roles, auth-lifecycle, bootstrap, copilot-degrade, crop,
#    cross-tenant, customers, db, inventory, org, p1c2/p1c3/p1c4, p1h1, p1l, p1m, p1n, p1o,
#    payments, payroll(-role-link), pos, projects, rls-behavior, scheduling). All assertions
#    should pass against the restored data — every guard bootstraps and rolls back its own
#    fixture, so they exercise the restored schema/RLS/functions without depending on
#    production's actual row contents.
```

**What this does NOT cover (deliberate scope cuts, same as Team B's drill):**

- **Auth users.** Local Supabase's GoTrue instance uses a different JWT secret than production,
  so restoring production's `auth.users` rows to local would not let anyone actually sign in
  as those users (password hashes are opaque, and even a matching hash wouldn't help — the
  session-signing secret differs). The guard battery works around this by using
  `set_config('request.jwt.claims', ...)` to manually impersonate an actor id, so RLS/RPC
  correctness is verified without depending on real auth working post-restore.
- **Storage / realtime subscriptions.** Not dumped or covered by this drill; production's
  storage buckets and realtime channel state would need a separate restore procedure.
- **Cross-tenant RLS attacks post-restore.** The data dump includes production's live company
  and its RLS-gated rows as-is. Restoring to a local stack that also has a matching
  `auth_user_id` for some user could in principle let that local session read production data
  it was scoped to in production. A real DR event should restore auth in lockstep with data
  (or reset to a fresh project ref first) — out of scope for this drill, which is read-only
  against production throughout.
- **Production push of the objects driving the schema diff.** P1O and P1C4 remain unpushed by
  deliberate choice this session (owner said "keep going, push later" for the batch of recent
  migrations) — this drill documents the gap, it doesn't close it.
