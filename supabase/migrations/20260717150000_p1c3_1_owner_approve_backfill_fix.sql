-- Migration P1C3.1 — hotfix: backfill membership.approve onto EXISTING co_owner/owner roles too, not
-- just admin. P1C3's own backfill only covered role_key='admin' — but co_owner/owner are supposed to
-- hold the FULL permission catalog (via seed_standard_roles()'s null-keys catch-all + the separate
-- owner full-resync block), which only actually re-applies when that function is CALLED. Since P1C3
-- introduced a brand-new key (membership.approve) without re-running seed_standard_roles() for
-- EXISTING companies, every pre-existing co_owner/owner was left missing it — silently locking the
-- real production owner out of the Approvals tab (AppShell.tsx's ORG_TABS gates Approvals on
-- membership.approve alone, single key, no OR-fallback to membership.manage at the tab-visibility
-- layer). Confirmed live 2026-07-17: the real production owner reported losing access to Approvals &
-- Roles immediately after the P1C3 push; a direct read-only query confirmed has_membership_approve =
-- false for every existing owner/co_owner row. Same additive-backfill pattern as P1C3's own admin
-- backfill and P1H.1's project.read backfill before it — pure INSERT, no removal, no data touched.
insert into public.role_permissions (company_id, role_id, permission_id)
  select r.company_id, r.id, p.id
  from public.roles r, public.permissions p
  where r.role_key in ('co_owner', 'owner') and p.permission_key = 'membership.approve'
on conflict (role_id, permission_id) do nothing;
