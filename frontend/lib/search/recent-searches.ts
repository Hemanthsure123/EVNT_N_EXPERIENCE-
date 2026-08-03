/**
 * Recent searches — deliberately CLIENT-SIDE ONLY (localStorage).
 *
 * Browsing is public and unauthenticated, so there's no account to hang a
 * search history on, and shipping every keystroke to a server to remember it
 * would be both a privacy cost and a latency cost for zero benefit. It stays on
 * the device, and the user can clear it.
 */

const STORAGE_KEY = 'ee-recent-searches';
const MAX_ENTRIES = 6;

export type RecentSearch = {
  query: string;
  /** Epoch ms — newest first. */
  at: number;
};

function isRecentSearch(value: unknown): value is RecentSearch {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RecentSearch).query === 'string' &&
    typeof (value as RecentSearch).at === 'number'
  );
}

/** Always safe to call — returns [] on the server or if storage is blocked. */
export function readRecentSearches(): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentSearch).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Records a query (de-duped, newest first) and returns the new list. */
export function pushRecentSearch(query: string): RecentSearch[] {
  const trimmed = query.trim();
  if (!trimmed || typeof window === 'undefined') return readRecentSearches();
  const existing = readRecentSearches().filter(
    (entry) => entry.query.toLowerCase() !== trimmed.toLowerCase(),
  );
  const next = [{ query: trimmed, at: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked — recents are a nicety, never a hard failure */
  }
  return next;
}

export function clearRecentSearches(): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return [];
}
