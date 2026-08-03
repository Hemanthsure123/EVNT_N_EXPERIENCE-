import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRecentSearches, pushRecentSearch, readRecentSearches } from './recent-searches';

beforeEach(() => window.localStorage.clear());

describe('recent searches', () => {
  it('keeps the newest first', () => {
    pushRecentSearch('comedy');
    pushRecentSearch('jazz');
    expect(readRecentSearches().map((r) => r.query)).toEqual(['jazz', 'comedy']);
  });

  it('de-dupes case-insensitively instead of stacking near-identical entries', () => {
    pushRecentSearch('Comedy');
    pushRecentSearch('jazz');
    pushRecentSearch('comedy');
    expect(readRecentSearches().map((r) => r.query)).toEqual(['comedy', 'jazz']);
  });

  it('caps the list', () => {
    for (let i = 0; i < 20; i += 1) pushRecentSearch(`term ${i}`);
    expect(readRecentSearches()).toHaveLength(6);
  });

  it('ignores blank input', () => {
    pushRecentSearch('   ');
    expect(readRecentSearches()).toEqual([]);
  });

  it('clears', () => {
    pushRecentSearch('comedy');
    expect(clearRecentSearches()).toEqual([]);
    expect(readRecentSearches()).toEqual([]);
  });

  it('survives corrupt storage rather than throwing on render', () => {
    window.localStorage.setItem('ee-recent-searches', 'not json');
    expect(readRecentSearches()).toEqual([]);
  });

  it('survives storage being blocked entirely', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => pushRecentSearch('comedy')).not.toThrow();
    setItem.mockRestore();
  });
});
