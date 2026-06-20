# Stage B8 — V2 → V3 Master Data Migration Mapping, Transformation & Validation Specification

**Type:** Stage B foundation specification (migration) · **Status:** Specification complete (design only)
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Resolves:** finding **P6-02** (data-migration mapping, transformation, validation, acceptance)
**Authority basis:** [ADR-001](ADR_001_Architecture_Ratification.md), [ODR-001](ODR_001_V2_to_V3_Migration_Strategy.md) (hybrid, master-only). Consolidates Section 27 (Migration Roadmap), 13 (Status/Change Control), 20 (Schema), 11 (Security). Builds on [B1](Stage_B1_RLS_Specification.md), [B2](Stage_B2_Money_and_Financial_Precision_Specification.md), [B4](Stage_B4_Balance_Snapshot_and_Reporting_Architecture.md), [B5](Stage_B5_Idempotent_Transactions_and_Offline_Sync_Specification.md), [B7](Stage_B7_Authentication_Hardening_and_Disaster_Recovery_Specification.md).
**Scope note:** architecture documentation only. **No migration scripts, ETL, migrations, import tools, or transformation code.**

---

## 0. Assumptions challenged

- **Section 27 mandated a data-migration plan but none existed** (P6-02). This is it.
- **The hardest transformations were undefined:** V2 is single-tenant (no `company_id`/`branch_id` anywhere — verified `src/db.ts`), uses plaintext passwords, JS-float money, and flat (non-double-entry) accounting. Every migrated row therefore needs **tenant assignment**, and **no V2 financial/security/operational history may be imported** (ODR-001/B2/B5). Defined below.
- **"Migrate" must not mean "copy."** Per ODR-001, V3 starts a clean operational history; V2 master *identity* is migrated, V2 *history* is archived, V2 *technical debt* is dropped.

**Governing rule:** V2 knowledge → preserve & analyze → clean & transform → validate → import only enterprise-ready data → V3. **Never** V2 DB → copy everything → V3.

## 1. Migration philosophy

1. **Migrate clean business identity, not technical debt.**
2. **Preserve historical records (V2 archive) without importing historical weaknesses.**
3. **Every transformation is explicit and documented** (no silent conversion).
4. **Every migrated record has traceable provenance** back to its V2 origin (§3).
5. **Migration is repeatable and verifiable** (re-runnable from an immutable V2 snapshot; idempotent loads, B5).

## 2. Data classification matrix (the actual 12 V2 Dexie tables)

Mapped against `src/db.ts` (V2 = Dexie/IndexedDB, single-tenant):

| V2 table | Contents | Category | V3 disposition |
|---|---|---|---|
| `employees` | id, name, position, dailyRate, dateHired, active | **A — migrate after cleansing** | → HR employee master (profiles only). `dailyRate` migrates as current master value, **not** payroll history. |
| `prices` | veggie name, retailPerKg | **A → B** | Item/crop **identity** → inventory/crop master (Category A). Current `retailPerKg` is operational config, optional opening reference (not history). |
| `equipment` | name, purchaseDate, cost, working, checklist | **A/B — migrate master, transform** | → equipment/asset master (name, serial/spec, purchase date, category). `cost`/checklist history → **archive**, not imported as financial/asset-ledger history. |
| `meta` | farmName, nextSlipNo, lastBackup, openingCashBalance | **B — transform** | `farmName` → company config (A). `openingCashBalance` → V3 **opening balance via a new accounting opening entry** (B4), not migrated history. `nextSlipNo`/`lastBackup` → dropped. |
| `users` | username, **plaintext** passwordHash, role, approved | **B (identity) / C (security)** | **Accounts are NOT migrated.** Create **new V3 accounts** (§5); plaintext passwords dropped; V2 roles dropped (new RBAC). Link new account → migrated employee profile where applicable. |
| `transactions` | POS/wholesale sales, items, cash, slips | **C — archive only** | Sales history → V2 archive. Not imported (new financial posting, B2). |
| `expenses` | dated expense records | **C — archive only** | Financial history → archive. (Supplier/category *names* may seed master data via cleansing, not the records.) |
| `cashEntries` | cash in/out ledger | **C — archive only** | Financial history → archive. V3 cash starts from opening balance (B4). |
| `cashAdvances` | employee CA records | **C — archive only** | Payroll/financial history → archive. |
| `wages` | payroll runs | **C — archive only** | Payroll history → archive. |
| `scheduleEvents` | calendar events | **C — archive only** | Operational history → archive; active future events may be **manually re-entered** in V3 (not bulk-imported). |
| `projects` | project + tasks | **C — archive (optional manual re-entry)** | Operational; active projects optionally re-created manually in V3. |

**Category summary:** **A** = migrate after cleansing (employees, equipment master, crop/item identity, company config). **B** = migrate with transformation (users→new RBAC accounts, identifiers→mapped, opening balances→new entries). **C** = archive only, never imported (all transactions/financial/payroll/inventory-movement/audit/sync/cache history).

**Tenant assignment (the V2→V3 structural gap):** V2 is one farm. Migration assigns all migrated master data to **one V3 company + one default branch** (owner-confirmed at acceptance, §6); every imported row gets `company_id`/`branch_id` (B1/`20.02`). Multi-branch split, if any, is a manual post-migration step.

## 3. Migration identity mapping

- **Legacy-ID tracking:** a **migration reference table** records `(v2_table, v2_id) → (v3_entity, v3_uuid, migrated_at, batch_id)`. Every migrated record is traceable to its V2 origin and back.
- **New V3 identifiers:** V3 assigns fresh UUIDs (`20.*`); V2 ids are never reused as V3 PKs (they carry single-tenant assumptions).
- **Duplicate detection:** pre-load dedup on natural keys (e.g. supplier/customer name + contact; employee name + hire date) → merge or quarantine (§4).
- **Ownership validation:** every mapped record resolves to the assigned company/branch; unresolved ownership = quarantine.
- **Repeatability:** the reference table makes re-runs idempotent — a second load of the same V2 id updates the mapping, never creates a duplicate (B5 principle applied to migration).

## 4. Data quality & cleansing rules

Migration **fails closed**: invalid records are **quarantined for review, never silently imported**.

| Issue | Rule |
|---|---|
| Missing required field | Quarantine; require correction before load |
| Duplicate customer/supplier/employee | Dedup (merge) or quarantine; reference table records the merge |
| Invalid contact info | Flag/cleanse; non-blocking fields may import with a warning |
| Inconsistent units | Map to V3 canonical units of measure (Category A); unmappable → quarantine |
| Orphan records (no valid parent) | Quarantine (causal validity, B5 §9) |
| Invalid company/branch ownership | Quarantine — no row imports without valid tenant ownership (B1) |
| Float money values | Convert to B2 decimal standard on transform; never import raw floats |

A pre-load **data-quality report** lists counts of clean / cleansed / quarantined per table; load proceeds only on the clean+cleansed set.

## 5. Security transformation

- **No password migration** — V2 plaintext passwords are dropped; users complete V3 credential enrollment (B7 §2) with **password reset on first login**.
- **MFA enrollment** required for applicable roles before privileged use (ODR-003 / B7 §3).
- **New RBAC assignment** — V2 roles are **not** trusted; each new account gets V3 roles/permissions/branch assignments under the enterprise model (B1; no role-name carryover, A3/B1).
- **Account activation review** — every new account is explicitly reviewed/activated; **unauthorized or stale V2 users are removed** (not recreated).
- **Company/branch validation** — every account is bound to the assigned company + authorized branches (B1).

## 6. Migration execution strategy (phases)

1. **Extract** — create an **immutable V2 snapshot** (read-only export of the Dexie data); all analysis/loads run from the snapshot, never live V2.
2. **Analyze** — run data-quality (§4); produce clean/cleanse/quarantine report; resolve quarantine.
3. **Transform** — apply Category B transformations (tenant assignment, identifier mapping, unit normalization, float→decimal, opening-balance derivation); document each transform.
4. **Load** — import approved Category A/B records (idempotent via reference table, §3); never load Category C.
5. **Validate** — §7 reconciliation (counts, relationships, ownership, security).
6. **Business acceptance** — owner reviews results and **confirms the company/branch assignment and opening balances**; migration is reversible until this sign-off (§9).

## 7. Migration validation & reconciliation

- **Record counts:** `V2 approved (clean+cleansed)` = `V3 imported` per table (quarantined accounted for separately). No silent drops.
- **Relationship checks:** customers/suppliers/employees belong to valid company/branch; products have valid units; new accounts link to valid employee profiles + branches.
- **Security checks:** RLS boundaries verified (B1 negative tests) — unauthorized cross-company/branch access **fails**; no migrated account has unintended scope.
- **Opening-state checks:** V3 opening inventory (physical count) and opening trial balance (B4) are present, balanced (B2 exact debit=credit), and tie to the owner-confirmed figures — **not** to V2 computed balances.
- **Provenance check:** every imported row has a reference-table entry (§3).

## 8. Historical archive strategy (ODR-001)

- **V2 = read-only historical archive**, clearly labeled legacy, **no new transactions**, limited access, **physically/logically separate from V3 production**.
- V2 archive is used for historical reference, data verification, regulatory review, business analysis, and migration validation (ODR-001) — it **never** becomes V3 transactional data.
- Historical reports may reference the V2 archive; they are not mixed into V3 ledgers/snapshots (B4 keeps V3 history clean).

## 9. Rollback & recovery strategy

- **Rehearsal required:** migration is rehearsed against the snapshot in a staging environment before production load (mirrors B7 §12 DR-drill discipline).
- **Reversible until acceptance:** because Category C is never touched and loads are idempotent + reference-tracked, a failed migration is rolled back by removing the loaded batch (by `batch_id`) and re-running — V2 is untouched (read-only snapshot), V3 production can be reset to pre-load.
- **Rollback criteria:** reconciliation failure, unresolved quarantine above threshold, or failed security checks → halt, do not accept.
- **Recovery:** restore V3 to pre-migration state (B7 DR) and re-run from the immutable snapshot.

## 10. Future migration governance

- **Approval:** the owner approves migration scope and final acceptance (§6); any future import of V2 *operational* data requires the ODR-001 exception gate (specific requirement + dedicated spec + integrity validation + owner approval).
- **Required documentation:** classification matrix, transformation log, data-quality report, reconciliation report, sign-off record.
- **Testing evidence:** rehearsal results + reconciliation pass (§7) are prerequisites to acceptance.
- **Audit:** the migration itself is audited as System events (B6) — who ran it, what loaded, when, with what result.

---

## 11. Findings resolved / dependencies

- **P6-02** (data-migration mapping & validation) → **Resolved (Stage B8)**: §2 (per-table classification of the actual V2 schema), §3 (identity mapping/provenance/idempotent re-run), §4 (cleansing/quarantine, fail-closed), §5 (security transformation — no plaintext, new RBAC, MFA), §6 (extract→…→acceptance phases), §7 (reconciliation/acceptance criteria), §8 (V2 archive), §9 (rollback).
- **Dependencies:** ODR-001 (scope), B1 (tenant/RBAC on every migrated row), B2 (float→decimal, opening balances), B4 (opening inventory/trial balance as new entries), B5 (idempotent loads), B7 (credential enrollment, DR/rehearsal). No V2 financial/security/operational history imported (B2/B5/B6 boundaries upheld).
- **No contradictions** with Section 27 — B8 is the concrete mapping Section 27 called for; Section 27's strategy and this spec agree (master-only, V2 archived, clean V3 start).

---

## 12. Stage B foundation program — complete

B8 is the final Stage B specification. **B1–B8 are complete.** Recommended next step is **not** coding but a **Stage B Completion Review**: re-verify all 59 audit findings (Open vs Accepted vs Resolved vs Rejected), confirm the enterprise foundation is implementation-ready, and define **Stage C** (implementation scaffolding & development preparation) per the ODR-004 dependency-driven sequence.
