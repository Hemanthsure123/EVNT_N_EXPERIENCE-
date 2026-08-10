import * as React from 'react';
import type { Metadata } from 'next';
import { Refunds } from '@/components/organizer/refunds';
import { RefundRequestQueue } from '@/components/organizer/refund-requests';
import { Skeleton } from '@/components/organizer/primitives';

export const metadata: Metadata = { title: 'Refunds' };

/**
 * ── TWO SECTIONS, AND THE ORDER IS THE POINT ──────────────────────────────
 *
 * REQUESTS come first, because they are the only thing on this page that is
 * waiting on the organizer. Completed refunds are a ledger — useful, and
 * nobody is blocked on reading it.
 *
 * They are genuinely different objects rather than two views of one. A
 * `RefundRequest` is somebody ASKING and has a human decision in the middle; a
 * `Refund` is money that has ALREADY moved — the backend writes one only after
 * the vendor call succeeded, so every row in the lower table is a completed
 * fact. Merging them into a single list with a status column would put
 * "waiting on you" and "done last Tuesday" in the same sort order.
 *
 * Until the request model existed this page had ONLY the lower half, and
 * asking for a refund was an email thread nothing tracked.
 *
 * `Refunds` reads `?event_id=` with `useSearchParams`, which needs a Suspense
 * boundary or the whole route becomes client-rendered at request time.
 */
export default function OrganizerRefundsPage() {
  return (
    <div className="flex flex-col gap-section">
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1.5">
          <div className="flex flex-col gap-1.5 sm:gap-2">
            <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
            <h2 className="text-h4">Refund requests</h2>
          </div>
          <p className="max-w-2xl text-body-sm text-muted-foreground">
            Customers asking for their money back. Nothing is refunded until you decide, and they
            are emailed either way.
          </p>
        </header>
        <RefundRequestQueue scope="organizer" />
      </section>

      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1.5">
          <div className="flex flex-col gap-1.5 sm:gap-2">
            <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
            <h2 className="text-h4">Completed refunds</h2>
          </div>
          <p className="max-w-2xl text-body-sm text-muted-foreground">
            Money that has already gone back. Every row here is a payment the provider confirmed was
            reversed.
          </p>
        </header>
        <React.Suspense fallback={<Fallback />}>
          <Refunds />
        </React.Suspense>
      </section>
    </div>
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
