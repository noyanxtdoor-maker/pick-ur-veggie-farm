# Stage A — Governance Reconciliation & Precedence Model

**Type:** Remediation deliverable (Phase 7 → Stage A) · **also a governing artifact**
**Status:** Precedence model established; per-document content reconciliation in progress
**Date of record:** 2026-06-20
**Branch:** `architecture-audit`
**Authority basis:** [ADR-001](ADR_001_Architecture_Ratification.md)
**Auditor/Architect:** Chief Enterprise Architect & System Auditor

This document consolidates the PickUrVeggie ERP V3 governance into **one clear precedence model**, executing ADR-001 and the Phase 7 Stage A plan. It is additive: no existing architecture document is rewritten or deleted; conflicting documents are re-scoped via additive banners and recorded in the Conflicts Register below for later content reconciliation.

## Constraints honored
- Sections **10–26** are the canonical technical authority for V3.
- Sections **00–08** are preserved as philosophy, business overview, simplified summaries, and historical evolution.
- **No source code modified. No production branches modified.** Only the audit package and supporting docs are touched, additively.
- **The five owner decisions (Phase 7 §6) remain OPEN** — none is resolved here by assumption (see §6).
- Documents still conflicting with the ratified architecture are **recorded with remediation recommendations** (§4), not silently changed.

---

## 1. The governance precedence model

A single, ordered authority hierarchy. Higher tiers win when documents conflict.

```
TIER 0 — META-GOVERNANCE
  ADR-001 (ratified decisions) + this Stage A Precedence Model
        │  (define the authority hierarchy itself)
        ▼
TIER 1 — VALUES & VISION (apex for purpose, NOT technical detail)
  00 Project Constitution  →  mission, principles, non-negotiable values
        │
        ▼
TIER 2 — DEVELOPMENT GOVERNANCE
  09 AI Development Constitution  +  19 Claude Code Master Operating System
        │  (how the system is built, AI guardrails, change discipline)
        ▼
TIER 3 — CANONICAL TECHNICAL AUTHORITY  (Sections 10–26)
  Security 11 · Database 20 · Integration 26  →  win on all technical conflicts
  + 10,12,21,22,23,24,25 (domain specs)
        │
        ▼
TIER 4 — CHANGE CONTROL & STATUS
  13 Project Status & Change Control (locked-designs registry, change rules)
        │
        ▼
TIER 5 — TRANSITION AUTHORITY
  27 V2→V3 Migration Roadmap  (governs the migration period only)
        │
        ▼
TIER 6 — NAVIGATION (non-authoritative)
  16 Master Project Index  →  points to the above; never overrides them

FOUNDATION LAYER (00–08): VISION / SUMMARY / HISTORY ONLY
  Defers all technical detail to Tiers 2–5. Preserved, never deleted.
```

**Layer rule (ratified, ADR-001):** when foundation (00–08) conflicts with enterprise (10–26) on any technical matter, **enterprise wins**.

**Intra-enterprise rule (PROPOSED — pending Owner Decision #4):** the tier order above is the *recommended* precedence among enterprise governing documents. The precise ordering among Tiers 2–4 is **Owner Decision #4 and is not finalized here.** Until ratified, treat Tier 3 (Security/Database/Integration) as winning on technical conflicts and escalate genuine governance conflicts to the owner.

---

## 2. Governance authority map (single owner per concern)

The cure for "five competing authorities" (finding P1-01) is **one owner per governance concern.** Every other document references the owner rather than restating it.

| Governance concern | Single canonical owner | Notes / pending work |
|---|---|---|
| Authority hierarchy & precedence | **ADR-001 + this model** | Intra-enterprise order pending Decision #4 |
| Vision / mission / principles | **00 Project Constitution** | Apex for values; defers technical detail |
| AI/development guardrails & change discipline | **19 Operating System** (with 09) | Canonical AI start prompt = `19.10` (retire/redirect `16.05`) — P1-04 |
| Canonical role model & permissions | **11.01 RBAC + 20.03 schema** | Data-driven, permission-first; roles are seed data, not a fixed enum — P3-03, P4-05 |
| Locked-designs registry | **13.02** | Reconcile `13.02`⊕`19.02` into one list — A2 (pending) — P1-02 |
| Build / migration sequence | **27.03 + 18.05** | Dependency-sound & ADR-aligned; fix `26.08`, redirect `08.02`/`16.03` — A4 (pending) — P2-02/P4-02 |
| Project status | **13 (Designed/Implemented/Verified model)** | `27.01` is the V2 baseline of record — A5 (pending) — P5-02 |
| Database / schema | **20 Supabase Master Schema** | Canonical data model — P2-01 |
| Security model & RLS | **11 + 20.03** | RLS spec owed by Stage B (B1) — P3-02 |
| Money rules & precision | **(Stage B spec, B2)** | `src/lib/money.ts` is the verified behavioral reference — P3-01/P5-06 |
| Integration / system architecture | **26 Master System Integration** | The standard the corpus should rise to |
| Documentation index | **Generated index (CI)** | Deprecate stale `MANIFEST.json`s — A6 (pending) — P0-01/P0-02 |

---

## 3. Foundation layer (00–08) re-scope — IMPLEMENTED

Per ADR-001 Decision 2, the foundation sections are **preserved** and **re-scoped** to: vision & philosophy, business objectives, high-level concepts, simplified summaries, executive summaries, and historical (V1→V2) design evolution. They **no longer define detailed technical implementations** that conflict with the enterprise layer.

**Applied in this Stage A delivery:** an additive "Authority & Precedence" banner has been added to the top of each foundation README (`00`–`08`) pointing to this model and naming the canonical enterprise owner for that domain. No foundation content was removed; the history is intact (ADR-001 Decision 6 — lineage preserved).

| Foundation section | Re-scoped role | Canonical technical owner for its domain |
|---|---|---|
| 00 Project Constitution | Values/mission (apex for principles) | — (defers technical detail to 10–26) |
| 01 Business Modules | Concept summary | 11 (security/users), 20.19–20.20 (calendar/workspace) |
| 02 Agricultural Core | Concept summary | 20.13–20.15, 22.17–22.19 |
| 03 Inventory System | Concept summary | 20.07–20.10, 22.16 |
| 04 Accounting | Concept summary | 22 Accounting Financial Core, 20.21–20.24 |
| 05 System Architecture | Concept summary | 20, 26, 11 |
| 06 UI/UX | Concept summary | 06 + 14 + 25 (mobile) per UI reconciliation |
| 07 Stress Testing | Concept summary | 26.13 + per-module stress docs |
| 08 Roadmap | Concept summary | 27.03 + 18.05 |

---

## 4. Governance conflicts register (documents still conflicting with the ratified architecture)

Per the instruction to "record the conflict and the remediation recommendation." These are documents whose **content** still conflicts with the ratified architecture and require reconciliation beyond the precedence banners. Status reflects this Stage A delivery.

| ID | Conflicting document(s) | Conflict | Remediation recommendation | Finding | Status |
|---|---|---|---|---|---|
| GC-1 | `16.01` (5 roles) vs `11.01`/`20.03` (9 roles) | Two incompatible role sets | `16.01` defers to `11.01`/`20.03` (canonical, data-driven) | P3-03 | **Reconciled (A3)** — 16.01 defers; controlled vocabulary added to 11.01 |
| GC-2 | `13.02` vs `19.02` | Divergent "locked" lists | Single registry in `13.02`; `19.02` references it | P1-02 | **Reconciled (A2)** — 13.02 canonical; 19.02 references it |
| GC-3 | `08.02`, `16.03`, `26.08` (priority order) | Conflicting/contradictory build sequences | Canonical = `27.03`+`18.05`; fix `26.08`; redirect `08.02`/`16.03` | P2-02, P4-02 | Pending (A4) |
| GC-4 | `13.01` | Status (90–95% "locked") misrepresents reality | Replace with Designed/Implemented/Verified; `27.01` = baseline | P5-02 | Pending (A5) |
| GC-5 | `16.05` vs `19.10` | Two competing AI start prompts | Canonical = `19.10`; `16.05` references it | P1-04 | **Reconciled (A3)** — 16.05 defers to 19.10 |
| GC-6 | `00.02`/`00.03`/`16.04` vs `09`/`19` | Duplicated/divergent system rules | Define each rule once at strongest formulation; others link | P1-03, P1-05 | Banner applied; consolidation pending |
| GC-7 | `04`, `05.01`, `10.01` (foundation technical detail) | Foundation specs conflict with enterprise (22/20) | Re-scoped to summary (banner); enterprise canonical | P2-01 | Banner applied; demote-to-summary pending |
| GC-8 | `22.13` | Stray V2 reference outside migration scope | Re-scope/move to section 27 | P2-08 | Pending (A7) |
| GC-9 | root `MANIFEST.json` (+ 5 section manifests) | Covers only 00–08; stale index | Generate index in CI; deprecate static manifests | P0-01, P0-02 | Pending (A6) |

> Note: GC-3/GC-4 remediation touches build-sequence content; the canonical *designation* is made here, but editing `26.08`/`08.02`/`16.03`/`13.01` content is sequenced as the next Stage A sub-tasks (A2/A4/A5) and partly depends on Owner Decision #5 (scale envelope) and #4 (precedence order).

---

## 5. What Stage A delivered vs. remaining Stage A sub-tasks

**Delivered in this commit:**
- ✅ A1 — single governance precedence model + authority map (this document).
- ✅ ADR-001 Decision 2 operationalized — additive re-scope banners on foundation READMEs `00`–`08`.
- ✅ Master Project Index (`16`) README points to this precedence model as the entry authority.
- ✅ Governance conflicts register (§4).

**Stage A sub-tasks:**
- ✅ A2 — reconciled `13.02`⊕`19.02` into one locked-designs registry (`13.02` canonical; `19.02` references it).
- ✅ A3 — role-vocabulary + canonical-prompt edits (`16.01`→defers to `11.01`/`20.03`; `16.05`→defers to `19.10`; controlled-vocabulary clause added to `11.01`).
- ⏳ A4 — canonical-sequence content edits (fix `26.08`; redirect `08.02`/`16.03`). **HELD** — gated on Owner Decision #4 (precedence order) / #5 (scale envelope).
- ⏳ A5 — rebuild `13.01` as Designed/Implemented/Verified; mark `27.01` baseline of record. **HELD** — partly gated on Owner Decision #5.
- ⏳ A6 — generated documentation index + CI link-integrity strategy; deprecate stale manifests. (in progress this session)
- ⏳ A7 — structural cleanups (rename `18_Project Build`→`18_Project_Build`; fix `18.01` markdown; rename `26.02–26.06`; merge `23.04`/`23.20`; record numbering gaps; label `14_UI_References`; scope `22.13`). (in progress this session)

These are non-destructive documentation reconciliations. A4/A5 remain HELD pending Owner Decisions #4/#5.

---

## 6. Owner decisions kept OPEN (not resolved here)

Per instruction, none of the Phase 7 §6 decisions is resolved by assumption:

1. **Migrate historical V2 data vs. start V3 fresh** — OPEN.
2. **Multi-currency scope for v1** — OPEN.
3. **MFA scope at launch** — OPEN.
4. **Intra-enterprise precedence specifics** — OPEN (the §1 intra-enterprise order is a *recommendation* pending this).
5. **v1 scale envelope** — OPEN (affects how much of A4/Stage B is built now vs deferred).

---

## 7. Effect on findings

This Stage A delivery **partially remediates** the governance cluster but does not mark any finding Resolved (content reconciliation A2–A7 remains, and Decision #4 is open):

- P1-01 (precedence hierarchy) — **substantially addressed** by §1–§2; full closure pending Decision #4. Status: Accepted → *remediation in progress*.
- P2-01 / ADR-001 D2 (foundation re-scope) — **operationalized** via banners; content demotion pending.
- P1-03/P1-04/P1-05/P3-03/P2-02/P4-02/P5-02/P0-01 — **direction set** in the authority map + conflicts register; content edits pending (A2–A6).

The master findings register in the [package README](README.md) carries a Stage A remediation log; statuses remain Open/Accepted until content reconciliation completes and is verified.
