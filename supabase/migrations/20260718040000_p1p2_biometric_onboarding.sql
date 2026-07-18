-- Migration P1P.2 — optional biometric/passkey onboarding step (owner directive 2026-07-18,
-- Phase 2 of the bank-app security layer, following P1P's mandatory MPIN). Evolves
-- onboarding_next_step() to add a 'biometric_offer' branch between 'mpin' and the final null, and
-- adds dismiss_biometric_offer() to record that the offer was shown and decided (either "set up
-- now" or "skip for now" — both count as decided; navigating away without deciding does not).
--
-- No new table: passkey credentials themselves live entirely inside Supabase Auth's own internal
-- schema (never touched by this migration or any RPC here — see app/features/auth/onboarding.ts's
-- biometricApi, which calls supabase.auth.registerPasskey()/passkey.list()/.delete() directly).
-- The only state this repo owns is biometric_offer_seen_at on public.users, already scaffolded in
-- the P1P migration (20260718030000) specifically for this step.
--
-- Deliberately does NOT re-arm the offer if a user later removes their only passkey via Profile —
-- that is a deliberate post-onboarding management action, not "never decided," and re-showing
-- onboarding after a deliberate removal would be surprising, not helpful. Profile's own "add
-- another passkey" flow is fully independent of onboarding gating.

create or replace function public.onboarding_next_step()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_chosen timestamptz;
  v_active_membership boolean;
  v_has_mpin boolean;
  v_biometric_seen timestamptz;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then return null; end if;

  select u.username_chosen_at, u.biometric_offer_seen_at into v_chosen, v_biometric_seen
    from public.users u where u.id = v_actor and u.account_status = 'Active';
  if not found then return null; end if; -- not an active account -> no onboarding gate

  select exists (
    select 1 from public.user_branch_roles where user_id = v_actor and assignment_status = 'Active'
  ) into v_active_membership;
  if not v_active_membership then return null; end if; -- awaiting approval, not this gate's job

  if v_chosen is null then return 'username'; end if;

  select exists(select 1 from public.user_mpin where user_id = v_actor) into v_has_mpin;
  if not v_has_mpin then return 'mpin'; end if;

  if v_biometric_seen is null then return 'biometric_offer'; end if;

  return null;
end;
$$;
comment on function public.onboarding_next_step() is 'P1P/P1P.2: ordered onboarding sequence for the app gate — username -> mpin -> biometric_offer -> null (fully onboarded). Supersedes needs_username_onboarding() as the router''s gate; that function is left in place, unchanged, not called by anything new.';
revoke all on function public.onboarding_next_step() from public, anon;
grant execute on function public.onboarding_next_step() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- dismiss_biometric_offer() — records that the caller was shown the biometric onboarding step and
-- decided (set up or skip, either way). Idempotent (a second call is a no-op — the timestamp is not
-- overwritten once set, since only the FIRST decision matters for onboarding-gate purposes).
-- ════════════════════════════════════════════════════════════════════════════
create function public.dismiss_biometric_offer()
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  update public.users set biometric_offer_seen_at = now()
    where id = v_actor and biometric_offer_seen_at is null;
end;
$$;
comment on function public.dismiss_biometric_offer() is 'P1P.2: marks the caller''s biometric onboarding offer as seen/decided. Idempotent — only the first call has an effect.';
revoke all on function public.dismiss_biometric_offer() from public, anon;
grant execute on function public.dismiss_biometric_offer() to authenticated;
