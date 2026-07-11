# Repo A — Branch Protection Ruleset (exact settings)

**Status:** NOT yet applied (2026-07-11). Owner chose to make Repo A public; the 1-day PAT lacked
*Administration:write*, so the agent could apply neither the visibility change nor the ruleset. This file
is the exact spec so it can be applied in ~2 minutes by the owner, or by an agent once given a PAT with
*Administration: Read and write*.

## Prerequisite (Free tier)
Rulesets require the repo to be **Public** OR the account on **GitHub Pro**. Repo B is public with an
active ruleset; the owner chose the same for Repo A.
- Owner: Settings → General → Danger Zone → **Change repository visibility → Make public → confirm.**
  (Tracked files are secret-clean: `.env` is gitignored, the anon key is not committed and is public by
  design; RLS is the security boundary. Verified via `git grep` for key/token/secret/password = no hits.)

## Ruleset: `protect-main-and-develop`
- **Enforcement:** Active
- **Target branches:** `main` and `develop` (add both; the working branch `feature/phase-0-foundation`
  stays unprotected so daily work continues).
- **Rules:**
  - ✅ Restrict deletions
  - ✅ Block force pushes
  - ✅ Require a pull request before merging
    - Required approvals: **0** (GitHub forbids self-approval; 0 + required PR + required CI + no direct
      push is the strongest honest solo config)
    - ✅ Dismiss stale approvals on new commits
    - ✅ Require approval of the most recent reviewable push
    - ❌ Require Code Owner review (no CODEOWNERS file — would block all merges)
  - ✅ Require status checks to pass before merging
    - ✅ Require branches to be up to date before merging (strict)
    - Required checks (add exactly the names GitHub shows from a green Actions run):
      **`Verify (install · type · test · build)`**, **`Secret scan`**,
      **`DB guards (RLS · tenant · audit · drift · no-role-name · no-float)`**
  - ✅ Require conversation resolution before merging
  - ❌ Require signed commits (not required at current scale)
  - ❌ Require linear history

## For an agent with a properly-scoped PAT
`POST /repos/noyanxtdoor-maker/pick-ur-veggie-farm/rulesets` with this body:
```json
{
  "name": "protect-main-and-develop",
  "target": "branch",
  "enforcement": "active",
  "conditions": {"ref_name": {"include": ["refs/heads/main", "refs/heads/develop"], "exclude": []}},
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "pull_request", "parameters": {"required_approving_review_count": 0, "dismiss_stale_reviews_on_push": true, "require_code_owner_review": false, "require_last_push_approval": true, "required_review_thread_resolution": true}},
    {"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": true, "required_status_checks": [{"context": "Verify (install · type · test · build)"}, {"context": "Secret scan"}, {"context": "DB guards (RLS · tenant · audit · drift · no-role-name · no-float)"}]}}
  ]
}
```
Verify after: `GET /repos/.../rulesets` shows it Active; a direct push to `main` is rejected.
