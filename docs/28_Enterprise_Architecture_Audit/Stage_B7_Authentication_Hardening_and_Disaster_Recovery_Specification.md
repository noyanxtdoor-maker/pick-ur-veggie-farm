# Stage B7 — Authentication Hardening, Security Operations, Backup & Disaster Recovery Specification

**Type:** Stage B foundation specification (security/operations) · **Status:** Specification complete (design only)
**Date:** 2026-06-20 · **Branch:** `architecture-audit`
**Resolves:** **P3-06** (auth/privileged hardening), **P3-07** (password policy, Developer restrictions), **P3.5-01** (RPO/RTO/PITR), **P3.5-02** (backup encryption/access), **P3.5-03** (backup integrity/immutability/rotation), **P3.5-04** (restore procedure, tenant-scoped), **P3.5-05** (offline un-synced data), **P3.5-06** (DR ownership/runbook)
**Authority basis:** [ADR-001](ADR_001_Architecture_Ratification.md), [ODR-003](ODR_003_Risk_Based_MFA_Security_Policy.md), [ODR-005](ODR_005_Progressive_Scaling_Strategy.md). Consolidates Sections 11, 20, 25, 26. Builds on [B1](Stage_B1_RLS_Specification.md), [B5](Stage_B5_Idempotent_Transactions_and_Offline_Sync_Specification.md), [B6](Stage_B6_Audit_Immutability_and_Integration_Contracts_Specification.md).
**Scope note:** architecture documentation only. **No code, auth/hashing implementations, migrations, middleware, backup scripts, or infra config.**

---

## 0. Assumptions challenged

- **The V1 prototype stored plaintext passwords** (`passwordHash` = plaintext, P5-03). Hard-prohibited for V3 (§2); marked do-not-port.
- **Backups were the least-specified control** (P3.5-02): full DB + PII to Google Drive with no stated encryption/access control — the easiest exfiltration path, bypassing all in-app security. Closed in §8.
- **DR was philosophy without mechanics** (P3.5-01/04/06): right maxim ("a backup never restored is only a theory") but no RPO/RTO, restore procedure, or owner. Closed in §9–§13.
- **Developer was an unconstrained global superuser** (P3-07): full cross-company access with no separation-of-duties/break-glass. Constrained in §5.
- **Un-synced offline data had no recovery path** (P3.5-05). Addressed in §6.

**Final security principle:** Identity → Authentication → MFA → Session trust → RLS authorization → Business permissions → Immutable audit. **Never** "admin login → unlimited invisible power."

---

## 1. Authentication philosophy

**Trust is continuously verified, not assumed after login.** A valid login establishes *identity*, not *authorization* — every data access is still evaluated by RLS (B1) and permissions. Layers: **authentication** (who), **authorization** (RLS + permissions, B1), **session trust** (time/risk-bounded), **device trust** (registered/risk-scored, `11.05`), **continuous verification** (re-auth for high-risk actions, ODR-003).

## 2. Password & credential standards

| Topic | Standard |
|---|---|
| Storage | **Supabase Auth**, strong one-way hashing (e.g. bcrypt/argon2 class). **Plaintext and reversible encryption prohibited** (corrects P5-03). |
| Strength | Minimum length (≥12; passphrase-friendly); block known-breached/common passwords. Complexity guidance over forced symbol rules. |
| Rotation | **No forced periodic rotation for general users** (modern guidance — rotation breeds weak patterns); **privileged roles** (§5) reviewed/rotated on a defined cadence or on suspicion. Forced reset on compromise. |
| Reuse | Prevent reuse of recent passwords (history depth N). |
| Reset | Verified self-service flow (email/MFA); privileged resets require approval (§3). |
| Default accounts | No shipped default credentials; first login forces password set; seed/dev accounts disabled in production. |
| Temporary passwords | Single-use, short expiry, force change on first use. |
| Shared accounts | **Prohibited** — every actor is an individual identity (non-repudiation, B6). No shared "admin" login. |

## 3. Multi-factor authentication architecture (ODR-003)

- **Mandatory MFA:** Developers, system/platform admins, Owner/Co-Owner/General Manager/Corporate Accountant/Finance Manager, and **any** user with financial-approval or security-management authority. **Optional MFA:** operational field users/workers (companies may tighten later).
- **Methods:** primary TOTP authenticator / hardware security keys; secondary email/SMS codes (ODR-003).
- **Enrollment:** required at first privileged login; cannot exercise privileged authority until enrolled.
- **Recovery codes:** issued at enrollment, single-use, stored hashed.
- **Lost device / MFA reset:** identity re-verification **plus approval** by an authorized admin (never self-serve for privileged accounts); every reset audited (B6).
- **Emergency recovery:** a governed break-glass path (§5) for total MFA loss — approval + enhanced audit + time-boxed.
- **High-risk action re-auth** (ODR-003): password/MFA changes, permission changes, high-privilege account creation, sensitive financial export, high-value approvals, destructive admin actions.

## 4. Session & device security (`11.05`)

- **Session lifecycle:** login → token issuance → **risk-based expiry** (shorter for privileged/untrusted) → refresh within policy → logout → **remote termination** (admins force-logout compromised sessions).
- **Device trust:** registered/trusted devices (longer sessions, offline use); unknown/untrusted (shorter sessions, additional verification); device revocation on loss/offboarding; **device risk scoring** is a deferred enhancement (ODR-003/`11.05`), not V1.
- **Offline sessions:** operate only within approved offline policy; no new branch access offline (B1 §6); re-auth on reconnect or threshold breach.
- **Offline cache encryption (mandatory — closes P3-06):** any device holding financial or PII data offline (incl. BYOD, `25.09`) **must** encrypt that cache at rest. This raises `11.05`/`20.29`/`20.04` "encrypted when possible" to a hard requirement for sensitive caches; combined with remote-wipe on revocation (§6) and the offline-storage scoping limits (B5 §4), it bounds the lost-device exposure.

## 5. Privileged access management

- **Developer = technical support role, not a business owner.** It exists for architecture/maintenance/debugging, not routine business data access.
- **Developer cross-company access requires:** explicit authorization, documented business justification, **enhanced/elevated audit** (every action, B6 §9), and **time limitation** (auto-expiring). It is never the routine application data path and can never silently alter financial/audit data (`26.09`/B6).
- **Separation of duties:** the same identity should not both approve and execute high-impact privileged changes where avoidable; privileged actions favour dual control.
- **Break-glass (B1 §8 / B6 §9):** emergency request → approval (secondary for high impact) → MFA re-auth → **time-boxed** elevation via permission overrides → enhanced audit → **mandatory post-use audit review**. Auto-expiry; no standing god-mode.

## 6. Account lifecycle management

- **Onboarding:** create account → assign company → assign branch(es) → assign roles/permissions (data-driven, B1) → activate. New employees get **new V3 accounts** (no V2 security migrated, ODR-001).
- **Suspension:** `account_status = Suspended` ⇒ immediate deny on next request (B1); reversible.
- **Termination/offboarding:** disable account, revoke device trust, expire tokens; **historical records preserved** (B6); per `26.13` scenario.
- **Permission change / transfer:** role/branch reassignment is audited (B6) and takes effect on next authorization evaluation.
- **Dormant accounts:** auto-flag/disable after a defined inactivity window.
- **Offline un-synced data (P3.5-05):** on offboarding/revocation, the device is blocked from new sync and its scoped cache is wiped on reconnect — **but pending un-synced events are never silently destroyed**: minimize the offline-only window (frequent opportunistic sync, B5), retain pending items until confirmed (B5 §4), and define a **wipe-vs-preserve** rule so a remote wipe does not discard un-synced business data before it is drained or explicitly accepted as lost (with audit).

## 7. Security monitoring & incident response

- **Monitor (alert on):** failed-login spikes, impossible-travel/new-device logins, privilege escalation, excessive API activity, repeated authorization failures (cross-tenant attempts, B1), break-glass usage, mass exports (`11.04`/`26.13`).
- **Incident response:** classify (severity) → investigate (immutable audit, B6) → escalate → **contain** (force logout, suspend account, revoke device, isolate) → recover → **post-incident review** with documented remediation. Credential-compromise is a defined scenario (§11).

## 8. Backup security architecture (P3.5-02)

- **Backups are copies, not archives** (≠ historical business records, §10).
- **Encryption mandatory:** all backups (DB exports, financial reports, documents) are **encrypted at rest and in transit**; client-side/managed-key encryption before any third-party storage (e.g. Google Drive). No plaintext full-DB/PII dumps.
- **Access restricted & isolated:** a dedicated least-privilege backup identity; backup storage isolated from operational credentials; access **logged and auditable** (B6).
- **Separation of duties:** those who can run/restore backups are distinct from those who can delete them; **immutable/versioned (object-lock)** backups so a compromised account cannot destroy both live and backups (ransomware defense, P3.5-03).
- **Restoration is auditable:** every restore is an audited, authorized event (§11).

## 9. Recovery objectives (P3.5-01)

| Data class | RPO (max loss) | Mechanism |
|---|---|---|
| Financial (journals, payments, balances) | **≈ near-zero (≤ ~5 min)** | Supabase **PITR / continuous WAL** as primary; daily encrypted export as secondary/offsite |
| Operational (inventory, production, sales) | ≤ ~1 hour (target) | PITR + frequent sync; offline queue covers field gaps (B5) |
| Configuration / master data | Low (changes are rare; capture on change) | PITR + export |

| Failure | RTO (max downtime) target |
|---|---|
| Local branch / device failure | ~0 operational impact — **offline-first continues** (B5); resync on recovery |
| Database failure | ≤ ~4 hours (restore via PITR) |
| Platform/regional outage | Defined target with documented manual-continuation fallback (`26.08` failure isolation) |

Targets are documented constants, tuned with real operations (calibration knob).

## 10. Backup retention & archival (P3.5-03)

- **Rotation (GFS):** daily (short retention), weekly, monthly, plus long-term retention for financial/audit (aligns `26.15` permanent classes).
- **Backup vs archive vs historical record:**
  - **Backup** = recovery copy (rotated, can expire).
  - **Archive** = cold-stored older data moved out of hot storage (retained, content unchanged, B6).
  - **Historical business record** = the immutable Level-1 event history (B4) — the actual source of truth, never a "backup."
- Retention respects legal/audit holds (no purge of held evidence, B6/§13).

## 11. Disaster recovery procedures (P3.5-04)

For each scenario: **detect → respond → recover → validate → post-recovery audit.** Recovery must support **tenant-scoped restore** (restore one company/branch without clobbering others — the multi-tenant hard part) and a staging-restore-then-verify flow before cutover.

| Scenario | Outline |
|---|---|
| Database corruption | Detect via reconciliation/health checks (B4 §6) → restore via PITR to last-good point → validate (trial balance / snapshot tie-out) → audit |
| Cloud service outage | Offline-first continues (B5); admins alerted; resume + safe resync on recovery (`26.13`) |
| Ransomware | Immutable/versioned backups (§8) → restore clean copy → rotate credentials → forensic audit |
| Accidental deletion | No hard deletes for critical data (B4); restore record/tenant scope from PITR/backup → audit |
| Credential compromise | Force logout/rotate, revoke devices/tokens, MFA reset (§3), investigate via audit (B6) |
| Regional outage | Documented manual-continuation + recovery target (§9); future multi-region deferred (ODR-005) |

Restores are authorized, audited (B6), and never edit history — they reconstruct it.

## 12. Disaster recovery testing (P3.5-03/06)

**A backup that has never been restored is only a theory.** Required: scheduled **recovery drills** (full + tenant-scoped restore), restore verification (restored data ties to expected snapshots/trial balance), and **backup integrity checks** (checksums + automated test-restore). Define testing **frequency** (e.g. monthly recovery test per `26.16`), **documentation** of each drill's results, and **failure remediation** tracking. A drill that isn't logged didn't happen.

## 13. Security & recovery documentation governance (P3.5-06)

- **Named owners:** a **Security owner** and a **DR owner** (roles, not just docs).
- **Runbooks:** incident-response and DR runbooks with explicit steps, success criteria, and an **outage communication plan** — the missing operational layer (P3.5-06).
- **Review schedule:** periodic review of auth/security/DR specs and drill results; update on incidents.
- **Compliance evidence:** immutable audit (B6) + drill logs + access logs are the evidence base (also serves ODR-001 V2-archive review).

## 14. Future implementation guidance (design only)

- **Authentication testing:** MFA-enforcement-for-privileged tests; plaintext-password-absence test; lockout/rate-limit tests; high-risk re-auth tests.
- **Security audit:** RLS cross-tenant negative tests (B1), privileged-action audit completeness (B6), break-glass expiry tests.
- **Backup validation:** encryption-at-rest verification; automated test-restore in CI/ops; immutability/object-lock verification.
- **Operational runbooks:** incident, DR, restore (full + tenant-scoped), credential-compromise — each owned, versioned, and drill-tested.
- **No code now** — standards, policies, objectives, and runbook requirements only.

---

## 15. Findings resolved / dependencies

- **P3-06** (auth/privileged hardening) → **Resolved (B7)**: §1–§5.
- **P3-07** (password policy, Developer restrictions) → **Resolved (B7)**: §2 (password standards, no plaintext/shared accounts), §5 (Developer constraints, separation of duties, break-glass).
- **P3.5-01** (RPO/RTO/PITR) → **Resolved (B7)**: §9.
- **P3.5-02** (backup encryption/access) → **Resolved (B7)**: §8.
- **P3.5-03** (backup integrity/immutability/rotation) → **Resolved (B7)**: §8, §10, §12.
- **P3.5-04** (restore procedure, tenant-scoped) → **Resolved (B7)**: §11.
- **P3.5-05** (offline un-synced data) → **Resolved (B7)**: §6 (pending-never-destroyed, wipe-vs-preserve, window minimization with B5).
- **P3.5-06** (DR ownership/runbook) → **Resolved (B7)**: §11–§13 (per-scenario procedures, drills, named owners, runbooks, comms plan).
- **Dependencies:** B1 (authz), B4 (reconciliation/restore validation, snapshots), B5 (offline pending + resync), B6 (immutable audit of all security/DR events). **Phase 7 §E** executes the DR drill + load/security tests (P4.5-09 remains the only open scalability item — it is a *test-execution* finding, not a spec gap). P3.5-07 (large-object/IoT storage lifecycle) remains an Improvement item for Stage B3/3.5 follow-up.
- **No contradictions** with Sections 11/20/25/26; B7 converts their security/DR principles into concrete enterprise standards and constrains the previously-unbounded Developer role.
