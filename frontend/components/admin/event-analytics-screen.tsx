'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3 } from 'lucide-react';
import { EventPicker, type PickedEvent } from './event-picker';
import { AdminEventAnalytics } from './event-analytics';
import { EmptyState } from '@/components/organizer/primitives';

/**
 * Per-event analytics for an operator, with the event chosen rather than
 * navigated to.
 *
 * ── THIS COMPONENT EXISTED AND WAS NEVER ROUTED ───────────────────────────
 *
 * `AdminEventAnalytics` is 350 lines of working charts against a working
 * endpoint (`GET /admin/events/{id}/analytics`), reachable only by opening one
 * event's detail drawer. There was no screen in the console for "how is an
 * event doing", so the honest answer to "where are the event analytics" was
 * that they were built and unreachable.
 *
 * ── THE EVENT LIVES IN THE URL ────────────────────────────────────────────
 *
 * Same rule as every other filter in this product: `?event=` makes the view
 * shareable, reloadable and back-button-able. An operator asked "look at
 * Techie Summit" pastes a link rather than describing which dropdown to open.
 *
 * ── AND IT OPENS EMPTY, DELIBERATELY ──────────────────────────────────────
 *
 * No auto-selected first event. "Analytics" showing a real chart for an event
 * nobody asked about is how a number gets read as the platform's rather than
 * as one row's — the same reason the organizer dashboard refuses to invent a
 * denominator.
 */
export function AdminEventAnalyticsScreen() {
  const router = useRouter();
  const params = useSearchParams();

  const eventId = params?.get('event') ?? '';
  const eventTitle = params?.get('title') ?? '';

  const selected: PickedEvent | null = eventId
    ? { id: eventId, title: eventTitle || 'Selected event' }
    : null;

  const choose = (picked: PickedEvent | null) => {
    const next = new URLSearchParams(params?.toString() ?? '');
    if (picked) {
      next.set('event', picked.id);
      // The title rides along so the control reads correctly on a cold load
      // from a pasted link, without a second request just to render a label.
      next.set('title', picked.title);
    } else {
      next.delete('event');
      next.delete('title');
    }
    const query = next.toString();
    router.replace(query ? `/admin/analytics?${query}` : '/admin/analytics', { scroll: false });
  };

  return (
    <div className="flex flex-col gap-block">
      <div className="flex flex-wrap items-center gap-stack">
        <EventPicker value={selected} onChange={choose} />
        {selected ? (
          <p className="text-caption text-muted-foreground">
            Sales, check-ins and refunds for this event only.
          </p>
        ) : null}
      </div>

      {selected ? (
        <AdminEventAnalytics eventId={selected.id} />
      ) : (
        <div className="rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState
            icon={BarChart3}
            title="Choose an event"
            body="Pick one above to see its sales, check-ins and refunds. Platform-wide totals are on the Overview."
          />
        </div>
      )}
    </div>
  );
}
