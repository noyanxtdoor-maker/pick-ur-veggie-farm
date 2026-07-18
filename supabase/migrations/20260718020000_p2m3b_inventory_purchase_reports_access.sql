-- Migration P2-M3B — Inventory "Purchase Summary" tab as its own access-gated section (owner directive
-- 2026-07-18): "Stock Inventories have 4 tabs, update our access system, i dont want lower tiers seeeing
-- our purchase history. they dont need to know that, add that 4 tabs and let me customize their access."
--
-- CURRENT STATE (confirmed, not assumed): app/features/inventory/InventoryScreen.tsx has 4 tabs
-- (Consumables & Seed Stocks, Heavy Equipment & Spades, Purchase Summary, Usage History) but ZERO
-- per-tab permission gating — the page-level check (inventory.purchase OR inventory.adjust OR
-- equipment.manage) is an all-or-nothing door; once through it, every tab is visible to everyone,
-- including the Purchase Summary tab's aggregate spend totals (by category and by source).
--
-- WHY NOT lock the underlying purchase_receivings table instead: its RLS policy
-- (purchase_receivings_select_member, 20260702220000) is deliberately company/branch-membership-only,
-- not permission-gated — and it needs to stay that way, because the SAME receivings feed the "Cumulative
-- expense value" / "Last Restocked" figures already shown on the Consumables tab's own category cards,
-- and the "Frequent descriptions" autocomplete in the Buy Stock modal — both of which anyone with
-- inventory.purchase legitimately needs for their actual job (buying stock). Locking the table would
-- break those for the exact tier (operator) who still needs to buy. The Purchase Summary TAB — an
-- aggregated cross-category/cross-source spend REPORT — is the thing the owner wants gated, not
-- individual restocking visibility for whoever is doing the restocking.
--
-- FIX: a new permission key, gating ONLY the Purchase Summary tab's visibility (client-side, same
-- mechanism as every other tab/nav-link visibility control in this app — see the Access panel /
-- OperationsLayout.tsx precedent). Default: admin and above only. employee/operator do not get it.

insert into public.permissions (permission_key, description) values
  ('inventory.reports.read', 'View the Stock Inventories "Purchase Summary" tab — aggregate spend by category/source. Does not affect the ability to buy stock or see individual restocking records.')
on conflict (permission_key) do nothing;

create or replace function public.seed_standard_roles(p_company_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_role uuid; v_owner_role uuid;
begin
  update public.roles set rank = 50 where company_id = p_company_id and role_key = 'owner' and rank <> 50;

  for r in
    select * from (values
      ('employee', 10, 'Enter individual sales only, check own pay and schedule',
        array['pos.sell','schedule.read','project.read','product.remove']),
      ('operator', 20, 'Data entry inputs, POS cashier, view schedules',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read','project.read','product.remove']),
      ('admin', 30, 'POS, financial statements, core ledgers, setup',
        array['pos.sell','pos.settle','cash.session','inventory.adjust','inventory.opening','inventory.purchase','schedule.read',
              'pos.void','product.manage','crop.manage','equipment.manage','accounting.read','accounting.manage',
              'finance.account.read','finance.account.manage','customer.read','customer.manage',
              'project.read','project.manage','schedule.manage','schedule.read_private','user.read','membership.read','audit.read',
              'job_title.manage','membership.approve','inventory.reports.read']),
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

  select id into v_owner_role from public.roles where company_id = p_company_id and role_key = 'owner';
  if v_owner_role is not null then
    insert into public.role_permissions (company_id, role_id, permission_id)
      select p_company_id, v_owner_role, p.id from public.permissions p where p.status = 'Active'
      on conflict (role_id, permission_id) do nothing;
  end if;
end; $$;
comment on function public.seed_standard_roles(uuid) is 'P1C §2.2, evolved through P1D/P1D.1/P1H/P1H.1/P1C3/P1O/P2M3B: idempotently seeds the 5-tier standard roles with their exact permission sets. Additive-only for INSERTs (never removes a mapping via this function). service_role/bootstrap path only.';
revoke all on function public.seed_standard_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_standard_roles(uuid) to service_role;

-- Backfill for EXISTING companies (seed_standard_roles is additive-only per-call, so existing companies
-- won't get inventory.reports.read until it's re-invoked for them — this INSERT does that directly).
insert into public.role_permissions (company_id, role_id, permission_id)
  select r.company_id, r.id, p.id
    from public.roles r, public.permissions p
   where r.role_key = 'admin' and p.permission_key = 'inventory.reports.read'
on conflict (role_id, permission_id) do nothing;
