-- Migration P1J.1 — HOTFIX: backfill a username for accounts that signed up BEFORE P1J. Found immediately
-- after pushing P1J by a read-only post-deploy check: `handle_new_auth_user()` only derives a username at
-- signup time, so every existing account (including the live owner) had `username = NULL` — meaning
-- nobody could actually use the just-shipped username login until their next fresh signup, which is never
-- for an existing account. Same backfill logic as the trigger (email local-part, deduped with a numeric
-- suffix on collision), applied once to every row currently missing one.
-- Risk: Low (pure additive backfill of a column that was already nullable; no auth/authz-model change).

do $$
declare v_user record; v_base text; v_username text; v_n int;
begin
  for v_user in select id, email from public.users where username is null order by created_at loop
    v_base := regexp_replace(lower(split_part(coalesce(v_user.email, 'member'), '@', 1)), '[^a-z0-9_.]', '', 'g');
    if v_base = '' then v_base := 'member'; end if;
    v_base := left(v_base, 26);
    v_username := v_base;
    v_n := 0;
    while exists (select 1 from public.users where lower(username) = lower(v_username)) loop
      v_n := v_n + 1;
      v_username := v_base || v_n::text;
    end loop;
    update public.users set username = v_username where id = v_user.id;
  end loop;
end $$;
