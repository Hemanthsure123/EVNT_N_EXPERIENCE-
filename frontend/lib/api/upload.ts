import { freshAccessToken, refreshAccessToken } from './client';
import { API_BASE_URL } from './config';
import { ApiError } from './errors';
import { tokenStore } from './token-store';

/**
 * One multipart upload with real progress, a real cancel, and a LIVE TOKEN.
 *
 * ── WHY `XMLHttpRequest` AND NOT `fetch` ──────────────────────────────────
 *
 * `fetch` has no upload-progress event. There is no workaround: the body is
 * consumed opaquely, so a file that takes twenty seconds on a phone connection
 * can only be shown as an indeterminate spinner. `XMLHttpRequest` reports
 * `upload.progress` and gives a real `abort()`, which is what makes a cancel
 * button mean something rather than hiding a request that is still running.
 *
 * ── AND WHY THAT MADE EVERY UPLOAD FAIL AFTER AN HOUR ─────────────────────
 *
 * Going around `apiFetch` also went around its transparent refresh-on-401. So
 * these calls read whatever access token happened to be in the store and sent
 * it: fine for the first hour of a session, a 401 `token_not_valid` for ever
 * after, on a screen where the organizer had done nothing wrong. That is the
 * reported "Token is invalid or expired" on the Media step — the account was
 * signed in the whole time, and every other request on the page worked,
 * because every other request went through the client that refreshes.
 *
 * Two halves, and both are needed:
 *
 * 1. **Refresh BEFORE the bytes go up** when the token in hand has already
 *    expired (`freshAccessToken`). Uploading six megabytes to learn what a
 *    decoded `exp` already said is a minute of somebody's data on a phone.
 * 2. **Retry ONCE on a 401** with a forced refresh. Clock skew, a token
 *    revoked mid-upload and an `exp` this client cannot read all land here.
 *    The retry is bounded at one and only ever fires for a 401 — an upload
 *    that failed for its own reasons (too large, wrong type) is not re-sent.
 *
 * A retry re-sends the file, which is exactly what the customer asked for by
 * pressing upload; it is bounded, and the alternative is telling somebody to
 * do it by hand.
 *
 * ── ONE IMPLEMENTATION, FOUR CALLERS ──────────────────────────────────────
 *
 * `event-content.uploadMedia`, `performers.uploadPerformerPhoto`,
 * `profile.uploadAvatar` and `crew.uploadCrewPortrait` were four copies of
 * this, and the copies had drifted: one built a RELATIVE `/api/v1/...` URL
 * (which resolves against the Next origin, where no such route exists), and
 * every one of them carried the expiry bug above. They all call this now, so
 * the next fix lands in one place.
 */

export type UploadHandle<T> = {
  promise: Promise<T>;
  /** Aborts in flight. The server never sees a partial object. */
  cancel: () => void;
};

/** A 401 is the only status worth re-sending a file for. */
const UNAUTHORIZED = 401;

export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): UploadHandle<T> {
  /** The request in flight, so `cancel()` aborts the retry as well as the
   *  first attempt. */
  let active: XMLHttpRequest | null = null;
  let cancelled = false;

  const send = (token: string | null) =>
    new Promise<T>((resolve, reject) => {
      const request = new XMLHttpRequest();
      active = request;

      // `API_BASE_URL` is NOT optional. A relative `/api/v1/...` resolves
      // against the PAGE's origin — the Next server — not the API. Next has no
      // such route, so it answers with its own 404 HTML, the JSON parse throws,
      // and a wrong URL surfaces as a generic "that upload did not go through".
      request.open('POST', `${API_BASE_URL}/api/v1${path}`);
      if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
      // No `Content-Type`: the browser must set the multipart boundary itself.

      request.upload.addEventListener('progress', (event) => {
        // `lengthComputable` is false for chunked bodies, and reporting 0%
        // forever is worse than reporting nothing — the caller keeps whatever
        // indeterminate state it started with.
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      request.addEventListener('load', () => {
        let parsed: unknown = null;
        try {
          parsed = request.responseText ? JSON.parse(request.responseText) : null;
        } catch {
          parsed = null;
        }
        if (request.status >= 200 && request.status < 300) {
          resolve(parsed as T);
          return;
        }
        // The server's own message is the actionable one ("that image is
        // 14.2 MB, the limit is 10 MB"), and the fallback still has to say
        // something — a status code is the only fact available when there is
        // no envelope.
        const envelope = parsed as { error?: { code?: string; message?: string } } | null;
        const fallback =
          request.status === 0
            ? 'The upload could not reach the server.'
            : `The server rejected the upload (HTTP ${request.status}).`;
        reject(
          new ApiError(
            request.status,
            envelope?.error?.code ?? 'upload_failed',
            envelope?.error?.message ?? fallback,
            {},
          ),
        );
      });

      request.addEventListener('error', () =>
        reject(new ApiError(0, 'network_error', 'The connection dropped during the upload.', {})),
      );
      // A cancel is not a failure. A distinguishable code lets a caller tell
      // "the person pressed X" apart from "the network died", which are two
      // different things to show on screen.
      request.addEventListener('abort', () =>
        reject(new ApiError(0, 'cancelled', 'Upload cancelled.', {})),
      );

      request.send(form);
    });

  const promise = (async () => {
    const token = await freshAccessToken();
    if (cancelled) throw new ApiError(0, 'cancelled', 'Upload cancelled.', {});
    try {
      return await send(token);
    } catch (thrown) {
      const refused = thrown instanceof ApiError && thrown.status === UNAUTHORIZED;
      if (!refused || cancelled || !tokenStore.getRefresh()) throw thrown;
      // The server disagreed with what the decoded expiry said. It is the one
      // that decides, so take its answer, refresh for real, and send once more.
      const refreshed = await refreshAccessToken();
      if (!refreshed || cancelled) throw thrown;
      return await send(tokenStore.getAccess());
    }
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      // Null before the first `open`, and `abort()` on an unsent request is a
      // no-op that fires no event — hence the flag, which is what rejects a
      // cancel pressed while the refresh is still in flight.
      active?.abort();
    },
  };
}
