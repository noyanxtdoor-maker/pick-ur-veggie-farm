-- Migration P2-M6C — Schedule visibility tiers (owner review 2026-07-04, plan Phase B.2)
-- Owner rule: "dev, owner, co-owner can see all plans including meetings with the company or investors; the
--   operator, admin, employee cannot see the plans/schedules of the meeting — only planting / delivery
--   schedules." And: "add a SETTING for that … don't make those a default settings."
-- Design: events carry a visibility tier (General | Management). Management events additionally require the
--   NEW grantable permission `schedule.read_private` — so WHO sees management plans is a per-role SETTING the
--   owner controls in Roles (grant/revoke the key), not a hardcoded role list. Non-money; authority 20.19 + 26.09.
-- Pattern note: the M6A FILE stays immutable; its select policy is replaced here BY a new migration (the same
--   evolve-by-new-migration idiom M4A used for functions). Write policies unchanged (schedule.manage).

insert into public.permissions (permission_key, description) values
  ('schedule.read_private', 'See Management-level schedule entries (meetings, investor visits) — grant to owner-tier roles')
on conflict (permission_key) do nothing;

alter table public.calendar_events add column visibility text not null default 'General'
  check (visibility in ('General', 'Management'));
comment on column public.calendar_events.visibility is 'P2-M6C: General = every schedule.read member sees it; Management = additionally needs schedule.read_private (meetings/investor plans hidden from staff).';

-- Replace the M6A select policy with the tiered one (writes untouched).
drop policy calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events for select to authenticated
  using (
    public.has_permission(company_id, 'schedule.read')
    and public.is_branch_member(branch_id)
    and (visibility = 'General' or public.has_permission(company_id, 'schedule.read_private'))
  );
