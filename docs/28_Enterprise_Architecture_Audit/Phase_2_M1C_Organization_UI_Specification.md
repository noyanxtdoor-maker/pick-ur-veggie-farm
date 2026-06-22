# Phase 2 — Module 1C · Organization Setup UI Specification

**Type:** UI specification (design only — **no React code, no implementation**) · **Status:** ✅ **COMPLETE**
**Date:** 2026-06-22 · **Branch:** `feature/phase-0-foundation`
**Authority basis:** locked **M1B** application architecture (`Phase_2_M1B_V3_Application_Architecture.md`, incl. its
17 binding hardening rules), the locked **Module 1A** DB layer (`a26b667` / `…_p2m1_organization_setup.sql`),
**Section 25** field usability, `docs/14_UI_References/` (GoTyme/MariBank = inspiration only), **B5** offline,
**B1/C7 §0** (resolver/RLS, never role names).

> Purpose: a **complete, implementation-ready** UI spec for Organization Setup that M1D can build rapidly. Every
> screen is mapped to a **real P2-M1 capability** (permission key, RLS policy, column-scoped grant, or SECURITY
> DEFINER function). Where the requested UI exceeds what the locked DB supports, the gap is **flagged honestly**
> in §10 — not faked. No new DB objects are created here.

---

## 1. The binding contract — screens ↔ real P2-M1 capabilities

This is the spine of the spec: the UI may only do what the locked database actually permits.

| UI capability | Real DB operation (P2-M1) | Permission gate | Notes / immutability |
|---|---|---|---|
| View company | `select companies` (member via `accessible_company_ids()`) | company membership | — |
| Edit company **name** | `update companies set name` (column-scoped grant) | **`company.manage`** | `company_code`, `base_currency_code`, `id` **immutable** (no grant). **Company `status` is service_role-only** → **NOT** an owner action. |
| List branches | `select branches` (member) | company membership | member sees the company's branches (incl. suspended) |
| Create branch | `insert branches (company_id, branch_code, name)` | **`branch.manage`** | `branch_code` set at create, **immutable** after |
| Edit branch **name/status** | `update branches set name,status` | **`branch.manage`** | status ∈ {Active, Suspended, Archived} |
| List roles | `select roles` (member) | company membership | — |
| Create role | `insert roles (company_id, role_key, description)` | **`role.manage`** | `role_key` **immutable** after create |
| Edit role **description/status** | `update roles set description,status` | **`role.manage`** | status ∈ {Active, Deprecated} |
| Add permission to role | `insert role_permissions (company_id, role_id, permission_id)` | **`role.manage`** | composite FK forces same-company role |
| **Remove** permission from role | — **NONE** (mapping is immutable, M3: no UPDATE/DELETE) | — | ⚠️ **unsupported** — to "remove", deprecate the role + create a new one (§10-G1) |
| View permission catalog + descriptions | `select permissions` (read-all-authenticated) | any authenticated | global catalog; capability keys + descriptions |
| Create invitation | `invite_user(company, branch, role, email, valid_days)` → token | **`user.invite`** | composite FK blocks cross-company branch/role; audited |
| Accept invitation | `accept_invitation(token)` → membership | the invitee (any authenticated, token = capability) | single-use (status+row lock), expiry enforced; audited |
| List invitations | `select invitations` | **`user.invite`** | status ∈ {Pending, Accepted, Revoked, Expired} |
| **Revoke** invitation | — **NONE** (no `revoke_invitation` function yet) | — | ⚠️ **gap** — status `Revoked` exists but no client path sets it (§10-G2) |
| List memberships / users in company | `select user_branch_roles` (own + **`membership.read`**) joined `users` (self + **`user.read`**) | **`membership.read`** (+ `user.read` for names) | — |
| Assign membership (role to user) | `insert user_branch_roles (user,company,branch,role)` | **`membership.manage`** | composite FKs force same-company branch+role |
| Suspend / expire membership | `update user_branch_roles set assignment_status,expires_at` | **`membership.manage`** | assignment_status ∈ **{Active, Expired}** — **no "Suspended"** (§10-G3); "suspend" UI verb = set **Expired** |
| Bootstrap first tenant | `bootstrap_initial_tenant(...)` | **service_role only** | ⚠️ **operator/CLI action — NOT an owner app screen** (§8.1) |

**Permission catalog after M6 seed + P2-M1 (8 keys):** `user.read`, `membership.read`, `audit.read`,
`company.manage`, `branch.manage`, `role.manage`, `user.invite`, `membership.manage`. A bootstrapped Owner holds
**all active keys**.

**Hardening rules inherited from M1B (applied throughout):** A3 (client gating is UX-only; server is the
boundary), A1 (all calls go through `app/api/`), O1/O4 (atomic write-ahead + double-submit guard), C1 (optimistic
concurrency on config edits), U1 (left rail, not bottom nav), U2 (sunlight legibility), I1/I2 (text expansion +
fallback), S1/S2 (cache-at-rest + offline session).

---

## 2. Navigation model

Per **M1B U1**: persistent **left navigation rail** on the 10–12″ landscape tablet (bottom nav rejected as a phone
pattern). Rail items are **icon + label**, ≥ 56–64 px tall, left-edge reachable for one-handed glove use. Each item
is **permission-gated** (A3 cosmetic gating — a member who lacks `branch.manage` still *sees* branches read-only;
an item with no readable content is hidden).

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│  PICKURVEGGIE│  [ Company switcher ▾ ]      [ ⚡offline ] [ 🔔 ] [ 👤 ]   │ top bar
│              ├──────────────────────────────────────────────────────────┤
│ ▣ Dashboard  │                                                          │
│ ⌂ Company    │                  MAIN WORK AREA                          │
│ ⌥ Branches   │            (two-pane master–detail on tablet)            │
│ ⊞ Roles      │                                                          │
│ ✉ Invitations│                                                          │
│ ⚇ Members    │                                                          │
│ ─────────    │                                                          │
│ ⚙ Settings   │                                                          │
│ Lang: EN ▾   │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```

- **Top bar:** company/branch switcher (multi-company aware — M1B scalability), **offline/sync badge** (S1/S2),
  notifications, user menu (profile, language, theme/high-vis, sign out → purges scoped cache S1).
- **Rail order = task frequency** (Dashboard first). Items: Dashboard · Company · Branches · Roles · Invitations ·
  Members · Settings.
- **Phone fallback** (workers' phones, secondary): rail collapses to a bottom nav of the top 4 + "More".

---

## 3. Screen hierarchy (route tree — M1B React Router, each route lazy-loaded F1)

```
/                         → redirect to /dashboard
/dashboard                → Owner/Admin Dashboard (§8.2)         [member]
/company                  → Company Settings (§8.3)              [member; edit=company.manage]
/branches                 → Branch list (master)                 [member]
/branches/new             → Create branch (detail pane)          [branch.manage]
/branches/:id             → Branch detail/edit (detail pane)     [member; edit=branch.manage]
/roles                    → Role list (master)                   [member]
/roles/new                → Create role                          [role.manage]
/roles/:id                → Role detail: info + permissions      [member; edit=role.manage]
/invitations              → Invitation list (master)             [user.invite]
/invitations/new          → Invite user (detail pane)            [user.invite]
/invitations/:id          → Invitation detail (status/actions)   [user.invite]
/members                  → Member/user list (master)            [membership.read]
/members/:membershipId    → Membership detail (roles/status)     [membership.read; edit=membership.manage]
/accept?token=…           → Accept invitation (standalone)       [any authenticated]
─ operator surface (separate, service_role) ─
/operator/bootstrap       → Bootstrap first tenant (§8.1)        [OPERATOR ONLY — not the owner app]
```

A **route guard** redirects unauthenticated → login; a **permission guard** on `*/new` and edit actions hides/
disables controls when the cached permission snapshot lacks the key (A3 — server RLS still enforces).

---

## 4. Global UI states (defined once, applied to every screen — DRY)

Every list and detail screen implements these five states with shared components (§5). Specced once here; per-screen
sections reference them.

| State | Trigger | Presentation |
|---|---|---|
| **Loading** | first read not yet resolved from cache/server | skeleton rows/cards (not a spinner-only blank); ≤ instant from warm Dexie cache |
| **Empty** | query resolved, 0 rows | `EmptyState`: friendly line + the primary create action (if permitted), e.g. "No branches yet — Create your first branch" |
| **Error** | read/write failed (not offline) | `ErrorState`: plain-language cause + Retry; never a raw SQL/HTTP code; errors logged |
| **Offline** | `navigator.onLine` false or token unrefreshable | `OfflineBanner` (persistent, top): "Working offline — changes will sync when you reconnect." Reads served from cache; writes queued (O1). Server-derived/uncertain values labeled "estimated" (B5 §8). |
| **Conflict** | sync rejected by optimistic-concurrency (C1) or server | `ConflictCard` on the affected record: shows mine vs server, "Keep server / Re-apply mine"; financial/permission conflicts route to review (B5 §7). |
| **Pending/Sync** | local write not yet confirmed | per-row `SyncBadge`: Pending → Uploading → Confirmed (or Conflict). Pending rows visually distinct (e.g. dotted border + clock icon). |

**Confirm-before-commit (Section 25 error prevention):** every effecting action (create/edit/suspend/archive/
invite/revoke/assign) opens a `ConfirmDialog` summarizing the change before it is enqueued.

---

## 5. Component inventory (shared kit — built once in M1D, reused everywhere)

Sized to M1B tokens: primary target ≥ 56–64 px, body ≥ 18 px, ≥ medium weight, high-contrast, icon+label, wrap-not-
truncate (I1). Interactive overlays use shadcn/ui (Radix) for accessibility.

| Component | Role |
|---|---|
| `AppShell` | left `NavRail` + `TopBar` (company switcher, offline/sync badge, user menu) + routed work area |
| `NavRail` / `BottomNav` | permission-gated nav (tablet rail / phone fallback) |
| `Card`, `StatCard` | dashboard cards; `StatCard` shows a big bold numeral + label (inspiration pattern) |
| `ActionTile` | large labeled primary action (icon + verb), ≥ 64 px — "Create Branch", "Invite User" |
| `MasterList` | scrollable, **scoped/indexed/paginated** (F2) list of rows; search + filter; row → detail |
| `DetailPane` | right pane (tablet) / pushed screen (phone) showing/editing one record |
| `Field` set | `TextField`, `Select`, `Numpad`, `Toggle`, `ReadOnlyField` (immutable identifiers), inline error slot |
| `StatusBadge` | entity status (Active/Suspended/Archived/Deprecated/Expired/Pending…) — color + label + icon (never color alone, a11y) |
| `SyncBadge` | per-record Pending/Uploading/Confirmed/Conflict |
| `ConfirmDialog`, `Toast` | confirm effecting actions; transient success/failure feedback |
| `EmptyState`, `ErrorState`, `OfflineBanner`, `ConflictCard` | the §4 global states |
| `PermissionGate` | wraps an action; hides/disables by cached permission (A3 cosmetic) |
| `TokenChip` / `CopyField` | display + copy an invitation token (the capability is delivered out of band) |

---

## 6. Form rules & validation behavior (M1B: Zod + RHF; minimal typing — Section 25)

- **Minimal typing:** prefer `Select`, recents/favorites, `Numpad` for numeric; free text only for names/
  descriptions/email.
- **Immutable identifiers are shown as `ReadOnlyField`** (greyed, with a small lock icon + tooltip "Set at
  creation — cannot be changed"): `company_code`, `base_currency_code`, `branch_code` (after create), `role_key`
  (after create). This makes the §1 immutability visible, not a surprise error.
- **Validation (Zod schema per form, reused as the offline provisional check — B5 §5):**
  | Field | Rule |
  |---|---|
  | company.name / branch.name / role.description | required, trimmed, 1–120 chars |
  | branch.branch_code / role.role_key | required at create, slug `^[A-Z0-9][A-Z0-9-]{1,30}$`, **uniqueness is server-enforced** (UNIQUE(company_id, code)); client shows the conflict error on sync |
  | invitation.email | optional, valid email if present (informational; delivery out of scope) |
  | invitation.valid_days | int 1–30, default **7** (smart default) |
  | status / role / branch selects | must be a current enum/option value |
- **Inline, on-blur validation** with a clear message under the field; submit disabled until valid (O4 also
  disables on submit to block double-tap).
- **Server-only constraints** (code uniqueness, permission denial, composite-FK cross-company) surface as a
  `ConflictCard`/`ErrorState` in plain language after the attempt — the client cannot pre-know uniqueness offline.
- **Optimistic concurrency (C1):** edit forms carry the record's last-synced `updated_at`; a stale edit → conflict,
  never silent overwrite.

---

## 7. Wireframe sketches (layout intent, not pixels)

**Owner Dashboard (card grid) — §8.2**
```
┌────────────────────────────────────────────────────────────────────┐
│  Good morning, Owner.            Company A • Active        ⚡ Synced   │
├───────────────┬───────────────┬───────────────┬────────────────────┤
│  COMPANY      │  BRANCHES      │  MEMBERS       │  PENDING INVITES   │
│  ✓ Active     │      3         │      12        │       2            │
│  CO-A · PHP   │  view →        │  view →        │  view →            │
├───────────────┴───────────────┴───────────────┴────────────────────┤
│  QUICK ACTIONS                                                       │
│  [ + Create Branch ] [ + Invite User ] [ + Create Role ] [ Company ] │  ← ActionTiles, ≥64px, perm-gated
├─────────────────────────────────────────────────────────────────────┤
│  RECENT ACTIVITY (from audit_events, audit.read)                     │
│  • invitation.accepted — Branch A1 — 2h ago                          │
│  • user.invited — Branch A1 — 3h ago                                 │
└─────────────────────────────────────────────────────────────────────┘
```

**List + detail (two-pane) — Branches / Roles / Invitations / Members — §8.4–8.7**
```
┌───────────────── master ─────────────┬──────────────── detail ───────────────┐
│ Branches            [ 🔍 ] [+ New ]   │  Branch A1                  ⚡ Confirmed │
│ ───────────────────────────────────  │  ───────────────────────────────────── │
│ ▸ Branch A1   Active      ⚡          │  Code   BR-A1  🔒 (immutable)           │
│   Branch A2   Active      ⏳Pending   │  Name   [ Branch A1            ]         │
│   Old Shed    Suspended               │  Status [ Active ▾ ]                    │
│                                       │  ─────────────────────────────────────│
│ (scoped, indexed, paginated — F2)     │  [ Save ]   [ Suspend ] [ Archive ]     │  ← edit=branch.manage; confirm
└───────────────────────────────────────┴─────────────────────────────────────────┘
```

**Form (Create branch / Invite user) — single detail pane, minimal typing**
```
Invite User                                   (gate: user.invite)
  Branch   [ Select branch ▾ ]      ← company's branches only
  Role     [ Select role ▾   ]      ← company's roles only
  Email    [ optional        ]      (informational)
  Expires  [ 7 ] days  (1–30)       ← Numpad, default 7
  ───────────────────────────────
  [ Create invitation ]  → ConfirmDialog → token shown in CopyField + status=Pending
```

---

## 8. Screen specifications

Each screen: **route · permission · purpose · layout · data · actions · states · offline**.

### 8.1 Bootstrap Administration (operator surface — NOT the owner app)
- **Route:** `/operator/bootstrap` · **Permission:** **service_role / operator only** (M1B: `bootstrap_initial_tenant`
  is service_role-only; never a client capability).
- **Security boundary (critical):** this is **not** part of the authenticated owner/worker app and must never be
  reachable with an anon/authenticated session. It is an **operator tool** (internal admin surface or CLI front-end)
  that runs the one-time `bootstrap_initial_tenant(owner_auth_id, display_name, company_code/name, branch_code/name)`
  via a privileged server context. Per M1B A3/S, the field app ships **only the anon key**; this surface is
  deployed/served separately with operator credentials.
- **Operator workflow (3–5 fields, one action):** enter owner auth id + display name, company code/name, branch
  code/name → **Confirm** → call the function (atomic: Company#1 → Branch#1 → Owner user/role/all-perms/membership →
  3 audit events → completion flag).
- **States:** **Success** → "System initialized. Company A created; owner provisioned." + the created `company_id`.
  **Failure** → the function is atomic (full rollback, no orphans): show the plain-language cause — already
  bootstrapped (`bootstrap_state.completed` / company exists), unauthorized (not service_role), or validation. The
  control is **one-time**: once `completed`, the screen shows "Already initialized" and disables the action
  (mirrors the irreversible `bootstrap_state`).
- **Offline:** N/A (privileged online operator action).

### 8.2 Owner Dashboard
- **Route:** `/dashboard` · **Permission:** any company member (each card gated by its own read permission — A3).
- **Purpose:** at-a-glance org health + quick actions (card-based, inspiration pattern; role-based per 25.02).
- **Layout:** greeting + company status line; **StatCard grid** (Company status · Branch count · Member count ·
  Pending invitations); **ActionTiles** (Create Branch / Invite User / Create Role / Open Company — each perm-gated);
  **Recent Activity** from `audit_events` (only if `audit.read`).
- **Data:** company (member read), `count(branches)`, `count(distinct members)`, `count(invitations status=Pending)`
  (only if `user.invite`), recent `audit_events` (only if `audit.read`).
- **Actions:** each ActionTile routes to the relevant create flow (hidden if the key is absent).
- **States:** Loading=skeleton cards; Empty (fresh tenant)=counts show 0 and tiles guide first steps; Offline=cards
  read from cache, badge shows "estimated"; Error=per-card retry.

### 8.3 Company Settings
- **Route:** `/company` · **Permission:** view=member; edit=**`company.manage`**.
- **Layout (single detail):** `ReadOnlyField` **Company code** (🔒), **Base currency** (🔒, PHP), **Status** (🔒 —
  read-only here: company status is service_role-only, **not** owner-editable; show current value with a note
  "Managed by platform"); editable **Name** (`TextField`).
- **Actions:** **Save name** (company.manage) → Confirm → enqueue update (C1 optimistic concurrency).
- **States:** standard; Save disabled without `company.manage` (PermissionGate); name change shows SyncBadge until
  Confirmed.

### 8.4 Branch Management
- **Routes:** `/branches` (list), `/branches/new`, `/branches/:id` · **Permission:** view=member; create/edit=
  **`branch.manage`**.
- **List (master):** columns Name · Status badge · SyncBadge; search; `+ New` (gated). Scoped/indexed/paginated (F2).
- **Create (`/branches/new`):** fields **Branch code** (slug, set-once), **Name**; Save → Confirm → enqueue insert.
- **Edit (`/branches/:id`):** `ReadOnlyField` code (🔒); editable **Name**, **Status** select {Active, Suspended,
  Archived}. **Suspend** = set Suspended; **Archive** = set Archived (both via the status update; confirm dialog
  warns "Suspending a branch hides it from operations"). No hard delete (status only — Phase-1 rule).
- **States:** Empty="No branches yet — Create your first branch"; Conflict on stale edit (C1); Offline=create/edit
  queue with Pending badge.

### 8.5 Role Management
- **Routes:** `/roles` (list), `/roles/new`, `/roles/:id` · **Permission:** view=member; create/edit/assign=
  **`role.manage`**.
- **List:** Role key · Description · Status · SyncBadge; `+ New` (gated).
- **Create:** **Role key** (slug, set-once), **Description**; Save → Confirm → insert.
- **Detail (`/roles/:id`):** read-only **Role key** (🔒); editable **Description**, **Status** {Active, Deprecated};
  **Permissions panel** — lists the role's granted permission keys + descriptions (from the global `permissions`
  catalog), and an **"Add permission"** picker (multi-select from the catalog) → inserts `role_permissions`
  (role.manage). **No "remove permission" control** — per §1 the mapping is immutable; the panel shows a note:
  "Permissions can be added but not removed. To reduce a role, deprecate it and create a new role." (§10-G1).
- **States:** Empty role list (fresh tenant has the Owner role only); Add-permission confirm; Pending badges.

### 8.6 Invitations
- **Routes:** `/invitations` (list), `/invitations/new`, `/invitations/:id`, `/accept` (standalone) ·
  **Permission:** manage=**`user.invite`**; accept=any authenticated (token is the capability).
- **Invite (`/invitations/new`):** **Branch** select (company branches), **Role** select (company roles), **Email**
  (optional), **Expires in** days (Numpad, 1–30, default 7) → Confirm → `invite_user(...)` RPC → returns **token**
  shown in a `CopyField`/`TokenChip` with "Copy & share securely (delivered out of band)". New row status=Pending.
- **List:** Email/branch/role · Status badge {Pending, Accepted, Revoked, Expired} · Expiry date · SyncBadge.
- **Detail (`/invitations/:id`):** full info; **Resend/Copy token** (Pending only); **Revoke** button — ⚠️ **see
  §10-G2: no `revoke_invitation` function exists yet**, so the control is specified but **disabled with a tooltip**
  ("Revocation requires a server function — pending M1D dependency") until the small DB addition lands. Expiration is
  **automatic** (server: `accept_invitation` rejects+marks Expired past `expires_at`); the list reflects it.
- **Accept (`/accept?token=`):** invitee opens the link → signs in → `accept_invitation(token)` → success="You've
  joined Company A / Branch A1 as Worker" or error (invalid/used/expired) in plain language. Single-use enforced
  server-side.
- **Offline:** invite creation **requires connectivity** (RPC) — if offline, queue is *not* used for invite (it
  returns a live token); show "Reconnect to send invitations." (Reserve queued-invite for later; YAGNI now.)

### 8.7 Membership Management
- **Routes:** `/members` (list), `/members/:membershipId` · **Permission:** view=**`membership.read`** (+
  **`user.read`** for display names); assign/change=**`membership.manage`**.
- **List:** User display name · Branch · Role · Status badge {Active, Expired} · Expiry date · SyncBadge. Built from
  `user_branch_roles` joined to `users`. `+ Assign membership` (gated).
- **Assign:** **User** (existing ERP user in scope) · **Branch** · **Role** → Confirm → insert `user_branch_roles`
  (membership.manage). *(Note: inviting a brand-new person is the Invitations flow §8.6; this assigns an additional
  membership to a user who already exists in the company scope.)*
- **Detail (`/members/:membershipId`):** shows user + branch + role (all set-once / immutable subject-scope per §1);
  editable **Status** {Active, Expired} and **Expiry date**. **"Suspend" UI verb maps to `Expired`** (§10-G3); a
  confirm dialog clarifies "Setting Expired immediately removes this access." Set an **Expiry date** to schedule
  automatic expiry. No hard delete.
- **States:** Empty (only the Owner membership on a fresh tenant); Conflict (C1) on stale status edits; Pending badges.

---

## 9. Offline / error / loading / empty / conflict behavior (cross-cutting summary)

All per §4. Module-specific notes:
- **Reads** (dashboard counts, lists, details) are **local-first** from Dexie, scoped to the active company/branch
  (F2, S1) — fully usable offline; values that are server-derived are labeled "estimated" (B5 §8).
- **Config writes** (company name, branch, role, role_permission add, membership status) are **queued offline**
  (O1 atomic write-ahead) with Pending→Confirmed SyncBadges; **C1** optimistic concurrency prevents silent
  overwrite.
- **RPC actions** (`invite_user`, `accept_invitation`) **require connectivity** in M1C (live token / live accept) —
  clearly messaged when offline; not queued (YAGNI; revisit if field invites become a need).
- **Permission loss while offline** → on reconnect, out-of-scope queued writes are rejected by RLS and surfaced for
  review; scoped cache purged (S1/S2).
- **Session expiry offline** → app keeps working on cache; refresh on reconnect; if refresh token expired →
  re-auth, then queue drains with original idempotency keys (S2).

---

## 10. Gaps surfaced by this spec (honest flags — resolve before/with M1D)

The DB layer (M1A) predates this UI; three requested controls have **no current DB path**. None block the spec, but
each needs a **small additive migration** (its own attack + guard + CI lock) before M1D wires the control — or the
control ships disabled.

- **G1 — Role permission *removal* unsupported.** `role_permissions` is immutable by design (M3). UI offers add-only
  and explains the deprecate-and-recreate path. *Option for later:* a revocation-lifecycle migration (out of M1 scope;
  handoff §11 M3 carryover). **M1C decision:** no remove control; document the workaround in-UI.
- **G2 — Invitation *revoke* has no function.** Status `Revoked` exists but nothing client-callable sets it.
  *Resolution:* a tiny `revoke_invitation(invitation_id)` SECURITY DEFINER function gated by `user.invite`
  (audited), mirroring `invite_user`. **M1C decision:** spec the Revoke control but ship it **disabled** until that
  function lands (a small P2-M1.x migration on the proven cadence). Expiration (automatic) covers the common case
  meanwhile.
- **G3 — Membership "Suspended" state doesn't exist.** `user_branch_roles.assignment_status` ∈ {Active, Expired}
  only. **M1C decision:** map the "suspend" verb to **Expired** (immediate) + use `expires_at` for scheduled
  expiry; no schema change needed. If a reversible "suspended ≠ expired" distinction is later required, that's an
  additive enum migration (flag only).

*(G1/G3 are design decisions requiring no migration; only G2 implies a tiny future migration, and its control ships
disabled until then — so M1C is internally complete and implementable now.)*

---

## 11. Verification

- ✅ **Every screen maps to a real P2-M1 capability** (§1) — permission keys, RLS policies, column-scoped grants,
  and the `invite_user`/`accept_invitation` functions all match the locked migration `a26b667` verified this session;
  `bootstrap_initial_tenant` correctly isolated to an operator surface (§8.1), never the client.
- ✅ **Consistent with M1B** — left rail (U1), tokens/contrast (U2), Zod+RHF forms (§6), `app/api/` seam (A1),
  offline states (O1/O4/C1/S1/S2), text expansion (I1/I2), local-first scoped reads (F2).
- ✅ **Consistent with Section 25** — task-oriented, ≤ 3–5 taps, large targets, minimal typing, confirm-to-commit,
  role-based dashboard, multilingual.
- ✅ **No DB change made**; the three capability gaps (§10) are flagged, with G2 deferred to a tiny future migration
  and its control shipped disabled — the spec is internally complete and implementable as-is.
- ✅ All five required state families specified (loading/empty/error/offline/conflict + pending/sync) and applied
  per screen.

---

## 12. Status & next

```
Phase 2
  Module 1A — Organization Backend        ██████████ LOCKED (run #23)
  Module 1B — V3 Application Architecture ██████████ LOCKED (stress-tested)
  Module 1C — Organization UI Spec        ██████████ COMPLETE
  Module 1D — V3 App Implementation       ⏭ NEXT
```

**Next:** Module **1D — V3 App Implementation** — scaffold the V3 `app/` (M1B stack), build the shared component kit
(§5), implement the Organization screens (§8) against the `app/api/` layer, and resolve **G2** (tiny
`revoke_invitation` migration on the proven cadence) so the Revoke control can enable. Cadence unchanged:
Build → Attack → Verify → Commit → Push → CI → Lock.
