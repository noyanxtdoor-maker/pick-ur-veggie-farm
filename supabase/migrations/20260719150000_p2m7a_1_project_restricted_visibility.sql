-- Migration P2M7A.1 — enforce Projects' Restricted visibility (owner mega-directive 2026-07-19,
-- backlog item "Projects: assigning managers, enforcing restricted visibility").
--
-- Real latent bug found while auditing this: P2M7A's own `projects` table already carries a
-- `visibility text check (in 'Public','Restricted')` column and its migration header explicitly
-- says "Deferred (spec §2): per-project manager lists (replaced by project.manage), Restricted-
-- visibility enforcement" — but the SELECT policy (projects_select) never actually reads that
-- column. Every project.read holder sees every project regardless of its visibility flag, so
-- marking a project "Restricted" today does nothing at all — a silent no-op, not a partial feature.
--
-- Fix, scoped to what P2M7A already deferred to: manager LISTS were explicitly replaced by the
-- coarser `project.manage` permission (not a new assignment table), so the natural, minimal,
-- correct enforcement is: a Restricted project is visible only to project.manage holders (the
-- people who can actually run projects); a Public project is unchanged (any project.read holder,
-- same as before). project.manage is also the only key that can ever INSERT a project, so this
-- doesn't strand a creator's own project — they hold the qualifying permission by construction.
-- This closes the real gap without inventing a new per-project manager-assignment feature nobody
-- asked for by name — if the owner later wants named per-project managers (not just the
-- company-wide project.manage key), that is a materially bigger feature and its own migration.
--
-- project_tasks inherited the same gap: its own SELECT policy only checked project.read through the
-- parent project, so a Restricted project's checklist items were readable independently of the
-- parent's own (already-broken) visibility gate. Fixed identically, through the same EXISTS join.
--
-- Non-money (20.19); additive re-creation of two SELECT policies only — INSERT/UPDATE/DELETE on
-- both tables were already project.manage-gated (through the parent for project_tasks), so writes
-- needed no change.

drop policy projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (
    public.has_permission(company_id, 'project.read')
    and public.is_branch_member(branch_id)
    and (visibility = 'Public' or public.has_permission(company_id, 'project.manage'))
  );

drop policy project_tasks_select on public.project_tasks;
create policy project_tasks_select on public.project_tasks for select to authenticated
  using (exists (
    select 1 from public.projects p
     where p.id = project_tasks.project_id and p.company_id = project_tasks.company_id
       and public.has_permission(p.company_id, 'project.read') and public.is_branch_member(p.branch_id)
       and (p.visibility = 'Public' or public.has_permission(p.company_id, 'project.manage'))
  ));
