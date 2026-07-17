-- Migration P1I — Remove Invitations (owner decision 2026-07-13, choosing option C of the presented plan).
-- Root problem: accept_invitation() links whichever account is CURRENTLY SIGNED IN when the link is
-- opened, with no check that it matches the invitation's intended recipient — an admin testing their own
-- "copy invite link" while still signed in ends up granting the role to their OWN account instead
-- (confirmed live 2026-07-13: "it has access... but no one is using it"). Rather than patch that gap, the
-- owner chose to remove Invitations entirely: self-signup + Approvals already fully covers onboarding and
-- is the well-tested path, so there is no need for a second, more confusing, currently-broken one.
-- Not a hard-delete: `invitations` rows and the functions themselves stay in place (never-hard-delete,
-- same invariant as P1F/P1G) — this migration only revokes EXECUTE, so the RPCs simply stop being
-- reachable. The UI paths (Invitations screen, /accept page, the nav tab) are removed at the app-code
-- layer in the same commit.
-- Risk: Low (pure grant revocation on a feature being retired; no data touched).

revoke execute on function public.invite_user(uuid, uuid, uuid, text, int) from authenticated;
revoke execute on function public.accept_invitation(text) from authenticated;
comment on function public.invite_user(uuid, uuid, uuid, text, int) is 'P1I: RETIRED 2026-07-13 (owner decision — see migration header). Execute revoked; kept, not dropped, per the never-hard-delete invariant.';
comment on function public.accept_invitation(text) is 'P1I: RETIRED 2026-07-13 (owner decision — see migration header). Execute revoked; kept, not dropped, per the never-hard-delete invariant.';
