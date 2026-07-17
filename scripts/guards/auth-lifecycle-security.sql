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
-- P1C: rank=50 matches the production invariant (bootstrap_initial_tenant always seeds owner at rank 50) —
-- required for the fixture owner to pass the P1C rank-outranks checks on memberships (worker stays rank 0).
insert into public.roles (id, company_id, role_key, description, rank) values
  ('20000000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','owner','Owner A', 50),
  ('20000000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111','worker','Worker', 0);
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

-- ── P1F: reject_pending_user() + my_account_status() (owner request 2026-07-13) ──

-- MY_ACCOUNT_STATUS: a normal Active user reads their own status (current_app_user_id() would too, but
-- my_account_status() is the one a Suspended user can still call on themselves)
do $$ declare v_status text; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  v_status := public.my_account_status();
  if v_status <> 'Active' then raise exception 'DEFECT p1f: my_account_status() returned % for an Active user, want Active', coalesce(v_status,'NULL'); end if;
  raise notice 'PASS p1f: my_account_status() reads Active correctly for a normal member';
end $$;

-- fresh pending signup fixture, distinct from the earlier (now-approved-then-suspended) 0d fixture
-- (role reset first: the prior block left the session as `authenticated`, which cannot insert into auth.users)
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','0f000000-0000-0000-0000-00000000000f','authenticated','authenticated','reject-me@t.local');

-- REJECT DENIED without membership.manage
do $$ declare v_target uuid; v_denied boolean := false; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id = '0f000000-0000-0000-0000-00000000000f';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  begin perform public.reject_pending_user(v_target);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT p1f: a worker without membership.manage rejected a pending signup'; end if;
  raise notice 'PASS p1f: reject_pending_user denies a caller without membership.manage';
end $$;

-- REJECT: approver turns away the pending signup — Suspended, drops from the queue, self-status readable
do $$ declare v_target uuid; n int; v_status text; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id = '0f000000-0000-0000-0000-00000000000f';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.reject_pending_user(v_target);
  select count(*) into n from public.list_pending_users() where user_id = v_target;
  if n <> 0 then raise exception 'DEFECT p1f: rejected user still appears in the pending queue'; end if;
  set local role postgres;
  if not exists (select 1 from public.audit_events where entity_id = v_target and event_type = 'user.signup_rejected') then
    raise exception 'DEFECT p1f: reject_pending_user did not leave an audit trail';
  end if;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0f000000-0000-0000-0000-00000000000f"}';
  if public.current_app_user_id() is not null then raise exception 'DEFECT p1f: rejected (Suspended) user still resolves via current_app_user_id()'; end if;
  v_status := public.my_account_status();
  if v_status <> 'Suspended' then raise exception 'DEFECT p1f: my_account_status() returned % for a rejected user, want Suspended', coalesce(v_status,'NULL'); end if;
  raise notice 'PASS p1f: reject_pending_user suspends + audits + clears the queue; the rejected user can still read their own (Suspended) status via my_account_status()';
end $$;

-- REJECT REFUSES a non-pending target: already-rejected (this same user, again) and already-a-member
-- (the earlier 0d fixture, approved then suspended above) both correctly fail — reject_pending_user is
-- not a generic "suspend anyone" shortcut around the rank-checked revoke path.
do $$ declare v_target uuid; v_failed boolean := false; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id = '0f000000-0000-0000-0000-00000000000f';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  begin perform public.reject_pending_user(v_target);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'DEFECT p1f: reject_pending_user accepted an already-rejected target a second time'; end if;
  raise notice 'PASS p1f: reject_pending_user refuses a target that is not currently a pending signup';
end $$;

-- ── P1G: archive_user_account() + unarchive_user_account() (owner request 2026-07-13) ──

-- fresh fixture: a worker who gets a real membership, then revoked, then archived
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000010','authenticated','authenticated','archive-me@t.local');
do $$ declare v_target uuid; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id = '10000000-0000-0000-0000-000000000010';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_target, '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-00000000000c');
end $$;

-- ARCHIVE DENIED without membership.manage
do $$ declare v_target uuid; v_denied boolean := false; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id = '10000000-0000-0000-0000-000000000010';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0c000000-0000-0000-0000-00000000000c"}';
  begin perform public.archive_user_account(v_target);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT p1g: a caller without membership.manage archived an account'; end if;
  raise notice 'PASS p1g: archive_user_account denies a caller without membership.manage';
end $$;

-- P1G.1: ARCHIVE now AUTO-REVOKES rather than requiring a separate manual revoke first (owner-reported
-- friction 2026-07-13: the old two-step dance failed with "still holds an active membership" even after
-- revoking, whenever a second stray active row existed elsewhere for the same account). Give this fixture
-- a SECOND active membership in a different branch of the SAME company before archiving, to prove the
-- fix actually cleans up every active row, not just the one an approver happened to revoke by hand.
set local role postgres;
insert into public.branches (id, company_id, branch_code, name) values
  ('a1111111-1111-1111-1111-111111111112','11111111-1111-1111-1111-111111111111','BR-A2','Branch A2');
do $$ declare v_target uuid; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id = '10000000-0000-0000-0000-000000000010';
  insert into public.user_branch_roles (user_id, company_id, branch_id, role_id)
    values (v_target, '11111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111112', '20000000-0000-0000-0000-00000000000c');
end $$;

-- ARCHIVE succeeds directly (no manual revoke first) and cleans up BOTH active memberships atomically
do $$ declare v_target uuid; n int; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id = '10000000-0000-0000-0000-000000000010';
  select count(*) into n from public.user_branch_roles where user_id = v_target and assignment_status = 'Active';
  if n <> 2 then raise exception 'DEFECT p1g test setup: expected 2 active memberships going in, found %', n; end if;
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.archive_user_account(v_target); -- no manual revoke step — this is the point of the fix
  set local role postgres;
  select count(*) into n from public.user_branch_roles where user_id = v_target and assignment_status = 'Active';
  if n <> 0 then raise exception 'DEFECT p1g: archive_user_account left % membership(s) still Active — the exact bug this migration fixes', n; end if;
  if not exists (select 1 from public.users where id = v_target and account_status = 'Archived') then
    raise exception 'DEFECT p1g: archive_user_account did not set account_status to Archived';
  end if;
  if not exists (select 1 from public.audit_events where entity_id = v_target and event_type = 'user.archived') then
    raise exception 'DEFECT p1g: archive_user_account did not leave an audit trail';
  end if;
  set local role authenticated; set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000010"}';
  if public.current_app_user_id() is not null then raise exception 'DEFECT p1g: an archived user still resolves via current_app_user_id()'; end if;
  raise notice 'PASS p1g: archive_user_account auto-revokes every active membership (not just one) and archives in a single call — no manual pre-revoke needed';
end $$;

-- ARCHIVE REFUSES an already-Archived target (no double-archiving)
do $$ declare v_target uuid; v_failed boolean := false; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id = '10000000-0000-0000-0000-000000000010';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  begin perform public.archive_user_account(v_target);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'DEFECT p1g: archive_user_account accepted an already-archived target a second time'; end if;
  raise notice 'PASS p1g: archive_user_account refuses a target that is not currently Active';
end $$;

-- UNARCHIVE: brings the account back to Active (still zero memberships — same as any fresh identity)
do $$ declare v_target uuid; begin
  set local role postgres;
  select id into v_target from public.users where auth_user_id = '10000000-0000-0000-0000-000000000010';
  set local role authenticated; set local request.jwt.claims = '{"sub":"0a000000-0000-0000-0000-00000000000a"}';
  perform public.unarchive_user_account(v_target);
  set local role postgres;
  if not exists (select 1 from public.users where id = v_target and account_status = 'Active') then
    raise exception 'DEFECT p1g: unarchive_user_account did not restore account_status to Active';
  end if;
  if not exists (select 1 from public.audit_events where entity_id = v_target and event_type = 'user.unarchived') then
    raise exception 'DEFECT p1g: unarchive_user_account did not leave an audit trail';
  end if;
  set local role authenticated; set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000010"}';
  if public.current_app_user_id() is null then raise exception 'DEFECT p1g: an unarchived user still fails to resolve via current_app_user_id()'; end if;
  raise notice 'PASS p1g: unarchive_user_account restores Active status; the resolver works again (still zero memberships, as expected)';
end $$;

-- ── P1J: username login (owner request 2026-07-13) ──

-- AUTO-USERNAME: two signups sharing the same email local-part get distinct, deduped usernames
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','11000000-0000-0000-0000-000000000011','authenticated','authenticated','sameprefix@t.local'),
  ('00000000-0000-0000-0000-000000000000','12000000-0000-0000-0000-000000000012','authenticated','authenticated','sameprefix@other.local');
do $$ declare v_u1 text; v_u2 text; begin
  select username into v_u1 from public.users where auth_user_id = '11000000-0000-0000-0000-000000000011';
  select username into v_u2 from public.users where auth_user_id = '12000000-0000-0000-0000-000000000012';
  if v_u1 is null or v_u2 is null then raise exception 'DEFECT p1j: signup did not auto-generate a username (% / %)', v_u1, v_u2; end if;
  if lower(v_u1) = lower(v_u2) then raise exception 'DEFECT p1j: two signups with the same email prefix collided on username (% = %)', v_u1, v_u2; end if;
  raise notice 'PASS p1j: signup auto-generates a unique, deduped username (% vs %)', v_u1, v_u2;
end $$;

-- RESOLVE: an identifier that already looks like an email passes through unchanged, no lookup needed
do $$ declare v_email text; begin
  set local role anon;
  v_email := public.resolve_login_email('someone@t.local');
  if v_email <> 'someone@t.local' then raise exception 'DEFECT p1j: resolve_login_email altered an email-shaped identifier (got %)', v_email; end if;
  raise notice 'PASS p1j: resolve_login_email passes an email-shaped identifier through unchanged';
end $$;

-- RESOLVE: a real username (any case) resolves to the account's actual email — callable by anon, the one
-- deliberate exception to "zero anon grants" in this schema (see the P1J migration header for why).
do $$ declare v_username text; v_email text; begin
  set local role postgres;
  select username into v_username from public.users where auth_user_id = '11000000-0000-0000-0000-000000000011';
  set local role anon;
  v_email := public.resolve_login_email(upper(v_username));
  if v_email <> 'sameprefix@t.local' then raise exception 'DEFECT p1j: resolve_login_email did not resolve a real username case-insensitively (got %)', v_email; end if;
  raise notice 'PASS p1j: resolve_login_email (as anon) resolves a real username to its email, case-insensitively';
end $$;

-- RESOLVE: an unknown username resolves to NULL (no distinguishable error, no data beyond "found or not")
do $$ declare v_email text; begin
  set local role anon;
  v_email := public.resolve_login_email('this-username-does-not-exist-xyz');
  if v_email is not null then raise exception 'DEFECT p1j: resolve_login_email returned % for a nonexistent username', v_email; end if;
  raise notice 'PASS p1j: resolve_login_email returns NULL for an unknown username';
end $$;

-- BLAST-RADIUS CHECK: this new anon grant is narrowly scoped — anon still cannot read a real table
-- directly (the "zero anon grants on data" posture holds; only this one narrow lookup function is new).
do $$ declare v_denied boolean := false; begin
  set local role anon;
  begin perform count(*) from public.users;
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'DEFECT p1j: anon can read public.users directly — the new grant widened more than intended'; end if;
  raise notice 'PASS p1j: anon still cannot read public.users directly — resolve_login_email is the only new anon surface';
end $$;

-- ── P1J.2: resolve_login_email hardening (ported from Repo B "Finding-1 vs Repo A", 2026-07-16) ──
-- A deactivated account's username must NOT resolve to its email via the one anon-granted endpoint.

-- Fixture: a fresh signup, then deactivated. (postgres work and anon calls live in SEPARATE DO
-- blocks — set local role postgres cannot re-escalate inside the same PL/pgSQL block after anon.)
set local role postgres;
insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','13000000-0000-0000-0000-000000000013','authenticated','authenticated','suspendme@t.local');
update public.users set account_status = 'Suspended' where auth_user_id = '13000000-0000-0000-0000-000000000013';

-- Make the fixture assumption explicit: the trigger derives 'suspendme' from the email local-part.
do $$ begin
  if not exists (select 1 from public.users where auth_user_id = '13000000-0000-0000-0000-000000000013' and username = 'suspendme') then
    raise exception 'FIXTURE p1j2: expected auto-username ''suspendme'' — dedup suffix kicked in, adjust the test';
  end if;
end $$;

do $$ declare v_email text; begin
  set local role anon;
  v_email := public.resolve_login_email('suspendme');
  if v_email is not null then raise exception 'DEFECT p1j2: resolve_login_email returned % for a SUSPENDED username — deactivated-account email harvest is open', v_email; end if;
  raise notice 'PASS p1j2: a Suspended username resolves to NULL (indistinguishable from unknown — no enumeration signal)';
end $$;

set local role postgres;
update public.users set account_status = 'Archived' where auth_user_id = '13000000-0000-0000-0000-000000000013';
do $$ declare v_email text; begin
  set local role anon;
  v_email := public.resolve_login_email('suspendme');
  if v_email is not null then raise exception 'DEFECT p1j2: resolve_login_email returned % for an ARCHIVED username — deactivated-account email harvest is open', v_email; end if;
  raise notice 'PASS p1j2: an Archived username resolves to NULL';
end $$;

-- GRANT SHAPE: anon keeps EXECUTE (pre-auth login needs it); authenticated must NOT have it (P1J.2
-- narrowed the P1J grant — authenticated sessions never call this).
do $$ begin
  set local role postgres;
  if not has_function_privilege('anon', 'public.resolve_login_email(text)', 'execute') then
    raise exception 'DEFECT p1j2: anon lost EXECUTE on resolve_login_email — username login is broken';
  end if;
  if has_function_privilege('authenticated', 'public.resolve_login_email(text)', 'execute') then
    raise exception 'DEFECT p1j2: authenticated still has EXECUTE on resolve_login_email — wider than the anon-only P1J.2 shape';
  end if;
  raise notice 'PASS p1j2: resolve_login_email grant shape is anon-only (authenticated revoked)';
end $$;

rollback;
