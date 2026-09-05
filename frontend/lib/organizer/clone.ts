import { useRouter } from 'next/navigation';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { isApiError } from '@/lib/api/errors';
import { duplicateEvent } from '@/lib/api/organizer-writes';
import { useInvalidateOrganizer } from '@/lib/organizer/queries';

/**
 * Copying an event, and then LANDING SOMEWHERE.
 *
 * ── THE BUG THIS EXISTS FOR ───────────────────────────────────────────────
 *
 * `POST /events/{id}/duplicate` has always worked and copies almost
 * everything. Both frontend callers then threw the answer away:
 *
 *   · the events-table bulk bar awaited the call and navigated NOWHERE, so a
 *     press produced a row somewhere in a cursor-paginated list the organizer
 *     was not looking at. Indistinguishable from a no-op.
 *   · the event panel pushed `/dashboard/events?event={newId}`, which reopens
 *     the same read-only drawer — one press from where they started, with the
 *     copy's fields nowhere on screen.
 *
 * Neither opened the editor, which is the only screen where a copy is worth
 * anything: the point of cloning a monthly residency is to change the DATE and
 * publish. So a copy now goes straight to `/dashboard/events/{id}/edit`, which
 * is the create wizard hydrated from the server — every field prefilled, every
 * one editable, the tiers and their sale phases already in the ticket builder.
 *
 * ── WHY THE EDIT ROUTE AND NOT A PREFILLED CREATE WIZARD ──────────────────
 *
 * A prefilled `/dashboard/events/new` was the obvious alternative and it is
 * worse in three ways that matter. The copy ALREADY EXISTS as a server row the
 * moment `duplicate` returns — so a create-shaped screen would have to either
 * create a second event on first save (leaving an orphan draft behind every
 * clone) or carry a hidden id and stop being the create wizard at all. The
 * server-side copy is also the only thing that can bring across the
 * collections the draft model deliberately does not hold: FAQs, running order,
 * sessions, media and the lineup live in their own tables and are copied by
 * `copy_content_to`, where a client-side prefill could only ever carry the
 * ~20 scalar columns the draft knows about. And the edit route already
 * hydrates all of it (`draftFromEvent` + the server-backed sub-editors), so
 * this is one `router.push` rather than a second hydration path to keep in
 * step with the first.
 */

/**
 * The ONE sentence describing what a copy carries, shown by every caller.
 *
 * It is a function rather than a constant so a caller can name the source
 * event, and it lives here so two buttons cannot describe one operation
 * differently — which is exactly what happened before: the table's docstring
 * said there was no duplicate endpoint while a working Duplicate button sat
 * 300 lines below it, and both wrappers' docstrings claimed the copy arrives
 * with no ticket tiers. It arrives with them.
 */
export function describeClone(title?: string): string {
  const what = title ? `“${title}”` : 'this event';
  return `${what} is copied as a new draft — details, venue, tickets, sessions, FAQs, running order and lineup all come across. Photos and the schedule are yours to change.`;
}

/** The short form, for a button tooltip where the full sentence will not fit. */
export const CLONE_HINT = 'Copy into a new draft you can edit — tickets and lineup included';

export type CloneOutcome = { id: string; title: string };

/**
 * Clone an event and open the editor for the copy.
 *
 * Returns the new event on success and `null` on failure, so a caller that
 * wants to do something extra (close a drawer, clear a selection) can tell the
 * two apart without re-deriving it from a thrown value.
 *
 * FAILURE IS SHOWN, NEVER SWALLOWED. `CloneEventButton` used to
 * `console.error` and leave the label reading "Cloning…" for ever, so a 403 on
 * somebody else's event, a 404 on a deleted one and a network drop were all
 * the same silent stall. An API error carries the server's own sentence,
 * which is more specific than anything written here; anything else is
 * network-shaped and says so.
 */
export function useCloneEvent() {
  const router = useRouter();
  const invalidate = useInvalidateOrganizer();
  const { toast } = useToast();
  const [cloning, setCloning] = React.useState(false);

  const clone = React.useCallback(
    async (eventId: string, sourceTitle?: string): Promise<CloneOutcome | null> => {
      setCloning(true);
      try {
        const copy = await duplicateEvent(eventId);
        // Invalidate BEFORE navigating: the editor reads the organizer event
        // list to resolve which organisation owns the draft, and a list that
        // predates the copy resolves nothing.
        await invalidate();
        toast({
          variant: 'success',
          title: 'Copied — now edit the copy',
          description: describeClone(sourceTitle),
        });
        router.push(`/dashboard/events/${encodeURIComponent(copy.id)}/edit`);
        return { id: copy.id, title: copy.title };
      } catch (err) {
        toast({
          variant: 'destructive',
          title: 'Could not copy this event',
          description:
            isApiError(err)
              ? err.message
              : 'The copy did not go through. Check your connection and try again.',
        });
        return null;
      } finally {
        setCloning(false);
      }
    },
    [invalidate, router, toast],
  );

  return { clone, cloning };
}
