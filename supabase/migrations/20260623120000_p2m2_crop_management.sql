-- Migration P2-M2 — Crop Management Foundation (Phase 2, Module 2)
-- Authority: Phase_2_Transition_Context.md (§2 module 2; §3 inheritance — branch isolation lands here), M1B/M1C,
--   inherits B1 (RLS/tenant), M3 (composite-FK same-company integrity), M4 (resolver: has_permission /
--   accessible_company_ids / current_app_user_id), M5 (audit_events), M6 (permission catalog), C7 §0 (permission-
--   based authz — NEVER role names), B2 (no float — integer quantities only).
-- Scope: the FIRST real OPERATIONAL ERP module + the FIRST branch-owned business table (planting_templates),
--   which is why the deferred `is_branch_member()` resolver predicate (handoff §11 M4 carryover) is implemented here.
--   Entities: crop_categories → crop_varieties → crop_profiles (company-scoped catalogs) + planting_templates
--   (branch-owned). Status lifecycle = Active | Archived (no hard delete). M1–M6 + P2-M1 files are NOT modified.
-- Security model: member-scoped reads (resolver); writes gated by the new `crop.manage` permission; planting
--   templates additionally require branch membership (is_branch_member) → no branch leakage. EVERY write is audited
--   by a SECURITY DEFINER trigger (audit cannot be bypassed). Cross-company references blocked by composite FKs.
-- Risk: High (new operational tables + branch RLS). Rollback: structural while unused.

-- ── Permission catalog addition (additive, idempotent — M6 catalog grows per module) ──
-- A bootstrapped Owner holds all active catalog permissions, so it automatically gains crop.manage.
insert into public.permissions (permission_key, description) values
  ('crop.manage', 'Create, edit, and archive crop categories, varieties, profiles, and planting templates')
on conflict (permission_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- Resolver extension — branch membership (B1 §2; the deferred is_branch_member predicate).
-- Answers only for the CALLER (auth.uid() unchanged by SECURITY DEFINER). search_path pinned, fully qualified.
-- ════════════════════════════════════════════════════════════════════════════
create function public.is_branch_member(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_branch_roles ubr
    join public.companies c on c.id = ubr.company_id
    where ubr.user_id = public.current_app_user_id()
      and ubr.branch_id = p_branch_id
      and ubr.assignment_status = 'Active'
      and (ubr.expires_at is null or ubr.expires_at > now())
      and c.status = 'Active'
  )
$$;
comment on function public.is_branch_member(uuid) is 'Resolver: is the caller an Active member of p_branch_id (Active company)? Branch-isolation boundary for branch-owned data (B1 §2).';
revoke all on function public.is_branch_member(uuid) from public;
grant execute on function public.is_branch_member(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Audit trigger — every crop write (insert/update incl. archive) appends an immutable audit_events row (M5).
-- SECURITY DEFINER (owner) so it can append to the append-only log regardless of the caller's grants → audit
-- CANNOT be bypassed. branch_id is read via jsonb so the one function serves both company- and branch-owned tables.
-- ════════════════════════════════════════════════════════════════════════════
create function public.crop_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_app_user_id();
  v_branch uuid := (to_jsonb(NEW) ->> 'branch_id')::uuid;   -- NULL on company-only tables
  v_class  text := case when v_actor is null then 'System' else 'Business' end;  -- M5 CHECK: Business needs an actor
begin
  insert into public.audit_events
    (company_id, branch_id, actor_user_id, actor_auth_id, event_class, event_type, module, entity_type, entity_id, new_value)
  values
    (NEW.company_id, v_branch, v_actor, (select auth.uid()), v_class, lower(TG_OP) || '.' || TG_TABLE_NAME, 'crops', TG_TABLE_NAME, NEW.id, to_jsonb(NEW));
  return NEW;
end;
$$;
comment on function public.crop_audit() is 'Phase 2 M2: append-only audit of every crop write (M5). SECURITY DEFINER → cannot be bypassed by the caller.';

-- Integrity trigger — reject creating a child under an Archived/Suspended parent ("archived crop usage").
-- Generic via TG_ARGV[0]=parent table, TG_ARGV[1]=fk column. SECURITY DEFINER to read the parent's status.
create function public.crop_assert_parent_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text; v_parent uuid := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
begin
  execute format('select status from public.%I where id = $1', TG_ARGV[0]) into v_status using v_parent;
  if v_status is distinct from 'Active' then
    raise exception 'cannot reference % %: parent is not Active (status=%)', TG_ARGV[0], v_parent, coalesce(v_status, 'missing')
      using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;
comment on function public.crop_assert_parent_active() is 'Phase 2 M2: rejects creating a child whose referenced parent is not Active (prevents archived-crop usage).';

-- ════════════════════════════════════════════════════════════════════════════
-- 1. crop_categories — company-scoped catalog (top of the hierarchy)
-- ════════════════════════════════════════════════════════════════════════════
create table public.crop_categories (
  id            uuid primary key default public.uuidv7(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  category_code text not null,
  name          text not null,
  description   text,
  status        text not null default 'Active' check (status in ('Active', 'Archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, category_code),
  unique (id, company_id)   -- composite-FK target for crop_varieties (forces same-company)
);
comment on table public.crop_categories is 'Crop categories (P2-M2). Company-scoped catalog; member-read, crop.manage-write; audited; Active|Archived.';
create trigger crop_categories_set_updated_at before update on public.crop_categories for each row execute function public.set_updated_at();
create trigger crop_categories_audit after insert or update on public.crop_categories for each row execute function public.crop_audit();

alter table public.crop_categories enable row level security;
alter table public.crop_categories force row level security;
revoke all on public.crop_categories from public, anon, authenticated, service_role;
grant select on public.crop_categories to authenticated;
grant insert (company_id, category_code, name, description) on public.crop_categories to authenticated;
grant update (name, description, status) on public.crop_categories to authenticated;  -- code immutable; company_id immutable
create policy crop_categories_select_member on public.crop_categories for select to authenticated
  using (company_id in (select public.accessible_company_ids()));
create policy crop_categories_insert_manage on public.crop_categories for insert to authenticated
  with check (public.has_permission(company_id, 'crop.manage'));
create policy crop_categories_update_manage on public.crop_categories for update to authenticated
  using (public.has_permission(company_id, 'crop.manage'))
  with check (public.has_permission(company_id, 'crop.manage'));

-- ════════════════════════════════════════════════════════════════════════════
-- 2. crop_varieties — belong to a category (same company via composite FK)
-- ════════════════════════════════════════════════════════════════════════════
create table public.crop_varieties (
  id           uuid primary key default public.uuidv7(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  category_id  uuid not null,
  variety_code text not null,
  name         text not null,
  description  text,
  status       text not null default 'Active' check (status in ('Active', 'Archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, variety_code),
  unique (id, company_id),
  foreign key (category_id, company_id) references public.crop_categories (id, company_id) on delete restrict
);
comment on table public.crop_varieties is 'Crop varieties (P2-M2). Belong to a same-company category; member-read, crop.manage-write; audited.';
create index crop_varieties_category_idx on public.crop_varieties (category_id, company_id);
create trigger crop_varieties_set_updated_at before update on public.crop_varieties for each row execute function public.set_updated_at();
create trigger crop_varieties_audit after insert or update on public.crop_varieties for each row execute function public.crop_audit();
create trigger crop_varieties_parent_active before insert on public.crop_varieties
  for each row execute function public.crop_assert_parent_active('crop_categories', 'category_id');

alter table public.crop_varieties enable row level security;
alter table public.crop_varieties force row level security;
revoke all on public.crop_varieties from public, anon, authenticated, service_role;
grant select on public.crop_varieties to authenticated;
grant insert (company_id, category_id, variety_code, name, description) on public.crop_varieties to authenticated;
grant update (name, description, status) on public.crop_varieties to authenticated;
create policy crop_varieties_select_member on public.crop_varieties for select to authenticated
  using (company_id in (select public.accessible_company_ids()));
create policy crop_varieties_insert_manage on public.crop_varieties for insert to authenticated
  with check (public.has_permission(company_id, 'crop.manage'));
create policy crop_varieties_update_manage on public.crop_varieties for update to authenticated
  using (public.has_permission(company_id, 'crop.manage'))
  with check (public.has_permission(company_id, 'crop.manage'));

-- ════════════════════════════════════════════════════════════════════════════
-- 3. crop_profiles — cultivation reference for a variety (same company via composite FK)
-- ════════════════════════════════════════════════════════════════════════════
create table public.crop_profiles (
  id                   uuid primary key default public.uuidv7(),
  company_id           uuid not null references public.companies (id) on delete restrict,
  variety_id           uuid not null,
  profile_code         text not null,
  name                 text not null,
  growth_duration_days integer check (growth_duration_days is null or growth_duration_days > 0),  -- integer, NOT float (B2)
  notes                text,
  status               text not null default 'Active' check (status in ('Active', 'Archived')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, profile_code),
  unique (id, company_id),
  foreign key (variety_id, company_id) references public.crop_varieties (id, company_id) on delete restrict
);
comment on table public.crop_profiles is 'Crop cultivation profiles (P2-M2). Belong to a same-company variety; member-read, crop.manage-write; audited.';
create index crop_profiles_variety_idx on public.crop_profiles (variety_id, company_id);
create trigger crop_profiles_set_updated_at before update on public.crop_profiles for each row execute function public.set_updated_at();
create trigger crop_profiles_audit after insert or update on public.crop_profiles for each row execute function public.crop_audit();
create trigger crop_profiles_parent_active before insert on public.crop_profiles
  for each row execute function public.crop_assert_parent_active('crop_varieties', 'variety_id');

alter table public.crop_profiles enable row level security;
alter table public.crop_profiles force row level security;
revoke all on public.crop_profiles from public, anon, authenticated, service_role;
grant select on public.crop_profiles to authenticated;
grant insert (company_id, variety_id, profile_code, name, growth_duration_days, notes) on public.crop_profiles to authenticated;
grant update (name, growth_duration_days, notes, status) on public.crop_profiles to authenticated;
create policy crop_profiles_select_member on public.crop_profiles for select to authenticated
  using (company_id in (select public.accessible_company_ids()));
create policy crop_profiles_insert_manage on public.crop_profiles for insert to authenticated
  with check (public.has_permission(company_id, 'crop.manage'));
create policy crop_profiles_update_manage on public.crop_profiles for update to authenticated
  using (public.has_permission(company_id, 'crop.manage'))
  with check (public.has_permission(company_id, 'crop.manage'));

-- ════════════════════════════════════════════════════════════════════════════
-- 4. planting_templates — the FIRST branch-owned operational table. Branch isolation via is_branch_member().
--    A template belongs to ONE branch (NOT NULL) and one crop profile, both forced same-company by composite FKs.
-- ════════════════════════════════════════════════════════════════════════════
create table public.planting_templates (
  id               uuid primary key default public.uuidv7(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  branch_id        uuid not null,
  profile_id       uuid not null,
  template_code    text not null,
  name             text not null,
  season           text,
  planned_quantity integer not null default 0 check (planned_quantity >= 0),  -- integer count, NOT float (B2)
  notes            text,
  status           text not null default 'Active' check (status in ('Active', 'Archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, template_code),
  foreign key (branch_id, company_id)  references public.branches (id, company_id)      on delete restrict,
  foreign key (profile_id, company_id) references public.crop_profiles (id, company_id) on delete restrict
);
comment on table public.planting_templates is 'Planting templates (P2-M2) — FIRST branch-owned operational table. Visible/writable only to branch members (is_branch_member) holding crop.manage; same-company branch+profile (composite FKs); audited.';
create index planting_templates_branch_idx on public.planting_templates (branch_id, company_id);
create index planting_templates_profile_idx on public.planting_templates (profile_id, company_id);
create trigger planting_templates_set_updated_at before update on public.planting_templates for each row execute function public.set_updated_at();
create trigger planting_templates_audit after insert or update on public.planting_templates for each row execute function public.crop_audit();
create trigger planting_templates_parent_active before insert on public.planting_templates
  for each row execute function public.crop_assert_parent_active('crop_profiles', 'profile_id');
create trigger planting_templates_branch_active before insert on public.planting_templates
  for each row execute function public.crop_assert_parent_active('branches', 'branch_id');

alter table public.planting_templates enable row level security;
alter table public.planting_templates force row level security;
revoke all on public.planting_templates from public, anon, authenticated, service_role;
grant select on public.planting_templates to authenticated;
grant insert (company_id, branch_id, profile_id, template_code, name, season, planned_quantity, notes) on public.planting_templates to authenticated;
grant update (name, season, planned_quantity, notes, status) on public.planting_templates to authenticated;
-- Branch isolation: only branch members may read/write the branch's templates (no branch leakage).
create policy planting_templates_select_member on public.planting_templates for select to authenticated
  using (public.is_branch_member(branch_id));
create policy planting_templates_insert_manage on public.planting_templates for insert to authenticated
  with check (public.has_permission(company_id, 'crop.manage') and public.is_branch_member(branch_id));
create policy planting_templates_update_manage on public.planting_templates for update to authenticated
  using (public.has_permission(company_id, 'crop.manage') and public.is_branch_member(branch_id))
  with check (public.has_permission(company_id, 'crop.manage') and public.is_branch_member(branch_id));
