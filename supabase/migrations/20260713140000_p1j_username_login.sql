-- Migration P1J — Real username login (owner decision 2026-07-13, resolving the trade-off flagged when
-- the login redesign shipped). Supabase Auth's signInWithPassword only accepts email — there is no native
-- username login — so this adds a pre-auth username→email lookup the client calls before authenticating.
--
-- SECURITY NOTE — the one deliberate exception to this project's "zero anon grants" posture: this is the
-- FIRST function ever granted to the `anon` role. It is scoped as narrowly as a pre-auth lookup can be:
-- given a username it returns ONLY that account's email (or NULL), nothing else, and an identifier that
-- already looks like an email is passed straight through with no lookup at all. This does carry a minor,
-- well-understood enumeration signal (a caller can probe whether a username exists) — the same trade-off
-- essentially every username-login system on the web accepts; there is no way to add real username login
-- without SOME pre-auth signal, short of a full Edge Function doing the sign-in itself server-side (a
-- bigger infra lift, considered and not chosen here). account_status is deliberately NOT filtered: a
-- Suspended/Archived user must still be able to resolve their email and authenticate, exactly as if
-- they'd typed the email directly — the account_status gate is enforced downstream (current_app_user_id,
-- B1 §3), same as it always has been; this function only ever mirrors what typing the email would do.

alter table public.users add column username text;
alter table public.users add constraint users_username_format check (username is null or username ~ '^[a-zA-Z0-9_.]{3,30}$');
create unique index users_username_lower_uq on public.users (lower(username)) where username is not null;
comment on column public.users.username is 'P1J: optional login alias, auto-generated at signup from the email local-part (deduped). Case-insensitive unique. Never an authorization input — display/login-alias only, same posture as email (see P1A).';

-- Signup trigger now also derives a username (auto-generated, deduped against existing ones — plain
-- suffix-increment, fine at this scale; a company big enough for collisions to matter can rename later).
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_base text; v_username text; v_n int := 0;
begin
  if coalesce(current_setting('app.p1a_skip_signup_trigger', true), '') = '1' then return new; end if;
  v_base := regexp_replace(lower(split_part(coalesce(new.email, 'member'), '@', 1)), '[^a-z0-9_.]', '', 'g');
  if v_base = '' then v_base := 'member'; end if;
  v_base := left(v_base, 26); -- leaves room for a numeric suffix under the 30-char format check
  v_username := v_base;
  while exists (select 1 from public.users where lower(username) = lower(v_username)) loop
    v_n := v_n + 1;
    v_username := v_base || v_n::text;
  end loop;
  insert into public.users (auth_user_id, display_name, email, username)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),   -- Google OAuth
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),        -- generic OAuth
      split_part(coalesce(new.email, 'member'), '@', 1)
    ),
    new.email,
    v_username
  )
  on conflict (auth_user_id) do nothing;
  return new;
end; $$;
comment on function public.handle_new_auth_user() is 'P1A trigger, P1C/P1J-evolved: auth.users insert -> public.users identity for EVERY provider; display name from display_name -> full_name -> name -> email local-part; username auto-derived + deduped. Idempotent vs invite-accept.';

create function public.resolve_login_email(p_identifier text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_identifier ilike '%@%' then p_identifier
    else (select u.email from public.users u where lower(u.username) = lower(p_identifier) limit 1)
  end
$$;
comment on function public.resolve_login_email(text) is 'P1J: pre-auth username -> email lookup for the login screen. The one deliberate anon grant in this schema (see migration header). Returns NULL for an unknown username, or the input unchanged if it already looks like an email.';
revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;
