-- Tier-2 BEHAVIORAL P1E — cross-tenant hardening on the 6 pre-existing account/category-seed helper
-- functions — blocking gate. Authority: supabase/migrations/20260712220000_p1e_cross_tenant_helper_hardening.sql.
-- Proves: a member of Company A cannot call pos_ensure_accounts/inventory_ensure_categories/
-- inventory_ensure_accounts/payroll_ensure_accounts/finance_resolve_pay_code for Company B (a stranger
-- company they don't belong to), while the SAME functions still work normally for their OWN company
-- (proving the fix didn't break any legitimate call chain — pos_record_sale, inventory purchase flows,
-- payroll wage disbursement, and the digital-payments settle path all call these with a v_company the
-- caller already legitimately belongs to).
-- Self-contained BEGIN/ROLLBACK; any DEFECT raises under ON_ERROR_STOP.
\set ON_ERROR_STOP on
begin;
set local app.p1a_skip_signup_trigger = '1';

-- ── fixtures: two companies, an owner in each (A owns nothing in B, and vice versa) ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-0000000000e1','authenticated','authenticated','ownerA_p1e@t.local'),
  ('00000000-0000-0000-0000-000000000000','0b000000-0000-0000-0000-0000000000e2','authenticated','authenticated','ownerB_p1e@t.local');
insert into public.users (id, auth_user_id, display_name) values
  ('10000000-0000-0000-0000-0000000000e1','0a000000-0000-0000-0000-0000000000e1','Owner A P1E'),
  ('10000000-0000-0000-0000-0000000000e2','0b000000-0000-0000-0000-0000000000e2','Owner B P1E');
insert into public.companies (id, company_code, name) values
  ('e1111111-1111-1111-1111-111111111111','CO-E1','Company E1'),
  ('e2222222-2222-2222-2222-222222222222','CO-E2','Company E2');
insert into public.branches (id, company_id, branch_code, name) values
  ('eb111111-1111-1111-1111-111111111111','e1111111-1111-1111-1111-111111111111','BR-E1','Branch E1'),
  ('eb222222-2222-2222-2222-222222222222','e2222222-2222-2222-2222-222222222222','BR-E2','Branch E2');
insert into public.roles (id, company_id, role_key, description, rank) values
  ('e0000000-0000-0000-0000-00000000e0a1','e1111111-1111-1111-1111-111111111111','owner','Owner E1', 50),
  ('e0000000-0000-0000-0000-00000000e0b1','e2222222-2222-2222-2222-222222222222','owner','Owner E2', 50);
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id) values
  ('10000000-0000-0000-0000-0000000000e1','e1111111-1111-1111-1111-111111111111','eb111111-1111-1111-1111-111111111111','e0000000-0000-0000-0000-00000000e0a1'),
  ('10000000-0000-0000-0000-0000000000e2','e2222222-2222-2222-2222-222222222222','eb222222-2222-2222-2222-222222222222','e0000000-0000-0000-0000-00000000e0b1');

-- ── owner A CANNOT seed accounts/categories for company B (a stranger company) ──
do $$ begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0a000000-0000-0000-0000-0000000000e1')::text, true);
  perform public.pos_ensure_accounts('e2222222-2222-2222-2222-222222222222');
  raise exception 'DEFECT p1e: owner A seeded pos accounts for company B (cross-tenant write)';
exception when insufficient_privilege then raise notice 'PASS p1e: pos_ensure_accounts denies a caller who is not a member of the target company'; end $$;

do $$ begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0a000000-0000-0000-0000-0000000000e1')::text, true);
  perform public.inventory_ensure_categories('e2222222-2222-2222-2222-222222222222');
  raise exception 'DEFECT p1e: owner A seeded inventory categories for company B';
exception when insufficient_privilege then raise notice 'PASS p1e: inventory_ensure_categories denies a cross-tenant caller'; end $$;

do $$ begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0a000000-0000-0000-0000-0000000000e1')::text, true);
  perform public.inventory_ensure_accounts('e2222222-2222-2222-2222-222222222222');
  raise exception 'DEFECT p1e: owner A seeded inventory accounts for company B';
exception when insufficient_privilege then raise notice 'PASS p1e: inventory_ensure_accounts denies a cross-tenant caller'; end $$;

do $$ begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0a000000-0000-0000-0000-0000000000e1')::text, true);
  perform public.payroll_ensure_accounts('e2222222-2222-2222-2222-222222222222');
  raise exception 'DEFECT p1e: owner A seeded payroll accounts for company B';
exception when insufficient_privilege then raise notice 'PASS p1e: payroll_ensure_accounts denies a cross-tenant caller'; end $$;

-- proves the cross-tenant write attempts above genuinely did nothing (not merely denied at the top level
-- while still partially inserting via the internal perform chains)
do $$ declare n int; begin
  set local role postgres;
  select count(*) into n from public.chart_of_accounts where company_id='e2222222-2222-2222-2222-222222222222';
  if n<>0 then raise exception 'DEFECT p1e: company B''s chart_of_accounts was polluted by the denied cross-tenant calls (% rows)', n; end if;
  select count(*) into n from public.item_categories where company_id='e2222222-2222-2222-2222-222222222222';
  if n<>0 then raise exception 'DEFECT p1e: company B''s item_categories was polluted by the denied cross-tenant calls (% rows)', n; end if;
  raise notice 'PASS p1e: denied cross-tenant calls left zero rows in the target company (no partial writes)';
end $$;

-- ── owner A CAN still seed accounts/categories for their OWN company (legitimate path unaffected) ──
do $$ declare n int; begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0a000000-0000-0000-0000-0000000000e1')::text, true);
  perform public.payroll_ensure_accounts('e1111111-1111-1111-1111-111111111111');
  set local role postgres;
  select count(*) into n from public.chart_of_accounts where company_id='e1111111-1111-1111-1111-111111111111';
  if n<9 then raise exception 'DEFECT p1e: payroll_ensure_accounts for the caller''s OWN company did not seed the expected accounts (n=%)', n; end if;
  raise notice 'PASS p1e: the full ensure_accounts chain still works normally for a member''s own company (% accounts seeded)', n;
end $$;

-- ── finance_resolve_pay_code: cross-tenant denied; same-tenant works ──
do $$ declare v_company uuid := 'e1111111-1111-1111-1111-111111111111'; v_branch uuid := 'eb111111-1111-1111-1111-111111111111'; v_code text;
begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0a000000-0000-0000-0000-0000000000e1')::text, true);
  -- null account_id → 'CASH', no lookup needed, still requires company membership
  v_code := public.finance_resolve_pay_code(v_company, v_branch, null);
  if v_code <> 'CASH' then raise exception 'DEFECT p1e: finance_resolve_pay_code(null) did not return CASH for a legitimate member (got %)', v_code; end if;
  raise notice 'PASS p1e: finance_resolve_pay_code resolves CASH normally for a member of the company';

  begin
    perform public.finance_resolve_pay_code('e2222222-2222-2222-2222-222222222222', 'eb222222-2222-2222-2222-222222222222', null);
    raise exception 'DEFECT p1e: owner A resolved a pay code for company B (cross-tenant info access)';
  exception when insufficient_privilege then raise notice 'PASS p1e: finance_resolve_pay_code denies a caller who is not a member of the target company'; end;
end $$;

-- ── pos_next_seq: cross-tenant denied (found by the follow-up systematic sweep); same-tenant works ──
do $$ declare v1 bigint; v2 bigint; begin
  set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub','0a000000-0000-0000-0000-0000000000e1')::text, true);
  v1 := public.pos_next_seq('e1111111-1111-1111-1111-111111111111', 'eb111111-1111-1111-1111-111111111111', 'invoice');
  v2 := public.pos_next_seq('e1111111-1111-1111-1111-111111111111', 'eb111111-1111-1111-1111-111111111111', 'invoice');
  if v2 <> v1 + 1 then raise exception 'DEFECT p1e: pos_next_seq did not increment normally for a member''s own company (% then %)', v1, v2; end if;
  raise notice 'PASS p1e: pos_next_seq still increments normally for a member of the company';

  begin
    perform public.pos_next_seq('e2222222-2222-2222-2222-222222222222', 'eb222222-2222-2222-2222-222222222222', 'invoice');
    raise exception 'DEFECT p1e: owner A burned a sequence number for company B';
  exception when insufficient_privilege then raise notice 'PASS p1e: pos_next_seq denies a caller who is not a member of the target company'; end;
end $$;

rollback;
