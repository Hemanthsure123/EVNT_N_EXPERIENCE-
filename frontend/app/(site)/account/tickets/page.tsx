import * as React from 'react';
import type { Metadata } from 'next';
import { MyBookings } from '@/components/account/bookings';

/**
 * `/account/tickets` — kept as the URL, replaced as a screen.
 *
 * The path is in histories, in the confirmation screen's "View my tickets"
 * link, in the bottom nav's Saved neighbour and in emails the platform has
 * already sent, so it stays exactly where it is. What changed is what it
 * renders: a ticket wallet (active tickets only) became the account's
 * Bookings & Purchases list — every booking in every state, including the
 * ones that had nowhere to appear at all. See `components/account/bookings.tsx`.
 */
export const metadata: Metadata = { title: 'Bookings & purchases' };

export default function AccountTicketsPage() {
  return <MyBookings />;
}
