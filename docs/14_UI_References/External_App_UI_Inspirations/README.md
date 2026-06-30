# External App UI Inspirations (non-financial)

> **Authority level: INSPIRATION / REFERENCE ONLY — NOT a PickUrVeggie ERP V3 specification.**
> External, third-party **application UI/UX** references collected for design study. They carry the **lowest authority**
> in the UI reference hierarchy and **do not override** Approved Screens, New UI, the AI Studio prototype, or any
> canonical PickUrVeggie architecture decision (ADR-001 + the Stage A Governance Precedence Model remain in force).
> This sits alongside [`External_Financial_UI_Inspirations/`](../External_Financial_UI_Inspirations/README.md)
> (GoTyme, MariBank) and covers **non-financial field/operations apps**.

## What this folder is

| Folder | Source app | Why it's relevant |
|---|---|---|
| [`Preach_My_Gospel/`](Preach_My_Gospel/) | "Preach My Gospel" / LDS **Missionary** planner app (Area Book) | A mature **offline-first field app**: weekly-KPI dashboard, day/week **calendar & appointments**, **people** management, **map**, **sync**, and a clean **settings** screen — structurally the same patterns the farm field app needs (Dashboard, Schedules & Plans, offline sync, Settings Hub). |

## Why it's here (patterns to study — not features to copy)

- **KPI dashboard** — "Weekly Key Indicators" cards with goal-vs-actual (e.g. 0/5) → maps to the farm **Operational
  Dashboard** (sales volume, orders, low-stock, roster goals).
- **Calendar / scheduling** — day & week views, color-coded recurring blocks, time rail → maps to **Schedules & Plans**.
- **Offline-first + Sync** — explicit Sync action in the nav → reinforces **B5** offline design.
- **People & Map** — directory + geographic context → relevant to customers/branches/field zones.
- **Clean settings** — theme, language, notifications, calendar defaults, account → maps to **Settings Hub**.
- **Bottom-nav field UX** — Home / Calendar / People / Map / Sync → mobile field navigation patterns.

## What it is NOT

- ❌ Not a PickUrVeggie spec, not an Approved Screen, not architectural authority, not religious/business content.
- ❌ It is a **UI/UX inspiration only**; the LDS app's *domain* (missionary work) is irrelevant — only its
  **interaction & layout patterns** are studied. All product names/designs belong to their owners; retained for
  internal, non-commercial design study.

## How to use it (authority-respecting pipeline)

```
External inspiration (this folder) → New UI exploration (14_UI_References/New_UI)
   → review/approval → Approved Screens (authoritative) → implementation
```
Inspiration informs exploration; only **Approved Screens** + the canonical specs (Sections 10–26, 28, the AI Studio
prototype for operational modules) are authoritative for the V3 build.
