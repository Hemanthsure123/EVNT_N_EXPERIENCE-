import type { Metadata } from 'next';
import { ActivityCentre } from '@/components/organizer/activity-feed';
import { AttentionPanel } from '@/components/organizer/attention-panel';

export const metadata: Metadata = { title: 'Activity' };

/**
 * The Activity Centre.
 *
 * Attention above the timeline, on purpose: the timeline says what HAPPENED
 * and the panel says what still needs doing, and only one of those is
 * actionable. An organizer who opens this page after a weekend wants the
 * second answer first.
 *
 * No Suspense boundary here because neither component reads `useSearchParams`
 * — the kind filter is component state, since it filters the loaded page
 * rather than the query (the endpoint takes a limit, not a kind).
 */
export default function OrganizerActivityPage() {
  return (
    <div className="flex flex-col gap-8">
      <AttentionPanel />
      <section className="flex flex-col gap-3">
        <header>
          <h2 className="text-body font-semibold">Timeline</h2>
          <p className="text-caption text-muted-foreground">
            Bookings, refunds, gate admissions, payouts and publishing decisions across your events,
            newest first.
          </p>
        </header>
        <ActivityCentre />
      </section>
    </div>
  );
}
