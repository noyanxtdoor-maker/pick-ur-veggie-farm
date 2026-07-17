-- Migration P1G.1 — HOTFIX: archive_user_account() required a separate manual revoke first, and that
-- two-step dance turned out to be fragile in real use (owner report 2026-07-13: "it says still holds an
-- active membership even though it's already revoked"). Root cause of the friction, not a false report —
-- an account can accumulate MORE than one user_branch_roles row over its lifetime (different branches,
-- or repeated reassignment), and the old check looked for ANY active row anywhere; revoking the one row
-- visible in the directory doesn't help if a second, easy-to-miss row is still Active elsewhere.
-- Fix: archive_user_account() now auto-revokes every remaining active membership itself, as ONE atomic
-- governed action, instead of requiring the approver to hunt down and revoke each row by hand first.
-- Still not a backdoor around the rank ladder: each membership is only auto-revoked if the actor
-- genuinely outranks that specific role (same check a normal revoke goes through, P1C) — if even one
-- active role outranks the actor, the whole call fails and nothing is touched (all-or-nothing).
-- Risk: Low (still permission + rank gated; strictly reduces friction, no new write surface).

create or replace function public.archive_user_account(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_row record;
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
  -- All-or-nothing rank check first (before touching any row): every active membership this account
  -- holds must be one the actor outranks, or the whole archive is refused.
  for v_row in select company_id, role_id from public.user_branch_roles where user_id = p_user_id and assignment_status = 'Active' loop
    if not public.outranks_role(v_row.company_id, v_row.role_id) then
      raise exception 'you do not outrank one of this account''s active roles — ask someone higher-ranked to archive it' using errcode = 'insufficient_privilege';
    end if;
  end loop;
  update public.user_branch_roles set assignment_status = 'Expired' where user_id = p_user_id and assignment_status = 'Active';
  update public.users set account_status = 'Archived' where id = p_user_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (null, v_actor, 'Administrative', 'user.archived', 'organization', 'users', p_user_id);
end;
$$;
comment on function public.archive_user_account(uuid) is 'P1G.1: retires a fully-Active account (account_status -> Archived), auto-revoking every remaining membership it holds in the same atomic call, each gated by the actor outranking that specific role. membership.manage required.';
