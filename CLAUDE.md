# CLAUDE.md — AI Engineering Operating Contract

How an AI agent (Claude Code and any future agent) must *behave* while working in this
repository. It is read at the start of every session. It tells you how to operate; the
architecture documents tell you what to build.

Authority documents referenced below live in `docs/28_Enterprise_Architecture_Audit/`.
If a line in this file ever stops solving a real operational problem, delete it.

---

## 0. Purpose & Authority Position

**What this is:** an operating contract — the repeatable behavior that keeps every
AI-assisted session consistent, auditable, architecture-compliant, minimal, and safe.

**What this is not:** not architecture, not a specification, not a replacement for C7
(Engineering Constitution) or C4 (Repository Governance). It defines no rules of its own.

**Authority hierarchy:**

```
ADR-001 / ODR-001…005          (ratified decisions — supreme)
        ↓
Enterprise Architecture (Sections 10–26)
        ↓
Stage A Governance
        ↓
B1–B8 Foundation Specifications
        ↓
C1–C8 Engineering Controls
        ↓
CLAUDE.md  ← this file (operational only; lowest authority)
        ↓
Implementation code
```

**Lowest-authority rule:** CLAUDE.md is the lowest authority in the repository. If it
ever conflicts with an ADR/ODR, an architecture section, Stage A governance, a B1–B8
foundation, or a C1–C8 control, **the higher authority is correct and this file must be
updated.** CLAUDE.md points to authority; it does not create architectural truth.

---

## 1. AI Operating Principles

**Think before coding.** Never assume — verify reality first. Surface uncertainty
instead of guessing. Challenge assumptions, including those in the request.

**Simplicity first.** Use the laziest *correct* solution. Do not introduce unnecessary
abstractions, speculative flexibility, or unnecessary dependencies. Simple ≠ flimsy.

**Surgical changes.** Every modification needs a direct reason tied to the current task.
Do not touch unrelated code. Do not delete anything without proving it is unused.

**Goal-driven execution.** Work as `Action → Verification → Evidence`. Never report
"looks good", "should work", or "probably fixed" — show the evidence or say it failed.

**Scope discipline.** Do not optimize, refactor, redesign, or improve areas outside the
approved mission. An existing imperfection is not automatically a defect. A change is
justified only by (a) current-mission necessity or (b) explicit architectural authority.
*Example: a pre-existing V2 bundle-size warning is not permission to redesign the V2
frontend during a Phase 0 infrastructure task.*

---

## 2. Per-Task Workflow

**Before implementing:**
1. Verify repository state (§7).
2. Identify the specification that authorizes the change.
3. Confirm the task is the current approved milestone in the Master Execution Roadmap, or has explicit approval to deviate.
4. If no authority exists — **STOP.** Raise the gap; request an architectural decision.
   Do not invent authority to keep moving.

**Then:**
5. Produce a minimal plan and state the risks.
6. Await approval for significant or outward-facing changes.
7. Implement only the approved scope.
8. Run the required verification (§5).
9. Report truthfully (§1 goal-driven).

---

## 3. Git & Repository Discipline

Operational behavior only — **C4 is the authority.** See C4.

- Respect the branch strategy; work on `feature/*`.
- Never modify protected branches (`main`, `develop`) directly.
- Preserve history (no rewrites on shared branches).
- Prefer small atomic commits — one commit = one responsibility (Conventional Commits).
- Do not commit or push without explicit approval.

---

## 4. Dependency Discipline

Operational behavior only — **C1 §4 is the authority.** See C1.

Before adding a dependency, climb the ladder:
1. Can the platform/runtime solve this?
2. Can existing project tooling or an installed dependency solve this?
3. Does it solve a real, present problem (not a speculative one)?

Every new dependency requires written justification at review time.

---

## 5. Verification & Testing

Operational behavior only — **C5 (testing) and C6 (CI gates) are the authority.** See them.

Before declaring work complete:
- Run the relevant checks — type check, tests, build, and any security checks that apply.
- Report exact results. Do not hide or soften failures.
- Never claim success without evidence.

---

## 6. High-Risk Domain Tripwires

This is an **index, not a rulebook** — it holds no rule text. **For any row: read the
owning specification before changing the domain; if the authority is unclear, STOP and
escalate.** Touching any of these is High-risk (C4 §5).

| Domain | Owning authority | Phase |
|---|---|---|
| Multi-tenant security & RLS | B1, C7 §2 | 1 |
| Authentication & account recovery | B7, C2, B1, B6, C7 §3, ODR-003 | 1 — scope: OAuth + email auth, self-service password reset, admin-assisted employee recovery, SaaS super-admin emergency recovery. Policy lives in the owning specs — do not restate here. Gated by the Stage D branch-protection precondition. |
| Financial integrity | B2, C7 §4 | 4 |
| Inventory & production ledger | B4, C7 §5 | 3 |
| Offline synchronization & idempotency | B5, C7 §6 | 3 |
| Audit & integration boundaries | B6, C7 §7, §8 | 1+ |

---

## 7. Session Checklist

**Session start:**
- Verify current branch.
- Verify clean working tree.
- Verify local ↔ origin synchronization.
- Read the latest handoff document.
- Load the authority documents the task requires.

**Session end:**
- Scope was respected (no unrelated changes).
- Verification was completed and results reported honestly.
- No hidden failures remain.
- Work stopped at the approved boundary.

---

## 8. AI Engineering Company & Session Continuity

The model-agnostic engineering organization (roles, pipeline, delegation policy, standing rules) is defined in
`docs/28_Enterprise_Architecture_Audit/AI_Company_Charter.md`. Day-to-day resumption state lives in
`docs/28_Enterprise_Architecture_Audit/Phase_2_Context_Reset_Handoff.md` — **read it at session start; update it
(and auto-memory) at session end.** These two files are the "AI company"; no per-platform agent roster is
installed speculatively.
