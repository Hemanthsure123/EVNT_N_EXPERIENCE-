/**
 * JWT token storage. The access token is kept in-memory (smaller XSS surface)
 * with a localStorage mirror so it survives reloads; the refresh token lives in
 * localStorage. This is the pragmatic client-only setup for the current backend
 * (which returns tokens in the JSON body). Moving to httpOnly refresh cookies is
 * a backend+client change we can make later without touching call sites.
 */

const ACCESS_KEY = 'ee-access';
const REFRESH_KEY = 'ee-refresh';

let accessToken: string | null = null;

export const tokenStore = {
  getAccess(): string | null {
    if (accessToken) return accessToken;
    if (typeof window !== 'undefined') {
      accessToken = window.localStorage.getItem(ACCESS_KEY);
    }
    return accessToken;
  },

  getRefresh(): string | null {
    return typeof window !== 'undefined' ? window.localStorage.getItem(REFRESH_KEY) : null;
  },

  set(access: string, refresh?: string): void {
    accessToken = access;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACCESS_KEY, access);
      if (refresh) window.localStorage.setItem(REFRESH_KEY, refresh);
    }
  },

  clear(): void {
    accessToken = null;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ACCESS_KEY);
      window.localStorage.removeItem(REFRESH_KEY);
    }
  },
};
