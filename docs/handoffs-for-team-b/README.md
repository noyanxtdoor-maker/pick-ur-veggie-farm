# Handoffs for Team B (GLM 5.2 / MiniMax M3)

**Standing owner order (2026-07-11):** every feature, update, bug, or security leak that Team A ships
gets a handoff file in this folder — what it is, why, how we built/fixed it, and how Team B ports it.
Team A is the official-launch repo; Team B has been helping us by surfacing their mistakes, and we help
them by sharing our successes. **All cross-repo porting still requires the owner's explicit
authorization, per port.**

## How Team B uses these

1. Read the file top to bottom before porting anything.
2. Port to Repo B's own schema/app — do NOT copy files blind; adapt to your migration numbering and
   verify against YOUR guards. Money/auth-domain ports get YOUR own guard battery + full-suite attack.
3. After porting, record it in your own handoff/STATUS with evidence (numbers, not adjectives).
4. If a file references a Repo-A commit SHA, that's a pointer for context — your port is a NEW commit in
   Repo B, never a reference to Repo A's history.

## Index

| # | File | Topic |
|---|------|-------|
| — | `SESSION_PROMPT.md` | Standing session-start prompt for every Team B session: read-first gate, work rules, error protocol E1–E8 |
| — | `SCANNING_PROMPT.md` | Paste-ready prompt for Team B to scan Team A's repo correctly (owner-authorized) |
| 001 | `001-team-b-current-blockers-and-discipline.md` | What Team A observed Team B struggling with + the fixes/discipline to stop the circling |
| 002 | `002-P1C-approvals-roles-bug-findings.md` | The 7 Approvals & Roles bugs the owner found + how Team A is fixing them (port targets) |
| 003 | `003-team-b-parity-port-p1j2-p1l-dedupe.md` | Reverse port FROM B (owner order 2026-07-16): dedupeByUser + P1J.2 resolver hardening + P1L Profile — parity record + deltas, nothing to port back |
| 004 | `004-revoke-approval-workflow-parity-p1m.md` | Reverse port FROM B (owner order 2026-07-17): revoke-account separation-of-duties workflow, landed as P1M (B's "P1J" label collides with our own P1J) — parity record, nothing to port back |
| 005 | `005-p1n-batch1-phaseA-phaseB-itemC.md` | Reverse ports FROM B (owner order 2026-07-17): username onboarding (P1N), display-gate batch + project.read fix, Reports/Crops-deletion/sync-animation, and item C — the merged 3-state permissions panel (P1C2), wired into OUR Approvals screen (not memberships.tsx like B's own build) — parity record, nothing to port back |
| 006 | `006-p1c3-section-access-redesign.md` | Original work (owner order 2026-07-17, superseding our own P1C2): nav-shaped "Section Access" panel + admin default narrowing (self-only payroll, approve-vs-manage split) — flags two bugs worth checking your own repo for (a broken "Not Visible" toggle, a client-side permission-snapshot union bug) — nothing to port, a heads-up |
| 007 | `007-p1o-product-removal-oauth-fix-usage-summary.md` | Original work (owner order 2026-07-17): P1O product-removal request/approval workflow (third tiered-permission shape — lesser key can only request), Google OAuth sign-in fix (3 independently-necessary root causes: flowType default, module-load-time URL-read race, redirect allowlist substitution), and the regression that fix introduced (PKCE breaks cross-device password reset — read this one if you ever set flowType globally) — nothing to port, a heads-up |
