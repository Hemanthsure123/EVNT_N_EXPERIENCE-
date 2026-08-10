import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SpotPolicy } from '@/components/illustrations/spots';
import {
  LastReviewed,
  LegalDocument,
  PageHeader,
  StaticPage,
  type DocSection,
} from '@/components/pages/page-shell';
import { BRAND_NAME } from '@/lib/brand';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * ── CANCELLATION AND REFUND POLICY ────────────────────────────────────────
 *
 * The single most-read legal page on any ticketing site, and the one a payment
 * gateway checks hardest during Indian merchant onboarding. It was a dead
 * footer link.
 *
 * ── IT DESCRIBES THE THREE REFUNDS THIS SYSTEM ACTUALLY PERFORMS ──────────
 *
 * Nothing here is aspirational. Every path below is a code path:
 *
 *  1. **Automatic, no request needed.** `apps/payments._process_captured`
 *     refunds when tickets cannot be issued — the hold lapsed before the
 *     confirmation arrived, or the captured amount did not match the booking.
 *     `payments.reconcile_pending` catches the case where the customer closed
 *     the tab and nothing ever arrived at all. This is the paragraph most
 *     policies do not have, because most platforms cannot make the promise.
 *  2. **Organizer-initiated.** `POST /payments/{id}/refund`, idempotent, which
 *     also voids the booking's unused tickets in the same transaction.
 *  3. **Event cancelled.** Which today is the organizer running (2) for every
 *     booking on the event.
 *
 *  4. **Customer-requested.** `RefundRequest` — the customer asks from their
 *     tickets page, the organizer (or an operator) decides, and an approval
 *     enqueues the same idempotent refund as (2). One open request per
 *     booking, enforced by a partial unique index.
 *
 * ── SECTION 4 DESCRIBES A QUEUE THAT EXISTS ───────────────────────────────
 *
 * Every step named in "How to ask for a refund" maps to a real row and a real
 * screen: the button is on `components/account/tickets.tsx`, the status is the
 * request's own, and the organizer's queue is
 * `components/organizer/refund-requests.tsx`. If any of those is removed, this
 * section is wrong and must change with it — a policy describing a workflow
 * nothing writes to is the failure this page was written to avoid.
 *
 * **A lawyer must review this before go-live.**
 */

export const metadata: Metadata = {
  ...pageMetadata(
    'Cancellation and refund policy',
    'When you get your money back, how long it takes, and the cases where we refund you without being asked.',
  ),
  alternates: { canonical: '/refunds' },
};

const SECTIONS: readonly DocSection[] = [
  {
    id: 'the-short-version',
    heading: 'The short version',
    body: (
      <>
        <ul>
          <li>
            <strong>
              If we take your money and cannot give you a ticket, you are refunded automatically.
            </strong>{' '}
            You do not have to notice, and you do not have to ask.
          </li>
          <li>
            <strong>If the organizer cancels the event, you get a full refund</strong> of what you
            paid, including our fee.
          </li>
          <li>
            <strong>Changed your mind?</strong> That is the organizer&apos;s call, not ours. Their
            policy is on the event page.
          </li>
          <li>
            <strong>A refund reaches your account in 5–7 working days</strong> once it has been
            issued. That window belongs to your bank, not to us.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'automatic',
    heading: 'Refunds we make without being asked',
    body: (
      <>
        <p>
          Two things have to happen for a ticket to exist: your payment has to be confirmed by the
          payment provider, and the tickets you selected have to still be held for you. Occasionally
          the first happens and the second does not — the confirmation is slow, the hold expires,
          and the inventory goes back on sale.
        </p>
        <p>
          <strong>In that case we refund you in full, automatically.</strong> There is no request to
          make and no queue to wait in. The same applies if the amount captured does not match the
          booking total: we do not confirm a mismatched payment, and we return it.
        </p>
        <p>
          This holds even if you closed the browser tab the moment after paying. The platform
          re-checks every unresolved payment against the provider on a schedule, using a reference
          it stored itself — so a payment that succeeded while your connection dropped is still
          found, and is either ticketed or refunded. Keeping money for an undelivered ticket is the
          one outcome this system is built to make impossible.
        </p>
      </>
    ),
  },
  {
    id: 'cancelled-events',
    heading: 'If the event is cancelled or rescheduled',
    body: (
      <>
        <p>
          <strong>Cancelled:</strong> you receive a full refund of everything you paid, our fee
          included. We do not keep a service charge on an event that did not happen.
        </p>
        <p>
          <strong>Rescheduled:</strong> your ticket normally moves to the new date, and the
          organizer will tell you. If the new date does not work for you, you are entitled to a
          refund — contact us and reference the booking.
        </p>
        <p>
          <strong>Materially changed</strong> — the headline act withdraws, the venue moves to
          another city — is treated as a cancellation for the purpose of this policy, whatever it is
          called on the listing.
        </p>
        <p>
          We notify you by email at the address on your account when any of these happen. Refunds
          for a cancelled event are issued to the original payment method; we cannot redirect one to
          a different card or account.
        </p>
      </>
    ),
  },
  {
    id: 'changed-your-mind',
    heading: 'If you simply cannot go',
    body: (
      <>
        <p>
          This is the organizer&apos;s decision. Live events sell a fixed number of seats for a
          fixed moment, and a seat released the night before is usually a seat that goes unsold — so
          many organizers do not offer refunds for a change of mind, and that is a legitimate
          position rather than an unfair one.
        </p>
        <p>
          <strong>Check the event page before you book.</strong> Each listing shows the
          organizer&apos;s own refund and entry conditions, and those are the terms your booking is
          made on.
        </p>
        <p>
          Where an organizer does allow it, ask us and we will pass it on. If they agree, the refund
          runs through the same mechanism as every other and reaches you in the same window.
        </p>
      </>
    ),
  },
  {
    id: 'how-to-ask',
    heading: 'How to ask for a refund',
    body: (
      <>
        <p>
          Open <Link href="/account/tickets">your tickets</Link>, find the one you want to cancel
          and press <strong>Request refund</strong>. Tell us why in a sentence — the organizer
          reads it and decides.
        </p>
        <p>
          The status appears on the same ticket, so you can see whether it is awaiting a decision,
          approved, or declined. You get an email at each step. A declined request always carries
          the organizer&apos;s reason.
        </p>
        <p>
          One request covers a whole booking. If you bought four tickets together, approving the
          request cancels all four — they were paid for as one transaction and are refunded as one.
        </p>
        <p>
          If you cannot sign in to the account that made the booking, email us instead — see{' '}
          <Link href="/contact">contact</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'timing',
    heading: 'How long it takes',
    body: (
      <>
        <p>
          Once a refund is issued it is out of our hands within seconds. Reaching your account takes
          longer, and the delay is your bank&apos;s:
        </p>
        <ul>
          <li>
            <strong>UPI:</strong> usually 1–3 working days.
          </li>
          <li>
            <strong>Cards:</strong> 5–7 working days, occasionally up to a full statement cycle.
          </li>
          <li>
            <strong>Net banking and wallets:</strong> 3–7 working days.
          </li>
        </ul>
        <p>
          You will have an email confirming the refund was issued, with a reference. If the money
          has not arrived a week after that email, send us the reference and we will chase it with
          the provider.
        </p>
        <p>
          Refunds always go back to the original payment method. That is a rule of the card networks
          and the UPI system rather than ours, and there is no way to route one elsewhere.
        </p>
      </>
    ),
  },
  {
    id: 'partial',
    heading: 'Partial refunds, and fees',
    body: (
      <>
        <p>
          A refund can be for part of what you paid — for example where an organizer refunds two of
          four tickets on one booking. Where that happens, the remaining tickets stay valid and keep
          working at the gate.
        </p>
        <p>
          When we refund because <em>we</em> could not deliver, or because the event was cancelled,
          our fee is returned with everything else. Where an organizer agrees to a discretionary
          refund for a change of mind, whether the fee is returned is part of what they agree.
        </p>
        <p>
          A refunded ticket stops working immediately — its code is voided in the same operation
          that records the refund. A ticket already scanned in at the gate stays used; a refund
          after entry does not retroactively remove an admission that happened.
        </p>
      </>
    ),
  },
  {
    id: 'performers',
    heading: 'Hire a performer bookings',
    body: (
      <>
        <p>
          The <Link href="/hire">Hire a performer</Link> marketplace works differently and this
          policy does not apply to it. We introduce you to a performer and record the price you
          agree; the money moves directly between you.
        </p>
        <p>
          That means cancellation terms, deposits and refunds are whatever you and the performer
          agree, and we are not holding funds to return. We say so on the marketplace itself rather
          than leaving it to be discovered here.
        </p>
      </>
    ),
  },
];

export default function RefundsPage() {
  return (
    <StaticPage>
      <PageHeader
        eyebrow="Legal"
        title="Cancellation and refund policy"
        lead="When you get your money back, how long it takes to arrive, and the cases where we refund you without being asked."
        illustration={<SpotPolicy />}
      >
        <LastReviewed
          date="7 August 2026"
          note={`This describes what ${BRAND_NAME} actually does today, not what a template policy would say.`}
        />
      </PageHeader>

      <LegalDocument sections={SECTIONS} />
    </StaticPage>
  );
}
