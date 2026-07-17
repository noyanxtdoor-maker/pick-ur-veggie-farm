# PickUrVeggie ERP V3

Enterprise, multi-company, multi-branch agricultural ERP — **offline-first**, built on **Supabase (PostgreSQL + Auth + RLS)** with React + Vite + TypeScript. This repository is in **controlled construction** (Stage D), governed by a ratified enterprise architecture.

> **Read before contributing:** the architecture and engineering rules are binding. Start with the governance hierarchy below — code must obey it.

## Governing authority (binding)

The complete enterprise architecture, decisions, and engineering rules live in **[`docs/28_Enterprise_Architecture_Audit/`](docs/28_Enterprise_Architecture_Audit/README.md)**:

- **ADR-001** (architecture ratification) + **ODR-001…005** (owner decisions) — supreme.
- **Enterprise architecture** — `docs/10`–`docs/26` (canonical technical authority); `docs/00`–`docs/08` are vision/history.
- **Stage B (B1–B8)** — enterprise foundation specs (RLS, money precision, indexing, snapshots, idempotency, audit, auth/DR, migration).
- **Stage C (C1–C8)** — engineering controls: **C7 Engineering Constitution** (what no code may break), **C4 Repository Governance** (how changes enter), C1/C5/C6/C2/C3/C8.

Authority order: `ADR/ODR → Enterprise Architecture (10–26) → B1–B8 → Locked Designs (13.02) → Engineering Constitution (C7) → code`. **Code never becomes architectural authority.**

## Repository structure

| Path | Role |
|---|---|
| `docs/` | Architecture & governance (the source of truth). See [`docs/INDEX.md`](docs/INDEX.md). |
| `docs/28_Enterprise_Architecture_Audit/` | The Enterprise Engineering Baseline (audit, ADRs/ODRs, Stage A/B/C). |
| `app/` | **The live V3 application** (entrypoint `app/main.tsx`, per `index.html`). This is where Phases 0–6 were built — auth, RLS-backed org/roles, POS, inventory, accounting, payroll, scheduling, projects, customers, digital payments. |
| `src/` | **Dead legacy code** from an earlier prototype — retained for git history only. Not referenced by `index.html` or `vite.config.ts`; no build output includes it. Do not edit it; do not scan it expecting current behavior. |
| `.github/` | Issue/PR templates + CI (C4). |

## Branch model (C4)

- **`main`** — production releases only (protected — branch-protection ruleset `protect-main-and-develop`
  Active as of 2026-07-12: PR required, 3 CI checks required, force-push/deletion blocked).
- **`develop`** — official integration branch; carries the adopted Enterprise Engineering Baseline.
- **`feature/*`** — all implementation work, off `develop`. Current: `feature/phase-0-foundation`.
- **`architecture-audit`** — preserved historical record of the architecture journey.

## Run locally

**Prerequisites:** Node.js — pinned to **Node 22 LTS** via `.nvmrc` and enforced by `package.json` `engines` (`node >=20.19.0`, `npm >=10`). Run `nvm use` (or install Node 22) before `npm ci`.

```bash
npm ci          # install from the committed lockfile
npm run dev     # start the Vite dev server (http://localhost:3000)
npm run lint    # type-check (tsc --noEmit)
```

Environment variables: copy `.env.example` and fill values locally. **Never commit secrets** (`.env*` is git-ignored). Per **C2**, local development uses a local/dev Supabase only — never production credentials.

### Local Supabase development

A local Supabase stack for development (C2 §1). The full schema (41 tables, RLS-forced, permission-based
authorization, double-entry accounting) lives in `supabase/migrations/` — `npm run db:reset` applies it
from zero.

**Prerequisites:** Docker running locally, and `npm ci` (the Supabase CLI is a pinned dev dependency — no global install).

```bash
npm run db:start    # start the local Supabase stack (Docker)
npm run db:status   # show local service URLs and status
npm run db:stop     # stop the local stack
```

**Connecting:** `npm run db:start` prints the local API URL and `anon` key. Copy those into your `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). The **`.env.example` contract remains the authority** for which variables exist.

## Status

**Stage D, Phases 0–6 built** on `feature/phase-0-foundation` (identity/RLS, master data, operational
ledger, financial engine, all business modules, reporting/AI copilot) — see [`STATUS.md`](STATUS.md) for
the per-feature, never-round-up source of truth. **Phase 7 (Optimization & Production Readiness) is the
current frontier** — see [`docs/28_Enterprise_Architecture_Audit/Launch_Runbook.md`](docs/28_Enterprise_Architecture_Audit/Launch_Runbook.md)
for the ordered path to launch and post-launch duties. Hosted at `pick-ur-veggie-farm.vercel.app`, backed
by Supabase project `aqhxhamdwmhcwxmebqbo`.

## Contributing

Every change is a reviewed PR into `develop` (C4), risk-classified; High-risk areas (auth, RLS, money, accounting, inventory ledger, offline sync, schema) require senior + architecture review. AI-assisted changes follow the same rules. See **C7** for forbidden patterns (no float money, no role-name authorization, no cross-tenant access, no mutable financial/audit history, no RLS bypass).
