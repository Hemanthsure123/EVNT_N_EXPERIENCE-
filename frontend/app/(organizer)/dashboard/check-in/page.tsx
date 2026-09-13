import * as React from 'react';
import type { Metadata } from 'next';
import { CheckIn } from '@/components/organizer/check-in';

export const metadata: Metadata = { title: 'Check-in' };

export default function OrganizerCheckInPage() {
  return (
    /* `CheckIn` reads `?event=` with `useSearchParams` (an event card's "Scan desk"
       links straight to one gate), which needs a Suspense boundary or the whole
       route becomes client-rendered at request time. */
    <React.Suspense fallback={<p className="text-body-sm text-muted-foreground">Loading the scan desk…</p>}>
      <CheckIn />
    </React.Suspense>
  );
}
