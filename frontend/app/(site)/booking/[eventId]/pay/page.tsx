import { redirect } from 'next/navigation';

/**
 * The payment step, folded into review.
 *
 * This route existed to restate an order the previous screen had just shown
 * and then offer a button; the button now sits under the summary itself. The
 * URL is kept rather than deleted because it is in browser histories and in
 * links people have shared with themselves — and a 404 mid-checkout is the
 * worst possible place to discover a route was retired.
 *
 * The query string rides along, so a booking id or a selection in it survives
 * the hop and review opens on the same order.
 */
export default function PayRedirect({
  params,
  searchParams,
}: {
  params: { eventId: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') query.set(key, value);
    else if (Array.isArray(value) && value[0]) query.set(key, value[0]);
  }
  const suffix = query.toString();
  redirect(`/booking/${params.eventId}/review${suffix ? `?${suffix}` : ''}`);
}
