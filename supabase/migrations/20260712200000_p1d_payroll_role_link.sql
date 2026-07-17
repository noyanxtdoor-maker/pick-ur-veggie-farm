-- Migration P1D — Link POS roles to Payroll + managed Position list + Job Title (owner spec 2026-07-12,
-- "payroll_role_link_prompt.md" Parts 1 & 3; Part 2 deliberately NOT built here — see Launch_Runbook.md
-- for the deferred admin-bootstrap-credential spec and why the existing Invitations flow covers the
-- immediate need instead).
-- Authority: owner decision 2026-07-12 (Part 1: build; Part 3: admin-tier-and-above only). Additive.
-- Risk: Medium (auth-adjacent — ties role assignment to a new governed side-effect — but does not evolve
--   the resolver or any RLS invariant; every check reuses P1C's existing outranks_role/has_permission).

-- ════════════════════════════════════════════════════════════════════════════
-- PART 3 — Managed position list (owner: only co_owner/owner may manage; admin+ may select)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.permissions (permission_key, description) values
  ('position.manage', 'Add, rename, and deactivate the Farm Hand position picklist')
on conflict (permission_key) do nothing;

create table public.positions (
  id         uuid primary key default public.uuidv7(),
  company_id uuid not null references public.companies (id) on delete restrict,
  label      text not null,
  active     boolean not null default true,
  created_by uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id)
);
comment on table public.positions is 'P1D §Part3: company-managed Farm Hand position picklist. Deactivate, never delete (existing employees keep their reference). Case/whitespace-insensitive uniqueness enforced by positions_label_ci_uq.';
create unique index positions_label_ci_uq on public.positions (company_id, lower(trim(label)));
create index positions_company_active_idx on public.positions (company_id) where active;
create trigger positions_set_updated_at before update on public.positions for each row execute function public.set_updated_at();

alter table public.positions enable row level security;
alter table public.positions force row level security;
revoke all on public.positions from public, anon, authenticated, service_role;
-- read: any active company member (same visibility precedent as roles/branches — a low-sensitivity picklist)
grant select on public.positions to authenticated;
create policy positions_select_member on public.positions for select to authenticated
  using (company_id in (select public.accessible_company_ids()));
-- write: position.manage only (co_owner/owner by default catalog; admin can select, never manage)
grant insert (company_id, label) on public.positions to authenticated;
grant update (label, active) on public.positions to authenticated;
create policy positions_insert_manage on public.positions for insert to authenticated
  with check (public.has_permission(company_id, 'position.manage'));
create policy positions_update_manage on public.positions for update to authenticated
  using (public.has_permission(company_id, 'position.manage'))
  with check (public.has_permission(company_id, 'position.manage'));

-- normalize on save + auto-set created_by server-side (an audit field is never client-supplied input —
-- current_app_user_id() is the caller regardless of what the client sends, so there is no grant for it).
-- Also rejects case/whitespace-only duplicates with a clear error rather than the raw unique-index message.
create function public.positions_normalize_and_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.label := trim(new.label);
  if new.label = '' then raise exception 'position label cannot be blank' using errcode = 'raise_exception'; end if;
  if tg_op = 'INSERT' and new.created_by is null then new.created_by := public.current_app_user_id(); end if;
  if exists (
    select 1 from public.positions p
    where p.company_id = new.company_id and lower(trim(p.label)) = lower(new.label) and p.id <> new.id
  ) then
    raise exception 'a position named "%" already exists (case/whitespace-insensitive)', new.label using errcode = 'unique_violation';
  end if;
  return new;
end; $$;
create trigger positions_normalize before insert or update on public.positions
  for each row execute function public.positions_normalize_and_check();

-- ── employees.position (free text) -> employees.position_id (managed reference) ──
-- No guard assertion depends on the old text value (verified before this migration was written); safe to
-- replace outright rather than carry a permanently-dual-write column (C3 expand->migrate->contract, done
-- in one step here given the current data volume — a single early tenant, not a live multi-tenant dataset).
alter table public.employees add column position_id uuid;
insert into public.positions (company_id, label, created_by)
  select distinct e.company_id, e.position, (select owner_user_id from public.bootstrap_state where id)
  from public.employees e
  where e.position is not null and trim(e.position) <> ''
  on conflict (company_id, lower(trim(label))) do nothing;
update public.employees e set position_id = p.id
  from public.positions p
  where p.company_id = e.company_id and lower(trim(p.label)) = lower(trim(e.position));
-- also seed the standard 4 for every company that has none yet (new/empty tenants)
insert into public.positions (company_id, label, created_by)
  select c.id, v.label, (select owner_user_id from public.bootstrap_state where id)
  from public.companies c
  cross join (values ('Harvester'), ('Farm Operator'), ('Warehouse Packer'), ('Delivery Driver')) as v(label)
  where not exists (select 1 from public.positions p where p.company_id = c.id)
  on conflict (company_id, lower(trim(label))) do nothing;
alter table public.employees add constraint employees_position_id_fkey foreign key (position_id, company_id) references public.positions (id, company_id) on delete restrict;
alter table public.employees drop column position;
-- ALTER TABLE ADD COLUMN grants no privileges on the new column, and DROP COLUMN removed the old
-- column-scoped grants with it — replicate the exact insert/update grant the old `position` column had
-- (P2-M5A) onto position_id, or the existing client hire()/edit paths silently lose write access.
grant insert (position_id) on public.employees to authenticated;
grant update (position_id) on public.employees to authenticated;
comment on column public.employees.position_id is 'P1D: managed reference into public.positions — replaces the old free-text position column. Nullable at the schema level (legacy rows with no matching seed stay null); the app always requires a selection for new hires.';

-- ── job_title — descriptive, account-level, independent of Farm Hand Position/Daily Rate entirely ──
alter table public.users add column job_title text;
comment on column public.users.job_title is 'P1D §Part3: purely descriptive account-level title. NO payroll/reporting logic keyed to it, independent of the Farm Hand positions table. Editable only by an actor holding job_title.manage in a company the target shares (owner decision: admin-tier and above, not self-editable).';
insert into public.permissions (permission_key, description) values
  ('job_title.manage', 'Set another company member''s descriptive job title')
on conflict (permission_key) do nothing;
grant update (job_title) on public.users to authenticated;
-- Row-level access for the CROSS-user case (an admin editing someone else's row — the pre-existing
-- users_update_self policy from M4 only ever matched the caller's OWN row, so without this, nobody could
-- reach another user's row here at all).
create policy users_update_job_title_managed on public.users for update to authenticated
  using (exists (
    select 1 from public.user_branch_roles target_ubr
    where target_ubr.user_id = users.id and target_ubr.assignment_status = 'Active'
      and public.has_permission(target_ubr.company_id, 'job_title.manage')
  ))
  with check (exists (
    select 1 from public.user_branch_roles target_ubr
    where target_ubr.user_id = users.id and target_ubr.assignment_status = 'Active'
      and public.has_permission(target_ubr.company_id, 'job_title.manage')
  ));
-- RLS policies for the same command are OR'd together — the pre-existing users_update_self policy
-- (M4, "you may update your own Active row") ALSO passes for a self-edit of job_title, since it has no
-- concept of "which column changed". A plain policy cannot discriminate by column; only a trigger sees
-- OLD vs NEW together. This closes the self-edit hole the OR-composition would otherwise leave open,
-- without touching the locked M4 policy at all (found + fixed same-day via this migration's own guard).
create function public.users_job_title_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.job_title is distinct from old.job_title then
    if not exists (
      select 1 from public.user_branch_roles target_ubr
      where target_ubr.user_id = new.id and target_ubr.assignment_status = 'Active'
        and public.has_permission(target_ubr.company_id, 'job_title.manage')
    ) then
      raise exception 'permission denied: job_title.manage required to change job_title' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end; $$;
create trigger users_job_title_guard before update on public.users
  for each row execute function public.users_job_title_guard();

-- ── extend the standard role ladder: admin+ gets job_title.manage; co_owner/owner get position.manage too
--    (already implied by their full-catalog grant — this INSERT ensures it, and the admin-array addition
--    is explicit since admin does NOT hold the full catalog).
create or replace function public.seed_standard_roles(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_role uuid;
begin
  update public.roles set rank = 50 where company_id = p_company_id and role_key = 'owner' and rank <> 50;

  for r in
    select * from (values
      ('employee', 10, 'Enter individual sales only, check own pay',
        array['pos.sell']),
      ('operator', 20, 'Data entry inputs, POS cashier, view schedules',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read']),
      ('admin', 30, 'POS, financial statements, core ledgers, setup',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read',
              'pos.void','product.manage','crop.manage','equipment.manage','accounting.read','accounting.manage',
              'finance.account.read','finance.account.manage','payroll.read','payroll.manage','customer.read','customer.manage',
              'project.read','project.manage','schedule.manage','schedule.read_private','user.read','membership.read','audit.read',
              'job_title.manage']),
      ('co_owner', 40, 'All access — edit everything except developer configurations',
        null)
    ) as t(role_key, rank, description, keys)
  loop
    insert into public.roles (company_id, role_key, description, rank)
      values (p_company_id, r.role_key, r.description, r.rank)
      on conflict (company_id, role_key) do update set rank = excluded.rank;
    select id into v_role from public.roles where company_id = p_company_id and role_key = r.role_key;
    insert into public.role_permissions (company_id, role_id, permission_id)
      select p_company_id, v_role, p.id
      from public.permissions p
      where p.status = 'Active' and (r.keys is null or p.permission_key = any (r.keys))
      on conflict (role_id, permission_id) do nothing;
  end loop;
end; $$;

-- backfill: admin/co_owner/owner roles in every existing company pick up the new permissions retroactively
-- (a role's permission set is a snapshot at seed time — adding a catalog key does not retroactively apply
-- to an already-seeded role; the exact same lesson the P1C backfill already applied).
select public.seed_standard_roles(id) from public.companies;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 — link a role assignment to a Farm Hand payroll record (owner spec Part 1)
-- ════════════════════════════════════════════════════════════════════════════
-- Pre-existing latent bug (predates P1D, in M3): user_branch_roles' unique(user,company,branch,role) is
-- unconditional, so a user can NEVER be reassigned back to a role they previously held in the same branch
-- — the old, Expired row for that exact tuple permanently blocks a fresh Active insert. This breaks both
-- the existing client changeRole() (expire-old+insert-new) AND this migration's own role-reassignment
-- path. Fix: the constraint should mean "at most one ACTIVE row per (user,company,branch,role)", not
-- "this exact combination can only ever exist once, even after being retired" — replace with a partial
-- unique index scoped to Active rows; history (Expired rows) may repeat.
alter table public.user_branch_roles drop constraint user_branch_roles_user_id_company_id_branch_id_role_id_key;
create unique index user_branch_roles_active_uq on public.user_branch_roles (user_id, company_id, branch_id, role_id) where assignment_status = 'Active';

-- accept_invitation()'s ON CONFLICT target must match the new partial index exactly (an ON CONFLICT
-- clause with no matching constraint/index errors at runtime, not migration-apply time — this would have
-- been a silent landmine the next time it ran). Also fixes a second latent bug this constraint caused:
-- previously ANY existing row (Active OR Expired) for the same tuple silently no-op'd the insert, so
-- re-inviting someone to a role/branch they'd previously HELD AND LOST returned a fake "success" with
-- v_membership = NULL and no actual membership created. Scoping to Active-only fixes both issues in one
-- change. Everything else in the function is byte-identical to the original (P2-M1).
create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_inv public.invitations; v_auth uuid; v_user uuid; v_membership uuid;
begin
  v_auth := (select auth.uid());
  if v_auth is null then raise exception 'not authenticated' using errcode = 'insufficient_privilege'; end if;
  select * into v_inv from public.invitations where token = p_token for update;
  if not found then raise exception 'invalid invitation token' using errcode = 'raise_exception'; end if;
  if v_inv.status <> 'Pending' then
    raise exception 'invitation is not pending (status=%)', v_inv.status using errcode = 'raise_exception';
  end if;
  if v_inv.expires_at <= now() then
    update public.invitations set status = 'Expired', updated_at = now() where id = v_inv.id;
    raise exception 'invitation has expired' using errcode = 'raise_exception';
  end if;
  insert into public.users (auth_user_id, display_name) values (v_auth, coalesce(v_inv.email, 'Member'))
    on conflict (auth_user_id) do nothing;
  select id into v_user from public.users where auth_user_id = v_auth;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, v_inv.company_id, v_inv.branch_id, v_inv.role_id)
    on conflict (user_id, company_id, branch_id, role_id) where assignment_status = 'Active' do nothing
    returning id into v_membership;
  update public.invitations set status = 'Accepted', accepted_user_id = v_user, updated_at = now() where id = v_inv.id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_inv.company_id, v_inv.branch_id, v_user, 'Administrative', 'invitation.accepted', 'organization', 'user_branch_roles', v_membership);
  return v_membership;
end;
$$;

alter table public.users add column payroll_exempt boolean not null default false;
comment on column public.users.payroll_exempt is 'P1D §Part1: set true when an admin explicitly marks an account as not requiring payroll (the escape hatch). Prevents re-prompting for this account.';

-- The ONE governed entry point for both "approve a pending signup" and "change an existing member's role".
-- Atomic: for an ELIGIBLE role (rank < co_owner's 40) with no existing payroll link and not exempt, either
-- (a) creates + links a Farm Hand record in the SAME transaction as the membership, or (b) sets the exempt
-- flag — never a partial state (cancelling client-side simply never calls this function at all). For
-- co_owner/owner (rank >= 40) or an already-linked/exempt user, payroll is untouched — matches the spec's
-- "do not force every account into payroll" and "do not auto-alter payroll on a role change" rules exactly.
create function public.assign_membership_with_payroll(
  p_company_id uuid, p_target_user_id uuid, p_branch_id uuid, p_role_id uuid,
  p_employee_name text default null, p_position_id uuid default null, p_daily_rate numeric default null,
  p_exempt boolean default false
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; v_role_rank int; v_existing_employee uuid; v_prior_membership uuid; v_new_membership uuid; v_employee_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company_id, 'membership.manage') then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  -- same rank rule as direct assignment (P1C user_branch_roles_insert_manage) — never a peer-or-above role.
  if not public.outranks_role(p_company_id, p_role_id) then
    raise exception 'permission denied: you can only assign a role below your own tier' using errcode = 'insufficient_privilege';
  end if;

  select rank into v_role_rank from public.roles where id = p_role_id and company_id = p_company_id;
  if v_role_rank is null then raise exception 'role not found in this company' using errcode = 'raise_exception'; end if;

  if v_role_rank < 40 then
    select id into v_existing_employee from public.employees where company_id = p_company_id and user_id = p_target_user_id;
    if v_existing_employee is null and not p_exempt then
      if p_employee_name is null or trim(p_employee_name) = '' or p_position_id is null or p_daily_rate is null or p_daily_rate <= 0 then
        raise exception 'payroll setup required: name, position, and a positive daily rate must all be provided (or pass exempt)' using errcode = 'raise_exception';
      end if;
      insert into public.employees (company_id, employee_code, name, position_id, daily_rate, user_id)
        values (p_company_id, 'EMP-' || upper(right(replace(public.uuidv7()::text, '-', ''), 6)), trim(p_employee_name), p_position_id, p_daily_rate, p_target_user_id)
        returning id into v_employee_id;
      insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
        values (p_company_id, v_actor, 'Administrative', 'payroll.employee_created_via_approval', 'payroll', 'employees', v_employee_id);
    elsif v_existing_employee is null and p_exempt then
      update public.users set payroll_exempt = true where id = p_target_user_id;
      insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
        values (p_company_id, v_actor, 'Administrative', 'payroll.exemption_set', 'organization', 'users', p_target_user_id);
    end if;
    -- else: already linked — nothing payroll-related to do (role-change on an already-hired member).
  end if;

  select id into v_prior_membership from public.user_branch_roles
    where user_id = p_target_user_id and company_id = p_company_id and assignment_status = 'Active';
  if v_prior_membership is not null then
    update public.user_branch_roles set assignment_status = 'Expired' where id = v_prior_membership;
  end if;
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (p_target_user_id, p_company_id, p_branch_id, p_role_id)
    returning id into v_new_membership;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (p_company_id, p_branch_id, v_actor, 'Administrative',
            case when v_prior_membership is not null then 'membership.reassigned' else 'membership.assigned' end,
            'organization', 'user_branch_roles', v_new_membership);

  return v_new_membership;
end;
$$;
comment on function public.assign_membership_with_payroll(uuid, uuid, uuid, uuid, text, uuid, numeric, boolean) is 'P1D §Part1: the one governed entry point for approving/reassigning a member that also enforces the payroll-link rule for eligible (rank<40) roles. Atomic — never a half-changed state. Same auth as direct assignment (membership.manage + outranks_role).';
revoke all on function public.assign_membership_with_payroll(uuid, uuid, uuid, uuid, text, uuid, numeric, boolean) from public;
grant execute on function public.assign_membership_with_payroll(uuid, uuid, uuid, uuid, text, uuid, numeric, boolean) to authenticated;

-- Backfill banner data source: existing eligible members with no link and not exempt (the majority on
-- rollout, per the spec — never silently auto-created, just surfaced for an admin to act on).
create function public.list_unlinked_payroll_eligible(p_company_id uuid)
returns table(user_id uuid, display_name text, role_key text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.current_app_user_id() is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not (public.has_permission(p_company_id, 'membership.manage') or public.has_permission(p_company_id, 'payroll.manage')) then
    raise exception 'permission denied: membership.manage or payroll.manage' using errcode = 'insufficient_privilege';
  end if;
  return query
  select u.id, u.display_name, r.role_key
  from public.users u
  join public.user_branch_roles ubr on ubr.user_id = u.id and ubr.company_id = p_company_id and ubr.assignment_status = 'Active'
  join public.roles r on r.id = ubr.role_id and r.company_id = p_company_id
  where r.rank < 40
    and not u.payroll_exempt
    and not exists (select 1 from public.employees e where e.company_id = p_company_id and e.user_id = u.id)
  order by u.display_name;
end;
$$;
comment on function public.list_unlinked_payroll_eligible(uuid) is 'P1D §Part1: the backfill-banner data source — eligible members with no Farm Hand link and no exemption. membership.manage or payroll.manage required.';
revoke all on function public.list_unlinked_payroll_eligible(uuid) from public;
grant execute on function public.list_unlinked_payroll_eligible(uuid) to authenticated;
