# ADR-001 — Architectural Ratification Decision

**Type:** Architecture Decision Record (governing)
**Status:** Ratified
**Date of record:** 2026-06-20
**Branch:** `architecture-audit`
**Authority:** Owner (Founder) — official architectural decision
**Scope:** Governs all remaining audit phases (3.5 → 7) and all future remediation recommendations.

This ADR records the owner's official ratification resolving the strategic-decision cluster that accumulated across Phases 1–3 (findings P1-01, P1-02, P2-01, P2-02, P3-03). It is the authoritative interpretation layer for the rest of the audit. No prior architecture documents are rewritten by this ADR; it establishes the assumptions under which they are evaluated and will later be reconciled (Phase 7).

---

## Decision 1 — Canonical architecture authority

The **enterprise architecture layer (Sections 10–26)** is the **primary technical authority** for PickUrVeggie ERP V3, including: database architecture, Supabase schema, security implementation, RBAC and permissions, integration architecture, accounting engine, HR & payroll, AI systems, IoT architecture, mobile/offline architecture, and system integration specifications.

**Conflict rule:** Where the foundation documents (Sections 00–08) conflict with the enterprise documents (Sections 10–26), **the enterprise architecture takes precedence.**

> Resolves **P2-01** (dual-layer duplication, undefined supersession) — *direction set; status → Accepted.*

## Decision 2 — Purpose of foundation documents (Sections 00–08)

Foundation documents **shall not be deleted**; they are preserved as valuable project history. Their role is **redefined** to: project vision & philosophy, business objectives, high-level architectural concepts, simplified system explanations, executive summaries, and historical design evolution. They **shall no longer define detailed technical implementations** that conflict with enterprise specifications.

> Reinforces Decision 1; informs P1-03 / P1-05 consolidation (promote enterprise formulations; demote foundation to concept/summary).

## Decision 3 — RBAC direction

The original **5-role model** (Owner, Co-Owner, Admin, Operator, Employee) is recognized as the **V1/V2 simplified operational model**. For V3, the **expanded enterprise role system** is canonical, with a baseline including: Developer, Owner, Co-Owner, General Manager, Corporate Accountant, Branch Supervisor, Operator, Worker, Local Staff.

**Critical constraint:** RBAC **must not hard-code a fixed role list.** The architecture must support custom roles, company-specific roles, future expansion, granular permissions, and branch-specific responsibilities. **The final authority is permissions, not role names.**

> Resolves **P3-03** (role taxonomy inconsistency) — *direction set; status → Accepted.* Adds a new design constraint (permission-first, data-driven roles) that becomes an audit lens for Phases 4 and 4.5.

## Decision 4 — Build & implementation sequence

The V3 roadmap is **dependency-driven**, not based on historical document creation order. Governing principle:

> **Foundation → Security → Data model → Multi-tenant infrastructure → Core services → Business modules → Intelligence & integrations.**

Existing build-sequence documents are to be audited against this dependency-driven approach.

> Resolves **P2-02** / **P1-06** (contradictory build sequences) — *direction set; status → Accepted.* Phase 5 will verify each existing sequence document against this principle.

## Decision 5 — Audit approach going forward

Continue the remaining phases under these ratified decisions. **Do not rewrite previous architecture documents during the audit.** Continue identifying conflicts, legacy assumptions, duplicate authorities, missing enterprise controls, and scalability concerns. Record all remediation recommendations and produce a complete reconciliation strategy in **Phase 7 (Final Enterprise Readiness & Remediation Roadmap).**

> Confirms the existing audit operating model; Phase 7 becomes the remediation/reconciliation deliverable.

## Decision 6 — Architectural preservation principle

The audit must **not erase PickUrVeggie's history.** The evolution must remain traceable:

> **V1** (prototype) → **V2** (expanded prototype / feature growth) → **V3** (enterprise-grade multi-company, multi-branch ERP).

Documentation preserves this history while establishing a **single, clear authority hierarchy.**

> Governs how P1/P2 consolidation is performed (preserve + re-label, never delete history); aligns with P0-06 (label `Old_UI` provenance) and P2-08 (scope V2 references to history/migration).

---

## Authority hierarchy established by this ADR

```
ADR-001 (this decision)
        ↓ governs interpretation of
Enterprise Architecture Layer (Sections 10–26)   ← PRIMARY TECHNICAL AUTHORITY
        ↓ takes precedence over
Foundation Layer (Sections 00–08)                ← VISION / HISTORY / SUMMARY
        ↓ traceable lineage
V1 prototype → V2 expanded prototype → V3 enterprise
```

Note: this resolves the *direction* of P1-01 (precedence) and P1-02 (locked set) at the layer level. The detailed mechanics — the exact precedence ordering *within* the enterprise governing docs (09/11/13/19/20) and the single ratified locked-designs registry — remain to be specified as remediation deliverables in Phase 7.

---

## Findings status impact

| Finding | Prior status | New status | Basis |
|---|---|---|---|
| P1-01 | Open | **Accepted** | Decision 1 + Authority hierarchy (layer-level precedence set; intra-enterprise ordering deferred to Phase 7) |
| P1-02 | Open | **Accepted** | Decision 1 (enterprise precedence; single locked registry to be specified in Phase 7) |
| P2-01 | Open | **Accepted** | Decision 1 + 2 (enterprise canonical; foundation preserved & re-labelled) |
| P2-02 | Open | **Accepted** | Decision 4 (dependency-driven canonical sequence) |
| P3-03 | Open | **Accepted** | Decision 3 (expanded roles canonical; permission-first, no hard-coded list) |

All other findings remain **Open** pending Phase 7 remediation planning.

---

## Effect on remaining phases

- **Phase 3.5 (Lifecycle/DR)** and **Phase 4 (System/Integration/Modules)** are evaluated treating Sections 10–26 as authoritative.
- **Phase 4 / 4.5** gain a new lens from Decision 3: verify the RBAC design is **permission-first and data-driven** (not role-name-driven) and that it scales.
- **Phase 5 (Doc-to-Code Drift)** audits existing build-sequence documents against Decision 4's dependency principle.
- **Phase 6 (Migration)** is evaluated against Decision 6's V1→V2→V3 preservation lineage.
- **Phase 7 (Synthesis)** produces the reconciliation strategy implementing Decisions 1–6, including the deferred specifics (intra-enterprise precedence order, single locked-designs registry).
