# Phase 1 — Governance & Source-of-Truth Integrity

**Phase:** 1 of 9
**Branch:** `architecture-audit`
**Date of record:** 2026-06-20
**Auditor:** Chief Enterprise Architect & System Auditor
**Method:** Read-only analysis of the governance layer. No source code modified. V1 prototype not consulted.

---

## 1. Objective

Determine whether PickUrVeggie ERP V3 has a **single, authoritative, non-contradicting source of truth** governing the project, or whether multiple documents compete for authority. Governance is the foundation on which every later phase depends: if the rules that protect accounting, inventory, security, and privacy are ambiguous or conflicting *before* coding begins, every downstream decision inherits that ambiguity.

## 2. Documents examined

| Document | Declared role |
|---|---|
| `00_Project_Constitution/README` | "non-negotiable rules, mission, and design principles that govern the entire ERP" |
| `00.02_Design_Principles` | 6 design principles |
| `00.03_System_Rules` | 3 system rules |
| `09_AI_Development_Constitution/09.01_AI_Development_Rules` | 8 AI development rules; **Rule 1: "Documentation is the Source of Truth"** |
| `09.02_Code_Modification_Policy` | change/modification policy |
| `09.03_AI_Session_Onboarding` | AI onboarding |
| `13.02_Locked_Designs` | list of locked design decisions |
| `13.05_Change_Control_Rules` | change-control rules + approval standard |
| `16_Master_Project_Index/README` | "central navigation guide… the first documentation package AI developers should read" |
| `16.04_System_Rules_And_Principles` | 6 system rules |
| `16.05_Claude_Startup_Prompt` | a Claude startup prompt |
| `19_Claude_Code_Master_Operating_System/README` | "permanent operating manual for Claude Code… must read and follow" |
| `19.02_Architecture_Protection_Rules` | list of locked systems + integration rules |
| `19.10_Claude_Code_Start_Prompt` | a second Claude startup prompt |

## 3. Core determination

**V3 does not have a single source of truth. It has at least five documents that each assert governing authority, and no document defines precedence among them.**

- `09.01 Rule 1` declares the *entire* `/docs` directory the source of truth ("Code must follow the documentation").
- `00 README` claims `/docs/00` holds the "non-negotiable rules… that govern the entire ERP."
- `16 README` claims `/docs/16` is "the first… package AI developers should read."
- `19 README` claims `/docs/19` is the "permanent operating manual… must read and follow."

Each is internally reasonable, but **collectively they create four front doors and no hierarchy.** When two of them disagree (and they do — see P1-02), nothing in the corpus resolves the conflict. Declaring "all of `/docs` is the source of truth" (09.01) is only coherent if `/docs` is internally consistent; Phase 0 already showed there is no trustworthy index (P0-01), and Phase 1 shows the governing rules themselves diverge.

---

## 4. Findings

### P1-01 — No precedence or conflict-resolution hierarchy among governing documents
- **Severity:** High
- **Status:** Open
- **Description:** Five documents assert governing authority (`00` Constitution, `09` AI Constitution, `13` Change Control, `16` Master Index, `19` Operating System). None defines a precedence order or a tie-break rule for when two governing documents disagree. "Documentation is the Source of Truth" (09.01) names the whole `/docs` tree but provides no internal ordering.
- **Business Impact:** Decisions cannot be adjudicated. Two contributors (human or AI) can reach opposite, equally "rule-backed" conclusions, stalling work or shipping conflicting designs.
- **Security Impact:** Security and privacy rules are spread across multiple authorities; with no precedence, a weaker statement in one document can be cited to override a stronger one in another.
- **Scalability Impact:** As contributors and AI sessions multiply, an unranked rule set produces non-deterministic governance; the problem compounds with team and document growth.
- **Technical Risk:** Conflicting "approved architecture" claims feed directly into code (09.01 says code must follow docs), so doc-level ambiguity becomes implementation-level inconsistency.
- **Recommended Enterprise Solution:** Establish an explicit governance hierarchy with a single canonical apex document (recommended apex: `00_Project_Constitution`) and a written precedence order, e.g. Constitution (00) → AI Constitution (09) → Operating System (19) → Change Control (13) → Master Index/navigation (16). Add a one-line "Authority & Precedence" clause to each governing document stating where it sits and that higher tiers win on conflict. Designate exactly one canonical entry point.
- **Related Documents:** `00`, `09`, `13`, `16`, `19` (all governing docs).
- **Recommended Priority:** High — resolve before any module design is treated as "approved."
- **Future Action Required:** **Owner strategic decision** — confirm the apex document and the precedence order. This affects implementation direction and is escalated for decision at remediation (Phase 7), not changed unilaterally.

### P1-02 — Conflicting definitions of "locked" architecture across governing documents
- **Severity:** High
- **Status:** Open
- **Description:** "Locked" (the central change-control protection) is defined in at least two places with **divergent lists**, while a third references "locked" without defining it:
  - `13.02_Locked_Designs`: POS & sales workflows, Inventory movement ledger, Fast resource consumption terminal, Batch & FIFO logic, Production cost allocation, Dual calendar architecture, Personal workspace privacy model, Core UI language (tablet-first).
  - `19.02_Architecture_Protection_Rules`: Inventory movement system, FIFO batch tracking, Production cost engine, Calendar privacy engine, Role permissions, Accounting relationships.
  - `16.04` states "Do not rewrite locked modules without approval" but does not say where the locked list lives.
  The lists overlap on inventory/FIFO/production-cost/calendar but **disagree** elsewhere: `13.02` locks POS/sales, the fast terminal, and the UI language; `19.02` locks Role permissions and Accounting relationships. Neither cross-references the other.
- **Business Impact:** "Is module X locked?" yields different answers depending on which document is consulted. Change control — the mechanism meant to protect financial and inventory integrity — is itself ambiguous.
- **Security Impact:** `19.02` locks Role permissions; `13.02` does not list them. A contributor following only `13.02` could legitimately redesign the permission model believing it is unlocked.
- **Scalability Impact:** Two hand-maintained locked-lists will drift further apart as modules are added; the ambiguity grows with the system.
- **Technical Risk:** A "locked" protection that two documents define differently provides no reliable guard; protected subsystems (accounting relationships, role permissions, POS) can be altered under color of the rules.
- **Recommended Enterprise Solution:** Maintain **one** authoritative locked-designs registry (recommended home: `13_Project_Status/13.02`, as the change-control owner). Every other document references it by link rather than restating a list. Reconcile the union of the two current lists and have the owner ratify the canonical set. Add change-control metadata per entry (locked date, rationale, unlock criteria).
- **Related Documents:** `13.02_Locked_Designs`, `19.02_Architecture_Protection_Rules`, `16.04_System_Rules_And_Principles`, `13.05_Change_Control_Rules`.
- **Recommended Priority:** High — reconcile before treating any module as protected.
- **Future Action Required:** **Owner strategic decision** — ratify the canonical locked-designs set (union reconciliation). Escalated for decision at remediation.

### P1-03 — Duplicated and divergent "system rules" / design principles across the corpus
- **Severity:** Medium
- **Status:** Open
- **Description:** The same governing principles are restated in at least five documents with differing wording and completeness:
  - `00.02_Design_Principles`: offline-first, tablet-first, high contrast, large touch targets, minimal typing, "every physical action must create a traceable digital event."
  - `00.03_System_Rules`: 3 rules (raw-material expensing, inventory flow, calendar privacy).
  - `16.04_System_Rules_And_Principles`: 6 rules (locked modules, physical movement → digital record, financial event → ledger impact, privacy, offline-first, tablet-first).
  - `09.01` Rules 4–8: agricultural flow, offline-first, tablet-first, privacy, full audit trail.
  - `19 README`: "every physical action must have: operational record, user accountability, timestamp, financial consequence, audit history" (5 elements).
  These are conceptually aligned but expressed at different granularity (e.g. the "physical action → digital record" rule appears in four documents with 1, 2, and 5-element formulations). No single canonical statement exists.
- **Business Impact:** Readers cannot tell which formulation is authoritative; updates to one copy silently diverge from the others.
- **Security Impact:** Privacy and audit-trail rules exist in multiple partial forms; the strongest formulation (19 README's 5-element audit requirement) is not the one in the Constitution.
- **Scalability Impact:** N copies of the same rule = N maintenance points and N drift vectors as the corpus grows.
- **Technical Risk:** Implementation may target a weaker restatement (e.g. "digital record") instead of the stronger one (e.g. full 5-element audit entry), under-building the audit subsystem.
- **Recommended Enterprise Solution:** Apply Don't-Repeat-Yourself to governance. Define each principle **once** in the Constitution (apex) at its strongest formulation; every other document links to it rather than restating it. Reconcile the audit-entry definition to a single canonical schema.
- **Related Documents:** `00.02`, `00.03`, `09.01`, `16.04`, `19` README, `19.08`.
- **Recommended Priority:** Medium — resolve during governance consolidation alongside P1-01.
- **Future Action Required:** Consolidation pass (editorial; does not require strategic decision once apex is chosen in P1-01).

### P1-04 — Two competing Claude start prompts and fragmented AI onboarding
- **Severity:** Medium
- **Status:** Open
- **Description:** Two different AI startup prompts exist with **different role definitions and depth**: `16.05_Claude_Startup_Prompt` (5-line generic "continuing development") and `19.10_Claude_Code_Start_Prompt` (detailed "lead software architect" with responsibilities, never/always lists, and an explicit priority order *Correctness > Security > Reliability > Performance > Appearance*). Additionally, `09.03_AI_Session_Onboarding` and the entire `15_Claude_Code_Onboarding` package (8 files) also govern AI onboarding. No document states which prompt is canonical or how the four overlapping AI-governance sources relate.
- **Business Impact:** AI session behavior depends on which prompt a user happens to paste; results are non-deterministic and not reproducible.
- **Security Impact:** The richer prompt (19.10) enforces security/offline/audit guardrails the minimal prompt (16.05) omits; an AI session bootstrapped from 16.05 operates with weaker guardrails.
- **Scalability Impact:** Four onboarding sources will diverge; future AI contributors cannot rely on a single, current operating contract.
- **Technical Risk:** Inconsistent AI guardrails increase the chance of an AI change that violates accounting/security rules the stronger prompt would have prevented.
- **Recommended Enterprise Solution:** Designate one canonical AI start prompt (recommended: `19.10`, the stronger formulation), have `16.05` and `09.03` link to it, and define `15_Claude_Code_Onboarding` as the procedural onboarding that points to the single canonical prompt. State the priority order (Correctness > Security > Reliability > Performance > Appearance) once, in an authoritative location.
- **Related Documents:** `16.05`, `19.10`, `09.03`, `15_Claude_Code_Onboarding/*`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Choose canonical prompt (minor strategic preference; recommend 19.10) and consolidate.

### P1-05 — Authority/completeness inversion: the apex document is the thinnest
- **Severity:** Medium
- **Status:** Open
- **Description:** Numbering and naming imply `00_Project_Constitution` is the supreme authority, yet its rule content is the least complete: `00.03` carries 3 system rules while the lower-tier `16.04` carries 6 (including critical ones the Constitution omits — offline-first and "every financial event must have ledger impact"), and `09`/`19` carry richer, stronger formulations. The most authoritative document is the least substantive; substantive governance lives in lower-authority documents.
- **Business Impact:** Readers who treat the Constitution as definitive receive an incomplete rule set and miss critical constraints documented elsewhere.
- **Security Impact:** Security/audit strength is concentrated in `19` (operating manual), not in the apex; if the apex is treated as sufficient, guardrails are under-represented at the top.
- **Scalability Impact:** An anemic apex cannot anchor a growing corpus; contributors will keep adding rules to whichever lower doc is convenient, deepening the inversion.
- **Technical Risk:** The "approved architecture" the code must follow (09.01) is fragmented, so code may follow an incomplete apex.
- **Recommended Enterprise Solution:** Promote the strongest formulations of each rule into the Constitution as the single canonical statement (pairs with P1-01 and P1-03). The apex should be the most complete document, with lower tiers elaborating rather than introducing new top-level rules.
- **Related Documents:** `00.02`, `00.03`, `09.01`, `16.04`, `19` README.
- **Recommended Priority:** Medium.
- **Future Action Required:** Editorial promotion of rules to apex (after P1-01 apex decision).

### P1-06 — Multiple competing development-sequence authorities
- **Severity:** Medium
- **Status:** Open
- **Description:** The order in which the system should be built is asserted by several documents: `09.01 Rule 3` (Business Workflow → UI/UX → Stress Testing → Database → Backend → Frontend → Testing → Deployment), `16.03_Module_Development_Order`, `18.01_Project_Build_Order`, and `08_Roadmap` (`08.02_Module_Sequence`). With no precedence (P1-01), it is undefined which sequence governs. Detailed reconciliation of the actual sequences is performed in Phase 2 (cross-reference) and Phase 5 (implementation readiness); this finding records the **governance multiplicity** at the source-of-truth level.
- **Business Impact:** Teams may sequence work differently depending on which "order" document they follow, causing rework and dependency violations.
- **Security Impact:** If security/permissions are sequenced late in one document and early in another, the build may proceed without guardrails in place.
- **Scalability Impact:** Multiple sequencing authorities do not scale to coordinated multi-contributor delivery.
- **Technical Risk:** Dependency-order conflicts (e.g. building modules before their schema) if the wrong sequence is followed.
- **Recommended Enterprise Solution:** Designate one canonical build-sequence document (recommended: `18.01_Project_Build_Order` as the implementation-level authority) and have `08`, `09.01`, and `16.03` reference it. Reconcile the sequences (Phase 2) and verify against dependencies (Phase 5).
- **Related Documents:** `08.02`, `09.01`, `16.03`, `18.01`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Cross-reference reconciliation in Phase 2; canonical-sequence decision at remediation.

---

## 5. Phase 1 summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 0 |
| Improvement Opportunity | 0 |

**Headline:** V3's governance layer is **well-intentioned but unranked and duplicated.** The principles themselves are sound and largely consistent in spirit — but they are spread across five competing authorities with no precedence rule, the central "locked" protection is defined two different ways, and AI guardrails depend on which of two prompts is loaded. None of this is fatal *because the audit is happening before implementation* — which is exactly the point. Two findings (P1-01 precedence hierarchy, P1-02 canonical locked-set) require an **owner strategic decision** at remediation; the remainder are editorial consolidation that follows automatically once the apex and precedence are set.

**Cross-phase links:** P1-01 depends on resolving P0-01 (no trustworthy index). P1-06 hands off to Phase 2 (sequence reconciliation) and Phase 5 (dependency verification).

**Next phase:** Phase 2 — Documentation Consistency & Cross-Reference.
