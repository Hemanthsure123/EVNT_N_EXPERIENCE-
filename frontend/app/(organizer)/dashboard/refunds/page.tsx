import * as React from 'react';
import type { Metadata } from 'next';
import { Refunds } from '@/components/organizer/refunds';
import { Skeleton } from '@/components/organizer/primitives';

export const metadata: Metadata = { title: 'Refunds' };

/**
 * `Refunds` reads `?event_id=` with `useSearchParams`, which needs a Suspense
 * boundary or the whole route becomes client-rendered at request time. The
 * boundary keeps the shell static and defers only the table.
 */
export default function OrganizerRefundsPage() {
  return (
    <React.Suspense fallback={<Fallback />}>
      <Refunds />
    </React.Suspense>
  );
}

function Fallback() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-80 w-full" />
      <span className="sr-only">Loading refunds…</span>
    </div>
  );
}
