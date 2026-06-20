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

## Effect on the phase gates

- **Stage D Phase 0** (development foundation) **may proceed** under this recorded exception — Phase 0 touches tooling/CI/test/env foundation, not business modules or schema.
- **Phase 0 exit gate adds a hard check:** verify branch protection is ENABLED on `main` and `develop`.
- **If branch protection is still disabled at the Phase 0 exit gate, Phase 1 authorization MUST be DENIED.** No Identity/Tenant/Security or business-module work begins until protection is active.

## Non-negotiable

This exception covers **only** the timing of enabling a GitHub setting Claude cannot control. It does not authorize: skipping PR review, direct pushes to protected branches once enabled, or any weakening of C4/C6/C7. The protection requirement is permanent.
