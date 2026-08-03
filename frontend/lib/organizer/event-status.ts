import type { EventRow, EventStatus } from '@/lib/api/organizer';
import type { Tone } from '@/components/organizer/primitives';

/**
 * The badge an event row shows, and the colour it gets.
 *
 * The brief asked for eight badges: Draft, Review, Published, Live, Selling
 * Fast, Sold Out, Completed, Cancelled. Five of those map to `Event.status`,
 * which is the stored column. The other three do not exist as states and are
 * handled honestly rather than faked:
 *
 * - **Selling fast / Sold out** are DERIVED here from the authoritative tier
 *   counters (`capacity` and `sold`), so they are real — an event is sold out
 *   when nothing is left, and selling fast when ≥85% has gone. They are shown
 *   INSTEAD of "Live", because a live event that is sold out is more usefully
 *   described by the second fact.
 * - **Review** is now real: `pending_review` is a stored state, reached by
 *   publishing, and cleared by a platform operator approving or rejecting.
 *   `rejected` shows as "Changes requested" because that is what it means to
 *   an organizer — the note explains what to fix, and resubmitting is one
 *   button.
 * - **Cancelled** is not an `EventStatus`; the closest stored state is
 *   `archived`, which is what an organizer sees.
 *
 * The threshold is a constant here rather than sprinkled through components,
 * so "selling fast" means the same thing on every screen.
 */

export const SELLING_FAST_RATIO = 0.85;

export type EventBadge = { label: string; tone: Tone };

const BY_STATUS: Record<EventStatus, EventBadge> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_review: { label: 'Pending approval', tone: 'info' },
  rejected: { label: 'Changes requested', tone: 'danger' },
  live: { label: 'Published', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  finished: { label: 'Completed', tone: 'info' },
  archived: { label: 'Archived', tone: 'neutral' },
};

export function eventBadge(row: Pick<EventRow, 'status' | 'capacity' | 'sold'>): EventBadge {
  if (row.status === 'live' && row.capacity > 0) {
    if (row.sold >= row.capacity) return { label: 'Sold out', tone: 'danger' };
    if (row.sold / row.capacity >= SELLING_FAST_RATIO) {
      return { label: 'Selling fast', tone: 'warning' };
    }
  }
  return BY_STATUS[row.status] ?? { label: row.status, tone: 'neutral' };
}

/** The filter dropdown's options — stored statuses only, since that is what
 * the API filters on. Deriving a "sold out" filter would need a server-side
 * comparison the endpoint does not offer (BACKLOG). */
export const STATUS_FILTERS: { value: '' | EventStatus; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'live', label: 'Published' },
  { value: 'pending_review', label: 'Pending approval' },
  { value: 'rejected', label: 'Changes requested' },
  { value: 'draft', label: 'Draft' },
  { value: 'paused', label: 'Paused' },
  { value: 'finished', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];
