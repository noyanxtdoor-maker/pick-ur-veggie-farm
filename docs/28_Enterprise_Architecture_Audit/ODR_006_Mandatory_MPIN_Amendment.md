# ODR-006 — Mandatory MPIN Amendment to ODR-003

**Type:** Owner Decision Record · **Status:** APPROVED · **Date:** 2026-07-18
**Branch:** `feature/phase-0-foundation` · **Amends:** [ODR-003](ODR_003_Risk_Based_MFA_Security_Policy.md) (Risk-Based MFA Security Policy)
**Authority:** Owner (Founder). Subordinate to [ADR-001](ADR_001_Architecture_Ratification.md).

## Decision

A 6-digit MPIN (bcrypt-hashed, `public.user_mpin`, migration `20260718030000_p1p_mpin_security_layer.sql`)
is **mandatory for every authenticated user, regardless of role or tier** — including operational
roles that ODR-003 §"MFA scope by risk" classifies as **optional MFA**.

This is a narrow amendment, not a repeal: ODR-003's TOTP/hardware-key MFA scope for elevated-authority
roles (Owner, Co-Owner, GM, finance roles, anyone who can create accounts or modify permissions) is
**unchanged and unaffected**. The MPIN layer sits underneath it, for everyone, as a second and
independent control.

## Why mandatory for everyone, not risk-scaled

ODR-003's principle — *security proportional to authority* — assumes the primary risk is what a
role can *do* once authenticated. The MPIN targets a different risk: **device theft or loss**. A
worker's phone (operational tier, "optional MFA" under ODR-003) left unattended or stolen exposes
the same live ERP session as an owner's — company-wide inventory, sales, payroll, and customer data
— regardless of that worker's own permission scope, because a still-valid Supabase session on a
stolen device is not gated by role at all. The owner's own framing: *"we dont want a lower tier get
theri phone stolen then that thief will access our ERP."* Risk-scaling by role does not address a
threat that is about the device, not the account's authority.

## Mechanism (V1, shipped)

- Mandatory onboarding step: Approval → Choose Username → **Set MPIN** → (optional, Phase 2)
  biometric offer. Enforced server-side via `onboarding_next_step()`, not just client UX.
- 6-digit MPIN, bcrypt-hashed (`extensions.crypt`/`gen_salt('bf')`), stored in a table with **zero**
  grants to `anon`/`authenticated` — reachable only through `SECURITY DEFINER` RPCs.
- Escalating lockout: 5 consecutive failures → 60s; every further 5 → 5min → 15min → 30min (capped).
  Every failure/lockout transition is audited (`audit_events`, `Security` class).
- 2-minute client-side auto-lock (`app/core/security/lock.tsx`) after inactivity — an overlay, not a
  sign-out; the session, refresh token, and offline cache stay intact. Skipped entirely while the
  device is offline (owner decision, 2026-07-18): a field worker in a dead zone is never trapped
  behind a lock screen they cannot pass.
- Unlock via MPIN (biometric is Phase 2, gated on confirming hosted-plan passkey support).
- Locked-out fallback is always a full sign-out + email/password re-auth — the one case in this
  design where forcing the heavier path is correct.

## Relationship to ODR-003's other clauses

- **Sensitive-action re-authentication** (password changes, permission changes, etc.): unaffected.
  Continues to require the methods ODR-003 already specifies.
- **Offline considerations**: consistent with ODR-003's "must not permanently bypass security;
  re-auth occurs on reconnect" — the auto-lock resumes arming the moment connectivity returns.
- **Deferred items** (company-defined enforcement policies, risk-scoring, adaptive auth): unchanged.

## V1 scope vs deferred

- **V1 (this amendment):** mandatory MPIN for all users, escalating lockout, 2-minute auto-lock,
  self-service change (`change_mpin`, re-verifies the current MPIN first).
- **Deferred (Phase 2):** optional biometric/passkey enrollment and unlock, gated on confirming
  Supabase's native passkey support on the hosted plan. Phone/SMS sign-up and password reset are a
  separate, unrelated deferral (blocked on an owner-side SMS-provider choice, not on this ODR).
