# ODR-004 — Dependency-Driven Enterprise Implementation Precedence

**Type:** Owner Decision Record · **Status:** APPROVED · **Date:** 2026-06-20
**Branch:** `architecture-audit` · **Resolves:** Phase 7 Owner Decision #4; findings **P2-02, P4-02, P1-06** (via Stage A4)
**Authority:** Owner (Founder). Subordinate to [ADR-001](ADR_001_Architecture_Ratification.md).

## Decision

V3 implementation order is **dependency-driven** — set by architectural dependencies, data-ownership boundaries, security, financial integrity, integration contracts, and system stability. **Not** by historical doc order, documentation-writing order, module popularity, or UI priority.

**Direction:** Architecture → Security → Data Foundation → Financial Integrity → Business Engines → Integration → User Experience → Production Hardening. *Never the reverse.*

## Canonical implementation sequence

- **Phase 0 — Architecture Governance Lock:** ADRs, audit remediation, locked-design registry, specs, security principles, financial-integrity rules. *No production dev until foundations are approved.*
- **Phase 1 — Platform Foundation:** Supabase; multi-company; branch isolation; auth; RBAC; RLS; audit infra; file/document architecture; offline-sync foundation.
- **Phase 2 — Core Master Data:** companies, branches, users, roles, permissions, crop master, inventory item master, suppliers, customers, equipment, units, classifications.
- **Phase 3 — Financial Foundation:** chart of accounts, journal engine, posting framework, accounting periods, currency foundation, cost allocation. *Rule: no operational module may create financial consequences before the accounting foundation to record them exists.*
- **Phase 4 — Operational Business Engines:** Agricultural Production; Inventory Operations (batches, FIFO, movement ledger, adjustments, transfers); Procurement & Sales; HR & Payroll. *Intra-phase: the inventory ledger precedes production-consumption costing.*
- **Phase 5 — Integration & Intelligence:** AI, IoT, notifications/messaging, calendar, reporting, analytics/BI.
- **Phase 6 — User Experience & Delivery:** web, mobile, offline field interfaces, dashboards, reports. *UI consumes stable enterprise services; it does not dictate architecture.*
- **Phase 7 — Enterprise Hardening:** security, performance, scalability, DR, backup-recovery, data-integrity, UAT.

## Canonical authority for sequencing

- **Primary:** ODR-004 (this) · Stage B foundation specs · `18.05` (DB & dev order) · `27.03` (V2→V3 strategy).
- **Supporting technical:** Section 20 (schema) · Section 26 (integration) · Section 11 (security) · Section 22 (accounting).
- **No longer authoritative for sequence:** `08.02`, `16.03` — retained as historical/high-level references, updated to defer here (Stage A4).

## Impact on audit

- **P2-02 / P4-02 / P1-06** (conflicting/contradictory sequences): direction set; closed by **Stage A4** reconciliation (fix `26.08` order; redirect `08.02`/`16.03`).
- Owner Decision **#4 → APPROVED**. Decision #5 remains open.
