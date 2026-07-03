# Phase 2 — Module 7 · Projects (Project Checklists) — reconciled specification

**Type:** Operational module design · **Status:** spec (Define) · **Date:** 2026-07-03 ·
**Branch:** `feature/phase-0-foundation`
**Authority:** prototype `src/features/Projects.tsx` = **workflow-logic authority** (owner 2026-07-02). No single
enterprise System owns "project checklists" — it is an operational feature; it reuses the branch/permission/audit
spine and links to the calendar (`calendar_events.project_id`, reserved in M6). **26.09** permissions. **No GL, no
money path** (like M6 Scheduling — no cross-vendor review).

## 1. Scope — what the mock does (and M7 builds)

A **Monday.com-style farm projects board**. Create a project card (name, description, start/end dates, status
[Planning/In Progress/Completed/On Hold], visibility [Public/Restricted]) → add a **task checklist** to it → tick
tasks done (records who + when) → the card shows **% complete**. Delete a project.

## 2. Canonical mapping

| Mock concept | Structure | M7 disposition |
|---|---|---|
| Project card | `projects` (branch-owned): name, description, start_date, end_date, status, visibility, timestamps | new table; RLS-gated writes (`project.manage`); no GL. |
| Task checklist | `project_tasks`: project_id, text, completed, completed_by (user), completed_at, position | new table; toggling records actor + timestamp; % complete = done ÷ total (derived, not stored). |
| Per-project **managers** (mock username list) | — | **Replaced by our model:** `project.manage` permission + branch membership gates create/edit/task-add/toggle/delete. The ad-hoc manager username list is NOT reproduced (RBAC gates by permission, not name lists). Recorded, not faked. |
| Visibility Public/Restricted | column stored | stored for parity; enforcement beyond branch membership is **deferred** (all branch members with `project.read` see branch projects for now). |
| Link to a calendar event | `calendar_events.project_id` (reserved M6) | the join is available; surfacing "project events on the calendar" is a light future enhancement. |

## 3. Permissions (26.09)

`project.read` (view the board) · `project.manage` (create/edit/delete projects, add/toggle tasks). Reads also
`is_branch_member`. Non-financial → broadly grantable.

## 4. Milestones

| Milestone | Scope |
|---|---|
| **M7A — DB** | migration `p2m7a_projects`: `projects` + `project_tasks` (branch-owned, RLS: branch-member read w/ project.read, project.manage writes; project_tasks scoped via its parent project's company/branch) + audit trigger + 2 permissions; new `guard:projects` CI gate (tenant + branch isolation, permission gating, task-parent integrity, audit). |
| **M7B — UI** | Projects board: project cards (status pill, % complete bar, date range), Add-Project modal, inline task checklist (add task, tick done → shows "done by"), delete; nav `/projects` gated `project.read`. Dexie v8 + mock adapter. |

**Verification cadence (unchanged):** db reset → all guards (…/scheduling/**projects**/drift) → tsc/vitest/build →
browser E2E (M7B) → LOCAL commit → owner push gate → CI audit. **No money-path review** (no GL). After M7, only
**Settings Hub** remains in the core roadmap (theme system: dark/cream/green tokens exist in `src/index.css`,
only light ported); then the backlog (B1–B9) + VeggieGenius AI Copilot are owner-timed.
