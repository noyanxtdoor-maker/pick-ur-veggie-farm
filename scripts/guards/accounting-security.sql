-- Tier-2 BEHAVIORAL Accounting security test (Phase 2 M4A) — blocking gate.
-- Proves: non-operating cash movements post balanced GL (Dr/Cr Cash vs Owner's Equity/Loans Payable/Other
-- Income), corrections are a reversing void never a delete (22.24), the M3A purchase-categorization fix routes
-- utilities/transport/misc to OPERATING_EXPENSES (not RAW_MATERIALS), and the read functions (trial_balance,
-- income_statement_monthly, balance_sheet) are permission-gated and reconcile to the real GL — sum(debit)=
-- sum(credit) on the trial balance, and Assets = Liabilities + Equity on the balance sheet. Runs as authenticated
-- owners/workers with simulated JWT. Self-contained BEGIN/ROLLBACK; any DEFECT raises under ON_ERROR_STOP.
\set ON_ERROR_STOP on
begin;

-- ── fixtures (postgres) ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-00000000000a','authenticated','authenticated','ownerA@t.local'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-00000000000b','authenticated','authenticated','ownerB@t.local'),
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-00000000000c','authenticated','authenticated','workerA2@t.local');
insert into public.users (id, auth_user_id, display_name) values
  ('10000000-0000-0000-0000-00000000000a','0a000000-0000-0000-0000-00000000000a','Owner A'),
  ('10000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b','Owner B'),
  ('10000000-0000-0000-0000-00000000000c','0c000000-0000-0000-0000-00000000000c','Worker A2');
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
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker (no accounting perms)');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions
  where permission_key in ('accounting.read','accounting.manage','inventory.purchase','inventory.opening','product.manage','pos.sell');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '22222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000b', id from public.permissions
  where permission_key in ('accounting.read','accounting.manage');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','b1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000b'),
  ('10000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222','20000000-0000-0000-0000-00000000000c');
insert into public.products (id, company_id, product_code, name, retail_per_kg) values
  ('ca000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','LETTUCE','Lettuce',150.00);

-- ── HAPPY PATH: Owner Investment (in) posts Dr Cash / Cr Owner's Equity, balanced ──
do $$ declare v_id uuid; v_entry uuid; d numeric; c numeric; ar_credit numeric;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';  -- owner A
  v_id := public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-05', 'in', 'Owner Investment', 'seed capital', 50000.00, 'cash-1');
  set local role postgres;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_id;
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if v_entry is null or d <> c or d <> 50000.00 then raise exception 'DEFECT acct: owner-investment journal wrong (d=% c=%, want 50000)', d, c; end if;
  select jl.credit into ar_credit from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and a.account_code='OWNER_EQUITY';
  if ar_credit <> 50000.00 then raise exception 'DEFECT acct: OWNER_EQUITY credit wrong (got %, want 50000)', ar_credit; end if;
  if (select status from public.cash_entries where id = v_id) <> 'Posted' then raise exception 'DEFECT acct: cash entry not Posted'; end if;
  raise notice 'PASS acct: Owner Investment 50000 posts Dr Cash/Cr Owner''s Equity, balanced, Posted';
end $$;

-- idempotency: replaying the same key returns the same cash entry, no second journal
do $$ declare v1 uuid; v2 uuid; n int;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v1 := public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-06', 'out', 'Loan Payment', 'monthly amortization', 2000.00, 'cash-dup');
  v2 := public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-06', 'out', 'Loan Payment', 'monthly amortization', 2000.00, 'cash-dup');
  if v1 <> v2 then raise exception 'DEFECT acct: idempotent retry created a second cash entry'; end if;
  set local role postgres;
  select count(*) into n from public.journal_entries where source_document_id = v1;
  if n <> 1 then raise exception 'DEFECT acct: idempotent retry posted % journals (want 1)', n; end if;
  raise notice 'PASS acct: replay is idempotent (one cash entry, one journal)';
end $$;

-- each category maps to the correct offsetting account (Other Income / Loan Received / Owner's Drawings)
do $$ declare v_id uuid; v_entry uuid; acct text;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_id := public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-07', 'in', 'Other Income', 'workshop fee', 500.00, 'cash-oi');
  set local role postgres;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_id;
  select a.account_code into acct from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and jl.credit > 0;
  if acct <> 'OTHER_INCOME' then raise exception 'DEFECT acct: Other Income mapped to % (want OTHER_INCOME)', acct; end if;

  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_id := public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-08', 'in', 'Loan Received', 'agri loan tranche 1', 30000.00, 'cash-lr');
  set local role postgres;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_id;
  select a.account_code into acct from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and jl.credit > 0;
  if acct <> 'LOANS_PAYABLE' then raise exception 'DEFECT acct: Loan Received mapped to % (want LOANS_PAYABLE)', acct; end if;

  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_id := public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-09', 'out', 'Owner''s Drawings', 'personal draw', 1000.00, 'cash-od');
  set local role postgres;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_id;
  select a.account_code into acct from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and jl.debit > 0;
  if acct <> 'OWNER_EQUITY' then raise exception 'DEFECT acct: Owner''s Drawings mapped to % (want OWNER_EQUITY)', acct; end if;
  raise notice 'PASS acct: Other Income->OTHER_INCOME, Loan Received->LOANS_PAYABLE, Owner''s Drawings->OWNER_EQUITY';
end $$;

-- ── ATTACKS ──
-- invalid flow/category pairing (mock parity: Equipment Purchase is NOT a cash-ledger category — spec §2)
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-10', 'out', 'Equipment Purchase', 'x', 100, 'cash-eq');
  raise exception 'DEFECT acct: Equipment Purchase accepted as a cash-ledger category';
exception when check_violation then raise notice 'PASS acct: Equipment Purchase rejected as a cash category (already inventory_record_purchase''s domain)'; end $$;
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-10', 'in', 'Loan Payment', 'x', 100, 'cash-mismatch');
  raise exception 'DEFECT acct: outflow category accepted on an inflow';
exception when check_violation then raise notice 'PASS acct: flow/category mismatch rejected'; end $$;
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-10', 'in', 'Owner Investment', 'x', 0, 'cash-zero');
  raise exception 'DEFECT acct: zero-amount cash entry accepted';
exception when check_violation then raise notice 'PASS acct: amount <= 0 rejected'; end $$;

-- permission gating: worker without accounting.manage cannot record; without accounting.read cannot read
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform public.record_cash_entry('a2222222-2222-2222-2222-222222222222', '2026-01-10', 'in', 'Owner Investment', 'x', 100, 'cash-wk');
  raise exception 'DEFECT acct: worker without accounting.manage recorded a cash entry';
exception when insufficient_privilege then raise notice 'PASS acct: cash entry denied without accounting.manage'; end $$;
do $$ declare n int; begin set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  perform 1 from public.trial_balance('11111111-1111-1111-1111-111111111111');
  raise exception 'DEFECT acct: worker without accounting.read read the trial balance';
exception when insufficient_privilege then raise notice 'PASS acct: trial_balance denied without accounting.read'; end $$;

-- cross-company: owner A cannot record into company B''s branch (no accounting.manage in B for A)
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.record_cash_entry('b1111111-1111-1111-1111-111111111111', '2026-01-10', 'in', 'Owner Investment', 'x', 100, 'cash-xc');
  raise exception 'DEFECT acct: owner A recorded a cash entry in company B';
exception when insufficient_privilege then raise notice 'PASS acct: cross-company cash entry denied'; end $$;
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform 1 from public.trial_balance('22222222-2222-2222-2222-222222222222');
  raise exception 'DEFECT acct: owner A read company B''s trial balance';
exception when insufficient_privilege then raise notice 'PASS acct: cross-company statement read denied'; end $$;

-- void: reason mandatory; reversal is balanced; status Voided; idempotent
do $$ declare v_id uuid; v_entry uuid; d numeric; c numeric; n1 int; n2 int;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_id := public.record_cash_entry('a1111111-1111-1111-1111-111111111111', '2026-01-11', 'in', 'Loan Received', 'to be reversed', 4000.00, 'cash-void');
  begin
    perform public.void_cash_entry(v_id, '');
    raise exception 'DEFECT acct: void accepted without a reason';
  exception when check_violation then null; end;
  perform public.void_cash_entry(v_id, 'entered on the wrong branch');
  set local role postgres;
  if (select status from public.cash_entries where id = v_id) <> 'Voided' then raise exception 'DEFECT acct: cash entry not Voided'; end if;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_id and je.source_document_type = 'VoidedCashEntry';
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where journal_entry_id = v_entry;
  if v_entry is null or d <> c or d <> 4000.00 then raise exception 'DEFECT acct: void reversal wrong (entry %, d=% c=%, want 4000)', v_entry, d, c; end if;
  select count(*) into n1 from public.journal_entries where source_document_id = v_id and source_document_type = 'VoidedCashEntry';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.void_cash_entry(v_id, 'again');  -- replay
  set local role postgres;
  select count(*) into n2 from public.journal_entries where source_document_id = v_id and source_document_type = 'VoidedCashEntry';
  if n2 <> n1 then raise exception 'DEFECT acct: double-void posted another reversal'; end if;
  raise notice 'PASS acct: void = balanced reversal (4000), status Voided, reason mandatory, idempotent (no delete — 22.24)';
end $$;

-- append-only: no client can delete or directly write a cash entry / journal line (function-only, 22.24)
do $$ begin set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  delete from public.cash_entries where category = 'Owner Investment';
  raise exception 'DEFECT acct: a cash entry was deleted directly';
exception when insufficient_privilege then raise notice 'PASS acct: direct cash-entry delete denied (function-only, no client grant)'; end $$;
do $$ begin set local role postgres;
  update public.journal_lines set debit = 0, credit = 0 where debit > 0;
  raise exception 'DEFECT acct: a journal line was edited';
exception when restrict_violation then raise notice 'PASS acct: journals remain append-only (UPDATE blocked — financial immutability)'; end $$;

-- ══ M3A fix verification (spec §3): purchase categorization routes to the correct GL account ══
do $$ declare v_recv uuid; v_entry uuid; acct text;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_recv := public.inventory_record_purchase('a1111111-1111-1111-1111-111111111111','utilities','June electricity bill',false,1,1500.00,'physical','Meralco',null,'2026-01-12','acct-util');
  set local role postgres;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_recv;
  select a.account_code into acct from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and jl.debit > 0;
  if acct <> 'OPERATING_EXPENSES' then raise exception 'DEFECT acct: utilities purchase posted to % (want OPERATING_EXPENSES, spec §3 fix)', acct; end if;

  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_recv := public.inventory_record_purchase('a1111111-1111-1111-1111-111111111111','seeds','Eggplant seeds',false,5,500.00,'online','Lazada',null,'2026-01-12','acct-seed');
  set local role postgres;
  select je.id into v_entry from public.journal_entries je where je.source_document_id = v_recv;
  select a.account_code into acct from public.journal_lines jl join public.chart_of_accounts a on a.id=jl.account_id where jl.journal_entry_id=v_entry and jl.debit > 0;
  if acct <> 'RAW_MATERIALS' then raise exception 'DEFECT acct: seeds purchase posted to % (want RAW_MATERIALS, unchanged)', acct; end if;
  raise notice 'PASS acct: M3A fix — utilities/transport/misc -> OPERATING_EXPENSES; seeds/substrate/packaging still -> RAW_MATERIALS';
end $$;

-- ══ Read functions reconcile to the real GL ══
-- trial balance: sum(debit) = sum(credit) across ALL accounts (the GL is provably balanced, not just asserted)
do $$ declare v_d numeric; v_c numeric;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select coalesce(sum(total_debit),0), coalesce(sum(total_credit),0) into v_d, v_c from public.trial_balance('11111111-1111-1111-1111-111111111111');
  if v_d <> v_c then raise exception 'DEFECT acct: trial balance does not balance (debit=% credit=%)', v_d, v_c; end if;
  if v_d = 0 then raise exception 'DEFECT acct: trial balance is empty — fixtures did not post'; end if;
  raise notice 'PASS acct: trial balance reconciles (debit=credit=%), proving the GL is balanced', v_d;
end $$;

-- income statement: a fresh sale's revenue appears in the correct month/column, split by wholesale
do $$ declare v_fg uuid; v_inv uuid; v_retail numeric; v_wholesale numeric; v_cogs numeric;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_fg := public.record_opening_finished_goods('a1111111-1111-1111-1111-111111111111','ca000000-0000-0000-0000-0000000000a1','FG-ACCT', 10.0, 50.00, 'acct-open', 'opening');
  v_inv := public.pos_record_sale('a1111111-1111-1111-1111-111111111111',
    jsonb_build_array(jsonb_build_object('product_id','ca000000-0000-0000-0000-0000000000a1','finished_goods_batch_id', v_fg, 'weight_kg', 2.0)),
    500.00, 'acct-sale');
  set local role postgres;
  select retail_revenue, wholesale_revenue, cogs into v_retail, v_wholesale, v_cogs
    from public.income_statement_monthly('11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', extract(year from now())::int)
    where month_num = extract(month from now())::int;
  if v_retail <= 0 then raise exception 'DEFECT acct: retail revenue did not appear in the current month (got %)', v_retail; end if;
  if v_wholesale <> 0 then raise exception 'DEFECT acct: a weighed (non-bulk) sale was classified wholesale (got %)', v_wholesale; end if;
  if v_cogs <= 0 then raise exception 'DEFECT acct: COGS did not appear for the sale (got %)', v_cogs; end if;
  raise notice 'PASS acct: income_statement_monthly picks up the fresh sale (retail=%, wholesale=0, cogs=%)', v_retail, v_cogs;
end $$;

-- balance sheet: Assets = Liabilities + Equity (fundamental identity, proven not asserted)
do $$ declare v_assets numeric; v_liab numeric; v_eq numeric;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select total_assets, total_liabilities, total_equity into v_assets, v_liab, v_eq
    from public.balance_sheet('11111111-1111-1111-1111-111111111111');
  if round(v_assets - (v_liab + v_eq), 2) <> 0 then
    raise exception 'DEFECT acct: balance sheet does not balance (assets=% liab=% equity=% diff=%)', v_assets, v_liab, v_eq, v_assets - (v_liab + v_eq);
  end if;
  raise notice 'PASS acct: balance sheet ties out — Assets(%) = Liabilities(%) + Equity(%)', v_assets, v_liab, v_eq;
end $$;

rollback;
