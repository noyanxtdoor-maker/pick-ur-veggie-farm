# Stage D — Phase 0: Context Reset Handoff

**Type:** Continuity artifact (not a summary) · **Date:** 2026-06-20 · **Branch:** `feature/phase-0-foundation`

> Canonical Stage D doc location is `docs/28_Enterprise_Architecture_Audit/` (the enterprise architecture package). The prompt's suggested `docs/28_Architecture/...` maps here.

## 1. Purpose

This document lets a **new Claude Code session or a new engineer with zero conversation history** open the repository, understand the exact current state, and continue Phase 0 of PickUrVeggie ERP V3 **without violating the approved architecture**. Read this first, verify git state, confirm authority, then continue at Commit #6.

## 2. Current repository state

- **Repository:** `pick-ur-veggie-farm` (GitHub: `noyanxtdoor-maker/pick-ur-veggie-farm`)
- **Current branch:** `feature/phase-0-foundation` (off `develop`)
- **Current phase:** **Stage D — Phase 0: Development Foundation**
- **Status:** **IN PROGRESS**
- **Exact commit hashes at checkpoint:**
  - `feature/phase-0-foundation` = `de9cda5b01eebfe150e0c43206ec4f8b099d57f1`
  - `develop` = `d1c1f04de559016bda582e371b9aa311b42fde29` (Enterprise Engineering Baseline adopted; unchanged since)
  - `main` = `7833c9f70679f3c152aca5498994d6b2da1b24ec` (untouched)
- All three branches are pushed and in sync with `origin`. Working tree clean.

## 3. Completed Phase 0 work (commits, in order)

| Commit | Hash | What it did |
|---|---|---|
| #1 | `9672ed9` | **Repository identity cleanup** — removed Google AI Studio identity; established PickUrVeggie ERP V3 identity (`package.json` name, `index.html` title, `metadata.json` name). |
| #2 | `04961a5` | **V3 workspace documentation** — replaced the AI Studio scaffold README with a V3 workspace overview (authority hierarchy, structure, branch model, run, V2-reference note). |
| #3 | `c2fce0c` | **Node & environment authority** — added `.nvmrc` (Node 22), `package.json` `engines` (`node>=20.19`, `npm>=10`); rewrote `.env.example` to the V3/Supabase client-safe contract (no secrets). |
| #4 | `ec09819` | **TypeScript strictness foundation (staged)** — enabled 8 zero-cost strict protections; deferred `strict`/`noImplicitAny` (V2 debt ~4039) as the documented V3 standard. `tsc --noEmit` green. |
| #5A | `d4178d0` | **Dependency governance cleanup** — removed unused `express`, `@types/express`, `dotenv`, `@google/genai` (0 imports, proven); fixed `clean` script; lockfile −1400 lines. |
| #5B | `de9cda5` | **AI Studio artifact cleanup** — removed `metadata.json` and `assets/.aistudio/.gitignore` (no V3 consumer). |

(Pre-Phase-0 context: `develop` `d1c1f04` adopted the full Enterprise Engineering Baseline via merge `e0fcba6` — Audit Phases 0–7, ADR-001, ODR-001…005, Stage A, B1–B8, C1–C8, readiness gates.)

## 4. Current technical state

- The repository is **no longer a Google AI Studio scaffold** (identity, deps, artifacts cleaned).
- The **V2 prototype remains preserved** in `src/` as historical reference (ODR-001) — it still runs under Vite; it is **not** the V3 implementation.
- **No V3 business implementation exists.** No database schema. No RLS. **No Supabase project.** No ERP modules. No new UI.
- Toolchain: React 19 + Vite 6 + TypeScript 5.8; npm (lockfile v3); Node 22 pinned.
- `tsc --noEmit` passes (0 errors) under the staged-strict `tsconfig.json`.

## 5. Binding architecture authority (governs all future work)

```
ADR-001
ODR-001 … ODR-005
Stage A Governance Reconciliation
Stage B B1–B8 Foundation Specifications
Stage C C1–C8 Engineering Preparation
  — C4 Repository Governance
  — C7 Engineering Constitution (forbidden patterns)
```
All in `docs/28_Enterprise_Architecture_Audit/`. **Code never becomes architectural authority.** Findings register: README in that folder (0 Critical; 44 Resolved / 2 Accepted / 1 Rejected / 12 Open — all Open are Category-B implementation work or Category-C editorial debt; **0 Stage-D blockers**).

## 6. Remaining Phase 0 roadmap

- **Commit #6 — Testing Foundation (C5).** Allowed: add **Vitest** (first authorized new dependency), configure the test framework, establish test conventions, create a **trivial passing test** proving the harness runs. Forbidden: business-logic/ERP-module tests.
- **Commit #7 — CI Tier-1 Quality Gates (C6).** Type checking · linting · formatting · secret scanning · documentation-integrity checks (INDEX freshness + link check). *(Note per C2/C6/C4 §10: CI config is automation, not docs; introduce under the C6 design — and recall GitHub branch protection is a separate owner setting, §8.)*
- **Commit #8 — Local Supabase Development Foundation (C2).** Allowed: local dev tooling / developer environment setup. Forbidden: ERP tables, business schema, RLS policies, production infrastructure, Supabase **project** creation beyond local dev.

Then: **Phase 0 exit gate** — developer can clone & run; `tsc`/tests/CI run; no secrets in git; **branch protection enabled (§8)**; changes traceable to C1/C5/C6/C7.

## 7. Active restrictions (Phase 0 = infrastructure only)

Do **NOT** create: Inventory · Accounting · Sales · Purchasing · Production · HR/Payroll · business workflows · production/business database structures · RLS policies · UI redesigns · ERP features of any kind. Phase 0 builds the *factory*, not the *product*.

## 8. Open governance requirement (BINDING)

```
GitHub branch protection
Status: NOT YET ENABLED
Owner action required.
```
- It is a GitHub repo setting outside Claude's permissions ([Stage_D_Branch_Protection_Precondition.md](Stage_D_Branch_Protection_Precondition.md)).
- **Phase 1 (Identity / Tenant / Security) is BLOCKED until branch protection is enabled on both `main` and `develop`.** This is the approved Stage D exception and remains binding; Phase 0 may proceed without it, Phase 1 may not.

## 9. First instructions for the new session

1. **Read this handoff document** in full.
2. **Verify git state:** `git branch --show-current` (= `feature/phase-0-foundation`), clean tree, and the §2 hashes (or newer on the feature branch); confirm `develop` `d1c1f04` and `main` `7833c9f` unchanged.
3. **Confirm architecture authority** (§5) — re-read C7 (Engineering Constitution) and C8 (implementation sequence) before any change.
4. **Begin Phase 0 Commit #6 — Testing Foundation** (C5), incrementally, with a per-commit report (hash · what changed · authority · confirmation no business module/schema/UI created).

## 10. Checkpoint status

```
Stage D — Phase 0
Checkpoint Complete
Ready for new Claude Code session
```
