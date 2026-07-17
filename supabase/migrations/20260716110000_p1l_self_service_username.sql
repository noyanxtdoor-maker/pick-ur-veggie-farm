-- Migration P1L — Self-service username edit (ported from Team B / Repo B f0249fa, owner parity
-- order 2026-07-16; B's owner directive 2026-07-15: "everyone edits their OWN username, email, and
-- password"). public.users.username was added by P1J with a CHECK constraint
-- ('^[a-zA-Z0-9_.]{3,30}$', users_username_format) + a case-insensitive unique index
-- (users_username_lower_uq), but P1J granted NO self-update on the column — only display_name was
-- self-editable. This migration adds the governed self-service path: a SECURITY DEFINER RPC that an
-- authenticated Active user calls to change their OWN username, with server-side enforcement of the
-- format + uniqueness the CHECK/index define, so a client can never bypass validation.
--
-- Design notes (unchanged from B — reviewed against our schema, all helpers/columns identical):
--   * Actor = the caller (public.current_app_user_id()). The target is ALWAYS the caller — there
--     is no p_target_user_id param. No membership/permission key required: this is self-service,
--     not a governed admin action (unlike archive_user_account which needs membership.manage).
--   * account_status = 'Active' gate: Suspended/Archived users cannot change their username
--     (no suspended-account self-service — consistent with the P1J.2 hardening).
--   * Format + uniqueness are enforced server-side (the RPC explicitly raises on violation rather
--     than relying on the CHECK/unique constraint error surfacing, so the messages are readable
--     and the errcodes are stable for the client to branch on).
--   * RLS on public.users already allows update (display_name) to authenticated for own-row; we do
--     NOT widen that grant to include username — the RPC is the ONLY path (RLS-exempt via SECURITY
--     DEFINER, but the function enforces every precondition itself before the write).

create or replace function public.update_own_username(p_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_clean text;
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then
    raise exception 'not an active user' using errcode = 'insufficient_privilege';
  end if;

  -- Must be an Active account (Suspended/Archived cannot self-edit).
  if not exists (select 1 from public.users where id = v_user_id and account_status = 'Active') then
    raise exception 'your account is not active' using errcode = 'raise_exception';
  end if;

  -- Normalize + validate format (mirrors the users_username_format CHECK constraint from P1J).
  v_clean := lower(trim(p_username));
  if v_clean = '' or v_clean !~ '^[a-z0-9_.]{3,30}$' then
    raise exception 'username must be 3–30 characters: letters, numbers, dot, or underscore'
      using errcode = 'raise_exception';
  end if;

  -- Uniqueness (mirrors the users_username_lower_uq unique index — case-insensitive).
  if exists (select 1 from public.users where lower(username) = v_clean and id <> v_user_id) then
    raise exception 'that username is taken — try another'
      using errcode = 'unique_violation';
  end if;

  -- Write (own row only — the target is the caller, not a client-supplied id).
  update public.users set username = v_clean, updated_at = now() where id = v_user_id;

  -- Audit (event_class must be one of Security/Business/System/Administrative per the
  -- audit_events CHECK constraint; a credential-adjacent self-edit lands as Security).
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (null, v_user_id, 'Security', 'username.changed', 'organization', 'users', v_user_id);
end;
$$;

comment on function public.update_own_username(text) is 'P1L (ported from Repo B): self-service username change. The caller (an Active authenticated user) updates their OWN username — no permission key needed (self, not governed admin action). Server-side format + uniqueness enforcement mirrors the P1J CHECK/unique-index; Suspended/Archived accounts are blocked. Audit row written.';

revoke all on function public.update_own_username(text) from public, anon;
grant execute on function public.update_own_username(text) to authenticated;
