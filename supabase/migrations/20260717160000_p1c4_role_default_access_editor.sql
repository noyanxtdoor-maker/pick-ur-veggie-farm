-- Migration P1C4 — Role default-access editor (owner directive 2026-07-17): "in the roles tab i want
-- to make change some of it permission or access, make it editable and so i can change its default
-- access, the system is same the one we made today." Extends the P1C3 nav-shaped Access panel from
-- per-USER overrides to per-ROLE defaults — same 3-state (Not Visible/View-only/Edit & Manage) UI,
-- same SECTION_TREE, same key pairs, but writing to a role's OWN `role_permissions` membership instead
-- of a per-user override.
--
-- **This is a deliberate reversal of an explicit prior design decision.** `public.role_permissions`
-- carries its own comment from M3 (20260622050044): "Immutable mapping (no updated_at)... No hard
-- delete." Only an INSERT RLS policy has ever existed (`role_permissions_insert_manage`, P1C.1-
-- hardened) — permissions could be ADDED to a role live, never removed; `roles.tsx`'s own G1 comment
-- states this outright and offers "deprecate and recreate" as the only narrowing path. Removing a
-- permission from a role now takes IMMEDIATE, live effect on every member currently holding that role
-- (has_permission reads role_permissions directly, no caching) — a materially different blast radius
-- than a per-user override, which only ever touches one person. Owner confirmed wanting this
-- capability explicitly, in the same message that named the P1C3 Access panel as the UI to reuse.
--
-- Addition keeps using the existing RLS-INSERT path (`role_permissions_insert_manage`, unchanged) —
-- this migration only adds the missing REMOVAL half, as a governed SECURITY DEFINER RPC (not a bare
-- RLS DELETE policy) so it gets the same rank/permission checks as the insert side PLUS an audit
-- trail, which the insert side has never had (an existing gap, not reproduced here — out of scope to
-- retrofit onto the unrelated insert path).
--
-- Rank protection is automatic, not special-cased: outranks_role(company, role_id) requires the
-- actor's rank to be STRICTLY GREATER than the target role's rank. Since owner is rank 50 (the
-- ceiling), nobody — not even another owner — can ever outrank the 'owner' role, so this RPC can
-- never touch it. co_owner (rank 40) is only editable by an owner. This exactly mirrors the existing
-- insert policy's protection level.

create function public.remove_role_permission(p_company_id uuid, p_role_id uuid, p_permission_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_permission_id uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company_id, 'role.manage') then
    raise exception 'permission denied: role.manage' using errcode = 'insufficient_privilege';
  end if;
  if not public.outranks_role(p_company_id, p_role_id) then
    raise exception 'permission denied: you can only edit roles below your own tier' using errcode = 'insufficient_privilege';
  end if;
  select id into v_permission_id from public.permissions where permission_key = p_permission_key and status = 'Active';
  if v_permission_id is null then
    raise exception 'unknown or inactive permission key' using errcode = 'raise_exception';
  end if;
  delete from public.role_permissions
    where company_id = p_company_id and role_id = p_role_id and permission_id = v_permission_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (p_company_id, v_actor, 'Administrative', 'role.permission_removed', 'organization', 'role_permissions', p_role_id);
end;
$$;
comment on function public.remove_role_permission(uuid, uuid, text) is 'P1C4: removes one permission_key from a role''s default set. Takes IMMEDIATE effect on every member currently holding that role (has_permission reads role_permissions live). role.manage + outranks_role required, same tier as the insert side; owner role is unreachable since nothing outranks rank 50. Audited (role.permission_removed).';
revoke all on function public.remove_role_permission(uuid, uuid, text) from public, anon;
grant execute on function public.remove_role_permission(uuid, uuid, text) to authenticated;

comment on table public.role_permissions is 'Role->permission mapping (Stage D Phase 1, M3; P1C4 2026-07-17: additions still go through the direct RLS-insert path (role_permissions_insert_manage); removals now go through the governed remove_role_permission() RPC, which is the only DELETE path — no bare DELETE RLS policy exists, so a removal always leaves an audit_events row).';
