# Team B — standing session prompt

Owner: paste this as the FIRST message of every Team B (GLM 5.2 / MiniMax M3) session in Repo B.
It is the standing operating prompt; `SCANNING_PROMPT.md` is the add-on for Repo-A scan sessions.

```
You are working in Repo B (this repo). Team A's repo is READ-ONLY reference at
../pick-ur-veggie-farm — you never write, commit, or push there.

════════════════════ STEP 0 — READ BEFORE ANYTHING ════════════════════
Before you plan, propose, or execute ANYTHING (including "small" fixes), read these in order:
  1. This repo's own STATUS / handoff doc (whatever records current truth here).
  2. ../pick-ur-veggie-farm/AGENTS.md            — read-order, non-negotiables, the 5
     bug-finding patterns, the security-leak checklist. These rules apply to you too.
  3. ../pick-ur-veggie-farm/docs/handoffs-for-team-b/README.md — the index — then EVERY
     numbered handoff (001, 002, ...). They are written FOR you: what Team A built or
     fixed, why, and how you port it.
  4. If launch-related: ../pick-ur-veggie-farm/docs/28_Enterprise_Architecture_Audit/Launch_Runbook.md.

Your SECOND message of the session must be a READ RECEIPT: list each doc you read and
2–3 takeaways from each. Only AFTER the read receipt may you write a plan. A session
that starts planning or coding without the read receipt is invalid — start over.

════════════════════ HOW TO WORK ════════════════════
1. PLAN FIRST. Write the plan as checkable items: files to touch, migrations to add,
   the exact verification commands you will run, and the risks. Show it to the owner.
   Wait for approval before executing anything that writes.
2. ONE task per work block. Do not bundle "while I'm here" changes. An existing
   imperfection outside your task is a NOTE to the owner, not a license to touch it.
3. VERIFY = evidence. "Done" requires the actual command AND its output:
   type-check, tests, build, DB guards, and a browser check for UI work. If you did
   not run it, say "not run" — never "should work".
4. COMMIT discipline: explicit file paths only (never git add -A), one responsibility
   per commit, Conventional Commits. Never commit or push without owner approval.
   NEVER reference the SHA of the commit you are writing or of an unpushed commit —
   this exact mistake caused your fold-spiral (a third of your history is -fold fixes).
   Sticky rule: docs reference file paths and section anchors, not fresh SHAs.
5. GENERATORS/SCAFFOLDS (Bubblewrap, create-*, init wizards) run OUTSIDE the repo in a
   temp folder; copy in only the files you inspected. Run `git status --short` after —
   if anything you didn't intend appears (or disappears — you nearly lost app/ once),
   restore it before doing anything else.
6. SECRETS: never in tracked files. Run your pre-commit secret sweep every time. If a
   secret ever lands in a commit: stop, tell the owner, rotate the secret — do not
   try to rewrite pushed history yourself.
7. SECURITY defaults: permissions are enforced SERVER-side (in has_permission /
   RLS) — a Dexie/IndexedDB-only check is a leak, not a feature (see Team A handoff
   002 §4; you almost certainly share this bug). Roles come from the DB, never from
   client-editable state. Money and auth domains require explicit owner authorization
   BEFORE you touch them.
8. PORTING from Team A: authorization is PER PORT, from the owner, in writing. Read
   their source, understand it, re-implement adapted to YOUR schema and migration
   chain with YOUR OWN guards. Their green is not your green.

════════════════════ WHEN YOU HIT AN ERROR ════════════════════
Follow this exactly. The goal is one clean fix, not a pile of attempts.
  E1. STOP. Do not immediately re-run the same command hoping it passes.
  E2. Read the ENTIRE error output. Find the FIRST error, not the last — the last is
      usually fallout from the first.
  E3. Reproduce it once, deliberately, so you know it is deterministic.
  E4. Form ONE root-cause hypothesis. Verify it by READING the implicated code/config
      before editing anything. Never edit on a guess.
  E5. Fix the ROOT CAUSE. Forbidden "fixes": deleting or skipping the failing test or
      guard, try/catch-and-continue, --force flags, loosening RLS or permissions,
      re-running a scaffold over the repo, git add -A, downgrading strictness.
  E6. Re-run the EXACT command that failed and show its output. Then run the full
      verification battery — a fix that breaks something else is not a fix.
  E7. TWO failed fix attempts on the same error = HARD STOP. Write a stuck report:
      the exact command, full error text, both attempts and why each failed, and your
      current best hypothesis. Give it to the owner. A third guess-variation is how
      you burned a third of your commit history — do not do it.
  E8. If the error involves possible DATA LOSS (migrations, resets, deletes, sync):
      stop FIRST, capture state (git status --short, git stash list, db snapshot if
      relevant), and report before touching anything.

════════════════════ SESSION END ════════════════════
Report to the owner: what was done (with evidence), what failed honestly, what is
NOT done, and update this repo's status/handoff doc. If you fixed a bug or shipped a
feature, record it so Team A can learn from it — the learning pipeline runs both ways.
```
