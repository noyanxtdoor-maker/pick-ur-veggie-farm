-- Migration P1M.2 — owner instant-revoke (owner directive 2026-07-17): "only the owner role can
-- revoke without any approval from any tier, but co-owner and below must need approval from owner or
-- co-owner." P1M's original separation-of-duties design applied uniformly to every membership.manage
-- holder (co_owner and owner alike) — this evolves it: the owner tier (rank 50, the ceiling — nothing
-- outranks it) executes a revoke immediately, since there is structurally nobody left to separate
-- duties from. Everyone else (co_owner, or any future rank granted membership.manage via an override)
-- still goes through the existing queue + a DIFFERENT membership.manage holder's approval, unchanged.
--
-- Design: rather than splitting "instant" and "queued" revoke history across two mechanisms, an
-- instant owner revoke still writes a row to revoke_requests — just already 'Approved', with
-- decided_by = the same actor who requested it (the only place in this schema decided_by can equal
-- requested_by, since P1M's `approver != requester` check is specific to the *approve_revoke_request*
-- RPC, which this instant path never calls — it does the same outranks-target check + membership
-- expiry + audit event inline instead). This keeps a single, consistent historical record and doesn't
-- collide with the "one Pending per target" partial unique index (this row is never 'Pending').

create or replace function public.request_revoke(p_target_user_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor    uuid;
  v_company  uuid;
  v_existing uuid;
  v_rank     int;
  v_row      record;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if v_actor = p_target_user_id then
    raise exception 'you cannot request your own revoke' using errcode = 'insufficient_privilege';
  end if;
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'membership.manage')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.user_branch_roles ubr
     where ubr.user_id = p_target_user_id and ubr.company_id = v_company and ubr.assignment_status = 'Active'
  ) then
    raise exception 'target has no active membership in your company to revoke' using errcode = 'raise_exception';
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'a reason is required' using errcode = 'raise_exception';
  end if;

  v_rank := public.actor_rank(v_company);

  -- Owner tier: execute immediately, no approval queue.
  if v_rank >= 50 then
    for v_row in select role_id from public.user_branch_roles
                   where user_id = p_target_user_id and company_id = v_company and assignment_status = 'Active' loop
      if not public.outranks_role(v_company, v_row.role_id) then
        raise exception 'you do not outrank one of this account''s active roles' using errcode = 'insufficient_privilege';
      end if;
    end loop;
    update public.user_branch_roles set assignment_status = 'Expired'
      where user_id = p_target_user_id and company_id = v_company and assignment_status = 'Active';
    insert into public.revoke_requests (company_id, target_user_id, requested_by, reason, status, decided_by, decided_at)
      values (v_company, p_target_user_id, v_actor, trim(p_reason), 'Approved', v_actor, now())
      returning id into v_existing;
    insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
      values (v_company, v_actor, 'Administrative', 'revoke.approved', 'organization', 'users', p_target_user_id);
    return v_existing;
  end if;

  -- Everyone else (co_owner, or a future override-granted rank): unchanged queue + approval flow.
  select id into v_existing from public.revoke_requests
   where company_id = v_company and target_user_id = p_target_user_id and status = 'Pending';
  if v_existing is not null then
    raise exception 'a Pending revoke request already exists for this account' using errcode = 'raise_exception';
  end if;
  insert into public.revoke_requests (company_id, target_user_id, requested_by, reason, status)
    values (v_company, p_target_user_id, v_actor, trim(p_reason), 'Pending')
    returning id into v_existing;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_actor, 'Administrative', 'revoke.requested', 'organization', 'revoke_requests', v_existing);
  return v_existing;
end;
$$;
comment on function public.request_revoke(uuid, text) is 'P1M, evolved P1M.2 (2026-07-17): owner tier (rank 50) executes a revoke immediately (writes an already-Approved revoke_requests row + revoke.approved audit event); every other membership.manage holder still queues a Pending request requiring a DIFFERENT membership.manage holder''s approval, unchanged.';
revoke all on function public.request_revoke(uuid, text) from public, anon;
grant execute on function public.request_revoke(uuid, text) to authenticated;
