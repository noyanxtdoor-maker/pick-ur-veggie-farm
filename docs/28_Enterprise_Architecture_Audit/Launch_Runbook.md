# Launch Runbook — Pick Ur Veggie ERP (Team A, official launch)

**Owner:** the business owner · **Audience:** ChatGPT 5.6 / Opus 4.8 / Sonnet 5 / future models ·
**Written:** 2026-07-11 by Fable 5 · **Rule:** every step is Action → Verification → Evidence. No step
is "done" without proof. Never round up in STATUS.md.

This runbook is the single ordered path from "Phases 1–6 built" to "launched", then the post-launch
duties. Each item says who does it (AGENT = a model, OWNER = a dashboard/human action) and its exit
proof. Work top to bottom; do not skip gates.

---

## SECTION 1 — Re-host on the NEW Vercel account (Track C redo)

The old Vercel project was deleted (shared account). Repo A gets its own account.

1. **OWNER:** create the new Vercel account/team for Team A. Then give the AGENT ONE of:
   - a Vercel **access token** (Account Settings → Tokens) — paste it once; the agent runs
     `vercel login --token <T>` (or `VERCEL_TOKEN=<T> npx vercel …`) and never stores it; OR
   - do the `npx vercel link` + first deploy yourself and just hand the AGENT the production URL.
   **What the agent needs from the new account:** the token (or a completed link) + confirmation the
   Supabase integration is attached (owner said it is). Nothing else — the two env vars are public.
2. **AGENT:** `vercel link` → set env (production): `VITE_SUPABASE_URL=https://aqhxhamdwmhcwxmebqbo.supabase.co`
   and `VITE_SUPABASE_ANON_KEY=<the anon key>` (anon ONLY — never service_role). `vercel.json` already
   in repo (SPA rewrites + SW no-cache). Deploy: `npx vercel deploy --prod`.
   **Evidence:** curl the new URL — `/`, `/login`, `/manifest.webmanifest`, `/sw.js` all 200; a real
   owner login reaches the dashboard.
3. **OWNER (Supabase dashboard):** Authentication → URL Configuration → Site URL = the new vercel.app
   domain; add `<domain>/**` to redirect allow-list (so reset emails + OAuth land on the live site).
4. **OWNER (Google Cloud Console):** OAuth client → Authorized JS origins = the new domain +
   `http://localhost:3000`; redirect URI = `https://aqhxhamdwmhcwxmebqbo.supabase.co/auth/v1/callback`.
   Paste Client ID/secret into Supabase → Providers → Google. **Evidence:** "Continue with Google"
   completes a sign-in that lands in the approval queue.

---

## SECTION 2 — Approvals & Roles hardening (P1C) — the owner's 2026-07-11 bug list

These are REAL bugs the owner found in production. Build them as one migration + app slice = **P1C**.
Each needs a guard battery and full-suite attack (money-adjacent auth domain).

**2.1 Google/email signups don't appear in the approval queue.**
Root cause to verify first (read the live `auth.users` vs `public.users`): the P1A signup trigger fires
on `auth.users` INSERT, but Google OAuth and some email confirmations may create the row via a path the
trigger misses, OR the ERP identity is created but `list_pending_users()` filters it out. AGENT: query
the live DB (owner supplies DB password) to see which. Fix so EVERY new auth identity (email or OAuth)
becomes a pending `public.users` row with zero memberships. Guard: insert an `auth.users` row with
`provider=google` in raw_app_meta_data → assert a pending `public.users` row exists and shows in
`list_pending_users()`.

**2.2 Approve dialog shows only 1 role — must offer the 5 tiers.**
The bootstrap seeds only an `owner` role per company. The approval UI must let the approver assign
Employee / Operator / Admin / Co-Owner / Owner. FIX: seed the 5 standard roles per company (in
bootstrap AND a backfill for the existing tenant), each with its correct permission-key set. Roles and
their keys (define precisely in the P1C spec; this is the intent):
- Employee: `pos.sell`, own-payroll read.
- Operator: + `pos.settle`, `inventory.*` inputs, `schedule.read`, cash-entry inputs.
- Admin: + `accounting.read/manage`, `product.manage`, `payroll.manage`, `customer.*`, `finance.account.*`.
- Co-Owner: all Admin + `membership.manage` + `role.manage` (everything except owner-only/dev config).
- Owner: full catalog incl. appointing Co-Owners.
Guard: each seeded role resolves exactly its intended keys via `has_permission`; approving with each
role lights up exactly that scope and nothing above it.

**2.3 After approval, the approved user's app must refresh automatically.**
The newly approved user is sitting on the AwaitingApproval screen. Their permission snapshot won't
update until a manual reload. FIX (app-side, no DB): the AwaitingApproval screen polls
`permissions.refresh()` on an interval (e.g. every 15s) AND on window-focus; the moment a membership
appears, it routes into the app. Also: after an approver assigns/changes/revokes a role, the CURRENT
user's own snapshot should re-derive (it already does via `refresh()` — verify). Evidence: browser E2E —
approve a pending user in one context, the other context enters the app within the poll window without a
manual refresh.

**2.4 Per-user permission overrides (the mockup's "Granular Custom Feature Permissions Override").**
The mockup shows per-feature toggles + a View-Only / Edit-&-Manage selector per user. CRITICAL: the
mockup stores these in Dexie only — that is THEATER (a determined user edits IndexedDB and grants
themselves anything). Team A builds it SERVER-ENFORCED: a `user_permission_overrides` table
(company + user + permission_key + effect grant/deny), RLS-gated to `membership.manage`, folded into
`has_permission` (deny overrides grant; grant adds a key the role lacks). This DOES evolve the
locked M4 resolver → it is a gated auth change: spec it, guard it (a user with a deny-override on
`pos.sell` cannot sell even though their role grants it; a grant-override lets a base Employee read
accounting; overrides are per-company and cannot cross tenants), owner sign-off, THEN build. The
"View Only vs Edit & Manage" selector maps to read-key vs manage-key pairs per feature.

**2.5 Role-based revoke authority.**
Only Owner and Co-Owner may revoke/reassign Admin, Operator, Employee. An Admin cannot revoke a peer or
above. The client already ranks tiers for guidance — but the SERVER must enforce it: `membership.manage`
is currently all-or-nothing. Add the rank check into the governed membership-assignment/revoke function
(an actor can only affect a target whose role rank is strictly below the actor's). Owner may grant
Co-Owner the key or withhold it (Owner-only toggle). Guard: an Admin's revoke of another Admin returns
`insufficient_privilege`; a Co-Owner can revoke an Admin; nobody but Owner creates a Co-Owner.

**2.6 Invitations don't send email.**
`invite_user()` writes an `invitations` row but nothing emails the invitee (Supabase Auth's invite/
admin API was never wired). FIX options, cheapest first: (a) generate the accept link and let the
approver copy/send it (works today, zero infra); (b) call Supabase Auth admin `inviteUserByEmail` from
an Edge Function (needs service_role server-side — never in the browser). Ship (a) now with a "Copy
invite link" button; spec (b) for when the Edge-Function phase runs. Evidence: creating an invite
yields a working `/accept?token=…` link that, when opened, joins the invitee at the invited scope.

**2.7 Remove the top-bar Sign-Out button.** Users log out from Settings → Session only. (Pure app edit;
do it in the same slice — it's trivial and the owner asked.)

**Screenshot-3 meaning (owner asked):** it is the mockup's per-user override panel — feature rows with
an ACCESS toggle and a "View Only / Edit & Manage" dropdown, noted "Stored securely in Dexie IndexedDB."
That Dexie-only storage is exactly the security hole §2.4 fixes by moving enforcement to the server.

---

## SECTION 3 — Remaining launch gates (in order)

1. **B2A digital-payments LOCK REVIEW** — hand `Phase_2_B2A_Lock_Review_Request.md` to the cross-vendor
   reviewer; on GO + owner sign-off, B2A locks. (Payments already built + guarded; this is the gate.)
2. **Full-suite attack on the launch candidate** — `supabase db reset` from zero + every guard battery
   green + `tsc` + `vitest` + `build` + CI green on the tip. Record the numbers in STATUS.md §1.
3. **Real-cloud E2E of the money spine** on the hosted site: login → POS sale → verify the journal via
   psql → settle a pre-order → void one → confirm balances tie. This is the one path STATUS.md still
   flags as needing a live run per feature.
4. **MFA enrollment for privileged roles** (ODR-003): enable in Supabase → Auth → MFA; enroll the owner;
   app-side enforcement UI is a follow-up but the toggle + owner enrollment is a launch item.
5. **Branch protection** — **NOT yet applied on Repo A** (owner chose "make public" 2026-07-11, but the
   provided PAT lacked *Administration:write*, so neither the visibility flip nor the ruleset could be set
   by the agent). OWNER, two clicks: (a) GitHub → repo → Settings → General → Danger Zone → **Change
   visibility → Public**; (b) Settings → **Rules → Rulesets → New branch ruleset**, apply the settings in
   `Phase_7_Branch_Protection_RepoA.md` (name `protect-main-and-develop`, targets `main`+`develop`,
   enforcement Active). OR re-issue the PAT with *Administration: Read and write* and the agent applies it
   via the API in one call. Repo B's ruleset is already Active (id 18794543).
6. **Google Play packaging (Track E)** — only after §1 gives a stable HTTPS domain: generate PNG icons,
   `npx @bubblewrap/cli init --manifest https://<domain>/manifest.webmanifest` in a SIBLING folder
   (NEVER inside the repo), build the signed AAB, write `/.well-known/assetlinks.json` with the signing
   fingerprint, OWNER submits via Play Console.
7. **Backups & DR (B7)** — Supabase free tier = daily backups only; PITR needs a paid plan. Decide at
   launch. Run one restore drill (B7 §12: "a backup never restored is only a theory").

---

## SECTION 4 — AFTER launch (duties, not suggestions)

1. **Watch the money.** Weekly: run `trial_balance` + `balance_sheet` on live data and confirm they
   tie; any drift is a P0 incident (reconcile via the reversal paths, never a manual UPDATE).
2. **Watch security.** Weekly: re-run the full guard suite against a fresh `db reset`; review
   `audit_events` for break-glass usage, cross-tenant denials, mass exports. Rotate the DB password on
   any suspicion. Keep RLS forced on every new table (the drift guard enforces schema, not intent —
   read new policies by eye).
3. **Real backups + a monthly restore drill.** Prove a tenant-scoped restore works before you need it.
4. **Onboarding polish from real use** — the first real employees will surface confusing flows; fix the
   top 3 friction points before adding features.
5. **Then, and only then, new capability:** CAP-VG1 step 5 (cloud copilot Edge Function), B2 real
   payment-gateway reconciliation, richer reports, the deferred masters (suppliers/UOM) IF real
   operations demand them (they were deferred as YAGNI — let demand, not appetite, pull them in).
6. **Performance & cost:** watch Supabase egress + Vercel bandwidth; the derived-balance reads are the
   heaviest queries — add indexes only when a real slow query proves the need (measure first).
7. **Keep the docs honest.** STATUS.md, the handoff, and the Team-B handoffs stay current every session.
   A stale source-of-truth is how a project lies to itself.

---

## SECTION 5 — The advisor cost pattern (owner's cost question)

Default day-to-day to a cheaper executor (Sonnet 5 / ChatGPT 5.6); escalate to Opus 4.8 (or Fable-class)
ONLY for: money-path migrations, security reviews, and stuck-debugging that a cheaper model has circled
on twice. The guard suite + CI + this runbook are the guardrails that make a cheaper executor safe —
they catch what it misses. Do not run a stronger model on mechanical work (renames, wiring, doc updates).
