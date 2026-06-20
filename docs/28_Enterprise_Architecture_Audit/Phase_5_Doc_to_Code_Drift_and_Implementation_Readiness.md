# Phase 5 — Doc-to-Code Drift & Implementation Readiness

**Phase:** 5 of 9
**Branch:** `architecture-audit`
**Date of record:** 2026-06-20
**Auditor:** Chief Enterprise Architect & System Auditor
**Governing assumptions:** ADR-001 (enterprise layer 10–26 authoritative; permission-first RBAC; dependency-driven build order; preserve V1→V2→V3 lineage).
**Method:** Read-only review of the actual `src/` codebase (`db.ts`, `lib/money.ts`, `lib/types.ts`, feature sizes, `package.json`) against `13.01` (Module Maturity), `17.01` (Tech Stack), `18.05` (DB Implementation Order). No source code modified. V1 prototype folder not consulted (the comparison here is the V3 repo's own `src/`).

---

## 1. Objective

Measure the gap between what the documentation specifies and what the code actually implements, and assess whether the project is ready to begin V3 implementation. Under ADR-001, "the docs" means the enterprise layer (10–26).

## 2. What the code actually is (verified)

The `src/` tree (~8,900 lines) is a **single-tenant, offline-only React + IndexedDB prototype** — effectively the **V2 application** living in the V3 repository:

| Dimension | Code (`src/`) | Canonical V3 docs (10–26) |
|---|---|---|
| Persistence | **Dexie / IndexedDB** (`db.ts`) | Supabase PostgreSQL (`20.01`) |
| Supabase client | **Not a dependency** (`package.json`) | Required (`17.01`) |
| Tenancy | **No `company_id` / `branch_id` anywhere** | Mandatory on every table (`20.01`, `20.02`) |
| Security | Plaintext `passwordHash`, hard-coded role checks, no RLS | BA-RBAC + RLS + Supabase Auth + permissions tables (`11`, `20.03`) |
| Accounting | Simple discount/POS math in JS `number` (`money.ts`) | Double-entry journal/GL/COGS/IAS-41/multi-currency (`22`) |
| Modules present | POS, Expenses, Inventory(from expenses), Payroll, Cash, Projects, Schedules, Equipment | + Production/biological assets/FIFO ledger, IoT, AI, full HR, mobile/offline (`20`–`25`) |

The enterprise architecture (sections 10–26) is **~0% implemented in code.** This is the *expected* pre-implementation baseline (consistent with the section 27 migration roadmap and ADR-001's V2→V3 lineage), **not** a defect in itself. The findings below concern (a) honest representation of this baseline and (b) readiness to begin the rebuild correctly.

## 3. Strengths confirmed

- **`money.ts` is exact and valuable** — `round2` (half-up), `farmPerKg` (10% discount), `lineTotal`, `gross`/`net`, `netSales`/`grossProfit`/`netIncome`/`netMargin` match the locked V1 money rules. This is a trustworthy behavioral reference for the V3 rebuild.
- **`18.05` Database Implementation Order is dependency-sound** — Users→Roles→Permissions→Locations→Products→Inventory→CropBlocks→ProductionEvents→Sales→Accounting→Analytics, with "security before production data" and "use RLS." This matches ADR-001 Decision 4 and is the strongest canonical-sequence candidate (unlike `26.08`'s self-contradicting order, P4-02).
- **`17.01` Tech Stack intent is correct** — React+Vite+TS, Supabase (Postgres/Auth/RLS/Realtime), Capacitor Android.
- **Permission-awareness intent exists in code** — `types.ts` `customPermissions` + `hasFeatureAccess()` show movement toward per-user permissions (aligns with ADR-001 Decision 3), even though the fallback is still role-name-based.

---

## 4. Findings

### P5-01 — Implemented code is the V2 prototype, architecturally divergent from canonical V3
- **Severity:** High
- **Status:** Open
- **Description:** The codebase is a single-tenant offline IndexedDB app sharing essentially no architecture with the canonical enterprise design: different persistence (Dexie vs Supabase), no multi-tenancy, no RLS, prototype auth, and simplified single-currency POS accounting. There is no explicit statement in the docs that the current `src/` is the **V2 baseline to be rebuilt/migrated** and must not be extended as if it were V3.
- **Business Impact:** Without an explicit "this is V2; V3 is a rebuild on Supabase" statement, a developer or AI session could extend the prototype (adding enterprise features onto IndexedDB/single-tenant foundations), producing throwaway work and architectural debt.
- **Security Impact:** Building enterprise features on the prototype's plaintext-password / no-RLS base would bake in the very weaknesses the enterprise design avoids.
- **Scalability Impact:** The prototype's client-only IndexedDB model cannot deliver multi-tenant scale; extending it wastes effort against the ratified scale goals.
- **Technical Risk:** Mistaking ~8,900 lines of V2 for "the V3 system."
- **Recommended Enterprise Solution:** Add an explicit baseline statement (in `13_Project_Status` and the section 27 migration roadmap) that `src/` is the V2 reference implementation and V3 is a fresh Supabase-based build that ports proven business logic; gate new enterprise work behind the Supabase foundation (per `18.05`).
- **Related Documents:** `src/*`, `13.01`, `17.01`, `27.*`, `18.05`.
- **Recommended Priority:** High — establish baseline clarity before any V3 coding.
- **Future Action Required:** Author the V2-baseline/V3-rebuild statement; align with migration roadmap (Phase 6).

### P5-02 — `13_Project_Status` maturity is stale and conflates prototype vs enterprise completeness
- **Severity:** High
- **Status:** Open
- **Description:** `13.01` reports "POS & Sales 95%, Inventory & Supply Chain 95%, Equipment 90%, Production Costing 90%" as locked/near-locked, and "Accounting Core 20%, Business Intelligence 30%" as design-stage. Against the code these figures describe the **prototype**, not the enterprise architecture: enterprise POS/Inventory/Production are ~0% built, and "Production Costing 90%" has no corresponding code at all. Simultaneously it **understates** the enterprise design maturity (Accounting `22` has 27 detailed specs; Database `20` has 31). The status reflects neither the code nor the enterprise docs accurately — it predates the enterprise expansion (same root cause as P0-01).
- **Business Impact:** Decision-makers reading "90–95% complete" get a dangerously false readiness signal; planning, budgeting, and go-live expectations are mis-set.
- **Security Impact:** Security & Access Control is listed "in progress" while being one of the most-designed areas — status gives no reliable view of what is actually safe to build on.
- **Scalability Impact:** None directly.
- **Technical Risk:** Work prioritized against fictional maturity numbers.
- **Recommended Enterprise Solution:** Replace the percentages with a three-axis status per module: **Designed** (enterprise spec exists), **Implemented** (in Supabase V3 code), **Verified** (stress-tested/approved). Reset all "Implemented" to reflect the V2-vs-V3 reality (P5-01).
- **Related Documents:** `13.01`–`13.05`, `16.01`, `27.*`.
- **Recommended Priority:** High.
- **Future Action Required:** Rebuild the status model (Designed/Implemented/Verified).

### P5-03 — Code violates ratified ADR-001 constraints (role-name auth, plaintext passwords)
- **Severity:** Medium
- **Status:** Open
- **Description:** `lib/types.ts` `hasFeatureAccess()` authorizes via hard-coded role names (`['Developer','Owner','Co-Owner','Admin'].includes(user.role)`), contradicting ADR-001 Decision 3 (permission-first, no hard-coded roles) — though `customPermissions` shows partial movement away from it. `User.passwordHash` stores the plaintext password (its own comment: "Plain password for simple local offline verification"), contradicting `11.03`/`20.03` ("never store plaintext passwords"). Acceptable for a local prototype; unacceptable to carry into V3.
- **Business Impact:** If ported, hard-coded roles block the ratified custom-role flexibility and plaintext credentials are an immediate breach risk.
- **Security Impact:** Plaintext passwords are a direct, serious vulnerability in any networked deployment.
- **Scalability Impact:** Role-name checks prevent per-company custom roles at scale.
- **Technical Risk:** Copy-forward of prototype auth into V3.
- **Recommended Enterprise Solution:** Mark these as explicit "do-not-port" items in the migration plan; V3 must use Supabase Auth (hashed) and permission-based checks (`if user has permission X`, never `if role == 'Admin'`).
- **Related Documents:** `src/lib/types.ts`, `src/db.ts`, `11.03`, `20.03`, `27.04`.
- **Recommended Priority:** Medium (High if any prototype build is ever exposed beyond a single local device).
- **Future Action Required:** Add to migration "do-not-port" list (Phase 6).

### P5-04 — Build-sequence documents verified: `18.05` is sound; others still conflict (P2-02/P4-02)
- **Severity:** Medium
- **Status:** Open
- **Description:** Phase 5 verification of the build-order conflict: `18.05` (DB Implementation Order) **is** dependency-sound and matches ADR-001 Decision 4 (security first, inventory before production, accounting after its inputs, RLS mandated). However `16.03`, `08.02`, and `26.08`'s priority order still disagree (e.g. `26.08`/`08.02` place production before inventory — P4-02/P2-02). There is a correct sequence in the corpus; it just isn't designated canonical, and the incorrect ones aren't retired.
- **Business Impact:** The right plan exists but competes with wrong ones; teams may follow a flawed sequence.
- **Security Impact:** `18.05`'s "security before production data" must be the governing rule; conflicting docs could undercut it.
- **Scalability Impact:** None directly.
- **Technical Risk:** Following a non-canonical sequence causes dependency rework.
- **Recommended Enterprise Solution:** Designate `18.05` (DB order) + a topologically-derived module order from `26.08`'s dependency map as the canonical build sequence; retire/redirect `08.02`, `16.03`, and fix `26.08`'s priority list (P4-02).
- **Related Documents:** `18.05`, `18.06`, `26.08`, `16.03`, `08.02`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Canonicalize `18.05`-based sequence (Phase 7).

### P5-05 — Enterprise prerequisites are not scaffolded (implementation readiness)
- **Severity:** Medium
- **Status:** Open
- **Description:** Despite a clear Supabase tech-stack decision (`17.01`), nothing toward the enterprise foundation is scaffolded: no `@supabase/supabase-js` dependency, no migrations, no RLS policies, no auth integration, and the package is still named `react-example`. The AI dependency (`@google/genai`) is present though AI is a late module (`26.08` order). The project is not yet ready to begin V3 module work because its foundation (Supabase + schema + RLS + auth) does not exist.
- **Business Impact:** "Begin V3" cannot start on modules until the foundation is stood up; mis-sequencing risk if module work begins first.
- **Security Impact:** RLS/auth foundation must precede any data work (`18.05`).
- **Scalability Impact:** Indexing/partitioning (Phase 4.5) must be designed into the initial migrations, not retrofitted.
- **Technical Risk:** Starting modules before the Supabase/RLS/index foundation.
- **Recommended Enterprise Solution:** Define a Phase-0 implementation foundation task: Supabase project, base migrations (with indexes/partitions from Phase 4.5), RLS policy framework (P3-02), and auth — before any business module. Rename the package.
- **Related Documents:** `17.01`, `17.03`, `18.05`, `20.*`, P3-02, P4.5-01/02.
- **Recommended Priority:** Medium.
- **Future Action Required:** Implementation foundation plan (Phase 7 roadmap).

### P5-06 — Designate the prototype as the V2 behavioral reference (opportunity)
- **Severity:** Improvement Opportunity
- **Status:** Open
- **Description:** The prototype is a working, valuable reference: `money.ts` encodes the locked money rules exactly, and POS/payroll/cash-advance/cash-flow flows are implemented and battle-tested behaviorally. Per ADR-001 Decision 6, it should be explicitly designated the **V2 reference implementation** that feeds V3 (especially money rules and the cash-advance balance logic), rather than being ambiguous code in the repo.
- **Business Impact:** Preserves proven business logic and reduces V3 rebuild risk.
- **Security Impact:** None.
- **Scalability Impact:** None.
- **Technical Risk:** Losing proven logic if the prototype is discarded without extraction.
- **Recommended Enterprise Solution:** Extract the locked money/payroll rules into the V3 money specification (P3-01) using `money.ts` as the verified source; document the prototype's role in the migration roadmap.
- **Related Documents:** `src/lib/money.ts`, `27.*`, `22`, P3-01.
- **Recommended Priority:** Improvement Opportunity.
- **Future Action Required:** Reference-extraction note in migration plan (Phase 6).

---

## 5. Phase 5 summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 3 |
| Low | 0 |
| Improvement Opportunity | 1 |

**Headline:** The code and the canonical docs are **two different systems**: `src/` is the V2 single-tenant offline prototype; the enterprise V3 architecture (10–26) is essentially unbuilt. This is the *expected* baseline given the migration roadmap — the real risks are (1) the project-status documents misrepresent it as ~90% complete (P5-02), and (2) nothing explicitly says "do not extend the prototype as V3" (P5-01). Encouragingly, the corpus already contains a dependency-sound build order (`18.05`) and an exact money-rules reference (`money.ts`) to anchor the rebuild. Readiness is "design-rich, foundation-not-yet-scaffolded."

**Cross-phase links:** P5-03 carries Phase 3 auth/RBAC into a do-not-port list; P5-04 closes the P2-02/P4-02 sequence question; P5-05 depends on P3-02 (RLS) and P4.5-01/02 (indexing/partitioning) being designed into the first migrations.

**Next phase:** Phase 6 — Migration & Roadmap Soundness.
