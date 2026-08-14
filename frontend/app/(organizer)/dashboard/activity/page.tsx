import type { Metadata } from 'next';
import { ActivityCentre } from '@/components/organizer/activity-feed';

export const metadata: Metadata = { title: 'Activity' };

/**
 * The Activity Centre: what HAPPENED, newest first.
 *
 * ── THE ATTENTION PANEL IS NOT HERE ANY MORE ──────────────────────────────
 *
 * It used to sit above the timeline, on the reasoning that "what still needs
 * doing" outranks "what happened". That reasoning was right and is now served
 * better elsewhere: the worklist lives in the header bell, where it is visible
 * from EVERY screen rather than from the two that happened to embed it.
 *
 * Leaving a copy here as well would mean the same items in two places with two
 * loading states and two chances to disagree — and an organizer clearing the
 * bell would still see them listed on this page, which reads as the dismissal
 * having failed.
 *
 * So this page is one thing now, and its name is accurate.
 *
 * The header prose went with it. It listed "bookings, refunds, gate
 * admissions, payouts and publishing decisions" directly above the filter
 * chips that spell out those exact five categories with live counts beside
 * each. The chips say it better, and they say it truthfully — a category with
 * nothing in it shows a zero rather than being promised in a sentence.
 *
 * No Suspense boundary: neither component reads `useSearchParams` — the kind
 * filter is component state, since it filters the loaded page rather than the
 * query (the endpoint takes a limit, not a kind).
 */
export default function OrganizerActivityPage() {
  return (
    <div className="flex flex-col gap-stack">
      {/* Every other organizer screen titles itself rather than relying on the
          breadcrumb, so this one does too — dropping the header entirely would
          have traded a paragraph for an inconsistency. */}
      <h1 className="text-h4">Activity</h1>
      <ActivityCentre />
    </div>
  );
}
