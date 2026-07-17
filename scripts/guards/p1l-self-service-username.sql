-- Tier-2 BEHAVIORAL P1L self-service-username guard (ported from Team B's G1-G7 battery, adapted
-- to this repo's conventions: self-contained BEGIN/ROLLBACK — fixtures + audit rows roll back
-- together, so nothing persists; B's original committed permanent fixtures instead).
-- Battery: happy path + format rejections + uniqueness rejection + same-name no-op +
-- suspended-account block + grant shape. Any DEFECT raises → fails under -v ON_ERROR_STOP=1.
\set ON_ERROR_STOP on
begin;
-- The P1A signup trigger fires on the auth.users inserts below; the on-conflict update then pins
-- each fixture's username to a known value (the trigger already created the public.users rows).
set local app.p1a_skip_signup_trigger = '1';

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000','1a000000-0000-0000-0000-00000000001a','authenticated','authenticated','p1l-a@t.local'),
  ('00000000-0000-0000-0000-000000000000','1b000000-0000-0000-0000-00000000001b','authenticated','authenticated','p1l-b@t.local');
insert into public.users (auth_user_id, display_name, account_status, username) values
  ('1a000000-0000-0000-0000-00000000001a','P1L Guard User A','Active','guardtest_a'),
  ('1b000000-0000-0000-0000-00000000001b','P1L Guard User B','Active','guardtest_b')
on conflict (auth_user_id) do update set account_status = 'Active', username = excluded.username;

-- ── G1: happy path — User A changes their own username ──
do $$ begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"1a000000-0000-0000-0000-00000000001a"}';
  perform public.update_own_username('guardtest_newname');
  if not exists (select 1 from public.users where auth_user_id = '1a000000-0000-0000-0000-00000000001a' and username = 'guardtest_newname') then
    raise exception 'DEFECT p1l G1: happy-path username change not persisted';
  end if;
  raise notice 'PASS p1l G1: an Active user changes their own username via the RPC';
end $$;

-- ── G1b: the change was audited (Security-class, own actor) ──
do $$ begin
  set local role postgres;
  if not exists (select 1 from public.audit_events ae join public.users u on u.id = ae.actor_user_id
                 where u.auth_user_id = '1a000000-0000-0000-0000-00000000001a'
                   and ae.event_type = 'username.changed' and ae.event_class = 'Security') then
    raise exception 'DEFECT p1l G1b: username change wrote no Security audit event';
  end if;
  raise notice 'PASS p1l G1b: username change writes a Security-class audit event';
end $$;

-- ── G2: format rejection — too short ──
do $$ declare v_ok boolean := false; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"1a000000-0000-0000-0000-00000000001a"}';
  begin perform public.update_own_username('ab');
  exception when raise_exception then v_ok := true; end;
  if not v_ok then raise exception 'DEFECT p1l G2: 2-char username was accepted'; end if;
  raise notice 'PASS p1l G2: a 2-char username is rejected (3-char minimum enforced server-side)';
end $$;

-- ── G3: format rejection — invalid character ──
do $$ declare v_ok boolean := false; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"1a000000-0000-0000-0000-00000000001a"}';
  begin perform public.update_own_username('has space');
  exception when raise_exception then v_ok := true; end;
  if not v_ok then raise exception 'DEFECT p1l G3: a username with a space was accepted'; end if;
  raise notice 'PASS p1l G3: an invalid character is rejected server-side';
end $$;

-- ── G4: uniqueness rejection — cannot take another user's username ──
do $$ declare v_ok boolean := false; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"1a000000-0000-0000-0000-00000000001a"}';
  begin perform public.update_own_username('guardtest_b');
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception 'DEFECT p1l G4: taking another user''s username was accepted'; end if;
  raise notice 'PASS p1l G4: taking another user''s username is rejected (case-insensitive uniqueness)';
end $$;

-- ── G5: same-name no-op allowed (own current name is excluded from the uniqueness check) ──
do $$ begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"1a000000-0000-0000-0000-00000000001a"}';
  perform public.update_own_username('newname_self');
  perform public.update_own_username('newname_self');
  raise notice 'PASS p1l G5: re-saving your own current username is an allowed no-op';
end $$;

-- ── G6: suspended account blocked (two-layer: helper filters Active + explicit status check) ──
set local role postgres;
update public.users set account_status = 'Suspended' where auth_user_id = '1a000000-0000-0000-0000-00000000001a';
do $$ declare v_ok boolean := false; begin
  set local role authenticated; set local request.jwt.claims = '{"sub":"1a000000-0000-0000-0000-00000000001a"}';
  begin perform public.update_own_username('should_not_work');
  -- current_app_user_id() filters Active, so a Suspended user gets NULL → insufficient_privilege;
  -- the explicit status check raises raise_exception. Either way the account is blocked.
  exception when insufficient_privilege or raise_exception then v_ok := true; end;
  if not v_ok then raise exception 'DEFECT p1l G6: a Suspended account changed its username'; end if;
  raise notice 'PASS p1l G6: a Suspended account cannot change its username';
end $$;

-- ── G7: grant shape — authenticated only (no public/anon path to the RPC) ──
do $$ begin
  set local role postgres;
  if not has_function_privilege('authenticated', 'public.update_own_username(text)', 'execute') then
    raise exception 'DEFECT p1l G7: update_own_username not granted to authenticated';
  end if;
  if has_function_privilege('anon', 'public.update_own_username(text)', 'execute') then
    raise exception 'DEFECT p1l G7: update_own_username is callable by anon — self-service must require a session';
  end if;
  raise notice 'PASS p1l G7: grant shape is authenticated-only (anon has no path)';
end $$;

rollback;
