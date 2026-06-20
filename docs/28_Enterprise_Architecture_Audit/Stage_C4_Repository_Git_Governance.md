# Stage C4 — Enterprise Repository Governance, Git Workflow & Change Management

**Type:** Stage C engineering-governance artifact (binding) · **Status:** In force
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Authority basis:** ADR-001, ODR-001…005, [C7 Engineering Constitution](Stage_C7_Engineering_Constitution.md), Stage B (B1–B8); builds on `18.07_Git_Workflow_And_Branching` and the existing `.github/` templates.
**Scope note:** governance documentation only. **No code, no branch merges, no protected-branch changes.**

C4 defines **how every change enters the system**. It is the companion to C7 (which defines *what* may exist): a change that follows this workflow but violates C7 is still rejected (§12).

---

## 1. Repository philosophy

1. **Every change is traceable** — to an architecture authority, a branch, a PR, tests, and an approved merge (§11).
2. **No direct modification of protected branches** (`main`, `develop`) — §10.
3. **Quality over speed** — correctness and architecture compliance outrank delivery pace (C7 §1).
4. **Small, reversible changes** over large uncontrolled ones (single-responsibility commits/PRs).
5. **Architecture decisions stay visible and documented** — decisions live in the audit package / ADR-ODR, not buried in code.

## 2. Branch authority model

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Production releases only — tagged, approved, immutable milestones | ❌ no direct development, experiments, or unreviewed changes. Protected (§10). |
| `develop` | Integration branch — verified work ready for wider testing | Requires passed review + CI + architecture compliance. Protected (§10). |
| `feature/*` | Individual implementation work (e.g. `feature/authentication-rbac`, `feature/inventory-ledger`, `feature/accounting-engine`, `feature/pos-sales-flow`) | Single responsibility; short lifespan; linked to an architecture authority; merges to `develop` via PR. |
| `hotfix/*` | Urgent production corrections | Minimal scope; extra audit; root-cause review after release (§9). Branched from `main`, back-merged to `main` + `develop`. |
| `architecture-audit` | Historical architecture evolution & governance work (this package) | Preserve audit history; **never the general implementation branch**; reaches `develop` only through controlled review (§ note below). |

> **Governance-content merge path (future, controlled):** the enterprise architecture package on `architecture-audit` (audit, ADR/ODR, Stage A/B/C docs) is documentation, not application code. When the owner authorizes, it merges into `develop` via a reviewed PR (no squash of the audit history; preserve provenance per ADR-001 D6). Not performed now.

## 3. Commit standards

Every commit: **single responsibility**, understandable without external explanation, reversible when possible.

**Avoid:** massive unrelated commits · "misc fixes" · "update everything".

**Format (Conventional Commits):** `type: imperative summary` (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`).
- Good: `feat: implement inventory movement ledger transaction model` · `docs: define enterprise RLS enforcement specification`
- Bad: `fix stuff` · `changes`

Commit messages communicate **intent**; high-risk areas (§5) state the authorizing spec in the body. (This audit package's own history is the worked example.)

## 4. Pull request governance

Every PR includes (PR template in `.github/pull_request_template.md`):

1. **Business purpose** — what problem this solves.
2. **Architectural authority** — which document authorizes it (e.g. Section 20 schema, B1 RLS, B2 money, C7 Constitution). A PR with no authority is rejected (C7 §12 Q1).
3. **Impact analysis** — does it affect Security · Money · Inventory · Accounting · Offline sync · Audit integrity · Multi-tenant isolation? (Any "yes" → High risk, §5.)
4. **Testing evidence** — unit, integration, security validation, and manual verification where appropriate (the C5 gates).

PRs are single-responsibility and small; large PRs are split.

## 5. Review risk classification

| Risk | Examples | Review requirement |
|---|---|---|
| **Low** | UI wording, docs, styling | Standard review (≥1 reviewer) |
| **Medium** | new screens, business workflows, reporting | + architecture-compliance review |
| **High** | authentication, RLS, money, accounting, inventory ledger, offline sync, database schema | **Senior review + architecture verification + additional testing** |

High-risk areas map 1:1 to C7's highest-authority laws (§2/§4/§6) — they never merge on a single standard review.

## 6. AI-assisted development governance

**AI is a contributor, not an authority.**

- **AI may:** generate code, suggest improvements, refactor, create tests.
- **AI may never:** override ADRs/ODRs, ignore locked designs (`13.02`), bypass C7 rules, or introduce architectural changes without approval (§7).
- **All AI-generated code receives the same review standards as human code** (risk classification §5, CI gates §10/C6). Claude Code and future agents treat C7 + C4 as hard constraints and must escalate, not work around, a conflict.

## 7. Architecture change process

Any change affecting **security model, RLS, money precision, accounting rules, inventory integrity, offline synchronization, data ownership, or module boundaries** cannot be made by implementation convenience.

```
Proposal → Impact analysis → Architecture review → Approval decision → Documentation update → Implementation
```

The documentation update (ADR/ODR or Stage-spec revision) lands **before** the implementing code. Locked designs (`13.02`) follow their change-control process (`13.05`). Mirrors C7 §13.

## 8. Release management

Environments: **Development → Testing → Staging → Production** (tiers align with C2 Supabase environment separation).

Production releases require: passing CI (§10/C6) · approved PRs · **version tagging** on `main` · release documentation (changelog + migration notes). Releases are milestones on `main`, never direct commits.

## 9. Emergency hotfix process

```
Incident → hotfix/* branch (from main) → minimal correction → validation → release → root-cause review → prevent recurrence
```

**Emergency status never bypasses** C7's security laws, financial integrity, or audit requirements. A hotfix is the *smallest* correct change; it is reviewed (expedited, not skipped), tagged, back-merged to `develop`, and followed by a documented root-cause/post-incident review (ties B7 incident response).

## 10. Repository security

- **Protect `main` and `develop`** (GitHub branch protection — owner configuration action): require PRs, ≥1 approving review (senior for High risk), passing CI status checks, up-to-date branches; no force-push; no direct pushes.
- **Audit history preserved** — no history rewrite on protected branches.
- **Protect secrets / environment credentials / production access** — no secrets in the repo (`.gitignore` already excludes `.env*`; `.env.example` is the contract); secrets live in environment/secret stores (C1/C2). Production access is least-privilege and audited.

> **Action item (owner):** enable GitHub branch protection on `main` and `develop` per this section — it is a repository setting, not a doc change, so it is recorded here as a required configuration, not performed by this commit.

## 11. Traceability requirements

```
Feature → Architecture authority → feature/* branch → commits → pull request → tests → CI validation → approved merge → release
```

**Every production behavior is traceable back to an approved design decision.** A change with no architecture authority, no tests, or no approved PR does not reach production.

## 12. Relationship with the C7 Engineering Constitution

- **C4 controls *how* changes enter the repository.**
- **C7 controls *what* changes are allowed to exist.**
- Both are mandatory. **A change that follows the git workflow but violates C7 must be rejected** — passing process never authorizes an architectural violation. Conversely, a C7-compliant change still requires C4's review/CI/traceability to merge.

---

## 13. Consistency check

Reviewed against ADR-001, ODR-001…005, C7, and B1–B8: C4 introduces no new architectural authority; it operationalizes governance already ratified. Branch model extends `18.07`; PR/issue templates already exist in `.github/`; risk classes (§5) map to C7's law areas; the change process (§7) mirrors C7 §13 and `13.05`. No contradictions found.

## 14. Status & action items

C4 is **in force** as of this commit. Outstanding owner/repo configuration actions (settings, not documents — recorded here, not performed):
1. Enable GitHub branch protection on `main` and `develop` (§10).
2. When authorized, merge the governance package `architecture-audit → develop` via reviewed PR (§2 note).
3. CI status checks that PRs must pass are defined in **C6** (the C7 §14 enforcement matrix becomes the required checks).

**Next:** the remaining Stage C items — recommended order C1 (environment) + C5 (testing) → C6 (CI/CD) → C2/C3 (Supabase + migrations) → C8 (implementation sequence).
