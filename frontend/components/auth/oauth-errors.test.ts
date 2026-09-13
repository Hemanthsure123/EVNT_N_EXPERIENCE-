import { describe, expect, it } from 'vitest';
import { oauthErrorMessage } from './oauth-errors';

/**
 * The bug this guards: a failed Google sign-in that said nothing at all.
 *
 * The backend answers a refused handshake with a redirect to
 * `/sign-in?error=<code>`, under a comment promising the page will turn the
 * code into a sentence. `SignInScreen` read `?next=` and nothing else, so a
 * cancelled consent, an expired state, an unverified Google address and a
 * suspended account all arrived as a pristine sign-in form — which reads, from
 * the seat of the person pressing the button, as "Google sign-in is broken".
 *
 * Two properties matter and neither is obvious from the map itself.
 */
describe('oauthErrorMessage', () => {
  it('says nothing when there is no error', () => {
    // The ordinary case: `/sign-in` with no param renders no notice. Null
    // rather than an empty string, so the caller's `? :` is a real branch and
    // not a paragraph containing nothing.
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage(undefined)).toBeNull();
    expect(oauthErrorMessage('')).toBeNull();
  });

  it('names the specific refusal it was given', () => {
    expect(oauthErrorMessage('google_sign_in_cancelled')).toContain('cancelled');
    expect(oauthErrorMessage('oauth_state_invalid')).toContain('expired');
    expect(oauthErrorMessage('google_account_unverified')).toContain("isn't verified");
    expect(oauthErrorMessage('account_suspended')).toContain('suspended');
    expect(oauthErrorMessage('google_sign_in_failed')).toContain('could not be completed');
  });

  it('still speaks for a code it does not recognise', () => {
    // THE IMPORTANT ONE. Returning null here would make any error code the
    // backend grows after today silent on arrival — the original bug, one
    // level down and harder to find, because the map would look complete.
    const message = oauthErrorMessage('some_future_backend_code');
    expect(message).not.toBeNull();
    expect(message).toContain('did not complete');
  });
});
