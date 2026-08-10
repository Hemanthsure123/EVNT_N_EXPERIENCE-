/**
 * The signed-in person's own profile — today, just their picture.
 *
 * TWO endpoints, one resource (`apps/accounts/urls.py`):
 *
 *   POST   /auth/me/avatar   multipart, field `file`  → the whole profile
 *   DELETE /auth/me/avatar                           → the whole profile
 *
 * BOTH answer with the full `UserSerializer` payload rather than 204 or just
 * the URL, and the view says why: the caller holds a cached user object, so
 * handing back the same shape `/auth/me` returns lets it replace that object
 * outright instead of patching one field into it. `avatarUrlOf` is therefore
 * the only reader of the field, and `useAuth().applyProfile` is the only
 * writer of the cached user — there is no second source of truth for "who is
 * signed in".
 *
 * There is deliberately NO read endpoint: `avatar_url` rides on the profile
 * every screen already has, so showing a picture costs no round trip.
 */

import { api } from './client';
import { API_BASE_URL } from './config';
import { ApiError } from './errors';
import { tokenStore } from './token-store';
import type { Gender, User } from './types';

const AVATAR_PATH = '/auth/me/avatar';

/**
 * The profile as the SERVER returns it.
 *
 * `UserSerializer` has carried `avatar_url` since `apps/accounts` grew the two
 * endpoints above; `User` in `lib/api/types.ts` has not caught up yet. Declared
 * here so the field exists in exactly one place, and OPTIONAL so a plain `User`
 * is still assignable — when it lands on `User` this collapses to a no-op and
 * no call site changes.
 *
 * Empty string means "no picture", which is what the column stores. It is never
 * null, and the fallback is initials rather than a stock silhouette.
 */
export type ProfileUser = User & { avatar_url?: string };

/* ------------------------------------------------------------------ reading */

/**
 * Absolute URL for something the backend's storage returned, or `''`.
 *
 * `LocalStorageAdapter` (STORAGE_BACKEND=local) returns a ROOT-RELATIVE
 * `/media/...` path, which a browser would resolve against the SITE origin —
 * so with the API on another origin every avatar would 404 against Next.
 * S3/R2/Supabase adapters return an absolute URL, which is passed through
 * untouched. `next.config.mjs`'s remotePatterns already allow both hosts
 * (`NEXT_PUBLIC_API_BASE_URL` + `/media/**`, and `NEXT_PUBLIC_MEDIA_BASE_URL`),
 * so nothing there needs to change — but next/image silently refuses any host
 * NOT on that list, one image at a time, which is why this resolves to the API
 * origin rather than guessing.
 */
export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Absolute or protocol-relative: the storage adapter already published a
  // public URL and rewriting it would break exactly the deployments that work.
  if (/^(https?:)?\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** The picture to render for a profile, or `''` for "fall back to initials". */
export const avatarUrlOf = (user: ProfileUser | null | undefined): string =>
  resolveMediaUrl(user?.avatar_url);

/* ------------------------------------------------------------------ writing */

/**
 * Mirrors `core.uploads` (`MAX_IMAGE_BYTES`, `ALLOWED_IMAGE_TYPES`) so the
 * ordinary mistakes cost no round trip. The SERVER remains the authority: it
 * also checks the file's LEADING BYTES against the declared type, which a
 * browser cannot do, and its message is what surfaces on a real failure.
 */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_AVATAR_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
];

/** For an `<input type="file">`'s `accept`, so the picker filters too. */
export const AVATAR_ACCEPT = ACCEPTED_AVATAR_TYPES.join(',');

/**
 * A plain sentence naming what is wrong with this file, or `null`.
 *
 * The checks run in the SERVER'S ORDER (empty, then size, then type) so the
 * message somebody gets instantly is the message the server would have given —
 * two different explanations for one file is how a user concludes the limit is
 * arbitrary.
 *
 * SVG gets its own sentence because it is the one refusal that looks like a
 * bug: it IS an image everywhere else on the web. `ProfileService.set_avatar`
 * explains the reason — an avatar is the single most widely rendered
 * user-supplied image on the platform, and an SVG is an XML document that can
 * carry script, so serving one back from our own origin is stored XSS. Saying
 * "not supported" and stopping would invite somebody to add it back.
 */
export function checkAvatarFile(file: File): string | null {
  if (file.size === 0) return 'That file is empty.';
  if (file.size > AVATAR_MAX_BYTES) {
    const megabytes = (file.size / (1024 * 1024)).toFixed(1);
    return `That image is ${megabytes} MB — the limit is 10 MB. Try exporting it at a lower quality.`;
  }
  if (file.type === 'image/svg+xml') {
    return (
      'SVG pictures are not accepted. An SVG is a document that can contain code, ' +
      'and your picture is shown on every page you appear on — export it as a PNG instead.'
    );
  }
  if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
    return 'That file type is not supported. Choose a JPEG, PNG, WebP, AVIF or GIF.';
  }
  return null;
}

export type AvatarUploadHandle = {
  /** Resolves with the FULL refreshed profile, ready for `applyProfile`. */
  promise: Promise<ProfileUser>;
  /** Aborts in flight. The row is only pointed at bytes the server stored. */
  cancel: () => void;
};

/** True when this rejection is the caller's own `cancel()`, not a failure. */
export const isUploadCancelled = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'cancelled';

/**
 * Set the profile picture, with real progress and a real cancel.
 *
 * `XMLHttpRequest` rather than `fetch`, for the one documented reason this
 * codebase uses it (see the event studio's media step): `fetch` has no
 * upload-progress event, and a spinner that cannot say "40%" is the difference
 * between "it is working" and "it has frozen". Cancel aborts the request rather
 * than hiding a row that keeps uploading.
 *
 * The URL is built from `API_BASE_URL`, exactly as `client.ts` builds
 * `API_ROOT`. The sibling uploaders open a same-origin `/api/v1/...` path,
 * which only works where something proxies the API onto the site origin —
 * nothing in this app does (there are no rewrites and no route handler).
 *
 * One thing this cannot borrow from `apiFetch`: its transparent
 * refresh-on-401. A stale access token surfaces as a 401 here, and the auth
 * provider's next `/auth/me` is what resolves it — re-uploading the bytes
 * behind the user's back would be worse than telling them to try again.
 */
export function uploadAvatar(
  file: File,
  onProgress?: (percent: number) => void,
): AvatarUploadHandle {
  const form = new FormData();
  // `file` is the field name `MeAvatarView` reads; anything else is a 400.
  form.append('file', file);

  const request = new XMLHttpRequest();
  const promise = new Promise<ProfileUser>((resolve, reject) => {
    request.open('POST', `${API_BASE_URL}/api/v1${AVATAR_PATH}`);
    const token = tokenStore.getAccess();
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
    // No `Content-Type`: the browser must set the multipart boundary itself.

    request.upload.addEventListener('progress', (event) => {
      // `lengthComputable` is false for a chunked body; reporting 0 forever
      // would be worse than reporting nothing, so the caller keeps whatever
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
        resolve(parsed as ProfileUser);
        return;
      }
      // The server's own message, in the same envelope `ApiError` normalises
      // everywhere else — it is written to be acted on ("that image is 14.2 MB,
      // the limit is 10 MB") in a way nothing here could invent.
      const envelope = parsed as { error?: { code?: string; message?: string } } | null;
      reject(
        new ApiError(
          request.status,
          envelope?.error?.code ?? 'upload_failed',
          envelope?.error?.message ?? 'That upload did not go through.',
          {},
        ),
      );
    });

    request.addEventListener('error', () =>
      reject(new ApiError(0, 'network_error', 'The connection dropped during the upload.', {})),
    );
    request.addEventListener('abort', () =>
      reject(new ApiError(0, 'cancelled', 'Upload cancelled.', {})),
    );

    request.send(form);
  });

  return { promise, cancel: () => request.abort() };
}

/**
 * Remove the profile picture.
 *
 * Plain `fetch` through the shared client: there is nothing to upload, so there
 * is no progress to report. Returns the refreshed profile with `avatar_url`
 * empty, which is what makes the picture visibly return to initials everywhere.
 */
export const removeAvatar = () => api.delete<ProfileUser>(AVATAR_PATH);

/* ------------------------------------------------------------------ writing */

/**
 * Everything a person can change about themselves.
 *
 * PARTIAL BY OMISSION. A key that is absent leaves the column alone; a key
 * that is present with an empty value CLEARS it. Those cannot be conflated —
 * removing a phone number is how somebody opts out of SMS, and clearing a
 * gender answer back to "never said" is a different act from declining.
 *
 * `date_of_birth` is the one field where `null` is the real empty value rather
 * than `''`, because it is a date. The server uses a sentinel internally for
 * exactly that reason.
 *
 * There is deliberately NO `email`. The address is the sign-in identity and
 * the destination every ticket is delivered to, so changing it is a
 * re-verification flow, not a profile field — allowing it here would let an
 * account be moved to an address its holder does not control.
 */
export type ProfileUpdate = {
  full_name?: string;
  phone?: string;
  date_of_birth?: string | null;
  gender?: Gender | '';
  gender_self_described?: string;
};

export const updateProfile = (changes: ProfileUpdate) =>
  api.patch<ProfileUser>('/auth/me', changes);

/**
 * Mark the welcome flow answered — filled in, or skipped.
 *
 * A separate call from the profile PATCH because the two say different things:
 * a PATCH says "this is my name", this says "stop asking me". Folding the mark
 * into the PATCH would mean the only way to record a skip is to send an empty
 * edit, so a skip would look identical to a request that never arrived.
 *
 * It carries no body: everything the flow collects goes through `updateProfile`,
 * which already validates every field. A second write path for the same columns
 * would be a second place for the date-of-birth rules to live.
 */
export const completeOnboarding = () => api.post<ProfileUser>('/auth/me/onboarding', {});

/**
 * Whether to open the welcome flow for this person.
 *
 * THREE conditions, and each rules out a case where showing it would be wrong:
 * there has to BE somebody, they have to have proven their address (the flow
 * sits after verification, not beside it), and they must not have answered it
 * already — where "answered" includes having skipped.
 */
export function needsOnboarding(user: ProfileUser | null | undefined): boolean {
  if (!user) return false;
  if (!user.email_verified) return false;
  return user.onboarding_completed_at === null;
}
