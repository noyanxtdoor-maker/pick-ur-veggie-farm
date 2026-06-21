# Stage D — Phase 1 Architectural Design Specification (ADS)

**Type:** Phase 1 assembly / synthesis artifact (navigation blueprint) · **Status:** In force (assembly; no implementation)
**Date:** 2026-06-21 · **Branch:** `feature/phase-0-foundation`
**Assembles:** [B1](Stage_B1_RLS_Specification.md), [B6](Stage_B6_Audit_Immutability_and_Integration_Contracts_Specification.md), [B7](Stage_B7_Authentication_Hardening_and_Disaster_Recovery_Specification.md), [C5](Stage_C5_Enterprise_Testing_Architecture.md), [C6](Stage_C6_CI_CD_Quality_Gates_and_Automated_Architecture_Enforcement.md), [C7](Stage_C7_Engineering_Constitution.md), [C8 §4](Stage_C8_Enterprise_Implementation_Sequence_and_Construction_Roadmap.md), ADR-001 / ODR-001…005.

## 0. Authority & Purpose

This document **assembles already-approved Stage D Phase 1 architectural decisions**. It has **no independent architectural authority**. The authoritative sources remain:

- ADR / ODR decisions.
- B-series architecture specifications (B1, B6, B7).
- C-series engineering controls (C4–C8).

If this document conflicts with a higher-authority document, **the higher authority is correct and this document must be corrected.** This ADS records and connects approved decisions; it does **not** redefine security, identity, RLS, audit, or governance. It contains **no** schema, SQL, migrations, RLS policy code, function code, API contracts, UI, or implementation sequencing.

## 1. Phase 1 Purpose and Scope

Phase 1 establishes the **minimum irreversible security foundation** required before any ERP business module can safely exist (C8 §2/§4). It is built minimum-first and exits only when the §8 gates pass.

**Includes:** identity foundation · authentication foundation · tenant boundaries · authorization engine · RLS security boundaries · immutable audit foundation.

**Excludes:** Inventory · Production · Sales · Purchasing · Accounting · Reporting · Analytics · AI · mobile-specific features · employee-management UI · OAuth implementation · MFA enforcement implementation · administrative recovery workflows. (Each is architecture-compatible and added later; none is precluded.)

## 2. Canonical Security Chain

```
Supabase Auth → ERP User → Account Status → Company Membership → Branch Membership
  → Role Assignment → Permission Resolution → RLS Enforcement → Business Data
```

Single owner of each transition (no ambiguity):

| Transition | Single owner | Responsibility |
|---|---|---|
| Provider → identity | Supabase Auth (GoTrue) | credentials, password hash, OAuth links, MFA factors, sessions, `auth.uid()` |
| Identity → ERP user | ERP **User** (links the stable Supabase auth identity) | business identity; **not** credentials |
| Account status + membership + permission | **one centralized permission resolver** (security-definer) | derives tenant context server-side; returns permissions only when status = Active and membership is valid |
| Company / Branch boundary | **Company** / **Branch** | tenant root / sub-tenant scope |
| Role assignment | **User-Branch-Role** | tenant- and branch-scoped authority; multi-company membership |
| Enforcement | **RLS policies** (deny-by-default) | call the resolver; never re-derive permissions |
| Business data | each module (Phase 2+) | inherits tenant + permission + RLS + audit |

Identity, tenant, and permission context are derived **server-side**; client-supplied claims are never trusted (B1 §3).

## 3. Phase 1 Locked Entity Set

**Required (Phase 1):** Company · Branch · ERP User · User-Branch-Role · Role · Permission · Role-Permission · Audit Event.

| Entity | Owns | Does not own |
|---|---|---|
| **Company** | tenant root; company-scoped ownership | branch operations |
| **Branch** | branch-scoped operational ownership | company-global data |
| **ERP User** | business identity, account status, tenant memberships | passwords, auth secrets, OAuth credentials, MFA factors (all owned by Supabase Auth) |
| **User-Branch-Role** | the user ↔ (company, branch, role) assignment | permission definitions |
| **Role** | a named grouping of permissions (assignment unit) | the authorization decision |
| **Permission** | the authorization enforcement key | display labels |
| **Role-Permission** | the role → permission mapping | identity / tenancy |
| **Audit Event** | the immutable, attributable security-history record (canonical, B6 §3) | analytics, reporting, general logging |

**Deferred** (safe to add later — *why safe* · *condition for redesign-free addition*):

| Deferred item | Why safe to defer | Condition that keeps future addition redesign-free |
|---|---|---|
| User Permission Overrides | Break-glass / temporary grants unused by a single Owner; not on any other entity's critical path | Permission evaluation is centralized in **one resolver**; overrides union there later — roles, permissions, RLS, tenant model unchanged |
| Invitation system | No employees yet | Zero-trust onboarding (§4): an authenticated identity has no access until membership is explicitly granted |
| Employee management | No employees yet | Built on the same User / User-Branch-Role entities — additive |
| OAuth implementation | Provider is isolated from ERP identity | ERP User keys on the **stable** Supabase auth identity; provider linking enabled when OAuth lands → no duplicate identities |
| MFA enforcement implementation | MFA attaches to the auth layer | Supabase supports MFA factors without changing tenant/authz; enforce for privileged roles before production |
| Advanced account states (Locked/Dormant/Archived) | Active/Suspended cover immediate revocation | Status is a single attribute the resolver reads; additional states extend it without schema redesign |
| Administrative recovery systems (admin-assisted / super-admin) | Require privileged-access/break-glass + multi-user reality | Built on the same identity + audit + resolver foundation — additive (B7 §5) |

## 4. Permanent Security Invariants

- **Authentication ≠ Authorization.** A valid authentication identity grants no ERP access. An authenticated user without membership has **zero permissions** and receives **no tenant information** (orphan = sees nothing).
- **Tenant invariant.** Every operational record ultimately belongs to a **Company** and, when applicable, a **Branch**. No orphan business records.
- **Permission invariant.** **Permissions are the authorization authority; roles are grouping mechanisms.** Role names must never be used as security decisions. Forbidden forever: `if (user.role === "Owner") allow()`.
- **Account lifecycle invariant.** Account status participates directly in authorization. Minimum Phase 1 states: **Active**, **Suspended**. Removing roles is **not** equivalent to suspension (suspension cuts existing access on the next request and is audited as one clear event).
- **Audit invariant.** Security events are captured **at the moment they occur**; audit records are **append-only** (never updated, never deleted, always attributable).

## 5. Bootstrap One-Time Invariant

The initial tenant bootstrap may execute **exactly once**. It requires an **authenticated owner identity** (the owner creates their own authentication identity — there are **no default credentials**), and it:

- creates **Company #1**,
- creates **Branch #1**,
- creates the initial **Owner permission set**,
- creates the **Owner membership** (User-Branch-Role),
- records **immutable audit events**.

After completion:

- the bootstrap path **permanently disables itself**,
- **no second bootstrap** may ever create ownership,
- **no default credentials** may exist,
- ownership is **never** granted by being the first registrant.

## 6. Single Authorization Source Invariant

**All authorization decisions originate from the centralized permission resolver.** RLS policies, APIs, services, background jobs, and future AI agents must use the **same** authorization source.

**Forbidden:** role-name authorization · duplicate authorization logic · client-side authorization decisions · independent permission calculations (e.g., an RLS policy or API deriving permissions on its own).

## 7. Phase 1 Destruction-Test Decisions (Rationale Record)

*Decision → Reason → Authority.*

- **Permission Overrides deferred** → can be added later by extending the centralized permission resolver without changing RLS philosophy or tenant architecture → **B1 + C7**.
- **OAuth deferred** → authentication providers are isolated from ERP identity through the stable Supabase authentication identity relationship → **B7**.
- **MFA enforcement deferred** → MFA attaches to the authentication layer and can be enforced later without changing tenant or authorization architecture → **B7 / ODR-003**.
- **Invitation workflow deferred** → zero-trust onboarding allows authenticated identities with no ERP access until explicit membership exists → **B1**.
- **Reduced account lifecycle (Active/Suspended)** → these provide the minimum security states required for immediate access revocation → **B1, B7**.

## 8. Security Exit Gates

Phase 1 is complete only when these are provable (the correctness guarantee, independent of branch protection — C5 §3, B1 §9, C6 §3):

- Cross-company access denial.
- Cross-branch access denial.
- No existence leakage (denied access returns no information).
- Orphan authenticated users receive no ERP access.
- Suspended users lose access (on next request).
- Permission checks are enforced.
- Role names never grant authorization.
- Audit records cannot be modified.
- Audit records cannot be deleted.
- Every operational table has RLS enabled.

## 9. Forward Compatibility

Future growth (more farms, employees, countries, identity providers, government audits, external integrations, AI agents) is accommodated by **adding data, not replacing foundations**:

- More **companies, branches, roles, permissions, providers, modules** — all rows / additive mappings / linked providers.
- **No** new tenant architecture · **no** new identity architecture · **no** new authorization architecture · **no** new audit model · **no** RLS replacement.

The system scales by adding data and policies; the foundations remain unchanged.

## 10. Locked Design Registry note

This ADS is an assembly artifact and is **not** entered into the Locked Designs Registry (`13.02`) — it must not become a competing authority. The following are **candidate locked Phase 1 decisions**, referencing their higher authorities and changeable only via the locked-design change process (`13.05`):

- **Bootstrap One-Time Invariant** (§5) — basis: B7 §2, B1.
- **Single Authorization Source Invariant** (§6) — basis: B1 §1/§3, C7 §2, ADR-001 D3.

---

**Phase 4 readiness note:** the Phase 1 tenant/audit foundation must be left **money-type-ready** (the B2 `Money` type, C6 §0) so financial work inherits it cleanly when Phase 4 arrives. (Recorded only; no money entities in Phase 1.)
