# Preach My Gospel / LDS Missionary App — UI Inspiration

> **Inspiration only — lowest authority.** UI/UX patterns from an external offline-first field app. Not a spec; does
> not override Approved Screens, the AI Studio prototype, or canonical architecture (ADR-001 / Stage A precedence).

19 screenshots (captured 2026-06-22/23; added 2026-06-23). The app is the official LDS **Missionary planner / Area
Book** — used as a study of a **mature offline field application**. Its *domain* (missionary work) is irrelevant; only
its **interaction and layout patterns** are referenced.

## Screens captured & the farm pattern each informs

| Screen | Pattern | Informs (farm module) |
|---|---|---|
| **Home — Weekly Key Indicators** | KPI cards with goal/actual (e.g. New People 0/5, Has Baptismal Date 1/1), "Weekly Planning", "Progressing People" list | **Operational Dashboard** (sales volume, orders, low-stock, roster goals), **weekly planning** |
| **Calendar (day/week)** | time-rail day view, color-coded recurring blocks, appointments with names/durations | **Schedules & Plans** (cropping schedules, pickups, work shifts) |
| **Settings** | grouped sections (General/People/Calendar/Actions/Help/Account), theme + theme-color, language, notification defaults, calendar start/end, Change PIN, Sign Out | **Settings Hub** (theme, branch/POS config, language, backup, account) |
| **Bottom nav** | Home / Calendar / People / Map / Sync | mobile **field navigation** + explicit offline **Sync** affordance |
| **People / Map** (where present) | directory + map context | customers / branches / field zones |

## What to extract (and what to ignore)

- **Extract:** at-a-glance KPI card grid; goal-vs-actual framing; the day/week calendar interaction; the offline
  **Sync** affordance as a first-class nav item; the tidy settings taxonomy; high-contrast dark + light variants.
- **Ignore:** the religious domain, all labels/terminology, the specific metrics, and any content — none of it enters
  PickUrVeggie.

Cross-reference: **06.01 Dashboard_Design**, **06.02 Calendar_Design**, **25.x Mobile/Offline**, **B5** offline,
and the AI Studio prototype (the authoritative operational reference).
