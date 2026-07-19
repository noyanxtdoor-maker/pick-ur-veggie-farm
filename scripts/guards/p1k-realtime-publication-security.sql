-- Guard: P1K/P1K.1 realtime publication coverage.
-- Structural proof, not a live-event proof: confirms every table this app's client code actually
-- subscribes to via useRealtimeRefresh() (app/core/offline/realtime.ts) is present in the
-- supabase_realtime publication. This is exactly the class of bug P1K.1 fixed (void_requests was
-- subscribed client-side but never published) — a channel reports SUBSCRIBED even when its table
-- isn't published, so this gap is invisible without checking pg_publication_tables directly.
--
-- What this CANNOT prove locally: that an actual postgres_changes event is delivered end-to-end.
-- STATUS.md (P1K, 2026-07-13) already documents a local Supabase CLI Realtime container quirk that
-- blocked live-event verification even with a fully correct publication/WAL/replication-slot setup
-- — this is a known, disclosed local-only limitation, not something this guard can route around.
-- Production runs Supabase's managed Realtime infrastructure (different from the local Docker
-- container), so a live two-browser-tab test on the real site is still the authoritative proof —
-- this guard only catches "the plumbing is definitely wrong," not "the plumbing definitely works."
--
-- If you add a new useRealtimeRefresh() call site with a new watched table, update EXPECTED below
-- (and add the table to the publication in a new migration) — this guard does not read the
-- TypeScript source, so it cannot detect a newly-added subscription on its own.
do $$
declare
  expected text[] := array['invoices', 'user_branch_roles', 'users', 'void_requests']; -- Dashboard.tsx (invoices); ApprovalsScreen.tsx (the other three)
  t text;
  missing text[] := array[]::text[];
begin
  foreach t in array expected loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      missing := array_append(missing, t);
    end if;
  end loop;
  if array_length(missing, 1) > 0 then
    raise exception 'FAIL p1k: table(s) % are subscribed to client-side (useRealtimeRefresh) but NOT in the supabase_realtime publication — the channel will report SUBSCRIBED but silently never fire', missing;
  end if;
  raise notice 'PASS p1k: every client-subscribed table (%) is present in the supabase_realtime publication', array_to_string(expected, ', ');
end $$;
