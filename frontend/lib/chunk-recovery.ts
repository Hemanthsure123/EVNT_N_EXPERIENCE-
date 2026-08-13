/**
 * Recovery for the one error a user genuinely cannot act on: the page asking
 * for a script that no longer exists.
 *
 * ── WHY THIS IS NOT "REFRESH ON ERROR" ────────────────────────────────────
 *
 * Reloading is a terrible response to errors in general — it hides the fault,
 * loses the user's place, and turns a bug into a loop. It is the CORRECT
 * response to exactly one class: a chunk that 404s.
 *
 * Next.js splits the app into content-hashed chunks and names them in the HTML.
 * When a new build is deployed the old hashes stop existing. A browser holding
 * the previous document — from bfcache, an open tab, or a cache entry — asks
 * for a file the running image has never heard of, and React throws mid-render.
 * The application cannot repair that: the code it needs is gone. Only fetching
 * the current document can, and that is a reload.
 *
 * So the rule is narrow on both sides:
 *
 *   - it fires ONLY for a chunk/import failure, never for an API error, a
 *     render bug or anything a person could report and somebody could fix;
 *   - it fires ONCE. The guard below is a timestamp, not a boolean, because a
 *     loop is fast and a second legitimate deploy is not: two failures inside
 *     `LOOP_WINDOW_MS` means reloading did not help, so the error screen is
 *     shown instead and the loop stops there.
 *
 * The root cause is fixed separately, in `next.config.mjs` — those documents
 * are `private, no-store` now, so nothing should be holding one across a
 * deploy. This is the belt to that pair of braces, and it matters most for the
 * browsers that cached a document BEFORE that header existed.
 */

const GUARD_KEY = 'curatix:chunk-recovery-at';
const LOOP_WINDOW_MS = 30_000;

/**
 * Whether this error is a missing/failed script chunk.
 *
 * Matched on several shapes on purpose — the text differs by browser and the
 * `name` is only set by webpack's own loader, so neither alone is reliable:
 *
 *   Chrome/Edge   ChunkLoadError: Loading chunk 4821 failed.
 *   Firefox       error loading dynamically imported module
 *   Safari        Importing a module script failed.
 *   Next.js       Failed to fetch dynamically imported module: https://…/_next/…
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const name = String((error as { name?: unknown }).name ?? '');
  if (name === 'ChunkLoadError') return true;

  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  if (!message) return false;

  return (
    message.includes('loading chunk') ||
    message.includes('loading css chunk') ||
    message.includes('dynamically imported module') ||
    message.includes('importing a module script failed') ||
    (message.includes('failed to fetch') && message.includes('_next/static'))
  );
}

/**
 * Whether a reload is allowed right now, recording the attempt if it is.
 *
 * Split from the reload itself so the loop guard is testable without a
 * `window.location` stub, which is the part that actually needs proving: this
 * must never be able to reload twice in a row.
 */
export function shouldAttemptChunkReload(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  now: number,
): boolean {
  if (!storage) return false;

  let previous: string | null = null;
  try {
    previous = storage.getItem(GUARD_KEY);
  } catch {
    // Safari in private mode throws on storage access. With no way to record
    // an attempt there is no way to prevent a second one, so decline: an error
    // screen the user can retry beats a page that might reload forever.
    return false;
  }

  const last = previous ? Number(previous) : NaN;
  if (Number.isFinite(last) && now - last < LOOP_WINDOW_MS) return false;

  try {
    storage.setItem(GUARD_KEY, String(now));
  } catch {
    return false;
  }
  return true;
}
