import { redirect } from 'next/navigation';

/**
 * The sign-in step, folded into a sheet.
 *
 * Signing in is no longer a screen in this funnel — it is a bottom sheet over
 * whichever screen asked for it, so answering it costs neither the selection
 * nor the sense of where you were. The URL is kept rather than deleted because
 * it is in browser histories and in links people have sent themselves, and a
 * 404 in the middle of a checkout is the worst place to learn a route retired.
 *
 * It lands on the ticket picker with the selection intact; one press of
 * Continue raises the sheet.
 */
export default function LoginRedirect({
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
  redirect(`/booking/${params.eventId}${suffix ? `?${suffix}` : ''}`);
}
