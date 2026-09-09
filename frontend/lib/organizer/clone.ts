import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * Starting a new event from one that already exists.
 *
 * ── WHAT THIS USED TO DO, AND WHY IT DOES NOT ANY MORE ───────────────────
 *
 * It called `POST /events/{id}/duplicate`, which created a server row titled
 * "Copy of ..." the instant somebody pressed the button, and then navigated to
 * the editor for it. Two things about that were wrong.
 *
 * A PRESS WROTE. Anyone exploring what Clone does got a permanent draft for
 * it, and pressing twice got two. The events list in the report that killed
 * this held a stack of them — "Copy of Copy of Copy of AURORA MUSIC AND ..." —
 * none of which anybody meant to keep, each needing its own archive to clear.
 *
 * AND IT RENAMED THE EVENT. "Copy of" is scaffolding. A copy of a monthly
 * residency IS that residency run again, and the organizer had to delete those
 * two words every single time. The name only has to be distinct where a buyer
 * would meet both at once, which the backend now checks at PUBLISH against the
 * title and the venue together — so the draft keeps the real name throughout.
 *
 * ── SO IT IS A ROUTE NOW, AND NOTHING ELSE ───────────────────────────────
 *
 * Clone navigates to the create wizard with `?from={id}`, and the wizard
 * fetches that event and pours it into a NEW draft: details, venue, category,
 * policies, highlights, tags, tiers with their phases and bands, sessions,
 * running order, FAQs and the lineup. Nothing is written until the organizer
 * saves — so a press that turns out to be a mistake costs a Back button
 * rather than a row to clean up.
 *
 * ── WHY THAT IS ONLY POSSIBLE NOW ────────────────────────────────────────
 *
 * The argument for doing the copy server-side was real when it was written:
 * the collections that make a copy worth having live in their own tables, and
 * a client prefill could carry only the scalar columns the draft model held.
 * It stopped being true when sessions, running order, FAQs and the lineup
 * became STAGED draft state, flushed on first save exactly as tiers always
 * were. See `PendingSlot` in `wizard/model.ts`.
 *
 * The one thing a client prefill still cannot carry is the GALLERY, and that
 * was never carried: an `EventMedia` row points at a stored object, so two
 * events sharing one key means deleting either one's gallery breaks the
 * other's. The poster comes across, because it is a plain column.
 */

/**
 * The ONE sentence describing what a clone brings, shown by every caller.
 *
 * A function rather than a constant so a caller can name the source event, and
 * it lives here so two buttons cannot describe one operation differently —
 * which is exactly what happened before, when the table's docstring said there
 * was no duplicate endpoint while a working button called it 300 lines below.
 */
export function describeClone(title?: string): string {
  const what = title ? `“${title}”` : 'this event';
  return `Opens a new event form already filled in from ${what} — details, venue, tickets, sessions, FAQs, running order and lineup. Nothing is saved until you save it.`;
}

/** The short form, for a button tooltip where the full sentence will not fit. */
export const CLONE_HINT = 'Start a new event pre-filled from this one — nothing is saved yet';

export type CloneOutcome = { id: string };

/**
 * Open the create wizard, pre-filled from an existing event.
 *
 * Kept as a hook with the same `{ clone, cloning }` shape the three call sites
 * already use, so none of them had to change. `cloning` is now always false —
 * there is no request to wait for — and it stays in the signature rather than
 * being removed, because a button that renders a spinner for a navigation is
 * showing a delay it invented.
 */
export function useCloneEvent() {
  const router = useRouter();

  const clone = React.useCallback(
    async (eventId: string): Promise<CloneOutcome | null> => {
      router.push(`/dashboard/events/new?from=${encodeURIComponent(eventId)}`);
      return { id: eventId };
    },
    [router],
  );

  return { clone, cloning: false };
}
