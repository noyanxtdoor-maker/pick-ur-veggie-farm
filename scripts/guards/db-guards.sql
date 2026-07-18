-- Tier-2 DB-backed guards (C6 §8 / C3 §12). Run against the migrated database (e.g. after `supabase db reset`).
-- Guard 1 RLS-enabled · Guard 2 tenant-ownership · Guard 4 audit-immutability.
-- Raises an exception on any violation; prints a PASS notice when clean.
do $$
declare
  v_tbl text;
  -- Exempt from the company_id requirement: identity, tenant-root, global-reference, and system-singleton tables.
  -- user_mpin (P1P): a user's MPIN is a property of the person, not any one company — same reasoning as users itself.
  v_exempt_tenant text[] := array['users', 'companies', 'permissions', 'bootstrap_state', 'user_mpin'];
begin
  -- Guard 1: every public base table must have RLS enabled.
  for v_tbl in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || quote_ident(v_tbl))::regclass) then
      raise exception 'GUARD rls-enabled FAILED: table public.% has RLS disabled', v_tbl;
    end if;
  end loop;

  -- Guard 2: tenant-owned tables must carry company_id (exemptions above).
  for v_tbl in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not (c.relname = any (v_exempt_tenant))
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_tbl and column_name = 'company_id'
    ) then
      raise exception 'GUARD tenant-ownership FAILED: table public.% lacks company_id and is not exempt', v_tbl;
    end if;
  end loop;

  -- Guard 4: audit immutability — only applicable once the audit table exists.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname = 'audit_events'
  ) then
    if exists (select 1 from pg_policy where polrelid = 'public.audit_events'::regclass and polcmd in ('w', 'd')) then
      raise exception 'GUARD audit-immutability FAILED: audit_events has an UPDATE/DELETE policy';
    end if;
    if exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'audit_events'
        and grantee in ('anon', 'authenticated', 'service_role')
        and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
    ) then
      raise exception 'GUARD audit-immutability FAILED: audit_events grants UPDATE/DELETE/TRUNCATE to an app role';
    end if;
  else
    raise notice 'GUARD audit-immutability: N/A (no audit_events table yet)';
  end if;

  raise notice 'db-guards: PASS (rls-enabled, tenant-ownership, audit-immutability)';
end $$;
