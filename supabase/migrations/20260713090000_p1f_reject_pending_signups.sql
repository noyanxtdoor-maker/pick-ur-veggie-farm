-- Migration P1F — Reject a pending signup (owner request 2026-07-13). Companion to P1A's approval queue:
-- until now a pending sign-up could only be approved, never turned away. Authority: B7 §6 (account
-- lifecycle) · C2 §3 (auth ≠ authz) · CLAUDE.md §6 auth tripwire.
--
-- Explicitly NOT built here: hard-delete of the user row. `public.users` (M1,
-- 20260621142920_m1_identity_foundation.sql) carries its own comment: "Deactivate via account_status;
-- never hard-delete" — and every single table added since (audit_events, invoices, journal lines,
-- schedules, projects, employees, invitations, ...) references public.users(id) `on delete restrict`.
-- A real hard-delete would either fail with a raw foreign-key error the moment the account has touched
-- anything, or (if forced) silently break the append-only audit trail B6 depends on. "Reject" therefore
-- reuses the existing account_status='Suspended' lifecycle state (same one used for the E2E tester
-- suspension) — the identity stops being reachable, stops appearing in the pending queue, and can never
-- self-heal into access, but every FK it participates in stays intact.
--
-- Two pieces:
--  1. reject_pending_user(): membership.manage-gated (same gate as the approve path), only reachable
--     while the target is genuinely still pending (Active, zero memberships) — cannot be repurposed as a
--     generic "suspend anyone" shortcut around the rank-checked revoke path.
--  2. my_account_status(): lets a signed-in identity read its OWN account_status regardless of whether
--     that status is Active or Suspended. Needed because current_app_user_id() (M4) resolves to NULL for
--     a Suspended user by design (B1 §3) — without this, the client cannot tell "still pending" apart
--     from "rejected" and would show the same "hang tight" screen forever to someone who was turned away.
--     Self-only by construction (keyed to auth.uid()); no cross-user data exposure.

create function public.reject_pending_user(p_user_id uuid)
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
  if not exists (
    select 1 from public.users u
    where u.id = p_user_id and u.account_status = 'Active'
      and not exists (select 1 from public.user_branch_roles ubr where ubr.user_id = u.id and ubr.assignment_status = 'Active')
  ) then
    raise exception 'this account is not a pending signup (already assigned, already rejected, or not found)' using errcode = 'raise_exception';
  end if;
  update public.users set account_status = 'Suspended' where id = p_user_id;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (null, v_actor, 'Administrative', 'user.signup_rejected', 'organization', 'users', p_user_id);
end;
$$;
comment on function public.reject_pending_user(uuid) is 'P1F: turns away a pending signup (account_status -> Suspended). membership.manage required; only reachable while the target is still genuinely pending.';
revoke all on function public.reject_pending_user(uuid) from public;
grant execute on function public.reject_pending_user(uuid) to authenticated;

create function public.my_account_status()
returns text language sql stable security definer set search_path = '' as $$
  select u.account_status from public.users u where u.auth_user_id = (select auth.uid())
$$;
comment on function public.my_account_status() is 'P1F: self-only account_status read (Active/Suspended/NULL), unlike current_app_user_id() which resolves NULL for both "still pending" and "rejected" alike (B1 S3). Lets AwaitingApproval distinguish the two.';
revoke all on function public.my_account_status() from public;
grant execute on function public.my_account_status() to authenticated;
