# Master Execution Roadmap

**Type:** Navigation artifact (status + intended execution order) · **Not** an architecture document.

This roadmap answers *where are we, what is the next approved action, and what is the approved execution path.* It does **not** answer what the architecture, security, money, RLS, or audit rules are — those belong to their owning authorities ([C8](Stage_C8_Enterprise_Implementation_Sequence_and_Construction_Roadmap.md), B1–B8, C1–C7, ADR/ODR). It supersedes the status-tracking role of the Phase-0 [context-reset handoff](Stage_D_Phase_0_Context_Reset_Handoff.md) (which remains as a historical artifact).

## 0. Purpose & Authority Position

```
This roadmap carries no architectural authority.
It reflects the C8 implementation sequence and current execution status.

If it conflicts with ADR/ODR, architecture sections,
Stage A, B1–B8, or C1–C8,
the higher authority is correct and the roadmap must be corrected.

The roadmap records status and intended execution order.
It never defines architecture, security, business, or engineering rules.
```

Position: lowest tier, below C1–C8. It is a reference that [CLAUDE.md](../../CLAUDE.md) cites — not above it. For build *order*, **C8 is the authority**; this roadmap only reflects it.

## 1. Current Project Status (updated 2026-07-10 — reconciled to reality per §6 maintenance rule)

```
Stage:       D (Controlled Construction)
Phase:       Phases 1–6 built (see §4 evidence); Phase 7 is the frontier
Branch:      feature/phase-0-foundation
Checkpoint:  d08b60a (Phase-1 auth complete; app LIVE on cloud aqhxhamdwmhcwxmebqbo)
Repository:  clean; synchronized with origin; CI green; guards 182 PASS / 0 DEFECT
```

**History note:** after Phase 1's foundations, the owner course-corrected to an *operational-first* build
(the `P2-M*` migration series). That build delivered the substance of C8 Phases 2–6 out of strict order,
verified by per-module guard batteries + CI rather than per-phase gates. This section was stale from
2026-06-22 to 2026-07-10; per §6 it now reflects the true status. `STATUS.md` (repo root) is the living
per-feature source of truth; this file stays the phase-level map.

## 2. Next Approved Action

```
DONE (2026-07-13): owner rotated the DB password, wired Supabase URL config +
Google OAuth + MFA. Google sign-in confirmed working live (a real
detectSessionInUrl bug was found and fixed in the process). E2E test account
was suspended in an earlier session.

Remaining, in order:
1. B2 digital-payments LOCK REVIEW (cross-vendor, per B2 spec §6c) — needs an
   external reviewer; not agent-buildable.
2. Real-cloud money-spine E2E on the hosted site (login → sale → verify
   journal → settle/void → balances tie) — owner decision pending on approach
   (agent cannot type the owner's password; a throwaway test account is the
   proposed alternative).
3. Google Play packaging (Track E) — owner infra decision (Play Developer
   account + signing key).
4. Backups beyond free tier + DR restore drill — owner plan decision.
```

Knowledge Intelligence Layer: Graphify + CodeGraph are now active in-repo; Obsidian/ClaudeMem/TaskMaster
remain deferred.

## 3. Milestone Ledger

Thin index — hashes point to Git history; this does not describe what each commit implemented.

| Milestone | Commit | Status |
|---|---|---|
| Phase 0 · Commit #1 | `9672ed9` | Completed |
| Phase 0 · Commit #2 | `04961a5` | Completed |
| Phase 0 · Commit #3 | `c2fce0c` | Completed |
| Phase 0 · Commit #4 | `ec09819` | Completed |
| Phase 0 · Commit #5A | `d4178d0` | Completed |
| Phase 0 · Commit #5B | `de9cda5` | Completed |
| Phase 0 · CLAUDE.md | `536bda4` | Completed |
| Phase 0 · Commit #6 | `5a28617` | Completed |
| Phase 0 · Commit #7 | `f1a6d0e` | Completed |
| Phase 0 · Commit #8 | `368ed02` | Completed |

## 4. Phase Navigation

Status map only. **C8 owns the phase definitions** (§3–§10); see C8 for what each phase builds.

| Phase | Status (2026-07-10 audit) | Authority · evidence |
|---|---|---|
| Phase 0 — Development Foundation | Completed | C8 §3 |
| Phase 1 — Identity, Tenant & Security | **Completed — exit criteria all proven** (live cloud login · permission-based enforcement · cross-tenant impossibility · RLS tests · append-only audit · B7 auth incl. signup→approval, reset, OTP re-auth; MFA enrollment = owner dashboard toggle, deferred) | C8 §4 · M1–M6 + P1A/P1B; guards 182/0; live E2E 2026-07-10 |
| Phase 2 — Core Master Data | **Completed with 2 recorded deferrals** — crops, products, equipment, customers, employees, branches, inventory items/categories all tenant-owned + permission-gated + audited. Deferred: supplier/AP master (all purchases cash — YAGNI, owner-aligned), UOM master table (units are fields; conversion deferred per M3 spec §2) | C8 §5 · P2-M2/M2E/M3A/M5A/M9A guard batteries |
| Phase 3 — Operational Ledger | **Completed** — append-only `inventory_movements` (function-only writes), FIFO batches, derived balances, offline outbox (B5) | C8 §6 · M2A/M3A; guard inventory 24 |
| Phase 4 — Financial Foundation | **Completed — pre-lock on B2** — double-entry GL, atomic posting, statements from posted GL, cash entries, payroll GL, digital-payment accounts (B2A awaits its own cross-vendor lock review) | C8 §7 · M2B/M4A/M4D/M5A/B2A; guards pos 18 · accounting 19 · payroll 19 · payments 11 |
| Phase 5 — Business Modules | **Completed** — POS, Inventory, Accounting, Payroll, Scheduling (full DayFlow), Projects, Customers, Settings | C8 §8 · STATUS.md §2 per-row evidence |
| Phase 6 — Reporting & Intelligence | **Substantially completed** — dashboards, management reports, cash-flow statement, purchase summary; VeggieGenius AI copilot = designed (CAP-VG1), build owner-timed | C8 §9 · M2D/M4C/M4D |
| Phase 7 — Optimization & Production Readiness | **FRONTIER (current)** — done: cloud schema live, PWA foundation, CI+guards, runbooks; remaining: hosting (Track C), Play packaging (Track E), MFA enrollment, DR drill (B7 §12), backups beyond free tier | C8 §10 · handoff §17 |

## 5. Knowledge & Delivery Layer

**Knowledge Intelligence**

| Item | Status |
|---|---|
| Graphify | Deferred |
| Obsidian | Deferred |
| ClaudeMem | Deferred |
| CodeGraph | Deferred (when V3 code exists) |
| TaskMaster | Deferred (when project complexity justifies it) |

Deferred (not rejected) — re-evaluate when Phase 1+ creates enough implementation complexity to justify a derived knowledge index.

**Delivery & Governance Gates**

| Gate | Status |
|---|---|
| GitHub Branch Protection | Required before Phase 1 (see [precondition](Stage_D_Branch_Protection_Precondition.md)) |
| Google Play Release | Final delivery target |

## 6. Maintenance Rules

- Update this roadmap when a milestone completes.
- Changes to implementation order must follow C8 / C7 / C4 governance.
- This roadmap reflects higher authorities; it does not replace them.
