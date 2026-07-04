-- Migration P2-M5C — Payroll self-visibility (owner review 2026-07-04, plan Phase B.1)
-- Owner rule: "operators, admin and employee can only see their own name or profile. co-owner and owner, and
--   dev can see all." Roles WITH payroll.read/manage keep full visibility (unchanged M5A policies); everyone
--   else gains visibility of EXACTLY their own linked employee row + their own advances/wages — nothing more.
-- Authority: 21 (payroll) + 26.09 (permission matrix — salary privacy) · pattern: ADDITIVE ONLY (Postgres ORs
--   permissive policies, so the locked M5A file is untouched). NON-money-mutating: a link column, three select
--   policies, one governed linking function. No amounts, no GL.
-- Deliberate choice: the self policies do NOT require branch membership — your own pay record follows you even
--   if your branch assignment changes (advances/wages are still branch-stamped for managers' views).

-- ── employees.user_id — which app user this staff record belongs to (nullable; staff without app access stay null) ──
alter table public.employees add column user_id uuid references public.users (id) on delete set null;
create unique index employees_user_link_uq on public.employees (company_id, user_id) where user_id is not null;
comment on column public.employees.user_id is 'P2-M5C: app-user linked to this staff record (payroll self-visibility). Set only via payroll_link_employee_user (payroll.manage; audited). One link per user per company.';

-- ── self-visibility policies (OR-ed with the M5A payroll.read policies) ──
create policy employees_select_self on public.employees for select to authenticated
  using (user_id is not null and user_id = public.current_app_user_id());
create policy cash_advances_select_self on public.cash_advances for select to authenticated
  using (exists (
    select 1 from public.employees e
    where e.id = cash_advances.employee_id and e.company_id = cash_advances.company_id
      and e.user_id = public.current_app_user_id()));
create policy wage_payments_select_self on public.wage_payments for select to authenticated
  using (exists (
    select 1 from public.employees e
    where e.id = wage_payments.employee_id and e.company_id = wage_payments.company_id
      and e.user_id = public.current_app_user_id()));

-- ════════════════════════════════════════════════════════════════════════════
-- payroll_link_employee_user — link/unlink a staff record to an app user. payroll.manage; the target user must
--   actually belong to the company (user_branch_roles); audited. p_user_id null = unlink.
-- ════════════════════════════════════════════════════════════════════════════
create function public.payroll_link_employee_user(p_employee_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_company uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select company_id into v_company from public.employees where id = p_employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = 'foreign_key_violation'; end if;
  if not public.has_permission(v_company, 'payroll.manage') then
    raise exception 'permission denied: payroll.manage' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id is not null and not exists (
    select 1 from public.user_branch_roles ubr where ubr.user_id = p_user_id and ubr.company_id = v_company
  ) then
    raise exception 'user is not a member of this company' using errcode = 'foreign_key_violation';
  end if;
  update public.employees set user_id = p_user_id where id = p_employee_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Administrative', case when p_user_id is null then 'payroll.employee_user_unlinked' else 'payroll.employee_user_linked' end, 'payroll', 'employees', p_employee_id);
end; $$;
comment on function public.payroll_link_employee_user(uuid, uuid) is 'P2-M5C: link/unlink a staff record to an app user for payroll self-visibility. payroll.manage; target must be a company member; audited. No GL.';
revoke all on function public.payroll_link_employee_user(uuid, uuid) from public;
grant execute on function public.payroll_link_employee_user(uuid, uuid) to authenticated;
