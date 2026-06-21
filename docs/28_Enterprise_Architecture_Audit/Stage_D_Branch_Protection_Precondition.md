# Stage D Precondition — GitHub Branch Protection (BINDING)

**Type:** Governance precondition record · **Status:** ⛔ NOT YET ENABLED — owner action required
**Date:** 2026-06-20 · **Authority basis:** [C4 §10](Stage_C4_Repository_Git_Governance.md), [C8 §3](Stage_C8_Enterprise_Implementation_Sequence_and_Construction_Roadmap.md), [C6](Stage_C6_CI_CD_Quality_Gates_and_Automated_Architecture_Enforcement.md), [C7](Stage_C7_Engineering_Constitution.md).
**Decision reference:** Owner Decision (Branch Protection) = Option 2 — record as a formal binding precondition, do not treat as a hidden exception.

## What this is

GitHub **branch protection** for `main` and `develop` is a **repository setting controlled in the GitHub UI/admin API by the owner** — it is **outside Claude Code's repository permissions**. Claude cannot enable it. This record makes the requirement explicit, binding, and tracked, rather than an unstated assumption.

## Requirement (binding — does not weaken C4 or C7)

Per C4 §10, `main` and `develop` must be protected:
- Require pull requests (no direct pushes) · ≥1 approving review (senior for High-risk, C4 §5) · passing CI status checks (C6) · up-to-date branches · no force-push · no history rewrite.

This requirement remains **fully binding**. Option 2 does not relax it; it records that its *activation* is an owner action with a deadline.

## Status & owner action

| Item | Value |
|---|---|
| Current status | **NOT YET ENABLED** |
| Responsible | Owner (GitHub repo admin) |
| Action required | Enable branch protection on `main` and `develop` in GitHub settings |
| Required completion point | **Before Phase 1 (Identity/Tenant/Security) and before ANY business-module implementation** |

## Approved Branch Protection Configuration

The durable configuration that satisfies the **Requirement** above — *what the protection must be*, not GitHub UI steps (those are delivered operationally at apply-time). C4 §10 remains the owning rule; this records only its operational enforcement.

**Protected branches:** `main`, `develop`. · **Unprotected:** `feature/*` — preserves the rapid implementation loop (C4 §2).

**Pull requests:** required on protected branches; direct pushes forbidden.

**Required approvals:**
- **Current: 0** — while the project has a single authorized contributor (GitHub does not permit self-approval; 0 + required PR + required CI + no direct push is the strongest honestly enforceable solo configuration).
- **Binding trigger:** the moment a second authorized contributor/reviewer exists, raise required approvals to **≥1**; High-risk changes continue to follow C4 §5 senior review. This satisfies the Requirement's "≥1 approving review" as soon as a reviewer exists — until then it is recorded, not waived.

**Required status checks:** `verify`, `secrets` (the checks that exist today; exact names selected from an actual Actions run). Future checks are added only after they exist and are approved — no speculative requirements.

**Additional settings:** require branches up-to-date before merging — Enabled · dismiss stale approvals after new commits — Enabled · conversation resolution — owner discretion.

**History protection:** force pushes forbidden · branch deletion forbidden.

**Not required at current scale:** linear history · signed commits.

**Administrator bypass:** no permanent bypass. Emergency recovery only by (1) temporarily relaxing the specific protection rule, (2) merging the corrective change, (3) restoring protection immediately afterward (auditable via GitHub settings history).

## Temporary Solo-Founder Enforcement Exception

**Status:** Temporary operating exception — active only while all scope conditions and expiration criteria remain satisfied.

**Authority.** C4 §10 remains the permanent, unweakened requirement. This records a **temporary operating condition** below the architecture layer; it does **not** amend C4, C6, C7, or C8.

**Why this exists (justification — changed threat model, not finances).** GitHub Free private repositories cannot technically enforce the Approved Configuration above — neither rulesets nor classic branch protection are enforced on a Free private repo. The current threat model is materially narrower: a single human repository owner · no second or external contributor · no independent AI credentials (AI actions operate through the owner with explicit approval) · no production users · no real business/customer data. The inability to purchase GitHub Pro is the **circumstance** that revealed the limitation; it is **not** the architectural justification and is **not** a reason to lower the standard.

**Scope.** The exception temporarily waives **only** the unavailable GitHub branch-protection *enforcement mechanism* for `main`/`develop`. It does **not** waive PR discipline, CI verification, security-review discipline, architectural governance, or Git history integrity. **Branch protection remains the required architectural state.**

**Degraded posture (explicit).** The compensating controls below **reduce the probability** of a violation; they do **not** equal technical enforcement, and **residual risk remains**. Manual discipline does **not** replace GitHub protection.

**Mandatory compensating controls (while the exception is valid):**
- `main` — release/archive only; no direct development.
- `develop` — no direct pushes; changes only through Pull Requests.
- `feature/*` — normal development workflow.
- Every merge into `develop`: `feature/*` → checkpoint push → Pull Request → GitHub Actions `verify` + `secrets` must pass → architecture review → explicit owner merge decision.
- No force-push or history rewrite on `main`/`develop` · no deletion of approved-milestone branches · maintain frequent remote checkpoints · maintain a linear, auditable history.

**Automatic expiration — the exception terminates the moment ANY occur:**
- *Team:* a second human contributor · a contractor · any external write access.
- *Enforcement becomes available:* GitHub Pro · GitHub Team/Enterprise · any mechanism providing actual branch-protection enforcement.
- *Product maturity:* production-deployment preparation · real customer/business data · external audit · investor or commercial due diligence.
- *Periodic:* mandatory re-evaluation at every Stage D phase boundary.

Upon expiration, actual branch protection must be enabled and verified **before further phase progression**.

**Non-transferable.** This exception applies only to a single-owner, pre-production environment. It does **not** transfer to a team, contractor environment, or production operation.

## Effect on the phase gates

- **Stage D Phase 0** (development foundation) **may proceed** under this recorded exception — Phase 0 touches tooling/CI/test/env foundation, not business modules or schema.
- **Phase 0 exit gate adds a hard check:** verify branch protection is ENABLED on `main` and `develop`.
- **Default rule:** if branch protection is disabled and **no valid exception is active**, Phase 1 authorization MUST be DENIED — no Identity/Tenant/Security or business-module work begins until protection is active.
- **Exception case:** while the **Temporary Solo-Founder Enforcement Exception** (above) remains valid and all its compensating controls are active, Phase 1 may proceed under those controls.
- **On expiration:** the default hard gate automatically returns — no further phase progression until real branch protection is enabled and verified. The exception is never a permanent waiver.

## Non-negotiable

This exception covers **only** the timing of enabling a GitHub setting Claude cannot control. It does not authorize: skipping PR review, direct pushes to protected branches once enabled, or any weakening of C4/C6/C7. The protection requirement is permanent.
