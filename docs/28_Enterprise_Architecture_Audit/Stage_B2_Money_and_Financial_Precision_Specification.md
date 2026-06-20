# Stage B2 — Enterprise Money & Financial Precision Specification

**Type:** Stage B foundation specification (financial) · **Status:** Specification complete (design only)
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Resolves:** finding **P3-01** (money precision/currency unspecified)
**Authority basis:** [ADR-001](ADR_001_Architecture_Ratification.md), [ODR-002](ODR_002_Multi_Currency_Strategy.md), [ODR-005](ODR_005_Progressive_Scaling_Strategy.md). Consolidates Section 22 (Accounting), Section 20 (Schema), Section 26 (Integration).
**Scope note:** architecture documentation only. **No PHP, SQL, schema DDL, or calculation code.**

---

## 0. Assumptions challenged

- **The V1 reference uses floating point.** `src/lib/money.ts` implements `round2` via `Math.round(... * 100)/100` on JS `number` (IEEE-754 float). Its *rules* (half-up to 2 dp, 10% farm discount) are correct and are the canonical behavioral reference (P5-06); its *representation* (float) is **not** acceptable for V3 enterprise money. This spec keeps the rules, replaces the representation.
- **Money columns are untyped in the schema.** `journal_lines.debit_amount`/`credit_amount` (`20.22`) and `financial_accounts.current_balance` (`20.24`) carry no precision/scale. Specified here.
- **A stored `current_balance` contradicts "compute from history."** `20.24` both stores `current_balance` and states balances are computed from transaction history. **Resolution:** a stored balance is permitted only as a **derived checkpoint** (never a hand-editable field); the snapshot/materialization mechanism is owned by Stage B4. This spec forbids editable stored balances; B4 defines the checkpoint mechanism. (Ties P4.5-03.)
- **Multi-currency is declared but unrepresentable.** Branches/accounts carry `currency` yet `journal_lines` has no currency/FX fields. This spec defines the currency-ready field set (dormant in V1 per ODR-002).

---

## 1. Money representation philosophy

1. **Money is never a floating-point value.** All monetary storage and calculation use fixed-precision decimal. Float is prohibited anywhere a value becomes a financial amount.
2. **Accuracy over convenience.** Financial correctness outranks computational ease at every layer.
3. **Every amount has defined precision.** No "naked" number is a financial amount; each has a known scale and currency.
4. **Determinism.** The same inputs produce the same result on any device, location, or time (online or offline). Financial math is reproducible, not environment-dependent.
5. **Conservation.** Sums of parts equal the whole to the defined scale; no value is created or lost by rounding.

## 2. Canonical monetary data standards

| Concept | Standard (V1) | Notes |
|---|---|---|
| **Posted monetary amount** | Fixed-precision decimal, **scale 2** (centavo) | Debits, credits, balances, totals, payments. `NUMERIC(18,2)` is the reference (max ≈ 9.99×10¹⁵ — far beyond V1/ODR-005 envelope). |
| **Unit price / rate inputs** | Fixed-precision decimal, **scale 4** | Per-kg prices, daily rates, percentages-as-decimals. Higher scale on inputs prevents premature rounding before the line total. |
| **Quantity** | Fixed-precision decimal, **scale 3** (recommended) | Weights/volumes (e.g. kg to grams). Quantities are not money but feed money math; precision defined to bound drift. |
| **Exchange rate** | Fixed-precision decimal, **scale 6+** (dormant V1) | Reserved for future FX; not used while PHP-only. |
| **Intermediate calculation** | Decimal at input scale or higher; **never float** | Round only at defined boundaries (§4), not per intermediate step. |

Rules: monetary columns are non-nullable where an amount is required (use 0.00, not NULL, for "no amount"); a single documented type alias ("Money") is used everywhere so precision can never drift between tables (§9). Maximum supported value is a documented constant, sized for the ODR-005 long-term envelope.

## 3. Currency architecture

**V1 (ODR-002):** PHP is the sole operational currency. All transactions, valuations, payroll, and reports are PHP. Non-PHP operational transactions are rejected (ODR-002 restriction).

- **Base currency ownership:** every **company** has one base currency (V1 = PHP). Reporting currency = company base currency in V1.
- **Branch currency:** branches inherit company base currency in V1; the `currency` field exists but is constrained to the company base until multi-currency activates.
- **Reporting assumption:** all V1 financial statements are single-currency (PHP); no conversion occurs.

**Multi-currency readiness (dormant until ODR-002 activation gate):**

- **Currency master:** code (ISO 4217), name, symbol, minor-unit scale, status. Drives valid currency codes.
- **Per-amount currency:** financial amount fields are currency-ready — every stored amount is conceptually `(amount, currency_code)`. In V1 `currency_code` is always PHP; the field is reserved so historical rows never need backfilling.
- **Exchange-rate history:** rate, from/to currency, effective timestamp, source. Append-only.
- **Conversion policy (future):** a transaction stores both its **original-currency amount** and its **base-currency amount + rate used**, so the historical financial reality is preserved exactly (a past entry never silently re-values when rates change). Realized/unrealized FX gain/loss and revaluation are future (ODR-002), out of V1 scope.

**Historical fidelity rule:** a posted transaction is forever tied to the financial reality (amount, currency, rate) at creation. Later currency or rate changes never mutate historical entries (consistent with `20.22` immutability).

## 4. Rounding standards

- **Method:** **round half-up** to the target scale (matches the V1 `round2` rule; the canonical method for the whole system). One method, everywhere — no mix of half-up/half-even.
- **Round once, at defined boundaries** — never cumulatively:
  - **Line amount** = round(quantity × unit_price) to scale 2 — rounded **once** at the line.
  - **Discount / tax** = round(line × rate) to scale 2 at the line it applies to.
  - **Totals / aggregates** = exact **sum of already-rounded line amounts** (do not re-round the sum; summing 2-dp values stays 2-dp).
  - **Reports** display already-stored rounded values; reporting never re-rounds underlying postings.
- **No cumulative drift:** because rounding happens once per line and totals are exact sums, repeated/large-volume transactions cannot accumulate error. (Allocation case below.)
- **Allocation / split rule:** when a rounded total must split into parts (e.g. cost allocation, proration), use **largest-remainder** distribution so the parts sum **exactly** to the total (the residual centavo is assigned deterministically). Defined here to prevent off-by-a-centavo allocation drift.

## 5. Calculation ownership

The same transaction must not produce different results across layers. Ownership:

| Layer | Role in money math |
|---|---|
| **Database** | **Authoritative** for posting integrity, debit=credit validation, balance checkpoints (B4), and money-type enforcement. The DB is the final guarantor (consistent with B1: DB is the final layer). |
| **Backend services** | Own the **canonical calculation contract** — compute line amounts, totals, allocations, postings using the shared Money rules. Backend results are what get posted. |
| **Frontend (web)** | **Display and input only.** May show provisional totals using the same documented rules for UX, but never originates an authoritative posted amount; the backend recomputes and is authoritative. |
| **Offline mobile clients** | Use the **identical canonical Money rules** (same scale, same half-up, same boundaries) so offline-computed provisional amounts match the server. On sync, the **server recomputes and is authoritative** (§7). |

Single source of truth: one documented Money calculation contract (§9) is the reference all layers implement; divergence between layers is a defect.

## 6. Accounting integrity rules

- **Journal precision:** every `journal_line` debit/credit is scale-2 decimal; `(amount, currency_code)` (PHP in V1).
- **Debit = credit equality:** validated as **exact** equality at scale 2 (`Σ debits − Σ credits = 0.00`), not approximate/epsilon comparison (float epsilon checks are prohibited — a consequence of §1). Unbalanced entries cannot post (`22.05`).
- **Inventory valuation:** unit_cost at scale 4, extended cost = round(qty × unit_cost) to scale 2 at the movement line; balances are sums of movement lines (compute-from-history, with B4 checkpoints).
- **Cost allocation / production costing:** use the §4 largest-remainder allocation so allocated costs sum exactly to the source amount; no centavo created or lost.
- **Payroll:** gross = round(days × daily_rate) and net = gross − deductions at scale 2 (the V1 `money.ts` payroll rules, in decimal). Deductions/cash-advance math at scale 2.
- **No direct balance mutation:** financial effects flow only through journal entries (`20.22`/`26.07`); balances are derived (B4), never typed in.

## 7. Offline financial consistency

- **Identical rules offline:** offline clients compute provisional money with the same Money contract (§5) — same scale, half-up, boundaries — so the local figure matches the eventual server figure.
- **Server is authoritative at sync:** queued financial operations are **recomputed and re-validated server-side** before posting; the offline value is provisional until confirmed (consistent with `26.10`).
- **Idempotent posting:** each source operation carries a unique idempotency key so a retried sync **cannot double-post** a journal entry. (Mechanism specified in Stage B5 / P4-01; B2 mandates the property: exactly-once financial posting.)
- **Conflict handling:** financial records are never auto-merged by "preserve both"; conflicting financial operations require server re-computation and, if genuinely conflicting, human review (per B1 §7 / Stage B5). Money is never silently duplicated or averaged.

## 8. Financial testing standards (required scenarios)

1. **Float-absence test:** assert no money value is ever an IEEE-754 float end-to-end (representation test).
2. **Rounding boundary cases:** values like 55.485 → 55.49 (half-up), and quantity×price cases mirroring the V1 §12 examples (₱120/kg → ₱108.00/kg; 1.2 kg → ₱129.60).
3. **No-drift volume test:** thousands of rounded lines summed → total equals exact sum of lines (no accumulated error).
4. **Allocation test:** split a rounded total N ways → parts sum exactly to the total (largest-remainder).
5. **Debit=credit exactness:** balanced and deliberately-unbalanced entries; unbalanced must be rejected.
6. **Cross-layer determinism:** backend, frontend-preview, and offline produce identical amounts for the same inputs.
7. **High-decimal quantities:** scale-3 quantities × scale-4 prices round correctly to scale-2 amounts.
8. **Multi-branch:** per-branch postings aggregate to correct company totals.
9. **Future FX (dormant):** original vs base amount + rate preserved; historical entry unchanged after a later rate change.

These extend the V1 §12 verification tests into the enterprise schema (re-expressed against `journal_lines`/`financial_accounts`).

## 9. Implementation guidance (design only)

- **Single Money type alias:** define one logical "Money" type (decimal, scale 2, currency-tagged) and one "Rate"/"Quantity" precision standard; all tables and services reference these so precision cannot diverge. No ad-hoc numeric columns for money.
- **One calculation contract:** a single documented set of money functions (line amount, total, discount, tax, allocation, gross/net) — the V3 successor to `money.ts`, in decimal — is the only place money math is defined; all layers call it.
- **Naming:** monetary columns end in a consistent suffix (e.g. `_amount`); rate/qty columns distinct (`_rate`, `_qty`) so type is obvious.
- **Validation:** a check that every monetary column uses the canonical Money type/scale (CI guard, analogous to B1's "RLS enabled on every table" check); reject float-typed money.
- **Testing:** §8 scenarios are a mandatory financial test gate before any accounting module ships (Stage D/E).
- **No code now:** this document defines contracts and standards; PHP/SQL/schema are produced in implementation stages.

---

## 10. Findings resolved / dependencies

- **P3-01** (money precision & currency) → **Resolved (Stage B2)**: §2 (types/precision/scale), §3 (currency architecture, PHP-only V1 + multi-currency-ready), §4 (rounding/no-drift), §6 (accounting integrity, exact debit=credit).
- **Dependencies forward:** **B4** owns the derived-balance checkpoint/materialization mechanism (the stored-`current_balance` contradiction is forbidden here, mechanism there — P4.5-03). **B5** owns idempotent posting + financial conflict resolution (P4-01) — B2 mandates exactly-once as a property. **B3** indexes the financial tables for scale.
- **No contradictions** introduced with `20.22`/`20.24`/`22` — this spec supplies the precision those documents omitted and resolves the stored-balance ambiguity by deferring the mechanism to B4.
