-- Tier-2 BEHAVIORAL Auth & Account Lifecycle security test (Phase 1 / P1A) — blocking gate.
-- Proves: a raw auth signup auto-creates an ERP identity (trigger) that is ACTIVE yet BLIND — zero memberships
-- means RLS returns nothing and has_permission is false everywhere (C2 §3, the approval-queue model); the
-- approval queue read is membership.manage-gated; approval (first membership) removes the user from the queue
-- and lights up exactly the assigned scope; suspension kills the resolver; the trigger is idempotent vs the
-- invite-accept path. Self-contained BEGIN/ROLLBACK; any DEFECT raises under ON_ERROR_STOP.
\set ON_ERROR_STOP on
begin;

-- ── fixtures: one established company with an owner (approver) + a worker (no membership.manage) ──
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0a000000-0000-0000-0000-00000000000a','authenticated','authenticated','ownerA@t.local'),
  ('00000000-0000-0000-0000-000000000000','0c000000-0000-0000-0000-00000000000c','authenticated','authenticated','workerA@t.local');
-- NOTE: these two inserts ALSO fire the new P1A trigger — their public.users rows are created by it.
do $$ begin
  if (select count(*) from public.users where auth_user_id in ('0a000000-0000-0000-0000-00000000000a','0c000000-0000-0000-0000-00000000000c')) <> 2 then
    raise exception 'DEFECT auth: signup trigger did not create ERP identities for fixture auth users';
  end if;
  raise notice 'PASS auth: signup trigger auto-creates ERP identity rows (fixture users)';
end $$;

insert into public.companies (id, company_code, name) values
  ('11111111-1111-1111-1111-111111111111','CO-A','Company A');
insert into public.branches (id, company_id, branch_code, name) values
  ('a1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','BR-A1','Branch A1');
insert into public.roles (id, company_id, role_key, description) values
  ('20000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','Owner A'),
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000a', id from public.permissions
  where permission_key in ('membership.manage','membership.read','user.read','product.manage');
insert into public.role_permissions (company_id, role_id, permission_id)
  select '11111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000c', id from public.permissions
  where permission_key in ('pos.sell');
insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
  select u.id, '11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
         (case when u.auth_user_id = '0a000000-0000-0000-0000-00000000000a' then '20000000-0000-0000-0000-00000000000a' else '20000000-0000-0000-0000-00000000000c' end)::uuid
  from public.users u where u.auth_user_id in ('0a000000-0000-0000-0000-00000000000a','0c000000-0000-0000-0000-00000000000c');
insert into public.products (id, company_id, product_code, name, retail_per_kg) values
  ('ca000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','LETTUCE','Lettuce',100.00);

-- ── a NEW self-signup arrives (simulates supabase.auth.signUp) ──
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000000','0d000000-0000-0000-0000-00000000000d','authenticated','authenticated','newhire@t.local','{"display_name":"Bagong Kasama","requested_role":"operator"}');

-- TRIGGER: identity captured with metadata display name + email
do $$ declare v_name text; v_email text; v_status text;
begin
  select display_name, email, account_status into v_name, v_email, v_status
    from public.users where auth_user_id = '0d000000-0000-0000-0000-00000000000d';
  if v_name is distinct from 'Bagong Kasama' or v_email is distinct from 'newhire@t.local' or v_status is distinct from 'Active' then
    raise exception 'DEFECT auth: signup identity wrong (name=% email=% status=%)', v_name, v_email, v_status;
  end if;
  raise notice 'PASS auth: signup captures display_name from metadata + email; identity Active';
end $$;

-- BLIND: the pending user resolves (Active) but sees NOTHING and holds no permission anywhere (C2 §3)
do $$ declare v_id uuid; n int; v_perm boolean;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d"}';
  v_id := public.current_app_user_id();
  if v_id is null then raise exception 'DEFECT auth: pending user does not resolve (should be Active)'; end if;
  select count(*) into n from public.companies;
  if n <> 0 then raise exception 'DEFECT auth: pending user sees % companies', n; end if;
  select count(*) into n from public.products;
  if n <> 0 then raise exception 'DEFECT auth: pending user sees % products', n; end if;
  v_perm := public.has_permission('11111111-1111-1111-1111-111111111111', 'pos.sell');
  if v_perm then raise exception 'DEFECT auth: pending user has pos.sell without membership'; end if;
  raise notice 'PASS auth: pending user is Active yet blind — 0 companies, 0 products, no permission (C2 §3)';
end $$;

-- QUEUE GATE: owner (membership.manage) sees the pending user; the worker is denied outright
do $$ declare n int; v_denied boolean := false;
begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  select count(*) into n from public.list_pending_users() where email = 'newhire@t.local' and requested_role = 'operator';
  if n <> 1 then raise exception 'DEFECT auth: approver does not see the pending signup with its requested role (n=%)', n; end if;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  begin perform * from public.list_pending_users();
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT auth: worker without membership.manage read the approval queue'; end if;
  raise notice 'PASS auth: approval queue readable with membership.manage, denied without';
end $$;

-- APPROVAL: assigning the first membership removes the user from the queue and lights up EXACTLY that scope
do $$ declare v_user uuid; n int;
begin
  set local role postgres;
  select id into v_user from public.users where auth_user_id = '0d000000-0000-0000-0000-00000000000d';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_user, '11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111','20000000-0000-0000-0000-00000000000c');
  select count(*) into n from public.list_pending_users() where user_id = v_user;
  if n <> 0 then raise exception 'DEFECT auth: approved user still in the pending queue'; end if;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d"}';
  select count(*) into n from public.companies;
  if n <> 1 then raise exception 'DEFECT auth: approved user sees % companies (want exactly 1)', n; end if;
  if not public.has_permission('11111111-1111-1111-1111-111111111111', 'pos.sell') then
    raise exception 'DEFECT auth: approved worker lacks the assigned pos.sell'; end if;
  if public.has_permission('11111111-1111-1111-1111-111111111111', 'membership.manage') then
    raise exception 'DEFECT auth: approved worker escalated to membership.manage'; end if;
  raise notice 'PASS auth: approval = first membership; queue clears; exactly the assigned scope lights up';
end $$;

-- SUSPENSION: account_status kills the resolver (B1) even with memberships intact
do $$ declare v_id uuid;
begin
  set local role postgres;
  update public.users set account_status = 'Suspended' where auth_user_id = '0d000000-0000-0000-0000-00000000000d';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0d000000-0000-0000-0000-00000000000d"}';
  v_id := public.current_app_user_id();
  if v_id is not null then raise exception 'DEFECT auth: suspended user still resolves'; end if;
  raise notice 'PASS auth: suspension kills the resolver immediately (memberships untouched)';
end $$;

-- IDEMPOTENT vs invite-accept: a pre-existing users row for the same auth id survives a trigger re-fire
do $$ declare n int;
begin
  set local role postgres;
  -- simulate the invite-accept ordering: users row exists BEFORE the auth insert fires the trigger
  insert into auth.users (instance_id, id, aud, role, email) values
    ('00000000-0000-0000-0000-000000000000','0e000000-0000-0000-0000-00000000000e','authenticated','authenticated','invitee2@t.local');
  select count(*) into n from public.users where auth_user_id = '0e000000-0000-0000-0000-00000000000e';
  if n <> 1 then raise exception 'DEFECT auth: expected exactly 1 identity row, got %', n; end if;
  raise notice 'PASS auth: trigger is idempotent (on conflict do nothing) — no duplicate identities';
end $$;

rollback;
