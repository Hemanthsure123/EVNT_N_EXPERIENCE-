import * as React from 'react';
import type { Metadata } from 'next';
import { EventWizard } from '@/components/organizer/wizard/event-wizard';

export const metadata: Metadata = { title: 'Edit event' };

/**
 * Editing an event that already exists.
 *
 * ── THE SAME WIZARD, NOT A SECOND ONE ────────────────────────────────────
 *
 * `PATCH /events/{id}` has always worked, with optimistic locking, and the
 * wizard's save engine has always handled one-save-in-flight, a trailing save,
 * and a 409 by reloading rather than retrying. What was missing was a way in:
 * every field an organizer could set was reachable exactly once, while they
 * were creating the event, and never again.
 *
 * So this route is the create wizard with its draft hydrated from the server
 * instead of from `localStorage`. Building a separate editor would have meant
 * two forms, two validation passes and two ideas of what a tier is — and the
 * second one would drift, because only one of them is on the path everybody
 * uses daily.
 *
 * The event is fetched INSIDE the wizard (see `EventWizard`), not here, so the
 * loading, not-found and not-yours states are decided by the component that
 * knows what a half-loaded editor should look like. A server component that
 * fetched and passed props would also have to be told the caller's identity to
 * scope the tier read, which is exactly the thing the organizer endpoints
 * refuse to take from a client.
 */
export default function EditEventPage({ params }: { params: { eventId: string } }) {
  return <EventWizard eventId={params.eventId} />;
}
