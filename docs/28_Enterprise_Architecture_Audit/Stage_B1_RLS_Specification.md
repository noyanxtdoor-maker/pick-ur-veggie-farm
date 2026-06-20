# Stage B1 — Enterprise Row Level Security (RLS) Specification

**Type:** Stage B foundation specification (security) · **Status:** Specification complete (design only)
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Resolves:** findings **P3-02** (RLS declared final authority but unspecified), **P3-04** (active-branch enforcement undefined)
**Authority basis:** [ADR-001](ADR_001_Architecture_Ratification.md); ODR-001…005. **Subordinate to** Section 11 (Security), Section 20 (Schema), Section 26 (Integration) — this spec consolidates and makes enforceable what those declare.
**Scope note:** architecture documentation only. **No SQL, migrations, or code.**

---

## 0. Assumptions challenged

- **Role names are not a stable key.** `26.09` lists Administrator/Accountant/Supervisor; `11.01`/`20.03` list General Manager/Corporate Accountant/Branch Supervisor/Local Staff. Per ADR-001 Decision 3 / A3, **RLS keys on resolved permissions and tenant claims, never on role-name strings.** (Residual role-name variance between `26.09` and `11.01` is a minor doc cleanup, not an RLS dependency.)
- **"RLS is the final authority" was true in intent, false in specificity** (P3-02). This document makes it real.
- **"DB is final authority for active branch" is overstated** (P3-04). RLS can enforce *authorized-branch* isolation absolutely; *active-branch* narrowing is a request scope, not a DB-resident fact. This spec separates the two.

---

## 1. Security philosophy

1. **The database is the final enforcement layer.** Application/API permission checks are a usability and performance layer, **not** the security boundary. Every row access is independently evaluated by RLS.
2. **Deny by default.** Every operational table has RLS **enabled**; absence of a matching policy = no access. A table without RLS is a defect.
3. **Zero trust** (per `26.09`): being authenticated, or inside the company, grants nothing by itself. Identity + tenant membership + permission + account status are evaluated on every request.
4. **Defense in depth:** UI hides → API validates → **RLS enforces**. The first two may be bypassed; the third may not.

## 2. Multi-tenant isolation model

Tenancy is hierarchical: **Company → Branch → User-Branch-Role → Permission** (per `11.01`, `20.02`). Every operational row carries `company_id` and (where branch-scoped) `branch_id` (`20.01` rule).

| Boundary | Rule |
|---|---|
| Company isolation | A user may only access rows whose `company_id` is one of the user's company memberships. **No cross-company read or write, ever**, except a future explicitly-shared external-portal scope (`26.09` §9). |
| Branch isolation | For branch-owned rows, access requires an active `user_branch_roles` assignment to that `branch_id`. |
| Cross-company | Hard-prohibited at the policy layer. Consolidated multi-company views (if any) require a dedicated, separately-audited reporting path — not direct RLS cross-tenant reads. |
| Cross-branch | Allowed only for users assigned to multiple branches, and only for the branches they are assigned to. |
| Shared enterprise users | A user assigned to several branches resolves access per-branch from `user_branch_roles`; company-global roles (Owner, etc.) gain all-branch read via permission, not via bypass. |
| Super-administrator | No role silently bypasses tenant isolation. Company-wide authority (Owner/Co-Owner/GM) is expressed as **permissions** that widen scope within their own company — never across companies. |
| Developer access | The platform Developer role is the only cross-company technical role. Its access is **logged with justification** (`26.09`), time-boxable, and must **not** be the application's normal data path (see §8 and §9 `service_role`). |

**Mandatory schema invariant:** any table representing company/branch operations MUST have `company_id` (+ `branch_id` if branch-scoped). RLS for that table is non-optional.

## 3. Authentication → authorization → data access chain

```
Supabase Auth (identity, auth.uid())
        ↓
User record (users.auth_user_id → company membership, account_status)
        ↓
user_branch_roles (company_id, branch_id, role_id, active_status, expiration)
        ↓
role_permissions + user_permission_overrides → effective permission set
        ↓
RLS policy evaluates: company match · branch assignment · required permission · account_status=Active
        ↓
Allow / Deny (per row, per operation)
```

- **Identity** comes from Supabase Auth (`auth.uid()`), never from client-supplied tenant claims.
- **Tenant + permission context is derived server-side** from `users`, `user_branch_roles`, `role_permissions`, `user_permission_overrides` (`20.03`). Client tokens are not trusted to assert company/branch/permission.
- **Permissions, not roles, gate operations** (`26.09`: "permissions always have higher priority than role names").
- **`account_status` must be `Active`** for any access; `Suspended`/`Locked`/`Archived` ⇒ deny (`20.03`).

## 4. Data ownership classification

Every entity is classified; classification selects its policy category (§9).

| Class | Definition | Examples | Policy category |
|---|---|---|---|
| **Global / system** | Platform-wide reference; no tenant | Currency master, system config, reference lists | Read-all-authenticated; write Developer-only |
| **Company-owned** | Belongs to one company; all its branches may read per permission | Chart of accounts, suppliers, customers, financial settings, roles/permissions | `company_id` match + permission |
| **Branch-owned** | Belongs to one branch | Inventory, inventory movements, crop production, equipment assignments, local operational records | `company_id` + `branch_id` assignment + permission |
| **Personal** | Belongs to one user | Private calendar, personal reminders, preferences, drafts (`20.04`) | `user_id = auth.uid()` only; admins access only via audited policy exception (`20.04` privacy rule) |
| **External-shared (future)** | Explicitly shared to a portal user | Customer's own orders/invoices; supplier's own POs | Scoped to the linked external party only (`26.09` §9) |

Money fields in any class follow ODR-002 / Stage B2 (PHP-only V1, fixed precision).

## 5. RLS access patterns (acceptance scenarios)

Each must hold under policy (used as test cases in §9):

1. **Owner — all branches:** Owner reads/permits across every branch of **their** company; **denied** any other company's rows.
2. **Branch supervisor — assigned branches only:** reads/writes only branches in their `user_branch_roles`; denied unassigned branches even within the same company.
3. **Accountant — financial scope:** company-owned financial rows per `accounting.*` permissions; denied branch operational data unless separately permitted; cannot touch locked periods (`22`).
4. **Worker — field activity:** may create own attendance/work/production-activity rows for assigned branch; denied other employees' records, inventory valuation, financial reports (`26.09` Worker).
5. **Cross-company attempt:** any access to a row whose `company_id` ∉ memberships ⇒ **deny** (no error leakage of existence).
6. **Former employee (deactivated):** `account_status ≠ Active` ⇒ all access denied on next request; offline handled per §6.
7. **Active-branch narrowing (P3-04):** a multi-branch user with an "active branch" of B1 still has RLS-authorized access to all assigned branches; the active-branch restriction is **enforced at the API layer** (mandatory branch filter) with RLS as the authorized-branch backstop. Optionally, the API sets a request-scoped branch context the policy may read to narrow further — but RLS's guarantee is *authorized-branch isolation*, not *single-active-branch*.
8. **Personal data:** only the owning user reads their private workspace rows; a manager/admin does **not** (privacy rule, `20.04`) except via the audited administrative exception.

## 6. Offline security relationship (offline-first)

Aligned with `11.05`, `20.29`, `26.10`:

- **What may be cached:** only data the user is authorized to access for their **assigned branches**; never the entire accounting DB, all salaries, or company-confidential reports (`26.10` storage policy). Personal workspace data may be cached.
- **Local scoping:** cached rows retain `company_id`/`branch_id`; the local store enforces the same tenant scoping the server granted.
- **Revoked users:** no new access may be acquired offline (`11.05`); on reconnect, permission re-validation occurs and **cached data for revoked access is removed** (data-removal-after-revocation).
- **Expired sessions:** offline operation runs only within approved offline session policy; expiry forces re-authentication on reconnect or when thresholds exceed (`11.05`, ODR-003).
- **Sync validation:** every queued operation is re-evaluated by RLS **server-side** at sync time (`26.10`: "synchronization shall never bypass company, branch, or permission security"). Offline acceptance is provisional until server RLS confirms it.
- **At-rest protection:** offline caches holding financial/PII data must be encrypted (raise `20.04`/`20.29` "when possible" to mandatory for sensitive caches — carried with Stage B7; noted here as a dependency).

## 7. Audit & security events (must be logged)

Per `11.04`/`26.09`, RLS-relevant events that MUST produce immutable audit records: login (success/failure/logout), failed/denied access attempts, permission changes, role assignments/changes, branch reassignment, `account_status` changes, temporary/override grants, break-glass elevation (§8), and detected security-policy violations (cross-company/cross-branch attempts, mass export). Audit immutability mechanism is specified in Stage B6; this spec requires the events exist.

## 8. Emergency & administrative access (break-glass)

Builds on `26.09` emergency override + `11.01` temporary permissions + ODR-003 re-auth:

- **Break-glass elevation** is explicit, never implicit. No role bypasses RLS; elevation grants a **time-boxed** additional permission set via `user_permission_overrides`.
- **Requirements:** authorized initiator, documented reason, secondary approval for high-impact scopes, MFA re-authentication (ODR-003), and **enhanced audit** of every action performed while elevated.
- **Automatic expiration:** elevated privileges auto-revoke at `expiration_date`; no manual cleanup relied upon.
- **Developer cross-company access** is treated as standing privileged access: justification-logged, ideally time-boxed, never the routine application data path, and never used to silently alter financial/audit data (`26.09` restriction).

## 9. Future implementation guidance (no SQL)

For the eventual Supabase implementation (Stage C):

**Required policy categories** (one reusable template per data class, §4): global-system, company-owned, branch-owned, personal, external-shared. Each defines SELECT / INSERT / UPDATE / DELETE separately (DELETE typically denied for immutable/financial entities — corrections via reversal, per `20.01`/`26.07`).

**Naming standard (recommended):** `rls_<table>_<operation>_<scope>` (e.g. `rls_inventory_movements_select_branch`). One enabling migration per table; RLS enabled = default; deny-by-default baseline policy.

**Derivation helpers:** tenant/permission context resolved via security-definer helper functions over `user_branch_roles` + `role_permissions` + `user_permission_overrides` (keeps policies readable and consistent). Policies reference permissions, not role names.

**`service_role` discipline:** the Supabase `service_role` bypasses RLS. It is restricted to controlled server-side contexts that apply equivalent tenant checks in code; it is **never** exposed to clients and its use is audited. Bypassing RLS without compensating checks is a defect.

**Testing requirements (mandatory gate):** for every policy, **negative cross-tenant tests** (company A cannot read/write company B; branch B1 user cannot touch B2) and positive in-scope tests. Deactivated-user and expired-override tests. These become part of the Stage C/E security test suite (P4.5 performance of RLS-filtered queries validated separately under Stage B3 indexing + Phase 7 §E load tests).

**Validation requirements:** a CI check asserting **every operational table has RLS enabled** (no un-protected tenant table ships) and that each has at least the deny-by-default + scoped policies. Complements the Stage A6 doc index/link CI checks.

---

## 10. Findings resolved / dependencies

- **P3-02** (RLS unspecified) → **Resolved (Stage B1)**: §1–§9 define the policy model, derivation chain, deny-by-default, `service_role` discipline, and test/validation gates.
- **P3-04** (active-branch enforcement) → **Resolved (Stage B1)**: §5.7 — RLS guarantees authorized-branch isolation; active-branch narrowing is an API responsibility with an optional request-scoped policy hook.
- **Dependencies forward:** B2 (money precision on the financial entities referenced here), B3 (indexing for RLS-filtered queries / P4.5-01), B6 (audit immutability for §7 events), B7 (mandatory offline-cache encryption for §6). These are noted, not duplicated.
