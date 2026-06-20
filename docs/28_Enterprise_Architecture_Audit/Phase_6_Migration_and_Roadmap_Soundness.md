# Phase 6 — Migration & Roadmap Soundness

**Phase:** 6 of 9
**Branch:** `architecture-audit`
**Date of record:** 2026-06-20
**Auditor:** Chief Enterprise Architect & System Auditor
**Governing assumptions:** ADR-001 (enterprise layer canonical; preserve V1→V2→V3 lineage; dependency-driven build order).
**Method:** Read-only review of `27.01`–`27.04` (V2→V3 Migration Roadmap) and `08.01`/`08.02` (Roadmap), cross-referenced with Phase 5 code findings and `18.05`. No source code modified. V1 prototype not consulted.

---

## 1. Objective

Assess the soundness of the V2→V3 migration roadmap: data-migration risk, sequencing, coexistence/cutover, and rollback — evaluated against the actual code baseline established in Phase 5 (the `src/` prototype is V2) and ADR-001 Decision 6 (preserve lineage).

## 2. Strengths confirmed (the most ADR-aligned section of the corpus)

Section 27 is well-conceived and consistent with the ratified direction:

- **`27.01` is the accurate V2 baseline** — it correctly identifies the real stack (Dexie/IndexedDB, React/TS/Vite), lists the **exact 12 Dexie tables** present in `src/db.ts`, and honestly states limitations (single-company, local password storage, Dexie-only, oversized `App.tsx`, no tests). This is the truthful status the misleading `13.01` should have been (P5-02) — and it should supersede `13.01`.
- **KEEP / REFACTOR / REPLACE model (`27.02`, `27.04`)** — the right migration framing, aligned with ADR-001 Decision 6 (preserve business value, replace architectural limits).
- **`27.04` already enumerates the do-not-port items** — plaintext passwords (🔴 must replace), single-company (🔴), Dexie-only (🔴), role-based→**database-driven/company-specific roles** (🟡) — directly matching Phase 5 finding P5-03 and ADR-001 Decision 3. The remediation source already exists.
- **`27.03` migration order is dependency-sound** — Foundation/Multi-tenant/Auth/RBAC → Data Architecture (Supabase/repo/service/sync/audit) → UX → Master Data → **Inventory (5) → Production (6)** → Financial → HR/Payroll → AI → IoT → Mobile. It correctly sequences Inventory **before** Production, fixing the P2-02/P4-02 ordering defect.
- **Migration safety rules** — never rewrite working logic without reason, never change multiple critical systems at once, keep V2 operational until V3 proven, `/docs` is source of truth. Strong, controlled posture.

These make section 27 the natural home for the overall reconciliation. The findings below are where the plan's *framing* and *data specifics* fall short of the architecture it targets.

---

## 3. Findings

### P6-01 — Migration framing (incremental in-place evolution) contradicts the architectural reality (foundation rebuild)
- **Severity:** High
- **Status:** Open
- **Description:** `27.02`/`27.04` repeatedly frame V3 as a gradual, in-place evolution that keeps the system "operational throughout" ("create abstraction layers → … → connect Supabase → enable multi-company," "refactor module by module," "the objective is not to create a different system," "evolve the proven V2 foundation"). But the target differs from V2 at the foundation: IndexedDB→Supabase, single-tenant→multi-tenant (`company_id`/`branch_id` on **every** table), no-RLS→RLS-as-final-authority, plaintext→Supabase Auth, simple POS math→double-entry. These cannot be reached by incrementally refactoring the existing client-only IndexedDB app while it "remains operational" — they require **rebuilding the persistence, tenancy, and security foundation** (which `27.03`'s own Phases 1–2 actually describe). The plan undersells this as evolution when it is "rebuild the foundation, port the proven business logic."
- **Business Impact:** A team taking the "incremental in-place refactor" framing literally may attempt to bolt multi-tenancy/Supabase onto the Dexie app, wasting effort and producing fragile hybrids, before realizing a foundation rebuild was required.
- **Security Impact:** In-place evolution risks carrying prototype security (plaintext/no-RLS) forward during a long hybrid period.
- **Scalability Impact:** The enterprise scale targets are unreachable on the prototype's client-only foundation; mis-framing delays the rebuild that scale requires.
- **Technical Risk:** Doomed in-place refactor attempts; hybrid Dexie/Supabase states (see P6-03).
- **Recommended Enterprise Solution:** Reframe the strategy explicitly as **"rebuild the foundation (Supabase + multi-tenant + RLS + Auth), port proven business logic (money rules, workflows) from V2"**, while keeping V2 running **as a separate system** during the build (not as the thing being refactored). Keep the KEEP/REFACTOR/REPLACE model but make clear that REPLACE here means a new foundation, not an in-place transform.
- **Related Documents:** `27.02`, `27.04`, `27.03`, `17.03`, Phase 5 (P5-01).
- **Recommended Priority:** High — set the correct mental model before implementation starts.
- **Future Action Required:** Reframe migration philosophy; reconcile with the implementation foundation plan (P5-05).

### P6-02 — No actual data-migration mapping (mandated but absent)
- **Severity:** High
- **Status:** Open
- **Description:** Section 27 makes "every replacement must include a data migration plan" a **rule** but provides **no actual mapping** from the 12 V2 Dexie tables to the V3 Supabase multi-tenant schema. Missing specifics include: assigning `company_id`/`branch_id` to tenant-less V2 records; converting JS-float money to `NUMERIC` (P3-01); normalizing `transactions.items` (nested JSON) into V3 sales orders/lines; and — most significantly — transforming V2's **flat** accounting (`expenses`, `cashEntries`) into V3 **double-entry journal entries** (back-filling debits/credits from flat amounts is non-trivial and undefined). The fundamental decision — **migrate historical V2 data vs. start V3 fresh and archive V2** — is unmade.
- **Business Impact:** For a system whose first rule is "if I lose data, I'm dead," beginning migration without a data-mapping and a migrate-vs-fresh decision risks data loss or a stalled cutover.
- **Security Impact:** Migrated data must land inside the new RLS/tenant boundaries correctly; an unplanned import could place records in the wrong tenant.
- **Scalability Impact:** One-time migration of historical data must respect the new indexing/partitioning (Phase 4.5).
- **Technical Risk:** Flat→double-entry transformation errors; orphaned/mis-tenanted records; float→numeric rounding drift on import.
- **Recommended Enterprise Solution:** Decide migrate-vs-fresh explicitly. If migrating: author a field-level mapping per V2 table → V3 table(s), a default company/branch assignment rule, a money-precision conversion rule, and a documented transformation for flat→double-entry (or import V2 financials as opening balances rather than reconstructed journals). Validate with a reconciliation (V2 totals == V3 totals) before cutover.
- **Related Documents:** `27.01`, `27.02`, `27.03`, `src/db.ts`, `src/lib/types.ts`, `22`, `20.21`–`20.24`, P3-01.
- **Recommended Priority:** High.
- **Future Action Required:** **Owner decision** (migrate vs fresh) + data-mapping specification.

### P6-03 — No coexistence / cutover / rollback strategy across the Dexie↔Supabase boundary
- **Severity:** Medium
- **Status:** Open
- **Description:** "Keep V2 operational until V3 is proven" (`27.02`/`27.04`) is the right intent but lacks mechanics. Migrating "module by module" implies a period where some modules are V2 (Dexie/local/single-tenant) and others are V3 (Supabase/cloud/multi-tenant) — two incompatible data stores. There is no spec for how they coexist (does a V3 inventory module feed a still-V2 accounting module? dual-write? read bridge?), no cutover procedure, no rollback plan if a migrated module fails, and no handling of V2 data created during the migration window.
- **Business Impact:** Without coexistence/cutover mechanics, a module-by-module migration could strand data or force an unplanned big-bang cutover.
- **Security Impact:** A hybrid period straddling RLS (V3) and no-RLS (V2) is a mixed security posture.
- **Scalability Impact:** None directly.
- **Technical Risk:** Cross-store integration (Dexie↔Supabase) is hard; data created in V2 mid-migration may be lost at cutover.
- **Recommended Enterprise Solution:** Given the foundation rebuild (P6-01), prefer a **clean cutover per environment** over cross-store module-by-module hybridization: build V3 to a usable milestone, run V2 and V3 in parallel (V2 read-only or authoritative until cutover), do a final data import, then cut over with a documented rollback. Define the cutover checklist and rollback triggers.
- **Related Documents:** `27.02`, `27.03`, `27.04`, `26.16` (DR/restore), P3.5-04.
- **Recommended Priority:** Medium.
- **Future Action Required:** Coexistence + cutover + rollback plan.

### P6-04 — Reconcile the multiple build/migration sequences to the dependency-sound ones (`27.03` + `18.05`)
- **Severity:** Medium
- **Status:** Open
- **Description:** `27.03` (migration order) and `18.05` (DB implementation order) are both dependency-sound, agree with each other, and match ADR-001 Decision 4. However the corpus still carries conflicting sequences — `08.02`, `16.03`, and `26.08`'s self-contradicting priority order (P2-02/P4-02). There is a correct, ratified-aligned sequence; the conflicting ones are not retired or redirected.
- **Business Impact:** Competing sequences invite the wrong plan to be followed despite a correct one existing.
- **Security Impact:** `27.03`/`18.05` correctly put security/foundation first; conflicting docs could undercut that.
- **Scalability Impact:** None directly.
- **Technical Risk:** Following a non-canonical order causes dependency rework.
- **Recommended Enterprise Solution:** Designate `27.03` (module/migration order) + `18.05` (DB order) as the canonical sequence; fix `26.08`'s priority list to match its own dependency map (P4-02); redirect/retire `08.02` and `16.03` to reference the canonical set. Closes P5-04, P4-02, P2-02.
- **Related Documents:** `27.03`, `18.05`, `26.08`, `16.03`, `08.02`, `18.06`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Canonicalize sequence (Phase 7).

### P6-05 — Foundation roadmap stubs (`08.01`/`08.02`) are vestigial and superseded
- **Severity:** Low
- **Status:** Open
- **Description:** `08.01_Phase_Plan` is a one-line stub; `08.02_Module_Sequence` is the simplistic 6-step order that conflicts with the sound sequences (P2-02). Per ADR-001 Decision 2 (foundation docs are vision/history, not detailed technical authority), section 08 should defer to the enterprise migration roadmap (27) and `18.05`.
- **Business Impact:** A vestigial roadmap competing with the real one causes minor confusion.
- **Security Impact:** None.
- **Scalability Impact:** None.
- **Technical Risk:** Low.
- **Recommended Enterprise Solution:** Demote `08` to a high-level summary that links to `27`/`18.05` as authoritative (consistent with the foundation-layer re-scoping in ADR-001 Decision 2).
- **Related Documents:** `08.01`, `08.02`, `27.03`, `18.05`.
- **Recommended Priority:** Low.
- **Future Action Required:** Redirect `08` to canonical roadmap.

---

## 4. Phase 6 summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 2 |
| Low | 1 |
| Improvement Opportunity | 0 |

**Headline:** The migration section is the corpus's strongest piece of planning — accurate V2 baseline (`27.01`), the right KEEP/REFACTOR/REPLACE model, an explicit do-not-port list (`27.04`), and a dependency-sound order (`27.03`) that already fixes the Inventory/Production bug. Its two real weaknesses are conceptual and concrete respectively: it **frames the migration as gentle in-place evolution when the foundation must actually be rebuilt** (P6-01), and it **mandates a data-migration plan that does not yet exist** — with the hardest part (flat V2 accounting → V3 double-entry, tenant back-assignment, float→numeric) and the migrate-vs-fresh decision unaddressed (P6-02). Both are pre-implementation and fully solvable; P6-02 needs an owner decision.

**Cross-phase links:** P6-01 ↔ P5-01/P5-05 (rebuild foundation); P6-02 ↔ P3-01 (money precision); P6-03 ↔ P3.5-04 (restore/cutover); P6-04 closes P5-04/P4-02/P2-02. `27.01` should supersede `13.01` (P5-02); `27.04` is the source for the do-not-port list (P5-03).

**Next phase:** Phase 7 — Synthesis & Prioritized Remediation Roadmap (Final Enterprise Readiness).
