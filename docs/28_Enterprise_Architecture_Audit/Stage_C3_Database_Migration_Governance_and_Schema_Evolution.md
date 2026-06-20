# Stage C3 — Enterprise Database Migration Governance & Schema Evolution

**Type:** Stage C engineering-preparation artifact (binding design spec) · **Status:** In force (design); applied when implementation begins
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Authority basis:** ADR-001, ODR-001…005 (esp. ODR-004 sequence), B1–B8, Section 20 (Master DB Schema), Section 26 (Integration), [C2](Stage_C2_Supabase_Enterprise_Foundation_and_Infrastructure_Boundaries.md), [C4](Stage_C4_Repository_Git_Governance.md), [C6](Stage_C6_CI_CD_Quality_Gates_and_Automated_Architecture_Enforcement.md).
**Scope note:** design specification only. **No SQL, migration files, tables, schema changes, Supabase CLI, DB init, seed data, scripts, source, or config.**

> The architecture defines *what the database must become*; C2 defines *who owns each responsibility*; **C3 defines *how the database is allowed to evolve without breaking trust.*** Guiding asymmetry: *a bad feature can be removed and a bad UI redesigned — but corrupted historical data may be impossible to recover.* Therefore schema evolution is a controlled enterprise process, not a development convenience.

---

## 0. Assumptions this document rejects

1. **"We can just rename/delete a column the new app no longer needs." — FALSE.** Destructive schema change requires a transition strategy (§7), never a big-bang drop.
2. **"Every migration should always be reversible." — FALSE.** Some migrations (data transformations, financial migrations, historical corrections) are irreversible; recovery for those means *restore backup + reapply safe migrations*, not "undo SQL" (§8).
3. **"Production is broken, so we can fix it directly." — FALSE.** Direct production edits create undocumented drift; emergency changes are governed, audited, and reconciled into migration history (§13).

## 1. Migration authority model

```
ADR / ODR  →  Enterprise schema authority (Section 20, B-specs)  →  Migration design
   →  Migration review (C4 risk-classed)  →  Versioned migration  →  Testing (C5/C6)
   →  Deployment (env order)  →  Verification
```

- **A migration never becomes the source of truth.** The canonical schema is the enterprise database documentation (Section 20 + B-specs); migration files are **implementation history** that realizes it.
- A migration that diverges from the canonical schema is a defect (schema drift, §12), not a new authority.

## 2. Migration lifecycle

**Proposal** — answer: why is this change required? what business capability does it support? **which document authorizes it?** (no authority → no migration, C4 §4).

**Impact analysis** — evaluate security, **RLS**, financial, performance, storage, migration run-time, and **rollback feasibility** (§8) before writing it.

**Implementation** —
- Every schema change is a **version-controlled migration**; **manual DB changes are prohibited**; production edits via dashboard/SQL console are prohibited except governed emergencies (§13).
- Migrations are **deterministic and reproducible** — the same migration yields the same result in Local → Test → Staging → Production.

**Testing** — each migration validated for: clean-database execution; upgrade from the previous version; **RLS policy integrity**; data preservation; performance impact; index effectiveness (B3); application compatibility; and a rollback/recovery strategy (§8).

**Deployment** — strict environment order, **no skipping**:
```
Local → Test → Staging → Production
```
Production is always the final destination.

**Verification** (post-deploy) — schema matches expected state; **RLS still active**; required indexes exist (B3); financial tables intact (B2); audit mechanisms function (B6); performance within budget (B3 §9).

## 3. Schema change classification (risk → review, aligns C4 §5)

| Risk | Examples | Requires |
|---|---|---|
| **Low** | non-critical columns, metadata, optional reference fields | normal review + standard testing |
| **Medium** | new operational tables, relationships, indexes, reports | architecture review + integration testing |
| **High** | financial tables, inventory ledger, production history, authentication, **RLS policies**, permission structures, audit tables, **tenant-ownership fields** | senior review + full testing + security validation + explicit architecture verification |

Migrations touching money/RLS/audit/tenancy are **always High** and never merge on a single standard review.

## 4. Tenant-isolation migration rules (B1)

A migration must never weaken `company_id` / `branch_id` ownership, permission boundaries, or RLS enforcement.

- New tenant-owned tables **must define a tenant-ownership strategy** (`company_id` [+ `branch_id`]) and an **RLS policy design before production use**.
- **A table without RLS approval cannot reach production** (C2 §6 / C6 migration gate).
- **Cross-company data exposure introduced by a migration is a release-blocking defect.**

## 5. Financial schema governance (B2) — highest sensitivity

**Forbidden:** casually changing money precision · converting monetary data to floating point · deleting financial history · editing historical journal entries.

**Required:** preserve historical truth · corrective entries instead of destructive edits (B2/B4/`26.07`) · validate debit/credit integrity · maintain deterministic calculations · money columns remain the canonical `NUMERIC`/`Money` type (B2). A precision change is an architectural change (ADR/ODR + §3 High review), never an in-place alter.

## 6. Audit & historical preservation (B6)

Migrations respect the append-only audit philosophy, historical business records, and traceability.

**Forbidden:** ❌ DELETE audit history · ❌ rewriting historical records to "clean up" data.

Corrections follow: **Original record → correction event → audit trail.** A migration may add structure to the audit system but may never mutate or remove its history.

## 7. Backward compatibility & data evolution

No big-bang destructive change. Schema evolution uses an **expand → migrate → contract** transition:
```
Add new structure → migrate/backfill existing data → validate correctness → deprecate old structure → remove only after approval
```
During the transition the application supports both shapes; the old structure is removed only after data is verified migrated and the removal is approved (§3 High if it touches protected data). This keeps releases reversible and zero-downtime-capable.

## 8. Migration rollback philosophy

Not every migration is reversible.
- **Structural, additive changes** (new tables/columns/indexes) are typically reversible — provide the reverse.
- **Irreversible by nature:** data transformations, financial migrations, historical corrections — an "undo SQL" would itself destroy/duplicate data.

For irreversible migrations, the protection is **not** a reverse script but: verified backups (B7), tested restore procedures (B7 §11), **dry-run testing** on a staging copy, and approval checkpoints. Recovery means:
```
Restore backup  +  reapply safe migrations
```
not "undo SQL." Every migration declares its rollback strategy (reversible script *or* restore-based recovery) in its proposal (§2).

## 9. Seed data & reference data governance

| Class | Examples | Rule |
|---|---|---|
| **System reference data** | countries, units of measure, crop categories, permission definitions, currency master | version-controlled · **idempotent** · environment-reproducible (re-runnable without duplicates, B5 principle) |
| **Business data** | customers, inventory, financial records, employees | **never** treated as seed data — created through the application under RLS/audit, or migrated via B8 |

Seed migrations create the *framework* (roles/permissions/reference lists per B1/B2); they never inject business records.

## 10. Migration dependency order (ODR-004)

All migrations respect the ODR-004 / `18.05` dependency-driven sequence — foundational migrations first:
```
Identity → Tenant model → Permissions → Core reference data → Operational ledgers → Financial engine → Reporting → Advanced features
```
**A later module must never force a redesign of a foundational table.** Foundation invariants (B1 RLS, B2 money types, B3 indexes/partition-readiness, B6 append-only audit) are established in the earliest migrations so everything built on them inherits compliance (C6 §0 dependency).

## 11. Naming, traceability & documentation

Every migration answers: **what changed · why · which architecture document authorized it · what risks were considered · what testing was performed.** Traceability chain (mirrors C4 §11):
```
Business requirement → Architecture authority → Migration → Code → Tests → Deployment record
```
Migrations are timestamp/sequence-named, single-responsibility (C4 §3), and committed via PR (C4) — the migration is the schema's version history.

## 12. CI/CD migration enforcement (C6)

Automated gates (C6 Tier 2 — migration PRs) must verify:
- Migration files **present** for any schema change (no code-vs-DB drift).
- **No unauthorized schema drift** (deployed schema matches migration history).
- **RLS policies validated** (every operational table RLS-enabled + tenant columns).
- **Required indexes present** (B3).
- **Security rules not weakened** (no RLS removal, no permission widening without authority).
- **Dangerous patterns detected** (float money columns, audit UPDATE/DELETE, dropped tenant columns).

A successful migration is **not** "the database accepted the SQL" — it must preserve the enterprise guarantees, verified by these gates.

## 13. Emergency database changes

Emergency changes are **controlled exceptions**, never free passes. Required: incident justification · temporary authorization (B7 break-glass: time-boxed, MFA, approved) · **full audit trail** (B6) · **post-incident migration reconciliation** (the emergency change is captured as proper migration history) · root-cause review (B7 §7). **Any emergency change not converted into migration history is undocumented drift** and is itself a defect to remediate. Emergency status never bypasses financial/security/audit laws (C7).

## 14. Future scalability & lifecycle (B3)

Migration design stays compatible with future **partitioning** (stable partition keys present from the first migration of high-volume tables, B3 §5), **archive strategies**, **storage lifecycle**, and **performance optimization**. Schemas must not bake in assumptions (e.g. single-physical-table uniqueness) that block later scaling (B3 §0). Premature partitioning is not done now (ODR-005), but partition-readiness is mandatory at table creation.

---

## 15. Consistency, findings & status

Reviewed against ADR-001, ODR-001…005, B1–B8, Section 20/26, C2/C4/C6: **no new architectural authority, no contradictions** — C3 operationalizes how the canonical schema (Section 20 + B-specs) is realized and evolved, under C2 ownership and C6 enforcement. It strengthens, and depends on, the ODR-004 order and B1/B2/B3/B6 invariants.

**Findings:** C3 is process design; it does not *close* any open finding (the migration-mapping finding P6-02 was resolved by B8; cutover/rollback P6-03 by B8). It defines the governance the C6 migration gates (which will close enforcement-related items at build time) operate within. **No finding status changed.**

**Verification:** documentation only — no SQL, migration files, schema changes, CLI runs, seed data, scripts, source, or config.

**Next:** C8 — Enterprise Implementation Sequence (the executable ODR-004 build roadmap; final Stage C document).
