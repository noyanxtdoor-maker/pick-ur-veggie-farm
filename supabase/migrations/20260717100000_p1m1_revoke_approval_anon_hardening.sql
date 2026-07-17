-- Migration P1M.1 — anon-grant hardening for the P1M revoke-approval RPCs (self-caught, 2026-07-17).
-- P1M's `revoke all on function ... from public` did NOT strip anon's EXECUTE privilege, because this
-- Supabase project has an ALTER DEFAULT PRIVILEGES rule (confirmed via pg_default_acl) that grants
-- EXECUTE on every NEW function in schema public DIRECTLY to anon/authenticated/service_role/postgres —
-- a direct per-role grant, not a PUBLIC-pseudo-role grant, so `revoke ... from public` alone never
-- touches it. P1L (20260715184800) got this right by writing `from public, anon`; P1M
-- (20260717090000) missed the `, anon` and shipped with all 4 new RPCs anon-executable in production.
--
-- Practical exposure: LOW — every one of these functions calls current_app_user_id() first, which
-- resolves to NULL for an anon (no-session) caller, so every anon call was already rejected with
-- 'not an active user' at the first line. This migration is defense-in-depth / grant-hygiene cleanup,
-- not a live-exploit fix — but the grant SHAPE must match every other governed RPC in this schema
-- (authenticated-only, never anon) for the guard battery to mean what it claims.
revoke execute on function public.request_revoke(uuid, text) from anon;
revoke execute on function public.list_revoke_requests() from anon;
revoke execute on function public.approve_revoke_request(uuid) from anon;
revoke execute on function public.reject_revoke_request(uuid, text) from anon;
