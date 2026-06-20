# ODR-001 — V2→V3 Data Migration Strategy

**Type:** Owner Decision Record · **Status:** APPROVED · **Date:** 2026-06-20
**Branch:** `architecture-audit` · **Resolves:** Phase 7 Owner Decision #1; finding **P6-02** (migrate-vs-fresh)
**Authority:** Owner (Founder). Subordinate to [ADR-001](ADR_001_Architecture_Ratification.md).

## Decision

V3 adopts a **Hybrid Migration Strategy**: migrate **selected master/reference data only**; do **not** migrate V2 operational transactions. V2 is preserved as a **read-only historical archive**. V3 establishes a **new operational history** on the enterprise architecture.

**Principle:** *Migrate business knowledge, not technical debt.*

## Migrate (after validation + transformation)

- **Agricultural master:** crop catalog, seed varieties, classifications, cultivation references.
- **Inventory master:** item catalog, product codes, units, categories, descriptions.
- **Business partners:** suppliers (name/contact/address/category), customers (name/contact/classification).
- **HR:** employee **profile** info only — **not** V2 roles/permissions/security. All employees get new V3 accounts, branch assignments, roles, permissions under enterprise RBAC.
- **Assets:** equipment, specs, serial numbers, categories.
- **Config:** units, categories, tags, non-financial reference lists.

## Do NOT migrate

Inventory history · production history · sales history · accounting history (journals/GL/AR/AP/balances) · payroll/attendance history · security history (roles/permissions/logins/audit logs).
Reason: V3 uses new ledger/FIFO/branch-ownership, new financial posting, clean validated enterprise ledger, new HR/payroll, and new RBAC/audit — each must start clean.

## V3 opening state

- **Inventory:** physical count → verified opening balances → new V3 ledger.
- **Accounting:** opening trial balance → verified position → new V3 GL.
- **Employees:** migrated profiles → new V3 accounts + branch assignments + RBAC.

## V2 preservation

Read-only archive for historical reference, data verification, regulatory review, business analysis, migration validation. **No new development on V2.**

## Future exceptions

Migrating V2 operational transactions is prohibited unless: a specific legal/regulatory/business requirement exists, a dedicated migration spec is created, integrity validation is completed, **and** the owner approves.

## Impact on audit

- **P6-02** (no data-migration mapping / migrate-vs-fresh undecided): direction now set → **Accepted**. Stage B/B8 produces the field-level mapping for the *approved migrate scope only*, plus opening-balance procedures.
- Owner Decision **#1 → APPROVED**. Decisions #2–#5 remain open.
