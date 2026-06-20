# ODR-002 — Multi-Currency Strategy

**Type:** Owner Decision Record · **Status:** APPROVED · **Date:** 2026-06-20
**Branch:** `architecture-audit` · **Informs:** Phase 7 Owner Decision #2; finding **P3-01** (money precision/currency, spec owed by Stage B/B2)
**Authority:** Owner (Founder). Subordinate to [ADR-001](ADR_001_Architecture_Ratification.md).

## Decision

V3 **Version 1 operates in Philippine Peso (PHP) only**. The architecture must be **fully multi-currency-ready** so future international expansion needs controlled extension, not redesign.

**Principle:** *Don't implement complexity before the business requires it — but never design in a way that blocks future enterprise expansion.*

## V1 currency policy

All V1 transactions are PHP: sales (quotes, orders, invoices, POS, payments), purchasing (quotes, POs, receiving, supplier invoices/payments), inventory (valuation, costing, adjustments, consumption), production (seed/fertilizer/labor/crop costing), HR/payroll (salaries, benefits, deductions), accounting (GL, journals, AR/AP, cash/bank, statements). All V1 reports are in PHP. **Non-PHP operational transactions are rejected** until the multi-currency module is designed, approved, and implemented.

## Multi-currency readiness (reserve now, build later)

- **Currency master** entity: code, name, symbol, status (e.g. PHP, USD, EUR).
- **Company base currency**: every company has one; V1 = PHP. Future: companies may differ.
- **Monetary data standards**: fixed-precision decimal only; **floating point prohibited** for money; exact precision/scale set by the Stage B financial spec (B2).
- **Reserved extension points** (not built in V1): exchange-rate management (daily/historical/sources), foreign-currency transactions, FX accounting (realized/unrealized gains/losses, revaluation), multi-currency & consolidated reporting.

## Future activation gate

Full multi-currency activates only after: a dedicated spec, accounting-implications review, exchange-rate rules, approved reporting requirements, **and** owner approval.

## Impact on audit

- **P3-01** (money precision & currency): currency scope now decided — PHP-only V1 with currency-ready schema (currency master + base currency + fixed-precision, no float). The concrete `NUMERIC(p,s)`/rounding/FX-field spec remains owed by **Stage B/B2**, so P3-01 stays **Open** pending that spec.
- Owner Decision **#2 → APPROVED**. Decisions #3–#5 remain open.
