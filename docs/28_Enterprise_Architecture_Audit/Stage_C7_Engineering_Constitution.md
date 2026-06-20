# Stage C7 — Enterprise Engineering Constitution & Development Guardrails

**Type:** Stage C engineering-governance artifact (binding) · **Status:** In force
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Authority basis:** ADR-001, ODR-001…005, Enterprise layer (Sections 10–26), Stage A/B specifications, Locked Designs Registry `13.02`.
**Scope note:** governance documentation only. **No production code.**

This is the permanent engineering constitution. It governs every future implementation decision. It answers a different question than the architecture did:

> The architecture asked: *What must PickUrVeggie ERP V3 become?*
> This constitution asks: **What must no developer — human or AI — ever be allowed to break?**

It is enforceable by human developers, Claude Code, future AI agents, code review, and CI/CD quality gates. Each law below maps to a binding specification and (where automatable) a CI guard (§14).

---

## 0. Engineering authority hierarchy

Implementation obeys every layer above it. **Code never becomes architectural authority.**

```
ADR-001 + ODR-001…005            (ratified decisions — supreme)
        ↓
Enterprise Architecture (Sections 10–26)   (canonical technical authority)
        ↓
Stage A / B Foundation Specifications (B1–B8)
        ↓
Locked Designs Registry (13.02)
        ↓
Engineering Constitution (this document, C7)
        ↓
Implementation Code            (must obey all layers above)
```

If implementation code conflicts with any higher layer, **the code is wrong** — not the layer. Convenience never overrides architecture (§13).

---

## 1. Core engineering philosophy

1. **Security before convenience.**
2. **Correctness before optimization.**
3. **Data integrity before speed.**
4. **Explicit design over hidden assumptions.**
5. **Simple solutions — when they do not violate architecture** (the laziest correct solution; never the flimsiest).
6. **Performance optimization without sacrificing correctness or integrity.**
7. **Every critical business action is explainable and auditable.**

## 2. Multi-tenant security laws — ref **B1**

**Forbidden forever:** ❌ cross-company data leakage · ❌ queries that bypass tenant isolation · ❌ assuming frontend restrictions provide security · ❌ hidden administrator bypasses · ❌ hardcoded access exceptions.

**Required:** RLS is the final data boundary · permissions determine authority (never role-name strings) · `company_id`/`branch_id` ownership explicit on every operational row · all access auditable · deny-by-default; every operational table has RLS enabled.

## 3. Authentication & identity laws — ref **B7, ODR-003**

**Forbidden:** ❌ plaintext passwords · ❌ reversible credential storage · ❌ shared administrator accounts · ❌ Developer permanent access to customer/business data.

**Required:** MFA per ODR-003 (mandatory for privileged/financial roles) · time-limited privileged access · break-glass auditing with auto-expiry · device/session security · mandatory at-rest encryption of sensitive offline caches.

## 4. Financial integrity laws — ref **B2** *(highest-authority area)*

**Forbidden forever:** ❌ floating-point money · ❌ direct modification of posted financial entries · ❌ deleting financial history · ❌ silent financial corrections · ❌ unbalanced journal entries.

**Required:** fixed-precision decimal money (PHP V1, ODR-002) · double-entry accounting · reversal-based corrections only · immutable financial history · deterministic calculations (same result on any device/time) · exact debit=credit (no float epsilon).

## 5. Inventory & production integrity laws — ref **B4, Sections 20/22, 13.02**

**Forbidden:** ❌ editing historical inventory movements · ❌ changing historical cost calculations without audit · ❌ adjusting stock outside approved transactions.

**Required:** inventory movement ledger as source of truth · FIFO batch integrity · full traceability · reversal/adjustment transactions only · balances derived from history (snapshots, B4), never hand-edited.

## 6. Offline synchronization laws — ref **B5**

**Forbidden:** ❌ duplicate business effects from retries · ❌ auto-merging conflicting financial history · ❌ trusting device time as authoritative.

**Required:** idempotent transactions (idempotency key, at-most-once commit) · server-side validation is authoritative · conflict classification with tiered resolution · exactly-once business effects.

## 7. Audit & event integrity laws — ref **B6**

**Forbidden:** ❌ deleting audit records · ❌ modifying historical audit events · ❌ critical actions without traceability.

**Required:** append-only audit model (UPDATE/DELETE denied for all roles) · immutable event history · business justification for privileged actions · corrections by addition, never rewrite.

## 8. Module ownership laws — ref **B6, Section 26**

**A module owns its own data.**

**Forbidden:** ❌ direct modification of another module's internal tables · ❌ duplicate ownership of business entities · ❌ circular dependencies between modules.

**Required:** versioned integration contracts (events) · defined ownership boundaries (one owner per domain) · reference others' data by id + consumed events.

## 9. Migration & legacy protection laws — ref **ODR-001, B8**

**Forbidden:** ❌ copying V2 databases directly into V3 · ❌ migrating plaintext passwords · ❌ importing legacy security models · ❌ importing legacy financial/operational history.

**Required:** clean transformation (master data only) · data validation + quarantine of bad data · V2 kept as separate read-only historical archive.

## 10. Performance & scalability laws — ref **B3, B4, ODR-005**

**Forbidden:** ❌ queries that ignore tenant filtering · ❌ unbounded queries on high-volume tables · ❌ optimizing by breaking data integrity.

**Required:** tenant-first (leading) indexing · pagination (keyset; mandatory tenant+date filters) · reporting from snapshots/rollups (not raw scans) · performance testing before scale expansion.

## 11. AI & automation laws — ref **B6, Sections 23/26**

**AI is advisory.**

**Forbidden:** ❌ AI directly modifying critical business data without governed authorization · ❌ AI bypassing security/approval workflows.

**Required:** AI acts through the same permissions, RLS, and audit boundaries as humans; AI is never a source of truth; AI actions are audited with the initiating user + approval decision.

## 12. Development decision checklist (answer before implementing any feature)

1. Which architecture document **authorizes** this feature?
2. Which **module owns** this data?
3. What **permissions** control access?
4. What **audit** records are created?
5. What happens when the device is **offline**?
6. What happens if the request is **retried 100 times**?
7. Does this create **financial or inventory** impact?
8. Does it violate any **locked design** (`13.02`)?

**If any answer is unclear → STOP implementation and return to architecture review.**

## 13. Architectural change process

Developers may not silently redesign the system. Any change affecting **security, money, inventory integrity, accounting, offline synchronization, data ownership, or module boundaries** must go through documented architecture review (ADR/ODR or a Stage spec update). **Implementation convenience is never sufficient reason to break architecture.** A locked design (`13.02`) changes only via its change-control process (`13.05`).

---

## 14. Enforcement matrix (human · AI · review · CI)

Every law is enforced at multiple levels; automatable laws become CI guards (defined in **C6**). A merge that violates a guard is blocked.

| Law | Binding spec | Automated CI guard (C6) | Human/AI review check |
|---|---|---|---|
| §2 Tenant security | B1 | RLS-enabled-on-every-table lint; cross-tenant negative tests | No frontend-only auth; no hardcoded exceptions |
| §3 Auth/identity | B7/ODR-003 | No-plaintext-password lint; MFA-config check | No shared admin; time-boxed privileged access |
| §4 Financial | B2 | No-float-money lint; debit=credit test; no-delete-posted test | Reversal-only corrections |
| §5 Inventory/production | B4/20/22 | No-edit-historical-movement test; balance-from-history test | Adjustments via transactions only |
| §6 Offline sync | B5 | Idempotency/exactly-once test (retry×100 → 1 effect) | No device-time authority; conflict tiering |
| §7 Audit | B6 | Append-only-audit lint (no UPDATE/DELETE) | Justification on privileged actions |
| §8 Module ownership | B6/26 | Ownership lint (no writes to another module's tables); no-circular-dep check | Integration via events/contracts |
| §9 Migration | ODR-001/B8 | Migration reconciliation test; no-plaintext-import check | Master-data-only; V2 archive separate |
| §10 Performance | B3/B4 | No-unbounded-query/pagination lint; tenant-filter lint | Snapshots for reports |
| §11 AI | B6/23/26 | AI-action-audit test; AI-under-RLS test | AI advisory only; human approval |

**Precedence of guards:** a CI guard may never be disabled to "ship faster"; disabling a guard is itself an architectural change (§13). Claude Code and future AI agents treat this constitution as a hard constraint and must refuse or escalate work that violates it.

## 15. Consistency check (no contradictions)

Reviewed against ADR-001, ODR-001…005, B1–B8, and Section 26: every law derives directly from a ratified decision or foundation spec; none contradicts another or a higher authority. Specifically — §2↔B1, §3↔B7/ODR-003, §4↔B2/ODR-002, §5↔B4, §6↔B5, §7↔B6, §8↔B6/26, §9↔ODR-001/B8, §10↔B3/B4/ODR-005, §11↔B6/23/26. No conflict found.

---

## 16. Status

The Engineering Constitution is **in force** as of this commit and is part of the permanent engineering authority (hierarchy §0). It establishes the prohibitions behind finding **P5-03** (do-not-port: no plaintext, no role-name auth); those prohibitions become *automatically enforced* once the C6 CI guards are implemented (P5-03 remains Open until enforced in code at Stage C6/D). All other laws are now the binding contract for Stage D implementation.

**Next:** C4 — Repository & Git Governance.
