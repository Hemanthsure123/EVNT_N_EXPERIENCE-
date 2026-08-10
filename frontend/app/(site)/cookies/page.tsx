import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SpotPolicy } from '@/components/illustrations/spots';
import { LastReviewed, PageHeader, Prose, StaticPage } from '@/components/pages/page-shell';
import { BRAND_NAME } from '@/lib/brand';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * ── COOKIE NOTICE ─────────────────────────────────────────────────────────
 *
 * Not a `LegalDocument` with a table of contents, because this page is
 * genuinely short — and its shortness is the point being made. A cookie notice
 * padded out to look substantial is a cookie notice hiding something.
 *
 * ── IT IS A REAL INVENTORY, ENUMERATED FROM THE CODE ──────────────────────
 *
 * Every key in the table below was grepped out of `lib/` and `components/`, and
 * the list is complete as of the review date. The usual alternative — three
 * vague paragraphs about "necessary, functional and analytics cookies" — is
 * unverifiable by the reader and, worse, unverifiable by us.
 *
 * Two things this lets the page say that most cannot:
 *
 *  1. **There are no cookies at all in the ordinary sense.** Everything is
 *     first-party `localStorage`, which is never transmitted to a server the
 *     way a cookie is automatically attached to every request.
 *  2. **There is no analytics, advertising or third-party tag.** Verified:
 *     `lib/vitals/web-vitals.tsx` is a deliberate no-op in production, and
 *     nothing else sends a beacon anywhere.
 *
 * When the telemetry pipeline (PENDING_TASKS §8) lands, the analytics row goes
 * in this table and the consent banner's "Accept" starts gating something —
 * `lib/consent/use-cookie-consent.ts` already stores the preference for exactly
 * that moment, and its own docstring says so.
 */

export const metadata: Metadata = {
  ...pageMetadata(
    'Cookie notice',
    `Everything ${BRAND_NAME} stores in your browser, named individually. There is no advertising or analytics tracking.`,
  ),
  alternates: { canonical: '/cookies' },
};

type StorageRow = {
  key: string;
  purpose: string;
  category: 'Essential' | 'Preference';
  lifetime: string;
};

/**
 * The real inventory. Grouped by what a reader would call it, not by what the
 * code calls it — `ee-access` and `ee-refresh` are one thing to a person.
 */
const STORAGE: readonly StorageRow[] = [
  {
    key: 'ee-access, ee-refresh',
    purpose: 'Keeps you signed in. Without these you would re-enter your password on every page.',
    category: 'Essential',
    lifetime: 'Until you sign out',
  },
  {
    key: 'ee-cookie-consent',
    purpose:
      'Remembers the choice you made in the banner — including a refusal, so we do not ask again.',
    category: 'Essential',
    lifetime: 'Until cleared',
  },
  {
    key: 'ee-theme',
    purpose: 'Light or dark, if you have chosen one. Otherwise your system setting is followed.',
    category: 'Preference',
    lifetime: 'Until cleared',
  },
  {
    key: 'ee-city, ee-location-auto, ee-location-dismissed',
    purpose:
      'The city you are browsing, and whether you have dismissed the prompt to detect it. The city NAME only — never coordinates.',
    category: 'Preference',
    lifetime: 'Until cleared',
  },
  {
    key: 'ee-saved-events',
    purpose:
      'Events you saved before signing in. Merged into your account when you do, so a saved list is not lost.',
    category: 'Preference',
    lifetime: 'Until signed in, then kept in sync',
  },
  {
    key: 'ee-recent-searches',
    purpose: 'The last few things you searched for, offered back to you in the search panel.',
    category: 'Preference',
    lifetime: 'Until cleared',
  },
  {
    key: 'ee-results-view',
    purpose: 'Whether you prefer the grid or the list layout on the browse page.',
    category: 'Preference',
    lifetime: 'Until cleared',
  },
  {
    key: 'ee-dismissed-announcements',
    purpose: 'Which site announcements you have closed, so a dismissed banner stays dismissed.',
    category: 'Preference',
    lifetime: 'Until cleared',
  },
  {
    key: 'ee-payment-provider, ee-rzp-key',
    purpose:
      'Payment configuration fetched once and cached, so the checkout does not re-request it on every step.',
    category: 'Essential',
    lifetime: 'Session',
  },
  {
    key: 'ee-event-draft-v1',
    purpose:
      'Organizers only. The local draft of an event being created, so a closed tab does not lose an hour of work.',
    category: 'Essential',
    lifetime: 'Until the draft is saved or discarded',
  },
  {
    key: 'ee-organizer-sidebar, ee-active-scope, ee-island-position',
    purpose:
      'Organizers and operators only. Layout preferences — a collapsed sidebar, the workspace you were last in.',
    category: 'Preference',
    lifetime: 'Until cleared',
  },
];

export default function CookiesPage() {
  return (
    <StaticPage>
      <PageHeader
        eyebrow="Legal"
        title="Cookie notice"
        lead="Everything this site stores in your browser, listed one by one."
        illustration={<SpotPolicy />}
      >
        <LastReviewed
          date="7 August 2026"
          note="The table below is a complete inventory, enumerated from the source rather than described in general terms."
        />
      </PageHeader>

      <Prose>
        <h2>There are no tracking cookies here</h2>
        <p>
          No advertising pixel, no Google Analytics, no Meta pixel, no session-recording script, and
          nothing that follows you to another website. Nothing on this site is shared with an
          advertising network, because there is no advertising network involved.
        </p>
        <p>
          Strictly speaking there are barely any <em>cookies</em> either. Almost everything below is
          first-party <strong>local storage</strong> — data kept in your browser that, unlike a
          cookie, is never automatically attached to a request to our servers. It stays on your
          device until you clear it.
        </p>

        <h2>What the banner actually asks</h2>
        <p>
          The consent banner offers <strong>Accept</strong> and <strong>Essential only</strong> with
          equal prominence, and a refusal is remembered exactly as durably as an acceptance.
        </p>
        <p>
          Right now the two choices differ very little in practice, because nothing on the list
          below is analytics or marketing. We record the preference so that when measurement is
          introduced — page views and conversion, which we would use to make the product better — it
          is gated by a choice you already made rather than by a new banner. This page will list it
          when it exists.
        </p>

        <h2>The full list</h2>
      </Prose>

      {/* A real table, not a definition list. Four columns of parallel facts is
          exactly what a table is for, and a screen reader user gets column
          headers announced with each cell — which a stack of <div>s does not
          give them. It scrolls horizontally on a phone rather than wrapping the
          key column into unreadable slivers. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[44rem] border-collapse text-left">
          <caption className="sr-only">
            Every item stored in your browser by {BRAND_NAME}, its purpose, category and lifetime
          </caption>
          <thead>
            <tr className="border-b border-border-strong">
              {['Stored as', 'What it is for', 'Category', 'Kept for'].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="py-3 pr-4 text-label uppercase tracking-wide text-foreground-subtle"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STORAGE.map((row) => (
              <tr key={row.key} className="border-b border-border align-top">
                <th
                  scope="row"
                  className="py-4 pr-4 font-mono text-body-sm font-normal text-foreground"
                >
                  {row.key}
                </th>
                <td className="py-4 pr-4 text-body-sm text-muted-foreground">{row.purpose}</td>
                <td className="py-4 pr-4">
                  <span
                    className={
                      row.category === 'Essential'
                        ? 'inline-flex rounded-full bg-secondary px-3 py-1 text-caption text-secondary-foreground'
                        : 'inline-flex rounded-full border border-border px-3 py-1 text-caption text-muted-foreground'
                    }
                  >
                    {row.category}
                  </span>
                </td>
                <td className="py-4 text-body-sm text-muted-foreground">{row.lifetime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Prose>
        <h2>Third parties that can set their own</h2>
        <p>Two things on the site are rendered by someone else and follow their own rules:</p>
        <ul>
          <li>
            <strong>Razorpay checkout,</strong> which opens when you pay. Card and UPI details are
            entered there and never reach us.
          </li>
          <li>
            <strong>Google Maps,</strong> on an event page that has a map. Every other Google lookup
            — search, directions, venue photos — is proxied through our own servers specifically so
            your browser does not contact Google directly.
          </li>
        </ul>

        <h2>Clearing it</h2>
        <p>
          Everything above is removable from your browser&apos;s settings for this site, and doing
          so is safe: you will be signed out and your preferences reset, and nothing is lost that
          matters. Your bookings and tickets live in your account on our servers, not in your
          browser — clearing storage cannot lose a ticket.
        </p>
        <p>
          More detail on what leaves your device at all is in the{' '}
          <Link href="/privacy">privacy policy</Link>. Anything unclear, ask us via{' '}
          <Link href="/contact">contact</Link>.
        </p>
      </Prose>
    </StaticPage>
  );
}
