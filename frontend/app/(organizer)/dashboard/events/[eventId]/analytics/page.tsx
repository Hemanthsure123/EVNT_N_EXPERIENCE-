import * as React from 'react';
import type { Metadata } from 'next';
import { EventAnalytics } from '@/components/organizer/event-analytics';

/**
 * `/dashboard/events/{id}/analytics` — one event's own performance page.
 *
 * A ROUTE rather than a query param on the account-wide analytics page,
 * because it answers a different question and deserves its own URL: an
 * organizer bookmarks this, shares it with a co-organizer, and returns to it
 * during a sale. `?event=` on a page whose other panels are account-wide would
 * also have to explain which halves of the page the filter applied to.
 *
 * The title is deliberately generic. The event's name is not known until the
 * client has fetched it, and a server-rendered title would need a second
 * authenticated read on a route that is `private, no-store` anyway.
 */
export const metadata: Metadata = { title: 'Event analytics' };

export default function OrganizerEventAnalyticsPage({
  params,
}: {
  params: { eventId: string };
}) {
  return <EventAnalytics eventId={params.eventId} />;
}
