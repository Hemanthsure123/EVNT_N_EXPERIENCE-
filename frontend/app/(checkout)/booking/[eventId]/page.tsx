import * as React from 'react';
import { BookingStep } from '@/components/booking/step-booking';

/**
 * Step 1 — choose tickets.
 *
 * ── THIS ROUTE HAS BEEN A PAGE, THEN A REDIRECT, AND IS A PAGE AGAIN ──────
 *
 * It began as the ticket step while the EVENT PAGE also carried a full picker,
 * so pressing Book asked for the same four things twice. That was resolved by
 * deleting this screen and keeping the event page's picker — the right call
 * against that pairing, and the wrong half to keep.
 *
 * The event page no longer picks. It shows a price and a `Book tickets` CTA,
 * and the choosing happens here, on a screen whose only job is choosing. The
 * duplication the redirect existed to remove is still gone; what changed is
 * which of the two screens survived.
 *
 * Why this half: a tier is not a radio button any more. It carries live
 * availability, a per-order maximum and a sale window, and a picker wedged
 * into a 22rem sidebar next to a poster is the worst place to read any of
 * that. `lib/booking/steps.ts` carries the full history.
 *
 * The `?tickets=<tierId>:<qty>` query still arrives here from an older link
 * and is honoured — `BookingStep` reads the selection from the URL, so a
 * bookmarked checkout opens with its basket intact rather than empty.
 */
export default function Page() {
  return <BookingStep />;
}
