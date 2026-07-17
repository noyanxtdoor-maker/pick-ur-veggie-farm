-- Migration P1H.1 — employee and operator gain project.read (owner request 2026-07-16, relayed via
-- the batch of directives given to Team B: "project checklist must be visible or all roles have
-- permission to read but admin and above only have permission to manage").
--
-- CURRENT STATE (confirmed by reading the live seed_standard_roles definition, P1H): employee holds
-- ['pos.sell','schedule.read'] and operator holds [...,'schedule.read'] — NEITHER has project.read.
-- Only admin+ can see the Project Checklist board at all. The owner's own words are unambiguous:
-- "all roles have permission to read" — employee and operator both need project.read; project.manage
-- correctly stays admin+ only (unchanged).
--
-- Risk: Low (a single additive read-only permission grant on two role tiers, same governed catalog
-- mechanism as P1H's schedule.read grant to employee). No rank/authz-model change; project.manage's
-- admin+ gate is untouched.

create or replace function public.seed_standard_roles(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_role uuid; v_owner_role uuid;
begin
  update public.roles set rank = 50 where company_id = p_company_id and role_key = 'owner' and rank <> 50;

  for r in
    select * from (values
      ('employee', 10, 'Enter individual sales only, check own pay and schedule',
        array['pos.sell','schedule.read','project.read']),
      ('operator', 20, 'Data entry inputs, POS cashier, view schedules',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read','project.read']),
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
      on conflict (company_id, role_key) do update set rank = excluded.rank, description = excluded.description;
    select id into v_role from public.roles where company_id = p_company_id and role_key = r.role_key;
    insert into public.role_permissions (company_id, role_id, permission_id)
      select p_company_id, v_role, p.id
      from public.permissions p
      where p.status = 'Active' and (r.keys is null or p.permission_key = any (r.keys))
      on conflict (role_id, permission_id) do nothing;
  end loop;

  -- P1D.1: owner always gets the full current catalog too — re-synced on every call, not just at bootstrap.
  select id into v_owner_role from public.roles where company_id = p_company_id and role_key = 'owner';
  if v_owner_role is not null then
    insert into public.role_permissions (company_id, role_id, permission_id)
      select p_company_id, v_owner_role, p.id from public.permissions p where p.status = 'Active'
      on conflict (role_id, permission_id) do nothing;
  end if;
end; $$;
comment on function public.seed_standard_roles(uuid) is 'P1C §2.2, evolved through P1D/P1D.1/P1H/P1H.1: idempotently seeds the 5-tier standard roles with their exact permission sets. Additive-only (never removes a mapping). service_role/bootstrap path only.';
revoke all on function public.seed_standard_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_standard_roles(uuid) to service_role;

-- Immediate backfill: existing companies' employee AND operator roles gain project.read right away,
-- without waiting for seed_standard_roles() to be re-invoked (same pattern as P1H's schedule.read backfill).
insert into public.role_permissions (company_id, role_id, permission_id)
select r.company_id, r.id, p.id
from public.roles r
join public.permissions p on p.permission_key = 'project.read' and p.status = 'Active'
where r.role_key in ('employee', 'operator')
on conflict (role_id, permission_id) do nothing;
