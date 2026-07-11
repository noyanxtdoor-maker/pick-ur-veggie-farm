# AGENTS.md — Onboarding for EVERY AI model working this repo

**Audience:** ChatGPT 5.6, Claude Opus 4.8, Claude Sonnet 5, and any future model. **Read this first,
top to bottom, before touching anything.** Written 2026-07-11 by Fable 5 (the model that built Phases 1–6
with the owner) as the durable transfer of how this repo is worked.

## 0. What this is

**Pick Ur Veggie ERP V3** — a real farm ERP (weigh POS, inventory, double-entry accounting, payroll,
scheduling, projects, customers, digital payments, AI copilot) for a Philippine vegetable farm.
React 19 + Vite PWA · Dexie offline-first · Supabase (Postgres + RLS + Auth) · deployed as a static SPA.
This is **Repo A (Team A — the official-launch repo)**. A sibling **Repo B**
(`../pick-ur-veggie-farm - GLM Version`, github `pickurveggieERPfarm-GLM-version`, Team B = GLM 5.2 /
MiniMax M3) shares the lineage: **read theirs freely, NEVER write it** (one instruction-file exception
per explicit owner authorization). Cross-repo code ports happen ONLY with the owner's authorization.
Repo A's Supabase project: `aqhxhamdwmhcwxmebqbo` (ap-northeast-1). Repo B owns `jabjyvdkadcbfocaerno`.
**Never point either repo at the other's cloud project.**

## 1. Read in this order, every session

1. `CLAUDE.md` (repo root) — the operating contract. Its authority chain is absolute:
   ADR/ODR → Enterprise Architecture → Stage A → B1–B8 → C1–C8 → CLAUDE.md → code.
2. `.claude/skills/think-like-fable/SKILL.md` — the working discipline (verification cadence,
   repo-specific commands, the bug patterns that caught real defects). **Non-Claude models: this is a
   plain markdown file — read it like any doc. Every rule applies to you too.**
3. `STATUS.md` — the per-feature source of truth. Rule: **never round up.** "Done" = committed AND
   pushed AND that specific flow tested. Update it before ending every session.
4. `docs/28_Enterprise_Architecture_Audit/Phase_2_Context_Reset_Handoff.md` — newest §§ = where work
   stopped and why.
5. `docs/28_Enterprise_Architecture_Audit/Launch_Runbook.md` — the path to launch + post-launch ops.

## 2. Non-negotiables (each one exists because it caught or prevented a real incident here)

- **Evidence or it didn't happen.** Every "done" names the command run and its output
  (e.g. "guards 182 PASS / 0", "vitest 92/92", "invoice #1 ₱270 journal balanced").
- **Migrations are immutable once committed.** Evolve schema via NEW additive migrations;
  functions evolve via drop+recreate in a new file. Never edit an old migration.
- **Money paths are gated.** Anything touching GL postings (sales, void, settle, cash entries, payroll,
  payments, transfers) needs: the owning spec read first → a behavioral guard battery → full-suite
  attack (`supabase db reset` + every battery) → cross-vendor review → owner sign-off IN THIS REPO.
  A reviewer's GO is NOT authorization; the owner's sign-off is. Verify decision PROVENANCE, not just
  a ticked checkbox.
- **RLS is the security boundary.** Every table: RLS enabled AND forced, zero anon grants; governed
  domains are function-only writes (SECURITY DEFINER, `set search_path = ''`, actor + permission +
  branch-membership checks BEFORE any write). Money is `numeric`, never float. Balances are DERIVED,
  never stored. Corrections are reversal-by-addition, never UPDATE/DELETE of posted rows.
- **Tests must never touch production.** vitest pins `VITE_USE_MOCK=true` (vite.config.ts) — do not
  remove it; a real `.env` once sent the unit suite against the live cloud.
- **Secrets:** `.env` is gitignored; only `VITE_SUPABASE_URL` + the anon key belong there. The
  service_role key and DB password NEVER touch a file. Before every push:
  `git diff origin/<branch>..HEAD | grep -iE "key|token|secret|password"` and read every hit.
- **Never `git add -A`.** Stage by explicit path. Deletions are never incidental. Run
  `git status --short` after ANY generator/scaffold tool and account for every line (Repo B nearly
  committed the deletion of its entire web app after a Bubblewrap scaffold collided with `app/`).
- **Docs never reference their own commit's SHA** (it creates an unresolvable placeholder → an endless
  fix-commit spiral; Repo B lost a third of a day's commits to this). Reference the previous commit or
  stable anchors.
- **Every finished feature/bugfix ships a Team-B handoff** file in `docs/handoffs-for-team-b/`
  (what/why/how + port notes). This is a standing owner order (2026-07-11).

## 3. The build cadence (the "Engineering Loop")

Spec (reconcile vs Systems 10–26; `src/` mock = workflow authority) → migration (additive) → guard
battery (happy path + sad path + wrong-role path + non-zero fixtures) → `npx supabase db reset` + ALL
batteries → app layer (three-way seam: mock→Dexie | online→PostgREST/RPC | offline→outbox) →
`npx tsc --noEmit` · `npx vitest run` · `npx vite build` → browser E2E with proof (read persisted state
back from IndexedDB/Postgres, never trust the UI) → commit (`git commit -F <msgfile>`) → push → confirm
CI ACTUALLY green (see command below) → STATUS.md + handoff + Team-B handoff file.

Repo-specific commands that differ from defaults:
- Guards locally: `docker exec -i supabase_db_pick-ur-veggie-farm psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/guards/<file>.sql`
  (npm guard scripts use bare `psql` = CI-only). NOTE: both repos' local stacks share ports 54321/54322 —
  never `supabase stop` the OTHER repo's running stack; coordinate through the owner.
- CI self-check: `printf "protocol=https\nhost=github.com\n\n" | git credential fill` → take `password=`
  as a Bearer token → `GET api.github.com/repos/noyanxtdoor-maker/pick-ur-veggie-farm/actions/runs?head_sha=<sha>`.
  Never print the token.
- Cloud psql: session pooler `aws-0-ap-northeast-1.pooler.supabase.com:5432`, user
  `postgres.aqhxhamdwmhcwxmebqbo` (the direct `db.<ref>` host is IPv6-only). Password comes from the
  owner per session — never store it.
- Deploy: `npx vercel deploy --prod` (Git auto-deploy stays OFF — the default production branch would
  ship the stale `main`). Working branch is `feature/phase-0-foundation`; never push to `main`/`develop`.

## 4. How to FIND bugs (these five patterns each caught a real shipped defect here)

1. **Test the other role** — strip permissions and walk the same flow (caught: read-only users
   couldn't open calendar blocks at all).
2. **Non-zero, asymmetric fixtures** — zeros hide sign errors, symmetric values hide swapped operands
   (caught: balance sheet double-subtracted Drawings).
3. **Read state back from the store** after every UI action (caught: fast drags silently lost writes).
4. **Hunt false-success paths in your own diff** — which branch can report success without doing the
   work? (caught: "Event updated" toast on a no-op write).
5. **Re-derive cross-module implications from scratch** — never assume the previous module is complete
   (caught: two latent GL bugs in already-committed code).
Also: test your TEST (a case-sensitive text match against CSS-uppercased text produced two false alarms
here); when a check fails, first ask whether the check is wrong — then prove it either way.

## 5. How to FIND security leaks (the checklist that has worked)

For every new table/function/endpoint ask, in order: Is RLS enabled AND forced? Any grant to `anon`?
Can a user of company B name company A's ids anywhere (function args, filters) and get data or effects?
Can a user without the specific permission key reach it (not role NAMES — keys)? Is any write reachable
outside a governed function? Does any SECURITY DEFINER function skip `set search_path=''`, the actor
check, or the branch check? Can a client dictate a price/amount the server should compute? Is anything
that looks like a balance STORED rather than derived? Do errors leak other tenants' existence? Then
write the attack as a permanent guard in `scripts/guards/` — a finding without a guard will regress.

## 6. Current frontier (2026-07-11) — see Launch_Runbook.md for the full path

Phases 1–6 are BUILT and audited (STATUS.md §2 row-by-row). Launch blockers live in the runbook:
re-host on the NEW Vercel account, Google OAuth finish, approvals/roles hardening (P1C spec'd in the
runbook), B2A lock review, Play packaging, MFA, backups. **Post-launch duties are §4 of the runbook —
they are work, not suggestions.**
