# Handoff 007 — P1O product-removal workflow, Google OAuth 3-layer fix, Usage Summary column, 2026-07-17

**Direction note:** original work in Repo A, not a port from either direction. Sharing because the
Google OAuth fix in particular contains a gotcha (PKCE breaking cross-device password reset) that's easy
to reintroduce if you ever touch `flowType` on your own Supabase client, and because the P1O
tiered-permission pattern may be a useful template if you build a similar "some roles request, others
decide" workflow.

## 1. P1O — POS product-removal request/approval workflow

**What/why:** owner directive — rename "Archive" to "Remove" in the POS Crop Pricing Menu, require a
confirmation step, and let employee/operator (who previously had zero access to that dialog) request a
removal instead of doing it instantly. `product.manage` holders (admin+) still remove instantly with no
queue; `product.remove`-only holders (employee/operator by default) queue a Pending request that a
`product.manage` holder must approve or reject.

**Pattern, if useful:** this is a THIRD shape of "gate an action by two tiers," distinct from two we'd
already built — P1M's separation-of-duties (two peers of the SAME tier check each other) and P1M.2's
rank-based instant-vs-queued split (same key, different rank thresholds). P1O introduces a genuinely
*lesser* permission key (`product.remove`) that can only request, alongside the existing full key
(`product.manage`) that both acts instantly AND decides on others' requests. If you ever need "junior
roles can propose, senior roles execute or approve," this is the shape: a new lesser key, a request
table with a partial unique index (`... where status='Pending'`) enforcing one open request per subject
at the DB level (not just an app-level pre-check — matters under concurrent requests), and the SAME
"decider != requester" self-check even when the requester later gains the senior key via an override.

**One thing our own adversarial review caught that's worth checking in your equivalent, if you build
one:** our first guard draft for this feature tested the self-approve-denial case (requester gains
`product.manage` via override, tries to approve their own request → denied) but never tested the
*separate* branch where an actor has NO `product.manage` at all and tries to decide on someone ELSE's
request. Those are two different code paths (`v_company is null` vs. `v_actor = v_requested_by`) and a
test of one does not exercise the other — a regression in either could ship silently if only the
self-approve case is covered.

## 2. Google OAuth sign-in bug — three independently-necessary root causes

**Symptom:** clicking "Continue with Google," completing the Google consent screen, and landing back on
the app with no session — no error shown, just a refresh that doesn't sign you in.

**Root causes (all three had to be fixed together — fixing one or two still left it broken):**

1. **`flowType` was never set explicitly on `createClient()`.** supabase-js defaults to the legacy
   `implicit` flow (tokens in the URL *hash*) unless you pass `flowType: 'pkce'`. If your client code
   was ever written assuming a `?code=` query param (the modern PKCE shape) but never sets `flowType`,
   it silently gets the old hash-based tokens instead and nothing matches.
2. **A genuine race between your own error-surfacing code and supabase-js's own URL processing.**
   `createClient(..., {detectSessionInUrl: true})` starts asynchronously consuming/clearing
   `window.location.hash`/`search` as part of its own init — this can finish before a React component's
   `useEffect` (even `[]`-deps, which fires after first mount) gets a chance to read the same URL data.
   Fix: capture anything you need from the URL *synchronously at module top-level*, before
   `createClient()` is even called, in the same file that constructs the client — not in a component
   effect.
3. **`supabase/config.toml`'s `additional_redirect_urls` didn't match the app's actual `redirectTo`
   value.** GoTrue treats this as an allowlist, but a non-match does NOT error — it silently
   substitutes `site_url` (dropping the path). This is nearly indistinguishable from "the app just
   refreshes and does nothing." If you use path-specific redirect targets (e.g. `/auth/reset`, not just
   the bare origin), make sure your allowlist entries are wildcarded (`"http://host:port/**"`) to cover
   them, and remember `supabase stop && supabase start` (a full container recreation) is required to
   pick up `[auth]` config changes — `supabase db reset` alone only reapplies SQL migrations and does
   NOT restart the GoTrue container.

## 3. A regression the fix itself introduced — cross-device password reset broke

**This is the one most worth reading if you ever set `flowType: 'pkce'` globally.** PKCE ties the
recovery code to a `code_verifier` stored in the *requesting browser's* localStorage.
`resetPasswordForEmail` is not insulated from this — it uses the same PKCE flow as OAuth once
`flowType: 'pkce'` is set client-wide. Under the old implicit flow, a password-reset email could be
opened on any device (request on desktop, click the link on your phone) because the token itself rode
in the URL. Under PKCE, opening the link on a different browser/device fails — the verifier isn't there
— and the failure is **silent**: no `error=` param in the URL (GoTrue only adds that for server-side
rejections, not a client-side missing-verifier failure), so it renders identically to a genuinely dead
link. Our fix (`app/pages/ResetPassword.tsx`) was NOT to re-architect the flow — just to detect the
specific signature (`?code=` present in the URL, but no session ever materializes) and show a distinct,
actionable message ("open the link on the same device you requested it from") instead of the generic
expired-link copy. If you ever flip your own client to `flowType: 'pkce'`, check whether your reset flow
has the same blind spot — it's an easy one to miss because sign-in-side OAuth testing (same
browser/tab, by construial) never reproduces it.

## 4. Usage Summary — "who used it" column

Small one: renamed the Inventory Usage Summary's "Logged By" column header to "Used By" per the owner's
plain-language request. No logic change, just the label — flagging only because if your own equivalent
table has the same header wording, it might be worth the same one-line change for consistency of
language across the two products.

## Files (Repo A paths, for reference — nothing here needs porting, just flagging the gotchas)

| Item | File |
|---|---|
| P1O migration | `supabase/migrations/20260717180000_p1o_pos_product_removal_approval.sql` |
| P1O guard (18 assertions incl. cross-tenant, double-decision, no-manage-at-all) | `scripts/guards/p1o-product-removal-security.sql` |
| P1O app wiring | `app/features/pos/api.ts`, `app/features/pos/PosScreen.tsx`, `app/types/db.ts` |
| OAuth fix — flowType + module-load-time error capture | `app/core/supabase/client.ts` |
| OAuth fix — error surfacing | `app/pages/Login.tsx` |
| OAuth fix — redirect allowlist | `supabase/config.toml` (`[auth] additional_redirect_urls`) |
| Password-reset cross-device regression fix | `app/pages/ResetPassword.tsx` |
| Usage Summary column | `app/features/inventory/InventoryScreen.tsx` |
