import type { Metadata } from 'next';
import * as React from 'react';
import { AdminEventAnalyticsScreen } from '@/components/admin/event-analytics-screen';

export const metadata: Metadata = { title: 'Event analytics' };

/**
 * Suspense because the screen reads `useSearchParams` — the selected event
 * lives in the URL so the view can be pasted to a colleague.
 */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <AdminEventAnalyticsScreen />
    </React.Suspense>
  );
}
