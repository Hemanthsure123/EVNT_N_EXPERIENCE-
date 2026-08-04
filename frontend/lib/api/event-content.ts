import { api } from './client';

/**
 * Event content: media, FAQs and running order.
 *
 * ── UPLOAD IS ONE REQUEST, NOT TWO ────────────────────────────────────────
 *
 * `POST /events/{id}/media/upload` validates, stores and attaches in a single
 * multipart call. There is deliberately no "get a URL, then attach it" pair:
 * that leaks an orphaned object every time a browser closes between the steps,
 * and makes the client responsible for a URL it has no reason to hold.
 *
 * ── PROGRESS NEEDS XHR, NOT FETCH ─────────────────────────────────────────
 *
 * `fetch` has no upload-progress event. A 6 MB poster on a hotel connection is
 * fifteen seconds of nothing, and a spinner that cannot say "40%" is the
 * difference between "it is working" and "it has frozen". `uploadMedia` is
 * therefore the one call in this codebase that uses `XMLHttpRequest` — and it
 * returns an abort handle, because a cancel button that cannot actually cancel
 * is worse than no cancel button.
 */

import { tokenStore } from './token-store';
import { ApiError } from './errors';

export type MediaKind = 'hero' | 'gallery' | 'thumbnail' | 'mobile' | 'video';

export type EventMedia = {
  id: string;
  kind: MediaKind;
  url: string;
  alt_text: string;
  caption: string;
  position: number;
};

export type EventFaq = {
  id: string;
  question: string;
  answer: string;
  position: number;
};

export type TimelineKind =
  | 'doors'
  | 'opening'
  | 'session'
  | 'intermission'
  | 'main'
  | 'after_party'
  | 'closing';

export type EventTimelineEntry = {
  id: string;
  kind: TimelineKind;
  label: string;
  description: string;
  starts_at: string | null;
  position: number;
};

export type EventContent = {
  media: EventMedia[];
  faqs: EventFaq[];
  timeline: EventTimelineEntry[];
};

const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}`;

export const fetchEventContent = (eventId: string) =>
  api.get<EventContent>(`${base(eventId)}/content`);

export const addFaq = (eventId: string, input: Omit<EventFaq, 'id'>) =>
  api.post<EventFaq>(`${base(eventId)}/faqs`, input);

export const removeFaq = (eventId: string, faqId: string) =>
  api.delete<void>(`${base(eventId)}/faqs/${encodeURIComponent(faqId)}`);

export const addTimelineEntry = (eventId: string, input: Omit<EventTimelineEntry, 'id'>) =>
  api.post<EventTimelineEntry>(`${base(eventId)}/timeline`, input);

export const removeTimelineEntry = (eventId: string, entryId: string) =>
  api.delete<void>(`${base(eventId)}/timeline/${encodeURIComponent(entryId)}`);

export const removeMedia = (eventId: string, mediaId: string) =>
  api.delete<void>(`${base(eventId)}/media/${encodeURIComponent(mediaId)}`);

/** Mirrors `core.uploads` so the browser refuses what the server would. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

export type UploadHandle = {
  promise: Promise<EventMedia>;
  /** Aborts in flight. The server never sees a partial object. */
  cancel: () => void;
};

export function uploadMedia(
  eventId: string,
  input: { file: File; kind: MediaKind; altText: string; caption?: string; position?: number },
  onProgress?: (percent: number) => void,
): UploadHandle {
  const form = new FormData();
  form.append('file', input.file);
  form.append('kind', input.kind);
  form.append('alt_text', input.altText);
  form.append('caption', input.caption ?? '');
  form.append('position', String(input.position ?? 0));

  const request = new XMLHttpRequest();
  const promise = new Promise<EventMedia>((resolve, reject) => {
    request.open('POST', `/api/v1${base(eventId)}/media/upload`);
    const token = tokenStore.getAccess();
    if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);

    request.upload.addEventListener('progress', (event) => {
      // `lengthComputable` is false for chunked bodies; reporting 0 forever
      // would be worse than reporting nothing, so the caller keeps its
      // indeterminate state.
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
        resolve(parsed as EventMedia);
        return;
      }
      // Surface the server's own message — it is written to be actionable
      // ("that image is 14.2 MB, the limit is 10 MB").
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

/** Client-side pre-checks, so the common mistakes never cost a round trip. */
export function checkFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return `${file.name} is not a supported image. Use JPEG, PNG, WebP, AVIF or GIF.`;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const megabytes = (file.size / (1024 * 1024)).toFixed(1);
    return `${file.name} is ${megabytes} MB — the limit is 10 MB.`;
  }
  return null;
}

/**
 * Edit a media row after upload — alt text, caption, kind or position.
 *
 * `url` is deliberately not editable: the bytes were validated on the way in
 * (size, declared type, then the leading bytes against that type), and letting
 * a PATCH swap the address afterwards would walk straight past all three.
 * Replacing a picture means uploading a new one.
 */
export const updateMedia = (
  eventId: string,
  mediaId: string,
  changes: Partial<Pick<EventMedia, 'alt_text' | 'caption' | 'kind' | 'position'>>,
) => api.patch<EventMedia>(`${base(eventId)}/media/${encodeURIComponent(mediaId)}`, changes);

/**
 * Reorder a whole collection in ONE request.
 *
 * A per-row PATCH per move would leave the order half-applied if any single
 * call failed — the server writes every position inside one transaction, so
 * the gallery either reorders or does not.
 */
export const reorderMedia = (eventId: string, items: { id: string; position: number }[]) =>
  api.patch<{ data: EventMedia[] }>(`${base(eventId)}/media`, { items });

/** Fix a typo in a question or answer without deleting and re-adding it,
 *  which is what the studio had to offer before this existed. */
export const updateFaq = (
  eventId: string,
  faqId: string,
  changes: Partial<Pick<EventFaq, 'question' | 'answer' | 'position'>>,
) => api.patch<EventFaq>(`${base(eventId)}/faqs/${encodeURIComponent(faqId)}`, changes);

export const updateTimelineEntry = (
  eventId: string,
  entryId: string,
  changes: Partial<Pick<EventTimelineEntry, 'label' | 'description' | 'starts_at' | 'position'>>,
) =>
  api.patch<EventTimelineEntry>(
    `${base(eventId)}/timeline/${encodeURIComponent(entryId)}`,
    changes,
  );
