-- Guard: P2O.1 anon EXECUTE lockdown (public.uuidv7).
-- Proves: (1) the PUBLIC pseudo-role grant is gone, so anon (which inherits through PUBLIC, not a
-- per-role grant — revoking from anon alone would have been a no-op, see the migration comment) can
-- no longer call the raw id-generator; (2) authenticated + service_role keep EXECUTE, since real
-- call paths need them (fixture-setup convention, and legitimate service_role audit-log writes —
-- confirmed by a full guard-battery run); (3) a real end-to-end insert relying on DEFAULT uuidv7()
-- still succeeds.
do $$
begin
  if has_function_privilege('anon', 'public.uuidv7()'::regprocedure, 'EXECUTE')
     or has_function_privilege('public', 'public.uuidv7()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL p2o1: public.uuidv7() is still callable by anon (directly or via the PUBLIC pseudo-role)';
  end if;
  if not has_function_privilege('authenticated', 'public.uuidv7()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL p2o1: authenticated lost EXECUTE on public.uuidv7() — would break fixture setup / any non-RPC insert path';
  end if;
  if not has_function_privilege('service_role', 'public.uuidv7()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL p2o1: service_role lost EXECUTE on public.uuidv7() — would break legitimate elevated-context writes (e.g. audit_events)';
  end if;
  if not has_function_privilege('postgres', 'public.uuidv7()'::regprocedure, 'EXECUTE') then
    raise exception 'FAIL p2o1: the function owner lost its own EXECUTE — would break every RPC insert path';
  end if;
  raise notice 'PASS p2o1: public.uuidv7() grant shape is owner + authenticated + service_role only — anon excluded';
end $$;

begin;
  do $$
  declare v_company_id uuid;
  begin
    insert into companies (name, company_code) values ('P2O1 Guard Co', 'P2O1GD') returning id into v_company_id;
    if v_company_id is null then
      raise exception 'FAIL p2o1: DEFAULT uuidv7() did not produce an id for a real table insert';
    end if;
    raise notice 'PASS p2o1: a real insert relying on DEFAULT uuidv7() still succeeds (id=%)', v_company_id;
  end $$;
rollback;
