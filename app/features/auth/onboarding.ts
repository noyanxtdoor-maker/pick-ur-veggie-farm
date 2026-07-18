// P1N (ported from Team B, 2026-07-17): post-approval username onboarding. The server RPCs are in
// migration 20260717110000_p1n_post_approval_username_onboarding.sql. After the owner approves a
// sign-up, the user signs in and the app gate (RequireOnboarding in router.tsx) calls
// onboardingApi.nextStep(); the user is routed through each pending step (username, then mpin)
// before reaching the main app. One-time-only per step.
//
// P1P (2026-07-18): mandatory MPIN layer. needsOnboarding() (boolean) is kept UNCHANGED and still
// callable — nothing currently references it will break — but the router now drives off
// onboardingApi.nextStep() instead, which supersedes it with an ordered sequence.
import {supabase} from '../../core/supabase/client';
import {MOCK_MODE} from '../../core/mock/mock';

export type OnboardingStep = 'username' | 'mpin' | 'biometric_offer' | null;
export type MpinResult = 'ok' | 'wrong' | 'locked' | 'no_mpin';
export type BiometricRegisterResult = {status: 'ok'} | {status: 'cancelled'} | {status: 'error'; message: string};
// Matches the installed SDK's PasskeyListItem shape (node_modules/@supabase/auth-js/dist/main/lib/types.d.ts)
// exactly, defined locally rather than imported — the passkey API is experimental/beta and its types
// are not re-exported from the top-level @supabase/supabase-js package.
export type PasskeyListItem = {id: string; friendly_name?: string; created_at: string; last_used_at?: string};

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

export const onboardingApi = {
  async nextStep(): Promise<OnboardingStep> {
    if (MOCK_MODE) return null;  // demo mode skips the gate (no real approval/security flow)
    const {data, error} = await supabase.rpc('onboarding_next_step');
    if (error) throw new Error(error.message);
    return (data as OnboardingStep) ?? null;
  },
};

// P1P: MPIN state lives behind SECURITY DEFINER RPCs only (no table grants at all — see the
// migration header). verify()/change() return a status string rather than throwing for the
// expected outcomes (wrong/locked/no_mpin) — that mirrors the server contract exactly, since a
// thrown PostgREST error there would have no distinguishable code to branch on anyway.
export const mpinApi = {
  async status(): Promise<{hasMpin: boolean; lockedUntil: string | null}> {
    if (MOCK_MODE) return {hasMpin: true, lockedUntil: null};  // demo mode: never gate on this
    const {data, error} = await supabase.rpc('mpin_status');
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {hasMpin: Boolean(row?.has_mpin), lockedUntil: row?.locked_until ?? null};
  },
  async set(pMpin: string): Promise<void> {
    if (MOCK_MODE) throw new Error('Demo mode has no MPIN flow.');
    const {error} = await supabase.rpc('set_mpin', {p_mpin: pMpin});
    if (error) throw new Error(error.message);
  },
  async verify(pMpin: string): Promise<MpinResult> {
    if (MOCK_MODE) return 'ok';
    const {data, error} = await supabase.rpc('verify_mpin', {p_mpin: pMpin});
    if (error) throw new Error(error.message);
    return data as MpinResult;
  },
  async change(pCurrentMpin: string, pNewMpin: string): Promise<MpinResult> {
    if (MOCK_MODE) throw new Error('Demo mode has no MPIN flow.');
    const {data, error} = await supabase.rpc('change_mpin', {p_current_mpin: pCurrentMpin, p_new_mpin: pNewMpin});
    if (error) throw new Error(error.message);
    return data as MpinResult;
  },
};

// P1P.2: biometric/passkey login (Phase 2, optional — owner: "some workers dont have that advcade
// phone that has biometrics"). Credentials themselves live entirely inside Supabase Auth's own
// schema — this app never sees or stores credential data, only the SECURITY DEFINER-gated
// biometric_offer_seen_at onboarding flag (public.users, set via dismiss_biometric_offer()).
export const biometricApi = {
  // Async platform check, not just "does the WebAuthn API exist" — confirms real biometric
  // hardware is actually available, so a device with API surface but no fingerprint/Face ID sensor
  // never gets offered a button that would just fail.
  async isSupported(): Promise<boolean> {
    if (MOCK_MODE) return false; // demo mode: no real WebAuthn backend to register/verify against
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch { return false; }
  },
  async register(): Promise<BiometricRegisterResult> {
    if (MOCK_MODE) return {status: 'error', message: 'Demo mode has no biometric flow.'};
    const {error} = await supabase.auth.registerPasskey();
    if (!error) return {status: 'ok'};
    if ((error as {code?: string}).code === 'ERROR_CEREMONY_ABORTED') return {status: 'cancelled'};
    return {status: 'error', message: error.message};
  },
  async list(): Promise<PasskeyListItem[]> {
    if (MOCK_MODE) return [];
    const {data, error} = await supabase.auth.passkey.list();
    if (error) throw new Error(error.message);
    return data ?? [];
  },
  async remove(passkeyId: string): Promise<{error: string | null}> {
    if (MOCK_MODE) return {error: 'Demo mode has no biometric flow.'};
    const {error} = await supabase.auth.passkey.delete({passkeyId});
    return {error: error ? error.message : null};
  },
  async dismissOffer(): Promise<void> {
    if (MOCK_MODE) return;
    const {error} = await supabase.rpc('dismiss_biometric_offer');
    if (error) throw new Error(error.message);
  },
};
