# Phase 3.5 — Enterprise Data Lifecycle & Disaster Recovery

**Phase:** 3.5 of 9 (owner-added)
**Branch:** `architecture-audit`
**Date of record:** 2026-06-20
**Auditor:** Chief Enterprise Architect & System Auditor
**Governing assumptions:** ADR-001 (enterprise layer 10–26 authoritative).
**Method:** Read-only review of `26.16` (Backup/DR/Portability), `26.15` (Ownership/Retention), `12.02` (Google Drive Backup), cross-referenced with `20.29` (offline sync), `11.04` (audit retention), and `25.10` (mobile offline storage). No source code modified. V1 prototype not consulted.

---

## 1. Objective

Evaluate the enterprise data lifecycle and disaster-recovery posture: backup strategy, recovery procedures, data retention, archiving, and long-term data integrity — for a multi-company, multi-branch, offline-first ERP holding financial and personal data. Owner directive (Prime Directive carried from project history): *"if I lose data, I'm dead"* — DR is therefore a first-class concern.

## 2. Strengths confirmed

- **Correct DR philosophy (`26.16`)** — primary (Supabase) + secondary (Google Drive) backups, daily DB export, weekly review, monthly recovery test, explicit data portability ("the business owns the data, not the technology provider"), and the principle "a backup that has never been tested is only a hope."
- **Sensible retention defaults (`26.15`)** — permanent retention for accounting/audit/payroll/sales/inventory history; 90-day default for operational media; storage optimization (compression, archival).
- **Provider-independence intent** — documented ability to migrate off Supabase / Google Drive / a given AI provider.

These are a strong foundation. The findings below are where intent lacks enterprise-grade mechanism.

## 3. Lineage note (ADR-001 Decision 6)

The V1 prototype mandated a concrete, *tested* JSON export **and** restore with a visible "last backup" reminder. V3's enterprise DR (`26.16`) states the right principles but is less concrete than V1 on the restore mechanism. Per Decision 6 (preserve V1→V2→V3 evolution), V3 should **not regress** below V1's proven "restore must work and be tested" discipline — it should formalize it into an enterprise procedure.

---

## 4. Findings

### P3.5-01 — No RPO/RTO defined; implied 24-hour data-loss window for financial data
- **Severity:** High
- **Status:** Open
- **Description:** The DR plan specifies a **daily** database export as the backup cadence (`26.16`) but defines no **Recovery Point Objective** (acceptable data loss) or **Recovery Time Objective** (acceptable downtime). Daily logical exports imply up to ~24 hours of lost transactions on a primary failure. Supabase's point-in-time recovery (PITR/WAL) is not referenced; the plan relies solely on periodic logical dumps.
- **Business Impact:** For an ERP recording money daily across branches, losing up to a day of sales, inventory movements, and journal entries is a severe, possibly unrecoverable business event — the owner's stated worst case.
- **Security Impact:** Integrity/availability dimension — extended downtime with no RTO leaves branches unable to transact.
- **Scalability Impact:** As transaction volume grows (millions of rows, Phase 4.5), a 24h RPO represents an ever-larger absolute data loss; logical-only dumps also take longer and strain the DB at scale.
- **Technical Risk:** Daily `pg_dump`-style exports do not capture intraday changes; without PITR there is no fine-grained recovery point.
- **Recommended Enterprise Solution:** Define explicit RPO/RTO targets per data class (e.g. financial RPO ≤ 5 min via PITR, RTO ≤ 4 h). Enable Supabase PITR/continuous WAL archiving as the primary recovery mechanism; treat daily Drive exports as secondary/offsite. Document the targets in `26.16`.
- **Related Documents:** `26.16`, `12.02`, `20.29`.
- **Recommended Priority:** High — define before production data exists.
- **Future Action Required:** Set RPO/RTO; adopt PITR; revise backup cadence.

### P3.5-02 — Backup confidentiality and access control unspecified
- **Severity:** High
- **Status:** Open
- **Description:** Full database exports plus financial reports and documents are written to Google Drive (`26.16`, `12.02`), but nothing specifies that these exports are **encrypted** or how access to the backup store is controlled. "Local encrypted backups" are listed only as *optional*; the Drive channel — which holds the entire company's financial records and confidential PII (salaries, government IDs, tax info per `11.03`) — has no stated encryption or access policy.
- **Business Impact:** A single over-shared Drive folder or compromised Google account could leak the whole company's financial and employee data — bypassing all the in-app BA-RBAC/RLS controls.
- **Security Impact:** Critical exposure path. The backup is the most concentrated copy of sensitive data and is currently the least-specified control surface; it can nullify the strong in-app security (Phase 3).
- **Scalability Impact:** More branches/companies = larger, more valuable backup targets.
- **Technical Risk:** Plaintext exports in cloud storage; broad Drive sharing; no key management.
- **Recommended Enterprise Solution:** Mandate client-side encryption of all exports before upload (documented key management), restrict the backup store to a dedicated least-privilege service account, enable access logging on the backup location, and separate backup credentials from operational credentials.
- **Related Documents:** `26.16`, `12.02`, `11.03`, `26.15`.
- **Recommended Priority:** High.
- **Future Action Required:** Backup encryption + access-control spec.

### P3.5-03 — No backup integrity verification, immutability, or rotation/retention policy
- **Severity:** Medium
- **Status:** Open
- **Description:** "Verify data integrity" is stated as a principle (`26.16`) but with no mechanism — no checksums, no automated restore validation beyond an undefined "monthly recovery test," no immutable/versioned/WORM backups, and no rotation/retention policy for the backups themselves (how many dailies kept, GFS scheme). Backups appear deletable/overwritable, so a compromised account or buggy job could destroy both live and backup data.
- **Business Impact:** Backups that can be silently corrupted or deleted provide false assurance; ransomware or accidental mass-deletion could take live + backup together.
- **Security Impact:** Lack of backup immutability is a known ransomware failure mode.
- **Scalability Impact:** Unbounded retention without rotation inflates storage cost; no policy = unmanaged growth.
- **Technical Risk:** No checksum/restore-test automation means corruption is discovered only at recovery time.
- **Recommended Enterprise Solution:** Add per-backup checksums and automated restore-verification, immutable/versioned backup storage (object-lock), and a documented GFS rotation/retention policy. Define what the "monthly recovery test" actually verifies and its pass criteria.
- **Related Documents:** `26.16`, `12.02`, `26.15`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Integrity + immutability + rotation spec.

### P3.5-04 — No documented restore procedure (especially tenant-scoped restore)
- **Severity:** Medium
- **Status:** Open
- **Description:** The plan asserts the ability to "restore critical records" but provides **no restore procedure**. Critically, in a multi-company/multi-branch database, restoring one company's or branch's data after a partial loss — **without clobbering other tenants** — is non-trivial and entirely unspecified. Restore authorization (who may trigger a restore) and partial vs full restore paths are undefined.
- **Business Impact:** When a real incident occurs, the team improvises recovery under pressure; tenant-scoped restore mistakes could corrupt unaffected branches.
- **Security Impact:** Unauthorized or careless restores could overwrite good data or resurrect deleted records; restore must itself be access-controlled and audited.
- **Scalability Impact:** Full-DB restore becomes slower and riskier as the shared multi-tenant DB grows; per-tenant restore is essential at scale.
- **Technical Risk:** Logical dumps of a shared DB cannot easily restore a single tenant without bespoke tooling.
- **Recommended Enterprise Solution:** Document distinct restore runbooks: full-DB (PITR), single-company, and single-branch/record-level recovery; specify restore authorization, audit, and a staging-restore-then-verify flow. Carry forward V1's tested-restore discipline (see §3).
- **Related Documents:** `26.16`, `20.02`, `13.05`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Restore runbooks incl. tenant-scoped recovery.

### P3.5-05 — Offline-first data-loss vector: un-synced local data has no recovery path
- **Severity:** Medium
- **Status:** Open
- **Description:** The system is offline-first with local device databases and a sync queue (`20.29`, `25.10`). `26.16` lists "lost employee devices" as a DR scenario but offers no recovery for **un-synced local transactions** — data created offline and not yet uploaded when a device is lost, fails, or is wiped is simply gone. There is no device-side backup or "drain queue before wipe" provision.
- **Business Impact:** A field tablet capturing a day of harvest/sales/attendance offline, then lost before sync, loses that data with no recovery — a direct hit to the "don't lose data" directive.
- **Security Impact:** Tension with P3-06 (remote wipe of a lost device could also destroy un-synced data — wipe vs preserve conflict).
- **Scalability Impact:** More field devices across more branches multiply the un-synced exposure.
- **Technical Risk:** Sync queue loss on device failure is unrecoverable without a secondary capture path.
- **Recommended Enterprise Solution:** Minimize the offline-only window (frequent opportunistic sync), consider a lightweight encrypted device-to-device or local-network relay for un-synced queues, define wipe-vs-preserve policy on revocation, and surface "unsynced items" prominently so operators can reconcile.
- **Related Documents:** `20.29`, `25.10`, `26.16`, `11.05`.
- **Recommended Priority:** Medium.
- **Future Action Required:** Offline-data durability policy; integrate with conflict-resolution design (Phase 4.5).

### P3.5-06 — No DR ownership, runbook, or communication plan
- **Severity:** Medium
- **Status:** Open
- **Description:** The DR plan names scenarios (Supabase outage, accidental deletion, corruption, lost devices, failed updates) but assigns no DR owner, provides no incident runbook (detect → declare → recover → verify → communicate), and no stakeholder communication plan during an outage. The "monthly recovery test" has no owner, procedure, or recorded results.
- **Business Impact:** During a real outage, unclear ownership and no runbook extend downtime and increase error risk.
- **Security Impact:** Incident response and DR overlap; absence of a runbook weakens breach/outage handling.
- **Scalability Impact:** Ad-hoc DR does not scale across multiple branches/companies.
- **Technical Risk:** Recovery steps invented under pressure are error-prone.
- **Recommended Enterprise Solution:** Assign a DR owner, write incident/recovery runbooks with explicit steps and success criteria, log monthly recovery-test results, and define an outage communication plan. Cross-link to the risk register (`26.14`).
- **Related Documents:** `26.16`, `26.14`, `13.05`.
- **Recommended Priority:** Medium.
- **Future Action Required:** DR runbook + ownership + test logging.

### P3.5-07 — Large-object/IoT backup growth and retention-vs-hold gaps
- **Severity:** Improvement Opportunity
- **Status:** Open
- **Description:** Binary/large-object data (photos, receipts, attachments per `20.27`) and IoT time-series (`24.04`) backup strategy is thin; growth handling is deferred to Phase 4.5. Separately, media auto-deletion (90-day default, `26.15`) and "AI originals may be deleted" should explicitly respect audit/legal holds so evidence tied to an audited event is not auto-purged.
- **Business Impact:** Uncontrolled large-object growth raises cost; premature deletion of evidence linked to a financial/audit event could undermine an investigation.
- **Security Impact:** Audit evidence integrity (deletion of media referenced by an audit record).
- **Scalability Impact:** Large-object + time-series volume dominates storage at scale (Phase 4.5).
- **Technical Risk:** Retention jobs deleting referenced media.
- **Recommended Enterprise Solution:** Define a large-object/time-series lifecycle (tiered storage, compression, archival) and a legal/audit-hold exemption to retention jobs.
- **Related Documents:** `26.15`, `20.27`, `24.04`, `11.04`.
- **Recommended Priority:** Improvement Opportunity (storage-growth detail handed to Phase 4.5).
- **Future Action Required:** Large-object lifecycle + hold policy.

---

## 5. Phase 3.5 summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 0 |
| Improvement Opportunity | 1 |

**Headline:** The DR *philosophy* is correct and even quotes the right maxim ("a backup never tested is only a hope"), but the enterprise *mechanics* are missing: no RPO/RTO and an implied 24-hour financial-data-loss window (P3.5-01); the backup channel — the most concentrated copy of financial + PII data — has no stated encryption or access control (P3.5-02); and there is no real restore procedure, backup immutability, offline-data durability path, or DR runbook. For a system whose owner's first rule is "don't lose data," DR is currently under-engineered relative to that mandate. These are pre-implementation gaps and fully addressable.

**Cross-phase links:** P3.5-02 builds on Phase 3 PII findings; P3.5-05 integrates with the offline conflict-resolution design owed by Phase 4.5; P3.5-07 storage growth is quantified in Phase 4.5.

**Next phase:** Phase 4 — System, Integration & Module Architecture.
