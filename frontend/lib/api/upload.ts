import { API_BASE_URL } from './config';
import { tokenStore } from './token-store';

/**
 * One multipart upload with real progress and a real cancel.
 *
 * ── WHY `XMLHttpRequest` AND NOT `fetch` ──────────────────────────────────
 *
 * `fetch` has no upload-progress event. There is no workaround: the body is
 * consumed opaquely, so a file that takes twenty seconds on a phone connection
 * can only be shown as an indeterminate spinner. `XMLHttpRequest` reports
 * `upload.progress` and gives a real `abort()`, which is what makes a cancel
 * button mean something rather than hiding a request that is still running.
 *
 * ── WHY IT IS EXTRACTED ───────────────────────────────────────────────────
 *
 * This is the THIRD caller (`event-content.uploadMedia` and
 * `performers.uploadPerformerMedia` are the other two), and each of the
 * existing pair independently had to rediscover the same three things:
 *
 * 1. `API_BASE_URL` is NOT optional. A relative `/api/v1/...` resolves against
 *    the PAGE's origin — the Next server — not the API. Next has no such
 *    route, so it answers with its own 404 HTML, the JSON parse throws, and a
 *    wrong URL surfaces as a generic "that upload did not go through". One of
 *    the two shipped with that bug and it hid until somebody tried an upload
 *    in a browser.
 * 2. `lengthComputable` is false for chunked bodies, and reporting 0% forever
 *    is worse than reporting nothing.
 * 3. The server's own message is the actionable one ("that image is 14.2 MB,
 *    the limit is 10 MB"), and the fallback still has to say something — a
 *    status code is the only fact available when there is no envelope.
 *
 * The two existing callers are deliberately NOT migrated here in the same
 * change: they work, they are on the money-adjacent media path, and a
 * refactor of them deserves its own test run rather than riding along.
 */

export type UploadHandle<T> = {
  promise: Promise<T>;
  /** Aborts in flight. The server never sees a partial object. */
  cancel: () => void;
};

export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (percent: number) => void,
): UploadHandle<T> {
  const request = new XMLHttpRequest();

  const promise = new Promise<T>((resolve, reject) => {
    request.open('POST', `${API_BASE_URL}/api/v1${path}`);
    const token = tokenStore.getAccess();
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);

    request.upload.addEventListener('progress', (event) => {
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
      const envelope = parsed as { error?: { message?: string } } | null;
      reject(
        new Error(
          envelope?.error?.message ??
            (request.status === 0
              ? 'The upload could not reach the server.'
              : `The server rejected the upload (HTTP ${request.status}).`),
        ),
      );
    });

    request.addEventListener('error', () =>
      reject(new Error('The upload could not reach the server.')),
    );
    // A cancel is not a failure. Rejecting with a distinguishable message lets
    // a caller tell "the person pressed X" apart from "the network died",
    // which are two different things to show on screen.
    request.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

    request.send(form);
  });

  return { promise, cancel: () => request.abort() };
}
