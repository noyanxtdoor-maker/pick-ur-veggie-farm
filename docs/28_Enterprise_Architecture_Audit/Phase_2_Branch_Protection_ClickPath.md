# Branch Protection — Owner Click-Path (Operational Apply Guide)

**Type:** Operational how-to (companion to `Stage_D_Branch_Protection_Precondition.md` which is the
*what* and `Phase_2_Owner_Decision_Package.md §4` which is the *when*). **Date:** 2026-07-08.
**Audience:** Owner (GitHub repo admin). **Authority:** unchanged from the binding source spec
`Stage_D_Branch_Protection_Precondition.md §27-47`.

**Pre-flight (read first):** the source spec is binding. This file is only the UI click-path that
applies it. If anything in this file ever disagrees with the source spec, the source spec wins —
this file is operational, not authoritative.

---

## 0. Pre-check (agent-side, already done)

Agent already verified the *current* state via the public GitHub API:

- `GET /repos/noyanxtdoor-maker/pickurveggieERPfarm-GLM-version/rulesets` → **404** (no rulesets exist)
- `GET /repos/noyanxtdoor-maker/pickurveggieERPfarm-GLM-version/branches/main/protection` → **401** (requires auth)

Conclusion consistent with source spec §22: **NOT YET ENABLED.** Agent cannot read the auth'd
view, so post-apply verification will need either (a) a screenshot of the GitHub settings page
pasted into chat, or (b) the owner shares a Personal Access Token with `repo` scope via the
secure channel chosen for Track C. Either works — the agent's audit checklist is the same.

---

## 1. Two-track decision — pick ONE before clicking

| Track | When to pick | What it produces | Post-apply state |
|---|---|---|---|
| **A — Real protection** (recommended) | You have GitHub **Pro / Team / Enterprise** OR the repo is **public** | A real GitHub Ruleset enforced by GitHub on `main` + `develop` | The exception in source spec §49-76 **terminates immediately** upon successful apply; per source §74, the *exception is never a permanent waiver* — applying real protection *is* its expiration |
| **B — Continue exception** | Free private repo, single-owner (the current state) | No GitHub change. The compensating controls in source spec §61-66 remain active. | Per source §73, re-evaluate at every Stage D phase boundary. The next handoff will record a fresh re-evaluation entry. |

**The rest of this doc is Track A (real protection).** If you pick Track B, the only action is
"no change" + the next handoff records a re-evaluation entry — that's it, nothing to click.

---

## 2. Track A click-path (real ruleset)

### 2.1 Navigation (one-time per ruleset)

1. Open `https://github.com/noyanxtdoor-maker/pickurveggieERPfarm-GLM-version` in a browser.
2. Under the repository name row, click **Settings** (the gear icon at the right end of the
   tab strip). If Settings is hidden, click the **…** (kebab) menu at the right and pick
   **Settings** from the dropdown.
3. In the left sidebar under **Code and automation**, click **Rules** → **Rulesets**.
4. You should land on the Rulesets page. It will likely say *"No rulesets"* — that's the
   current state, matching the agent's API check above.
5. Click the green **New ruleset** button (top-right of the list).

### 2.2 Ruleset name and enforcement

6. Pick **New branch ruleset** (not a tag or push ruleset).
7. **Ruleset name:** `protect-main-and-develop` (suggestion — owner may rename; the name is
   informational only).
8. **Enforcement status:** leave at **Active** (the default). Do NOT pick "Evaluate" — Evaluate
   is for testing metadata restrictions only and does not enforce. Do NOT pick "Disabled" — that
   is the current state. **Active = your ruleset will be enforced upon creation.**

### 2.3 Targets (which branches)

9. In the **Target branches** section, click **Add a target** → choose **Include by pattern**.
10. Type the pattern: `main` → click **Add** (or just press Enter, depending on UI flow).
11. Click **Add a target** again → **Include by pattern** → `develop` → Add.
12. You should now see two entries under Target branches: `main` (include) and `develop` (include).
13. **Do NOT** add a target for `feature/*` — per source spec §31, feature branches must remain
    unprotected to preserve the rapid implementation loop (C4 §2).

### 2.4 Bypass list

14. In the **Bypass list** section, do **not** add anyone. The source spec §47 says
    "no permanent bypass." If an emergency ever requires a bypass, follow the §47 procedure:
    temporarily relax the specific rule, do the corrective change, restore immediately.
    *That is the only correct use of the bypass list, and it is one-off, not standing.*

### 2.5 Rules to enable (the actual protection)

15. In the **Branch protections** section, enable (toggle ON) each of these rules. The exact
    labels below are the GitHub 2025/2026 UI labels per the docs; if a label differs in the
    live UI by a word, pick the closest match — the binding requirement is from source spec
    §27-47, not the UI label.

- **Require a pull request before merging** — ON.
  - **Required approvals: 0** (per source spec §36: GitHub does not permit self-approval; 0 +
    required PR + required CI + no direct push is the strongest honestly enforceable solo
    configuration).
  - **Dismiss stale pull request approvals when new commits are pushed** — ON (per source §41).
  - **Require review from Code Owners** — OFF (no CODEOWNERS file exists; turning this on
    would block all merges).
  - **Require approval of the most recent reviewable push** — ON (GitHub 2025 default; safe).

- **Require status checks to pass before merging** — ON.
  - **Require branches to be up to date before merging** — ON (per source §41).
  - **Status checks that are required:** click **+ Add checks** → search/type → add
    **`verify`** and **`secrets`**. (These are the two checks per source §39; exact names
    selected from an actual Actions run. The first green Actions run on `4137fec` will show
    the exact names — if GitHub shows them slightly differently, e.g. `verify (pull_request)`,
    add the one GitHub shows. Do not invent check names — only add ones that have actually
    run green at least once.)

- **Require conversation resolution before merging** — owner discretion (per source §41).
  - Recommendation: **ON** — it's free safety and matches C7 §1 hygiene. If you turn this
    off, add a note in the handoff explaining why.

- **Require signed commits** — OFF (per source §46: "Not required at current scale").
- **Require linear history** — OFF (per source §46).
- **Block force pushes** — ON (per source §43).
- **Block branch deletion** — ON (per source §43).

### 2.6 Restrictions (metadata)

16. **Restrictions section** is optional. Source spec does not require any. **Skip** unless you
    have a specific reason (e.g. commit-message regex enforcement). Default: leave empty.

### 2.7 Create

17. Click **Create** (green button, bottom of the page). Per the GitHub docs: *"If the
    enforcement status of the ruleset is set to 'Active', the ruleset takes effect immediately."*
    The next attempt to push directly to `main` or `develop` will be rejected with a
    *"Changes must be made through a pull request"* message — that's the proof it worked.

---

## 3. Post-apply verification

### 3.1 Owner-side smoke test (1 minute)

After Create, do this quick check yourself:

- Try `git push origin main` from a local clone (any commit). The push should be **rejected**
  with a clear error like *"Branch is protected"*. This is the live proof.
- Then `git push origin develop` — same rejection. Both rules in effect.

### 3.2 Agent-side audit (requires owner signal)

The agent cannot read the GitHub rulesets endpoint without auth. To close the audit loop, the
owner has two options:

- **Option X (screenshot):** take a screenshot of the Rulesets page showing both targets +
  Active status, paste it into chat. The agent will append a `STATUS.md §4` line confirming the
  config and cite the screenshot as the audit source.
- **Option Y (PAT):** create a GitHub Personal Access Token with `repo` scope, share it via the
  same secure channel chosen for Track C env keys, and the agent will run:
  ```bash
  curl -sS -H "Authorization: Bearer <PAT>" \
    https://api.github.com/repos/noyanxtdoor-maker/pickurveggieERPfarm-GLM-version/rulesets | jq '.'
  ```
  and verify every rule from §2.5 above is present, ON, and correctly targeted.

**Recommend Option X for the first apply** — no new credentials, screenshot is the same evidence
as the UI view the owner just saw.

### 3.3 Handoff update

After verification, the agent appends a `STATUS.md §4` entry of the form:

> "**2026-MM-DD** — Track D applied. Ruleset `protect-main-and-develop` Active on `main` + `develop`
> with config per `Stage_D_Branch_Protection_Precondition.md §27-47` (verified by <screenshot /
> API>). Source spec §74 *expiration trigger* activated: the Temporary Solo-Founder Enforcement
> Exception is **terminated** as of this apply. The compensating controls in source §61-66 are
> no longer the binding posture. **Per source §83, the default hard gate (no Phase 1 progression
> without protection) is now satisfied by enforcement rather than exception.**"

---

## 4. If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| "Cannot create ruleset — your plan does not support this" | Free private repo without Pro | You are on Track B (exception). Re-evaluate at next Stage D boundary per source §73. Do not try to bypass. |
| "Status check `verify` not found" when adding | The check has never run green | Push a no-op commit to a feature branch, wait for CI to run once, then add the check by the exact name GitHub shows |
| Push to `main` still succeeds after Create | Wrong target pattern | Edit the ruleset, confirm targets list `main` and `develop` as include patterns (not `*main*` or `main*` — those wildcard patterns are different) |
| PR creation blocked unexpectedly | CODEOWNERS file or required-review rule misconfigured | Source spec §31 leaves `feature/*` unprotected; if a PR is blocked on a feature branch, the ruleset likely has the wrong target pattern — review §2.3 step 13 |
| Cannot dismiss a bypass you added by accident | The bypass list is sticky | Source §47: this is correct behavior. Either use the bypass (one-off, audited) or remove the bypass and re-create the ruleset |

---

## 5. What this doc does NOT do

- **No GitHub API call from the agent.** The agent cannot create or modify the ruleset. This is
  an owner action in the GitHub UI.
- **No credential handling.** The agent does not store or transmit any GitHub credential, PAT,
  or 2FA token. The §3.2 Option Y path uses the same secure channel you pick for Track C env
  keys — the agent does not define that channel.
- **No exception path on Track A.** Per source spec §74, applying real protection is the
  *expiration event* for the temporary exception. You cannot keep both. If you need to revert to
  Track B later, that's a new decision with its own handoff entry.

---

## 6. Change log

- **2026-07-08** — created. Companion to the binding source spec; first operational click-path
  the repo has for this decision. Updated to match the GitHub 2025/2026 rulesets UI per the
  live docs (ruleset-based; classic branch protection still available but rulesets are the
  recommended path). Two-track structure (real protection vs. continue exception) preserves
  the source spec's binding rule that branch protection is a permanent architectural requirement
  even when Free-plan enforcement is unavailable.

---

| **Date of this slice** | 2026-07-08 |
| **Track-D status** | **SIGN-OFF RECORDED, EXECUTION QUEUED** (see §7 below) |
| **Source artifact** | `docs/28_Enterprise_Architecture_Audit/Stage_D_Branch_Protection_Precondition.md` (BINDING) |
| **Operational artifact** | this file (the click-path; F2 fix landed in `3dd43bf`'s follow-up commit) |
| **Reviewer of record** | GLM 5.2 via Hermes CLI (auditing this file + the source spec) |
| **Authority invoked** | `CLAUDE.md §0` governance hierarchy · `Stage_D_Branch_Protection_Precondition.md §18–25` current state · `C4 §10` (owning rule, unweakened) |

---

## 7. Authorization record (2026-07-08 — owner pasted the §12 Track D prompt verbatim)

**Owner authorization (verbatim from `Phase_2_Context_Reset_Handoff.md §12`):**

> "Approve Track D branch protection enable. Apply the configuration from `Stage_D_Branch_Protection_Precondition.md §27-47` to `main` and `develop`. Required checks: `verify`, `secrets`. Next session: verify the GitHub settings + record the enable in `STATUS.md §4`."

**Owner decisions (resolved by the prompt's bracketed values, recorded as the agent understood them):**

- [x] **Apply the Approved Branch Protection Configuration from source spec §27–47 to `main` and `develop`** — **APPROVED 2026-07-08**. The exact ruleset is the 8-rule set enumerated in §2.5 of this file (PR required, 0 approvals, dismiss stale, status checks `verify`+`secrets`, branches up-to-date, conversation resolution, no force-push, no branch deletion), targeted at `main` and `develop` only, no bypass list, restrictions skipped, enforcement = Active. The two-track decision (Track A real ruleset / Track B continue exception) at §1 of this file is the owner's own pre-flight; the agent's reading of the §12 prompt is that the owner has chosen **Track A (real ruleset)** by pasting this prompt.
- [x] **Required status checks = `verify`, `secrets`** — **APPROVED 2026-07-08** (per the prompt's explicit text). These are the exact check names that exist in the Actions workflow today per the source spec §39. The agent's audit checklist will reject any ruleset that references a different name (no speculative requirements per the source spec).
- [x] **Verify the GitHub settings after apply** — **APPROVED 2026-07-08**. Per §3.2 of this file, the agent's audit path is one of: (a) owner pastes a screenshot of the GitHub Settings → Rulesets page; or (b) owner shares a Personal Access Token with `repo` scope via the secure channel chosen for Track C, and the agent runs `curl -sS -H "Authorization: Bearer <PAT>" https://api.github.com/repos/noyanxtdoor-maker/pickurveggieERPfarm-GLM-version/rulesets | jq '.'` and verifies every §2.5 rule is present, ON, and correctly targeted.
- [x] **Record the enable in `STATUS.md §4`** — **APPROVED 2026-07-08** (append-only maintenance log entry per the standing rule in STATUS.md header).

**F2 fix landed in this same commit (owner-authorized by the Track D sign-off):**

- The pre-check API examples (lines 18, 19) and the post-apply audit curl (line 148) and step 1 (line 44) of this file previously referenced `pick-ur-veggie-farm` (repo A — the first version, "DISREGARDED" per the 2026-07-08 push task). All four live URL references (steps 1, pre-check #1, pre-check #2, post-apply audit curl) now point at `pickurveggieERPfarm-GLM-version` (repo B — canonical). Verified with `grep`: zero live repo-A URLs remain. The click-path is now executable against the canonical repo.

**What was done in this session (the doc-only record half):**

- This §7 record.
- The 4-line F2 URL fix.
- Handoff §14 documenting the same.
- STATUS.md §4 matching entry.

**What is QUEUED for the next session that has the right environment (the GitHub UI click-path + verification half of the §12 prompt):**

The §12 prompt's "Apply the configuration ... verify the GitHub settings" half cannot start in this git-only terminal. The agent does NOT have the GitHub credentials, the secure-channel PAT, or the ability to drive a browser to take a screenshot. The execution sequence is the click-path's §2 (17 numbered steps) followed by §3.1 (owner's 1-minute smoke test) and §3.2 (the agent's audit). The next session with the right environment (or with a screenshot/PAT from the owner) will:

1. Walk the owner through §2.1–§2.7 of this file (the 17 steps in §2.5: PR required → 0 approvals → dismiss stale → status checks `verify`+`secrets` → branches up-to-date → conversation resolution → no force-push → no branch deletion).
2. Run §3.1 (owner smoke tests: try direct push to `main` → expect rejection; try direct push to `develop` → expect rejection).
3. Run §3.2 (the agent audit, with the owner's screenshot or PAT).
4. Append the apply event to `STATUS.md §4` (per the §12 prompt's explicit instruction) and to handoff §14 (or §15 if §14 is already used by the B/C/E records).

**Per the source spec §81–84, if branch protection is disabled and no valid exception is active, Phase 1 authorization MUST BE DENIED.** This is a hard gate. The current "Temporary Solo-Founder Enforcement Exception" (source spec §49–76) is active and Phase 1 is therefore not blocked today; this Track D sign-off ends the exception the moment real protection is verified, per the source spec's automatic-expiration rules.

**Honest scope note (for GLM 5.2 audit):**

- The Track D "sign-off" half is recorded and on both remotes.
- The Track D "apply" half is QUEUED, not faked. No ruleset was created, no GitHub API call was made, no click-path step was executed, no Settings page was opened.
- F2 is fixed in this same commit (the click-path now points at the canonical repo).
- Per the click-path's §5 "What this doc does NOT do," the agent does NOT make any API call from its own credentials, does NOT handle the PAT, and does NOT enable Track A+B coexistence.
