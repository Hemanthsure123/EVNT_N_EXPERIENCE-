import * as React from 'react';
import { RefundRequestQueue } from '@/components/organizer/refund-requests';

/**
 * Platform-wide refund requests.
 *
 * The SAME component the organizer's queue renders, with `scope="admin"`. One
 * component because it is the same row, the same decision and the same rule —
 * two copies is how the operator's view ends up more permissive than the
 * organizer's, which on a money decision is the wrong direction to drift.
 */
export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <RefundRequestQueue scope="admin" />
    </React.Suspense>
  );
}
