/**
 * What a failed Google sign-in says, in ONE place.
 *
 * ── THE BUG: A FAILURE THAT SAID NOTHING AT ALL ───────────────────────────
 *
 * `GoogleSignInCallbackView` answers a failed handshake with
 * `redirect(f"{site}/sign-in?{urlencode({'error': exc.code})}")`, under a
 * comment reading "the user is returned to sign-in with a code the page can
 * turn into a sentence". The page never turned it into anything:
 * `SignInScreen` read `?next=` and nothing else, so every one of these —
 *
 *   · the person pressed Cancel on Google's consent screen
 *   · the state entry expired (it lives 10 minutes) or was replayed
 *   · the Google account's address is not verified WITH GOOGLE
 *   · the account is suspended
 *
 * — put them back on a pristine sign-in form with no message, no highlight and
 * nothing to act on. Verified on the deployed site: `/sign-in?error=
 * oauth_state_invalid` renders exactly the same page as `/sign-in`.
 *
 * From the seat of the person signing in that is indistinguishable from "the
 * Google button is broken": you press it, you come back, nothing happened.
 *
 * ── WHY THIS IS A MODULE AND NOT TWO COPIES ───────────────────────────────
 *
 * Two surfaces receive these codes — `/auth/callback` (which already had its
 * own map) and `/sign-in` (which had none). A second copy is how the two end
 * up describing the same refusal differently, and this map is the only thing
 * standing between a backend error code and a person deciding whether the
 * problem is theirs or ours.
 *
 * Every string names what happened AND what to do about it. `invalid_
 * credentials` is the one that cannot: it is what the service raises when
 * Google verified somebody we then refused, which is a state only support can
 * unpick.
 */
const MESSAGES: Record<string, string> = {
  google_sign_in_cancelled: 'Sign-in was cancelled. You can try again whenever you like.',
  google_account_unverified:
    "That Google account's email address isn't verified with Google, so it can't be used to " +
    'sign in. Verify it with Google, or sign in with your password.',
  oauth_state_invalid: 'That sign-in link expired or was already used. Please try again.',
  // Google was reached and the handshake did not finish — a replayed or
  // expired authorization code, or Google briefly unreachable. It used to be a
  // raw 500 in the address bar, because `OidcError` is a `RuntimeError` and the
  // callback view catches only `DomainError`.
  google_sign_in_failed: 'Google sign-in could not be completed. Please try again.',
  google_sign_in_unavailable: 'Google sign-in is not available on this deployment.',
  account_suspended: 'That account has been suspended. Contact support if you think that is wrong.',
  invalid_credentials: 'That account is not available. Please contact support.',
};

/**
 * A sentence for a backend error code, or null when there is nothing to say.
 *
 * Null for an ABSENT code — the ordinary case, where the page renders no
 * notice — and a generic sentence for a code we do not recognise, because a
 * failure nobody anticipated is still a failure the person needs telling
 * about. Returning null for both would make a new backend error code silent,
 * which is the bug this module exists to fix, reintroduced one level down.
 */
export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? 'Sign-in did not complete. Please try again.';
}
