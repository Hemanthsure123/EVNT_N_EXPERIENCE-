import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SceneNothingYet } from '@/components/illustrations/scenes';
import { CtaBand, PageHeader, Prose, StaticPage } from '@/components/pages/page-shell';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * ── CAREERS ───────────────────────────────────────────────────────────────
 *
 * Linked from the footer and 404'd.
 *
 * ── THE HONEST VERSION OF A PAGE WITH NOTHING ON IT ───────────────────────
 *
 * There are no open roles, and there is no applicant tracking system to point
 * an "Apply" button at. The three ways this page is usually written are all
 * worse than saying so:
 *
 *  1. **Invent roles.** "Senior Frontend Engineer — Bengaluru" with no
 *     requisition behind it wastes the time of the exact people you most want
 *     to hear from, and they find out only after writing an application.
 *  2. **A form that goes nowhere.** Same failure as the contact form, and for
 *     the same reason: there is nowhere to put the message.
 *  3. **Delete the footer link.** Tempting, and wrong — somebody looking for it
 *     would then find nothing at all, and a missing careers page reads as a
 *     company that is not hiring rather than one that is small.
 *
 * So it is an honest page with a real address on it, and it uses the
 * illustration set's `SceneNothingYet` — the same picture the product uses for
 * every other genuinely empty state, rather than a special one drawn to make
 * emptiness look intentional.
 *
 * ── IT IS STILL DOING A JOB ───────────────────────────────────────────────
 *
 * "What it is like to work here" is written from how this codebase is actually
 * built — the conventions are real and visible in the repository. That is the
 * part a good engineer is reading for anyway, and it is true today whereas a
 * benefits list would not be.
 */

export const metadata: Metadata = {
  ...pageMetadata(
    'Careers',
    `${BRAND_NAME} is small and not currently hiring — but this is what working here is like, and where to write if you want to be first to know.`,
  ),
  alternates: { canonical: '/careers' },
  // Nothing to index but a "no roles" notice. Left crawlable rather than
  // noindexed — the page is genuinely useful to someone looking for it, and a
  // careers URL that 404s for a bot reads worse than one that says "not yet".
};

export default function CareersPage() {
  return (
    <StaticPage>
      <PageHeader
        eyebrow="Company"
        title="Careers"
        lead={`${BRAND_NAME} is small and there are no open roles right now. When that changes they will be listed here first.`}
      />

      {/* The same empty-state scene the rest of the product uses. A page with
          nothing on it should look like every other page with nothing on it. */}
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-sunken px-card py-12 text-center sm:py-16">
        <SceneNothingYet className="w-48 sm:w-56" />
        <div className="flex max-w-md flex-col gap-2">
          <h2 className="text-h4 text-foreground">No open roles today</h2>
          <p className="text-body-sm text-muted-foreground">
            We are not hiring yet. If you would like to hear about the first opening, write to
            us.
          </p>
        </div>
        {SUPPORT_EMAIL ? (
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Working at ' + BRAND_NAME)}`}
            className="inline-flex h-control-lg items-center rounded-full bg-cta px-pill-lg text-body font-semibold text-cta-foreground shadow-sm transition duration-fast ease-out hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken active:scale-[0.98] motion-reduce:active:scale-100"
          >
            Introduce yourself
          </a>
        ) : (
          <Link
            href="/contact"
            className="inline-flex h-control-lg items-center rounded-full bg-cta px-pill-lg text-body font-semibold text-cta-foreground shadow-sm transition duration-fast ease-out hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sunken active:scale-[0.98] motion-reduce:active:scale-100"
          >
            Get in touch
          </Link>
        )}
      </div>

      <Prose>
        <h2>What working here is like</h2>
        <p>
          This is a small team building a real ticketing platform — one where a bug costs somebody
          money or keeps them out of a gig they paid for. That shapes almost everything about how
          the work is done.
        </p>

        <h3>Correctness on the money path is not negotiable</h3>
        <p>
          Overselling is prevented by a database constraint, not by careful application code.
          Concurrency is proven with tests that fire real simultaneous requests at the last ticket
          and assert exactly one succeeds — not asserted in a comment. If you like the kind of
          problem where &quot;it works when I try it&quot; is not an acceptable answer, this is that
          kind of work.
        </p>

        <h3>We do not ship things that pretend</h3>
        <p>
          The strongest convention here: a control that appears to work and does not is worse than
          an absent one. No star ratings without reviews behind them, no health tile that is green
          because nobody checked, no form that discards what was typed.
        </p>

        <h3>The reasoning lives in the code</h3>
        <p>
          Decisions are documented next to what they govern, including the ones that turned out to
          be wrong and why. A bug caught by a test is written up in the file it was caught in. You
          will spend real time explaining <em>why</em>, not just <em>what</em> — and you will
          benefit from everyone before you having done the same.
        </p>

        <h3>Small team, wide surface</h3>
        <p>
          Django and Postgres on one side, Next.js and TypeScript on the other, and a design system
          strict enough that a raw hex colour fails the build. Nobody here owns one narrow slice.
        </p>

        <h2>If you write</h2>
        <p>
          Tell us what you have built and what went wrong with it. A description of a decision you
          got wrong and what you changed afterwards is worth more to us than a CV, and it is the
          thing we would ask about anyway.
        </p>
        <p>
          More about what we are building is on <Link href="/about">the about page</Link>.
        </p>
      </Prose>

      <CtaBand
        title="Not looking for a job?"
        body="There are two other ways in — book something, or list an event of your own."
        primary={{ href: '/events', label: 'Browse events' }}
        secondary={{ href: '/organizer', label: 'List your event' }}
      />
    </StaticPage>
  );
}
