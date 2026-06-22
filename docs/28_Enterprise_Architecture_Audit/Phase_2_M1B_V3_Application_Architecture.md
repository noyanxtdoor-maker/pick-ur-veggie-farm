# Phase 2 — Module 1B · V3 Application Architecture Decision

**Type:** Application Architecture Decision Document (design only — **no app code, no migration**) ·
**Status:** ✅ **LOCKED** (survived the architecture stress test — §5a; owner-directed lock 2026-06-22) · **Date:** 2026-06-22
**Branch:** `feature/phase-0-foundation` · **Predecessor:** `Phase_2_Transition_Context.md` (§0.1 — Module 1 LOCKED, run #23)

> This document establishes the **V3 application layer** that every Phase-2 UI module (Module 1C onward) will use.
> It decides the frontend stack, backend-communication model, offline architecture, and UI foundation — and
> nothing more. It produces **no application code**. On owner approval it is committed/pushed and becomes the
> authority for Module 1C (Organization Setup UI) and beyond.
>
> **Authority position:** subordinate to ADR-001 / ODR-001…005, the enterprise architecture (10–26), Stage A,
> B1–B8, C1–C8, and the locked Phase-1 database foundation (M1–M6) + Phase-2 Module 1 (P2-M1, `a26b667`).
> Where this document and a higher authority conflict, the higher authority wins and this document is corrected.

---

## 0. Reality first (what actually exists — verified, not assumed)

- **No V3 application exists.** `src/` holds only the **V2 prototype** (20 files: `features/POS.tsx`,
  `Accounting.tsx`, `Inventory.tsx`, `db.ts` (Dexie), `lib/money.ts`, `components/Numpad.tsx`, `BackupBadge.tsx`,
  …). **ODR-001 = replace, not extend** — V2 is a read-only reference; V3 is a fresh operational app.
- **No approved V3 screens exist.** `14_UI_References/Approved_Screens/` and `New_UI/` are empty placeholders.
  The only real assets are the **GoTyme / MariBank** fintech screenshots — explicitly *inspiration only, lowest
  authority*. **Consequence:** M1B can lock the **application architecture** and the **UI foundation (principles,
  layout rules, tokens)**, but **cannot** lock pixel-level screens. Concrete screens are produced and approved
  per module (1C does Organization Setup screens) through the canonical pipeline
  (inspiration → New_UI exploration → owner approval → Approved_Screens). M1B's UI foundation governs until then.
- **Installed toolchain (package.json, kept):** React 19, Vite 6, TypeScript 5.8, Tailwind 4
  (`@tailwindcss/vite`), `dexie` 4 (IndexedDB), `lucide-react`, `motion`, `recharts`, `vitest`. The `supabase`
  package is the **CLI** (devDep) — **`@supabase/supabase-js` is NOT yet installed** (the one required add).
- **The Phase-1 write path is real and is the contract V3 builds on** (verified in the locked migrations):
  - Reads: RLS-protected `SELECT` via the M4 resolver (`accessible_company_ids()`, `has_permission()`).
  - Authenticated writes (P2-M1): column-scoped `INSERT/UPDATE` on `companies.name`, `branches`, `roles`,
    `role_permissions`, `user_branch_roles`, each gated by `has_permission(company_id, key)`.
  - Governed mutations: `invite_user()` / `accept_invitation()` (SECURITY DEFINER, `search_path=''`).
  - `bootstrap_initial_tenant()` is **service_role-only** → an operator/CLI action, **never a client capability**.

**Design rule honored throughout:** climb the dependency ladder (C1 §4 / CLAUDE.md §4) — platform → installed
dep → few lines → new dep. Every new dependency below carries a written justification (§6).

---

## 1. Frontend

| Concern | Decision | Ladder rung / justification |
|---|---|---|
| **Framework** | **React 19 + TypeScript + Vite** SPA, shipped as an installable **PWA**. | Already the project standard (V2 uses it; installed). **No Next.js/SSR** — this is a behind-login field tool: no SEO, no server rendering need, and offline-first wants a client app + service worker, which a Vite SPA delivers without a server runtime. Stop at the installed rung. |
| **Routing** | **React Router v7** (declarative, data router) with nested layouts + route guards. | A multi-module app with deep links to records, a back button, and auth/permission guards is *not* "a few lines" over the History API. React Router is the conventional, well-supported choice for nested tablet two-pane layouts + guards. New dep, justified (§6). |
| **Component system / design system** | **Tailwind 4** (installed) for layout/styling + **shadcn/ui** (Radix primitives, **copied in**, not a runtime dep lock-in) for accessible interactive components (dialog, dropdown, combobox, toast). Icons: `lucide-react` (installed). A thin **farm token layer** sizes everything (§4). | Accessibility is a non-negotiable boundary (WCAG 2.2, keyboard, screen reader). Hand-rolling accessible overlays is the classic 3am-bug factory; Radix primitives are audited. **No MUI/AntD/Chakra** — those *are* the "generic SaaS dashboard" trap and the bloat ODR-001 rejects. We own the copied-in components, so we tune touch targets/contrast freely. |
| **State management** | **Local-first reads** from Dexie via `dexie-react-hooks` (`useLiveQuery`) + **React Context** for session/app-global state (current user, company, branch, permission snapshot, language, theme). | The UI reads the **local cache** (always available offline) and a background worker reconciles with the server (§3). That makes "server state" really "local cache state" → Dexie live queries give reactive reads with one tiny hook package. **No Redux / Zustand / TanStack Query** — add only if local-first reads measurably fall short. |
| **Form strategy** | **Zod** schemas as the single source of validation + types + **offline provisional-validation** + sync-payload contracts (B5 §5). **React Hook Form** for accessible error/focus management across the many module forms. | Zod is a firm architectural lever (one schema reused client-side, offline, and as the typed write contract). RHF is *recommended*; the **acceptable lazier fallback is native `<form>` + Zod-only** if RHF proves unnecessary. Minimal-typing forms (§4) lean on selects/recents/favorites/numpad, not free text. |
| **App location** | New V3 root **`app/`** (fresh). V2 `src/` is **not extended** (ODR-001); it stays as read-only reference (archive to `legacy/` when 1C repoints the Vite entry). | Replace-not-extend. M1B does **not** move/build anything — this is the recorded structure decision for 1C to execute. |

---

## 2. Backend communications

**Default data path = Supabase PostgREST via `@supabase/supabase-js`.** The client holds **only the anon key + the
user's JWT**; all authority is server-side (RLS + M4 resolver + SECURITY DEFINER RPC). **The `service_role` key is
never bundled** (handoff §11 checklist; enforced in §5/§6).

| Concern | Decision | Justification |
|---|---|---|
| **Reads** | PostgREST `select` on RLS-protected tables; the M4 resolver does the filtering server-side. The client never re-derives access and never reads a role name (C7 §0). | The resolver + RLS are the boundary; the client just queries. |
| **Writes** | (a) Resolver-gated authenticated `insert/update` on the P2-M1 column-scoped grants (company name, branches, roles, role_permissions, memberships); (b) **RPC** to `invite_user()` / `accept_invitation()`. Every write carries a client-generated **idempotency key** (§3). | This *is* the Phase-1 contract — no new server surface needed for M1. |
| **PostgREST vs Edge Functions** | **PostgREST + RPC only for Phase 2 M1. No Edge Functions yet.** Reserve Edge Functions for: operations needing `service_role`, server-only secrets, server-side email/SMS for invitations, or a centralized sync-batch endpoint — **build when a module needs one**, not speculatively. | YAGNI. The bootstrap (service_role) is an operator action, not client. Invitation delivery is out of scope (the token is delivered out-of-band — P2-M1 migration comment). |
| **Realtime** | **Not in M1.** Org setup is single-operator config. Architecture permits per-module Supabase Realtime (`postgres_changes`, RLS-filtered) later (e.g. live daily-ops dashboards). | Don't wire realtime for a config flow nobody watches collaboratively. |
| **Auth & session** | Supabase Auth (GoTrue) via `supabase-js`; JWT `sub` → `auth.uid()` → resolver → ERP user. Session persisted by `supabase-js`. **ODR-003** governs auth policy (risk-based MFA, OAuth + email, recovery). The guarded app shell gates routes on an **authenticated session + a cached permission snapshot**. | Offline: operate on cached data with the **last-synced permission snapshot for display only**; re-authorize on reconnect. **Offline never grants new privilege** (§3, B5 §8). |

---

## 3. Offline architecture (B5 is the authority)

**Principle (B5 §1):** a business event is recorded **exactly once** regardless of retries =
**at-most-once commit (idempotency key + server unique constraint) + at-least-once delivery (retry)**.

| Element | Decision |
|---|---|
| **Local store** | **Dexie / IndexedDB** (installed). Caches **only authorized-branch data** (B5 §4) — never the whole DB, all salaries, or company-wide confidential reports. Rows retain `company_id`/`branch_id`. TTL + freshness marker; **pending (unsynced) events are never evicted**; stale/oldest non-pending evicted first. |
| **Read model** | **Local-first.** UI reads Dexie (works offline); a background worker reconciles with the server. Server-derived values (balances, final acceptance) are shown **provisional/estimated and labeled** until the server acks (B5 §8) — offline is **never** authoritative. |
| **Write model** | Each business event gets, at the moment of action: a client **idempotency key** (`uuidv7` — matches the server PK generator, sortable), a **local temp id**, a **device id**, and a **per-device monotonic sequence** (B5 §2). Server enforces **`UNIQUE (company_id, idempotency_key)`** → a retry returns the prior result, never re-commits. |
| **Queue** | Durable per-device sync queue with states **Pending / Pending-Wait (causal) / Uploading / Confirmed / Conflict / Dead-letter** (B5 §13). Local temp id ↔ server UUID mapping on confirm. |
| **Conflicts** (B5 §6–§7) | Retry (same key) → **auto-dedup**. Effect-free **drafts** → last-writer-wins by version. Inventory/financial/permission/closed-period/genuine-semantic conflicts → **manual review**, full context + audit. **Hard rules:** never silently change financial history; never auto-merge or "preserve both" financials; a true duplicate is never preserved as two. **Server is final authority.** |
| **Causality** (B5 §9) | Per-device sequence + explicit parent references order dependent events; **device clocks are untrusted**. A child whose parent hasn't arrived holds in **Pending-Wait**, not rejected. |
| **Reconnect at scale** (B5 §10) | Exponential **backoff + jitter**, client batching, server **backpressure/rate-limit**, **dead-letter** for permanent failures, priority lanes for critical entities — so a mass reconnect after an island outage doesn't thundering-herd the DB. |

**Scope discipline for M1 (the honest, lazy-correct call):** M1B **reserves and specifies** the full offline
contract above — that is this document's job. But Organization Setup is **owner/manager configuration done with
connectivity**, low-frequency, not the 100×-retry inventory case. So **1C implements only:** the Dexie cache +
local-first reads + **idempotency-key generation on every write** (so config writes are already retry-safe). The
**full sync worker** (queue states, Pending-Wait causality, dead-letter, backoff/backpressure) is built when the
**first high-frequency offline-write module ships** (Inventory / Daily Operations) — where B5 §12's load/idempotency
test battery becomes the mandatory gate. Building the whole sync engine for a config screen would be speculative
complexity; specifying it now so it isn't re-derived later is correct.

---

## 4. UI foundation (from Section 25 + the inspirations + the hard farm context)

**Form factor:** primary target **10–12″ landscape tablet**; responsive **down to phone** (Section 25 is
phone-centric — workers may use phones) and up. The landscape width is used, not wasted.

**Visual language (grounded in GoTyme/MariBank, *inspiration only*):** a **hero status strip**, **large labeled
action tiles** for primary tasks, **card lists** with strong leading icons + a right-chevron affordance, **big bold
numerals** for the one key metric, **one strong accent color**, generous spacing. **Reject** dense multi-column
SaaS dashboards and AI-slop tropes (aggressive gradients, emoji bullets, rainbow palettes).

| Foundation rule | Decision | Source |
|---|---|---|
| **Navigation** | Persistent **left nav rail** (icon + label, large) on landscape tablet; collapses to **bottom nav** on phone widths. **Task-oriented home**: primary actions surfaced directly ("Record Harvest", not Menu→Production→Harvest→Create). Common tasks ≤ **3–5 taps**. | 25.01, 25.02; inspirations |
| **Layout** | **Two-pane master–detail** on tablet (list left, detail/form right) to use landscape width; single-column push-navigation on phone. Role-based home dashboards (Worker/Operator/Supervisor/Manager/Owner) showing only permission-appropriate info. | 25.02; resolver-gated |
| **Touch targets** | Primary interactive target **≥ 56–64 px** with **≥ 8 px** spacing (far exceeds WCAG 2.5.8 AA = 24 px and Material/Apple 44–48 px) — sized for **wet fingers and gloves**. **One-hand operation** for common actions. | 25.01, 25.14; WCAG 2.2 |
| **Typography** | Base body **≥ 18 px**, scalable **large-text mode**; heavy weight for primary numerals; **simple terminology**. | 25.01, 25.14 |
| **Color / contrast** | **High-contrast by default** (sunlight): dark text on light surface, text contrast **≥ 4.5:1 (AA)**; a **high-visibility mode** targets **≥ 7:1 (AAA)** and bumps size. Single accent for primary actions; status colors for sync/offline states. | 25.14; WCAG 2.2 |
| **Forms** | **Minimal typing** — buttons, dropdowns, **recents/favorites**, smart suggestions, **numpad** (V2 already has one); inline validation (Zod); **smart defaults**; **confirm before any effecting commit**. | 25.01, 25.05, 25.14 |
| **Error / offline states** | Explicit **offline indicator** (V2's `BackupBadge` analogue); **per-record sync status** (Pending / Confirmed / Conflict); provisional values clearly labeled "estimated until synced" (B5 §8); clear, plain-language errors; conflicts route to review with context. | 25.x; B5 §8/§11 |
| **Accessibility** | **WCAG 2.2 AA baseline** (keyboard, screen reader via Radix primitives, focus management, target size, contrast) + **large-text** + **high-contrast/high-visibility** + **simple-language** modes. | 25.14; WCAG 2.2 |
| **Internationalization** | **i18n from day one** — no hard-coded UI strings. **EN / Filipino / Cebuano** (more later), per-user choice. Start with a **typed message catalog + platform `Intl`** (dates/numbers/plurals); adopt a library only if interpolation/pluralization complexity demands it. | 25.14 |
| **Motion** | `motion` (installed) for **sparing** feedback micro-interactions only (taps, sync confirms). No decorative animation that costs battery or attention — "the interface disappears into the workflow" (25.14). | 25.01/25.14 |

---

## 5. Attack your own design (then fix it)

| # | Attack (farm reality) | Failure if undefended | Defense in this architecture |
|---|---|---|---|
| 1 | **Lost ack → device retries an inventory receipt 100×** | Duplicate stock / journals (the P4-01 hazard) | Idempotency key generated **at action time**, stored immutably in the Dexie queue row; server `UNIQUE (company_id, idempotency_key)` → at-most-once commit (B5 §1–§2). |
| 2 | **Permission revoked while a device is offline** | Stale device keeps acting with old rights | Server **re-authorizes every sync** (RLS); out-of-scope events **quarantined**, not committed; revoked-scope cache **purged on reconnect** (B5 §4). Offline grants **no new privilege**; the cached permission snapshot is **display-only**. |
| 3 | **Cached values shown as truth** | User trusts a stale balance | B5 §8 — offline shows **provisional/estimated, labeled**; authoritative only after server ack. Server is final authority. |
| 4 | **`service_role` key leaks into the client bundle** | Full DB compromise, bypasses RLS | Client ships **anon key only**; all privilege via RLS + resolver + SECURITY DEFINER RPC. Bootstrap (service_role) is an **operator/CLI** action. Build-time env separation + a CI check that the bundle contains no service key (§6). |
| 5 | **Cross-tenant cache bleed** on company/branch switch | Company A data visible under Company B | Cache **partitioned by `(company_id, branch_id)`**; switching scopes queries and **purges** out-of-scope cache; **RLS is the real server boundary** regardless. |
| 6 | **Bright sunlight, screen glare** | Worker can't read the screen | High-contrast default (dark-on-light), **high-visibility mode (≥7:1)**, large numerals, ≥56 px targets. |
| 7 | **Wet/gloved fingers, mis-taps near destructive actions** | Accidental deletes/edits | ≥56–64 px targets, ≥8 px spacing; destructive actions **confirmed** and **not adjacent** to common actions; no hard delete server-side anyway (status-based). |
| 8 | **Whole region reconnects at once** | Thundering-herd DB collapse | Backoff + jitter + batching + **server backpressure** + dead-letter + priority lanes (B5 §10) — in the sync worker (ships with the first high-frequency module). |
| 9 | **Multi-company / multi-branch growth** | Single-company assumptions break | Resolver + RLS scale tenancy server-side; the client carries a **company/branch switcher** and never assumes one company; `recharts` is fine at farm report scale. |
| 10 | **i18n bolted on later** | Costly retrofit, untranslated strings | i18n **from day one**; zero hard-coded UI strings; EN/Filipino/Cebuano. |
| 11 | **App shell unavailable offline** (vs. data) | Blank app with no connectivity | Separate concerns: **service worker (Workbox via `vite-plugin-pwa`) caches the app shell**; **Dexie caches data**. Don't conflate the two caches. PWA install for field tablets. |

---

## 5a. Architecture stress test — findings & hardening (binding rules)

The architecture was attacked across frontend scale, offline durability, API evolution, tablet UI, i18n, and
security (lost internet for days, device sleep, app crash mid-sync, power loss, duplicate submits, concurrent
edits). **No critical or High-risk defect invalidates the stack**, but the attack surfaced concrete gaps in every
area. Each is fixed below as a **binding rule** amending the section noted (17 rules). No conflict with Phase 1,
the B-series, or the C-series was found.

### Frontend — scale & maintainability
- **F1 — Route-level code splitting (amends §1).** Every module is a **lazy-loaded route** (React Router lazy
  modules / `React.lazy`). Initial bundle = app shell + session only; modules load on demand. This is what bounds a
  thousand-screen app's bundle — without it the SPA would not scale.
- **F2 — Scoped, indexed, paginated reads only (amends §1/§3; ties B3).** Dexie `useLiveQuery` is always **scoped
  by `company_id`/`branch_id`, index-backed, and paginated** — never an unbounded `toArray()`. Reactive reads are
  cheap only when bounded.
- **F3 — Split, stable contexts + module folders (amends §1).** App-global Context is **split** (session ·
  permission snapshot · branch scope · language · theme) and holds only **rarely-changing** values; volatile/
  per-screen data never enters global Context (prevents app-wide re-render storms). Structure: one feature folder
  per module — `app/modules/<module>/{screens,components,schema,api}` — a flat, predictable convention.

### Offline durability — crash / power loss / device sleep
- **O1 — Atomic write-ahead enqueue (amends §3).** An effecting action is **durably enqueued (event +
  idempotency key) in a single atomic IndexedDB transaction *before* the UI confirms it locally.** Either the event
  is on disk or the action never happened from the user's view — power loss cannot lose an "accepted" action.
- **O2 — Foreground/online-driven sync; Background Sync best-effort only (amends §3).** PWA Background Sync API
  support is unreliable on field tablets, so sync is driven by **app-foreground + `online` events** (always
  reliable); Background Sync is an enhancement, never the sole mechanism. The durable queue makes "drain on next
  open" always correct after sleep/close.
- **O3 — `Uploading` is crash-recoverable (amends §3).** On restart, any event left `Uploading` is **re-driven**
  (re-sent); server dedup on `(company_id, idempotency_key)` returns the prior result if it had committed, else
  commits. `Uploading` is never a terminal/lost state.
- **O4 — UI double-submit guard (amends §1/§4).** Effecting controls **disable + debounce on submit**, and the
  idempotency key is created in the **same synchronous handler** that enqueues — a double-tap cannot create two
  events.

### Concurrent edits — no silent overwrite (19.05)
- **C1 — Optimistic concurrency for mutable config (amends §3).** Edits to mutable config (company name, branch
  name/status, role description/status) carry the **last-synced `updated_at`**; on sync, if the server row is
  newer the write is **surfaced as a conflict, not silently applied** — honoring 19.05 ("offline must never
  silently overwrite newer server data"). Append-only/effecting events stay idempotent per B5 (unchanged).

### API — evolve without a rewrite
- **A1 — Thin transport-agnostic data-access layer (amends §2).** The UI **never** calls `supabase-js` directly;
  a single thin **`app/api/` module** exposes typed functions (`listBranches()`, `createBranch()`, `inviteUser()`…).
  Whether a call is PostgREST, an RPC, or a future Edge Function is an implementation detail behind that seam — so
  the PostgREST-first choice evolves **without a UI rewrite**. (One module — not an abstraction cathedral.)
- **A2 — Long-running/bulk ops are async (reserves §2).** Any future long op (bulk import, heavy report) uses an
  **enqueue → background → poll/realtime** job pattern, never a synchronous PostgREST request. None exist in M1.
- **A3 — Client permission checks are UX-only (amends §2/§5).** Client `has_permission`-driven gating is
  **cosmetic** (hide/disable); the **server (RLS + resolver) is the only boundary**. Confirmed: **Edge Functions
  remain unnecessary for M1** (no service_role client op, no server secret, invitation delivery out of scope).

### Tablet UI — the target is NOT a phone
- **U1 — Side rail, not bottom nav (amends §4).** Bottom navigation is a **phone** pattern and is **rejected for
  the 10–12″ landscape tablet** — the bottom edge of a wide landscape screen is a poor reach and conflicts with a
  two-handed/armed grip. The **persistent left rail** (large icon+label targets, left-edge reachable for one-handed
  glove use) is primary; bottom nav appears **only** in the narrow phone fallback (workers' phones).
- **U2 — Sunlight legibility hard rules (amends §4).** No gray-on-gray, **no thin font weights** (≥ medium body,
  bold numerals), no low-contrast placeholder-as-label. High-contrast default; high-visibility mode ≥ 7:1. Common
  tasks confirm in ≤ **3–5 taps** from the task-oriented home.

### Internationalization — EN / Filipino / Cebuano
- **I1 — Expansion-resilient layout (amends §4).** Filipino/Cebuano strings run ~**+20–35%** vs English. Layouts
  **wrap, never truncate** action labels; no fixed-width buttons; the ≥ 56 px target is preserved when text wraps;
  icon+text so meaning survives a wrap. Validated against the longest locale.
- **I2 — Locale fallback chain (amends §4).** A missing key falls back (Cebuano → Filipino → English) so a string
  is **never blank**; all UI text comes from the typed catalog (zero hard-coded strings).

### Security — Phase-1 model preserved
- **S1 — Cache-at-rest / device theft (amends §3/§5; ties 25.09).** IndexedDB is unencrypted at rest, so a lost
  field tablet is a threat. Mitigation: **cache only authorized-branch operational data** (B5 §4); **never cache
  top-sensitive data** (full payroll, company-wide financials) on field devices; rely on **OS full-disk encryption
  + screen lock + BYOD device-trust (25.09)**; **purge the scoped cache on logout, session revocation, or
  company/branch switch**. The cache is ephemeral and server-re-derivable.
- **S2 — Offline session lifecycle (amends §2/§3).** The Supabase **access token expires (~1 h) and refresh needs
  network**, but **offline operation must not require a live token**: the app reads the local cache and queues
  writes regardless of token state. On reconnect, **refresh the session**; if the refresh token has itself expired
  (very long offline) the user **re-authenticates**, after which the queue drains — events keep their original
  idempotency keys + creator identity and are **re-authorized by RLS at sync**, so correctness holds. The cached
  **permission snapshot governs display only**; the server re-authorizes every synced write → **no offline
  privilege escalation**. This preserves the Phase-1 boundary (RLS + resolver) exactly.

**Result:** 0 critical · 0 High-risk architectural defects · 0 contradiction with Phase 1 / B-series / C-series.
The stack stands; the 17 rules above are **binding** on Module 1C and every later Phase-2 UI module.

---

## 6. New dependencies introduced (each climbs the ladder — C1 §4)

| Dependency | Verdict | Why platform / installed dep is insufficient |
|---|---|---|
| `@supabase/supabase-js` | **Required** | The backend client (auth session + PostgREST + RPC + realtime). No platform equivalent. |
| `react-router-dom` (v7) | **Required** | Nested tablet layouts + auth/permission route guards + deep links across modules — beyond the bare History API. |
| `dexie-react-hooks` | **Required (tiny)** | Reactive local-first reads (`useLiveQuery`) over the already-installed Dexie. |
| `zod` | **Required** | One schema = validation + types + offline provisional validation + typed write contract (B5 §5). |
| `react-hook-form` | **Recommended** | Accessible error/focus across many forms. **Fallback:** native `<form>` + Zod-only if RHF proves unneeded. |
| `@radix-ui/*` (via shadcn/ui, copied in) | **Recommended** | Audited accessible primitives (dialog/dropdown/combobox/toast) — a11y is a non-negotiable boundary. Not a lock-in (we own the copied components). |
| `vite-plugin-pwa` (Workbox) | **Recommended** | Installable PWA + offline **app-shell** cache (distinct from Dexie data cache). May land at 1C. |
| i18n library | **Deferred** | Start with typed catalog + platform `Intl`; adopt `i18next` only if pluralization/interpolation grows. |

**Kept (installed):** react, react-dom, vite, typescript, tailwindcss/`@tailwindcss/vite`, dexie, lucide-react,
motion (sparing), recharts (reports), vitest. **Rejected:** Next.js, Redux/Zustand, TanStack Query, MUI/AntD/Chakra
— each either duplicates a platform/installed capability or imposes the SaaS-dashboard bloat ODR-001 rejects.

---

## 7. What M1B does NOT decide (scope discipline)

- **No application code, no migration, no schema.** Design only.
- **No pixel-level screens.** Concrete screens are produced per module and approved via the canonical UI pipeline
  (1C produces Organization Setup screens). This document fixes the **foundation**, not the layouts.
- **No new permission keys / RLS / DB objects** — those are migration work, owned by the per-module DB layer
  (P2-M1 already shipped Organization Setup's DB layer).
- **No sync-engine implementation** — specified here, built with the first high-frequency offline-write module.
- **No Edge Functions / realtime / email delivery** — reserved, added when a module needs them.

---

## 8. Verification of this document (design-doc "verify" = consistency, not a build)

- ✅ Consistent with the **locked foundation**: resolver names (`accessible_company_ids`, `has_permission`,
  `current_app_user_id`), the P2-M1 authenticated write grants, and `invite_user`/`accept_invitation` match the
  migrations verified in this session; `bootstrap_initial_tenant` correctly treated as service_role-only (never client).
- ✅ Consistent with **ODR-001** (replace-not-extend; fresh `app/`), **B5** (idempotency/offline/conflict),
  **ODR-003** (auth policy referenced, not redefined), **Section 25** (field usability), **WCAG 2.2** (targets/contrast).
- ✅ Self-attacked (§5) for offline integrity, security leakage, cross-tenant bleed, and farm-condition UX; each
  attack has a named defense.
- ✅ **Stress-tested (§5a)** — frontend scale, offline durability (crash/power-loss/sleep), concurrent-edit
  overwrite, API evolvability, tablet UI, i18n expansion, cache-at-rest, offline token expiry: **17 binding
  hardening rules**, **0 critical / 0 High-risk** defects, no Phase-1 / B-series / C-series conflict.
- ✅ Every new dependency justified against the ladder (§6); the SaaS-dashboard/bloat traps explicitly rejected.

---

## 9. Lock procedure (executed 2026-06-22, owner-directed)

1. ✅ Stress-tested (§5a) — survived; 17 binding hardening rules folded in.
2. ✅ Commit **docs-only** + update `Phase_2_Transition_Context.md` §0.1 (M1B → LOCKED) and the continuity memory.
3. ✅ Push `feature/phase-0-foundation` (docs-only — `verify`/`secrets`/`db-guards` unaffected; M1–M6 + P2-M1
   migrations untouched).
4. ✅ **M1B LOCKED** — the authority for **Module 1C (Organization Setup UI)** and every later Phase-2 UI module.

**Next:** Module **1C — Organization Setup UI specification** (`Phase_2_M1C_Organization_UI_Specification.md`,
built on this locked foundation), then Crop Management, Inventory, Daily Operations, Basic Reports — each on the
proven cadence (Design → Attack → Verify → Commit → Push → CI → Lock).
