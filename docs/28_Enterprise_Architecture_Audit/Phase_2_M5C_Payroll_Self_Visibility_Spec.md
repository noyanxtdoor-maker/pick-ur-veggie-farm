# Phase 2 — M5C: Payroll Self-Visibility (spec)

**Type:** Module spec (extends M5 Payroll) · **Status:** Built + guard-proven · **Date:** 2026-07-04
**Owner rule (review 2026-07-04, plan Phase B.1):** *"operators, admin and employee can only see their own name
or profile. co-owner and owner, and dev can see all."*
**Authority:** System 21 (payroll) + 26.09 (permission matrix / salary privacy). **Risk:** Low — NON-money-mutating
(a link column, three SELECT policies, one governed linking function; no amounts, no GL).

## 1. Design
- **Who sees what:** roles WITH `payroll.read`/`payroll.manage` (Owner/Co-Owner/Dev tiers) keep full visibility —
  the locked M5A policies are untouched. Everyone else gains visibility of EXACTLY their own linked employee row
  plus their own advances/wages — via new additive `*_select_self` policies (Postgres ORs permissive policies).
- **The link:** `employees.user_id` (nullable; unique per company) connects a staff record to an app user. Set
  ONLY via `payroll_link_employee_user(p_employee_id, p_user_id)` — `payroll.manage`, target must be a company
  member (`user_branch_roles`), audited; `null` unlinks. Staff without app accounts simply stay unlinked.
- **Read-only self view:** the M5A write policies are unchanged, so a linked worker can SEE their row but cannot
  edit it (guard-proven — a self rate-edit attempt affects 0 rows).
- **Branch note (deliberate):** self policies do NOT require branch membership — your own pay record follows you
  across branch reassignments. Managers' branch-scoped views are unchanged.

## 2. App layer
- `payrollApi.linkEmployeeUser` (mock | rpc | offline-queued) + `fetchEmployeeAdvances`/`fetchEmployeeWages`
  (one employee, all branches — powers the self view; real mode is RLS-authorized).
- **"My Payroll"** — users without `payroll.read` now get a read-only self view instead of an access-denied wall:
  profile card (rate + advance-to-repay with a plain-language tooltip), wage history, advance list; friendly
  "ask a manager to link your staff record" empty state when unlinked.
- Roster (managers): a Link-User button per row (chip turns green when linked) → modal with a company-member
  select, link/unlink. Members list reused from the organization module.

## 3. Verification
- **Attack:** `supabase db reset` clean (21 migrations) · **guard:payroll 19/19** (5 new: self-link denied without
  payroll.manage · cross-company link denied · governed link works · linked worker sees exactly their own
  profile + advances/wages and nothing else · self view is READ-only) · **full suite 157 PASS / 0 defects**
  across all 12 batteries.
- **App:** tsc clean · vitest 74/74 (2 new: link/unlink round-trip; per-employee fetches) · build OK · browser:
  roster + link modal verified (hire → link button → modal explains self-visibility, member select, guarded button).

## 4. Deferred
Self-service payslip PDF, attendance/shifts (M5 spec §1 list unchanged); linking UI inside the future
Roles & Approvals screen (B.4) can supersede the roster button.
