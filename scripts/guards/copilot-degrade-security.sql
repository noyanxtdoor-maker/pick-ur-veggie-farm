-- Tier-2 CAP-VG1 offline-degrade / zero-DB-surface guard (spec §5) — blocking gate.
-- CAP-VG1 v1 steps 1–4 are CLIENT-ONLY: prefs + a client IndexedDB history + a local model call. This
-- battery proves the Postgres schema gained NOTHING from them — no table, no permission key, no policy,
-- no function — so the ERP's entire guarded surface is provably independent of the Copilot ("the ERP
-- never depends on the AI being up", spec §1). When step 5 (Edge Function + copilot.use) ships, this
-- guard evolves to expect exactly that surface and its own 4 batteries join it (spec §5).
\set ON_ERROR_STOP on
begin;

do $$ declare n int;
begin
  select count(*) into n from pg_tables where schemaname = 'public' and tablename ilike '%copilot%';
  if n <> 0 then raise exception 'DEFECT vg1: % copilot table(s) in Postgres — v1 steps 1-4 must be client-only', n; end if;
  raise notice 'PASS vg1: no copilot tables in the schema (client-only history holds)';
end $$;

do $$ declare n int;
begin
  select count(*) into n from public.permissions where permission_key ilike 'copilot%';
  if n <> 0 then raise exception 'DEFECT vg1: copilot permission key present before step 5 (found %)', n; end if;
  raise notice 'PASS vg1: no copilot permission key pre-step-5 (additive key arrives with the Edge Function)';
end $$;

do $$ declare n int;
begin
  select count(*) into n from pg_policies where schemaname = 'public' and (policyname ilike '%copilot%' or tablename ilike '%copilot%');
  if n <> 0 then raise exception 'DEFECT vg1: % copilot RLS polic(ies) — v1 has no DB surface', n; end if;
  raise notice 'PASS vg1: no copilot RLS policies';
end $$;

do $$ declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname ilike '%copilot%';
  if n <> 0 then raise exception 'DEFECT vg1: % copilot function(s) in Postgres — the model is advisory, not a DB actor', n; end if;
  raise notice 'PASS vg1: no copilot functions — zero server execution surface for the AI';
end $$;

rollback;
