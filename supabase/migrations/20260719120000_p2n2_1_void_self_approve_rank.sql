-- Migration P2N2.1 — void self-approval by rank (owner 2026-07-19, bug report: "tried to void as an
-- owner but it says 'you cannot approve your own void request'... owner should be able to void,
-- there should a ranking of which can approve or not, owner, co-owner, admin can approve their own
-- void, but employee and operator cannot unless given access").
--
-- P2N2's original separation-of-duties check (`v_actor = v_requested_by` → always blocked) applied
-- uniformly regardless of rank — exactly the P1M mistake P1M.2 already fixed for revoke ("only the
-- owner role can revoke without any approval from any tier"). Same shape here, but a WIDER threshold:
-- rank >= 30 (admin/co_owner/owner — the same tier `pos.void` is seeded to by default in
-- seed_standard_roles) may always approve their own void request; below that, self-approval stays
-- blocked UNLESS the account also holds the new `pos.void.self` key, granted explicitly via
-- Organization → Roles (the "given access" the owner asked for). This only ever matters for a
-- non-default configuration — pos.void itself isn't granted to employee/operator by default, so a
-- lower-rank account only reaches this branch at all if the owner already widened `pos.void` to them.
insert into public.permissions (permission_key, description) values
  ('pos.void.self', 'Approve your own void request without a second approver — only meaningful below admin rank, since admin/co-owner/owner already can via rank')
on conflict (permission_key) do nothing;

create or replace function public.approve_void_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor     uuid;
  v_company   uuid;
  v_branch    uuid;
  v_invoice   uuid;
  v_order     uuid;
  v_total     numeric;
  v_status    text;
  v_fa        uuid;
  v_pay_code  text;
  v_requested_by uuid;
  v_entry     uuid;
  a_pay uuid; a_sales uuid; a_cogs uuid; a_fg uuid; a_ar uuid;
  v_cogs numeric;
  r record;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  -- pos.void gate first
  select ubr.company_id into v_company
    from public.user_branch_roles ubr
   where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
     and public.has_permission(ubr.company_id, 'pos.void')
   limit 1;
  if v_company is null then
    raise exception 'permission denied: pos.void' using errcode = 'insufficient_privilege';
  end if;
  -- lock the request
  select vr.company_id, vr.branch_id, vr.invoice_id, vr.requested_by
    into v_company, v_branch, v_invoice, v_requested_by
    from public.void_requests vr
   where vr.id = p_request_id and vr.status = 'Pending' and vr.company_id = v_company
   for update of vr;
  if not found then
    raise exception 'void request not found, already decided, or outside your company' using errcode = 'raise_exception';
  end if;
  -- separation of duties, rank-gated (P2N2.1): admin+ (rank >= 30) may always approve their own
  -- request; below that, only if pos.void.self was explicitly granted.
  if v_actor = v_requested_by
     and public.actor_rank(v_company) < 30
     and not public.has_permission(v_company, 'pos.void.self') then
    raise exception 'you cannot approve your own void request — ask another admin+' using errcode = 'insufficient_privilege';
  end if;
  if not public.is_branch_member(v_branch) then
    raise exception 'not a member of this branch' using errcode = 'insufficient_privilege';
  end if;

  -- ── inlined reversal math (B2A-aware; mirrors pos_void_sale, 20260710090000_p2b2a) ──
  select i.sales_order_id, i.total, i.status, i.financial_account_id
    into v_order, v_total, v_status, v_fa
    from public.invoices i where i.id = v_invoice;
  if v_status = 'Voided' then
    -- idempotent: another path already voided it. Just mark the request Approved for audit.
    update public.void_requests
      set status = 'Approved', decided_by = v_actor, decided_at = now()
      where id = p_request_id;
    insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
      values (v_company, v_branch, v_actor, 'Administrative', 'void.approved', 'pos', 'void_requests', p_request_id,
              jsonb_build_object('note', 'invoice was already Voided — request closed without new reversal', 'invoice_id', v_invoice));
    return;
  end if;

  -- reverse against what was actually debited: the invoice's stored account (null = CASH
  -- drawer). Read the code directly, not via finance_resolve_pay_code: a void must succeed
  -- even if the account was archived after the sale — history mirrors history.
  if v_fa is null then v_pay_code := 'CASH';
  else select coa_code into v_pay_code from public.financial_accounts where id = v_fa; end if;

  -- stock returns (append-only movements) + COGS sum from the original lines
  v_cogs := 0;
  for r in select finished_goods_batch_id, quantity, unit_cost from public.sales_order_items
           where sales_order_id = v_order and finished_goods_batch_id is not null loop
    insert into public.inventory_movements (company_id, branch_id, finished_goods_batch_id, movement_type, quantity, unit_cost, total_cost, source_document_type, source_document_id, reason, actor_user_id)
      values (v_company, v_branch, r.finished_goods_batch_id, 'AdjustmentIncrease', r.quantity, r.unit_cost, round(r.quantity * r.unit_cost, 2), 'VoidedInvoice', v_invoice, 'Approved void request', v_actor);
    v_cogs := v_cogs + round(r.quantity * r.unit_cost, 2);
  end loop;

  select id into a_pay   from public.chart_of_accounts where company_id = v_company and account_code = v_pay_code;
  select id into a_sales from public.chart_of_accounts where company_id = v_company and account_code = 'SALES';
  select id into a_cogs  from public.chart_of_accounts where company_id = v_company and account_code = 'COGS';
  select id into a_fg    from public.chart_of_accounts where company_id = v_company and account_code = 'FG_INVENTORY';
  select id into a_ar    from public.chart_of_accounts where company_id = v_company and account_code = 'AR';
  v_entry := public.uuidv7();
  insert into public.journal_entries (id, company_id, branch_id, entry_number, source_document_type, source_document_id, description, created_by)
    values (v_entry, v_company, v_branch, public.pos_next_seq(v_company, v_branch, 'journal'), 'VoidedInvoice', v_invoice, 'Void (approved): ' || (select reason from public.void_requests where id = p_request_id), v_actor);
  -- reverse revenue against the account actually debited (a_pay), or AR if the sale was never paid
  insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
    (v_company, v_entry, a_sales, v_total, 0),
    (v_company, v_entry, case when v_status = 'Paid' then a_pay else a_ar end, 0, v_total);
  if v_cogs > 0 then
    insert into public.journal_lines (company_id, journal_entry_id, account_id, debit, credit) values
      (v_company, v_entry, a_fg,   v_cogs, 0),
      (v_company, v_entry, a_cogs, 0, v_cogs);
  end if;

  update public.invoices set status = 'Voided' where id = v_invoice;
  -- existing audit class (preserved for journal-history search) — same shape pos_void_sale writes
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id, new_value)
    values (v_company, v_branch, v_actor, 'Administrative', 'pos.sale_voided', 'pos', 'invoices', v_invoice, jsonb_build_object('reason', 'approved void request ' || p_request_id::text, 'was_status', v_status, 'reversed_account', v_pay_code));
  -- new approval audit
  update public.void_requests
    set status = 'Approved', decided_by = v_actor, decided_at = now()
    where id = p_request_id;
  insert into public.audit_events (company_id, branch_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    values (v_company, v_branch, v_actor, 'Administrative', 'void.approved', 'pos', 'void_requests', p_request_id);
end;
$$;
comment on function public.approve_void_request(uuid) is 'P2N2, evolved P2N2.1 (2026-07-19): approve a queued void. pos.void required; self-approval allowed for rank >= 30 (admin/co_owner/owner) or anyone holding pos.void.self, otherwise a DIFFERENT pos.void holder must approve. B2A-aware inlined reversal — reverses against invoice.financial_account_id (CASH if null), mirroring pos_void_sale, not a hardcoded Paid->CASH/Unpaid->AR pair. Approver is recorded as the actor on every audit/journal row.';
revoke all on function public.approve_void_request(uuid) from public, anon;
grant execute on function public.approve_void_request(uuid) to authenticated;
