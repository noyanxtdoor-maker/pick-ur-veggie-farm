// P1N (ported from Team B, 2026-07-17): post-approval username onboarding. The server RPCs are in
// migration 20260717110000_p1n_post_approval_username_onboarding.sql. After the owner approves a
// sign-up, the user signs in and the app gate (RequireUsernameOnboarding in router.tsx) calls
// needsOnboarding(); if true, the user is redirected to /onboarding/username where they MUST choose
// their own username (game/bank-style) before reaching the main app. One-time-only.
import {supabase} from '../../core/supabase/client';
import {MOCK_MODE} from '../../core/mock/mock';

export const usernameOnboardingApi = {
  async needsOnboarding(): Promise<boolean> {
    if (MOCK_MODE) return false;  // demo mode skips the gate (no real approval flow)
    const {data, error} = await supabase.rpc('needs_username_onboarding');
    if (error) throw new Error(error.message);
    return Boolean(data);
  },
  async choose(pUsername: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has no onboarding flow.');
    const {error} = await supabase.rpc('set_chosen_username', {p_username: pUsername});
    if (error) throw new Error(error.message);
  },
};
