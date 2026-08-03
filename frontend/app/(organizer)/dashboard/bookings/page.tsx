import * as React from 'react';
import type { Metadata } from 'next';
import { BookingsTable } from '@/components/organizer/bookings-table';
import { Skeleton } from '@/components/organizer/primitives';

export const metadata: Metadata = { title: 'Bookings' };

export default function OrganizerBookingsPage() {
  return (
    <React.Suspense fallback={<Fallback />}>
      <BookingsTable />
    </React.Suspense>
  );
}

function Fallback() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-9 w-full max-w-xs" />
      <Skeleton className="h-96 w-full" />
      <span className="sr-only">Loading bookings…</span>
    </div>
  );
}
