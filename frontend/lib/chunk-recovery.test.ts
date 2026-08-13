import { describe, expect, it } from 'vitest';
import { isChunkLoadError, shouldAttemptChunkReload } from './chunk-recovery';

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    read: () => Object.fromEntries(map),
  };
}

describe('isChunkLoadError', () => {
  it('matches the shapes each browser actually produces', () => {
    // The text differs per engine and only webpack sets the name, so neither
    // signal alone is enough — that is the whole reason this is a function.
    expect(isChunkLoadError(Object.assign(new Error('boom'), { name: 'ChunkLoadError' }))).toBe(
      true,
    );
    expect(isChunkLoadError(new Error('Loading chunk 4821 failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading CSS chunk 12 failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(
      isChunkLoadError(
        new Error('Failed to fetch dynamically imported module: https://x/_next/static/a.js'),
      ),
    ).toBe(true);
  });

  it('does NOT match errors a reload cannot fix', () => {
    // This is the important half. Reloading on a real bug hides it and can
    // loop; every one of these must reach the error screen instead.
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(
      false,
    );
    expect(isChunkLoadError(new Error('Request failed with status 500'))).toBe(false);
    expect(isChunkLoadError(new Error('NetworkError when attempting to fetch resource.'))).toBe(
      false,
    );
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('ChunkLoadError')).toBe(false); // a string, not an Error
    expect(isChunkLoadError({})).toBe(false);
  });
});

describe('shouldAttemptChunkReload', () => {
  it('allows the first attempt and records it', () => {
    const s = storage();
    expect(shouldAttemptChunkReload(s, 1_000)).toBe(true);
    expect(Object.values(s.read())).toEqual(['1000']);
  });

  it('REFUSES a second attempt inside the loop window', () => {
    // The property that matters: if reloading did not fix it, reloading again
    // will not either, and the user gets a page that never settles.
    const s = storage();
    expect(shouldAttemptChunkReload(s, 1_000)).toBe(true);
    expect(shouldAttemptChunkReload(s, 1_500)).toBe(false);
    expect(shouldAttemptChunkReload(s, 30_999)).toBe(false);
  });

  it('allows recovery again once the window has passed', () => {
    // A later deploy is a genuinely new event, not a loop, and must still heal.
    const s = storage();
    expect(shouldAttemptChunkReload(s, 1_000)).toBe(true);
    expect(shouldAttemptChunkReload(s, 40_000)).toBe(true);
  });

  it('declines when storage is unavailable or throws', () => {
    // Safari private mode. With nowhere to record an attempt there is no way
    // to stop a second one, so the error screen is the safe answer.
    expect(shouldAttemptChunkReload(undefined, 1_000)).toBe(false);
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(shouldAttemptChunkReload(hostile, 1_000)).toBe(false);
  });

  it('treats a corrupted guard value as no previous attempt', () => {
    const s = storage({ 'curatix:chunk-recovery-at': 'not-a-number' });
    expect(shouldAttemptChunkReload(s, 5_000)).toBe(true);
  });
});
