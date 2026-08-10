import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SpotMood } from '@/components/illustrations/spots';
import { CtaBand, PageHeader, Prose, StaticPage } from '@/components/pages/page-shell';
import { BRAND_NAME } from '@/lib/brand';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * ── ABOUT ─────────────────────────────────────────────────────────────────
 *
 * Linked from the footer and 404'd.
 *
 * ── THE HARDEST OF THE TEN TO WRITE HONESTLY ──────────────────────────────
 *
 * An about page is where every product invents things: a founding story with a
 * date, a team grid with photographs, "trusted by thousands", a mission
 * statement, a milestone timeline. This company has no registered entity yet,
 * no headcount to publish and no volume to quote. Writing any of that would be
 * the single most damaging fabrication on the site, because the about page is
 * exactly where somebody goes to decide whether the rest of it can be believed.
 *
 * So the page is built around the one thing that IS true and is genuinely
 * unusual: a set of engineering commitments that are enforced in code and can
 * be checked from the outside. "We refund you automatically when we cannot
 * deliver a ticket" is a stronger sentence than any origin story, and unlike an
 * origin story a reader can test it.
 *
 * ── NO TEAM SECTION, NO STATS BAR, NO TIMELINE ────────────────────────────
 *
 * Each was considered and each would have needed inventing. The absence is the
 * same rule the product follows everywhere: a section nothing backs is absent
 * rather than empty. When there is a team to name, this page grows one.
 */

export const metadata: Metadata = {
  ...pageMetadata(
    `About ${BRAND_NAME}`,
    'A ticketing platform built on a small number of promises that are enforced in code rather than in a policy document.',
  ),
  alternates: { canonical: '/about' },
};

/**
 * The four promises. Each maps to a real mechanism, and each is written so a
 * customer could catch us breaking it — which is what makes them worth printing
 * rather than a list of adjectives.
 */
const PROMISES = [
  {
    title: 'We never keep money for a ticket we did not deliver',
    body: 'If a payment succeeds but a ticket cannot be issued — the reservation lapsed, the amount did not match — you are refunded automatically. A scheduled job re-checks every unresolved payment against the provider, so this works even if you closed the tab and never told us. You do not have to notice, and you do not have to ask.',
  },
  {
    title: 'A ticket admits one person, once',
    body: 'The code on your ticket is marked used the instant it is scanned, under a database lock. Two gates scanning the same code in the same millisecond produce exactly one admission and one refusal. Nobody gets in on a screenshot of your ticket, and you never arrive to find your seat already taken.',
  },
  {
    title: 'The price you see is the price you pay',
    body: 'Our fee comes out of the ticket price rather than being added at checkout. There is no booking surcharge appearing at the last step, no convenience fee, and no total that grows between the event page and the payment screen.',
  },
  {
    title: 'We do not invent numbers',
    body: 'There are no star ratings on this site, no "1,247 people are interested", no "selling fast" on an event that is not. Every badge and count is computed from something the system actually records — and where we cannot compute it, the space is empty rather than filled with a plausible figure.',
  },
];

export default function AboutPage() {
  return (
    <StaticPage>
      <PageHeader
        eyebrow="About"
        title="A ticketing platform that can be checked."
        lead={`${BRAND_NAME} sells tickets to live events across India, and books the acts that play them.`}
        illustration={<SpotMood />}
      />

      <Prose>
        <h2>Why another ticketing site</h2>
        <p>
          Because the failures in this category are always the same three, and all three are
          solvable. Money taken for a ticket that never arrives. A price that grows between the
          event page and the payment screen. And numbers on a listing — ratings, interest counts,
          urgency badges — that nothing behind the scenes is actually measuring.
        </p>
        <p>
          None of those is a hard engineering problem. They persist because fixing them costs
          something and nobody checks. We decided to treat each one as a constraint on the build
          rather than as a policy to write down afterwards.
        </p>
      </Prose>

      {/* ── The four promises ────────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5 sm:gap-2">
          <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
          <h2 className="text-h4 sm:text-h3">What we promise</h2>
          <p className="max-w-2xl text-body-sm text-muted-foreground">
            Four of them, each specific enough that you could catch us breaking it.
          </p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          {PROMISES.map((promise, index) => (
            <li
              key={promise.title}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-card shadow-sm"
            >
              <span
                className="flex size-9 items-center justify-center rounded-full border border-border bg-sunken text-label tabular-nums text-foreground"
                aria-hidden
              >
                {index + 1}
              </span>
              <h3 className="text-body font-semibold text-foreground">{promise.title}</h3>
              <p className="text-body-sm text-muted-foreground">{promise.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <Prose>
        <h2>Two products, one platform</h2>
        <p>
          <strong>Tickets</strong> is the part most people see: concerts, comedy, workshops, sports,
          festivals and nightlife, from organizers who list them here and get paid after the event
          happens.
        </p>
        <p>
          <strong>
            <Link href="/hire">Hire a performer</Link>
          </strong>{' '}
          is the other side. Tell us what you are planning — a jazz band, in Mumbai, on 14 March,
          around a budget — and our team comes back to you with acts that fit, along with their
          rates and availability. A live performance is a conversation, not a checkout.
        </p>

        {/* An inventory of missing features lived here — no seat map, no
            discount codes, no guest checkout, no refund request form. The
            principle it was defending is right and is kept above: we do not
            draw a number the system cannot back. But a list of absences on an
            About page is a changelog, and it had already gone stale (refund
            requests shipped), which is exactly how a page like that fails.
            What a surface cannot do is said on that surface, at the moment it
            matters. */}

        <h2>Where we are</h2>
        <p>
          {BRAND_NAME} is early, and this page will name the company and the people behind it once
          there is something real to name — not a founding date chosen to look established, or a
          team grid assembled to fill the layout.
        </p>
      </Prose>

      <CtaBand
        title="Have a look"
        body="Browse what is on sale, or list an event of your own. Both are free to start."
        primary={{ href: '/events', label: 'Browse events' }}
        secondary={{ href: '/organizer', label: 'List your event' }}
      />
    </StaticPage>
  );
}
