# Stage C1 — Enterprise Development Environment & Toolchain Specification

**Type:** Stage C engineering-preparation artifact (binding) · **Status:** In force
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Authority basis:** ADR-001, ODR-001…005, `17.01_Technology_Stack_Decisions`, [C7](Stage_C7_Engineering_Constitution.md), [C4](Stage_C4_Repository_Git_Governance.md).
**Scope note:** governance documentation only. **No code, dependency installs, infra, or schema.**

Defines the controlled engineering workspace. Pairs with [C5](Stage_C5_Enterprise_Testing_Architecture.md) (evidence of correctness); C6 later automates both.

---

## 1. Development philosophy

Reproducible environments · consistency across developers · security-first local dev · minimal privileges · **no hidden machine-specific config** · fast feedback loops (the local loop §8 must be quick or the test gates get skipped).

## 2. Technology baseline

**Frontend (existing baseline, verified in `package.json`):** React 19, TypeScript ~5.8, Vite 6, Tailwind 4.
- **Supported versions:** pin majors; document the matrix; **upgrade strategy** = deliberate, tested, one major at a time via PR (C4 risk-classified); security patches expedited.
- **Compatibility rule:** no feature depends on an unreleased/experimental API without an ADR.

**Backend (per `17.01`/ODR):** Supabase (PostgreSQL + Auth + RLS + Realtime). API runtime = Supabase-first (DB functions/RLS + thin service layer per B6); a dedicated backend service is added only when a need is proven (ponytail — don't stand up a server for what Supabase + RLS already do). Service boundaries follow B6 module ownership.

**Tooling:**
- **Package manager:** npm (a `package-lock.json` is already the lockfile authority) — one manager only; the committed lockfile is authoritative and CI installs with `npm ci`.
- **Node version:** pinned (via `engines` + an `.nvmrc`) so every developer and CI use the same runtime.
- **Build:** Vite (existing).
- **Dependency approval:** §4.
- **Action item:** rename the package from the scaffold default `react-example` to the project name (recorded; not performed by this doc — it is a `package.json` edit gated by C4).

## 3. Environment configuration

**Environment classes:** Local development · Testing · Staging · Production (align with C4 §8 release tiers and C2 Supabase project separation).

**Hard rules (C7 §3 / C4 §10):**
- **No production secrets locally**; no shared credentials; **no secrets committed to Git** (`.gitignore` already excludes `.env*`).
- Each tier has its own Supabase project + keys; local uses a local/dev Supabase, never production.

**Environment variables:**
- **Naming:** `UPPER_SNAKE_CASE`, prefixed by scope (e.g. `SUPABASE_URL`, `SUPABASE_ANON_KEY`); client-exposed vars follow Vite's `VITE_` rule and contain **no secrets** (anon key only; never `service_role`).
- **Ownership:** each var has a documented owner + purpose in `.env.example` (the contract).
- **Rotation:** privileged keys rotated on a schedule and on suspicion (B7); `service_role` never reaches the client (B1 §9).
- **Documentation:** `.env.example` lists every required var with a description and a safe placeholder.

## 4. Dependency governance

Every dependency must answer: **"Why this instead of the platform/stdlib/an existing dep?"** (the ponytail ladder — stdlib/native/existing before new).

- **Allowed:** well-maintained, actively-supported, security-reviewed libraries that earn their place.
- **Forbidden:** abandoned/unmaintained packages · unnecessary libraries (a few lines beats a dependency) · duplicate libraries solving the same problem.
- **Money/dates/security:** no library may reintroduce float money (B2) or hand-rolled crypto; use Supabase Auth for credentials (B7).
- **Approval:** a new dependency is a C4 PR with justification; license + maintenance + vulnerability check is part of review (and a C6 dependency-audit gate).

## 5. Coding standards

- **TypeScript:** `strict` mode on; no implicit `any`; no unchecked non-null assertions in money/security paths.
- **Linting/formatting:** ESLint (incl. the architecture lints from C7 §14 — no-float-money, no role-name-auth, etc.) + Prettier; lint/format clean is required to merge (C6).
- **Naming:** monetary columns/values `_amount` (B2), rates `_rate`, quantities `_qty`; permissions checked by name, never role strings (C7 §2).
- **Folder organization (per `27.02`):** `modules/ · components/ · services/ · repositories/ · infrastructure/` — one module owns its data (B6); business logic out of UI components.
- **Imports:** no cross-module reach into another module's internals (B6/C7 §8); enforced by an ownership lint.
- **Error handling:** never swallow errors on money/inventory/security paths; fail closed (C7 §1); validate at trust boundaries (do not simplify away input validation).

## 6. Local data & offline development

- **Local database:** a local/ephemeral Supabase (or disposable Postgres) per developer — never production.
- **Test data:** synthetic only (C5 §10); seed scripts produce a reproducible state (roles/permissions/currency master as seed, B1/B2).
- **Mock services:** external integrations (payments, IoT, AI) mocked locally (B6 §7 — external is never source of truth).
- **Offline simulation & sync testing:** developers **must** be able to reproduce offline scenarios — queue operations offline, simulate reconnect, and verify idempotency/exactly-once (B5). This is a first-class local capability, not an afterthought (offline-first is the product's differentiator).

## 7. Security during development

**Forbidden (C7):** real customer data · production credentials · disabling security checks (RLS, lints, tests) for convenience · hidden backdoors/convenience bypasses. Disabling a check is an architectural change (C7 §13/§14), not a local shortcut.

## 8. Development workflow (local loop)

```
Pull branch → install (npm ci) → configure env (.env from .env.example) →
run validation (typecheck + lint + architecture lints) → implement change →
run tests (C5 gates) → commit (Conventional Commits, C4 §3) → open PR (C4 §4)
```

The loop is fast by design so the gates are always run, not bypassed.

---

## 9. Consistency & status

Consistent with ADR-001, ODR-001…005, `17.01`, C7, C4, B1–B8 — extends the existing Vite/React/TS baseline; no new architectural authority. **In force** as of this commit.

**Recorded action items (settings/edits, gated by C4 — not performed here):** rename `react-example`; add `.nvmrc` + `engines`; expand `.env.example` with the documented var contract; add ESLint/Prettier + architecture-lint config (its rules are specified by C7 §14; wiring is C6).

**Next (paired):** [C5 — Enterprise Testing Architecture](Stage_C5_Enterprise_Testing_Architecture.md).
