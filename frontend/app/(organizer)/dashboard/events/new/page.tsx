import * as React from 'react';
import type { Metadata } from 'next';
import { EventWizard } from '@/components/organizer/wizard/event-wizard';

export const metadata: Metadata = { title: 'Create event' };

/**
 * The wizard is a client component from its root: it is an editor, and every
 * part of it (autosave, undo, the live preview, drag-to-reorder) depends on
 * state that only exists in the browser. There is nothing here a server
 * component could usefully render — the draft does not exist on the server
 * until the organizer has typed enough for `POST /events` to accept it.
 */
export default function CreateEventPage({
  searchParams,
}: {
  searchParams?: { from?: string };
}) {
  /**
   * `?from={id}` is CLONE MODE — the same create wizard, hydrated from an
   * event that already exists instead of from an empty draft.
   *
   * A query parameter rather than a route of its own, because it is the same
   * screen doing the same thing: a second route would be a second wizard
   * mount to keep in step with this one, and the difference between them is
   * one fetch.
   *
   * An unknown or unowned id is not special-cased here. The wizard's own
   * not-available branch already answers for it, and it is the component that
   * knows what a half-loaded editor should look like.
   */
  return <EventWizard cloneFrom={searchParams?.from} />;
}
