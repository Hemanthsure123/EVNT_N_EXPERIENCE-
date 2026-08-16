import { api } from './client';
import type { Paginated } from './types';

/**
 * The Hire a Band marketplace (`/api/v1/performers`, `/me/performers`, `/hire`).
 *
 * ── THREE AUDIENCES, THREE CACHE POSTURES ─────────────────────────────────
 *
 * The browse and the profile are identical for every visitor and are
 * edge-cached, exactly like the public events surface — safe to fetch during a
 * server render. Everything under `/me` and `/hire` is per-person and
 * `private, no-store`; those run in the browser against a token.
 *
 * ── MONEY IS MINOR UNITS ──────────────────────────────────────────────────
 *
 * As everywhere else in this API. `base_price_minor` is NULLABLE and null is
 * meaningful: it means "price on ask", which is a real answer some acts give.
 * The UI says so rather than rendering a zero, and a budget filter deliberately
 * still includes them — hiding every unpriced act from a budgeted search would
 * quietly remove the expensive end of the market from the marketplace.
 *
 * ── THERE IS NO RATING FIELD, AND THAT IS DELIBERATE ──────────────────────
 *
 * Nothing on this platform stores a review, so a star count would be a number
 * with nothing behind it. Profiles show experience, verification and past work
 * instead — each backed by a real column. BACKLOG "Performer reviews and
 * ratings" specifies the model it would need.
 */

export type PerformerType =
  | 'band'
  | 'singer'
  | 'dj'
  | 'instrumentalist'
  | 'anchor'
  | 'comedian'
  | 'dance_crew'
  | 'magician'
  | 'other';

export type PerformerStatus =
  | 'draft'
  | 'pending_review'
  | 'rejected'
  | 'live'
  | 'paused'
  | 'archived';

export type Occasion =
  | 'wedding'
  | 'birthday'
  | 'corporate'
  | 'college_fest'
  | 'private_party'
  | 'festival'
  | 'other';

export type VerifiedLevel = 'unverified' | 'pending' | 'verified';

/** The browse grid. Deliberately small — this is the highest-volume payload. */
export type PerformerCard = {
  id: string;
  stage_name: string;
  performer_type: PerformerType;
  tagline: string;
  city: string;
  travel_radius_km: number;
  /** Null means "price on ask". Never render it as zero. */
  base_price_minor: number | null;
  genres: string[];
  languages: string[];
  experience_years: number;
  is_featured: boolean;
  organization_id: string;
  organization_name: string;
  /** The ORGANISATION's verification, reused wholesale — same legal entity. */
  verified_level: VerifiedLevel;
  photo_url: string;
  photo_alt: string;
};

export type PerformerPhoto = {
  id: string;
  url: string;
  alt_text: string;
  caption: string;
  position: number;
};

export type PerformerDetail = PerformerCard & {
  bio: string;
  occasions: Occasion[];
  typical_set_minutes: number | null;
  website_url: string;
  instagram_url: string;
  youtube_url: string;
  created_at: string;
  photos: PerformerPhoto[];
};

/** The owner's own view — drafts, the version and the operator's note. */
export type OwnerPerformer = {
  id: string;
  stage_name: string;
  performer_type: PerformerType;
  tagline: string;
  bio: string;
  city: string;
  travel_radius_km: number;
  base_price_minor: number | null;
  genres: string[];
  languages: string[];
  occasions: Occasion[];
  experience_years: number;
  typical_set_minutes: number | null;
  website_url: string;
  instagram_url: string;
  youtube_url: string;
  status: PerformerStatus;
  is_featured: boolean;
  /** Send back what you read — the optimistic lock refuses a stale one. */
  version: number;
  submitted_at: string | null;
  moderated_at: string | null;
  /** The LAST decision's reason. Cleared on resubmission, deliberately. */
  moderation_note: string;
  organization_id: string;
  organization_name: string;
  verified_level: VerifiedLevel;
  created_at: string;
  /**
   * The whole gallery, not a cover.
   *
   * On the OWNER payload because the studio cannot manage what it cannot see:
   * the public detail carries photos but 404s for anything unapproved, so
   * without this an owner could upload a photo and never see it again while
   * their profile was still a draft.
   */
  photos: PerformerPhoto[];
};

export type MarketplaceFilters = {
  q?: string;
  type?: PerformerType | '';
  city?: string;
  /** Minor units. Acts with no listed price are still included. */
  budget_max?: string;
  language?: string;
  genre?: string;
  occasion?: Occasion | '';
  min_experience?: string;
  /** 'true' for verified organisations only. */
  verified?: string;
  featured?: string;
  cursor?: string;
};

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

/** Matches the backend's `s-maxage` on the public marketplace reads. */
export const MARKETPLACE_REVALIDATE_SECONDS = 60;

export const fetchPerformers = (
  params: MarketplaceFilters = {},
  opts: { revalidate?: number } = {},
) =>
  api.get<Paginated<PerformerCard>>(`/performers${query(params)}`, {
    auth: false,
    ...(opts.revalidate !== undefined ? { next: { revalidate: opts.revalidate } } : {}),
  });

/** One `/sitemap.xml` row for a performer profile. */
export type PerformerSitemapEntry = { id: string; updated_at: string };

/**
 * Every published performer URL, for `app/sitemap.ts`.
 *
 * NEVER THROWS, for the same reason `fetchEventSitemapSafe` does not: an
 * exception in `sitemap.ts` does not drop these entries, it takes
 * `/sitemap.xml` down entirely.
 *
 * An empty array is a perfectly good answer and the current one — nothing is
 * published yet — and the sitemap then carries no performer URLs at all rather
 * than inventing any.
 */
export async function fetchPerformerSitemapSafe(): Promise<PerformerSitemapEntry[]> {
  try {
    const page = await api.get<{ data: PerformerSitemapEntry[] }>('/performers/sitemap', {
      auth: false,
      next: { revalidate: 3600 },
    });
    return page.data ?? [];
  } catch {
    return [];
  }
}

/**
 * The published acts, for the public `/hire` page.
 *
 * NEVER THROWS and returns `[]` on failure — `/hire` is primarily the enquiry
 * form, and a listing that cannot load must not take the form down with it.
 */
export async function fetchPerformersSafe(
  params: MarketplaceFilters = {},
): Promise<PerformerCard[]> {
  try {
    const page = await fetchPerformers(params, { revalidate: MARKETPLACE_REVALIDATE_SECONDS });
    return page.data ?? [];
  } catch {
    return [];
  }
}

export const fetchPerformerDetail = (performerId: string, opts: { revalidate?: number } = {}) =>
  api.get<PerformerDetail>(`/performers/${encodeURIComponent(performerId)}`, {
    auth: false,
    next: { revalidate: opts.revalidate ?? MARKETPLACE_REVALIDATE_SECONDS },
  });

/**
 * What the filter panel may offer.
 *
 * DERIVED from live performers server-side, so a genre nobody performs never
 * appears as a filter that returns nothing. That is why it is an endpoint
 * rather than a constant in this file.
 */
export type MarketplaceFacets = { cities: string[]; genres: string[]; languages: string[] };

export const fetchMarketplaceFacets = (opts: { revalidate?: number } = {}) =>
  api.get<MarketplaceFacets>('/performers/facets', {
    auth: false,
    next: { revalidate: opts.revalidate ?? MARKETPLACE_REVALIDATE_SECONDS },
  });

/*
 * `fetchPerformersSafe` lived here — a never-throwing server read whose one
 * caller was the landing page's Hire a Band rail, so that a marketplace blip
 * could not take the front page down. That rail is gone (see
 * `components/hire/hire-a-band-section.tsx`) and the helper went with it
 * rather than staying as an export whose own docstring described a caller
 * that no longer exists. Bring it back with whatever needs it next: the
 * pattern is a `try/catch` around `fetchPerformers` returning `[]`.
 */

/* ------------------------------------------------------------ owner side */

export const fetchMyPerformers = (params: { cursor?: string } = {}) =>
  api.get<Paginated<OwnerPerformer>>(`/me/performers${query(params)}`);

export const fetchMyPerformer = (performerId: string) =>
  api.get<OwnerPerformer>(`/me/performers/${encodeURIComponent(performerId)}`);

export type CreatePerformerInput = {
  organization_id: string;
  stage_name: string;
  performer_type: PerformerType;
  city: string;
  tagline?: string;
  bio?: string;
  travel_radius_km?: number;
  base_price_minor?: number | null;
  genres?: string[];
  languages?: string[];
  occasions?: string[];
  experience_years?: number;
  typical_set_minutes?: number | null;
  website_url?: string;
  instagram_url?: string;
  youtube_url?: string;
};

export const createPerformer = (input: CreatePerformerInput) =>
  api.post<OwnerPerformer>('/me/performers', input);

export type UpdatePerformerInput = Partial<Omit<CreatePerformerInput, 'organization_id'>> & {
  version: number;
};

export const updatePerformer = (performerId: string, input: UpdatePerformerInput) =>
  api.patch<OwnerPerformer>(`/me/performers/${encodeURIComponent(performerId)}`, input);

/**
 * What still stands between this draft and a submission.
 *
 * Its own endpoint so the studio can show the list BEFORE the owner presses
 * submit. Discovering the requirements from a rejected request is a round trip
 * through a human for nothing.
 */
export type Readiness = { ready: boolean; problems: string[] };

export const fetchPerformerReadiness = (performerId: string) =>
  api.get<Readiness>(`/me/performers/${encodeURIComponent(performerId)}/readiness`);

export const submitPerformer = (performerId: string) =>
  api.post<OwnerPerformer>(`/me/performers/${encodeURIComponent(performerId)}/submit`, {});

export const setPerformerPaused = (performerId: string, paused: boolean) =>
  api.post<OwnerPerformer>(`/me/performers/${encodeURIComponent(performerId)}/pause`, { paused });

export const removePerformerPhoto = (performerId: string, mediaId: string) =>
  api.delete<void>(
    `/me/performers/${encodeURIComponent(performerId)}/photos/${encodeURIComponent(mediaId)}`,
  );

/* ---------------------------------------------------------- customer side */

export type RequestStatus = 'open' | 'booked' | 'cancelled' | 'expired';

export type BookingRequest = {
  id: string;
  performer_type: PerformerType;
  occasion: Occasion;
  city: string;
  event_date: string;
  budget_min_minor: number;
  budget_max_minor: number;
  guests: number | null;
  notes: string;
  status: RequestStatus;
  quote_count: number;
  booked_performer_id: string | null;
  booked_performer_name: string;
  created_at: string;
};

export type CreateBookingRequestInput = {
  performer_type: PerformerType;
  occasion: Occasion;
  city: string;
  /** `yyyy-mm-dd`. A DateField, not an instant — a booking is for a day. */
  event_date: string;
  budget_min_minor: number;
  budget_max_minor: number;
  guests?: number | null;
  notes?: string;
};

export const fetchMyRequests = (params: { cursor?: string } = {}) =>
  api.get<Paginated<BookingRequest>>(`/hire/requests${query(params)}`);

export const fetchRequest = (requestId: string) =>
  api.get<BookingRequest>(`/hire/requests/${encodeURIComponent(requestId)}`);

export const createBookingRequest = (input: CreateBookingRequestInput) =>
  api.post<BookingRequest>('/hire/requests', input);

export const cancelBookingRequest = (requestId: string) =>
  api.delete<BookingRequest>(`/hire/requests/${encodeURIComponent(requestId)}`);

export type QuoteStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';

/** A quote as the CUSTOMER sees it — with the performer attached. */
export type Quote = {
  id: string;
  request_id: string;
  amount_minor: number;
  message: string;
  status: QuoteStatus;
  created_at: string;
  performer_id: string;
  performer_name: string;
  performer_type: PerformerType;
  performer_city: string;
  performer_experience_years: number;
  organization_name: string;
  verified_level: VerifiedLevel;
};

export const fetchRequestQuotes = (requestId: string) =>
  api.get<{ data: Quote[] }>(`/hire/requests/${encodeURIComponent(requestId)}/quotes`);

export const acceptQuote = (quoteId: string) =>
  api.post<Quote>(`/hire/quotes/${encodeURIComponent(quoteId)}/accept`, {});

/* ------------------------------------------------------- performer leads */

/**
 * An open brief, as a performer sees it.
 *
 * Carries NOTHING identifying the customer — a brief is a job to bid on, and
 * the customer's name and contact details are not the performer's to have
 * until they are hired. That omission is enforced server-side, not here.
 */
export type OpenRequest = {
  id: string;
  performer_type: PerformerType;
  occasion: Occasion;
  city: string;
  event_date: string;
  budget_min_minor: number;
  budget_max_minor: number;
  guests: number | null;
  notes: string;
  quote_count: number;
  created_at: string;
};

/** A quote as the PERFORMER sees it — with the brief attached. */
export type PerformerQuote = {
  id: string;
  request_id: string;
  amount_minor: number;
  message: string;
  status: QuoteStatus;
  created_at: string;
  request_city: string;
  request_occasion: Occasion;
  request_event_date: string;
  request_status: RequestStatus;
};

export const fetchPerformerLeads = (performerId: string, params: { cursor?: string } = {}) =>
  api.get<Paginated<OpenRequest>>(
    `/me/performers/${encodeURIComponent(performerId)}/leads${query(params)}`,
  );

export const fetchPerformerQuotes = (performerId: string) =>
  api.get<{ data: PerformerQuote[] }>(`/me/performers/${encodeURIComponent(performerId)}/quotes`);

export const submitQuote = (
  requestId: string,
  input: { performer_id: string; amount_minor: number; message?: string },
) => api.post<PerformerQuote>(`/hire/requests/${encodeURIComponent(requestId)}/quotes`, input);

export const withdrawQuote = (quoteId: string) =>
  api.post<PerformerQuote>(`/hire/quotes/${encodeURIComponent(quoteId)}/withdraw`, {});

/* --------------------------------------------------------------- admin */

export const fetchPerformerQueue = (params: { status?: PerformerStatus; cursor?: string } = {}) =>
  api.get<Paginated<OwnerPerformer>>(`/admin/performers${query(params)}`);

export const moderatePerformer = (performerId: string, approve: boolean, note = '') =>
  api.post<OwnerPerformer>(`/admin/performers/${encodeURIComponent(performerId)}/moderate`, {
    approve,
    note,
  });

export const setPerformerFeatured = (performerId: string, featured: boolean) =>
  api.post<OwnerPerformer>(`/admin/performers/${encodeURIComponent(performerId)}/feature`, {
    featured,
  });

/* ------------------------------------------------------------- display */

export const PERFORMER_TYPE_LABELS: Record<PerformerType, string> = {
  band: 'Band',
  singer: 'Singer',
  dj: 'DJ',
  instrumentalist: 'Instrumentalist',
  anchor: 'Anchor',
  comedian: 'Stand-up',
  dance_crew: 'Dance crew',
  magician: 'Magician',
  other: 'Other',
};

export const OCCASION_LABELS: Record<Occasion, string> = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  corporate: 'Corporate',
  college_fest: 'College fest',
  private_party: 'Private party',
  festival: 'Festival',
  other: 'Other',
};

/* ------------------------------------------------------- photo upload */

import { tokenStore } from './token-store';
import { ApiError } from './errors';

/**
 * Upload a photo, with real progress and a real cancel.
 *
 * `XMLHttpRequest` rather than `fetch` for the same reason the event studio
 * uses it: `fetch` has no upload-progress event, and a six-megabyte photo on a
 * hotel connection is fifteen seconds of nothing. A spinner that cannot say
 * "40%" is the difference between "it is working" and "it has frozen".
 *
 * Mirrors `core.uploads` so the common mistakes cost no round trip — but the
 * SERVER remains the real check, including the byte-signature test that a
 * client cannot do.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_PHOTO_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
];

export type PhotoUploadHandle = {
  promise: Promise<PerformerPhoto>;
  /** Aborts in flight. The server never sees a partial object. */
  cancel: () => void;
};

export function uploadPerformerPhoto(
  performerId: string,
  input: { file: File; altText: string; caption?: string; position?: number },
  onProgress?: (percent: number) => void,
): PhotoUploadHandle {
  const form = new FormData();
  form.append('file', input.file);
  form.append('alt_text', input.altText);
  form.append('caption', input.caption ?? '');
  form.append('position', String(input.position ?? 0));

  const request = new XMLHttpRequest();
  const promise = new Promise<PerformerPhoto>((resolve, reject) => {
    request.open('POST', `/api/v1/me/performers/${encodeURIComponent(performerId)}/photos`);
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
        resolve(parsed as PerformerPhoto);
        return;
      }
      // The server's own message — it is written to be acted on ("that image
      // is 14.2 MB, the limit is 10 MB").
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

/** Client-side pre-checks, mirroring `core.uploads`. */
export function checkPhoto(file: File): string | null {
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
    return `${file.name} is not a supported image. Use JPEG, PNG, WebP, AVIF or GIF.`;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 10 MB.`;
  }
  return null;
}
