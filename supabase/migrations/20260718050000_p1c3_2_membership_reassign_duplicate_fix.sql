-- P1C3.2 (owner report 2026-07-18): "test212 (owner) tried to customize access for my main account
-- (co-owner) and got 'permission denied: you can only override users below your tier'." Root-caused
-- against real production data, not assumed: the target account held TWO simultaneous Active rows in
-- user_branch_roles — co_owner (rank 40) AND owner (rank 50) in the same company/branch. Nothing in the
-- schema forbids a user holding more than one active role at once (the only unique constraint is on
-- (user_id, company_id, branch_id, role_id), which blocks an exact duplicate, not a second DIFFERENT
-- role). set_user_permission_override's target-rank lookup correctly takes MAX(rank) across every
-- active row, so it saw rank 50 — a tie with the rank-50 actor, which the strict-outrank check (§2.5)
-- correctly refuses.
--
-- The real defect is upstream: assign_membership_with_payroll's "expire the prior membership" step
-- was `select id into v_prior_membership ... where assignment_status = 'Active'` — a SELECT INTO a
-- scalar, with no LIMIT/ORDER BY. If a user already holds 2+ active rows (however that happened —
-- historical data, a race, manual SQL), this silently captures and expires only ONE of them, leaving
-- the rest active forever. Every future reassignment through this RPC would keep failing to fully
-- retire the duplicate. Fixed by expiring every currently-active row for the target in this company in
-- one set-based UPDATE before inserting the new one — self-healing any accumulated duplicates on the
-- very next reassignment, correct regardless of whether 0, 1, or N prior active rows existed.
create or replace function public.assign_membership_with_payroll(
  p_company_id uuid, p_target_user_id uuid, p_branch_id uuid, p_role_id uuid,
  p_employee_name text default null, p_position_id uuid default null, p_daily_rate numeric default null,
  p_exempt boolean default false
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; v_role_rank int; v_existing_employee uuid; v_expired_count int; v_new_membership uuid; v_employee_id uuid; v_has_prior boolean;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;

  -- P1C3: branch on whether the target already has an active membership. Approving a brand-new
  -- pending signup (no prior membership) accepts the lighter membership.approve tier; reassigning an
  -- EXISTING member's role still requires full membership.manage, unchanged — an approve-tier admin
  -- must not be able to reach reassignment by calling this RPC directly.
  select exists (
    select 1 from public.user_branch_roles
    where user_id = p_target_user_id and company_id = p_company_id and assignment_status = 'Active'
  ) into v_has_prior;

  if v_has_prior then
    if not public.has_permission(p_company_id, 'membership.manage') then
      raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
    end if;
  else
    if not (public.has_permission(p_company_id, 'membership.approve') or public.has_permission(p_company_id, 'membership.manage')) then
      raise exception 'permission denied: membership.approve' using errcode = 'insufficient_privilege';
    end if;
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

  -- P1C3.2 fix: expire EVERY active row for this user in this company — not just one.
  update public.user_branch_roles set assignment_status = 'Expired'
    where user_id = p_target_user_id and company_id = p_company_id and assignment_status = 'Active';
  get diagnostics v_expired_count = row_count;

  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (p_target_user_id, p_company_id, p_branch_id, p_role_id)
    returning id into v_new_membership;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (p_company_id, p_branch_id, v_actor, 'Administrative',
            case when v_expired_count > 0 then 'membership.reassigned' else 'membership.assigned' end,
            'organization', 'user_branch_roles', v_new_membership);

  return v_new_membership;
end;
$$;
comment on function public.assign_membership_with_payroll(uuid, uuid, uuid, uuid, text, uuid, numeric, boolean) is 'P1D §Part1, evolved P1C3, evolved P1C3.2 (2026-07-18): the one governed entry point for approving/reassigning a member; enforces the payroll-link rule for eligible (rank<40) roles. Atomic. Expires EVERY prior active row for the target in this company (set-based, not a scalar SELECT) before inserting the new one — self-heals any accumulated duplicate active memberships. Approving a brand-new signup (no prior active membership) accepts membership.approve OR membership.manage; reassigning an EXISTING member''s role still requires membership.manage, unchanged.';
revoke all on function public.assign_membership_with_payroll(uuid, uuid, uuid, uuid, text, uuid, numeric, boolean) from public, anon;
grant execute on function public.assign_membership_with_payroll(uuid, uuid, uuid, uuid, text, uuid, numeric, boolean) to authenticated;
