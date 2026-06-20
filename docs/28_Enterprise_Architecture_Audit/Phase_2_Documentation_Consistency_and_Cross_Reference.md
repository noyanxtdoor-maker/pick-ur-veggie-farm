# Phase 2 — Documentation Consistency & Cross-Reference

**Phase:** 2 of 9
**Branch:** `architecture-audit`
**Date of record:** 2026-06-20
**Auditor:** Chief Enterprise Architect & System Auditor
**Method:** Read-only analysis combining automated scans (internal-link integrity, version mentions, role terminology, escaped-markdown detection) with targeted content comparisons across overlapping domains. No source code modified. V1 prototype not consulted.

---

## 1. Objective

Test whether the 28 documentation domains **agree with each other**. Phase 1 established that no single source of truth governs the corpus; Phase 2 measures the consequence — where domains overlap, do they reinforce or contradict? Specific comparisons targeted: Accounting `04` vs `22`; the data/entity model across `05.01`/`10`/`20`/`26`; security/RBAC across `01`/`05`/`11`; and the competing build sequences carried over from finding P1-06.

## 2. Methodology note (accuracy correction)

During this phase an initial broad `grep` for escaped-markdown corruption reported 278 of 280 files affected. That result was **false** — the pattern over-matched and flagged even the clean Phase 0/Phase 1 audit artifacts (which contain no backslashes). The claim was discarded and re-measured with an exact byte-level check, which found genuine escaped-markdown in **one** file. This correction is recorded deliberately: the audit's own intermediate findings are also "claims to be verified, not facts."

## 3. Automated scan results (verified)

| Scan | Result |
|---|---|
| Markdown files | 280 |
| Relative internal links across entire corpus | **3** (0 broken) |
| Version mentions | V3 in 83 files; V2 in 6 (5 in `27_Migration`, 1 stray in `22.13`); V1 in 13 |
| Escaped-markdown corruption | **1 file** — `18.01_Project_Build_Order.md` (60 occurrences) |
| RBAC term spread | `Admin` (5 files) vs `Administrator` (12); `Co-owner` (13) vs `Co-Owner` (13); plus `Manager` (21), `Accountant` (14), `Staff` (5), `Cashier` (2) |

## 4. Domain-overlap map (verified)

The same subject matter is specified in multiple domains with no supersession statement:

| Subject | Documents covering it |
|---|---|
| Accounting (COA, GL, AR/AP, statements) | `04.01`–`04.04` (4 specs) **and** `22.03`/`22.04`/`22.07`/`22.08`/`22.22` (+ 22 others) |
| Core data / entity model | `05.01_Master_Entity_Model`, `10.01_Master_Entities`/`10.03_ERP_Data_Relationship_Map`, `20.30_Entity_Relationship_Master_Map`, `26.02`–`26.06` (five ERM-stem files) |
| Security / RBAC / permissions | `01.01_User_and_Security_System`, `05.03_Security_and_Audit`, `11.01_RBAC`, `10.02_User_Roles_Permissions`, `20.03_User_Accounts_Roles_Permissions`, `21.04_Roles_Permissions`, `26.09_Permission_Matrix` |
| Audit trail | `05.03`, `10.04`, `11.04`, `20.28`, `22.24`, `24.13`, `25.15` |
| Backup / DR / retention | `12.02_Google_Drive_Backup`, `26.15_Data_Retention`, `26.16_Backup_DR_Data_Portability` (assessed in Phase 3.5) |
| Build / module sequence | `08.02`, `09.01` Rule 3, `16.03`, `18.01`, `20` README flow |

This is the defining Phase 2 observation: the corpus contains a **foundation layer (sections 00–08)** — the original lean design — and an **enterprise layer (sections 10–26)** — a later expansion — that cover the same domains in parallel, with nothing declaring which supersedes the other. This also explains P0-01: the root manifest covers exactly `00`–`08` because it predates the enterprise layer.

---

## 5. Findings

### P2-01 — Dual-layer architectural duplication with undefined supersession
- **Severity:** High
- **Status:** Open
- **Description:** Core domains are specified twice — once in the foundation layer (`00`–`08`) and again, far more extensively, in the enterprise layer (`10`–`26`) — with no document stating which is authoritative. Confirmed instances: Accounting (`04` 4 specs ↔ `22` 27 specs); data/entity model (`05.01` ↔ `10` ↔ `20.30` ↔ `26.02`–`26.06`, i.e. five+ locations); security/RBAC (`01.01` ↔ `05.03` ↔ `11` ↔ `10.02` ↔ `20.03` ↔ `21.04` ↔ `26.09`).
- **Business Impact:** Contributors cannot tell which accounting/data/security spec is "the" design. Work may target the lean foundation spec while the enterprise spec (or vice-versa) is intended, producing rework and mismatched modules.
- **Security Impact:** The RBAC/permission model exists in seven locations; a weaker formulation can be implemented in good faith. No single authoritative permission matrix governs.
- **Scalability Impact:** Parallel layers double maintenance and guarantee divergence as either layer evolves; the enterprise layer already dwarfs the foundation, so the foundation is silently stale.
- **Technical Risk:** Since "code must follow the documentation" (09.01), duplicated/contradictory specs translate directly into inconsistent implementation; the COGS/biological-asset/IAS-41 treatment in `22` is incompatible in scope with the minimal `04`.
- **Recommended Enterprise Solution:** For each duplicated domain, designate the enterprise-layer document as canonical and either (a) delete the foundation-layer spec, or (b) demote it to a clearly-labelled "concept summary" that links to the canonical spec. Record the supersession in `13_Project_Status` and the (consolidated) index. This is a strategic decision and is escalated for owner ratification at remediation.
- **Related Documents:** `04` ↔ `22`; `05.01`/`10`/`20.30`/`26.02`–`26.06`; `01.01`/`05.03`/`11`/`10.02`/`20.03`/`21.04`/`26.09`.
- **Recommended Priority:** High — resolve before any duplicated module is implemented.
- **Future Action Required:** **Owner strategic decision** — confirm enterprise layer as canonical and disposition of the foundation layer (joins the P1-01/P1-02 decision cluster).

### P2-02 — Contradictory module build sequences (one dependency-unsound)
- **Severity:** High
- **Status:** Open
- **Description:** At least four documents prescribe build order and they disagree:
  - `16.03`: Auth → Roles → Workspace/Calendar → Inventory → **Production Costing** → Accounting → Reporting → Integrations → AI.
  - `18.01`: Foundation → Master Data → **Inventory (P3)** → **Production (P4)** → **Sales/POS (P5)** → Accounting → Intelligence.
  - `08.02`: Users → Calendar/Workspace → **Agricultural Core (3) → Inventory (4)** → Accounting → Intelligence.
  - `20` README flow: Company → Users/Roles → Locations → Inventory → Production → Harvest → Sales → **Calendar (late)** → Accounting → Reports.
  Conflicts: (1) `08.02` builds Agricultural Core **before** Inventory, but production costing consumes inventory ("consumption: inventory decreases and production cost increases" — `22` README), so `08.02`'s order is **dependency-unsound**. (2) Sales/POS is an explicit phase in `18.01` but **absent** from `16.03` and `08.02`. (3) Calendar is early in `08.02`/`16.03` but late in the `20` flow.
- **Business Impact:** Teams sequencing from different documents will build in incompatible orders, causing dependency violations and rework; a core revenue module (POS) is unscheduled in two of four plans.
- **Security Impact:** Auth/RBAC is first in most sequences (good), but with no canonical sequence there is no guarantee guardrails precede the modules they protect.
- **Scalability Impact:** Multiple sequencing authorities cannot coordinate multi-contributor or multi-phase delivery.
- **Technical Risk:** Building production before inventory (per `08.02`) would force rework of the costing engine; missing POS phase risks an unplanned integration scramble.
- **Recommended Enterprise Solution:** Adopt one canonical build sequence (recommended base: `18.01`, the only one that is dependency-complete and includes Sales/POS and Master Data), reconcile it against the verified module dependency map (`18.06`/`26.08`, checked in Phase 5), and have `08`, `09.01`, `16.03`, and the `20` flow reference it.
- **Related Documents:** `08.02`, `09.01`, `16.03`, `18.01`, `18.06`, `20` README, `26.08`.
- **Recommended Priority:** High — must be settled before implementation begins (the audit's core purpose).
- **Future Action Required:** Canonical-sequence decision (owner ratification); dependency verification in Phase 5. Resolves P1-06.

### P2-03 — Uncontrolled RBAC role taxonomy
- **Severity:** Medium
- **Status:** Open
- **Description:** `16.01` declares five canonical roles (Owner, Co-owner, Admin, Operator, Employee), but the corpus uses inconsistent and additional role terms: `Admin` vs `Administrator`/`Farm Administrator` (same role, multiple spellings), `Co-owner` vs `Co-Owner` (capitalization), and `Manager`/`Accountant`/`Cashier`/`Staff`/`Supervisor` used in prose without being defined as system roles. It is unclear whether these are RBAC roles, HR job titles, or synonyms — a critical ambiguity for a permission model.
- **Business Impact:** Permission assignment becomes guesswork; "who can do what" cannot be specified unambiguously.
- **Security Impact:** Directly weakens access control — an undefined or aliased role can be granted privileges inconsistently across modules; the permission matrix (`26.09`) cannot be authoritative if the role vocabulary is uncontrolled.
- **Scalability Impact:** As HR (`21`) and modules add role-like terms, the taxonomy fragments further across branches and teams.
- **Technical Risk:** Implementations may create duplicate/aliased roles (`admin` vs `administrator`) with divergent permissions.
- **Recommended Enterprise Solution:** Define one controlled vocabulary: a fixed set of **system roles** (RBAC) distinct from **HR job titles** (descriptive). Publish it once (recommended: `11.01_RBAC` as canonical) and require every other document to use those exact terms; map job titles to system roles explicitly.
- **Related Documents:** `16.01`, `11.01`, `10.02`, `20.03`, `21.04`, `26.09`, `06.01`.
- **Recommended Priority:** Medium — resolve during Phase 3 (security) remediation.
- **Future Action Required:** Controlled-vocabulary definition; carried into Phase 3 analysis.

### P2-04 — Near-total absence of internal cross-linking
- **Severity:** Medium
- **Status:** Open
- **Description:** Across 280 markdown files and 26,132 lines there are only **3** relative internal links. The corpus is a set of isolated documents; cross-references (e.g. "see the locked list", "follow the build order") are made by prose name, not verifiable links.
- **Business Impact:** Navigation is manual and error-prone; readers cannot follow dependencies; onboarding is slow despite the existence of an "index" section.
- **Security Impact:** Indirect — security rules referenced by name (not link) cannot be verified to still exist or to point at the strongest formulation.
- **Scalability Impact:** Without links, consistency cannot be machine-checked; drift (P1-03, P2-01) is undetectable automatically and worsens with size.
- **Technical Risk:** Prose references silently rot when files are renamed/moved (e.g. the `18_Project Build` space, P0-03); nothing flags the break.
- **Recommended Enterprise Solution:** Establish a linking convention (relative markdown links for every cross-reference) and add a CI link-integrity check (the Phase 2 scanner can be reused). Backfill links for the highest-traffic references first (locked list, build order, role vocabulary, entity model).
- **Related Documents:** entire corpus; `16_Master_Project_Index` as the natural hub.
- **Recommended Priority:** Medium.
- **Future Action Required:** Linking convention + CI check (editorial, no strategic decision).

### P2-05 — Non-descriptive duplicate filenames in section 26
- **Severity:** Low
- **Status:** Open
- **Description:** Files `26.02`–`26.06` all use the identical filename stem `Entity_Relationship_Master_Map.md`, although their **content differs** (H1 titles: "Entity Relationship Master Map", "Farm Operations…", "Inventory and Supply Chain…", "Sales, Customer and Financial…", "Intelligence, Technology and System Infrastructure…"). The shared name is misleading and breaks any name-based navigation or tooling.
- **Business Impact:** Readers cannot distinguish the five files by name; risk of editing/citing the wrong layer.
- **Security Impact:** None directly.
- **Scalability Impact:** Name collisions complicate indexing and any generated navigation.
- **Technical Risk:** Tooling keyed on basenames cannot disambiguate; links by name are ambiguous.
- **Recommended Enterprise Solution:** Rename each to reflect its actual content (e.g. `26.03_ERM_Farm_Operations_Layer.md`). This finding also feeds P2-01 (entity model is documented in five+ places).
- **Related Documents:** `26.02`–`26.06`, `20.30`, `05.01`, `10.01`.
- **Recommended Priority:** Low — safe naming-consistency fix within `architecture-audit`.
- **Future Action Required:** Rename + reconcile against the canonical entity model chosen in P2-01.

### P2-06 — Duplicate-title specs and cross-section functional overlap
- **Severity:** Low
- **Status:** Open
- **Description:** `23.04` and `23.20` are both titled "AI Cost Management and Usage Control" (a true duplicate within section 23, which also has a numbering gap at `23.23`). Additionally, section `12_Integration_Architecture` overlaps dedicated sections functionally — `12.06_IoT_Sensor_Integration` vs the entire `24_IoT` section; `12.08_Payment_Gateway` vs `22.10_Bank_GCash_Maya_Wallet_Ledger`; `12.03_Google_Calendar` vs the calendar engine specs.
- **Business Impact:** Reader confusion about which spec is authoritative for a capability documented twice.
- **Security Impact:** Payment/integration security split across two homes risks an incomplete control surface.
- **Scalability Impact:** Overlapping homes multiply maintenance points.
- **Technical Risk:** Divergent duplicate specs (e.g. two AI-cost-control designs) implemented inconsistently.
- **Recommended Enterprise Solution:** Merge `23.04`/`23.20` into one spec; define section `12` as integration-transport concerns only and have it reference the domain sections (`24`, `22.10`) for business logic rather than restating it.
- **Related Documents:** `23.04`, `23.20`, `12.03`, `12.06`, `12.08`, `22.10`, `24.*`.
- **Recommended Priority:** Low.
- **Future Action Required:** Merge/disambiguate during consolidation.

### P2-07 — Escaped-markdown rendering corruption in `18.01`
- **Severity:** Low
- **Status:** Open
- **Description:** `18.01_Project_Build_Order.md` contains 60 escaped-markdown sequences (`\#`, `1\.`, `\-`) and double-spacing, so headings and lists do not render as Markdown. Notably this is the document recommended in P2-02 as the canonical build-order source. (Verified isolated to this one file after correcting an initial false corpus-wide reading — see §2.)
- **Business Impact:** The build-order document renders as a wall of escaped text, undermining its usability precisely where it matters most.
- **Security Impact:** None.
- **Scalability Impact:** None.
- **Technical Risk:** None beyond readability.
- **Recommended Enterprise Solution:** Re-save `18.01` as clean Markdown (strip escaping, fix spacing). Trivial fix; do during P0-03 section-18 rename.
- **Related Documents:** `18.01_Project_Build_Order.md`.
- **Recommended Priority:** Low.
- **Future Action Required:** Reformat (editorial).

### P2-08 — V2 legacy reference outside the migration section
- **Severity:** Low
- **Status:** Open
- **Description:** `V2` references are appropriately confined to `27_V2_to_V3_Migration_Roadmap` except for one stray occurrence in `22.13_Budget_Control_and_Variance_Analysis.md`. The enterprise accounting spec should describe the V3 design, not reference V2.
- **Business Impact:** Minor ambiguity about whether `22.13` describes current (V3) or legacy (V2) behavior.
- **Security Impact:** None.
- **Scalability Impact:** None.
- **Technical Risk:** Low — risk of implementing a legacy assumption.
- **Recommended Enterprise Solution:** Review `22.13`; remove or re-scope the V2 reference, or move the migration-relevant note into section `27`.
- **Related Documents:** `22.13`, `27.*`.
- **Recommended Priority:** Low.
- **Future Action Required:** Editorial review of `22.13`.

---

## 6. Phase 2 summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 2 |
| Low | 4 |
| Improvement Opportunity | 0 |

**Headline:** The domains do **not** consistently agree. The corpus is effectively two parallel designs — a lean **foundation layer (00–08)** and an expansive **enterprise layer (10–26)** — covering the same accounting, data-model, and security ground with no supersession rule (P2-01), while four documents prescribe conflicting build orders, one of which is dependency-unsound and two of which omit POS (P2-02). The documents are also structurally un-linked (P2-04), so none of this drift is machine-detectable today. Lower-severity defects (duplicate filenames/titles, isolated markdown corruption, a stray V2 reference) are straightforward cleanups.

**Strategic-decision cluster (for Phase 7 remediation):** P1-01, P1-02, P2-01, P2-02 must be decided together — they are all facets of "which layer/document is canonical, and in what order is it built."

**Cross-phase links:** P2-03 (roles) feeds Phase 3 (Security). The backup/DR/retention overlap noted in §4 feeds Phase 3.5. P2-02 dependency check feeds Phase 5.

**Next phase:** Phase 3 — Data & Security Architecture.
