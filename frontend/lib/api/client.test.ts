import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client';
import { ApiError } from './errors';

describe('apiFetch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parses a successful JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    await expect(apiFetch('/anything', { auth: false })).resolves.toEqual({ ok: true });
  });

  it('turns the backend error envelope into a typed ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'not_found', message: 'Nope', details: {} } }),
            { status: 404 },
          ),
      ),
    );
    await expect(apiFetch('/missing', { auth: false })).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'Nope',
    });
  });

  it('turns a NON-JSON error body into a typed ApiError, never a SyntaxError', async () => {
    // A proxy's 502 page is HTML, not the envelope. Parsing it before checking
    // `res.ok` used to throw SyntaxError, which callers (the Studio's save
    // engine among them) could only read as "network down" — the wrong
    // diagnosis with the wrong remedy attached.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })),
    );
    const thrown = await apiFetch('/anything', { auth: false }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ status: 502, code: 'http_error' });
    // A plain sentence, not the HTML and not an empty string.
    expect((thrown as ApiError).message.length).toBeGreaterThan(0);
  });

  it('lets a non-JSON 2xx throw — a broken contract, not a user-facing error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>not the API</html>', { status: 200 })),
    );
    const thrown = await apiFetch('/anything', { auth: false }).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(thrown).not.toBeInstanceOf(ApiError);
  });
});
