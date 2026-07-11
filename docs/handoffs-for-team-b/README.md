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
| — | `SCANNING_PROMPT.md` | Paste-ready prompt for Team B to scan Team A's repo correctly (owner-authorized) |
| 001 | `001-team-b-current-blockers-and-discipline.md` | What Team A observed Team B struggling with + the fixes/discipline to stop the circling |
| 002 | `002-P1C-approvals-roles-bug-findings.md` | The 7 Approvals & Roles bugs the owner found + how Team A is fixing them (port targets) |
