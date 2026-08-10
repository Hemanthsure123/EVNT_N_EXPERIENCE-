import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SpotPayout } from '@/components/illustrations/spots';
import {
  CtaBand,
  FaqList,
  PageHeader,
  Prose,
  StaticPage,
  Steps,
  type Faq,
} from '@/components/pages/page-shell';
import { BRAND_NAME } from '@/lib/brand';
import { PLATFORM_FEE_PER_TICKET } from '@/lib/booking/selection';
import { formatMoney } from '@/lib/discovery/format';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * ── PRICING ───────────────────────────────────────────────────────────────
 *
 * Linked from the footer's Organizers column and 404'd.
 *
 * ── THE FEE IS IMPORTED, NOT TYPED ────────────────────────────────────────
 *
 * `PLATFORM_FEE_PER_TICKET` comes from `lib/booking/selection.ts`, which is the
 * same constant the CHECKOUT computes with and which mirrors the backend's
 * setting of the same name. Writing "₹0.10 per ticket" as prose here would
 * create a second source of truth for a number that appears on a pricing page
 * and on a payment screen — and the failure mode is that somebody changes the
 * setting, the checkout follows, and the pricing page quietly starts lying
 * about the fee. Nobody would notice for months.
 *
 * ── AND IT IS A FLAT PER-TICKET FEE, NOT A PERCENTAGE ─────────────────────
 *
 * Worth stating because every comparable platform charges a percentage plus a
 * fixed amount, so a reader arrives expecting one. The backend really does
 * charge `PLATFORM_FEE_PER_TICKET * quantity` (`apps/booking/services.py`),
 * with no percentage component anywhere. The page says so and shows the working.
 *
 * ── WHAT IS NOT CLAIMED ───────────────────────────────────────────────────
 *
 * No "no hidden fees" badge, no comparison table against named competitors, no
 * tiered plans. There is one fee and one tier; inventing a Pro plan to make a
 * three-column layout is how a pricing page starts describing a product that
 * does not exist. Payment-gateway charges are named as a real, separate cost
 * rather than folded into a headline number.
 */

export const metadata: Metadata = {
  ...pageMetadata(
    'Pricing',
    `What it costs to sell tickets on ${BRAND_NAME} — a flat per-ticket fee taken out of the sale, never added on top.`,
  ),
  alternates: { canonical: '/pricing' },
};

/**
 * The worked example. Amounts are in paise, like everywhere else in this
 * codebase, and go through `formatMoney` rather than being written as strings —
 * so a change to the fee constant flows through the arithmetic AND the display.
 */
const EXAMPLE_TICKET_PRICE = 50_000; // ₹500
const EXAMPLE_QUANTITY = 200;

const FAQS: readonly Faq[] = [
  {
    q: 'Is there a listing fee, or a monthly charge?',
    a: (
      <p>
        No. Listing is free, however many events you run. The only charge is the per-ticket fee, and
        it only applies to tickets that actually sell.
      </p>
    ),
  },
  {
    q: 'What about free events?',
    a: (
      <p>
        A free ticket costs you nothing. The fee comes out of the sale amount, and there is no sale
        amount — so a free event on {BRAND_NAME} is genuinely free, including check-in and the
        attendee list.
      </p>
    ),
  },
  {
    q: 'Who pays the fee — me or the attendee?',
    a: (
      <p>
        You do, out of the ticket price. The attendee pays exactly the price you set. We
        deliberately do not add a booking fee at checkout: a price that grows at the last step is
        the single most common reason a checkout is abandoned, and it makes your event look more
        expensive than you priced it.
      </p>
    ),
  },
  {
    q: 'What are the payment gateway charges?',
    a: (
      <p>
        Razorpay charges its own percentage on each transaction, and that is separate from our fee
        and set by them. It is deducted from the amount collected before it reaches you. We are not
        marking it up or passing on a different number — check their current rates directly, as they
        vary by payment method.
      </p>
    ),
  },
  {
    q: 'When do I actually get paid?',
    a: (
      <p>
        After the event has finished and a refund window has passed. The delay is deliberate — see
        the timeline above. Once it releases, the money goes to your linked bank account through
        Razorpay Route.
      </p>
    ),
  },
  {
    q: 'What happens to the fee if I refund an attendee?',
    a: (
      <p>
        A refund returns the full amount the attendee paid, our fee included. We do not keep a fee
        on a ticket that ended up refunded, and a refund issued before payout simply reduces what is
        released to you.
      </p>
    ),
  },
  {
    q: 'Do you charge for a hire enquiry?',
    a: (
      <p>
        No. <Link href="/hire">Tell us what you need</Link> and somebody on our team comes back to
        you with options and prices. Nothing is booked or paid for through the platform, so there
        is no fee — there is no platform payment to take one from.
      </p>
    ),
  },
];

export default function PricingPage() {
  const gross = EXAMPLE_TICKET_PRICE * EXAMPLE_QUANTITY;
  const fee = PLATFORM_FEE_PER_TICKET * EXAMPLE_QUANTITY;
  const net = gross - fee;

  return (
    <StaticPage>
      <PageHeader
        eyebrow="For organizers"
        title="One fee. Taken out, never added on."
        lead={`${formatMoney(PLATFORM_FEE_PER_TICKET)} per ticket sold. No listing fee, no monthly charge, and nothing at all for a free event.`}
        illustration={<SpotPayout />}
      />

      {/* ── The headline number, and the sentence that actually matters ──── */}
      <div className="flex flex-col gap-6 rounded-2xl border border-border bg-sunken p-card-lg sm:p-8">
        <div className="flex flex-col gap-2">
          <span className="text-label uppercase tracking-wide text-foreground-subtle">
            Platform fee
          </span>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-display tabular-nums text-foreground">
              {formatMoney(PLATFORM_FEE_PER_TICKET)}
            </span>
            <span className="text-body-lg text-muted-foreground">per ticket sold</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              title: 'A flat amount, not a percentage',
              body: 'The fee is the same whether a ticket is ₹200 or ₹20,000. Nearly every other platform takes a percentage, so a high-value ticket costs you far more there than here.',
            },
            {
              title: 'Taken out of the sale',
              body: 'Your attendee pays exactly the price you set. Nothing is added at checkout, so your event never looks more expensive than you priced it.',
            },
            {
              title: 'Only on tickets that sell',
              body: 'Listing is free. Unsold tickets cost nothing, a cancelled event costs nothing, and a free event costs nothing.',
            },
          ].map((item) => (
            <div key={item.title} className="flex flex-col gap-1.5">
              <h2 className="text-body font-semibold text-foreground">{item.title}</h2>
              <p className="text-body-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── The worked example. Computed, not written. ───────────────────── */}
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
          <h2 className="text-h4 sm:text-h3">What that looks like</h2>
          <p className="text-body-sm text-muted-foreground">
            {EXAMPLE_QUANTITY} tickets at {formatMoney(EXAMPLE_TICKET_PRICE)} each.
          </p>
        </div>

        <dl className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {[
            {
              label: 'Your attendees pay',
              value: formatMoney(gross),
              note: `${EXAMPLE_QUANTITY} × ${formatMoney(EXAMPLE_TICKET_PRICE)}`,
            },
            {
              label: `${BRAND_NAME} fee`,
              value: `− ${formatMoney(fee)}`,
              note: `${EXAMPLE_QUANTITY} × ${formatMoney(PLATFORM_FEE_PER_TICKET)}`,
            },
          ].map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 px-card py-4">
              <dt className="flex flex-col gap-0.5">
                <span className="text-body text-foreground">{row.label}</span>
                <span className="text-caption text-foreground-subtle">{row.note}</span>
              </dt>
              <dd className="text-body tabular-nums text-muted-foreground">{row.value}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4 bg-sunken px-card py-4">
            <dt className="text-body font-semibold text-foreground">You receive</dt>
            <dd className="text-h4 tabular-nums text-foreground">{formatMoney(net)}</dd>
          </div>
        </dl>

        <p className="text-body-sm text-foreground-subtle">
          Razorpay&apos;s own transaction charges apply on top of this and are set by them — they
          are deducted from what is collected before it reaches you. We are not adding a margin to
          them and would rather name them than quote a headline that quietly excludes them.
        </p>
      </section>

      {/* ── When the money moves. The genuinely differentiating part. ────── */}
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
          <h2 className="text-h4 sm:text-h3">When you get paid</h2>
          <p className="max-w-2xl text-body-sm text-muted-foreground">
            Your share is separated at the moment of sale and held by the payment provider, not by
            us, so we never hold your money.
          </p>
        </div>

        <Steps
          steps={[
            {
              title: 'A ticket sells',
              body: 'The payment is split at that instant. Your share is assigned to your linked account and held there; our fee is simply not transferred to you. Two amounts, decided at the point of sale.',
            },
            {
              title: 'Your money sits with the payment provider',
              body: 'Not with us. It is held on your account at Razorpay until release. This is the part most platforms do differently, and it is why an organizer here is not exposed to us going under.',
            },
            {
              title: 'The event happens',
              body: 'Attendees are scanned in. Any refunds during this period reduce the balance, which is exactly why payout waits.',
            },
            {
              title: 'The refund window closes, and it releases',
              body: 'Once the event has finished and the refund window has passed, the balance is recomputed from the actual payment records — not from a running total — and released to your bank account. Because it happens after the window, the figure is final and there is nothing to claw back.',
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
          <h2 className="text-h4 sm:text-h3">Questions</h2>
        </div>
        <FaqList items={FAQS} />
      </section>

      <Prose>
        <h2>What is included, at no extra cost</h2>
        <p>
          Everything. There is one tier and one fee — no plan gates a feature here. That includes
          the full organizer dashboard, unlimited events and ticket types, the QR check-in app,
          attendee and revenue analytics, the event creation studio, refund handling, and automated
          ticket delivery by email and SMS.
        </p>
        <p>
          What we do <em>not</em> have is worth knowing before you commit: there are no discount
          codes, no reserved seating, and no built-in email marketing to past attendees. None of
          those is a paid upgrade — they do not exist on any plan, because there is only one.
        </p>
      </Prose>

      <CtaBand
        title="Ready to list an event?"
        body="Create the event, add your ticket types, and submit it for review. Verification and your first listing usually complete on the same day."
        primary={{ href: '/dashboard/events/new', label: 'Create an event' }}
        secondary={{ href: '/organizer', label: 'How it works' }}
      />
    </StaticPage>
  );
}
