import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './client';

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
});
