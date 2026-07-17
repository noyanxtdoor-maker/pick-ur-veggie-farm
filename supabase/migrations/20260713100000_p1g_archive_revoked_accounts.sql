-- Migration P1G — Archive a revoked account (owner request 2026-07-13, replacing an earlier "hard delete
-- revoked accounts" ask once the "never hard-delete" invariant from M1 was surfaced). A third
-- account_status alongside Active/Suspended: Archived means "fully retired from the roster, hidden from
-- the day-to-day directory" — distinct from Suspended (P1F's "rejected at signup, never had access") so
-- the two situations stay tellable apart in an audit review. Same non-negotiable as P1F: no row is ever
-- deleted; every table added since M1 references public.users(id) `on delete restrict`.
-- Authority: B7 §6 (account lifecycle) · B6 (audit trail must survive) · CLAUDE.md §6 auth tripwire.

alter table public.users drop constraint users_account_status_check;
alter table public.users add constraint users_account_status_check check (account_status in ('Active', 'Suspended', 'Archived'));
-- No RLS/resolver change needed: current_app_user_id() and every self-row policy gate on
-- `account_status = 'Active'` (positive match), so Archived is already blocked identically to Suspended
-- everywhere access is checked — this migration only needs to teach the CHECK constraint the new value.

create function public.archive_user_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not exists (
    select 1 from public.user_branch_roles ubr
    where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
      and public.has_permission(ubr.company_id, 'membership.manage')
  ) then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and account_status = 'Active') then
    raise exception 'account not found or not currently Active' using errcode = 'raise_exception';
  end if;
  -- Archive is a cleanup step AFTER revoke, not a substitute for the rank-checked revoke path — a target
  -- with a live membership anywhere must be revoked (Expired) there first.
  if exists (select 1 from public.user_branch_roles where user_id = p_user_id and assignment_status = 'Active') then
    raise exception 'this account still holds an active membership — revoke it first, then archive' using errcode = 'raise_exception';
  end if;
  update public.users set account_status = 'Archived' where id = p_user_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (null, v_actor, 'Administrative', 'user.archived', 'organization', 'users', p_user_id);
end;
$$;
comment on function public.archive_user_account(uuid) is 'P1G: retires a fully-revoked account (account_status -> Archived) so it drops out of the active directory. membership.manage required; the target must already hold zero active memberships anywhere.';
revoke all on function public.archive_user_account(uuid) from public;
grant execute on function public.archive_user_account(uuid) to authenticated;

create function public.unarchive_user_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not exists (
    select 1 from public.user_branch_roles ubr
    where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
      and public.has_permission(ubr.company_id, 'membership.manage')
  ) then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and account_status = 'Archived') then
    raise exception 'account not found or not currently Archived' using errcode = 'raise_exception';
  end if;
  update public.users set account_status = 'Active' where id = p_user_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (null, v_actor, 'Administrative', 'user.unarchived', 'organization', 'users', p_user_id);
end;
$$;
comment on function public.unarchive_user_account(uuid) is 'P1G: brings an archived account back to Active (still holds zero memberships — an admin must separately assign a role, same as any other unassigned identity). membership.manage required.';
revoke all on function public.unarchive_user_account(uuid) from public;
grant execute on function public.unarchive_user_account(uuid) to authenticated;
