/**
 * Console query keys that more than one screen asks for.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * Two places read the moderation queue, and they read it in structurally
 * different ways:
 *
 *   - the attention bar (`useAdminAttention`) wants a COUNT, so it uses a
 *     plain `useQuery` and its cache entry is a `Paginated<ModerationEntry>` —
 *     `{ data, meta }`;
 *   - the queue screen (`ModerationQueue`) wants to PAGE through it, so it
 *     uses `useInfiniteQuery` and its cache entry is `{ pages, pageParams }`.
 *
 * Both were keyed `['admin', 'moderation', { status }]`. TanStack Query keys a
 * cache entry by that array alone — it has no idea one observer is infinite
 * and the other is not — so whichever mounted first decided the SHAPE of the
 * entry, and the attention bar is in the admin layout, so it always won.
 *
 * The queue screen then read `data.pages` off a `{ data, meta }` object, got
 * `undefined`, and sat on its loading skeletons forever. The failure is much
 * worse than it looks: switching tabs and coming back renders the pending
 * queue as EMPTY, so an operator concludes there is nothing to review while an
 * organizer's event waits. Every other tab worked, because only
 * `pending_review` is hard-coded in the attention bar — which is exactly what
 * made it look like a data problem rather than a caching one.
 *
 * Keeping both builders here, next to each other, is the point: the collision
 * is only invisible when the two keys are written in two files.
 *
 * Both keys still begin `['admin', 'moderation', …]`, so the existing
 * `invalidateQueries({ queryKey: ['admin'] })` and `['admin', 'moderation']`
 * calls continue to match both.
 */

import type { ModerationStatus } from '@/lib/api/admin';

export const adminQueryKeys = {
  /** The attention bar's count probe. A plain `useQuery`. */
  moderationCount: (status: ModerationStatus) =>
    ['admin', 'moderation', 'count', { status }] as const,

  /**
   * The queue screen's paginated list. A `useInfiniteQuery`.
   *
   * `filters` is part of the key because a search and a date window change
   * WHICH rows a cursor walks. Sharing one cache entry across two windows
   * would append the second window's pages onto the first window's list.
   */
  moderationQueue: (status: ModerationStatus, filters = '') =>
    ['admin', 'moderation', 'queue', { status, filters }] as const,
};
