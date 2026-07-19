// TOTP two-factor authentication (owner 2026-07-19: "settle the 2 factor login... if not build it").
// TOTP was already ON at the Supabase project level (owner-confirmed 2026-07-13), but nothing in the
// app let a user actually enroll or complete a challenge — the toggle existed with no way to use it.
// This is pure client wiring against supabase-js's built-in `auth.mfa` API; GoTrue owns the
// auth.mfa_factors/auth.mfa_challenges tables itself, so no migration or RPC is needed here, unlike
// MPIN (which is a first-party table this app owns and had to build from scratch).
import {supabase} from '../../core/supabase/client';

export interface TotpEnrollment {
  factorId: string;
  qrCode: string; // data: URI SVG — pass straight into <img src>
  secret: string; // manual-entry fallback for authenticator apps that can't scan
}

export interface TotpFactor {
  id: string;
  friendlyName: string | null;
  createdAt: string;
}

export const mfaApi = {
  // Verified TOTP factors only — an abandoned unverified enroll() should not read as "2FA is on".
  async listVerifiedFactors(): Promise<TotpFactor[]> {
    const {data, error} = await supabase.auth.mfa.listFactors();
    if (error) throw new Error(error.message);
    return (data?.totp ?? [])
      .filter((f) => f.status === 'verified')
      .map((f) => ({id: f.id, friendlyName: f.friendly_name ?? null, createdAt: f.created_at}));
  },

  async enroll(): Promise<TotpEnrollment> {
    const {data, error} = await supabase.auth.mfa.enroll({factorType: 'totp'});
    if (error) throw new Error(error.message);
    return {factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret};
  },

  // Confirms the code from the authenticator app against a freshly-enrolled factor, flipping it from
  // unverified to verified. Same call shape as verifyChallenge() below (challengeAndVerify does both
  // steps at once) — kept as a separate named method since the two call sites mean different things.
  async verifyEnrollment(factorId: string, code: string): Promise<{error: string | null}> {
    const {error} = await supabase.auth.mfa.challengeAndVerify({factorId, code});
    return {error: error ? error.message : null};
  },

  // Abandoned mid-enrollment factor (user closed the QR step without finishing) — remove it so it
  // doesn't linger as an orphaned unverified factor forever.
  async cancelEnrollment(factorId: string): Promise<void> {
    await supabase.auth.mfa.unenroll({factorId});
  },

  async unenroll(factorId: string): Promise<{error: string | null}> {
    const {error} = await supabase.auth.mfa.unenroll({factorId});
    return {error: error ? error.message : null};
  },

  // Post-sign-in challenge: the session is AAL1 (password/Google/passkey only proved identity, not
  // possession of the second factor) — this elevates it to AAL2. Router's RequireMfaChallenge decides
  // WHEN to send the user here; this just performs the elevation once they're on that screen.
  async verifyChallenge(factorId: string, code: string): Promise<{error: string | null}> {
    const {error} = await supabase.auth.mfa.challengeAndVerify({factorId, code});
    return {error: error ? error.message : null};
  },

  // What the router gate checks: does this session need an AAL2 challenge it hasn't completed yet?
  // Fail-open (returns false) on any error — an MFA outage must never lock every user out entirely;
  // the server still enforces AAL2 on anything that actually requires it via RLS/RPC checks.
  async needsChallenge(): Promise<{needed: boolean; factorId: string | null}> {
    const {data, error} = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return {needed: false, factorId: null};
    if (data.nextLevel !== 'aal2' || data.currentLevel === data.nextLevel) return {needed: false, factorId: null};
    const {data: factors} = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp?.find((f) => f.status === 'verified');
    return {needed: Boolean(verified), factorId: verified?.id ?? null};
  },
};
