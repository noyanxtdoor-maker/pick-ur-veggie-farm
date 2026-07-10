-- Migration P1B — approval queue shows the sign-up's REQUESTED role (owner ask 2026-07-10, screenshot flow:
-- "SELECT ROLE PERMISSION" at signup + "higher roles require strict approval").
-- SECURITY STANCE UNCHANGED: the requested role is a WISH stored in auth metadata — it grants nothing.
-- The approver still assigns the actual role through the existing governed membership path (C2 §3).
-- Additive: drop+recreate of the P1A read function only.

drop function public.list_pending_users();
create function public.list_pending_users()
returns table(user_id uuid, display_name text, email text, requested_role text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
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
  return query
  select u.id, u.display_name, u.email,
         nullif(trim(au.raw_user_meta_data ->> 'requested_role'), '') as requested_role,
         u.created_at
  from public.users u
  join auth.users au on au.id = u.auth_user_id
  where u.account_status = 'Active'
    and not exists (
      select 1 from public.user_branch_roles ubr
      where ubr.user_id = u.id and ubr.assignment_status = 'Active'
    )
  order by u.created_at;
end; $$;
comment on function public.list_pending_users() is 'P1B: the approval queue with the sign-up''s REQUESTED role (a wish from auth metadata — grants nothing; the approver assigns the actual role). membership.manage required.';
revoke all on function public.list_pending_users() from public;
grant execute on function public.list_pending_users() to authenticated;
