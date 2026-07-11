# Prompt for Team B — how to scan Team A's repo

Paste this to your GLM 5.2 / MiniMax M3 session when the owner authorizes a scan of Team A
(`../pick-ur-veggie-farm`, github `noyanxtdoor-maker/pick-ur-veggie-farm`).

```
TASK: Scan Team A's repo (../pick-ur-veggie-farm) to learn from their successes and port
authorized improvements into Repo B. READ-ONLY on Repo A — you never write, commit, or push
anything in their repo. All porting lands in Repo B as NEW commits with your own migration
numbering and your own guards.

DO THIS, IN ORDER:
1. Read Team A's docs/handoffs-for-team-b/ FIRST — README.md (index) then every numbered
   handoff. Each one tells you what they built/fixed, why, and how to port it. These are
   written FOR you.
2. Read their STATUS.md §2 (per-feature truth) and Launch_Runbook.md (the ordered path to
   launch + post-launch). Map each "Done" row to what you have vs. lack in Repo B.
3. For each authorized port:
   a. Read the actual source: the migration in supabase/migrations/, the guard in
      scripts/guards/, the app files. Understand it — do NOT copy blind.
   b. Re-implement in Repo B adapted to YOUR schema/migration chain. Money/auth-domain ports
      get YOUR OWN behavioral guard battery + a full-suite attack (supabase db reset + every
      battery). Their green is not your green.
   c. Verify with evidence (tsc, vitest, build, guards, browser E2E), commit by explicit path
      (never git add -A), confirm CI actually green, then record it in YOUR handoff + STATUS.
4. NEVER reference a Repo-A commit SHA in a Repo-B doc as if it were yours — cite it only as
   context ("ported from Team A's approach in <file>"). Your commit is a new Repo-B commit.
5. If a port would touch a money path or the auth resolver, STOP and get the owner's explicit
   authorization first (it is a gated domain in both repos).

RULES THAT APPLY TO YOU TOO (from Team A's AGENTS.md + your own engineering-discipline skill):
- Evidence or it didn't happen. No "done" without the command + its output.
- Migrations immutable once committed; evolve via new additive migrations.
- Never reference the SHA of the commit you're writing (this is what caused your fold-spiral).
- Generators/scaffolds run OUTSIDE the repo; run git status --short after any of them.
- Secrets never in files; run the pre-commit secret sweep every time.
- Per-user permissions must be SERVER-enforced (in has_permission), never Dexie-only —
  see handoff 002 §4, it's a security leak.

REPORT BACK to the owner: what you ported, the evidence for each, and any Team-A approach you
chose NOT to port and why.
```
