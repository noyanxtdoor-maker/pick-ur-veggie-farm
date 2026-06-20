# Phase 3 — Data & Security Architecture

**Phase:** 3 of 9
**Branch:** `architecture-audit`
**Date of record:** 2026-06-20
**Auditor:** Chief Enterprise Architect & System Auditor
**Method:** Read-only deep review of the security model (`11.01`–`11.05`), multi-tenant data model (`20.02`, `20.03`), accounting data layer (`20.21`, `20.22`, `20.24`, `22.05`), database rules (`19.03`), and offline sync (`20.29`). No source code modified. V1 prototype not consulted.

---

## 1. Objective

Assess whether the data and security architecture is sound enough to be trusted with real financial and personal data: tenant isolation, RBAC enforcement, audit integrity, privacy, money correctness, and offline-data protection.

## 2. Strengths confirmed (credit where due)

The audit challenges assumptions, but several parts of this layer are genuinely well-designed and should be preserved:

- **Branch-Aware RBAC (`11.01`)** — Company→Branch→User→Role→Permission, least privilege, multi-level enforcement (UI / API / RLS), temporary permissions with expiry, audited permission changes, and an explicit "nothing may bypass BA-RBAC" rule.
- **Ledger discipline (`20.22`, `22.05`, `20.24`)** — balanced-only journals, posted entries never deleted (reversal/adjustment only), no backdating in locked periods, "no financial event directly changes account balances — all through journal entries," and "cash balances computed from transaction history, manual changes prohibited."
- **Audit policy (`11.04`)** — tamper-resistant intent, before/after values, non-repudiation, branch-aware audit visibility, AI-action auditing, offline-action audit with preserved original timestamps.
- **Session/device management (`11.05`)** — risk-based session expiration, device trust tiers, re-auth for high-risk actions, remote session termination, offline branch-lockout ("no new branches while offline"), and data removal after account revocation.

These raise the floor. The findings below are where the layer is incomplete or internally contradictory.

---

## 3. Findings

### P3-01 — Monetary precision and currency are unspecified at the data layer
- **Severity:** High
- **Status:** Open
- **Description:** Money columns carry no data type or scale: `journal_lines.debit_amount` / `credit_amount` (`20.22`) and `financial_accounts.current_balance` (`20.24`) are listed without `NUMERIC(p,s)` or any precision/rounding rule. No rounding standard is defined anywhere (the V1 locked rule "round half-up to 2 decimals" is not carried into V3). Multi-currency is declared (`branches.currency`, `financial_accounts.currency`) but `journal_lines` has **no currency or exchange_rate field**, so the ledger cannot represent or consolidate multiple currencies. Additionally, `financial_accounts` stores a `current_balance` field, contradicting the same document's rule that "balances shall be calculated from transaction history."
- **Business Impact:** Money is the product of an ERP. Floating-point or unscaled money columns cause rounding errors and unbalanced ledgers; a stored balance that drifts from transaction history produces wrong financial statements — the owner's "if I lose data/money, I'm dead" failure mode.
- **Security Impact:** Financial integrity is a security property; undefined precision enables silent value corruption that audit trails (storing the same wrong numbers) will not catch.
- **Scalability Impact:** At millions of journal lines across hundreds of branches and multiple currencies, precision/FX ambiguity compounds into material consolidation errors.
- **Technical Risk:** Implementers may default to `float`/`double` or app-side rounding that differs per call site; multi-currency consolidation becomes impossible without per-line currency + rate.
- **Recommended Enterprise Solution:** Specify all monetary columns as `NUMERIC(18,2)` (or a documented scale), define a single canonical rounding function (port V1's `round2`, half-up), add `currency_code` and `exchange_rate`/`base_amount` to `journal_lines`, and make stored balances either strictly derived (materialized view / computed) or reconciled with an enforced invariant. Document a "money rules" specification analogous to V1 §7.
- **Related Documents:** `20.22`, `20.24`, `20.21`, `22.05`, `22.22`, and the multi-currency notes in `20.02`.
- **Recommended Priority:** High — settle before the accounting schema is implemented.
- **Future Action Required:** Author a canonical money/precision/currency spec; ratify scale and FX model (owner input on multi-currency scope).

### P3-02 — Row-Level Security is the named "final authority" but is never specified
- **Severity:** High
- **Status:** Open
- **Description:** `11.01`, `11.03`, `20.02`, and `20.03` all declare Supabase RLS the "final authority" / "database always final authority," yet **no document specifies a single RLS policy**: how `company_id`/`branch_id` are derived from the JWT/session, how `user_branch_roles` and `user_permission_overrides` are evaluated inside a policy, how `account_status` (Suspended/Locked) is enforced at the row level, or how policies are written per table. The hardest and most security-critical part of Supabase multi-tenancy is asserted, not designed.
- **Business Impact:** The entire tenant-isolation guarantee rests on an undesigned mechanism; without a policy spec, implementation will improvise, risking cross-tenant data leakage.
- **Security Impact:** Critical. If RLS is the last line of defense and it is unspecified, the system can ship with policies that are missing, permissive, or inconsistent across tables — the classic multi-tenant breach vector.
- **Scalability Impact:** RLS policies that join `user_branch_roles` on every query have major performance implications at millions of rows / thousands of users (handed to Phase 4.5); designing them late forces a security-vs-performance retrofit.
- **Technical Risk:** Per-table policy drift; tables created without RLS enabled; `service_role` keys bypassing RLS in server code without compensating checks.
- **Recommended Enterprise Solution:** Produce an RLS design spec: standard JWT claims (`company_id`, allowed branch set, role), a reusable policy template for branch-scoped tables, explicit policies for read/insert/update/delete, a rule that every operational table has RLS enabled by default (deny-by-default), and a documented stance on `service_role` usage. Add automated tests that attempt cross-tenant access.
- **Related Documents:** `11.01`, `11.03`, `20.02`, `20.03`, `19.03`; performance link to Phase 4.5.
- **Recommended Priority:** High — RLS design must precede schema implementation.
- **Future Action Required:** Author RLS policy specification; define deny-by-default standard.

### P3-03 — Role taxonomy is fundamentally inconsistent across layers
- **Severity:** High
- **Status:** Open
- **Description:** The enterprise security layer defines nine roles — Developer, Owner, Co-Owner, General Manager, Corporate Accountant, Branch Supervisor, Operator, Worker, Local Staff (`11.01`, `20.03`) — while the canonical project overview (`16.01`) lists five — Owner, Co-owner, Admin, Operator, Employee. The sets are incompatible: `Admin` (canonical) is absent from the security model; `Employee` (canonical) becomes `Worker`; and Developer/General Manager/Corporate Accountant/Branch Supervisor/Local Staff appear only in the security layer. This is the concrete, security-critical manifestation of P2-01/P2-03.
- **Business Impact:** There is no single answer to "what roles exist," so permission assignment and org modeling are ambiguous from the outset.
- **Security Impact:** A permission matrix cannot be authoritative when the role set itself differs by document; aliasing (`Admin` vs none; `Employee` vs `Worker`) risks duplicate roles with divergent privileges.
- **Scalability Impact:** Divergence worsens as HR (`21.04`) and modules add role-like terms across branches.
- **Technical Risk:** Seed data / enums may be built from the wrong list; migrations later needed to reconcile.
- **Recommended Enterprise Solution:** Ratify one canonical role set (the `11.01`/`20.03` nine-role model is the most complete and branch-aware — recommend it as canonical), retire the `16.01` list or map it explicitly, and define system-roles vs HR job-titles per P2-03. Encode roles as seed data referenced everywhere.
- **Related Documents:** `11.01`, `20.03`, `16.01`, `21.04`, `26.09`, `06.01`.
- **Recommended Priority:** High.
- **Future Action Required:** **Owner ratification** of the canonical role set (joins the strategic decision cluster).

### P3-04 — RLS cannot enforce "active-branch" scoping (final-authority claim overstated)
- **Severity:** Medium
- **Status:** Open
- **Description:** Permissions are described as depending on the user's *active branch* (`11.01`, `11.05`: session holds "current active branch"; "verify permissions every time the active branch changes"). But RLS is stateless and sees only JWT claims, not the application's mutable "active branch." If the token carries all authorized branches, RLS can enforce *authorized-branch* isolation but **not** *single-active-branch* scoping — so the active-branch restriction is only UI/API-enforced, despite the repeated claim that the database is the final authority.
- **Business Impact:** A subtle gap between the stated guarantee and what the final layer can deliver; could surface as a multi-branch user seeing more than the "active branch" implies if app-layer checks are bypassed.
- **Security Impact:** Medium — authorized-branch isolation (the critical boundary) still holds at the DB; only the finer active-branch scoping depends on app/API correctness.
- **Scalability Impact:** Token bloat if all branch roles are embedded for users with many branches; re-issuing tokens on branch switch adds complexity.
- **Technical Risk:** Inconsistent enforcement if some queries rely on "active branch" not present in RLS context.
- **Recommended Enterprise Solution:** Decide explicitly where active-branch scoping is enforced (API layer with mandatory branch filter + RLS authorized-branch backstop), or carry active-branch as a request-scoped claim (e.g. set per-transaction `SET LOCAL` GUC consumed by RLS). Document that RLS guarantees authorized-branch isolation; active-branch is an API responsibility.
- **Related Documents:** `11.01`, `11.05`, `20.03`, and the RLS spec from P3-02.
- **Recommended Priority:** Medium.
- **Future Action Required:** Define active-branch enforcement layer in the RLS spec.

### P3-05 — Audit immutability is policy without a specified enforcement mechanism
- **Severity:** Medium
- **Status:** Open
- **Description:** `11.04` states audit records "shall never be edited or deleted by ordinary users" and are "tamper-resistant," but no mechanism is specified (append-only table, DB triggers blocking UPDATE/DELETE, RLS denying mutation, WORM storage, hash-chaining). "Only highly restricted system maintenance procedures may archive" leaves an undefined privileged path. The audit schema is also fragmented across `11.04` (policy), `20.28` (table), and `10.04` (architecture) with no single canonical definition (ties P2-01).
- **Business Impact:** "Tamper-resistant" without an enforcement design is aspirational; audit evidence may be alterable in practice.
- **Security Impact:** Non-repudiation depends on true immutability; an unspecified privileged archive path is an integrity hole.
- **Scalability Impact:** Audit volume at millions of records needs a defined retention/partition/archival mechanism (links Phase 3.5/4.5).
- **Technical Risk:** Implementers may use a normal table with no write protection, making "immutable" untrue.
- **Recommended Enterprise Solution:** Specify enforcement: append-only audit table with DB triggers/RLS denying UPDATE/DELETE for all app roles, optional hash-chaining for tamper evidence, a single canonical audit schema, and a defined, audited archival procedure. Consolidate `11.04`/`20.28`/`10.04`.
- **Related Documents:** `11.04`, `20.28`, `10.04`, `13.05`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Author immutability enforcement spec; consolidate audit schema.

### P3-06 — Offline cache protection is optional, not mandatory
- **Severity:** Medium
- **Status:** Open
- **Description:** Offline data protection is hedged: `20.29` says devices "maintain encryption *when possible*"; `11.05` lists "encrypted local storage" only under "protection mechanisms *may include*." Yet offline caches on BYOD devices (`25.09`) hold financial records and confidential PII (salaries, government IDs, tax info per `11.03`). Additionally, the financial conflict-resolution strategy is named ("stricter handling for financial records") but not designed (no LWW / merge / versioning policy) — deferred analysis in Phase 4.5.
- **Business Impact:** A lost/stolen field tablet could expose company financial and employee PII if encryption is best-effort.
- **Security Impact:** Confidential PII at rest on personal devices without mandatory encryption is a material data-protection failure.
- **Scalability Impact:** More branches/field devices multiply the exposed-cache surface.
- **Technical Risk:** "When possible" invites implementations with unencrypted local stores (e.g. plain IndexedDB).
- **Recommended Enterprise Solution:** Make at-rest encryption of the offline cache **mandatory** for any device holding financial/PII data, define a minimum scope of cached sensitive data, and require remote-wipe on revocation (partially present). Design the financial conflict-resolution policy explicitly (carried to Phase 4.5).
- **Related Documents:** `20.29`, `11.05`, `11.03`, `25.09`, `25.10`.
- **Recommended Priority:** Medium (raise to High for BYOD financial deployments).
- **Future Action Required:** Mandate offline encryption; design conflict resolution (Phase 4.5).

### P3-07 — Authentication hardening gaps and an unconstrained global superuser
- **Severity:** Medium
- **Status:** Open
- **Description:** MFA is deferred to "future support" in both `11.05` and `20.03`. No password policy is specified (minimum length, complexity, rotation, reuse prevention), and no explicit account-lockout threshold is defined (failed logins are "detected" and "may trigger temporary restrictions," but no policy). The global **Developer** role (`11.01`) has "full system access, database administration, security configuration" and branch-creation authority (`20.02`) with no separation-of-duties, break-glass, or enhanced-audit controls, and no statement of whether it bypasses RLS — a potential contradiction with "nothing bypasses BA-RBAC."
- **Business Impact:** Weak authentication and an unconstrained superuser are the highest-likelihood breach vectors for a financial system; they also complicate any future compliance posture.
- **Security Impact:** No MFA on financial/admin access, undefined password strength, and a full-access global role together represent significant residual risk.
- **Scalability Impact:** A single all-powerful Developer role across all tenants becomes more dangerous as the number of companies/branches grows.
- **Technical Risk:** Implementers may ship without MFA and with weak password defaults; the Developer role may be granted RLS-bypassing `service_role` access undocumented.
- **Recommended Enterprise Solution:** Require MFA at least for privileged/financial roles at launch (not "future"); define a password policy; define a lockout threshold; constrain the Developer role with separation of duties, mandatory enhanced auditing, time-boxed/break-glass elevation, and an explicit RLS stance. 
- **Related Documents:** `11.05`, `20.03`, `11.01`, `11.04`, `20.02`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Auth-hardening spec; Developer-role governance decision (owner input).

---

## 4. Phase 3 summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 3 |
| Medium | 4 |
| Low | 0 |
| Improvement Opportunity | 0 |

**Headline:** The security *intent* is strong — Branch-Aware RBAC, ledger discipline, audit non-repudiation, and session/device management are well-conceived. The weaknesses are at the **enforcement and precision layer**: the database "final authority" (RLS) is never actually specified (P3-02); money has no defined precision, rounding, or currency representation (P3-01); and the role set the security model is built on contradicts the canonical role list (P3-03). These are exactly the gaps that must be closed before a single accounting or permission table is created. No Critical findings, but P3-01 and P3-02 are the most consequential High findings in the audit so far because they sit under everything else.

**Strategic-decision cluster update:** P3-03 (canonical role set) joins P1-01, P1-02, P2-01, P2-02 for Phase 7 ratification.
**Cross-phase links:** RLS performance, audit-volume retention, and offline conflict-resolution at scale hand off to Phase 3.5 (lifecycle/DR) and Phase 4.5 (scalability).

**Next phase:** Phase 3.5 — Enterprise Data Lifecycle & Disaster Recovery.
