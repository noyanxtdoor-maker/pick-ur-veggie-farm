-- Migration P2-M7A — Projects (Project Checklists) (Phase 2, Module 7A).
-- Authority: Phase_2_M7_Projects_Module_Spec.md · prototype src/features/Projects.tsx = workflow-logic authority
--   (owner 2026-07-02) · 26.09 permissions. Non-money operational board (no GL). Reuses branch/permission/audit
--   spine; links to the calendar via calendar_events.project_id (reserved M6).
-- Model: project cards (branch-owned) + task checklists; % complete derived. Plain RLS-gated writes; task rows
--   scoped through their parent project (EXISTS + is_branch_member). Deferred (spec §2): per-project manager
--   lists (replaced by project.manage), Restricted-visibility enforcement.
-- Pattern: ADDITIVE ONLY. Risk: Medium (new operational tables; no financial impact).

insert into public.permissions (permission_key, description) values
  ('project.read',   'View the projects / checklist board'),
  ('project.manage', 'Create/edit/delete projects and manage their task checklists')
on conflict (permission_key) do nothing;

-- ── projects (branch-owned) ──
create table public.projects (
  id          uuid primary key default public.uuidv7(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  branch_id   uuid not null,
  name        text not null,
  description text,
  start_date  date,
  end_date    date,
  status      text not null default 'In Progress' check (status in ('Planning', 'In Progress', 'Completed', 'On Hold')),
  visibility  text not null default 'Public' check (visibility in ('Public', 'Restricted')),
  created_by  uuid references public.users (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, company_id),
  foreign key (branch_id, company_id) references public.branches (id, company_id) on delete restrict
);
comment on table public.projects is 'Farm project cards (P2-M7A). Branch-owned; project.read-view / project.manage-write; audited. No GL. Manager lists replaced by project.manage.';
create index projects_branch_idx on public.projects (branch_id, company_id);
create trigger projects_set_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger projects_audit after insert or update on public.projects for each row execute function public.inventory_audit();
alter table public.projects enable row level security;
alter table public.projects force row level security;
revoke all on public.projects from public, anon, authenticated, service_role;
grant select on public.projects to authenticated;
grant insert (company_id, branch_id, name, description, start_date, end_date, status, visibility, created_by) on public.projects to authenticated;
grant update (name, description, start_date, end_date, status, visibility) on public.projects to authenticated;
grant delete on public.projects to authenticated;
create policy projects_select on public.projects for select to authenticated
  using (public.has_permission(company_id, 'project.read') and public.is_branch_member(branch_id));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.has_permission(company_id, 'project.manage') and public.is_branch_member(branch_id));
create policy projects_update on public.projects for update to authenticated
  using (public.has_permission(company_id, 'project.manage') and public.is_branch_member(branch_id))
  with check (public.has_permission(company_id, 'project.manage') and public.is_branch_member(branch_id));
create policy projects_delete on public.projects for delete to authenticated
  using (public.has_permission(company_id, 'project.manage') and public.is_branch_member(branch_id));

-- ── project_tasks (checklist items; scoped through the parent project) ──
create table public.project_tasks (
  id           uuid primary key default public.uuidv7(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  project_id   uuid not null,
  text         text not null,
  completed    boolean not null default false,
  completed_by uuid references public.users (id) on delete restrict,
  completed_at timestamptz,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  foreign key (project_id, company_id) references public.projects (id, company_id) on delete restrict
);
comment on table public.project_tasks is 'Project checklist items (P2-M7A). Scoped through the parent project (RLS via EXISTS + is_branch_member). % complete derived, never stored.';
create index project_tasks_project_idx on public.project_tasks (project_id, company_id);
alter table public.project_tasks enable row level security;
alter table public.project_tasks force row level security;
revoke all on public.project_tasks from public, anon, authenticated, service_role;
grant select on public.project_tasks to authenticated;
grant insert (company_id, project_id, text, position) on public.project_tasks to authenticated;
grant update (text, completed, completed_by, completed_at, position) on public.project_tasks to authenticated;
grant delete on public.project_tasks to authenticated;
-- read/write gated through the parent project's branch + permission
create policy project_tasks_select on public.project_tasks for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_tasks.project_id and p.company_id = project_tasks.company_id
    and public.has_permission(p.company_id, 'project.read') and public.is_branch_member(p.branch_id)));
create policy project_tasks_insert on public.project_tasks for insert to authenticated
  with check (exists (select 1 from public.projects p where p.id = project_tasks.project_id and p.company_id = project_tasks.company_id
    and public.has_permission(p.company_id, 'project.manage') and public.is_branch_member(p.branch_id)));
create policy project_tasks_update on public.project_tasks for update to authenticated
  using (exists (select 1 from public.projects p where p.id = project_tasks.project_id and p.company_id = project_tasks.company_id
    and public.has_permission(p.company_id, 'project.manage') and public.is_branch_member(p.branch_id)))
  with check (exists (select 1 from public.projects p where p.id = project_tasks.project_id and p.company_id = project_tasks.company_id
    and public.has_permission(p.company_id, 'project.manage') and public.is_branch_member(p.branch_id)));
create policy project_tasks_delete on public.project_tasks for delete to authenticated
  using (exists (select 1 from public.projects p where p.id = project_tasks.project_id and p.company_id = project_tasks.company_id
    and public.has_permission(p.company_id, 'project.manage') and public.is_branch_member(p.branch_id)));
