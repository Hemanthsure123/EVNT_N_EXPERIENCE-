import { api } from './client';
import { tokenStore } from './token-store';
import type { AuthResponse, RegistrationResponse, User } from './types';

/**
 * Sign in, sign up, sign out.
 *
 * These are the only calls that WRITE to the token store, which is what keeps
 * "who is signed in" answerable from exactly one place (`token-store`), rather
 * than from several components each holding their own copy.
 *
 * Email + password are LIVE against `apps/accounts`. OAuth and phone/OTP are
 * built here as SEAMS, deliberately: the UI for them is finished and shipped,
 * and each has exactly one function to implement when the backend arrives.
 *
 * Until then they fail LOUDLY and instantly with `ProviderNotConfiguredError`,
 * which the UI renders as a plain sentence. They never hang on a spinner and
 * never report a success that didn't happen — a sign-in button that appears to
 * work is the single worst thing to fake, because everything downstream (a
 * ticket, a payment) is attributed to whoever it claims you are.
 */

export async function login(email: string, password: string): Promise<AuthResponse> {
  const result = await api.post<AuthResponse>(
    '/auth/login',
    { email: email.trim().toLowerCase(), password },
    { auth: false },
  );
  tokenStore.set(result.tokens.access, result.tokens.refresh);
  return result;
}

/**
 * Create an account. Does NOT sign anybody in.
 *
 * The backend returns no tokens here on purpose: a session at sign-up would
 * make email verification optional in practice. `verifyEmail` is what returns
 * one, so the caller must route to the verify step rather than assuming a
 * signed-in state.
 */
export async function register(
  email: string,
  password: string,
  fullName: string,
): Promise<RegistrationResponse> {
  return api.post<RegistrationResponse>(
    '/auth/register',
    { email: email.trim().toLowerCase(), password, full_name: fullName.trim() },
    { auth: false },
  );
}

/** Prove the address with the emailed code. THIS is what signs you in. */
export async function verifyEmail(email: string, code: string): Promise<AuthResponse> {
  const result = await api.post<AuthResponse>(
    '/auth/verify-email',
    { email: email.trim().toLowerCase(), code: code.trim() },
    { auth: false },
  );
  tokenStore.set(result.tokens.access, result.tokens.refresh);
  return result;
}

/**
 * Ask for a fresh code.
 *
 * A `verification_cooldown` error carries `details.seconds_remaining`, which
 * the UI counts down with rather than guessing.
 */
export async function resendVerification(email: string): Promise<void> {
  await api.post<{ email: string }>(
    '/auth/verify-email/resend',
    { email: email.trim().toLowerCase() },
    { auth: false },
  );
}

export const fetchMe = () => api.get<User>('/auth/me');

export async function logout(): Promise<void> {
  try {
    await api.post<void>('/auth/logout', {});
  } catch {
    // The local session is what matters; a failed server call must not leave
    // someone stuck signed in on a shared device.
  } finally {
    tokenStore.clear();
  }
}

/* -------------------------------------------------------------------------- */
/* Seams for the providers the backend doesn't have yet                        */
/* -------------------------------------------------------------------------- */

/**
 * Thrown when a provider has no configured backend. Carries the provider so the
 * UI can name it rather than showing a generic failure.
 */
export class ProviderNotConfiguredError extends Error {
  readonly provider: string;

  constructor(provider: string) {
    super(`${provider} sign-in isn't connected yet.`);
    this.name = 'ProviderNotConfiguredError';
    this.provider = provider;
  }
}

export type OAuthProvider = 'google' | 'apple';

/* --- Google: REAL, as of apps/accounts' GoogleSignInService --------------- */

/**
 * Whether this deployment can offer Google sign-in.
 *
 * Asked of the BACKEND rather than inferred from a `NEXT_PUBLIC_` flag,
 * because the credentials live only on the server — the frontend has no way
 * to know otherwise, and a button that 503s is worse than no button. Same
 * pattern as `GET /push/config`.
 */
/**
 * Three answers, not two — and collapsing them is a bug that has already bitten.
 *
 * - `available`    — the backend holds Google credentials. Show the button.
 * - `unconfigured` — the backend answered and said no. Hide it silently; this
 *                    deployment genuinely does not offer Google.
 * - `unreachable`  — we could not ask. NOT the same thing at all.
 *
 * ── WHY THE THIRD ONE HAD TO BE SPLIT OUT ────────────────────────────────
 *
 * This used to be `Promise<boolean>` with `catch { return false }`, and the
 * comment defended it as "the safe failure". It is safe, and it is also how a
 * working feature silently disappears: point `NEXT_PUBLIC_API_BASE_URL` at a
 * backend that is down — a stopped container, a rotated Cloudflare quick
 * tunnel — and the Google button vanishes with no explanation, while the email
 * form stays on screen looking fine and fails only on submit. The user
 * concludes the feature was removed.
 *
 * Which is exactly what it looked like: "my existing feature google sign in is
 * missing." Nothing was missing. The backend was unreachable, and this function
 * reported that as "not configured".
 *
 * `unreachable` is worth surfacing because it is information about the WHOLE
 * panel, not about one provider: if the config call cannot complete, neither
 * can signing in with a password. Saying so once beats letting somebody type
 * their credentials into a form that cannot submit.
 */
export type GoogleSignInAvailability = 'available' | 'unconfigured' | 'unreachable';

export async function googleSignInAvailable(): Promise<GoogleSignInAvailability> {
  try {
    const { available } = await api.get<{ available: boolean }>(
      '/auth/oauth/google/signin/config',
      { auth: false },
    );
    return available ? 'available' : 'unconfigured';
  } catch {
    // Deliberately does NOT distinguish a 5xx from a network failure. Both mean
    // "this deployment cannot answer right now", which is the same thing to the
    // person trying to sign in, and guessing between them would be inventing
    // detail from an exception we did not inspect.
    return 'unreachable';
  }
}

/**
 * Send the browser to Google.
 *
 * A full navigation, not fetch: the OAuth handshake is a redirect chain that
 * has to happen in the address bar. `next` rides server-side in the state
 * entry, so it cannot be tampered with in the callback URL.
 */
export function startGoogleSignIn(next: string): void {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const query = next ? `?next=${encodeURIComponent(next)}` : '';
  window.location.assign(`${base}/api/v1/auth/oauth/google/signin/start${query}`);
}

/**
 * Exchange the one-time handoff code for the session it stands for.
 *
 * The tokens deliberately never travel in the callback URL — not in the query
 * (server logs, the `Referer` header) and not in the fragment (browser
 * history). This is the second half of that: single-use, two-minute TTL.
 */
export async function redeemGoogleSignIn(handoff: string): Promise<AuthResponse> {
  const result = await api.post<AuthResponse>(
    '/auth/oauth/google/signin/redeem',
    { handoff },
    { auth: false },
  );
  tokenStore.set(result.tokens.access, result.tokens.refresh);
  return result;
}

/* --- Apple: still a seam -------------------------------------------------- */

/**
 * Where the browser is sent to start a NON-Google OAuth handshake.
 *
 * Google no longer goes through here — it has real endpoints above. Apple has
 * no backend, so this returns null and the UI says so immediately rather than
 * failing after a round trip.
 */
export function oauthStartUrl(provider: OAuthProvider, next: string): string | null {
  if (provider === 'google') return null;
  const base = process.env.NEXT_PUBLIC_OAUTH_BASE_URL;
  if (!base) return null;
  return `${base}/${provider}/start?next=${encodeURIComponent(next)}`;
}

/** Begin an OAuth sign-in. Throws immediately if the provider isn't wired up. */
export function startOAuth(provider: OAuthProvider, next: string): void {
  if (provider === 'google') {
    startGoogleSignIn(next);
    return;
  }
  const url = oauthStartUrl(provider, next);
  if (!url) throw new ProviderNotConfiguredError('Apple');
  window.location.assign(url);
}

/** True when a non-Google provider is configured. Google asks the backend. */
export const oauthConfigured = (): boolean => Boolean(process.env.NEXT_PUBLIC_OAUTH_BASE_URL);

/**
 * Phone sign-in, in two steps.
 *
 * The endpoints below are the ones `apps/accounts` would grow — `notifications`
 * already sends DLT-templated OTP SMS, so the delivery half of this exists; the
 * request/verify pair does not. Both calls are real: today they fail with the
 * backend's own 404 envelope, which the UI reports honestly rather than
 * pretending a code was sent.
 */
export async function requestPhoneOtp(phone: string): Promise<void> {
  if (!process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED) {
    throw new ProviderNotConfiguredError('Phone');
  }
  await api.post<void>('/auth/otp/request', { phone }, { auth: false });
}

export async function verifyPhoneOtp(phone: string, code: string): Promise<AuthResponse> {
  if (!process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED) {
    throw new ProviderNotConfiguredError('Phone');
  }
  const result = await api.post<AuthResponse>('/auth/otp/verify', { phone, code }, { auth: false });
  tokenStore.set(result.tokens.access, result.tokens.refresh);
  return result;
}

export const phoneAuthConfigured = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED);
