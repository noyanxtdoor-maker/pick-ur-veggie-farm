-- Migration P1D.1 — HOTFIX: owner role never gets backfilled when new permission keys are added.
-- Found immediately after the P1D push (2026-07-12) by a read-only post-deploy verification check: the
-- live production owner lacked position.manage AND job_title.manage, both added by this same P1D
-- migration. Root cause: seed_standard_roles() only loops employee/operator/admin/co_owner for
-- role_permissions backfill; owner's permission set was assumed permanently complete from
-- bootstrap_initial_tenant's one-time full-catalog grant, but that grant is a SNAPSHOT — any permission
-- key added to the catalog AFTER a company was bootstrapped never reaches that company's existing owner
-- role. This is a structural gap that will recur every time the catalog grows, not a one-off.
-- Risk: Low (pure permission grant, strictly additive, no rank/authz-model change). Urgent (production is
-- currently in a degraded state for the owner role on the one live company).

-- Immediate fix: backfill owner's role_permissions with the full current catalog, for every company.
insert into public.role_permissions (company_id, role_id, permission_id)
select r.company_id, r.id, p.id
from public.roles r
cross join public.permissions p
where r.role_key = 'owner' and p.status = 'Active'
on conflict (role_id, permission_id) do nothing;

-- Structural fix: seed_standard_roles() now ALSO re-syncs owner to the full catalog on every call (not
-- just employee/operator/admin/co_owner), so future permission-catalog growth never silently strands the
-- owner role again. Idempotent (on conflict do nothing) and safe to call redundantly from
-- bootstrap_initial_tenant (which already grants the full catalog once, directly).
create or replace function public.seed_standard_roles(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_role uuid; v_owner_role uuid;
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

  -- P1D.1: owner always gets the full current catalog too — re-synced on every call, not just at bootstrap.
  select id into v_owner_role from public.roles where company_id = p_company_id and role_key = 'owner';
  if v_owner_role is not null then
    insert into public.role_permissions (company_id, role_id, permission_id)
      select p_company_id, v_owner_role, p.id from public.permissions p where p.status = 'Active'
      on conflict (role_id, permission_id) do nothing;
  end if;
end; $$;
