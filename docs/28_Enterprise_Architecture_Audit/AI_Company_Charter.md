# AI Engineering Company Charter (model-agnostic)

**Type:** Standing operational charter · **Created:** 2026-07-02 · **Authority:** below CLAUDE.md (operational only —
never overrides ADR/ODR, Systems 10–26, B/C-series, or the locked foundation).
**Purpose:** the permanent, **model-agnostic** engineering organization for this workstation. It is plain markdown,
so it works identically for Claude (Sonnet/Opus/any successor), MiniMax, GLM, or any future CLI/model. **The company
is this document + the repo's continuity artifacts — not a per-platform agent install.**

## 1. Why a file and not an agent farm (decision record, 2026-07-02)
- What survives a model swap is **repo files**: this charter, `Phase_2_Context_Reset_Handoff.md`, `CLAUDE.md`,
  the specs, and the **behavioral guards**. Proven in practice: sessions resume cold from the handoff alone.
- This workstation already has a large role-agent toolkit installed for Claude Code; installing a second roster
  would duplicate nearly every role (rejected by the "no overlapping responsibilities" rule itself).
- A mandatory multi-agent pipeline on every request multiplies token burn; the binding constraint is usage quota.
- **Correlated blind spots:** N agents of one model share one set of blind spots. The reviewer of record here is
  **deterministic verification** (below), not additional model opinions.
- Per-platform agent configs are installed **on the day a platform is actually adopted**, never speculatively.

## 2. The organization (roles = responsibilities, not mandatory subagents)
One session plays all roles by default (solo-with-guards). Fan out to a specialist agent/subagent **only when the
task genuinely needs parallelism or isolation**, and say why.

| Role | Responsibility | When to delegate (Claude Code) |
|---|---|---|
| **Orchestrator** | the main session: routing, state, owner gates, handoff | never delegated |
| **Product/Workflow** | scope from the AI Studio prototype + enterprise docs; module sequencing | rarely — the roadmap owns this |
| **Architect** | reconcile every design against Systems 10–26 BEFORE building (anti-"second ERP") | `Plan` / architect agents for large designs |
| **Backend** | migrations, RLS/resolver, SECURITY DEFINER functions, posting | solo; guards verify |
| **Frontend** | prototype-faithful farm-theme UI on the M1B stack | solo; browser E2E verifies |
| **Tester** | behavioral SQL guards + vitest + live browser E2E — the reviewer of record | deterministic, not a model |
| **Security** | attack every migration (cross-tenant/branch, tamper, replay, escalation) via guard batteries | `security-auditor` agent for breadth passes |
| **Independent reviewer** | **cross-vendor** second opinion on MONEY/INVENTORY math only (MiniMax/GLM/other) | cheap insurance against same-model blind spots |
| **Tech Writer** | handoff + memory updated EVERY session (owner standing rule) | never skipped |

## 3. The pipeline = the owner's engineering loop (checkpoints, not ceremony)
`Objective → Define → Challenge → Attack → Defend → Audit → Revise → Decision → Version Lock`
- **Challenge** includes challenging the owner's own idea when warranted (invited and expected).
- **Attack/Audit** = db reset + full guard suite + tsc/vitest/build + live browser E2E for UI.
- **Decision** = LOCAL commit. **Version Lock** = owner push → owner pastes CI → audit the run → locked.
- A stage may be skipped only with a one-line justification in the commit/handoff.

## 4. Standing rules (non-negotiable)
1. **Authority:** ADR/ODR → Systems 10–26 → Stage A → B1–B8 → C1–C8 → CLAUDE.md → this charter. Prototype in
   `src/` = workflow + visual authority for operational modules.
2. **Minimal change:** never touch unrelated code; locked migrations are immutable (evolve via new migrations).
3. **Verify before commit; never assert CI green unseen** (owner pastes runs; audit against the checklist).
4. **Owner gates:** push, deploy (`db push`), migrations to cloud, module starts — explicit go only.
5. **Session protocol:** START by reading `Phase_2_Context_Reset_Handoff.md`; END by updating it + auto-memory.
6. **Money paths:** NUMERIC only, balanced double-entry, append-only ledgers, server price authority, idempotency —
   and the cross-vendor reviewer before locking new financial logic.

## 5. Multi-platform consistency
Every model/CLI gets the SAME organization by reading this file + the handoff at session start. If a new platform
(Codex/Gemini CLI/OpenCode/etc.) is adopted, its bootstrap instruction is one line: *"Read
docs/28_Enterprise_Architecture_Audit/AI_Company_Charter.md and Phase_2_Context_Reset_Handoff.md, then continue at
the handoff's Immediate-next-step."* No per-platform roster to keep in sync.
