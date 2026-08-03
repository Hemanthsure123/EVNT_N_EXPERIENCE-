import * as React from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { FunnelShell } from '@/components/booking/funnel-shell';
import { fetchEventDetail, fetchEventTiers } from '@/lib/api/events';
import type { EventDetail, TicketTier } from '@/lib/api/types';

/**
 * The booking funnel's frame.
 *
 * A LAYOUT, not a page, and that is the load-bearing decision. Next keeps a
 * layout mounted while its child routes change, so the stepper and the summary
 * card survive every navigation in the flow — the summary animates its height
 * between steps instead of being rebuilt, and the poster is fetched once for the
 * whole journey rather than once per screen.
 *
 * It fetches the event and the tiers ONCE here and hands them down, so no step
 * re-requests them. Tiers come back `no-store` (see `fetchEventTiers`) and the
 * client re-verifies them; nothing about inventory is ever cached.
 *
 * `force-dynamic` for the same reason as the event page: this route is
 * per-request by definition, and ISR'ing it would ISR the inventory read too.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout',
  // A checkout is per-user and has nothing to offer a crawler.
  robots: { index: false, follow: false },
};

async function getEvent(id: string): Promise<EventDetail | null> {
  try {
    return await fetchEventDetail(id);
  } catch {
    return null;
  }
}

async function getTiers(id: string): Promise<TicketTier[]> {
  try {
    return (await fetchEventTiers(id)).data;
  } catch {
    return [];
  }
}

export default async function BookingLayout({
  params,
  children,
}: {
  params: { eventId: string };
  children: React.ReactNode;
}) {
  const [event, tiers] = await Promise.all([getEvent(params.eventId), getTiers(params.eventId)]);
  if (!event) notFound();

  return (
    <FunnelShell event={event} initialTiers={tiers}>
      {children}
    </FunnelShell>
  );
}
