import { redirect } from 'next/navigation';

/**
 * The old step 1. It now redirects to Review.
 *
 * Ticket selection moved to the EVENT PAGE, where somebody is deciding beside
 * the poster, the date and the line-up — rather than being asked for the same
 * four things a second time on a screen of its own. See `lib/booking/steps.ts`.
 *
 * The route is kept rather than deleted because `/booking/{id}` is a URL that
 * has been shared, bookmarked and emailed. Deleting it would 404 somebody
 * holding a link to their own checkout; redirecting lands them exactly where
 * that link was always trying to take them.
 *
 * The query string carries the selection (`?tickets=<tierId>:<qty>`), so it is
 * forwarded verbatim — dropping it here would silently empty the basket the
 * link was for.
 */
export default async function BookingEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }
  const suffix = query.toString();
  redirect(`/booking/${eventId}/review${suffix ? `?${suffix}` : ''}`);
}
