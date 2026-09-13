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
 * - **Cancelled** IS a stored state now, and a different one from `archived`:
 *   archiving hides an event nobody holds a ticket to, while cancelling calls
 *   off a live one and refunds everybody. It keeps its own badge because the
 *   two are not interchangeable — one costs money and the other does not.
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
  cancelled: { label: 'Cancelled', tone: 'danger' },
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
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'archived', label: 'Archived' },
];

/**
 * THE PHONE'S FILTER, AND WHY IT IS FOUR AND NOT NINE.
 *
 * `STATUS_FILTERS` above is the complete stored vocabulary, which is right for
 * a `<select>` on a toolbar and wrong for a row of pills on a 390px screen:
 * nine of them is a horizontal scroller, and a filter you have to scroll to
 * find is a filter nobody uses.
 *
 * These four are the LIFECYCLE — the question an organizer actually arrives
 * with ("what is on sale", "what have I not finished", "what already
 * happened"). Each is one of the SAME stored statuses and writes the SAME
 * `?status=` param, so the pills and the select are two controls over one
 * piece of state and cannot disagree.
 *
 * ── NO COUNTS ON THE PILLS ────────────────────────────────────────────────
 *
 * The reference design carries them ("Live 3", "Past 8") and this list is
 * CURSOR-paginated with no `meta.count` (BACKLOG). A count could therefore
 * only ever describe the page that happens to be loaded FOR THE ACTIVE PILL —
 * the other three filter server-side, so their rows are not in the client at
 * all and their numbers would have to be invented. The house rule is that such
 * a figure is a floor ("20+") or nothing, and a pill is far too small to carry
 * that caveat. The deck states the loaded count ONCE, above the cards, where
 * the sentence has room to say what it is counting.
 *
 * ── AND WHY A STATUS OUTSIDE THESE FOUR LIGHTS NOTHING ────────────────────
 *
 * Picking "Cancelled" from the desktop select leaves every pill unpressed,
 * which is correct: "All" is not what is showing. The active-filter chip row
 * below the pills names it and offers the clear.
 */
export const LIFECYCLE_FILTERS: { value: '' | EventStatus; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'finished', label: 'Past' },
  { value: 'draft', label: 'Drafts' },
];
