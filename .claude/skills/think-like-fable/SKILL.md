---
name: think-like-fable
description: Operating discipline for the PickUrVeggie ERP repo, distilled from the Fable 5 / Opus 4.8 sessions (Jun–Jul 2026). Load at session start in this repo, before claiming any work "done", before touching anything money-path or migration-shaped, and whenever unsure how to verify. Applies to any model working Repo A.
---

# Think Like Fable — how this repo is actually worked

This file transfers the *tacit* layer: the cadence, commands, and judgment patterns that produced
190+ CI-green commits with zero rolled-back features. It complements `CLAUDE.md` (the operating
contract) and never overrides it — if anything here conflicts with CLAUDE.md or its authority
chain (ADR/ODR → Architecture → Stage A → B1–B8 → C1–C8), the higher authority wins.

Every rule below earned its place by catching a real defect or preventing a real loss in this
repo. The examples are not hypothetical.

## 1. Stance — the part that must survive model swaps

- **Verify reality before believing anything** — including your own memory, the handoff, and this
  file. Real case: between sessions, `schedulingApi.setTime()` grew an `event_date` parameter;
  an edit anchored on the remembered signature failed. Re-read before editing.
- **Evidence or it didn't happen.** "Should work", "looks good", "probably fixed" are banned.
  Every "done" carries the command run and its exact output (89/89, 164 PASS / 0 DEFECT, exit 0).
- **Never round up.** `STATUS.md` is read by an external reviewer to decide what to review; one
  false "Done" defeats the whole mechanism. Uncertain → "In Progress".
- **A GO verdict is not authorization.** Real case: the cross-vendor money-path review returned
  GO on all four paths — and the correct move was still to build *nothing*, because the owner
  sign-off checkboxes (§9 of the review doc) were unchecked. Reviews inform; owners authorize.
- **Verify decision provenance, not just file state.** A ticked checkbox in a doc is evidence
  that a decision *exists*, not of what it covers. Real case: the money-path §9 ticks arrived in
  Repo A via commits cross-pushed from the GLM working context while the repos still moved in
  lockstep — valid for the shared pre-fork migrations, but their queued deploy target (the
  original Supabase) had moved to Repo B. Trace *who recorded a decision, when, and against
  which artifact* before acting on it; when provenance is ambiguous, confirm with the owner.
- **Blocked by a gate → say so and stop.** Do not invent authority to keep moving (CLAUDE.md §2).
  Ending a turn at an owner-gated boundary is success, not failure.

## 2. Session start (in order, every session)

1. `git status` · `git log --oneline -5` · `git fetch origin` — compare local vs
   `origin/feature/phase-0-foundation`. **Parallel sessions are real** (other models and the
   owner push between your sessions). Expect drift; `git pull --rebase` your unpublished
   commits on top; never force-push a shared branch.
2. Read `STATUS.md` (repo root — source of truth), then the newest §§ of
   `docs/28_Enterprise_Architecture_Audit/Phase_2_Context_Reset_Handoff.md`.
3. Check CI on HEAD (commands in §5). Green at session start is an assumption worth 10 seconds
   to confirm.
4. Load only the authority docs the task needs — not everything.

## 3. Build cadence — the Engineering Loop, per feature

Spec (reconciled against enterprise Systems 10–26; the mock `src/` app is the workflow-logic
authority) → migration (**additive only — never edit an existing migration file**) → guard
battery (behavioral SQL attacks: the happy path, the sad path, and the wrong-role path) →
`supabase db reset` + **full** guard suite → app layer (three-way seam: MOCK→Dexie |
online→PostgREST/RPC | offline→outbox) → `npx tsc --noEmit` · `npx vitest run` ·
`npx vite build` → browser E2E **with proof** (drive the real app; read persisted state back
from Dexie/Postgres, not from the UI) → commit → push → confirm CI green → update `STATUS.md`
+ handoff + auto-memory. Work is not done until the last step.

## 4. Bug-catching patterns — each caught a real shipped-code bug here

- **Test the other role.** Temporarily strip permissions from the mock seed
  (`app/core/mock/mock.ts` ALL_KEYS), verify the read-only UX in the browser, then revert the
  seed. Caught: read-only users couldn't open a timed calendar block at all (the drag handler
  no-ops without `canManage`, so taps never reached `onSelect`).
- **Non-zero fixtures.** Zero-valued test data hides sign errors. Caught: `balance_sheet()`
  double-subtracted Owner's Drawings — invisible with drawings=0, exposed only by the guard's
  non-zero fixture.
- **Read state back from the store.** After a UI action, query IndexedDB/Postgres directly.
  Caught: fast drag gestures silently dropped their commit (drag state was read from React
  state at pointer-up; fix = keep authoritative drag state in a ref).
- **Hunt false-success paths in your own diff.** Before "done", reread the diff asking: *which
  branch can report success without doing the work?* Caught: the edit modal showed "Event
  updated" when the record lookup missed — a no-op write claiming success.
- **Re-derive cross-module implications from scratch.** Never assume the previous module was
  complete. Building M4 accounting found two latent bugs in already-committed M3A/M2A code
  (expenses posted to inventory; opening balances never posted to the GL).

## 5. Repo-specific commands (where this repo differs from defaults)

- **Guards locally** (npm guard scripts call bare `psql` = CI-only):
  `docker exec -i supabase_db_pick-ur-veggie-farm psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/guards/<file>.sql`
- **CI self-check** (no owner paste needed): `printf "protocol=https\nhost=github.com\n\n" | git credential fill`
  → take `password=` as a Bearer token →
  `GET api.github.com/repos/noyanxtdoor-maker/pick-ur-veggie-farm/actions/runs?head_sha=<sha>`.
  **Never print the token.**
- **Commits:** write the message to a scratch file and `git commit -F <file>` — PowerShell
  here-string quoting corrupts inline multi-line messages.
- **Browser E2E:** `preview_start` name `v3-app` (from `.claude/launch.json`); mock mode accepts
  any credentials; drive with `preview_eval`/`preview_snapshot`. Screenshots sometimes hang —
  text snapshots + direct Dexie reads are the reliable proof.
- **After code changes:** `graphify update .` keeps the knowledge graph current (AST-only).

## 6. Gates — STOP and wait for the owner

- **Money path** (anything touching `pos_record_sale`/settle/void, cash entries, payroll
  postings, B2 digital payments, credit-limit enforcement): requires the cross-vendor review
  AND owner sign-off *in this repo's copy* of
  `Phase_2_Cross_Vendor_Money_Path_Review.md` §9 — then still confirm scope before building.
- **Cloud/infra** (Supabase project, hosting, Play packaging, signup-approval queue): owner-timed.
- Never modify locked migrations. Never push to `main`/`develop`. Never rewrite shared history.
- **Repo boundary (owner, 2026-07-08):** Claude models work **Repo A** (this repo,
  `github.com/noyanxtdoor-maker/pick-ur-veggie-farm`). GLM 5.2 / MiniMax M3 work **Repo B**
  (local `pick-ur-veggie-farm - GLM Version`, `github.com/noyanxtdoor-maker/pickurveggieERPfarm-GLM-version`),
  which owns the ORIGINAL Supabase project. **Never write to Repo B** — reading it to learn
  from their work and mistakes is allowed and useful.

## 7. Reporting

- Lead with the outcome; exact numbers, never approximations.
- Every status row distinguishes **verified fact** (named command/flow + result) from
  **assumed** (compiles, untested). The STATUS.md legend encodes this — use it.
- Failures verbatim. Skipped steps stated as skipped. No hedging on things actually verified.
- `STATUS.md` maintenance log is append-only: never delete history; "Done (pushed)" only when
  committed + pushed + the specific flow tested; a reviewer-flagged issue blocks Done until
  resolved (record resolution + date).

## 8. Anti-patterns observed in this project — do not repeat

- Fabricating results from a subagent/workflow that died before completing. Write from
  first-hand evidence instead, and say the workflow produced nothing.
- Editing a file from memory instead of re-reading it (anchors drift between sessions).
- `git add -A` in a working tree you don't fully understand. Real case (Repo B, 2026-07-09):
  a Bubblewrap/TWA scaffold generated at the repo root collided with the React `app/`
  directory, leaving the entire web app deleted-but-uncommitted — one blind `add -A` from
  committed destruction. Generate Android/TWA wrappers in a folder OUTSIDE the repo.
- Marking a UI feature done from tsc/build alone — the three real calendar bugs above all
  compiled cleanly.
- Blanket verdicts. Verdicts are per-path, per-feature, per-flow (the money review's pattern).
- Building against an owner gate because a review "came back positive" (see §1).
