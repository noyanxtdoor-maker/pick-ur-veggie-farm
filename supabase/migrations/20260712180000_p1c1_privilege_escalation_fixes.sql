-- Migration P1C.1 — Privilege-escalation fixes found in a post-ship review of P1C (2026-07-12, same day).
-- Authority: CLAUDE.md §6 (auth domain, Phase 1) · C7 §0/§2 (permission-based authz, never trust client input)
--   · directly evolves 20260712130000_p1c_approvals_roles_hardening.sql's own invariants.
-- Scope: THREE confirmed holes, all closing gaps in the rank system P1C itself introduced (or, for #3,
--   never extended to a pre-existing parallel entry point). No new features; pure hardening.
-- Risk: Critical (auth domain, live exploit paths). Verified against scripts/guards/approvals-roles-security.sql
--   (extended) before this file was written; full 16-guard local suite green before this shipped.

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 1 — invite_user() had NO rank check at all (P1C hardened the DIRECT assignment path
--   via user_branch_roles_insert_manage, but never touched this PARALLEL path). A co_owner
--   (rank 40, holds user.invite by default via the full catalog) could invite ANYONE — including
--   themselves under a second identity — directly into the owner role (rank 50). accept_invitation()
--   is SECURITY DEFINER and trusts the invitation's role_id completely, so there was no second gate.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.invite_user(
  p_company_id uuid, p_branch_id uuid, p_role_id uuid, p_email text, p_valid_days int default 7
) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_inviter uuid; v_token text;
begin
  v_inviter := public.current_app_user_id();
  if v_inviter is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not public.has_permission(p_company_id, 'user.invite') then
    raise exception 'permission denied: user.invite in this company' using errcode = 'insufficient_privilege';
  end if;
  -- P1C.1: the inviter must strictly outrank the role being invited to — same rule as the direct
  -- assignment path (user_branch_roles_insert_manage). Closes the parallel-entry-point escalation.
  if not public.outranks_role(p_company_id, p_role_id) then
    raise exception 'permission denied: you can only invite into a role below your own tier' using errcode = 'insufficient_privilege';
  end if;
  v_token := gen_random_uuid()::text || gen_random_uuid()::text;   -- 244 bits, unguessable
  -- Composite FKs reject a branch/role that is not in p_company_id (cross-company invite impossible).
  insert into public.invitations (company_id, branch_id, role_id, email, token, invited_by, expires_at)
    values (p_company_id, p_branch_id, p_role_id, p_email, v_token, v_inviter, now() + make_interval(days => p_valid_days));
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type)
    values (p_company_id, p_branch_id, v_inviter, 'Administrative', 'user.invited', 'organization', 'invitation');
  return v_token;
end;
$$;
comment on function public.invite_user(uuid, uuid, uuid, text, int) is 'Phase 2 M1, rank-hardened P1C.1: create a single-use invitation (gated by user.invite AND outranks_role — closes the parallel-entry escalation P1C missed; cross-company blocked by composite FK; audited). Returns the capability token.';

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 2 — the self-management exemption on user_branch_roles UPDATE was too broad. It exempted
--   ANY update to the caller's OWN row from the rank check, not just "suspend yourself" (the only
--   case it was designed for and the only case org-security.sql actually tests). Since rows are
--   never hard-deleted (a demotion is: old row -> Expired, new row -> Active), a user who once held
--   a higher-rank role could UPDATE that OLD, dormant, Expired row of their OWN back to Active,
--   self-resurrecting a rank they no longer hold — with zero rank check, because "it's my own row"
--   satisfied the exemption regardless of which row or which direction.
-- FIX: narrow the exemption so it only ever permits the Active -> Expired transition on your own row
--   (self-suspend, the tested, intended case). ANY reactivation (Expired -> Active) — including of
--   your own row — now always requires outranks_role, exactly like acting on someone else's row.
-- ════════════════════════════════════════════════════════════════════════════
drop policy user_branch_roles_update_manage on public.user_branch_roles;
create policy user_branch_roles_update_manage on public.user_branch_roles
  for update to authenticated
  using (public.has_permission(company_id, 'membership.manage')
         and (
           (user_id = public.current_app_user_id() and assignment_status = 'Active')
           or public.outranks_role(company_id, role_id)
         ))
  with check (public.has_permission(company_id, 'membership.manage')
              and (
                (user_id = public.current_app_user_id() and assignment_status = 'Expired')
                or public.outranks_role(company_id, role_id)
              ));
comment on policy user_branch_roles_update_manage on public.user_branch_roles is 'P1C.1-hardened: self-exemption narrowed to the Active->Expired transition ONLY (self-suspend). Any reactivation, including of your own dormant higher-rank row, requires outranks_role — closes the self-resurrection escalation.';

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 3 — role_permissions_insert_manage only checked that the actor outranks the ROLE being
--   edited; it never checked the actor already HOLDS the permission being added. A co_owner/owner
--   (the only tiers with both role.manage and membership.manage) could create an innocuous
--   low-rank role (e.g. rank 5, "junior helper") and stuff it with ANY permission from the global
--   catalog — including ones irrelevant to that low rank — then assign that role to someone via the
--   already-rank-checked assignment path. Rank governed WHO can assign a role and WHAT RANK a role
--   could be, but never WHAT PERMISSIONS a role could carry relative to the actor's own.
-- FIX: the actor must already hold the specific permission_key being added, in the SAME company.
-- ════════════════════════════════════════════════════════════════════════════
drop policy role_permissions_insert_manage on public.role_permissions;
create policy role_permissions_insert_manage on public.role_permissions
  for insert to authenticated
  with check (public.has_permission(company_id, 'role.manage')
              and public.outranks_role(company_id, role_id)
              and public.has_permission(company_id, (select p.permission_key from public.permissions p where p.id = permission_id)));
comment on policy role_permissions_insert_manage on public.role_permissions is 'P1C.1-hardened: adding a permission to a role now ALSO requires the actor already hold that exact permission themselves — closes the proxy-role escalation (stuffing a low-rank role with permissions the actor holds but the role''s rank would not otherwise imply).';

-- ════════════════════════════════════════════════════════════════════════════
-- FIX 4 (minimal hardening, zero behavior change for legitimate callers) — pos_next_seq was the
--   only SECURITY DEFINER function in the schema with no revoke/grant statement, so it defaulted to
--   PostgreSQL's standard PUBLIC execute grant: callable pre-auth via the anon API key, writing an
--   arbitrary company_id/branch_id's sequence counter with zero validation. Locked down to match
--   every other function in the codebase (authenticated only); the function is otherwise unchanged.
-- ════════════════════════════════════════════════════════════════════════════
revoke all on function public.pos_next_seq(uuid, uuid, text) from public, anon;
grant execute on function public.pos_next_seq(uuid, uuid, text) to authenticated;
