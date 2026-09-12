import { describe, expect, it } from 'vitest';
import { TOKEN_EXPIRY_SKEW_SECONDS, tokenExpiry, tokenIsExpired } from './jwt';

/**
 * The decision that decides whether an upload is worth sending.
 *
 * Every case here fails SILENTLY in the app: read the expiry wrong and either
 * a six-megabyte upload is spent on a token the server was always going to
 * refuse, or every upload pays for a refresh it did not need. Neither is
 * visible by looking at a screen.
 */

const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);

/** A token is `header.payload.signature`; only the middle is ever read. */
function token(claims: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(claims))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${body}.signature`;
}

describe('tokenExpiry', () => {
  it('reads exp out of a base64url payload', () => {
    expect(tokenExpiry(token({ exp: 1_800_000_000, user_id: 'u1' }))).toBe(1_800_000_000);
  });

  it('answers null for anything it cannot read rather than guessing', () => {
    expect(tokenExpiry(null)).toBeNull();
    expect(tokenExpiry('')).toBeNull();
    expect(tokenExpiry('not-a-jwt')).toBeNull();
    expect(tokenExpiry('header..signature')).toBeNull();
    expect(tokenExpiry(token({ user_id: 'u1' }))).toBeNull();
    expect(tokenExpiry(token({ exp: 'soon' }))).toBeNull();
  });
});

describe('tokenIsExpired', () => {
  it('is false for a token with time left', () => {
    expect(tokenIsExpired(token({ exp: NOW / 1000 + 3600 }), NOW)).toBe(false);
  });

  it('is true once it has passed', () => {
    expect(tokenIsExpired(token({ exp: NOW / 1000 - 1 }), NOW)).toBe(true);
  });

  it('treats a token about to expire as expired', () => {
    // The clock here and the clock at the server are not the same clock, and a
    // token that dies mid-upload costs the whole upload.
    const inside = NOW / 1000 + TOKEN_EXPIRY_SKEW_SECONDS - 5;
    expect(tokenIsExpired(token({ exp: inside }), NOW)).toBe(true);
    const outside = NOW / 1000 + TOKEN_EXPIRY_SKEW_SECONDS + 5;
    expect(tokenIsExpired(token({ exp: outside }), NOW)).toBe(false);
  });

  it('does NOT call an unreadable token expired', () => {
    // Unreadable is not expired. Treating it as expired would refresh before
    // every upload for any token format this function does not understand.
    expect(tokenIsExpired('not-a-jwt', NOW)).toBe(false);
    expect(tokenIsExpired(null, NOW)).toBe(false);
  });
});
