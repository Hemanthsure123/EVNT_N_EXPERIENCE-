/**
 * Reading a JWT's expiry, and NOTHING else.
 *
 * ── WHY THE CLIENT LOOKS AT ALL ───────────────────────────────────────────
 *
 * `apiFetch` already refreshes transparently ON a 401: it sends, is refused,
 * refreshes and re-sends. That is the right trade for a JSON request, where
 * the doomed attempt costs a few hundred bytes.
 *
 * It is the wrong trade for an UPLOAD. A 6 MB poster on a phone connection is
 * a minute of somebody's data spent before the server says the token expired,
 * and the retry spends it again. Knowing the token is dead BEFORE the bytes go
 * up turns that into one refresh request. Hence this file.
 *
 * ── IT IS NOT A SECURITY CHECK, AND MUST NEVER BECOME ONE ─────────────────
 *
 * The payload is base64url, not a signature check — anything here is a CLAIM
 * by whoever holds the token, which is this browser. It decides only whether
 * to refresh early. The SERVER decides whether a token is valid, every time,
 * and a malformed or unreadable token answers `null` so the caller falls back
 * to sending what it has and letting the server rule.
 */

/** Seconds of headroom. A token about to expire mid-upload is treated as
 *  already expired: the clock here and the clock at the server are not the
 *  same clock, and a minute of slack costs one refresh at most. */
export const TOKEN_EXPIRY_SKEW_SECONDS = 60;

/** The `exp` claim in epoch SECONDS, or null when it cannot be read. */
export function tokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    // base64url -> base64. `atob` rejects `-`/`_`, and a payload whose length
    // is not a multiple of four needs its padding back.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = typeof atob === 'function' ? atob(padded) : '';
    const claims = JSON.parse(decoded) as { exp?: unknown };
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp : null;
  } catch {
    return null;
  }
}

/**
 * Would this token be refused for being expired?
 *
 * `false` for a token with no readable `exp` — unreadable is not the same as
 * expired, and treating it as expired would refresh on every single upload for
 * any future token format this function does not understand.
 */
export function tokenIsExpired(token: string | null | undefined, now = Date.now()): boolean {
  const exp = tokenExpiry(token);
  if (exp === null) return false;
  return exp * 1000 - TOKEN_EXPIRY_SKEW_SECONDS * 1000 <= now;
}
