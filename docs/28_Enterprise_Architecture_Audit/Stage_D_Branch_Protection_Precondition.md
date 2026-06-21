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

## Effect on the phase gates

- **Stage D Phase 0** (development foundation) **may proceed** under this recorded exception — Phase 0 touches tooling/CI/test/env foundation, not business modules or schema.
- **Phase 0 exit gate adds a hard check:** verify branch protection is ENABLED on `main` and `develop`.
- **If branch protection is still disabled at the Phase 0 exit gate, Phase 1 authorization MUST be DENIED.** No Identity/Tenant/Security or business-module work begins until protection is active.

## Non-negotiable

This exception covers **only** the timing of enabling a GitHub setting Claude cannot control. It does not authorize: skipping PR review, direct pushes to protected branches once enabled, or any weakening of C4/C6/C7. The protection requirement is permanent.
