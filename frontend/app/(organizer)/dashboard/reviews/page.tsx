import * as React from 'react';
import type { Metadata } from 'next';
import { Reviews } from '@/components/organizer/reviews';

export const metadata: Metadata = { title: 'Reviews' };

export default function OrganizerReviewsPage() {
  return (
    /* `Reviews` reads `?event=` with `useSearchParams` — same boundary rule as the
       events table and the scan desk. */
    <React.Suspense fallback={<p className="text-body-sm text-muted-foreground">Loading reviews…</p>}>
      <Reviews />
    </React.Suspense>
  );
}
