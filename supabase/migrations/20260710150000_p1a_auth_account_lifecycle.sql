-- Migration P1A — Auth & Account Lifecycle: self-signup → approval queue (Phase 1 module)
-- Authority: B7 §6 (account lifecycle: create → assign company/branch/roles → activate) · C2 §3 (auth ≠ authz:
--   "A logged-in user with no user_branch_roles assignment sees nothing") · B1 (RLS is the boundary) ·
--   CLAUDE.md §6 Phase-1 row (OAuth + email auth, self-service reset, admin-assisted recovery, break-glass).
-- Design: a self-signup creates an ACTIVE identity with ZERO memberships. RLS already renders such a user
--   blind to all business data (C2 §3 verbatim) — so "pending approval" needs NO new status value and no
--   change to the locked M1 contract. Approval = an admin assigning the first membership (existing governed
--   path). The only new surface: the signup trigger, an email column for admin-assisted recovery, and a
--   governed read listing unassigned identities for the approval queue.
-- Pattern: ADDITIVE ONLY — locked files untouched. Risk: Medium (auth-adjacent; no money, no RLS relaxation).

-- ── 1. users.email (additive) — captured at signup; used by admin-assisted recovery ("send reset email")
--       and the approval queue. Never used for authorization. Visible only where users rows already are
--       (own-row policy + governed functions) — no new grant, no new policy.
alter table public.users add column email text;
comment on column public.users.email is 'P1A: contact email captured from auth at signup (display/recovery only — never an authorization input; auth.users owns credentials).';

-- ── 2. Signup trigger: every new auth identity gets an ERP identity row (Active, no memberships = pending).
create function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Guard-fixture escape hatch (transaction-local GUC): the Tier-2 batteries construct identities manually
  -- with fixed ids. Skipping this trigger only WITHHOLDS the convenience identity row — a user without a
  -- public.users row resolves to NULL and can access nothing, so the escape can never grant anything.
  if coalesce(current_setting('app.p1a_skip_signup_trigger', true), '') = '1' then return new; end if;
  insert into public.users (auth_user_id, display_name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'member'), '@', 1)),
    new.email
  )
  on conflict (auth_user_id) do nothing;  -- invite-accept may have created the row first (p2m1)
  return new;
end; $$;
comment on function public.handle_new_auth_user() is 'P1A: auth.users insert → public.users identity (Active, zero memberships = awaiting approval per C2 §3). Idempotent vs the invite-accept path.';
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ── 3. Approval queue read: Active identities with no Active membership anywhere.
--       Governed: caller must hold membership.manage in at least one company (the same permission that
--       lets them approve). Multi-tenant note (documented, accepted for V1 solo-founder scale): the pool
--       of unassigned signups is platform-level — any company's membership manager can see it, because an
--       unassigned identity belongs to no tenant yet. Assignment itself stays company-scoped (p2m1 RLS).
create function public.list_pending_users()
returns table(user_id uuid, display_name text, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := public.current_app_user_id();
  if v_actor is null then raise exception 'not an active user' using errcode = 'insufficient_privilege'; end if;
  if not exists (
    select 1 from public.user_branch_roles ubr
    where ubr.user_id = v_actor and ubr.assignment_status = 'Active'
      and public.has_permission(ubr.company_id, 'membership.manage')
  ) then
    raise exception 'permission denied: membership.manage' using errcode = 'insufficient_privilege';
  end if;
  return query
  select u.id, u.display_name, u.email, u.created_at
  from public.users u
  where u.account_status = 'Active'
    and not exists (
      select 1 from public.user_branch_roles ubr
      where ubr.user_id = u.id and ubr.assignment_status = 'Active'
    )
  order by u.created_at;
end; $$;
comment on function public.list_pending_users() is 'P1A: the signup approval queue — Active identities with zero Active memberships (they see nothing until assigned, C2 §3). membership.manage required.';
revoke all on function public.list_pending_users() from public;
grant execute on function public.list_pending_users() to authenticated;
