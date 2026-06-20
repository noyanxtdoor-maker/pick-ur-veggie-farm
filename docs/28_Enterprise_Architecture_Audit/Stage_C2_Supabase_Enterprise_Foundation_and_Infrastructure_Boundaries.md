# Stage C2 — Supabase Enterprise Foundation & Infrastructure Boundaries

**Type:** Stage C engineering-preparation artifact (binding design spec) · **Status:** In force (design); provisioning in implementation
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Authority basis:** `17.01`/`17.03` (platform), B1, B5, B6, B7, Section 26 (ownership), [C1](Stage_C1_Development_Environment_and_Toolchain.md), [C4](Stage_C4_Repository_Git_Governance.md), [C6](Stage_C6_CI_CD_Quality_Gates_and_Automated_Architecture_Enforcement.md), [C7](Stage_C7_Engineering_Constitution.md), ADR-001, ODR-001…005.
**Scope note:** design specification only. **No Supabase projects, local init, migrations, SQL, Edge Functions, API routes, secrets, `package.json` edits, dependencies, or source changes.**

> B1–B8 defined *what the ERP must guarantee.* C7 defined *what developers must never violate.* C6 defined *how violations are blocked.* **C2 defines *where every piece of responsibility lives*** — so the answer to *"who owns this decision, where is it enforced, who may bypass it?"* is always clear. (`17.03` is a foundation-layer stub; C2 supplies the enterprise substance.)

---

## 0. The five assumptions this document rejects

1. **"Supabase Auth means the user is authorized." — FALSE.** Authentication ≠ authorization. A valid login proves identity only; access comes from the ERP RBAC model + RLS (§3).
2. **"RLS alone solves security." — FALSE.** Security = authentication **+** permissions **+** RLS **+** backend validation **+** audit (§5–§8). RLS is the final boundary, not the whole defense.
3. **"The frontend can safely enforce business rules." — FALSE.** The client is an **untrusted** environment; it never makes a final decision (§5).
4. **"Service role is an admin shortcut." — FALSE.** It is the **most dangerous credential** in the system and gets the strictest governance (§7).
5. **"Offline data can be trusted when syncing." — FALSE.** Every synchronization is **revalidated server-side** (§9, B5).

These are restated as binding rules throughout.

## 1. Environment architecture

| Environment | Purpose | Allowed data | Isolation | Access | CI/CD relation |
|---|---|---|---|---|---|
| **Local development** | Build/test on a dev machine | Synthetic only (C1 §6) | Own local/ephemeral Supabase or Postgres | Individual developer | Pre-push local loop (C1 §8) |
| **Testing** | Automated test execution | Synthetic fixtures | Dedicated, disposable | CI service identity | C6 integration/security gates run here |
| **Staging** | Pre-production verification, UAT, DR drills | Synthetic / anonymized | Separate Supabase project | Limited team | Deploy candidate before production |
| **Production** | Live operations | Real business data | Separate Supabase project; strictest controls | Least-privilege, audited | Tagged release only (C4 §8) |

**Hard rule:** **production data must NEVER be copied into local developer (or testing) environments** (C7 §3 / C1 §7). Lower environments use synthetic data only; anonymized snapshots, if ever needed for staging, follow B7 + a documented approval.

## 2. Supabase project separation

- **Separate Supabase project per environment** — local/test/staging/production are distinct projects with distinct keys. No environment can reach another's data.
- **No shared production credentials**; **no development access using production secrets**; environment-specific configuration only.
- **Key purposes:**
  - **Anonymous (anon) key** — public, client-side; grants only what RLS allows; carries **no privilege by itself** (RLS still governs every row). Safe to ship in the client.
  - **`service_role` key** — bypasses RLS; **server-side only**, strictest governance (§7); never in the client/repo.
- **Secret storage:** keys live in environment/secret stores per tier (C1 §3, §11), never in source control (`.gitignore` already excludes `.env*`).

## 3. Authentication ownership (auth ≠ authz)

```
Supabase Auth (identity, auth.uid())
        ↓
ERP User Profile (users.auth_user_id, account_status)
        ↓
Company / Branch Membership (user_branch_roles)
        ↓
Role → Permissions (role_permissions, overrides)
        ↓
RLS Enforcement (final data boundary)
```

- **Supabase Auth owns identity only** (credentials, sessions, MFA per B7/ODR-003). It does **not** grant data access.
- **Authorization is the ERP's:** company/branch membership + permissions, enforced by RLS (B1) and backend validation (§5/§8). A logged-in user with no `user_branch_roles` assignment sees nothing.
- **Keys on permissions, never role-name strings** (B1/C7 §2). `account_status` must be Active (B1).

## 4. Database ownership philosophy

- **Supabase PostgreSQL is the system of record** (B4 Level-1 truth).
- **Direct database access is highly controlled** — application code reaches data through the repository/service layer (C1 §5) under RLS, not ad-hoc queries.
- **Every table has a clear owning module** (B6 §5 / Section 26 / `26.08`); a module never writes another module's tables (B6/C7 §8) — cross-module effects flow through **integration contracts/events** (B6 §4–§6).
- **The database is not a shared dumping ground** — schemas are owned, normalized, RLS-protected (B1), indexed/partition-ready (B3), and money-typed (B2).

## 5. Client vs server responsibilities

| Client (untrusted) | Server (authoritative) |
|---|---|
| User interface | **Final authorization** (RLS + permission checks) |
| Offline storage (authorized branch scope, B5) | **Data validation** (business rules) |
| Temporary local state / provisional calculations (B2 rules for display) | **Financial integrity** (posting, debit=credit, B2) |
| User interactions | **Audit creation** (B6, append-only) |
| | **Cross-module rules** (B6 contracts) |

**No client is ever the final authority.** Provisional client results (incl. offline) are confirmed by the server before they are real (B5, B4).

## 6. RLS integration strategy (with B1)

- **RLS enabled by default; deny-by-default.** A table with RLS disabled or no policy is a defect (B1).
- **Every tenant (operational) table requires an explicit policy**; cross-company access is prohibited; branch isolation enforced.
- **Permission checks derived from the canonical RBAC** (resolved permissions, not role names — B1 §3).
- **Migration requirement:** **no table reaches production without RLS review** — the C6 migration/DB gate asserts RLS-enabled + tenant columns on every operational table (C6 §3, Tier 2). This is the concrete coupling between C2 (ownership) and C6 (enforcement).

## 7. Service-role governance (most dangerous credential)

`service_role` bypasses RLS — therefore the strictest rules:

- **Allowed:** controlled backend operations, scheduled jobs, migration tasks, administrative maintenance — all server-side, all applying equivalent tenant checks in code (B1 §9).
- **Forbidden:** client exposure · frontend storage · embedding in the app bundle · unrestricted business operations · using it to skip RLS for convenience.
- **Every service-role action has justification and is auditable** (B6) — what ran, why, when, affecting which tenant. Service-role usage is itself monitored (§13).
- Compromise of `service_role` = total tenant-isolation loss; it is treated as a top incident (B7 credential-compromise scenario).

## 8. Edge Functions & backend boundary

Not every operation belongs on the client. Classify by risk:

**Simple user operations** (read/own-scope writes with no cross-module/financial effect):
```
Client → Supabase → RLS
```

**High-risk operations** (financial/inventory/cross-module/admin):
```
Client → Backend function (Edge Function/service) → business validation → DB transaction → audit
```

Examples requiring the governed server path: **financial posting, inventory allocation, production completion, batch costing, administrative actions.** These must be: idempotent (B5 key), transactional (event + posting + snapshot commit together, B4/B6), permission-checked server-side (B1), and audited (B6). A client must not post journals or allocate stock directly.

## 9. Offline architecture relationship (with B5)

Offline devices: **store only authorized-branch data** (B1 §6); **never gain additional privileges offline** (B7); **synchronize through controlled APIs**; **are revalidated server-side on synchronization** (B5 — idempotent, authz re-checked, business-validated). **The server remains authoritative**; offline state is a provisional cache, never a source of truth.

## 10. Data lifecycle & storage

| Category | Owner | Retention philosophy | Backup (B7) |
|---|---|---|---|
| Operational data | owning module (B6) | retained per policy; archived when old | tier-appropriate |
| Financial records | Accounting (B6) | **permanent / immutable** (B2/B4) | PITR + offsite (B7) |
| Audit history | Security/audit (B6) | long-term, append-only, hold-aware | included, immutable |
| Attachments / photos | owning module + object storage | lifecycle/tiering (B3/Phase 3.5) | included |
| Temporary files | n/a | short-lived; purged | excluded |
| Cached offline data | device (provisional) | TTL; wiped on revocation (B5/B7) | not a backup source |

Large media live in **object storage**, not in-row (B3). Exact retention periods are **not fixed here** (decided per `26.15`/B7); C2 fixes ownership + philosophy, not durations.

## 11. Secret & configuration management

- **Environment variables** per C1 §3: `UPPER_SNAKE_CASE`; client vars `VITE_`-prefixed and **secret-free** (anon key only); `service_role` server-only.
- **Public vs private config separated** — anything in the client bundle is public by definition; no secret may be client-side.
- **Rotation philosophy:** privileged keys rotated on schedule and on suspicion (B7); rotation never requires a code change (config, not source).
- **No secrets in source control** — enforced by the C6 secret-scan gate (repository-validation stage).

## 12. Database change governance (hands off to C3)

**No schema change reaches production without:** migration history · review (C4 risk-classified; schema = High) · testing (C5 gates) · architecture compliance (C6: RLS-enabled, money-typed, audit-append-only). **C2 defines ownership; C3 will define the migration process.** Until C3, no migrations are authored.

## 13. Observability & operational visibility

Operational **controls** (not optional diagnostics), to be wired during implementation: authentication monitoring; failed access attempts; **RLS violation / cross-tenant attempts**; sync failures + dead-letter depth (B5); database errors; performance metrics (B3 §9 budgets); security events (B6/B7). These feed incident response (B7 §7) and the C6 governance dashboards.

## 14. Failure & disaster boundaries (with B7)

- **Production recovery** via PITR + encrypted offsite backups (B7 §8–§11); **tenant-scoped restore** supported.
- **Backup restoration authority** is restricted, separated from deletion, and audited (B7 §8); restores never edit history (B4).
- **Environment isolation during incidents** — a compromised lower environment cannot reach production (separate projects, §2).
- **Emergency / break-glass access follows B7/B1 §8** exactly: time-boxed, approved, MFA, enhanced audit, auto-expiry. No new bypass is introduced by C2.

## 15. Future scalability boundaries (with ODR-005)

Intentionally **deferred until justified by measured growth:** multi-region deployment, database sharding, advanced distributed architecture, cross-region replication. The foundation stays **compatible** (clean tenant keys B1, partition-readiness B3) so these can be adopted later without redesign — but they are **not** built in V1 (ODR-005). Premature distributed complexity is forbidden.

---

## 16. Responsibility clarity (the C2 deliverable in one table)

For every decision class, C2 fixes the answer to *who owns it · where it's enforced · who may bypass*:

| Decision | Owner | Enforced at | Bypass |
|---|---|---|---|
| Identity | Supabase Auth | Auth service | none |
| Authorization (company/branch/permission) | ERP RBAC | RLS + backend validation | none (break-glass = time-boxed, audited, B7) |
| Financial posting | Accounting module | Backend function + DB transaction + audit | none |
| Data ownership | owning module (B6) | schema + ownership lint (C6) | none |
| Final acceptance of any write | Server | Backend + RLS | none (client never final) |
| Privileged maintenance | service_role (server) | server-only, justified, audited | governed only (§7) |

## 17. Consistency, findings & status

Reviewed against ADR-001, ODR-001…005, B1–B8, C1/C4/C6/C7, Section 26: **no new architectural authority, no contradictions** — C2 localizes responsibilities already defined and supersedes the `17.03` stub with enterprise substance.

**Findings:** C2 **defines** the Supabase foundation boundaries that finding **P5-05** (enterprise prerequisites not scaffolded) requires, but does **not scaffold** them (no projects created) — so P5-05 remains **Open** (closes when the foundation is provisioned in implementation). No finding status changed.

**Verification:** documentation only — no Supabase projects, migrations, SQL, Edge Functions, secrets, config, or source changes.

**Next:** C3 — Database Migration Governance (the process for safely creating the schema these boundaries own), then C8 — Enterprise Implementation Sequence.
