import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, LifeBuoy, Mail, Megaphone, Phone, ShieldAlert } from 'lucide-react';
import { SpotSupport } from '@/components/illustrations/spots';
import { PageHeader, Prose, StaticPage } from '@/components/pages/page-shell';
import { BRAND_NAME, SUPPORT_EMAIL, SUPPORT_PHONE } from '@/lib/brand';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * ── CONTACT ───────────────────────────────────────────────────────────────
 *
 * Linked TWICE from the footer (Support → "Contact us", Company → "Contact")
 * and 404'd from both. It is also one of the four pages an Indian payment
 * gateway checks for during merchant onboarding, so its absence sat directly in
 * front of taking real money.
 *
 * ── WHY THERE IS NO CONTACT FORM ──────────────────────────────────────────
 *
 * This is the whole design decision of the page, and it is the same decision
 * the rest of the product makes everywhere else.
 *
 * A contact form needs somewhere to put the message. There is no
 * `SupportTicket` model, no `POST /support/tickets`, and no inbox anything
 * writes to — `apps/notifications` is event-driven and exposes no HTTP surface
 * for inbound mail. So a form here could do exactly one thing: collect a
 * message, show "thanks, we'll be in touch", and drop it.
 *
 * That is the single worst thing on this list to fake. Somebody whose payment
 * failed types out what happened, presses send, sees a success message, and
 * waits — for a reply that was never going to come, having been told it would.
 * A `mailto:` link is less impressive and actually delivers.
 *
 * When the support desk ships (PENDING_TASKS 3.1.5 / BACKLOG 49) this page
 * grows the form, and the form will have a ticket id behind it.
 *
 * ── AND WHY EVERY CHANNEL IS ENV-DRIVEN ───────────────────────────────────
 *
 * `SUPPORT_EMAIL` and `SUPPORT_PHONE` come from `lib/brand`, and an unset one
 * renders as "not open yet" rather than as a plausible address. A support
 * address printed on a contact page that bounces is worse than an honest gap:
 * it converts somebody who needed help into somebody who thinks they were
 * ignored.
 */

export const metadata: Metadata = {
  ...pageMetadata(
    'Contact us',
    `How to reach ${BRAND_NAME} — support, organizer enquiries, press, and security disclosure.`,
  ),
  alternates: { canonical: '/contact' },
};

type Channel = {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  /** The address to write to. Empty means the channel is not open yet. */
  address: string;
  /** `mailto` subject prefix, so a message arrives pre-routed. */
  subject?: string;
  /** Set for the phone row, which needs `tel:` rather than `mailto:`. */
  tel?: boolean;
  meta?: string;
};

/**
 * Support is deliberately FIRST and given the most room. Nine out of ten people
 * on this page have a booking problem; press and partnerships are a rounding
 * error that most contact pages nonetheless list at the top.
 */
function channels(): readonly Channel[] {
  return [
    {
      icon: <LifeBuoy className="size-5" aria-hidden />,
      title: 'Help with a booking',
      body: (
        <>
          Tickets, payments, refunds, entry problems.{' '}
          <strong>Include your booking reference</strong> — it is on the ticket and in your
          confirmation email, and it turns a two-day thread into a single reply.
        </>
      ),
      address: SUPPORT_EMAIL,
      subject: 'Booking help',
      meta: 'Answered within one working day',
    },
    {
      icon: <Phone className="size-5" aria-hidden />,
      title: 'Phone',
      body: (
        <>
          For something urgent on the day of an event — you are at the gate, or the event starts in
          an hour. For anything else, email gets you a better answer because we can look at the
          booking while we write it.
        </>
      ),
      address: SUPPORT_PHONE,
      tel: true,
      meta: 'Mon–Sat, 10am–7pm IST',
    },
    {
      icon: <Building2 className="size-5" aria-hidden />,
      title: 'Listing an event',
      body: (
        <>
          Questions about running events on {BRAND_NAME}, payouts, or getting your organization
          verified. The <Link href="/organizer">organizer page</Link> answers most of it, and{' '}
          <Link href="/pricing">pricing</Link> covers the money.
        </>
      ),
      address: SUPPORT_EMAIL,
      subject: 'Organizer enquiry',
    },
    {
      icon: <Megaphone className="size-5" aria-hidden />,
      title: 'Press and partnerships',
      body: <>Media enquiries, and anyone who wants to work with us.</>,
      address: SUPPORT_EMAIL,
      subject: 'Press',
    },
    {
      icon: <ShieldAlert className="size-5" aria-hidden />,
      title: 'Security disclosure',
      body: (
        <>
          Found a vulnerability? Tell us privately and give us a reasonable window to fix it before
          publishing. We will not pursue anyone who reports in good faith and does not access other
          people&apos;s data.
        </>
      ),
      address: SUPPORT_EMAIL,
      subject: 'Security disclosure',
      meta: 'Acknowledged within 48 hours',
    },
  ];
}

function ChannelCard({ channel }: { channel: Channel }) {
  const href = channel.tel
    ? `tel:${channel.address.replace(/\s+/g, '')}`
    : `mailto:${channel.address}${channel.subject ? `?subject=${encodeURIComponent(channel.subject)}` : ''}`;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-card shadow-sm">
      <span
        className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground"
        aria-hidden
      >
        {channel.icon}
      </span>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-body font-semibold text-foreground">{channel.title}</h3>
        <p className="text-body-sm text-muted-foreground">{channel.body}</p>
      </div>

      {channel.address ? (
        <div className="mt-auto flex flex-col gap-1 pt-1">
          <a
            href={href}
            className="w-fit rounded-sm text-body font-medium text-foreground underline underline-offset-4 transition-colors duration-fast ease-out hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {channel.address}
          </a>
          {channel.meta ? (
            <span className="text-caption text-foreground-subtle">{channel.meta}</span>
          ) : null}
        </div>
      ) : (
        /* The channel exists as a plan, not as an address. Saying so beats
           printing something that bounces — see the file header. */
        <p className="mt-auto pt-1 text-body-sm text-foreground-subtle">
          Not open yet. Use the email channels above and we will route it.
        </p>
      )}
    </li>
  );
}

export default function ContactPage() {
  const all = channels();
  const anyOpen = all.some((channel) => channel.address);

  return (
    <StaticPage>
      <PageHeader
        eyebrow="Support"
        title="Contact us"
        lead="A person reads every message. Tell us what happened and what you expected to happen — that is usually enough to fix it in one reply."
        illustration={<SpotSupport />}
      />

      {/* The fastest answer is usually not a message at all, and saying so at
          the top respects the reader's time more than burying it below five
          contact cards. */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-sunken p-card-lg sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <div className="flex flex-col gap-1">
          <h2 className="text-body font-semibold text-foreground">
            Before you write — it may already be answered
          </h2>
          <p className="text-body-sm text-muted-foreground">
            &quot;I paid and got no ticket&quot;, &quot;my ticket was refused at the gate&quot; and
            &quot;how long does a refund take&quot; all have specific answers in the help centre.
          </p>
        </div>
        <Link
          href="/help"
          className="inline-flex h-control shrink-0 items-center rounded-full border border-border bg-surface px-pill text-label text-foreground transition-colors duration-fast ease-out hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken"
        >
          Help centre
        </Link>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {all.map((channel) => (
          <ChannelCard key={channel.title} channel={channel} />
        ))}
      </ul>

      {!anyOpen ? (
        /* Every channel unconfigured means this is a pre-launch deploy. The
           page still renders — it is linked from every footer — but it says so
           plainly rather than showing five cards that all lead nowhere. */
        <div className="flex items-start gap-3 rounded-xl border border-warning-subtle bg-warning-subtle p-card">
          <Mail className="mt-0.5 size-5 shrink-0 text-warning-subtle-foreground" aria-hidden />
          <p className="text-body-sm text-warning-subtle-foreground">
            <strong>Support channels are being set up.</strong> No contact address is available
            on this deployment yet. If you are testing this build, reach the person who gave you
            the link.
          </p>
        </div>
      ) : null}

      {/* A "Why there is no contact form here" section stood above this: two
          paragraphs on message routing and an unbuilt support desk. The
          reasoning is sound — a form that silently drops what you typed is
          worse than an address — and it is entirely ours. Somebody on this
          page wants to reach us, and the addresses above do that. */}
      <Prose>
        <h2>What to include</h2>
        <ul>
          <li>
            <strong>Your booking reference</strong>, if it is about a booking. It is on the ticket
            and in the confirmation email.
          </li>
          <li>
            <strong>The email address on your account</strong> — write from it if you can, which
            lets us confirm it is you without a round trip.
          </li>
          <li>
            <strong>What happened, and what you expected.</strong> A screenshot of an error is worth
            three paragraphs describing it.
          </li>
        </ul>
        <p>
          The <Link href="/refunds">refund policy</Link> and the <Link href="/terms">terms</Link>{' '}
          answer many questions directly, but you are welcome to just ask.
        </p>
      </Prose>
    </StaticPage>
  );
}
