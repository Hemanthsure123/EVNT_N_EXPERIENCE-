import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BarChart3,
  BadgeIndianRupee,
  CalendarCheck,
  Layers,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import { SpotListing } from '@/components/illustrations/spots';
import {
  CtaBand,
  FaqList,
  FeatureGrid,
  PageHeader,
  Prose,
  StaticPage,
  Steps,
  type Faq,
} from '@/components/pages/page-shell';
import { BRAND_NAME } from '@/lib/brand';
import { PLATFORM_FEE_BPS } from '@/lib/booking/selection';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * ── "LIST YOUR EVENT" — THE SUPPLY-SIDE FRONT DOOR ────────────────────────
 *
 * The footer linked here TWICE (as "List your event" and as "Organizer login",
 * both pointing at this same non-existent route) and it 404'd from both. It is
 * the most commercially significant of the ten missing pages: a two-sided
 * ticketing platform with no front door for organisers is one that only grows on
 * one side.
 *
 * ── EVERY CLAIM IS A FEATURE THAT EXISTS ──────────────────────────────────
 *
 * A landing page is where fabrication is most tempting and least visible, so
 * the discipline is worth restating: no invented customer counts, no "trusted
 * by 500+ organizers", no testimonials, no logo wall. This platform has no
 * volume to quote and quoting one would be the same lie as a five-star rating
 * with no reviews behind it.
 *
 * What it argues with instead are real engineering properties that a competitor
 * genuinely may not have, each traceable to code:
 *
 *  - The money is separated at the point of sale and held by Razorpay, not by
 *    us (`apps/payments`, Route transfers with `on_hold=True`).
 *  - Overselling is impossible at the database level, not merely unlikely
 *    (`ticket_type_no_oversell`, plus a per-row lock on the reserve decision).
 *  - A ticket admits one person once, enforced under a per-ticket row lock
 *    (`apps/checkin`) rather than by convention.
 *  - A payment that cannot be ticketed is refunded automatically
 *    (`payments.reconcile_pending`).
 *
 * Those are unusual and they are true, which is a much stronger page than a
 * grid of adjectives.
 *
 * ── AND IT NAMES THE GAPS ─────────────────────────────────────────────────
 *
 * The closing prose says what is missing — no reserved seating, no discount
 * codes, no marketing emails. An organizer who discovers that after their first
 * on-sale is an organizer who leaves, and tells people why.
 */

export const metadata: Metadata = {
  ...pageMetadata(
    'List your event',
    `Sell tickets on ${BRAND_NAME} — ${PLATFORM_FEE_BPS / 100}% per ticket paid by your attendee, no listing fee, and your money held by the payment provider rather than by us.`,
  ),
  alternates: { canonical: '/organizer' },
};

const FEATURES = [
  {
    icon: <Layers className="size-5" aria-hidden />,
    title: 'Multiple ticket types',
    body: 'Early bird, tiered pricing, per-tier sale windows and per-order limits. Each tier sells independently, so a rush on one never blocks another.',
  },
  {
    icon: <QrCode className="size-5" aria-hidden />,
    title: 'Check-in that cannot double-admit',
    body: 'Scan with a phone or a handheld reader. A ticket is marked used the instant it is scanned, so a screenshot or a forwarded code is refused — even at two gates in the same second.',
  },
  {
    icon: <BarChart3 className="size-5" aria-hidden />,
    title: 'Real analytics',
    body: 'Revenue, sell-through, attendance, repeat customers, and per-event conversion. Every number is computed from your own rows — nothing here is estimated.',
  },
  {
    icon: <BadgeIndianRupee className="size-5" aria-hidden />,
    title: 'Payouts you can predict',
    body: 'Gross, fee, refunds and net per event, with the release date. Your share is separated at the moment of sale and held by the payment provider.',
  },
  {
    icon: <CalendarCheck className="size-5" aria-hidden />,
    title: 'A real event builder',
    body: 'Eight steps, autosaved as you go, with undo and a live preview of the public page. Gallery, running order, FAQs and search metadata all included.',
  },
  {
    icon: <ShieldCheck className="size-5" aria-hidden />,
    title: 'Overselling is impossible',
    body: 'Not "unlikely" — the database itself refuses to record a sale beyond your inventory, and every reservation is decided under a row lock rather than from a cache.',
  },
];

const FAQS: readonly Faq[] = [
  {
    q: 'What does it cost?',
    a: (
      <p>
        {PLATFORM_FEE_BPS / 100}% of each ticket sold, added at checkout and paid by your
        attendee — so the amount that reaches you is the price you set. No listing fee, no monthly
        charge, nothing for a free event. Full detail, with a worked example, is on the{' '}
        <Link href="/pricing">pricing page</Link>.
      </p>
    ),
  },
  {
    q: 'How long does it take to get an event live?',
    a: (
      <p>
        Building the listing takes as long as you take. After you submit it, a person reviews it —
        usually the same day. If something needs changing you get a specific reason rather than a
        rejection, and resubmitting clears it.
      </p>
    ),
  },
  {
    q: 'Do I need to be a registered company?',
    a: (
      <p>
        You need an organization on the platform and a bank account we can pay out to, which means
        completing Razorpay&apos;s onboarding for the payout account. Verification is a real review
        with a real outcome, not a checkbox.
      </p>
    ),
  },
  {
    q: 'What happens if I have to cancel?',
    a: (
      <p>
        You refund your attendees, and we process those refunds through the same mechanism as every
        other. Because payout only releases after the event and a refund window, the money is
        usually still held at that point — so a cancellation does not mean chasing funds you have
        already received.
      </p>
    ),
  },
  {
    q: 'Can my team help run the event?',
    a: (
      <p>
        An organization has one account today, and gate staff sign in with it on the check-in
        screen. Sub-users with their own logins and per-event permissions are on the roadmap.
      </p>
    ),
  },
  {
    q: 'Can I sell reserved seating?',
    a: (
      <p>
        No. Every ticket type is general admission — you set a quantity and a price, and there is no
        seat map. If your venue sells by seat number, this platform is not the right fit today.
      </p>
    ),
  },
];

export default function OrganizerLandingPage() {
  return (
    <StaticPage>
      <PageHeader
        eyebrow="For organizers"
        title="Sell tickets without wondering where the money is."
        lead={`List an event in an afternoon, take payments the same day, and get paid after it happens. ${PLATFORM_FEE_BPS / 100}% per ticket, paid by your attendee — nothing else.`}
        illustration={<SpotListing />}
      >
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            href="/dashboard/events/new"
            className="inline-flex h-control-lg items-center rounded-full bg-cta px-pill-lg text-body font-semibold text-cta-foreground shadow-sm transition duration-fast ease-out hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] motion-reduce:active:scale-100"
          >
            Create an event
          </Link>
          <Link
            href="/pricing"
            className="inline-flex h-control-lg items-center rounded-full border border-border bg-surface px-pill-lg text-body font-medium text-foreground transition-colors duration-fast ease-out hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            See pricing
          </Link>
        </div>
      </PageHeader>

      {/* ── The three properties a competitor may genuinely not have ─────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            headline: 'We never hold your money',
            body: 'Your share is separated at the instant of sale and held on your own account at the payment provider until release. It does not pass through a balance we control.',
          },
          {
            headline: 'You cannot oversell',
            body: 'The database physically refuses to record a sale beyond your inventory, and every reservation is decided under a row lock rather than from a cached count.',
          },
          {
            headline: 'No ticket, no charge',
            body: 'If a payment succeeds but a ticket cannot be issued, the buyer is refunded automatically — found by a scheduled reconciliation, not by them complaining.',
          },
        ].map((item) => (
          <div
            key={item.headline}
            className="flex flex-col gap-2 rounded-xl border border-border bg-sunken p-card"
          >
            <h2 className="text-body font-semibold text-foreground">{item.headline}</h2>
            <p className="text-body-sm text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
          <h2 className="text-h4 sm:text-h3">How it works</h2>
        </div>
        <Steps
          steps={[
            {
              title: 'Create your organization',
              body: 'Sign up, add your organization, and submit it for verification. This is also where you link the bank account payouts go to.',
            },
            {
              title: 'Build the event',
              body: (
                <>
                  Eight steps in the event studio — the basics, venue, schedule and running order,
                  ticket types, gallery, details and FAQs, search metadata, and a review. It
                  autosaves as you go and shows a live preview of the public page.
                </>
              ),
            },
            {
              title: 'Submit for review',
              body: 'A person checks the listing before it goes on sale. If something needs changing you get a specific reason, and resubmitting clears it.',
            },
            {
              title: 'Sell, and watch it in real time',
              body: 'Once live, the event appears in browse, search, and its city and category pages. Sales, remaining inventory and revenue update as they happen.',
            },
            {
              title: 'Scan people in',
              body: 'Open the check-in screen on any phone. It works with the camera or a handheld reader, queues scans when the venue Wi-Fi drops, and shows live attendance against capacity.',
            },
            {
              title: 'Get paid',
              body: (
                <>
                  After the event and its refund window, your balance is recomputed from the actual
                  payment records and released to your bank account. See{' '}
                  <Link href="/pricing">pricing</Link> for the full timeline.
                </>
              ),
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
          <h2 className="text-h4 sm:text-h3">What you get</h2>
          <p className="text-body-sm text-muted-foreground">
            All of it, on the one fee. No plan gates a feature here.
          </p>
        </div>
        <FeatureGrid features={FEATURES} />
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
          <h2 className="text-h4 sm:text-h3">Questions</h2>
        </div>
        <FaqList items={FAQS} />
      </section>

      <Prose>
        <h2>What we do not have yet</h2>
        <p>
          Worth knowing before your first on-sale. There is no <strong>reserved seating</strong> —
          every ticket type is general admission. There are no{' '}
          <strong>discount or promo codes</strong>. There is no{' '}
          <strong>email marketing to past attendees</strong>, and no <strong>team accounts</strong>{' '}
          — your organization has one login today.
        </p>
        <p>
          If one of those is central to how you sell, this is not the right platform for that event
          yet.
        </p>

        <h2>Hiring a performer instead?</h2>
        <p>
          If you are looking to <em>hire</em> a band, a DJ or a comedian rather than to sell
          tickets, that is a different part of the product — tell us what you need on{' '}
          <Link href="/hire">Hire a band</Link> and somebody on our team comes back to you with
          options and prices.
        </p>
      </Prose>

      <CtaBand
        title="List your first event"
        body="Free to list, and you only pay on tickets that sell. Verification and a first listing usually complete on the same day."
        primary={{ href: '/dashboard/events/new', label: 'Create an event' }}
        secondary={{ href: '/contact', label: 'Talk to us first' }}
      />
    </StaticPage>
  );
}
