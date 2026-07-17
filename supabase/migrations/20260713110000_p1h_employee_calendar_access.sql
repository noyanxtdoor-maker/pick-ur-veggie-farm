-- Migration P1H — Employee gains schedule.read (owner request 2026-07-13, live-testing the Employee role).
-- Employee previously had only `pos.sell` — no Calendar/Schedule access at all, so the nav link either
-- didn't appear or (before P1H's NavRail change) led to a bare "Calendar access needed" screen. Operator
-- already has `schedule.read`; this brings Employee to the same baseline. The existing tiered visibility
-- (schedule.read vs schedule.read_private, M6C) already scopes WHAT they see within Calendar — this
-- migration only grants the base read key, same governed catalog mechanism as every other role tier.
-- Risk: Low (a single additive read-only permission grant, no rank/authz-model change).

create or replace function public.seed_standard_roles(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_role uuid; v_owner_role uuid;
begin
  update public.roles set rank = 50 where company_id = p_company_id and role_key = 'owner' and rank <> 50;

  for r in
    select * from (values
      ('employee', 10, 'Enter individual sales only, check own pay and schedule',
        array['pos.sell','schedule.read']),
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

-- Immediate backfill: existing companies' employee role gains schedule.read right away, without waiting
-- for seed_standard_roles() to be re-invoked (same pattern as P1D.1's owner backfill).
insert into public.role_permissions (company_id, role_id, permission_id)
select r.company_id, r.id, p.id
from public.roles r
join public.permissions p on p.permission_key = 'schedule.read' and p.status = 'Active'
where r.role_key = 'employee'
on conflict (role_id, permission_id) do nothing;
