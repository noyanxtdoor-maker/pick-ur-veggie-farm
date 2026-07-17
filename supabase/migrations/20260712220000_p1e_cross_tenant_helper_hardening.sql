-- Migration P1E — Cross-tenant hardening on 7 pre-existing money/inventory helper functions (owner-
-- authorized investigation 2026-07-12, "the handful of functions (old code, weeks old) you found" — the
-- 7th, pos_next_seq, was found by a follow-up systematic sweep of every SECURITY DEFINER function taking
-- a company parameter, done in the same spirit; see its own comment below).
-- Authority: CLAUDE.md §6 (money paths are gated — owner authorized this specific investigation+fix
--   directly, in lieu of the full cross-vendor review process, given the narrow additive scope and time
--   constraints; recorded here for the record) · C7 §0/§2 (tenant isolation, permission-based authz).
-- Finding: pos_ensure_accounts, inventory_ensure_categories, inventory_ensure_accounts,
--   payroll_ensure_accounts, finance_resolve_pay_code, and pos_next_seq are all SECURITY DEFINER, granted
--   directly to `authenticated`, and NONE of them verify the caller actually belongs to p_company — they
--   trust the argument outright. Every EXISTING call site is safe (each passes a v_company the calling
--   function already derived from a branch/account the caller was independently checked against —
--   verified by reading every call site in the migration history before writing this fix), but each
--   function is ALSO independently reachable by ANY authenticated user via the public RPC endpoint,
--   bypassing those upstream checks entirely. Impact: pos/inventory/payroll_ensure_* let a stranger
--   silently pre-populate another company's chart-of-accounts/item-categories with boilerplate rows (low
--   severity — the rows are standard scaffolding, and the target's own RLS still hides them from view —
--   but a real, unauthorized cross-tenant write). finance_resolve_pay_code leaks a financial account's
--   COA code string to a caller who can produce a matching (company, branch, account) triple (an info
--   leak, not a balance/transaction leak). pos_next_seq lets a stranger burn/skip another company's
--   invoice/order/journal sequence numbers (a minor DoS-style annoyance, no data exposure). A systematic
--   check of every OTHER SECURITY DEFINER function taking a company parameter (trial_balance,
--   income_statement_monthly, balance_sheet, cash_flow_statement, customer_ar_standing,
--   financial_account_balances) confirmed all of them DO already check has_permission correctly — this is
--   NOT a wider pattern across the codebase, just these 7 helper/utility functions. Fix: each function now
--   requires the caller to actually belong to p_company — pure defense-in-depth; every legitimate call
--   chain is unaffected, since legitimate callers are already members of the company they're operating in
--   by construction.
-- Risk: Low (additive check only; no money-math, no rank/authz-model change). Verified: every call site
--   read; local guard battery green; new guard assertions specifically proving the cross-tenant call is
--   now blocked while the legitimate same-tenant path is unaffected.

create or replace function public.pos_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_company not in (select public.accessible_company_ids()) then
    raise exception 'permission denied: not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance) values
    (p_company, 'CASH',        'Cash on Hand',            'Asset',   'debit'),
    (p_company, 'SALES',       'Sales Revenue',           'Revenue', 'credit'),
    (p_company, 'COGS',        'Cost of Goods Sold',      'Expense', 'debit'),
    (p_company, 'FG_INVENTORY','Finished Goods Inventory','Asset',   'debit'),
    (p_company, 'AR',          'Accounts Receivable',     'Asset',   'debit')
  on conflict (company_id, account_code) do nothing;
end; $$;

create or replace function public.inventory_ensure_categories(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_company not in (select public.accessible_company_ids()) then
    raise exception 'permission denied: not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  insert into public.item_categories (company_id, category_key, name) values
    (p_company, 'seeds',     'Seeds/Seedlings'),
    (p_company, 'substrate', 'Substrate & Nutrients'),
    (p_company, 'packaging', 'Packaging'),
    (p_company, 'utilities', 'Water/Electricity'),
    (p_company, 'transport', 'Transport'),
    (p_company, 'misc',      'Miscellaneous'),
    (p_company, 'equipment', 'Equipment')
  on conflict (company_id, category_key) do nothing;
end; $$;

create or replace function public.inventory_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_company not in (select public.accessible_company_ids()) then
    raise exception 'permission denied: not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  perform public.pos_ensure_accounts(p_company);
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance) values
    (p_company, 'RAW_MATERIALS',      'Raw Materials Inventory',   'Asset',   'debit'),
    (p_company, 'EQUIPMENT',          'Equipment Assets',          'Asset',   'debit'),
    (p_company, 'SHRINKAGE',          'Inventory Shrinkage',       'Expense', 'debit'),
    (p_company, 'OPERATING_EXPENSES', 'Operating Expenses',        'Expense', 'debit'),
    (p_company, 'OWNER_EQUITY',       'Owner''s Equity',           'Equity',  'credit'),
    (p_company, 'LOANS_PAYABLE',      'Loans Payable',             'Liability','credit'),
    (p_company, 'OTHER_INCOME',       'Other Income',              'Revenue', 'credit')
  on conflict (company_id, account_code) do nothing;
end; $$;
comment on function public.inventory_ensure_accounts(uuid) is 'P2-M3A/M4A, tenant-hardened P1E: idempotent chart-of-accounts seed for inventory + accounting (22.03). Extends pos_ensure_accounts.';

create or replace function public.payroll_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_company not in (select public.accessible_company_ids()) then
    raise exception 'permission denied: not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  perform public.inventory_ensure_accounts(p_company);
  insert into public.chart_of_accounts (company_id, account_code, name, account_type, normal_balance) values
    (p_company, 'WAGES_EXPENSE',    'Labor & Wages Expense', 'Expense', 'debit'),
    (p_company, 'EMPLOYEE_ADVANCES','Employee Cash Advances','Asset',   'debit')
  on conflict (company_id, account_code) do nothing;
end; $$;

-- pos_next_seq: P1C.1 already closed the PUBLIC/anon execute grant (it had none at all — a separate,
-- more severe gap), but even restricted to `authenticated`, any authenticated user of ANY company could
-- still call it directly for a STRANGER company's sequence, burning/skipping their invoice/order/journal
-- numbers (a minor DoS-style annoyance — no data read/leak, since pos_sequences itself is never selected
-- from directly — but the same missing-membership-check pattern as the other 5, so closed here too for
-- consistency). Found during a systematic sweep of every SECURITY DEFINER function taking a company
-- parameter, done in response to the owner's "look into it" — not part of the original 6-function finding.
create or replace function public.pos_next_seq(p_company uuid, p_branch uuid, p_kind text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  if p_company not in (select public.accessible_company_ids()) then
    raise exception 'permission denied: not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  insert into public.pos_sequences (company_id, branch_id, kind, next_value)
    values (p_company, p_branch, p_kind, 2)
  on conflict (company_id, branch_id, kind) do update set next_value = public.pos_sequences.next_value + 1
  returning next_value - 1 into v;
  return v;
end; $$;

create or replace function public.finance_resolve_pay_code(p_company uuid, p_branch uuid, p_account_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_code text; v_status text; v_branch uuid; v_company uuid;
begin
  if p_company not in (select public.accessible_company_ids()) then
    raise exception 'permission denied: not a member of this company' using errcode = 'insufficient_privilege';
  end if;
  if p_account_id is null then return 'CASH'; end if;
  select coa_code, status, branch_id, company_id into v_code, v_status, v_branch, v_company
    from public.financial_accounts where id = p_account_id;
  if v_code is null or v_company <> p_company then raise exception 'financial account not found' using errcode = 'foreign_key_violation'; end if;
  if v_branch <> p_branch then raise exception 'financial account belongs to another branch' using errcode = 'check_violation'; end if;
  if v_status <> 'Active' then raise exception 'financial account is archived' using errcode = 'check_violation'; end if;
  return v_code;
end; $$;
