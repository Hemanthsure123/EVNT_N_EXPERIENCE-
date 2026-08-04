import * as React from 'react';
import type { Metadata } from 'next';
import { AdminEventDetail } from '@/components/admin/event-detail';

/**
 * The operator's view of one event.
 *
 * `noindex` is inherited from the admin layout, which sets it for the whole
 * section — this is staff-only data about somebody else's business and must
 * never reach a crawler. The title is generic on purpose: a browser history
 * entry or a screen-shared tab should not leak an event's name.
 */
export const metadata: Metadata = { title: 'Event' };

export default function AdminEventPage({ params }: { params: { id: string } }) {
  return <AdminEventDetail eventId={params.id} />;
}
