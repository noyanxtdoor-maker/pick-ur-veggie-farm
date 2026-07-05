# Phase 2 — DayFlow Calendar: analysis & adoption

**Type:** Decision/reference note · **Date:** 2026-07-06 · **Trigger:** owner — "analyse and implement
github.com/dayflow-js/calendar in our app … still stick to our rules who has authority can see what
schedule/plan, find leaks/bugs."

## What DayFlow is
`dayflow-js/calendar` (784★, TypeScript) — a lightweight, framework-agnostic (React/Vue/Angular/Svelte)
"big-calendar" component: **Day / Week / Month / Year** views, **drag-and-drop + resize**, mobile layouts,
event-detail panels, and a plugin architecture. It is a *presentation component library*, not a scheduling
backend.

## Decision: adopt the UX natively, do NOT add the dependency
Same call as the 12-ERP scan — borrow the good ideas, keep our own unique system. Rationale:
1. **Our role-visibility rule is the hard constraint.** Every view must show only what a user may see (M6C:
   Management events need `schedule.read_private`; branch + tenant via RLS). We already enforce this at the data
   layer — screens render only the server-RLS-filtered, tier-filtered event set. A native view inherits that for
   free; adapting a third-party component's own event model would risk a visibility leak at the seam.
2. **Dependency discipline (C1 §4 / ponytail).** We already had the day-grid infrastructure (M6D `timeGrid.ts`,
   `DayView`). Adding Week + resize was a small extension, not a reason to pull a whole calendar library + its
   bundle.
3. **We keep drag/resize semantics tied to our governed writes** (`schedule.manage` RLS, audited) rather than a
   library's internal state.

## What we took (built this iteration)
- **Week view** — a 7-day time grid (`WeekView.tsx`): per-day columns, hour gutter, live "now" line on today,
  horizontal scroll, click a day header → Day view. The most useful missing view for a weekly farm plan.
- **Event resize** — drag a block's bottom edge to change its end time (`applyResize`, snapped to 15 min,
  clamped, min 15-min duration).
- **Shared `TimedBlock`** — one draggable/resizable block used by both Day and Week views.
- Times now also show in the day-list panel.

## What we rejected / deferred
- Year view (overkill for a farm), the plugin runtime, and cross-day drag in Week view (v1 moves within a day's
  column — switch to Day view or edit to move across days). Overlapping-event side-by-side layout is deferred
  (few events/day; blocks stack).

## Bug found + fixed (owner asked to "find leaks/bugs")
- **Drag/resize commit race (real bug).** The block read its drag mode/delta from React *state* in the
  pointer-up handler; under a fast gesture the state update could not have flushed yet, so the move/resize was
  silently dropped (reproduced: a resize showed the new size but never persisted). **Fix:** the authoritative
  drag state now lives in a `useRef` read synchronously at pointer-up; React state only drives the live visual.
  Both move and resize now persist deterministically (verified against IndexedDB). Also added `touch-none` +
  `pointercancel` handling for reliable touch dragging.
- **Visibility audit (no leak):** all three views (month/week/day) render from the same
  server-RLS-filtered → tier-filtered set; the security boundary stays the M6C RLS (guard-proven 13/13). Writes
  (retime/resize) go through `schedulingApi.setTime` → `schedule.manage` RLS.

## Verification
tsc clean · vitest (timeGrid incl. new resize cases) · build OK · browser: Week view renders with the 7-day grid
+ now-indicator; created a 09:00–10:00 event → resized to 09:00–12:00 (persisted) → moved to 10:00–13:00
(duration preserved). No DB change (M6D's start/end columns already exist).
