import * as React from 'react';
import { PaymentFailedStep } from '@/components/booking/step-failed';

/**
 * Where a refused payment lands.
 *
 * Inside the booking LAYOUT, so it keeps the event and tiers the funnel already
 * fetched — a failure screen that re-requested them would be a second round
 * trip at the slowest moment of the flow.
 *
 * NOT inside `FunnelScreen`, though, and that is deliberate. `FunnelScreen`
 * pairs a title with `BackControl`, which offers to CANCEL a live hold on the
 * way out. That is exactly right when somebody is leaving a checkout and
 * exactly wrong here: the hold surviving is the good news on this screen, and
 * the reason to go back is to retry. The screen carries its own header, whose
 * back arrow returns to the review step with the hold untouched.
 *
 * `FunnelScreen`'s other job — clearance for the fixed action bar — IS still
 * needed, so it is done here: the bar publishes its measured height to
 * `--sticky-action-height` in a layout effect, and this padding reads it. The
 * fallback covers the first paint, before the observer has run.
 */
export default function Page() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-[calc(var(--sticky-action-height,5.5rem)+env(safe-area-inset-bottom)+1.5rem)] pt-4 sm:px-6">
        {/* `useSearchParams` needs a boundary or the whole route becomes
            client-rendered at request time — the same reason `/hire` and the
            account settings screen wrap theirs. */}
        <React.Suspense fallback={null}>
          <PaymentFailedStep />
        </React.Suspense>
      </div>
    </div>
  );
}
