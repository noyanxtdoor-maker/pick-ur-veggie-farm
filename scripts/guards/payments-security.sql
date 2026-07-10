-- Tier-2 BEHAVIORAL Digital-Payments security test (Phase 2 B2A) — blocking gate.
-- Proves the B2 spec §5 obligations: a GCash sale posts to the wallet's COA code (not CASH) with total assets
-- unchanged in composition-shift-only fashion; settlements and voids mirror the account actually used; transfers
-- move balance with ZERO net asset change and NO P&L line; the cash-flow closing equals the sum of derived
-- account balances; per-account permission + branch + tenant isolation hold; balances are DERIVED (no writable
-- balance surface). Runs as authenticated users with simulated JWTs. Self-contained BEGIN/ROLLBACK.
\set ON_ERROR_STOP on
begin;
-- P1A: the signup trigger is under test in auth-lifecycle-security.sql; these fixtures construct
-- identities manually with fixed ids, so silence it inside this rolled-back transaction.
set local app.p1a_skip_signup_trigger = '1';

-- ── fixtures ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-00000000000a','authenticated','authenticated','ownerA@t.local'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-00000000000b','authenticated','authenticated','ownerB@t.local'),
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-00000000000c','authenticated','authenticated','workerA@t.local');
insert into public.users (id, auth_user_id, display_name) values
  ('10000000-0000-0000-0000-00000000000a','0a000000-0000-0000-0000-00000000000a','Owner A'),
  ('10000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b','Owner B'),
  ('10000000-0000-0000-0000-00000000000c','0c000000-0000-0000-0000-00000000000c','Worker A');
insert into public.companies (id, company_code, name) values
  ('11111111-1111-1111-1111-111111111111','CO-A','Company A'),
  ('22222222-2222-2222-2222-222222222222','CO-B','Company B');
insert into public.branches (id, company_id, branch_code, name) values
  ('a1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','BR-A1','Branch A1'),
  ('a2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','BR-A2','Branch A2'),
  ('b1111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','BR-B1','Branch B1');
insert into public.roles (id, company_id, role_key, description) values
  ('20000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','Owner A'),
  ('20000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','owner','Owner B'),
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker (pos.sell only)');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions
  where permission_key in ('finance.account.read','finance.account.manage','pos.sell','pos.settle','pos.void','accounting.read','inventory.opening','product.manage');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions
  where permission_key in ('finance.account.read','finance.account.manage','pos.sell','accounting.read','inventory.opening','product.manage');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000c', id from public.permissions
  where permission_key in ('pos.sell');  -- worker: NO finance.account.*
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000c');
insert into public.products (id, company_id, product_code, name, retail_per_kg) values
  ('ca000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','LETTUCE','Lettuce',100.00);

-- HAPPY: owner A registers the drawer + a GCash wallet; backing COA Asset code is created on demand
do $$ declare v_cash uuid; v_gcash uuid; v_type text; v_nb text;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_cash  := public.financial_ensure_cash('a1111111-1111-1111-1111-111111111111');
  v_gcash := public.financial_account_upsert('a1111111-1111-1111-1111-111111111111','GCash Wallet','Digital Wallet','WALLET_GCASH','GCash','0917-000-0000');
  set local role postgres;
  select account_type, normal_balance into v_type, v_nb from public.chart_of_accounts
    where company_id = '11111111-1111-1111-1111-111111111111' and account_code = 'WALLET_GCASH';
  if v_type is distinct from 'Asset' or v_nb is distinct from 'debit' then
    raise exception 'DEFECT pay: WALLET_GCASH COA backing wrong (type=% nb=%)', v_type, v_nb; end if;
  if v_cash is null or v_gcash is null then raise exception 'DEFECT pay: account registration returned null'; end if;
  raise notice 'PASS pay: drawer + GCash registered; backing COA Asset created on demand';
end $$;

-- GATE: worker without finance.account.manage cannot create; without finance.account.read sees 0 rows
do $$ declare v_denied boolean := false; n int;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  begin perform public.financial_account_upsert('a1111111-1111-1111-1111-111111111111','Sneaky','Bank','BANK_SNEAK');
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT pay: worker without finance.account.manage created an account'; end if;
  select count(*) into n from public.financial_accounts;
  if n <> 0 then raise exception 'DEFECT pay: worker without finance.account.read sees % account rows', n; end if;
  raise notice 'PASS pay: manage gate + read RLS enforced against worker';
end $$;

-- ISOLATION: owner B cannot create in company A nor read A''s balances
do $$ declare d1 boolean := false; d2 boolean := false;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0b000000-0000-0000-0000-00000000000b"}';
  begin perform public.financial_account_upsert('a1111111-1111-1111-1111-111111111111','X','Bank','BANK_X');
  exception when insufficient_privilege then d1 := true; end;
  begin perform * from public.financial_account_balances('11111111-1111-1111-1111-111111111111');
  exception when insufficient_privilege then d2 := true; end;
  if not (d1 and d2) then raise exception 'DEFECT pay: cross-tenant account write/read not denied (write=% read=%)', d1, d2; end if;
  raise notice 'PASS pay: cross-tenant account write + balances read denied';
end $$;

-- RESERVED: a new account cannot claim an existing COA code (would corrupt statements)
do $$ declare v_denied boolean := false;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  begin perform public.financial_account_upsert('a1111111-1111-1111-1111-111111111111','Evil','Bank','SALES');
  exception when check_violation then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT pay: an account claimed the SALES COA code'; end if;
  raise notice 'PASS pay: existing COA codes are rejected for new accounts';
end $$;

-- MONEY: a GCash sale debits WALLET_GCASH (not CASH); invoice stores the account; a cash sale debits CASH.
--   Composition-shift-only: balance_sheet cash&equivalents == derived CASH + WALLET balances, and ties.
do $$ declare
  v_fg uuid; v_gcash uuid; v_inv1 uuid; v_inv2 uuid; v_fa_on_inv uuid;
  v_wallet_dr numeric; v_cash_dr numeric; v_bs record; v_sum numeric;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select account_id into v_gcash from public.financial_account_balances('11111111-1111-1111-1111-111111111111') where coa_code = 'WALLET_GCASH';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-PAY', 20.0, 40.00, 'pay-open', 'opening');
  -- 2kg @ farm 90 = 180 into GCash; 3kg @ farm 90 = 270 into the drawer
  v_inv1 := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 2.0)),
    180, 'pay-sale-gcash', 'paid', 0, 0, null, v_gcash);
  v_inv2 := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 3.0)),
    270, 'pay-sale-cash', 'paid');
  set local role postgres;
  select coalesce(sum(jl.debit), 0) into v_wallet_dr
    from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
    where je.source_document_id = v_inv1 and a.account_code = 'WALLET_GCASH';
  if v_wallet_dr <> 180.00 then raise exception 'DEFECT pay: GCash sale debit on WALLET_GCASH = % (want 180)', v_wallet_dr; end if;
  select coalesce(sum(jl.debit), 0) into v_cash_dr
    from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
    where je.source_document_id = v_inv1 and a.account_code = 'CASH';
  if v_cash_dr <> 0 then raise exception 'DEFECT pay: GCash sale also debited CASH (%)', v_cash_dr; end if;
  select financial_account_id into v_fa_on_inv from public.invoices where id = v_inv1;
  if v_fa_on_inv is distinct from v_gcash then raise exception 'DEFECT pay: invoice does not store the payment account'; end if;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select * into v_bs from public.balance_sheet('11111111-1111-1111-1111-111111111111');
  select sum(balance) into v_sum from public.financial_account_balances('11111111-1111-1111-1111-111111111111');
  if round(v_bs.cash - v_sum, 2) <> 0 then raise exception 'DEFECT pay: BS cash&equivalents (%) <> sum of derived account balances (%)', v_bs.cash, v_sum; end if;
  if round(v_bs.total_assets - (v_bs.total_liabilities + v_bs.total_equity), 2) <> 0 then
    raise exception 'DEFECT pay: balance sheet does not tie (A=% L+E=%)', v_bs.total_assets, v_bs.total_liabilities + v_bs.total_equity; end if;
  raise notice 'PASS pay: GCash sale → WALLET_GCASH 180, CASH untouched; invoice stores account; BS cash&equiv = Σ derived balances = %; ties', v_sum;
end $$;

-- MONEY: settle a pre-order INTO the wallet → Dr WALLET_GCASH / Cr AR; invoice records the account
do $$ declare v_fg uuid; v_inv uuid; v_gcash uuid; v_dr numeric; v_ar_cr numeric; v_fa uuid;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select account_id into v_gcash from public.financial_account_balances('11111111-1111-1111-1111-111111111111') where coa_code = 'WALLET_GCASH';
  select fa.id into v_fg from public.finished_goods_batches fa where fa.company_id = '11111111-1111-1111-1111-111111111111' limit 1;
  v_inv := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 1.0)),
    0, 'pay-preorder', 'preorder');
  perform public.pos_settle_sale(v_inv, 90, v_gcash);
  set local role postgres;
  select coalesce(sum(case when a.account_code = 'WALLET_GCASH' then jl.debit else 0 end), 0),
         coalesce(sum(case when a.account_code = 'AR' then jl.credit else 0 end), 0)
    into v_dr, v_ar_cr
    from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
    where je.source_document_type = 'Settlement' and je.source_document_id = v_inv;
  if v_dr <> 90.00 or v_ar_cr <> 90.00 then raise exception 'DEFECT pay: settlement legs wrong (wallet dr=% ar cr=%)', v_dr, v_ar_cr; end if;
  select financial_account_id into v_fa from public.invoices where id = v_inv;
  if v_fa is distinct from v_gcash then raise exception 'DEFECT pay: settlement did not record the account on the invoice'; end if;
  raise notice 'PASS pay: settlement Dr WALLET_GCASH / Cr AR (90) + account recorded';
end $$;

-- MONEY: voiding the GCash-paid sale reverses against WALLET_GCASH (mirror), never CASH
do $$ declare v_inv uuid; v_wallet_cr numeric; v_cash_cr numeric;
begin
  set local role postgres;
  select i.id into v_inv from public.invoices i
    join public.sales_orders so on so.id = i.sales_order_id
    where so.idempotency_key = 'pay-sale-gcash';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.pos_void_sale(v_inv, 'guard: wrong item');
  set local role postgres;
  select coalesce(sum(case when a.account_code = 'WALLET_GCASH' then jl.credit else 0 end), 0),
         coalesce(sum(case when a.account_code = 'CASH' then jl.credit else 0 end), 0)
    into v_wallet_cr, v_cash_cr
    from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
    where je.source_document_type = 'VoidedInvoice' and je.source_document_id = v_inv;
  if v_wallet_cr <> 180.00 then raise exception 'DEFECT pay: void did not credit WALLET_GCASH (got %)', v_wallet_cr; end if;
  if v_cash_cr <> 0 then raise exception 'DEFECT pay: void credited CASH (%) for a GCash-paid sale', v_cash_cr; end if;
  raise notice 'PASS pay: void reverses against the wallet actually debited (180), CASH untouched';
end $$;

-- MONEY: transfer drawer→GCash moves balance with ZERO net asset change and NO P&L line;
--   cash-flow closing is unchanged by the transfer and equals Σ derived balances; idempotent replay is a no-op.
do $$ declare
  v_cash uuid; v_gcash uuid; v_t1 uuid; v_t2 uuid;
  v_assets_before numeric; v_assets_after numeric; v_closing numeric; v_sum numeric;
  v_lines int; v_pl int; v_entries_before int; v_entries_after int;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select account_id into v_cash  from public.financial_account_balances('11111111-1111-1111-1111-111111111111') where coa_code = 'CASH';
  select account_id into v_gcash from public.financial_account_balances('11111111-1111-1111-1111-111111111111') where coa_code = 'WALLET_GCASH';
  select total_assets into v_assets_before from public.balance_sheet('11111111-1111-1111-1111-111111111111');
  v_t1 := public.financial_account_transfer(v_cash, v_gcash, 100.00, 'pay-xfer-1', 'drawer cash-in to GCash');
  select total_assets into v_assets_after from public.balance_sheet('11111111-1111-1111-1111-111111111111');
  if round(v_assets_after - v_assets_before, 2) <> 0 then
    raise exception 'DEFECT pay: transfer changed total assets (% -> %)', v_assets_before, v_assets_after; end if;
  set local role postgres;
  select count(*) into v_lines from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    where je.source_document_type = 'AccountTransfer' and je.source_document_id = v_t1;
  select count(*) into v_pl from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
    where je.source_document_type = 'AccountTransfer' and je.source_document_id = v_t1
      and a.account_type in ('Revenue', 'Expense');
  if v_lines <> 2 or v_pl <> 0 then raise exception 'DEFECT pay: transfer journal wrong (lines=% P&L-lines=%)', v_lines, v_pl; end if;
  select count(*) into v_entries_before from public.journal_entries where company_id = '11111111-1111-1111-1111-111111111111';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_t2 := public.financial_account_transfer(v_cash, v_gcash, 100.00, 'pay-xfer-1');  -- replay same key
  if v_t2 <> v_t1 then raise exception 'DEFECT pay: transfer replay returned a new id'; end if;
  set local role postgres;
  select count(*) into v_entries_after from public.journal_entries where company_id = '11111111-1111-1111-1111-111111111111';
  if v_entries_after <> v_entries_before then raise exception 'DEFECT pay: transfer replay posted a second journal'; end if;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select amount into v_closing from public.cash_flow_statement('11111111-1111-1111-1111-111111111111')
    where activity = 'Reconciliation' and line_label = 'Closing cash balance';
  select sum(balance) into v_sum from public.financial_account_balances('11111111-1111-1111-1111-111111111111');
  if round(v_closing - v_sum, 2) <> 0 then
    raise exception 'DEFECT pay: cash-flow closing (%) <> Σ derived account balances (%)', v_closing, v_sum; end if;
  raise notice 'PASS pay: transfer = zero net assets, 2 lines, no P&L; idempotent; cash-flow closing = Σ balances = %', v_sum;
end $$;

-- GATES: worker cannot transfer; cross-company transfer denied; preorder cannot carry an account;
--   another branch''s account is rejected on a sale; an archived account cannot receive a sale.
do $$ declare
  v_cash uuid; v_gcash uuid; v_bacct uuid; v_a2acct uuid; v_fg uuid;
  d1 boolean := false; d2 boolean := false; d3 boolean := false; d4 boolean := false; d5 boolean := false;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select account_id into v_cash  from public.financial_account_balances('11111111-1111-1111-1111-111111111111') where coa_code = 'CASH';
  select account_id into v_gcash from public.financial_account_balances('11111111-1111-1111-1111-111111111111') where coa_code = 'WALLET_GCASH';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  begin perform public.financial_account_transfer(v_cash, v_gcash, 10.00, 'pay-xfer-worker');
  exception when insufficient_privilege then d1 := true; end;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0b000000-0000-0000-0000-00000000000b"}';
  v_bacct := public.financial_account_upsert('b1111111-1111-1111-1111-111111111111','B Maya','Digital Wallet','WALLET_MAYA','Maya');
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  begin perform public.financial_account_transfer(v_cash, v_bacct, 10.00, 'pay-xfer-crossco');
  exception when check_violation then d2 := true; end;
  select fa.id into v_fg from public.finished_goods_batches fa where fa.company_id = '11111111-1111-1111-1111-111111111111' limit 1;
  begin perform public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
      jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 1.0)),
      0, 'pay-preorder-acct', 'preorder', 0, 0, null, v_gcash);
  exception when check_violation then d3 := true; end;
  -- an account of branch A2 (inserted as fixture — owner A is NOT a member of A2) rejected on an A1 sale
  set local role postgres;
  insert into public.financial_accounts (id, company_id, branch_id, name, account_type, coa_code)
    values ('fa200000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','A2 Drawer','Cash','CASH');
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  begin perform public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
      jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 1.0)),
      90, 'pay-foreign-branch', 'paid', 0, 0, null, 'fa200000-0000-0000-0000-0000000000a2');
  exception when check_violation then d4 := true; end;
  perform public.financial_account_set_status(v_gcash, 'Archived');
  begin perform public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
      jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 1.0)),
      90, 'pay-archived-acct', 'paid', 0, 0, null, v_gcash);
  exception when check_violation then d5 := true; end;
  perform public.financial_account_set_status(v_gcash, 'Active');  -- restore for any later battery
  if not (d1 and d2 and d3 and d4 and d5) then
    raise exception 'DEFECT pay: gate matrix failed (worker=% crossco=% preorder=% branch=% archived=%)', d1, d2, d3, d4, d5; end if;
  raise notice 'PASS pay: transfer/manage, cross-company, preorder-account, foreign-branch, archived-account all denied';
end $$;

-- DERIVED-ONLY: no client-writable balance surface — direct DML on the registry is denied outright
do $$ declare d_upd boolean := false; d_ins boolean := false;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  begin update public.financial_accounts set name = 'hacked' where company_id = '11111111-1111-1111-1111-111111111111';
  exception when insufficient_privilege then d_upd := true; end;
  begin insert into public.financial_accounts (company_id, branch_id, name, account_type, coa_code)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','Fake','Bank','BANK_FAKE');
  exception when insufficient_privilege then d_ins := true; end;
  if not (d_upd and d_ins) then raise exception 'DEFECT pay: direct DML on financial_accounts allowed (upd=% ins=%)', d_upd, d_ins; end if;
  raise notice 'PASS pay: registry writes are function-only (direct UPDATE/INSERT denied); no balance column exists';
end $$;

-- IMMUTABLE MAPPING: editing an account changes display metadata only — the COA code cannot be re-pointed
do $$ declare v_gcash uuid; v_code text;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select account_id into v_gcash from public.financial_account_balances('11111111-1111-1111-1111-111111111111') where coa_code = 'WALLET_GCASH';
  perform public.financial_account_upsert('a1111111-1111-1111-1111-111111111111','GCash Main','Digital Wallet','WALLET_HIJACK','GCash','0917', v_gcash);
  set local role postgres;
  select coa_code into v_code from public.financial_accounts where id = v_gcash;
  if v_code <> 'WALLET_GCASH' then raise exception 'DEFECT pay: edit re-pointed the COA code to %', v_code; end if;
  raise notice 'PASS pay: account edit updates metadata only — COA code immutable (journal history safe)';
end $$;

rollback;
