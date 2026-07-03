# Phase 2 — Module 6 · Scheduling (Schedules & Plans) — reconciled specification

**Type:** Operational module design · **Status:** spec (Define) · **Date:** 2026-07-03 ·
**Branch:** `feature/phase-0-foundation`
**Authority:** prototype `src/features/Schedules.tsx` = **workflow-logic authority** (owner 2026-07-02) · System
**20.19** Calendar Event Engine = **structural authority** · **26.09** permissions. Foundation reused: M1–M6 ·
P2-M2 `is_branch_member` · M5 audit-trigger pattern. **No GL, no money path** — this is the first Phase-2
operational module with no financial posting (so no cross-vendor money review needed).

## 1. Scope — what the mock does (and M6 builds)

A **farm calendar**. Create an event (title, date, type [Planting/Meeting/Delivery/Project/…], description,
optional link to a Project) → view it on a **month grid** (primary), with a **day list** for the selected date.
Delete an event. The mock also has a per-role visibility toggle and week/day views — see §2 deferrals.

## 2. Canonical mapping (20.19)

| Mock concept | Canonical (20.19) | M6 disposition |
|---|---|---|
| Schedule event | `calendar_events` | new table: company_id, branch_id, event_type, title, description, **event_date** (mock uses a single date; `start_datetime`/`end_datetime` ranges deferred), priority (default Normal), status (default Scheduled), created_by, timestamps. Branch-owned. |
| Event types | 20.19 list | Planting · Fertigation · Harvest · Maintenance · Delivery · Meeting · Inspection · Deadline · Project (mock set ∪ 20.19). |
| Role-restricted visibility | — (mock nicety) | **Replaced by our model:** events are branch-scoped and readable by branch members with `schedule.read`; the mock's per-role hide/show is NOT reproduced (our RBAC gates by permission + branch membership, not ad-hoc role lists). Recorded, not faked. |
| Link to Project | `project_id` (20.19 references) | `project_id` column **nullable, reserved** — the Projects module (M7) isn't built yet; the link is stored but not enforced/joined until then. |
| Automation (auto-events from crop/maintenance schedules) | 20.19 automation | **Deferred** — manual events only for now. |
| Assignment (assigned_user/team), crop_block/zone/equipment refs, week/day calendar views | 20.19 | **Deferred** (recorded) — month grid + day list is the shippable core. |

## 3. Permissions (26.09)

`schedule.read` (view the calendar — all branch members typically) · `schedule.manage` (create/edit/delete
events). Reads also `is_branch_member`. No financial sensitivity, so these are broadly grantable (unlike
payroll/accounting).

## 4. Milestones

| Milestone | Scope |
|---|---|
| **M6A — DB** | migration `p2m6a_scheduling`: `calendar_events` table + RLS (branch-member read w/ schedule.read; schedule.manage writes — plain RLS grants, no governed function, like crops/products) + audit trigger + 2 permissions; new `guard:scheduling` CI gate (tenant + branch isolation, permission gating, audit). |
| **M6B — UI** | Schedules screen: month grid (events dotted per day, click a day → day list), create-event modal, delete (confirm); nav `/operations` or a dedicated `/schedules` gated `schedule.read`. mock adapter + Dexie v7. |

**Verification cadence (unchanged):** db reset → all guards (…/payroll/**scheduling**/drift) → tsc/vitest/build →
browser E2E (M6B) → LOCAL commit → owner push gate → CI audit. **No money-path review** (no GL).
