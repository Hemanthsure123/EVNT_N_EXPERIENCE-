import { api } from './client';
import { API_BASE_URL } from './config';

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

/**
 * One session of an event that runs more than once — a showtime.
 *
 * `label` is optional because most sessions have no name worth giving; a
 * chooser falls back to the time, which is what a buyer is picking between
 * anyway. `ends_at` is optional for the same reason it is nullable on the
 * server: an organiser who does not know when the set finishes must be able to
 * leave it out rather than invent one.
 */
export type EventSlot = {
  id: string;
  label: string;
  starts_at: string;
  ends_at: string | null;
  position: number;
  is_active: boolean;
};

export type EventContent = {
  media: EventMedia[];
  faqs: EventFaq[];
  timeline: EventTimelineEntry[];
  /**
   * ACTIVE sessions only, in the organiser's own order. Empty for the ordinary
   * single-show event, which is why every consumer treats "no slots" as the
   * normal case rather than as missing data.
   */
  slots: EventSlot[];
  /**
   * Who is taking the stage, in the organiser's own order.
   *
   * On THIS payload rather than an endpoint of its own for the same reason
   * `slots` is: the response is already edge-cached and already invalidated by
   * every content write, so a lineup costs one cached document instead of
   * another round trip before a section above the FAQs can paint.
   *
   * `[]` far more often than not — most events have no crew — and the section
   * is rendered ABSENT rather than empty in that case.
   */
  crew: EventCrewEntry[];
};

export type EventCrewEntry = {
  /** The ROSTER row's id, not the join's — the same person across events. */
  id: string;
  name: string;
  /** The per-event billing, already resolved against the roster's own role. */
  role: string;
  photo_url: string;
  photo_alt_text: string;
  position: number;
};

const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}`;

export const fetchEventContent = (eventId: string) =>
  api.get<EventContent>(`${base(eventId)}/content`);

/**
 * The organiser's session list — INCLUDING the ones switched off, unlike the
 * public content payload. The only way to bring a cancelled session back is to
 * be able to see it.
 */
export const fetchOwnerSlots = (eventId: string) =>
  api.get<EventSlot[]>(`${base(eventId)}/slots`);

export const addSlot = (
  eventId: string,
  input: { starts_at: string; label?: string; ends_at?: string | null; position?: number },
) => api.post<EventSlot>(`${base(eventId)}/slots`, input);

export const updateSlot = (
  eventId: string,
  slotId: string,
  changes: Partial<Pick<EventSlot, 'label' | 'starts_at' | 'ends_at' | 'position' | 'is_active'>>,
) => api.patch<EventSlot>(`${base(eventId)}/slots/${encodeURIComponent(slotId)}`, changes);

/**
 * Delete a session outright. The server refuses (`409 slot_in_use`) once ticket
 * tiers are attached — those tiers hold the inventory counters and, after a
 * sale, the issued tickets. Switching it off is the operation that always
 * works, and is what a cancelled session actually is.
 */
export const removeSlot = (eventId: string, slotId: string) =>
  api.delete<void>(`${base(eventId)}/slots/${encodeURIComponent(slotId)}`);

/**
 * Attach media by URL, rather than by uploading bytes.
 *
 * The route a VIDEO takes: the server normalises a pasted YouTube or Vimeo
 * link into an embed URL it builds itself from an extracted id, and refuses
 * every other host. `POST .../media/upload` is image-only and says so.
 */
export const addMedia = (eventId: string, input: Omit<EventMedia, 'id'>) =>
  api.post<EventMedia>(`${base(eventId)}/media`, input);

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
    // `API_BASE_URL` is NOT optional here, and leaving it off is why every
    // gallery and cover upload failed.
    //
    // A relative `/api/v1/...` resolves against the PAGE's origin — the Next
    // server on :3000 — not the API on :8000. Next has no such route, so it
    // answered with its own 404 HTML page. That is not JSON, the parse below
    // threw into its `catch`, and the reject fell back to the generic
    // "That upload did not go through." So a wrong URL surfaced as a message
    // that describes no cause and suggests no fix.
    //
    // Every other call goes through `lib/api/client.ts`, which prefixes
    // `API_BASE_URL` centrally; this function talks to `XMLHttpRequest`
    // directly (for upload progress, which `fetch` cannot report) and so had
    // to build its own URL. `uploadAvatar` in `profile.ts` is the same shape
    // and got it right — the two are worth reading together.
    request.open('POST', `${API_BASE_URL}/api/v1${base(eventId)}/media/upload`);
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
      //
      // The FALLBACK has to say something too. It used to be "That upload did
      // not go through." for every non-JSON response, which is what a
      // misrouted request looks like — and it hid a wrong URL for as long as
      // nobody tried an upload in a browser. When there is no envelope the
      // status code is the only fact available, so it is in the message.
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
 * ── THE SHAPE EVERY EVENT IMAGE HAS TO BE ─────────────────────────────────
 *
 * Mirrors `core.uploads.EVENT_IMAGE_SPEC`. The SERVER is authoritative — this
 * copy exists so an organiser learns about a 2:3 poster before uploading 8 MB
 * of it over a hotel wifi, not to decide anything. If the two ever disagree,
 * the server refuses and its message is what gets shown.
 *
 * 16:9 because the event page draws every picture — hero, filmstrip, lightbox
 * — in one widescreen frame, and a fixed frame can only be kept honest at the
 * door. Eventbrite, Luma and Skiddle each pin exactly one ratio for the same
 * reason.
 */
export const EVENT_IMAGE = {
  recommendedWidth: 1920,
  recommendedHeight: 1080,
  minWidth: 1280,
  minHeight: 720,
  /** 3:2 (a camera) through 2:1 (Eventbrite's banner). Anything inside loses
   *  at most about a sixth of itself to the frame. */
  minRatio: 1.5,
  maxRatio: 2.0,
} as const;

/** One sentence for the dropzone, so the rule is visible before the mistake. */
export const EVENT_IMAGE_HINT = `Landscape only — ${EVENT_IMAGE.recommendedWidth} x ${EVENT_IMAGE.recommendedHeight} (16:9) is ideal, ${EVENT_IMAGE.minWidth} x ${EVENT_IMAGE.minHeight} minimum.`;

/** The pixel size of a picked file, without putting it in the DOM. */
async function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  // `createImageBitmap` decodes off the main thread and needs no element and no
  // object URL to revoke. Safari below 17 lacks it for some types, hence the
  // fallback — and if BOTH fail we return null and let the server decide,
  // because refusing a file the browser merely could not measure would block
  // an upload that is actually fine.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

/**
 * The full pre-check: type, size, then shape.
 *
 * Shape is reported BEFORE resolution for the same reason the server does it —
 * a 1200x1800 poster fails both, and telling somebody to enlarge it sends them
 * back with a 1400x2100 poster that fails again. Scaling cannot fix a shape.
 */
export async function checkImageFile(file: File): Promise<string | null> {
  const basic = checkFile(file);
  if (basic) return basic;

  const size = await readDimensions(file);
  if (!size || size.width <= 0 || size.height <= 0) return null;

  const ratio = size.width / size.height;
  if (ratio < EVENT_IMAGE.minRatio || ratio > EVENT_IMAGE.maxRatio) {
    const shape =
      ratio < 1 ? 'taller than it is wide' : ratio < EVENT_IMAGE.minRatio ? 'close to square' : 'very wide';
    return `${file.name} is ${size.width} x ${size.height}, which is ${shape}. Event images have to be landscape — export it at ${EVENT_IMAGE.recommendedWidth} x ${EVENT_IMAGE.recommendedHeight} (16:9).`;
  }
  if (size.width < EVENT_IMAGE.minWidth || size.height < EVENT_IMAGE.minHeight) {
    return `${file.name} is ${size.width} x ${size.height} — too small. Event images need at least ${EVENT_IMAGE.minWidth} x ${EVENT_IMAGE.minHeight}.`;
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
