import type { Metadata } from 'next';
import { Promotions } from '@/components/organizer/promotions';

export const metadata: Metadata = { title: 'Promotions' };

/**
 * Discount codes for the organizer's own events.
 *
 * Its own section rather than a tab inside an event, because a code is owned by
 * the ORGANISATION and may span every event it runs — a promoter running a
 * season wants one code across it, and scoping to a single event is the
 * narrower case the form offers as an option.
 */
export default function OrganizerPromotionsPage() {
  return <Promotions />;
}
