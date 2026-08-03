import * as React from 'react';
import type { Metadata } from 'next';
import { Customers } from '@/components/organizer/customers';
import { Skeleton } from '@/components/organizer/primitives';

export const metadata: Metadata = { title: 'Customers' };

/**
 * `Customers` reads its filters from the URL with `useSearchParams`, which
 * needs a Suspense boundary or the whole route becomes client-rendered at
 * request time.
 */
export default function OrganizerCustomersPage() {
  return (
    <React.Suspense fallback={<Fallback />}>
      <Customers />
    </React.Suspense>
  );
}

function Fallback() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-9 w-full max-w-xs" />
      <Skeleton className="h-96 w-full" />
      <span className="sr-only">Loading customers…</span>
    </div>
  );
}
