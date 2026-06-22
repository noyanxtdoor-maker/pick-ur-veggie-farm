# Stage D — Phase 1: Context Reset Handoff

**Type:** Continuity artifact (not a summary) · **Date:** 2026-06-22 · **Branch:** `feature/phase-0-foundation`

> Read this FIRST. It lets a new Claude Code session (zero conversation history) open the repo, verify reality, and continue Stage D Phase 1 without violating the locked architecture. Verify git state, confirm authority, then continue at the "Immediate next step" (§9).

## 1. Where we are
- **Stage D — Phase 1 (Core Platform / Identity·Tenant·Security).** Phase 0 is complete.
- **M1 Identity Foundation:** ✅ implemented, security-audited (a self-reactivation loophole was found + fixed), **GitHub CI verified (run #11, all green), LOCKED.**
- **M2 Tenant Foundation:** ✅ implemented, locally adversarially tested (all pass), guard suite green, pushed, **GitHub CI verified (run #13 — `verify`+`secrets`+`db-guards` all green; clean-runner `supabase start`→`db reset`→guards→drift genuinely executed), LOCKED 2026-06-22.** *Run #13 ran on `4e87af8` (this handoff-doc commit), which is migration-identical to M2 `4d122dd` (zero migration changes between them) — so it validly reproduces M2 on a clean runner. CI evidence audited from owner-supplied screenshots + `ci.yml` + `package.json` (this env cannot fetch Actions — §8).*

## 2. Git state (verify on session start)
- **Branch:** `feature/phase-0-foundation` (off `develop`); synced with origin; working tree clean.
- **Commit chain (origin tip → back):**
  - `4d122dd` feat(db): **M2** tenant foundation — companies + branches
  - `ff5d267` fix(db): close M1 self-reactivation loophole (column-scoped UPDATE)
  - `ef2bc06` feat(db): **M1** identity foundation + Tier-2 CI guards
  - `c7130b7` docs: M1 Migration Design Spec · `4178de7` Physical Schema · `bd7a256` Conceptual Schema · `10a7c84` ADS · `7aed748` Solo-Founder Exception · `f1a6d0e` CI foundation · `5a28617` Vitest · `536bda4` CLAUDE.md · `b6dd2a1` roadmap (+ earlier Phase-0 commits `9672ed9…de9cda5`).
- **Protected branches (must stay untouched):** `develop` = `d1c1f04`, `main` = `7833c9f` (local + origin). No merges/rebases/squash/rewrite. Never modify a locked migration (`ef2bc06`,`ff5d267`,`4d122dd`).

## 3. Authority documents (source of truth — `docs/28_Enterprise_Architecture_Audit/`)
- **ADR-001 / ODR-001…005** (supreme) → Enterprise architecture (10–26) → Stage A → **B1–B8** → **C1–C8** → `CLAUDE.md` (repo root, lowest authority) → **Master_Execution_Roadmap.md** (navigation) → implementation.
- **Phase-1 design chain (all durable on origin):** `Stage_D_Phase_1_Architectural_Design_Specification.md` (ADS) → `…_Conceptual_Schema_Design_Specification.md` → `…_Physical_Schema_Design_Specification.md` → `…_Migration_Design_Specification.md`.
- **Branch-protection / exception:** `Stage_D_Branch_Protection_Precondition.md`.
- Key B/C for Phase 1: **B1** (RLS/tenant), **B2** (money/no-float), **B3** (indexing/partition), **B5** (idempotency/offline), **B6** (audit immutability), **B7** (identity/auth), **C3** (migration governance), **C5** (testing), **C6** (CI), **C7** (constitution).

## 4. Locked architectural decisions (irreversible — do not change)
1. **Identity separation** — `auth.users` (Supabase) owns credentials/MFA/sessions/providers; ERP `public.users` owns business identity (no credentials), linked by stable `auth_user_id`.
2. **UUIDv7 PKs** — `public.uuidv7()` (in M1; RFC 9562, verified). PG17 (no native uuidv7); future PG18 swap is clean (`public.` qualified). Client-generatable (offline-first, B5).
3. **Mandatory tenant ownership** — every operational row carries `company_id` (+`branch_id` where branch-scoped). Exempt: identity (`users`), tenant-root (`companies`), global (`permissions`).
4. **Permission-based authorization only** — never role-name strings; single centralized resolver is the only authz source (resolver = M4).
5. **Deny-by-default RLS** as the final boundary; `enable` + **`force`**; RLS ships in each table's own migration.
6. **Append-only audit** (M5) — no UPDATE/DELETE for any role.
7. **No floating-point money** — fixed-precision `NUMERIC` (B2); enforced from migration #1 (no money tables until Phase 4).
8. **No hard delete** — deactivate via `status`; `ON DELETE RESTRICT`; no DELETE/TRUNCATE grants to app roles.
9. **Privilege-layer immutability** — column-scoped UPDATE grants (e.g. M2 `service_role` may update only `name`,`status`; `company_code`/`base_currency_code`/`auth_user_id`/`id` are not updatable by any app path). `anon`/`authenticated` get nothing on tenant tables until M4.

## 5. What M1 + M2 actually contain
- **M1 (`…_m1_identity_foundation.sql`):** `public.uuidv7()`; `public.users` (id uuidv7, auth_user_id UQ→auth.users ON DELETE RESTRICT, display_name, account_status {Active,Suspended}, timestamps); RLS enable+force, own-row select + **update(display_name) only** (closes self-reactivation); `service_role` SELECT/INSERT/UPDATE; no users trigger.
- **M2 (`…_m2_tenant_foundation.sql`):** `public.set_updated_at()` trigger fn; `companies` (tenant root: company_code UQ-immutable, name, base_currency_code default 'PHP' immutable, status {Active,Suspended,Archived}); `branches` (company_id NOT NULL FK→companies ON DELETE RESTRICT, branch_code, name, status; UNIQUE(company_id,branch_code); no standalone company_id index); both RLS enable+force **deny-all (no authenticated policy)**; `service_role` SELECT/INSERT + UPDATE(name,status); updated_at triggers on companies+branches (**NOT users**, by owner instruction).

## 6. Migration sequence (M1→M6) — status
- **M1 Identity** ✅ locked · **M2 Tenant** ✅ **LOCKED (CI-verified, run #13)** · **M3 Authorization** (roles, permissions, role_permissions, user_branch_roles) — NEXT · **M4 Resolver + RLS refinement** (introduce centralized resolver; replace M1/M2 interim deny-all/own-row with member-scoped policies via expand→migrate→contract) · **M5 Audit** (append-only audit_events, before bootstrap) · **M6 Bootstrap** (guarded one-time self-disabling mechanism; Company#1/Branch#1/Owner created at runtime, audited — NOT seeds). Seeds (idempotent): permission catalog + role template only.

## 7. Tier-2 CI guards (ship with every migration PR; `ci.yml` `db-guards` job)
`scripts/guards/db-guards.sql` (RLS-enabled · tenant-ownership[exempt list] · audit-immutability[N/A until M5]) · `scripts/guards/static-guards.mjs` (no-role-name-auth · no-float-money; **excludes `src/` = V2 prototype, ODR-001**) · `scripts/guards/check-drift.mjs`. npm: `db:reset`, `guard:static`, `guard:db` (needs psql), `guard:drift`. CI workflow `.github/workflows/ci.yml` jobs: `verify` (npm ci·tsc·vitest·build), `secrets` (gitleaks), `db-guards` (supabase start→db reset→guards→drift).

## 8. Environment & operating constraints (important)
- **Windows + PowerShell** (primary) + **Bash** (POSIX). Supabase needs **Docker** running (`npm run db:start`; PG17). **`psql` is NOT on the local PATH** → `guard:db` only runs in CI (which installs postgresql-client); locally verify guard SQL via `docker exec supabase_db_pick-ur-veggie-farm psql …`.
- **Cannot retrieve GitHub Actions results from this environment** (no `gh`; GitHub API auth out of bounds — credential probe is denied; private repo → unauth 404; WebFetch can't auth; GitHub Copilot MCP OAuth fails dynamic registration). **The owner pastes CI run logs/screenshots; you audit those.**
- Occasional "classifier temporarily unavailable" on PowerShell — retry.
- Repo is **private on the Free plan** → GitHub branch protection (classic + rulesets) is **NOT enforceable**; Phase 1 proceeds under the recorded **Temporary Solo-Founder Enforcement Exception** (active; single owner, no external write, no production, no real data; auto-expires on 2nd contributor / enforcement-available / production / real-data — then enforced branch protection becomes mandatory). The compensating-control flow: `feature → local reset+attack verify → checkpoint push → PR → CI (verify+secrets+db-guards) → owner review → merge`.

## 9. Immediate next step
1. **M2 CI: ✅ DONE — LOCKED.** GitHub run #13 audited (commit `4e87af8`, migration-identical to M2 `4d122dd`): `verify` (npm ci · `tsc --noEmit` · `vitest run` 1/1 · `vite build`), `secrets` (gitleaks full-history, no leaks), `db-guards` (`supabase start` 2m16s → `db reset` 38s rebuilding M1+M2 from history → static + db[`psql ON_ERROR_STOP=1`] + drift guards → stop) — all green. No skipped steps, no `continue-on-error`, no `|| true` masking (`ci.yml` confirmed). Only annotation: known Node-20 deprecation (§11), non-blocking.
2. **Then M3 Authorization Foundation** — under separate explicit authorization, following the gate chain (design review → contract → implement → DB-attack → guards → commit → push → CI). Note the streamlined cadence: since the pattern is proven + CI-guarded, M3 can collapse implementation-review→implementation→verify into fewer gates (owner's call).

## 10. Working discipline (how this project operates)
- Every step: **fresh git verification first** (branch, clean tree, sync, HEAD, develop/main).
- Read-only reviews END with **STOP + await explicit owner approval**; never push/merge/implement without an explicit go.
- **Report evidence, never claim success without it** (e.g., never assert CI green unseen). Surface uncertainty; challenge assumptions (including ChatGPT-authored prompts — flag redundant ceremony and recommend the leaner path).
- Migrations are High-risk (C3/C4 §5): version-controlled, deterministic, Local→Test→Staging→Prod, rollback strategy declared; verify live via `supabase db reset` + behavioral attacks before commit.

## 11. Recorded follow-ups (tech debt — not blockers)
- M1 `users.updated_at` has **no trigger** (M2 added `set_updated_at` to companies/branches only, per owner instruction) — backfill later via an additive migration if desired.
- `public.uuidv7()` EXECUTE is granted to PUBLIC (harmless) — optional hardening.
- **Behavioral cross-tenant negative tests** (C5 §3) must join CI at **M4** (when member-scoped reads exist; metadata guards can't catch a future `USING(true)`).
- Pre-M3 ticket: **Identity Lifecycle Policy** (leaver flow; Suspended/Inactive/Archived; who changes account_status; audit of status transitions).
- Checklist: **`service_role` key never in a frontend build**; gitleaks license if repo→org; CI `actions/*@v4` Node-20 deprecation (bump when GitHub ships Node-24 majors).

## 12. Checkpoint status
```
Stage D — Phase 1
M1 LOCKED (CI-verified) · M2 LOCKED (CI-verified, run #13) · M3 NEXT (awaiting explicit authorization)
Ready for new Claude Code session.
```
