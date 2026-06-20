# ODR-003 — Risk-Based MFA Security Policy

**Type:** Owner Decision Record · **Status:** APPROVED · **Date:** 2026-06-20
**Branch:** `architecture-audit` · **Informs:** Phase 7 Owner Decision #3; finding **P3-07** (auth hardening)
**Authority:** Owner (Founder). Subordinate to [ADR-001](ADR_001_Architecture_Ratification.md).

## Decision

V3 implements **risk-based MFA**: requirements scale with a user's authority, access scope, and ability to affect enterprise data.

**Principle:** *High authority requires high security — MFA enforcement is proportional to access, financial impact, and risk.*

## MFA scope by risk

- **Mandatory MFA** — elevated authority: Developer/System/Platform admins; Owner, Co-Owner, General Manager, Corporate Accountant, Finance Manager; and **any** user who can create accounts, reset passwords, assign roles, modify permissions, manage security settings, or access company-wide sensitive financials.
- **Optional MFA** — operational users: Branch Supervisor, Farm Manager, Operator, Inventory/Sales personnel, Cashier, Workers. Companies may enforce stricter policies later.

## Sensitive-action re-authentication

A valid session does not auto-permit high-risk actions. Re-auth (password confirm, MFA challenge, or approved method) is required for: password changes, MFA-setting changes, permission changes, creating high-privilege accounts, exporting sensitive financials, approving high-value transactions, destructive admin actions.

## Supported MFA architecture

Primary: TOTP authenticator apps; hardware security keys. Secondary: email codes; SMS where appropriate. Integrates with existing device/session security (trusted devices, registration/revocation, session expiry, remote logout, suspicious-login detection).

## Offline considerations

MFA required at online login and device enrollment. Trusted/previously-authenticated devices may operate within approved offline session policies. Offline must not permanently bypass security; re-auth occurs on reconnect or when thresholds are exceeded.

## V1 scope vs deferred

- **V1:** mandatory MFA for high-privilege; optional for operational; trusted-device management; session controls; sensitive-action re-auth.
- **Deferred:** company-defined MFA enforcement policies, risk-scoring, geolocation/anomaly detection, adaptive authentication.

## Impact on audit

- **P3-07** (auth hardening): MFA scope now decided — **mandatory MFA at V1 for privileged/financial roles** (no longer "future"), plus re-auth for sensitive actions. The remaining P3-07 items — **password policy** and **Developer-superuser constraints** — are owed by **Stage B/B7**, so P3-07 stays **Open** pending that spec.
- Owner Decision **#3 → APPROVED**. Decisions #4–#5 remain open.
