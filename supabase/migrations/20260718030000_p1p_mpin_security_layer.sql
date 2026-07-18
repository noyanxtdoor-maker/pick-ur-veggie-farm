-- Migration P1P — mandatory 6-digit MPIN + 2-minute auto-lock security layer (owner directive
-- 2026-07-18): "add another security layer since this is an ERP, a user can set a MPIN 6 digit
-- code... this is also important becasue this is an ERP we dont want a lower tier get theri phone
-- stolen then that thief will access our ERP." Flow: Approval Screen -> Set Username -> Set MPIN
-- (required) -> Set biometric (optional, Phase 2, not built here) -> quick MPIN/biometric unlock
-- on return visits + after 2 minutes idle, banking-app style.
--
-- GOVERNANCE: this makes MPIN mandatory for EVERY authenticated user regardless of role, which
-- supersedes ODR-003's "MFA optional for operational-tier roles" clause for the MPIN mechanism
-- specifically (TOTP/hardware-key MFA scope for elevated roles is unchanged, unaffected, layers on
-- top) — see docs/28_Enterprise_Architecture_Audit/ODR_006_Mandatory_MPIN_Amendment.md for the
-- explicit amendment record. B7 spec §2 mandates "strong one-way hashing (e.g. bcrypt/argon2
-- class)" for any password-like secret — satisfied here via pgcrypto's crypt()/gen_salt('bf'),
-- already installed in this project (m1_identity_foundation) though previously only used for
-- uuidv7() randomness, never for hashing a secret; this is the app's first self-hashed credential.
--
-- WHY NOT a column on public.users: that table carries `grant select ... to authenticated` at the
-- table level (m1_identity_foundation), RLS-gated to "own row" only — meaning ANY authenticated
-- client could `select mpin_hash from users` for their own row via the raw PostgREST API. RLS
-- would technically still be "correct" (it's their own row) but that is not a boundary to lean on
-- for a 6-digit secret with only 1,000,000 possible values. MPIN state lives in a brand-new table
-- with ZERO grants to anon/authenticated at all — not even a restrictive SELECT policy — reachable
-- only through SECURITY DEFINER RPCs, the same hard boundary current_app_user_id() already uses.
--
-- RATE LIMITING: no existing precedent in this repo (checked all prior migrations). Threat model
-- is "attacker already holds a stolen/unattended device with a still-valid access token" (every
-- RPC below requires current_app_user_id() to resolve at all — there is no path to call verify_mpin
-- without one), not anonymous remote guessing — real throttling is required, not CAPTCHA-grade.
-- Counter + timestamp on the row (not a separate attempts-log table): a log table would need a
-- COUNT() aggregation on every single verify call for something a running integer already answers
-- in O(1), and this app already has a purpose-built forensic log (audit_events, "Security" class,
-- actor-optional for failed-auth rows) for the historical trail instead of duplicating it.

create table public.user_mpin (
  user_id          uuid primary key references public.users (id) on delete cascade,
  mpin_hash        text not null,
  mpin_set_at      timestamptz not null default now(),
  failed_attempts  smallint not null default 0,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);
comment on table public.user_mpin is 'P1P: one 6-digit MPIN hash per user (bcrypt via pgcrypto), NOT device-bound — matches the single-PIN-per-account model of PH bank apps. Zero grants to anon/authenticated; SECURITY DEFINER RPCs only, no SELECT policy exists at all (a stronger boundary than RLS for a 6-digit secret).';
create trigger user_mpin_set_updated_at before update on public.user_mpin
  for each row execute function public.set_updated_at();
alter table public.user_mpin enable row level security;
alter table public.user_mpin force row level security;
revoke all on public.user_mpin from public, anon, authenticated, service_role;
-- Deliberately NO grant statement at all — not even a restrictive SELECT. Every access goes
-- through the RPCs below, which run as the owning (RLS-exempt) role.

-- Phase 2 (biometric) scaffolding column now, so the onboarding-sequence RPC below can already
-- reference it — mirrors the existing username_chosen_at pattern on the same table (P1N).
alter table public.users add column if not exists biometric_offer_seen_at timestamptz;
comment on column public.users.biometric_offer_seen_at is 'P1P Phase 2 (not yet built): non-null once the user has been shown the optional biometric-enrollment onboarding step, so it is not offered again. Biometric itself uses Supabase''s native passkey API — no credential data of any kind is stored in this schema.';

-- ════════════════════════════════════════════════════════════════════════════
-- set_mpin(p_mpin) — onboarding step AND the "forgot my MPIN" recovery path. A fresh full
-- email+password sign-in already proves identity strongly enough to reset the MPIN outright — no
-- separate OTP flow needed (forgot MPIN -> sign out -> sign in with password -> Profile -> reset).
-- ════════════════════════════════════════════════════════════════════════════
create function public.set_mpin(p_mpin text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_had_one boolean;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if p_mpin !~ '^[0-9]{6}$' then
    raise exception 'MPIN must be exactly 6 digits' using errcode = 'check_violation';
  end if;
  if p_mpin in ('123456','111111','222222','333333','444444','555555','666666','777777','888888','999999','000000','654321') then
    raise exception 'that MPIN is too easy to guess — choose a less common 6 digits' using errcode = 'check_violation';
  end if;
  select exists(select 1 from public.user_mpin where user_id = v_actor) into v_had_one;
  insert into public.user_mpin (user_id, mpin_hash, mpin_set_at, failed_attempts, locked_until)
    values (v_actor, extensions.crypt(p_mpin, extensions.gen_salt('bf', 10)), now(), 0, null)
    on conflict (user_id) do update
      set mpin_hash = excluded.mpin_hash, mpin_set_at = now(), failed_attempts = 0, locked_until = null;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    select ubr.company_id, v_actor, 'Security', case when v_had_one then 'mpin.reset' else 'mpin.set' end, 'auth', 'users', v_actor
      from public.user_branch_roles ubr where ubr.user_id = v_actor and ubr.assignment_status = 'Active' limit 1;
end;
$$;
comment on function public.set_mpin(text) is 'P1P: sets or resets the caller''s own MPIN (bcrypt hash). No prior-MPIN proof required — a fresh full sign-in already establishes identity strongly enough (this is also the forgot-MPIN recovery path). Clears any lockout. Audited (mpin.set / mpin.reset).';
revoke all on function public.set_mpin(text) from public, anon;
grant execute on function public.set_mpin(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- verify_mpin(p_mpin) — the lock-screen/quick-unlock check. Escalating lockout on repeated
-- failure: 5 consecutive -> 60s; every further 5 after a cooldown expires -> 5min -> 15min -> 30min
-- (capped). Distinct raised messages so the client can tell "wrong" from "locked out" from "no MPIN
-- set yet" apart.
-- ════════════════════════════════════════════════════════════════════════════
create function public.verify_mpin(p_mpin text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_actor    uuid;
  v_row      public.user_mpin%rowtype;
  v_cooldown interval;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  select * into v_row from public.user_mpin where user_id = v_actor for update;
  if not found then
    return 'no_mpin';
  end if;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return 'locked';
  end if;
  if extensions.crypt(p_mpin, v_row.mpin_hash) = v_row.mpin_hash then
    update public.user_mpin set failed_attempts = 0, locked_until = null where user_id = v_actor;
    return 'ok';
  end if;

  -- Failure: increment, escalate the cooldown once every 5th consecutive failure. Returns a status
  -- instead of raising: Postgres has no autonomous transactions, so a RAISE here would abort the
  -- whole RPC's implicit transaction and roll back this very increment/audit-insert right along
  -- with it — silently defeating the rate limiter on every single failed attempt. The caller (the
  -- lock screen, change_mpin) checks the returned text instead of catching an exception.
  update public.user_mpin set failed_attempts = failed_attempts + 1 where user_id = v_actor
    returning failed_attempts into v_row.failed_attempts;
  insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
    select ubr.company_id, v_actor, 'Security', 'mpin.verify_failed', 'auth', 'users', v_actor
      from public.user_branch_roles ubr where ubr.user_id = v_actor and ubr.assignment_status = 'Active' limit 1;

  if v_row.failed_attempts > 0 and v_row.failed_attempts % 5 = 0 then
    v_cooldown := case
      when v_row.failed_attempts >= 20 then interval '30 minutes'
      when v_row.failed_attempts >= 15 then interval '15 minutes'
      when v_row.failed_attempts >= 10 then interval '5 minutes'
      else interval '60 seconds'
    end;
    update public.user_mpin set locked_until = now() + v_cooldown where user_id = v_actor;
    insert into public.audit_events (company_id, actor_user_id, event_class, event_type, module, entity_type, entity_id)
      select ubr.company_id, v_actor, 'Security', 'mpin.locked', 'auth', 'users', v_actor
        from public.user_branch_roles ubr where ubr.user_id = v_actor and ubr.assignment_status = 'Active' limit 1;
    return 'locked';
  end if;

  return 'wrong';
end;
$$;
comment on function public.verify_mpin(text) is 'P1P: verifies the caller''s own MPIN. Returns ''ok''/''wrong''/''locked''/''no_mpin'' instead of raising for these expected outcomes — a RAISE would roll back the failed_attempts increment and audit insert in the same transaction (Postgres has no autonomous transactions), defeating the rate limiter. Only "not an active user" (no state to lose) still raises. Escalating lockout at every 5th consecutive failure (60s / 5min / 15min / 30min cap). Every failure and lockout transition is audited.';
revoke all on function public.verify_mpin(text) from public, anon;
grant execute on function public.verify_mpin(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- change_mpin(p_current_mpin, p_new_mpin) — Profile-initiated change from WITHIN an already-
-- unlocked session. Requires the CURRENT MPIN (verified through the same rate-limited path as
-- verify_mpin) before accepting the new one. This matters specifically because auto-lock never
-- signs anyone out (Phase 1 design) — whoever unlocks the lock screen has full app access at the
-- real user's trust level, including Profile. Requiring the current MPIN closes the "shoulder-
-- surfed it once, now silently change it to lock the real owner out" loophole. Also satisfies
-- ODR-003's "MFA-setting changes require re-auth (password confirm, MFA challenge, or approved
-- method)" — knowing the current MPIN qualifies as the approved method.
-- ════════════════════════════════════════════════════════════════════════════
create function public.change_mpin(p_current_mpin text, p_new_mpin text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_result text;
begin
  v_result := public.verify_mpin(p_current_mpin); -- 'ok'/'wrong'/'locked'/'no_mpin' — same rate-limited path as the lock screen
  if v_result <> 'ok' then
    return v_result; -- current MPIN not confirmed; verify_mpin's own counter/audit writes above already persisted normally (no raise here either — same reason)
  end if;
  perform public.set_mpin(p_new_mpin); -- raises on invalid format / trivial PIN — safe, there is nothing left to lose at this point
  return 'ok';
end;
$$;
comment on function public.change_mpin(text, text) is 'P1P: Profile-initiated MPIN change. Requires the correct CURRENT MPIN (same rate-limited check as verify_mpin, same ''ok''/''wrong''/''locked''/''no_mpin'' return contract) before accepting a new one.';
revoke all on function public.change_mpin(text, text) from public, anon;
grant execute on function public.change_mpin(text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- mpin_status() — read-only, for the UI to render "set your MPIN" vs. a live lockout countdown
-- without ever touching user_mpin directly.
-- ════════════════════════════════════════════════════════════════════════════
create function public.mpin_status()
returns table (has_mpin boolean, locked_until timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  return query
    select true, m.locked_until from public.user_mpin m where m.user_id = v_actor
    union all
    select false, null::timestamptz where not exists (select 1 from public.user_mpin where user_id = v_actor);
end;
$$;
comment on function public.mpin_status() is 'P1P: read-only MPIN state for the caller — whether one is set, and any active lockout expiry.';
revoke all on function public.mpin_status() from public, anon;
grant execute on function public.mpin_status() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- onboarding_next_step() — generalizes needs_username_onboarding() (P1N, kept unchanged and still
-- callable — nothing currently calls it will break) into an ORDERED SEQUENCE the router can drive:
-- username first (unchanged logic), then MPIN (mandatory), then a future biometric offer (Phase 2,
-- always reports satisfied for now since that step isn't built yet). Returns null when fully
-- onboarded. This is intentionally the ONLY thing the app's onboarding gate should call going
-- forward — single server-side source of truth, matching this codebase's existing philosophy that
-- the server is the real gate and the client is just UX (see ChooseUsername.tsx's own header note).
-- ════════════════════════════════════════════════════════════════════════════
create function public.onboarding_next_step()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_chosen timestamptz;
  v_active_membership boolean;
  v_has_mpin boolean;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then return null; end if;

  select u.username_chosen_at into v_chosen
    from public.users u where u.id = v_actor and u.account_status = 'Active';
  if not found then return null; end if; -- not an active account -> no onboarding gate

  select exists (
    select 1 from public.user_branch_roles where user_id = v_actor and assignment_status = 'Active'
  ) into v_active_membership;
  if not v_active_membership then return null; end if; -- awaiting approval, not this gate's job

  if v_chosen is null then return 'username'; end if;

  select exists(select 1 from public.user_mpin where user_id = v_actor) into v_has_mpin;
  if not v_has_mpin then return 'mpin'; end if;

  -- Phase 2 (biometric offer) intentionally not gated yet — always considered satisfied until that
  -- onboarding step ships, so this function is safe to switch the app gate over to today.
  return null;
end;
$$;
comment on function public.onboarding_next_step() is 'P1P: ordered onboarding sequence for the app gate — username -> mpin -> (future) biometric offer -> null (fully onboarded). Supersedes needs_username_onboarding() as the router''s gate; that function is left in place, unchanged, not called by anything new.';
revoke all on function public.onboarding_next_step() from public, anon;
grant execute on function public.onboarding_next_step() to authenticated;
