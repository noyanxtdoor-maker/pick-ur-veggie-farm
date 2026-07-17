-- Migration P1K — Real-time auto-sync, phase 1 (owner request 2026-07-13: "no more manual refresh").
-- Scope, deliberately narrow per the phased plan presented and approved: the two flows the owner named —
-- Approvals (pending queue + directory) and the POS sales feed / Dashboard. Broader coverage is a later
-- phase once this pattern is proven, not a rewrite of every screen at once.
--
-- `supabase_realtime` starts as an EMPTY publication in this project (verified: `select * from
-- pg_publication_tables where pubname='supabase_realtime'` returns zero rows before this migration) —
-- Supabase broadcasts row changes on a table ONLY once it's added here. Security: Realtime enforces the
-- table's own RLS SELECT policies per subscriber before broadcasting a row (the same policies already
-- guard-proven for ordinary reads) — adding a table here does not widen who can see what, only adds a
-- push channel for rows a client could already SELECT. This cannot be proven by a SQL guard (RLS-on-
-- broadcast is enforced by the separate Realtime service, not reachable from psql) — verified instead by
-- a live two-session browser check (see STATUS.md).
alter publication supabase_realtime add table public.user_branch_roles;
alter publication supabase_realtime add table public.users;
alter publication supabase_realtime add table public.invoices;
