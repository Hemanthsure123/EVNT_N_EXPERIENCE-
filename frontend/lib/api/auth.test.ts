import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { googleSignInAvailable, redeemGoogleSignIn, register, verifyEmail } from './auth';
import { tokenStore } from './token-store';

/**
 * The auth client's contract with `apps/accounts`.
 *
 * The behaviour worth pinning is which calls WRITE a session. Registration
 * used to; it no longer does, and getting that wrong leaves the app believing
 * it has a session it does not have — every subsequent request 401s with no
 * obvious cause, which is exactly the failure TypeScript could not catch
 * (both responses carry a `user`).
 */

/** Typed like `fetch`, so `mock.calls[n][1]` is the request init. */
type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

beforeEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  tokenStore.clear();
});

describe('register', () => {
  it('does NOT store a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        json({
          user: { id: '1', email: 'a@b.com', email_verified: false },
          verification_required: true,
          message: 'We sent a code.',
        }),
      ),
    );

    const result = await register('A@B.com', 'password123', ' Ada ');

    expect(result.verification_required).toBe(true);
    // THE assertion. A token here would mean the verify step could be skipped.
    expect(tokenStore.getAccess()).toBeNull();
  });

  it('normalises the address it sends', async () => {
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>(() =>
      json({ user: { id: '1' }, verification_required: true, message: '' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await register('  Mixed@Case.COM ', 'password123', '  Ada  ');

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.email).toBe('mixed@case.com');
    expect(body.full_name).toBe('Ada');
  });
});

describe('verifyEmail', () => {
  it('stores the session it returns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        json({
          user: { id: '1', email: 'a@b.com', email_verified: true },
          tokens: { access: 'access-token', refresh: 'refresh-token' },
        }),
      ),
    );

    await verifyEmail('a@b.com', '123456');

    // Verifying IS the sign-in, not a step before one.
    expect(tokenStore.getAccess()).toBe('access-token');
  });
});

describe('googleSignInAvailable', () => {
  it('reports what the backend says', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ available: true })));
    await expect(googleSignInAvailable()).resolves.toBe(true);
  });

  it('treats an unreachable backend as unavailable', async () => {
    // Hiding the button is the safe failure: the alternative offers a control
    // that cannot work.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    await expect(googleSignInAvailable()).resolves.toBe(false);
  });
});

describe('redeemGoogleSignIn', () => {
  it('exchanges the handoff for a stored session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        json({
          user: { id: '1', email: 'a@b.com', email_verified: true },
          tokens: { access: 'google-access', refresh: 'google-refresh' },
        }),
      ),
    );

    await redeemGoogleSignIn('one-time-code');

    expect(tokenStore.getAccess()).toBe('google-access');
  });

  it('sends the handoff in the body, never the URL', async () => {
    const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>(() =>
      json({ user: { id: '1' }, tokens: { access: 'a', refresh: 'r' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await redeemGoogleSignIn('secret-handoff');

    const [url, init] = fetchMock.mock.calls[0];
    // A handoff in the query string would reach server logs and the next
    // request's Referer — the whole reason it exists instead of raw tokens.
    expect(String(url)).not.toContain('secret-handoff');
    expect(String(init?.body)).toContain('secret-handoff');
  });
});
