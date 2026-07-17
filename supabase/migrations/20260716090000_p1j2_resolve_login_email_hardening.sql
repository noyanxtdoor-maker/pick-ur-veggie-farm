-- Migration P1J.2 — resolve_login_email hardening (ported from Team B / Repo B, owner parity order
-- 2026-07-16). B's P1J shipped this narrower shape from day one and their guard battery names our
-- original shape "Finding-1 vs Repo A": with no account_status filter, the ONE anon-granted endpoint
-- in this schema let an anonymous caller resolve a Suspended or Archived user's username to their
-- EMAIL — a deactivated-account email harvest/enumeration surface.
--
-- What changes (two things, both narrowing):
--   1. account_status = 'Active' filter — a Suspended/Archived username now resolves to NULL, so the
--      login screen shows the same generic "invalid credentials" as an unknown username. No signal.
--   2. Grant narrowed to anon ONLY — login is a pre-auth act; authenticated sessions never need this
--      lookup. (P1J granted anon + authenticated; the authenticated grant was wider than needed.)
--
-- Reconciling P1J's original rationale: P1J deliberately did NOT filter status, reasoning that a
-- Suspended/Archived user "must still be able to resolve their email and authenticate ... exactly as
-- if they'd typed the email directly." That property is PRESERVED: the account_status gate stays
-- downstream, and a deactivated user who signs in WITH THEIR EMAIL still authenticates and still
-- sees the honest suspension/archive screen. The only thing lost is username-based login for
-- deactivated accounts — a UX cost accepted in exchange for closing the anon harvest surface.
-- (B runs this exact tradeoff in production; their guard proves the non-enumerability.)

create or replace function public.resolve_login_email(p_identifier text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_identifier ilike '%@%' then p_identifier
    else (select u.email from public.users u
           where lower(u.username) = lower(p_identifier)
             and u.account_status = 'Active'
         limit 1)
  end
$$;
comment on function public.resolve_login_email(text) is 'P1J/P1J.2: pre-auth username -> email lookup for the login screen. The one deliberate anon grant in this schema (see the P1J migration header). P1J.2 hardening (ported from Repo B): account_status = ''Active'' filter — Suspended/Archived usernames resolve to NULL (no deactivated-account email harvest); grant narrowed to anon only. Returns NULL for an unknown/inactive username, or the input unchanged if it already looks like an email.';

-- Narrow the grant: anon keeps it (pre-auth login needs it); authenticated loses it (never needed it).
revoke execute on function public.resolve_login_email(text) from authenticated;
