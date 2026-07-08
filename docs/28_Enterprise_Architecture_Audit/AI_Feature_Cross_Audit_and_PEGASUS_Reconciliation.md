# AI Feature Cross-Audit & PEGASUS Reconciliation

**Type:** Audit document (no spec written, no other file touched) · **Date:** 2026-07-08
**Branch:** `feature/phase-0-foundation` · **Reviewer:** GLM 5.2 (auditing Opus's work)
**Source inputs (read-only this session):**

- `docs/28_Enterprise_Architecture_Audit/source_chats/PEGASUS_PIE_ChatGPT_Transcript.md` (184 msgs, "Using LM Studio Effectively", 2026-06-26 → 2026-07-03)
- `docs/28_Enterprise_Architecture_Audit/source_chats/Architecture_Migration_ChatGPT_Transcript.md` (264 msgs, "PickUrVeggie ERP V3", 2026-06-22 → 2026-07-07)
- `docs/28_Enterprise_Architecture_Audit/source_chats/AIStudio_Accounting_ChatGPT_Transcript.md` (191 msgs, "ERP Stack V1", 2026-06-18 → 2026-07-07)
- `docs/28_Enterprise_Architecture_Audit/CAP_VG1_VeggieGenius_AI_Copilot_Spec.md` (active capability spec)
- `docs/28_Enterprise_Architecture_Audit/Phase_2_Mockup_Reference_and_Backlog.md` §5 (VeggieGenius intent)
- `docs/23_AI_Intelligence_Automation/23.01_Codex_Farm_Companion_Philosophy.md`
- `docs/23_AI_Intelligence_Automation/23.06_Codex_Permissions_and_Authority_Boundaries.md`
- `docs/23_AI_Intelligence_Automation/23.09_Local_ERP_Intelligence_Engine.md`
- `CLAUDE.md` §0 (authority hierarchy) and §6 (high-risk domain tripwires)
- `docs/28_Enterprise_Architecture_Audit/AI_Company_Charter.md` §4.6 (money-path / cross-vendor reviewer)

**Verdict vocabulary** (per the prompt):

- **NEW** — concept from the transcripts has **no** existing repo coverage; an addition would be required.
- **DUPLICATE** — concept is already covered by an existing repo doc (or by CAP-VG1); an addition would be a redundant restatement.
- **CONFLICTS** — concept contradicts an existing repo authority; the row quotes both sides and names the repo-canonical winner per the governance hierarchy in `CLAUDE.md §0`.

**Out of scope (per the prompt):** no edits to CAP-VG1, System 23, or any other file. No PEGASUS spec is being authored in this deliverable.

---

## 1. Cross-audit table

### 1.1 PIE subsystem documents (PIE-000 → PIE-025)

| PIE concept | Existing repo doc that covers it (if any) | Verdict |
|---|---|---|
| **PIE-000** AI Manifesto / Constitution (philosophy, principles, what PIE is/is not) | `23.01_Codex_Farm_Companion_Philosophy.md` (identity, personality, communication style, long-term vision) | **DUPLICATE** (partial — 23.01 covers persona/identity, not the broader manifesto; an addendum for manifesto-style non-negotiables would be a NEW addition) |
| **PIE-001** Core Architecture (sub-system of ERP, observes/analyzes/recommends, does NOT replace modules) | `23.09_Local_ERP_Intelligence_Engine.md` (purpose, priority rule, intelligence domains, rule-based engine) | **DUPLICATE** (23.09 is the operational instantiation of PIE-001's core-architecture principles) |
| **PIE-002** AI Orchestrator (central coordinator between AI providers, RAG, ERP) | none directly — but the *behavior* the orchestrator governs is split across 23.09 (local-first) and CAP-VG1 §3 (callsite: `copilotApi.ask` → LM Studio, with grounding). | **NEW** (an orchestrator doc would be additive; CAP-VG1 §3 implicitly sketches the callsite but never names an "Orchestrator" layer) |
| **PIE-003** Inference Gateway (provider-agnostic adapter for external/local AI providers) | none — CAP-VG1 §1 names LM Studio as the v1 runtime but does not generalize to a multi-provider gateway | **NEW** |
| **PIE-004** Context Engine (assembles the prompt context for every AI call: user identity, recent state, retrieved docs) | `CAP_VG1` §3 (`brief.ts` "Morning Brief: gather ERP state → grounded context block"; `grounding.ts` retrieval). | **DUPLICATE** (CAP-VG1 §3 + §6 step 3 = the Context Engine concretely) |
| **PIE-005** Instruction Engine / Prompt Engine (system-prompt management, instruction versioning) | none — neither 23.x nor CAP-VG1 defines prompt-construction discipline | **NEW** |
| **PIE-006** Memory Engine (persistent org intelligence, conversation history, learned patterns) | `CAP_VG1` §3 ("Chat history lives in a client-side IndexedDB store (`copilot_chats`, Dexie … separate key prefix so the existing export already-excludes-outbox pattern is unaffected)") | **DUPLICATE** (memory is specified in CAP-VG1 §3 for v1; a longer-lived Memory Engine is deferred but the v1 surface is already named) |
| **PIE-007** RAG Engine (retrieval-augmented generation over ERP + farm docs) | `CAP_VG1` §3 (`grounding.ts` RAG retrieval, embedding search, doc store) and §6 step 3–4 (RAG wiring); also `Phase_2_Mockup_Reference_and_Backlog.md` §5 ("RAG: retrieval over ERP + farm docs") | **DUPLICATE** |
| **PIE-008** Knowledge Indexer (indexes docs into the RAG store) | none directly — covered in passing by CAP-VG1 §6 step 3 (grounding over existing caches) and by owner decision D3 in CAP-VG1 §7 | **NEW** (the *indexing pipeline itself* — chunking, embedding, refresh — is not specified) |
| **PIE-009/010** Database / Event Engine (how AI observes ERP state, events) | `23.09_Local_ERP_Intelligence_Engine.md` (Inventory Intelligence, Production Intelligence, Calendar Intelligence, Financial Intelligence, HR Intelligence) | **DUPLICATE** (23.09 is the catalogue of monitored domains — i.e. the AI's read surface — which is what PIE-009/010 structurally provide) |
| **PIE-011/012** Notification / Conversation Engine (proactive push messages; the "Codex pet" pattern the owner described) | `23.01` "Codex Communication Style" (role-targeted tone); `Phase_2_Mockup_Reference_and_Backlog.md` §5 (passive assist); none of the 23.x or CAP-VG1 docs define the proactive-pop-up mechanic | **NEW** (the proactive/push piece is genuinely unspec'd; 23.01 covers style, not push) |
| **PIE-013/014** Recommendation / Prediction Engine | `23.06_Codex_Permissions_and_Authority_Boundaries.md` "Codex Is Allowed To: … Recommend actions … Predict possible problems"; `23.09` "Inventory Intelligence" examples ("…estimated to last only 4 more days") | **DUPLICATE** (23.06 + 23.09 already specify the recommendation/prediction surface and examples) |
| **PIE-015/016** Tutorial / Authorization Intelligence | none — Tutorial is a deferred CAP (the Backlog §5 names "Tutorial System" only as a future PIE capability, not as a current spec); Authorization Intelligence is a *future* concept whose principles already exist in 23.06 but whose AI-driven authorization is not specified | **NEW** |
| **PIE-017** Audit Engine (AI-specific audit beyond the existing `audit_events` table) | `CAP_VG1` §4 ("Each Copilot turn appends a `copilot.turn` row to `audit_events` (actor, prompt hash, grounded-source list, model id)"); the broader PIE-017 (Learning Engine, etc.) is not specified | **DUPLICATE** (v1 audit row is named in CAP-VG1 §4; further rows are additive, not new) |
| **PIE-018/019/020** API Contracts / Database Schema / Sequence Diagrams | none yet — CAP-VG1 §3 sketches a directory layout (`app/features/copilot/`, `supabase/functions/copilot-ask/`), but no formal API contract, schema, or sequence diagrams exist | **NEW** |
| **PIE-021/022/023** Testing Strategy / Deployment Guide / Version History | none — CAP-VG1 §5 lists 5 guards to add to `scripts/guards/` when implementation is authorized, but no broader testing-strategy doc exists | **NEW** |
| **PIE-024/025** Version History / Decision Log (PIE's own ADR-equivalent) | partially — every module already keeps a maintenance log (`STATUS.md`, handoff), and the repo has ADRs (`docs/28_Enterprise_Architecture_Audit/ADR_*`) | **DUPLICATE** (partial — the format is already in use; an AI-specific decision log is a NEW addition, but the *concept* of a structured decision log is not) |

### 1.2 ARB / ACR governance (ARB-000 → ARB-005, ARB-999)

| Concept | Existing repo doc that covers it (if any) | Verdict |
|---|---|---|
| **ARB-000** Architecture Review Board Charter (independent authority, doesn't design, only validates) | `AI_Company_Charter.md` §4 (authority hierarchy, "Authority: ADR/ODR → Systems 10–26 → … → CLAUDE.md → this charter"); `CLAUDE.md` §0 ("ADR/ODR (ratified decisions — supreme)") | **CONFLICTS** — see §2.1 |
| **ARB-001/002/003/004/005** Review Checklist / Readiness Score / Architecture Clarification Request (ACR) / Risk Register / Go/No-Go Report | partial — `Phase_2_Context_Reset_Handoff.md` §0 + §5 (CI audit checklist) and `STATUS.md` §1 (verification snapshot) are the de facto review-checklist; a formal "ACR" mechanism does not exist in-repo; no Risk Register | **CONFLICTS** — see §2.2 |
| **ARB-999** Implementation Authorization (gate that releases a frozen spec to implementation) | `AI_Company_Charter.md` §4.4 ("Owner gates: push, deploy (`db push`), migrations to cloud, module starts — explicit go only"); CAP-VG1 §7 (D1–D4 owner decision points) | **CONFLICTS** — see §2.3 |
| **ChatGPT = Architecture Guardian / Claude Code = Lead Engineer** (role separation the transcripts insist on) | `AI_Company_Charter.md` §4.5 ("Session protocol: START by reading `Phase_2_Context_Reset_Handoff.md`; END by updating it + auto-memory"); `CLAUDE.md` §1 ("Think before coding … never assume — verify reality first") | **CONFLICTS** — see §2.4 |

### 1.3 Cross-cutting principles (security / runtime / lifecycle)

| Principle (from transcripts) | Existing repo doc that covers it (if any) | Verdict |
|---|---|---|
| **Local-first runtime (LM Studio, no per-call cloud cost, offline-degradable)** | `CAP_VG1` §1 ("Runtime: local model served by LM Studio as an OpenAI-compatible API server … No per-call cloud cost; fully offline"); `Phase_2_Mockup_Reference_and_Backlog.md` §5 ("Fully offline-capable; no per-call cloud cost") | **DUPLICATE** |
| **AI runs under the requesting user's permissions, no RLS bypass, no service_role in the browser** | `23.06_Codex_Permissions_and_Authority_Boundaries.md` "Codex follows the same permission system as every user. If a person does not have access to information, Codex will not reveal it."; `CAP_VG1` §4 ("The Copilot runs under the requesting user's permissions. … No elevation, no service_role token in the browser, no `bypass RLS`") | **DUPLICATE** |
| **No money paths (AI may not post finance)** | `23.06` "Codex Is NOT Allowed To: Approve payments, Release salaries, Delete financial records, Modify accounting history, Transfer money, Override security restrictions"; `CAP_VG1` §4 ("No money paths. CAP-VG1 issues zero writes to financial tables …"); charter §4.6 ("Money paths: NUMERIC only, balanced double-entry, append-only ledgers, server price authority, idempotency — and the cross-vendor reviewer before locking new financial logic") | **DUPLICATE** (and the strongest spine of the audit: three independent sources say the same thing) |
| **AI assists, ERP authorizes, humans approve** | `Phase_2_Mockup_Reference_and_Backlog.md` §0 note on the PIE/PEGASUS documents: "Their parallel governance vocabulary (PIE, PEGASUS, ARB, ACR, NEXT_CHAT_BOOTSTRAP) does **not** replace our governance. Ours stays authoritative. The one thing that carries over cleanly is a *security principle we already enforce*: **AI assists, ERP authorizes, humans approve; no AI bypasses security, finance, or permissions.**" | **DUPLICATE** (this exact phrasing is already in the repo) |
| **Architecture frozen at v1.0, one CAP at a time, only after ARB GO** | `AI_Company_Charter.md` §4.2 ("Minimal change: never touch unrelated code; locked migrations are immutable"); `CLAUDE.md` §0 (governance hierarchy); the existing cadence is `spec → review → build → attack → owner-gate → lock` (every module, M1–M9) | **CONFLICTS** — see §2.5 (lifecycle mismatch, not principle) |
| **Grounding / RAG over ERP rows with citation (no hallucination)** | `CAP_VG1` §4 ("Grounding, not hallucination. Every answer must cite the ERP rows/docs it used (citation block). An answer with no supporting rows says so explicitly ('no matching records in your access') rather than inventing") | **DUPLICATE** |
| **Audit row per AI turn (actor, prompt hash, source list, model id)** | `CAP_VG1` §4 ("Each Copilot turn appends a `copilot.turn` row to `audit_events` (actor, prompt hash, grounded-source list, model id)") | **DUPLICATE** |
| **One user-visible AI identity ("Codex Farm Companion")** | `23.01_Codex_Farm_Companion_Philosophy.md` (entire doc is the single-identity principle + persona spec) | **DUPLICATE** — and this is one place where the PIE design **regresses** vs. the repo: the transcripts treat PIE as a sub-system, not a visible identity; 23.01 fixes the *user-facing* identity as one mascot. The repo position is stricter and should win. |

### 1.4 PEGASUS umbrella ("PickUrVeggie Engineering Governance & Architecture System")

| Concept | Existing repo doc that covers it (if any) | Verdict |
|---|---|---|
| **PEGASUS umbrella** that unifies PAL / Engineering Loop / PIE / CAP / ARB / ACR / ADR / Release Mgmt / Versioning into one named methodology | none — the repo's existing artifacts are *what PEGASUS proposes to unify* (the handoff, the ADRs, the spec cadence, the maintenance log, the version-pinning) but **no doc names the umbrella or claims to be one** | **NEW** (as an umbrella *name*; the *constituent practices* are all duplicates) |
| **Project Bible** (PEGASUS subtree) | none as a single document; the closest is the cluster `docs/28_Enterprise_Architecture_Audit/` itself (28_ prefix is the Bible's chapters) | **NEW** (as a named document; the content is scattered through `docs/28_…` and `docs/23_…`) |
| **PEGASUS is explicitly NOT v1.0** — the transcript says "I would **not** add this to v1.0. I would make it the **first proposal for Version 1.1**" | n/a — the repo has not committed to v1.0 vs. v1.1 either way; status is feature-complete at v1.0 pending owner-gated Phase D | **DUPLICATE** (the *posture* matches: the repo already defers the naming/wrapping step) |

### 1.5 Items raised in transcripts 2 and 3 (Architecture Migration, ERP Stack V1)

These two transcripts cover the M1–M8 build sequence and the Accounting Core design, not new PEGASUS/PIE concepts. They confirm the **authority hierarchy** the audit relies on:

- "Continuity file loaded and accepted as **historical context only, not as architectural authority**. Repository ADR/ODR, B-Series, C-Series governance, and Stage D Phase 1 specifications remain the source of truth." (Architecture_Migration_ChatGPT_Transcript.md, msg 12)
- "Repository ADR/ODR, B-Series, C-Series governance … remain the source of truth." (same)

→ Verdict for these transcripts w.r.t. PEGASUS/PIE: **no new concepts to compare**; the only thing they import into the audit is the explicit confirmation that the **repo's authority hierarchy is canonical over any external governance vocabulary**, including the PIE/PEGASUS/ARB/ACR one.

---

## 2. Conflict resolutions (repo-canonical per `CLAUDE.md §0`)

For every row marked **CONFLICTS** in §1, the transcripts propose a governance/role-separation structure that the repo has already settled differently. Per `CLAUDE.md §0`, the authority hierarchy is **ADR/ODR → Systems 10–26 → Stage A → B1–B8 → C1–C8 → CLAUDE.md → implementation code**, and the lower-authority doc "must be updated" when it conflicts. Both the AI Company Charter and the Backlog §0 already make this explicit: the PIE/PEGASUS/ARB/ACR vocabulary "does **not** replace our governance."

### 2.1 CONFLICTS — ARB-000 Architecture Review Board Charter

**Transcript side (PEGASUS_PIE_ChatGPT_Transcript.md, msgs 164–166 / 21724+):**

> "ARB-000 — Architecture Review Board Charter … The Architecture Review Board (ARB) is the final independent authority responsible for validating the PickUrVeggie Intelligence Engine (PIE) architecture before implementation. The ARB does not design architecture. The ARB validates architecture."

**Repo side (AI_Company_Charter.md §4, CLAUDE.md §0):**

> "Authority: ADR/ODR → Systems 10–26 → Stage A → B1–B8 → C1–C8 → CLAUDE.md → this charter. Prototype in `src/` = workflow + visual authority for operational modules."
>
> "Lowest-authority rule: CLAUDE.md is the lowest authority in the repository. If it ever conflicts with an ADR/ODR, an architecture section, Stage A governance, a B1–B8 foundation, or a C1–C8 control, **the higher authority is correct and this file must be updated.** CLAUDE.md points to authority; it does not create architectural truth."

**Repo-canonical winner:** the repo's existing chain. The PIE/ARB "Architecture Review Board" is **not adopted as a new gate-creating body**. The repo's gate is the owner-decision cadence already in `AI_Company_Charter.md §4.4` and exercised through `Phase_2_Context_Reset_Handoff.md §6`. If a future PEGASUS doc wanted to *name* that gate "ARB", that would be a terminology addition only — it would not create a new body, a new veto, or a new authority tier. The hierarchy stays: ADR/ODR supreme.

### 2.2 CONFLICTS — ARB-001/002/003/004/005 (Checklist / Score / ACR / Risk Register / Go-No-Go)

**Transcript side (PEGASUS_PIE_ChatGPT_Transcript.md, msgs 168–172):**

> "ARB-001 — Review Checklist … ARB-002 — Architecture Readiness Score … ARB-003 — Architecture Clarification Request (ACR) … ARB-004 — Risk Register … ARB-005 — Final Go / No-Go Report"

**Repo side (Phase_2_Context_Reset_Handoff.md §5, STATUS.md §1, Phase_2_Cross_Vendor_Money_Path_Review.md):**

The repo's de facto equivalents already exist and are named differently:

- **Checklist:** `Phase_2_Context_Reset_Handoff.md §5` "CI audit checklist (when owner pastes a run)"; `STATUS.md §1` "Global verification snapshot"
- **Readiness Score:** the binary "Done / In Progress" column in `STATUS.md §2` is the in-repo readiness signal; no numeric score is used
- **ACR (Architecture Clarification Request):** the standing rule in `CLAUDE.md §1` "Surface uncertainty instead of guessing" + the explicit "if the authority is unclear, STOP and escalate" rule in `CLAUDE.md §6` are how architectural clarifications are raised — they happen in `Phase_2_Context_Reset_Handoff.md §6` as the "Immediate next step," not as formal ACR documents
- **Risk Register:** implicit in the tripwires table at `CLAUDE.md §6` (Multi-tenant security, Auth, Financial integrity, Inventory & production ledger, Offline sync, Audit & integration) and in `Phase_2_Cross_Vendor_Money_Path_Review.md §9` (per-path verdicts)
- **Go / No-Go:** the owner-gate model in `AI_Company_Charter.md §4.4` (push, deploy, migrations, module starts — explicit go only) and the D1–D4 owner decisions in `CAP_VG1 §7`

**Repo-canonical winner:** the existing artifacts are the binding form. Adopting the ARB naming and the six-document set would *duplicate* what's already in the handoff + STATUS + charter + Cross_Vendor_Money_Path_Review. A future PEGASUS doc could *reference* these by name (e.g. "the existing CI audit checklist is the ARB-001 equivalent") but it would not add new files, new authorities, or new gates.

### 2.3 CONFLICTS — ARB-999 Implementation Authorization

**Transcript side (PEGASUS_PIE_ChatGPT_Transcript.md, msg 220):**

> "ARB-999 — Implementation Authorization. Only after ARB approval."

**Repo side (AI_Company_Charter.md §4.4, CAP_VG1 §7):**

> "**Owner gates:** push, deploy (`db push`), migrations to cloud, module starts — explicit go only."
>
> CAP-VG1 §7 D1–D4 (the four owner decision points before any CAP-VG1 implementation begins).

**Repo-canonical winner:** the owner. The "ARB" in the transcripts is an AI-side ceremony; the repo's gate is the *owner*. They are not the same actor, and conflating them would weaken the repo's actual control point. No PEGASUS doc may redefine who authorizes implementation — that authority is the owner's, and the standing rule in `CLAUDE.md §3` ("Do not commit or push without explicit approval") already enforces it.

### 2.4 CONFLICTS — "ChatGPT = Architecture Guardian, Claude Code = Lead Engineer" (role separation)

**Transcript side (PEGASUS_PIE_ChatGPT_Transcript.md, msg 23095):**

> "ChatGPT = Architecture Guardian, Product Strategist, and Design Authority / Claude Code = Lead Software Engineer and Builder. That separation of responsibilities is healthy. It keeps implementation from silently changing architecture."

**Repo side (AI_Company_Charter.md §4 + §4.5, CLAUDE.md §1, the running "Opus / GLM" multi-agent pattern in `Phase_2_Context_Reset_Handoff.md`):**

> "Every model/CLI gets the SAME organization by reading this file + the handoff at session start." (`charter §5`)
>
> "The model-agnostic engineering organization (roles, pipeline, delegation policy, standing rules) is defined in `docs/28_Enterprise_Architecture_Audit/AI_Company_Charter.md`." (`CLAUDE.md §8`)
>
> The actual operating pattern in this repo: any model (Opus, GLM 5.2, etc.) is *both* reviewer and implementer on different passes; "Architecture Guardian" and "Lead Engineer" are *the same session* depending on the prompt, not two separate entities. The handoff demonstrates the pattern (Opus builds, GLM audits, no permanent role split).

**Repo-canonical winner:** the model-agnostic charter. A hard "ChatGPT = guardian forever / Claude Code = builder forever" split contradicts the repo's multi-platform consistency rule (charter §5) and the standing continuity pattern (handoff). The repo *does* support the *principle* — never silently change architecture while implementing — but expresses it through `CLAUDE.md §1` ("Think before coding … never assume — verify reality first"), the `spec → review → build → attack → owner-gate → lock` cadence, and the explicit "ADR/ODR supreme" rule. No model is permanently demoted to "builder."

### 2.5 CONFLICTS — "Architecture frozen at v1.0, one CAP at a time, only after ARB GO"

**Transcript side (PEGASUS_PIE_ChatGPT_Transcript.md, msgs 21017, 22000+):**

> "After **PIE-025** is complete, we should **stop writing architecture** and move to the formal **Architecture Review Board (ARB)** phase. … the entire PIE v1.0 specification will be ready for a formal Architecture Review Board (ARB) audit before Claude Code begins implementation."

**Repo side (AI_Company_Charter.md §4.2, CLAUDE.md §0, the existing per-module cadence in `Phase_2_Context_Reset_Handoff.md`):**

> "**Minimal change:** never touch unrelated code; locked migrations are immutable (evolve via new migrations)." (`charter §4.2`)
>
> "ADR/ODR (ratified decisions — supreme) … CLAUDE.md (operational only; lowest authority) … Implementation code" (`CLAUDE.md §0`)
>
> Operating cadence: every module has been shipped through `spec → review → build → attack → owner-gate → lock`, *one module at a time*. The repo is **not** sitting on a "frozen v1.0 spec that an ARB will audit before any code is written." The repo has been continuously shipping code, evolving via additive migrations, and using owner gates per module.

**Repo-canonical winner:** the iterative, additive, owner-gated cadence. The repo has no "freeze everything, audit, then build" gate, and adding one would block the M2D/M2E/M4A/M5A/M6C/M6D/M9A/Accounting-Reports/Cash-Flow/Payroll-Self-Visibility/Projects/Calendar-DayFlow arc — the work that has actually produced the shipped V3. The transcripts' "freeze v1.0 first" posture is **inverted relative to the repo's "build, attack, prove, lock, evolve additively" pattern**. CAP-VG1 already mirrors the repo pattern (steps 1–4 sequenced for independent verification, not gated on a global ARB).

---

## 3. Recommendation (one paragraph, no action taken)

**Recommendation: (a) keep CAP-VG1 as-is.** The audit shows that the repo's existing `docs/23_AI_Intelligence_Automation/` (23.01, 23.06, 23.09) plus the active `CAP_VG1_VeggieGenius_AI_Copilot_Spec.md` plus the recorded intent in `Phase_2_Mockup_Reference_and_Backlog.md §5` already cover every security/runtime/audit/cross-cutting principle the PEGASUS/PIE/ARB system proposes; the 25-document PIE series and 6-document ARB series would be **mostly duplicate** of existing repo artifacts, with the **load-bearing conflicts (§2.1–2.5) all resolving in favor of the existing repo authority** (ADR/ODR → Systems 10–26 → … → owner gates). **Option (b) merge CAP-VG1 into System 23 is rejected** because 23.x is currently philosophy/governance/operational-engine content and lacks the *capability-spec* surface CAP-VG1 uses (steps, guards, owner decisions); merging would force System 23 to grow a CAP-tracking role it does not have, and would risk re-opening the locked 23.01/23.06/23.09. **Option (c) write a new PEGASUS doc and let it supersede CAP-VG1 is rejected** because (i) the conflicts in §2 are all on the *governance* side, not on the capability-design side, and CAP-VG1 does not contain any of those governance statements to be superseded; (ii) the PIE/PEGASUS design carries a hard "freeze + global ARB" lifecycle that the repo's `spec → review → build → attack → owner-gate → lock` cadence deliberately rejects, so adopting PEGASUS would invert the working pattern; (iii) the transcripts themselves explicitly defer PEGASUS ("I would **not** add this to v1.0. I would make it the **first proposal for Version 1.1**"). The right move is to leave CAP-VG1 where it is (its D1 owner GO is still the only thing standing between spec and implementation), and **optionally** — only if the owner later asks for a terminology addition — write a one-page `docs/28_Enterprise_Architecture_Audit/PEGASUS_Naming_Map.md` that *points* the existing handoff/STATUS/CAP-VG1/ADR/charter artifacts to the PIE/PEGASUS names without creating new authorities, new gates, or new documents. **This paragraph is recommendation only. Nothing was changed.**
