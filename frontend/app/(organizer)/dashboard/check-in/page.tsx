import * as React from 'react';
import type { Metadata } from 'next';
import { ScanDesk } from '@/components/organizer/scan-desk';

export const metadata: Metadata = { title: 'Scan desk' };

export default function OrganizerScanDeskPage() {
  return (
    /* `ScanDesk` reads `?event=` with `useSearchParams` (an event card's
       "Scan desk" links straight to one event), which needs a Suspense
       boundary or the whole route becomes client-rendered at request time. */
    <React.Suspense
      fallback={<p className="text-body-sm text-muted-foreground">Loading the scan desk…</p>}
    >
      <ScanDesk />
    </React.Suspense>
  );
}
