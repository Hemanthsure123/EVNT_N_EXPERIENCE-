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
 * ── PRIVACY POLICY ────────────────────────────────────────────────────────
 *
 * Written from the schema, not from a template. Every field named below is a
 * column that exists, and the "what we do not collect" section is the more
 * useful half — most privacy policies are written to cover every conceivable
 * future collection, which makes them both unreadable and impossible to verify.
 *
 * Verified against:
 *  - `apps/accounts.User` — email, name, optional phone, avatar url, and the
 *    `email_verified` flag. `EmailVerification` stores a password-hasher DIGEST
 *    of the code, never the code.
 *  - `apps/booking.Ticket` — the signed QR payload is ids only. No PII is in
 *    the code somebody photographs and forwards, which is worth stating.
 *  - `apps/payments.Payment` — Razorpay reference ids and amounts. NO card data
 *    is stored anywhere in this system.
 *  - `apps/checkin.ScanLog` — an attendance record. It is personal data and is
 *    named as such rather than filed under "technical logs".
 *  - `apps/integrations` — Google refresh tokens, encrypted at rest with a key
 *    derived from `SECRET_KEY` (`core/encryption.py`).
 *  - `lib/consent`, `lib/vitals` — no analytics is transmitted anywhere. The
 *    web-vitals hook is a no-op in production.
 *
 * ── THE DPDP ACT SECTION IS DELIBERATELY UNVARNISHED ──────────────────────
 *
 * India's DPDP Act 2023 gives a right of access, correction and erasure. This
 * platform has NO self-service data export and NO account deletion flow
 * (PENDING_TASKS 4.4.5). Claiming "you can download your data from your account
 * settings" would be false, and it is the kind of false that a regulator reads.
 * So section 7 says the right exists, that it is served by email today, and
 * that self-service is coming — which is accurate and still discharges the
 * obligation to tell people how to exercise it.
 *
 * **A lawyer must review this before go-live**, and a named Grievance Officer
 * has to be appointed — the Act requires one and a page cannot invent a person.
 */

export const metadata: Metadata = {
  ...pageMetadata(
    'Privacy policy',
    'What we collect, why, who we share it with, and what we deliberately do not store.',
  ),
  alternates: { canonical: '/privacy' },
};

const SECTIONS: readonly DocSection[] = [
  {
    id: 'what-we-collect',
    heading: 'What we collect',
    body: (
      <>
        <h3>When you create an account</h3>
        <ul>
          <li>
            <strong>Your email address and name.</strong> The email is your sign-in identity and
            where tickets are delivered.
          </li>
          <li>
            <strong>A phone number, if you give one.</strong> Optional. Used for ticket and refund
            SMS, and for nothing else. Leave it blank and we simply skip the SMS.
          </li>
          <li>
            <strong>A profile photo, if you upload one.</strong>
          </li>
          <li>
            <strong>A password,</strong> stored only as a one-way hash. We cannot read it and could
            not tell you what it is.
          </li>
        </ul>
        <p>
          If you sign in with Google we receive your email address, name and profile picture from
          Google — not your Google password, and no access to anything else in your account.
        </p>

        <h3>When you book</h3>
        <ul>
          <li>What you booked, how many, and what you paid.</li>
          <li>
            <strong>Payment reference ids from our payment provider</strong> — an order id, a
            payment id, a refund id where one exists.
          </li>
          <li>The ticket issued to you, and its signed entry code.</li>
        </ul>

        <h3>When you attend</h3>
        <p>
          Scanning your ticket at the gate records that it was used, when, at which entrance, and by
          which staff account. This is an attendance record and it is personal data — the organizer
          of that event can see it, because they need to know who came in.
        </p>

        <h3>On your device</h3>
        <p>
          Your theme choice, your selected city, recent searches and events you have saved while
          signed out are kept in your browser&apos;s own storage. They do not leave your device
          unless you sign in, at which point saved events are merged into your account so they
          follow you to another one.
        </p>
      </>
    ),
  },
  {
    id: 'what-we-dont-collect',
    heading: 'What we deliberately do not collect',
    body: (
      <>
        <p>This list is short and specific, and each item is a decision:</p>
        <ul>
          <li>
            <strong>No card details, ever.</strong> Card and UPI details are entered on the payment
            provider&apos;s own form and never reach our servers. We store reference ids and
            amounts.
          </li>
          <li>
            <strong>No personal data in your ticket code.</strong> The signed code on your QR
            contains two identifiers and nothing else — no name, no email, no phone. A photograph of
            your ticket cannot leak who you are.
          </li>
          <li>
            <strong>No tracking or advertising cookies, and no third-party analytics.</strong> There
            is no Google Analytics tag, no advertising pixel and no session-recording script on this
            site. See the <Link href="/cookies">cookie notice</Link> for the full list of what is
            stored, which is short enough to read.
          </li>
          <li>
            <strong>No location tracking.</strong> If you use &quot;near me&quot;, your coordinates
            are resolved to a city name <em>in your browser</em> against a list we ship. The
            coordinates themselves are never transmitted; only the city name is kept, and only on
            your device.
          </li>
          <li>
            <strong>No profile of your browsing.</strong> Nothing records which events you looked
            at.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'why',
    heading: 'Why we hold it',
    body: (
      <>
        <ul>
          <li>
            <strong>To perform the contract</strong> — issue your ticket, admit you, take payment,
            refund you. This is the bulk of it.
          </li>
          <li>
            <strong>Because the law requires it</strong> — financial records have statutory
            retention periods and we cannot delete a transaction on request.
          </li>
          <li>
            <strong>To keep the platform safe</strong> — detecting fraudulent bookings and abuse.
          </li>
          <li>
            <strong>With your consent</strong> — push notifications, and calendar access if you
            connect Google Calendar. Both are opt-in and both can be withdrawn.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'sharing',
    heading: 'Who else sees it',
    body: (
      <>
        <p>
          We do not sell your data, and we do not share it for anybody else&apos;s marketing. It
          reaches four kinds of recipient:
        </p>
        <h3>The organizer of an event you booked</h3>
        <p>
          They see your name, your email, what you booked and whether you attended — they are the
          party actually running the event, and they need it to admit you and to contact you if
          something changes. They see this for <em>their own events only</em>.
        </p>
        <h3>Our payment provider</h3>
        <p>
          Razorpay processes the payment and holds the card or UPI details we never see. Their
          privacy policy governs that part.
        </p>
        <h3>Service providers we operate on</h3>
        <ul>
          <li>Email and SMS delivery, to send you your ticket.</li>
          <li>Cloud hosting and file storage, for the site and uploaded images.</li>
          <li>
            Google, if you sign in with Google, connect a calendar, or view a venue map. Map lookups
            are proxied through our servers, so your browser does not talk to Google directly and
            your IP address is not handed to them by the map.
          </li>
          <li>
            Your browser vendor&apos;s push service, if you enable notifications — this is how a
            push reaches your device at all.
          </li>
        </ul>
        <h3>Where the law requires it</h3>
        <p>A valid legal order, or where necessary to establish or defend a legal claim.</p>
      </>
    ),
  },
  {
    id: 'security',
    heading: 'How it is protected',
    body: (
      <>
        <ul>
          <li>Everything is transmitted over TLS.</li>
          <li>Passwords are stored as one-way hashes and are not recoverable.</li>
          <li>
            Email verification codes are stored as hashes too, never in readable form — so nobody
            with access to a database backup can complete somebody else&apos;s registration.
          </li>
          <li>
            Third-party access tokens, such as a Google Calendar connection, are encrypted at rest.
          </li>
          <li>
            Payment webhooks are cryptographically signed and verified before anything is acted on.
            An unsigned message claiming a payment succeeded is rejected.
          </li>
        </ul>
        <p>
          No system is perfect. If you believe your account has been accessed by somebody else,
          contact us immediately and change your password.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    heading: 'How long we keep it',
    body: (
      <>
        <ul>
          <li>
            <strong>Your account:</strong> while it is open, and for a short period after closure to
            handle disputes.
          </li>
          <li>
            <strong>Bookings, payments and refunds:</strong> retained for the statutory financial
            record-keeping period. These cannot be deleted on request, and that is a legal
            obligation rather than a preference.
          </li>
          <li>
            <strong>Attendance records:</strong> kept while the organizer needs them for
            reconciliation and reporting.
          </li>
          <li>
            <strong>Push subscriptions:</strong> until you turn notifications off or the browser
            invalidates them.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'your-rights',
    heading: 'Your rights',
    body: (
      <>
        <p>
          Under India&apos;s Digital Personal Data Protection Act you can ask us for a copy of the
          personal data we hold about you, ask us to correct it, and ask us to erase it where we are
          not required to keep it.
        </p>
        <p>
          <strong>How to exercise them:</strong> email us from the address on your account and say
          what you want. We respond within 30 days. Some of it you can already do yourself — your
          name, photo and other profile details are editable in{' '}
          <Link href="/account/settings">account settings</Link>, and notification permissions are
          revocable in your browser at any time.
        </p>
        {/* A "download my data" / "delete my account" button does not exist,
            and this page must not imply one — a false statement here is a
            false statement to a regulator. The wording states the route that
            DOES work rather than announcing the absence of the one that does
            not; the obligation is to serve the request, not to ship a
            particular control, and the email address is genuinely how it is
            served. If a self-service export ships, this paragraph names it. */}

        <p>
          If we cannot fully erase something because a financial record must be retained, we will
          tell you specifically what is being kept and why, rather than refusing the request as a
          whole.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    heading: 'Children',
    body: (
      <p>
        Accounts are for people aged 18 and over. We do not knowingly collect data from children. If
        you believe a child has created an account, tell us and we will remove it. Individual events
        may have their own age restrictions, which are shown on the listing and enforced by the
        organizer at the door.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact and complaints',
    body: (
      <>
        <p>
          Questions about this policy, or a request about your data, go through{' '}
          <Link href="/contact">the contact page</Link>, which lists every channel that is actually
          monitored.
        </p>
        <p>
          The DPDP Act requires us to name a Grievance Officer for complaints about how personal
          data is handled. That appointment is being made as part of registering the operating
          entity, and the name and contact details will be published here — rather than leave
          this paragraph visibly incomplete than name a role nobody yet holds.
        </p>
        <p>
          If we do not resolve your complaint, you may escalate it to the Data Protection Board of
          India.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <StaticPage>
      <PageHeader
        eyebrow="Legal"
        title="Privacy policy"
        lead="What we collect, why we hold it, who else sees it — and the specific things we deliberately do not store."
        illustration={<SpotPolicy />}
      >
        <LastReviewed
          date="7 August 2026"
          note={`Written from what ${BRAND_NAME} actually stores rather than from a template — every field named here is one we hold.`}
        />
      </PageHeader>

      {/* No intro paragraph telling the reader which section is worth
          reading and how this policy compares to other policies. The sections
          are titled; somebody looking for what we do not collect can see it in
          the contents. */}
      <LegalDocument sections={SECTIONS} />
    </StaticPage>
  );
}
