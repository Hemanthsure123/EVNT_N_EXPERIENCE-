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
import { BRAND_NAME, LEGAL_NAME, REGISTERED_ADDRESS } from '@/lib/brand';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * ── TERMS OF SERVICE ──────────────────────────────────────────────────────
 *
 * This route did not exist, and `components/shell/site-footer.tsx` has linked
 * to it from every page on the site since the footer was written. It was one of
 * ten dead links down there, and this one is not merely embarrassing: a payment
 * gateway will not activate an Indian merchant account without reachable,
 * un-gated Terms, Privacy, Refund and Contact pages, so the absence of these
 * four files was sitting directly in front of taking real money.
 *
 * ── WHAT THIS DOCUMENT SAYS AND DOES NOT SAY ──────────────────────────────
 *
 * Every clause below describes something the platform ACTUALLY does, verified
 * against the code rather than adapted from a template. That is not
 * fastidiousness — a terms page that describes a dispute process, a loyalty
 * scheme or a resale market that does not exist is worse than no page, because
 * the one time it matters is the one time somebody holds you to it.
 *
 * Concretely, the clauses here reflect:
 *  - `apps/booking` — a ticket is issued to a USER (there is no guest checkout,
 *    `Booking.user` is not nullable) and holds expire.
 *  - `apps/payments` — the signed webhook is the only source of truth, and
 *    tickets that cannot be issued are refunded automatically.
 *  - `apps/checkin` — one scan, marked used under a row lock; a screenshot of a
 *    used ticket is denied.
 *  - `apps/events` — the organizer is the seller of the event; the platform is
 *    the booking agent.
 *
 * ── THE ONE THING THAT IS NOT REAL YET, AND IS MARKED AS SUCH ─────────────
 *
 * `REGISTERED_ADDRESS` is env-driven and empty until the company is registered.
 * Rather than print a plausible-looking Bengaluru address, the governing-law
 * clause says the entity is being registered and points at `/contact`. An
 * invented address on a Terms page is exactly the detail that voids the
 * document it appears on.
 *
 * **A lawyer must review this before go-live.** It is written to be accurate
 * about the system, which is the half an engineer can do; it is not legal
 * advice and has not been reviewed by anyone qualified to give it.
 */

export const metadata: Metadata = {
  ...pageMetadata(
    'Terms of service',
    `The agreement between you and ${BRAND_NAME} when you browse, book a ticket, or list an event.`,
  ),
  alternates: { canonical: '/terms' },
};

const SECTIONS: readonly DocSection[] = [
  {
    id: 'who-we-are',
    heading: 'Who you are contracting with',
    body: (
      <>
        <p>
          {BRAND_NAME} is a booking platform. When you buy a ticket, you are entering into a
          contract with the <strong>organizer of that event</strong> — they decide what the event
          is, when it happens, what it costs and whether it goes ahead. {LEGAL_NAME} acts as their
          booking agent: we take the payment, issue the ticket and admit you at the gate.
        </p>
        <p>
          This matters when something goes wrong. If an event is cancelled or changed, the
          organizer&apos;s decision governs what happens to your booking; our role is to carry that
          decision out and to return your money when it says we should. See the{' '}
          <Link href="/refunds">refund policy</Link> for exactly how that works.
        </p>
        <p>
          For the <Link href="/hire">Hire a performer</Link> marketplace the position is different
          again: we introduce you to the performer and record the agreed price. The booking itself,
          and any money beyond that record, is between the two of you.
        </p>
      </>
    ),
  },
  {
    id: 'your-account',
    heading: 'Your account',
    body: (
      <>
        <p>
          You need an account to book. There is no guest checkout, and that is a deliberate design
          decision rather than a missing feature: a ticket is issued <em>to a person</em>, carries a
          signed code that admits exactly one person once, and has to be recoverable if you lose the
          email. Without an account there is nowhere to put it.
        </p>
        <p>
          You must verify your email address before your first sign-in completes. We do not issue a
          session until you do — so an account created with an address you do not control cannot be
          used.
        </p>
        <ul>
          <li>Give accurate details. A ticket is issued in the name on the account.</li>
          <li>
            Keep your sign-in credentials to yourself. Anything done from your account is treated as
            done by you.
          </li>
          <li>
            One account per person. We may suspend accounts used to circumvent per-order limits.
          </li>
        </ul>
        <p>
          We can suspend an account that is used for fraud, for reselling in breach of an
          event&apos;s terms, or in a way that endangers other attendees. A suspended account cannot
          sign in; tickets already issued to it remain valid unless the organizer says otherwise.
        </p>
      </>
    ),
  },
  {
    id: 'buying-tickets',
    heading: 'Buying a ticket',
    body: (
      <>
        <p>
          Selecting tickets places a temporary <strong>hold</strong> on that inventory. The hold has
          a visible countdown, and when it expires the tickets return to sale automatically — an
          incomplete checkout never locks up seats indefinitely.
        </p>
        <p>
          Your booking is only confirmed when we have received a signed confirmation from the
          payment provider. The screen your browser returns to after paying is not itself proof of
          payment, and we deliberately do not treat it as such. If the confirmation arrives while
          your hold is still alive, your tickets are issued. If it arrives after the hold has
          lapsed, we <strong>refund you automatically</strong> — we will not keep money for a ticket
          we cannot deliver.
        </p>
        <p>
          The price you see is the price you pay. Our fee is taken out of that amount rather than
          added on top of it, so there is no booking surcharge appearing at the last step. There are
          currently no promotional codes and no separate tax line; if either is introduced it will
          be shown before you pay, never after.
        </p>
        <p>
          Per-order limits are set by the organizer per ticket type and are enforced when you book.
        </p>
      </>
    ),
  },
  {
    id: 'your-ticket',
    heading: 'Your ticket and getting in',
    body: (
      <>
        <p>
          Each ticket carries a cryptographically signed code. At the gate it is scanned once and
          marked used at that instant. Practically:
        </p>
        <ul>
          <li>
            <strong>A ticket admits one person, once.</strong> A second scan of the same code is
            refused, including a screenshot or a forwarded photograph of an already-used ticket.
          </li>
          <li>
            <strong>Altering the code invalidates it.</strong> The signature is checked before
            anything else.
          </li>
          <li>
            <strong>A refunded ticket stops working immediately.</strong> Refunding a booking voids
            its unused tickets in the same operation.
          </li>
        </ul>
        <p>
          Entry is also subject to the organizer&apos;s own conditions — age limits, prohibited
          items, security checks, dress code — which are shown on the event page. Those are the
          organizer&apos;s rules and we do not override them.
        </p>
        <p>
          You may not resell a ticket above face value, or through any channel the organizer has
          prohibited. There is no transfer feature on the platform today, so a ticket cannot be
          reassigned to another account.
        </p>
      </>
    ),
  },
  {
    id: 'organizers',
    heading: 'If you list an event',
    body: (
      <>
        <p>
          Listing is open to verified organizations. Every event is reviewed by a human before it
          goes on sale, and we may send it back with a reason, or decline it.
        </p>
        <p>You are responsible for:</p>
        <ul>
          <li>
            The accuracy of everything on the listing — dates, venue, line-up, age restrictions,
            accessibility and policies.
          </li>
          <li>Holding the rights, licences and permissions the event requires.</li>
          <li>Actually delivering the event you sold, and for what happens if you do not.</li>
        </ul>
        <p>
          Money from ticket sales is held until after the event and a refund window has passed, then
          released to your linked payout account minus our fee. The detail — and why it works that
          way — is on the <Link href="/pricing">pricing page</Link>.
        </p>
        <p>
          Cancelling an event means refunding your attendees. We can process those refunds, but the
          liability for them is yours, including where the amount exceeds the balance we are
          holding.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    heading: 'Acceptable use',
    body: (
      <>
        <p>Do not use the platform to:</p>
        <ul>
          <li>List anything illegal, or an event you are not entitled to run.</li>
          <li>
            Buy tickets by automated means, or in quantities designed to defeat a per-order limit.
          </li>
          <li>Probe, scrape or interfere with the service, or attempt to reach another account.</li>
          <li>Impersonate anybody, or misrepresent who is behind an event or a performance.</li>
        </ul>
        <p>
          We monitor for these and act on them. Where an action affects money that has already
          moved, we reverse what we can and record what we cannot.
        </p>
      </>
    ),
  },
  {
    id: 'availability',
    heading: 'Availability, and what we do not promise',
    body: (
      <>
        <p>
          We work to keep the platform available, particularly during an on-sale, but we do not
          promise uninterrupted service. We may change or withdraw features. Where a change affects
          a booking you have already made, that booking is honoured on the terms it was made under.
        </p>
        <p>
          We are not liable for the event itself — its quality, its content, or a decision by the
          organizer or the venue to refuse entry under their own conditions. Where we are liable,
          our liability is limited to the amount you paid for the booking in question.
        </p>
        <p>Nothing here limits liability that cannot be limited under Indian law.</p>
      </>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to these terms',
    body: (
      <>
        <p>
          We may update these terms. The version in force for a booking is the one published when
          the booking was made — a later change does not retroactively alter an agreement you have
          already entered into.
        </p>
        <p>
          Material changes will be notified by email to the address on your account before they take
          effect. The review date at the top of this page tells you when it last changed.
        </p>
      </>
    ),
  },
  {
    id: 'governing-law',
    heading: 'Governing law and contact',
    body: (
      <>
        <p>
          These terms are governed by the laws of India, and the courts of India have exclusive
          jurisdiction over any dispute arising from them.
        </p>
        {REGISTERED_ADDRESS ? (
          <p>
            {LEGAL_NAME} is registered at {REGISTERED_ADDRESS}.
          </p>
        ) : (
          /* Not a placeholder to be filled in later and forgotten — an accurate
             statement of the current position, which flips to a real address
             the moment NEXT_PUBLIC_REGISTERED_ADDRESS is set. An invented
             address on this page would undermine the whole document. */
          <p>
            The operating entity behind {BRAND_NAME} is in the process of being registered, and
            this page will state its registered address once registration completes. Reach us
            through <Link href="/contact">the contact page</Link> in the meantime.
          </p>
        )}
        <p>
          Questions about these terms go to <Link href="/contact">contact</Link>. Questions about a
          specific booking are answered fastest from the booking itself, in{' '}
          <Link href="/account/tickets">your tickets</Link>.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <StaticPage>
      <PageHeader
        eyebrow="Legal"
        title="Terms of service"
        lead={`The agreement between you and ${BRAND_NAME} — when you browse, when you book, and when you list an event.`}
        illustration={<SpotPolicy />}
      >
        <LastReviewed
          date="7 August 2026"
          note="Written to describe what this platform actually does. Where a common clause is absent, it is because the corresponding feature does not exist."
        />
      </PageHeader>

      <LegalDocument
        sections={SECTIONS}
        intro={
          <p>
            Plain language, and specific to this platform. If something here contradicts what a page
            in the product told you at the time you booked, the product wins and we will fix the
            page — tell us via <Link href="/contact">contact</Link>.
          </p>
        }
      />
    </StaticPage>
  );
}
