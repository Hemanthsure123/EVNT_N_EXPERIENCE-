import * as React from 'react';
import type { Metadata } from 'next';
import { RefundDetail } from '@/components/account/refund-detail';

/**
 * `/account/refunds/{requestId}` — one refund, in full.
 *
 * ── WHY IT IS IN `(checkout)` AND NOT IN `(site)/account` ────────────────
 *
 * A route group changes no URL, and this one is `/account/refunds/…` exactly
 * as a reader would expect. What the group decides is the CHROME.
 *
 * `(site)/account` wraps every page in the account rail — a chip strip pinned
 * under the header on a phone — plus the announcement bar, the search field,
 * the city switcher, the bottom tab bar and the four-column footer. This screen
 * is a money-path OUTCOME, the sibling of the booking confirmation: it is
 * reached from one place, answers one question, and every one of those
 * controls is a way out of it. It carries its own back arrow instead.
 *
 * `(checkout)` also has no `loading.tsx` on purpose, so nothing here can turn a
 * page-level `redirect()` into a client-side navigation.
 */
export const metadata: Metadata = {
  title: 'Refund details',
  // One person's money. Nothing for a crawler.
  robots: { index: false, follow: false },
};

export default function RefundDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-4 sm:px-6">
        <RefundDetail requestId={params.id} />
      </div>
    </div>
  );
}
