import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, CreditCard, QrCode, Ticket, UserRound, Wallet } from 'lucide-react';
import { SpotSupport } from '@/components/illustrations/spots';
import { CtaBand, FaqList, PageHeader, StaticPage, type Faq } from '@/components/pages/page-shell';
import { BRAND_NAME } from '@/lib/brand';
import { JsonLd } from '@/lib/seo/json-ld';
import { pageMetadata } from '@/lib/seo/metadata';

/**
 * ── THE HELP CENTRE ───────────────────────────────────────────────────────
 *
 * `/help` was linked from the footer of every page and 404'd. This is the
 * highest-traffic page of the ten by some distance: "how do I get a refund" and
 * "I paid and got no ticket" are the two things a ticketing platform is asked
 * more than anything else, and both were previously answerable only by writing
 * to a person.
 *
 * ── EVERY ANSWER HERE IS A FACT ABOUT THE BACKEND ─────────────────────────
 *
 * That is what makes this page worth having rather than filler. The platform
 * genuinely does refund a payment it cannot ticket, genuinely does reconcile a
 * checkout whose browser closed, genuinely does refuse a second scan of the
 * same code under a row lock. Each of those is a real guarantee and each is
 * what somebody arriving here in a panic actually needs to be told.
 *
 * Where the platform does NOT do something — transfer a ticket, apply a promo
 * code, offer a self-service refund request — the answer says so directly
 * instead of routing the reader into a support loop that ends in the same
 * sentence three days later.
 *
 * ── ONE PAGE, NOT A KNOWLEDGE BASE ────────────────────────────────────────
 *
 * No article routes, no search over articles, no categories with their own
 * URLs. There are twenty-odd answers; a search box over twenty answers is
 * furniture, and the browser's own Ctrl+F already works because the FAQ is
 * built on native `<details>` (which find-in-page can open). The category rail
 * is anchor links to sections on this page.
 *
 * ── FAQPage JSON-LD ───────────────────────────────────────────────────────
 *
 * The one place on this site where structured data earns its keep beyond the
 * event pages: these questions are exactly the long-tail queries people type
 * into Google, and a rich result answers them before the click. Only the
 * plain-text answers are emitted — an answer containing a `<Link>` is
 * flattened, because JSON-LD wants text and a half-serialised React element is
 * how you get a malformed rich result.
 */

export const metadata: Metadata = {
  ...pageMetadata(
    'Help centre',
    'Answers about booking, tickets, refunds, entry and your account — including what happens if a payment succeeds but your ticket does not arrive.',
  ),
  alternates: { canonical: '/help' },
};

type Topic = {
  id: string;
  title: string;
  blurb: string;
  icon: React.ReactNode;
  faqs: readonly Faq[];
  /** Plain-text mirrors for JSON-LD, for answers whose JSX contains links. */
  structured: readonly { q: string; a: string }[];
};

const TOPICS: readonly Topic[] = [
  {
    id: 'booking',
    title: 'Booking tickets',
    blurb: 'Holds, limits, and what the countdown means',
    icon: <Ticket className="size-5" aria-hidden />,
    faqs: [
      {
        q: 'Why is there a countdown when I select tickets?',
        a: (
          <p>
            Selecting tickets reserves them for you, and the countdown is how long that reservation
            lasts. It exists so somebody else cannot buy the seats out from under you while you are
            entering payment details — and so an abandoned checkout does not lock up inventory
            forever. If it runs out, the tickets go back on sale and you can simply start again.
          </p>
        ),
      },
      {
        q: 'Can I book without creating an account?',
        a: (
          <p>
            No. A ticket is issued to a person and carries a code that admits exactly one person
            once, so it needs somewhere to live and somebody to belong to. It also means you can
            find your ticket again if the email goes missing. Signing up takes an email address and
            a six-digit code.
          </p>
        ),
      },
      {
        q: 'Is there a limit on how many tickets I can buy?',
        a: (
          <p>
            Yes, and the organizer sets it per ticket type. If you hit the limit the stepper stops
            there rather than failing at payment. It exists to keep tickets away from bulk buyers.
          </p>
        ),
      },
      {
        q: 'Do you have promo codes or discounts?',
        a: (
          <p>
            Not today. There is no promo code field in the checkout because there is nothing behind
            it — rather than show a box that could only ever answer &quot;invalid code&quot;. If
            discounting is introduced you will see the field appear.
          </p>
        ),
      },
      {
        q: 'Why does the price not change at the last step?',
        a: (
          <p>
            Because our fee is taken out of what you pay rather than added on top of it. The number
            on the event page is the number you are charged. There is no booking surcharge and no
            convenience fee appended at checkout.
          </p>
        ),
      },
    ],
    structured: [
      {
        q: 'Why is there a countdown when I select tickets?',
        a: 'Selecting tickets reserves them for you and the countdown is how long that reservation lasts. It stops someone else buying the seats while you enter payment details, and stops an abandoned checkout locking inventory up. If it runs out the tickets return to sale and you can start again.',
      },
      {
        q: 'Can I book without creating an account?',
        a: 'No. A ticket is issued to a person and carries a code that admits one person once, so it needs an owner. It also means you can find your ticket again if the email goes missing.',
      },
      {
        q: 'Is there a limit on how many tickets I can buy?',
        a: 'Yes. The organizer sets a limit per ticket type, and the selector stops at it rather than failing at payment.',
      },
      {
        q: 'Why does the price not change at the last step?',
        a: 'Our fee is taken out of what you pay rather than added on top. The price on the event page is what you are charged — there is no booking surcharge or convenience fee at checkout.',
      },
    ],
  },
  {
    id: 'payment',
    title: 'Payments',
    blurb: 'What happens if something goes wrong mid-payment',
    icon: <CreditCard className="size-5" aria-hidden />,
    faqs: [
      {
        q: 'I paid but did not get a ticket. What now?',
        a: (
          <>
            <p>
              <strong>Wait a few minutes and check again</strong> — confirmation occasionally lags
              the payment. Your tickets appear in <Link href="/account/tickets">your tickets</Link>{' '}
              the moment it lands.
            </p>
            <p>
              If it still has not arrived, you do not need to do anything. The platform
              independently re-checks every unresolved payment against the payment provider on a
              schedule, using a reference it stored itself — so a payment that succeeded while your
              connection dropped is found even if your browser never told us. Whatever comes back,
              one of two things happens: your ticket is issued, or{' '}
              <strong>you are refunded in full, automatically</strong>. Money is never kept for a
              ticket that was not delivered.
            </p>
          </>
        ),
      },
      {
        q: 'I closed the tab right after paying. Did I lose the money?',
        a: (
          <p>
            No. This is the specific case above, and it is handled without you. The confirmation
            that matters is sent server-to-server by the payment provider and does not depend on
            your browser being open — and where nothing arrives at all, the scheduled reconciliation
            asks the provider directly. You will get either a ticket or a refund.
          </p>
        ),
      },
      {
        q: 'Which payment methods can I use?',
        a: (
          <p>
            UPI, credit and debit cards, net banking and wallets, through Razorpay. The payment form
            is Razorpay&apos;s own — your card and UPI details are entered there and never reach us.
          </p>
        ),
      },
      {
        q: 'Do you store my card details?',
        a: (
          <p>
            No, never. We hold reference ids from the payment provider and the amount, and nothing
            else. There is no card number anywhere in this system.
          </p>
        ),
      },
      {
        q: 'I was charged twice.',
        a: (
          <p>
            One of them will not have produced a booking, and it will be refunded automatically for
            the reason above. If two separate bookings were created, contact us with both references
            and we will refund the one you did not want.
          </p>
        ),
      },
    ],
    structured: [
      {
        q: 'I paid but did not get a ticket. What now?',
        a: 'Wait a few minutes and check your tickets — confirmation occasionally lags the payment. If it still has not arrived you need do nothing: the platform re-checks every unresolved payment against the provider on a schedule, and you will either be issued the ticket or refunded in full automatically. Money is never kept for an undelivered ticket.',
      },
      {
        q: 'I closed the tab right after paying. Did I lose the money?',
        a: 'No. The confirmation that matters is sent server-to-server by the payment provider and does not depend on your browser being open. Where nothing arrives at all, a scheduled reconciliation asks the provider directly. You will get either a ticket or a refund.',
      },
      {
        q: 'Which payment methods can I use?',
        a: 'UPI, credit and debit cards, net banking and wallets, through Razorpay. Card and UPI details are entered on Razorpay’s own form and never reach us.',
      },
      {
        q: 'Do you store my card details?',
        a: 'No. We hold payment provider reference ids and the amount, and nothing else. There is no card number anywhere in the system.',
      },
    ],
  },
  {
    id: 'tickets',
    title: 'Your tickets',
    blurb: 'Finding them, and what the QR code is',
    icon: <QrCode className="size-5" aria-hidden />,
    faqs: [
      {
        q: 'Where do I find my ticket?',
        a: (
          <p>
            In <Link href="/account/tickets">your tickets</Link>, any time, on any device you are
            signed in on. We also email it. You do not need the email — the account is the source of
            truth, and the QR there is the same one.
          </p>
        ),
      },
      {
        q: 'Do I need to print it?',
        a: (
          <p>
            No. Show the QR on your phone at the gate. Screen brightness up helps more than anything
            else, especially outdoors.
          </p>
        ),
      },
      {
        q: 'Can I send my ticket to a friend?',
        a: (
          <p>
            Not through the platform — there is no transfer feature today, and forwarding the QR is
            not a substitute: the code admits one person once, so whoever gets scanned first gets in
            and the other is refused at the gate. If you need to change who is attending, contact
            the organizer.
          </p>
        ),
      },
      {
        q: 'What is actually in the QR code?',
        a: (
          <p>
            Two identifiers and a cryptographic signature — no name, no email, no phone number. A
            photograph of your ticket cannot reveal who you are. Altering the code in any way
            invalidates the signature and it will not scan.
          </p>
        ),
      },
      {
        q: 'My phone died at the entrance.',
        a: (
          <p>
            Find the gate staff. They can look you up against the booking, though this depends on
            the organizer&apos;s own process. Carry ID matching the name on the booking — it makes
            this much faster.
          </p>
        ),
      },
    ],
    structured: [
      {
        q: 'Where do I find my ticket?',
        a: 'In your account under My tickets, on any device you are signed in on. We email it as well, but the account is the source of truth and carries the same QR.',
      },
      {
        q: 'Do I need to print my ticket?',
        a: 'No. Show the QR on your phone at the gate. Turning screen brightness up helps more than anything else, especially outdoors.',
      },
      {
        q: 'Can I transfer my ticket to someone else?',
        a: 'Not through the platform — there is no transfer feature today. Forwarding the QR does not work either: the code admits one person once, so whoever is scanned first gets in and the second is refused. Contact the organizer if the attendee needs to change.',
      },
      {
        q: 'What is in the QR code on my ticket?',
        a: 'Two identifiers and a cryptographic signature. No name, no email and no phone number — a photograph of a ticket cannot reveal who you are. Altering the code invalidates the signature.',
      },
    ],
  },
  {
    id: 'entry',
    title: 'Getting in',
    blurb: 'Scanning, timing and being refused',
    icon: <CalendarClock className="size-5" aria-hidden />,
    faqs: [
      {
        q: 'When can I arrive?',
        a: (
          <p>
            Gates open before the start time and the scan window stays open for a period after it —
            the event page shows the specific timings. Arriving very early or very late can mean the
            scanner refuses the ticket simply because it is outside that window, which staff can
            resolve.
          </p>
        ),
      },
      {
        q: 'My ticket was refused. Why?',
        a: (
          <>
            <p>There are only a few reasons, and the scanner names the one that applied:</p>
            <ul>
              <li>
                <strong>Already used</strong> — it has been scanned once. This is also what happens
                to a screenshot of a ticket somebody else already used.
              </li>
              <li>
                <strong>Wrong event</strong> — a valid ticket, at the wrong gate.
              </li>
              <li>
                <strong>Refunded or cancelled</strong> — a refunded ticket stops working the moment
                the refund is recorded.
              </li>
              <li>
                <strong>Outside the entry window</strong> — too early, or well after the end.
              </li>
              <li>
                <strong>Invalid</strong> — the code does not carry a valid signature.
              </li>
            </ul>
          </>
        ),
      },
      {
        q: 'Can two people use one ticket?',
        a: (
          <p>
            No, and this is enforced rather than discouraged. The moment a code is scanned it is
            marked used, and a second scan is refused — even if both happen in the same instant at
            two different gates.
          </p>
        ),
      },
    ],
    structured: [
      {
        q: 'When can I arrive at the venue?',
        a: 'Gates open before the start time and the scan window stays open for a period afterwards; the event page shows the specific timings. Arriving very early or very late can mean the scanner refuses the ticket for being outside the window, which staff can resolve.',
      },
      {
        q: 'Why was my ticket refused at the gate?',
        a: 'The scanner names the reason: already used, wrong event, refunded or cancelled, outside the entry window, or an invalid signature. A screenshot of a ticket somebody has already used shows as already used.',
      },
      {
        q: 'Can two people use one ticket?',
        a: 'No. The moment a code is scanned it is marked used and a second scan is refused, even if both happen at the same instant at two different gates.',
      },
    ],
  },
  {
    id: 'refunds',
    title: 'Refunds and cancellations',
    blurb: 'When you get money back, and how fast',
    icon: <Wallet className="size-5" aria-hidden />,
    faqs: [
      {
        q: 'The event was cancelled. Do I get a refund?',
        a: (
          <p>
            Yes — the full amount you paid, our fee included. We do not keep a service charge on an
            event that did not happen. You will get an email when it is issued.
          </p>
        ),
      },
      {
        q: 'I cannot go any more. Can I get a refund?',
        a: (
          <p>
            That is the organizer&apos;s decision, and their policy is on the event page. Many
            events do not refund a change of mind, because a seat released the night before usually
            goes unsold. Where an organizer is willing, contact us and we will pass it on. See the{' '}
            <Link href="/refunds">refund policy</Link> for the detail.
          </p>
        ),
      },
      {
        q: 'How do I request a refund?',
        a: (
          <p>
            Open <Link href="/account/tickets">your tickets</Link>, find the one you want to cancel
            and press <strong>Request refund</strong>. Say why in a sentence — the organizer reads
            it and decides, and the status stays on that ticket so you can see where it is. You get
            an email at each step. One request covers a whole booking, so tickets bought together
            are cancelled together.
          </p>
        ),
      },
      {
        q: 'How long does a refund take to arrive?',
        a: (
          <p>
            Typically 5–7 working days for cards, 1–3 for UPI. That window belongs to your bank —
            the refund leaves us within seconds of being issued, and you get an email with a
            reference when it does. If it has not arrived a week after that email, send us the
            reference.
          </p>
        ),
      },
    ],
    structured: [
      {
        q: 'The event was cancelled. Do I get a refund?',
        a: 'Yes, the full amount you paid including our fee. We do not keep a service charge on an event that did not happen.',
      },
      {
        q: 'How long does a refund take to arrive?',
        a: 'Typically 5 to 7 working days for cards and 1 to 3 for UPI. That window belongs to your bank; the refund leaves us within seconds of being issued and you get an email with a reference.',
      },
      {
        q: 'Can I get a refund if I simply cannot attend?',
        a: 'That is the organizer’s decision and their policy is shown on the event page. Many events do not refund a change of mind. Ask from your tickets page — press Request refund on the ticket, say why, and the organizer decides.',
      },
    ],
  },
  {
    id: 'account',
    title: 'Your account',
    blurb: 'Sign-in, verification and your data',
    icon: <UserRound className="size-5" aria-hidden />,
    faqs: [
      {
        q: 'I did not get my verification code.',
        a: (
          <p>
            Check spam first. You can request another from the same screen — each new code replaces
            the last, so use the most recent one. If nothing arrives after two attempts, the address
            may have a typo; contact us and we will look.
          </p>
        ),
      },
      {
        q: 'Why do I have to verify my email before signing in?',
        a: (
          <p>
            Because your ticket is delivered there, and because a signed-in session for an address
            nobody controls is an account somebody else can claim. We do not issue a session until
            the address is proven — verifying <em>is</em> the sign-in, not a step before one.
          </p>
        ),
      },
      {
        q: 'Can I sign in with Google?',
        a: (
          <p>
            Yes. Other providers shown in the panel state plainly when they are not connected rather
            than spinning — an authentication button that appears to work is the worst thing to
            fake, because a ticket and a payment are attributed to whoever it says you are.
          </p>
        ),
      },
      {
        q: 'How do I delete my account or download my data?',
        a: (
          <p>
            Email us from the address on your account and we will action it within 30 days. Note
            that bookings and payments have a statutory retention period and cannot be deleted on
            request; we will tell you specifically what is being kept. See the{' '}
            <Link href="/privacy">privacy policy</Link>.
          </p>
        ),
      },
    ],
    structured: [
      {
        q: 'I did not receive my verification code.',
        a: 'Check spam first, then request another from the same screen. Each new code replaces the last, so use the most recent. If nothing arrives after two attempts the address may have a typo — contact us.',
      },
      {
        q: 'Why do I have to verify my email before signing in?',
        a: 'Your ticket is delivered to that address, and a session for an address nobody controls is an account somebody else can claim. No session is issued until the address is proven, so verifying is the sign-in rather than a step before it.',
      },
    ],
  },
];

export default function HelpPage() {
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: TOPICS.flatMap((topic) =>
      topic.structured.map((entry) => ({
        '@type': 'Question',
        name: entry.q,
        acceptedAnswer: { '@type': 'Answer', text: entry.a },
      })),
    ),
  };

  return (
    <StaticPage>
      <JsonLd data={faqJsonLd} />

      <PageHeader
        eyebrow="Support"
        title="Help centre"
        lead="Answers to the things people actually ask us. If yours is not here, a person reads every message that comes in."
        illustration={<SpotSupport />}
      />

      {/* The category rail: anchors to sections on this page, not routes.
          Twenty answers do not need twenty URLs, and a jump link keeps
          find-in-page working across the whole set. */}
      <nav aria-label="Help topics">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TOPICS.map((topic) => (
            <li key={topic.id}>
              <a
                href={`#${topic.id}`}
                className="flex h-full items-start gap-3 rounded-xl border border-border bg-surface p-card shadow-sm transition duration-fast ease-out hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"
                  aria-hidden
                >
                  {topic.icon}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-body font-semibold text-foreground">{topic.title}</span>
                  <span className="text-body-sm text-muted-foreground">{topic.blurb}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {TOPICS.map((topic) => (
        <section key={topic.id} id={topic.id} className="scroll-mt-24">
          <div className="flex flex-col gap-1.5 sm:gap-2">
            <span className="h-0.5 w-8 rounded-full bg-foreground sm:w-10" aria-hidden />
            <h2 className="text-h4 sm:text-h3">{topic.title}</h2>
          </div>
          <FaqList items={topic.faqs} className="mt-5" />
        </section>
      ))}

      <CtaBand
        title="Still stuck?"
        body={`Tell us what happened and include your booking reference if you have one — it is the fastest way to an answer. Every message reaches a person at ${BRAND_NAME}.`}
        primary={{ href: '/contact', label: 'Contact us' }}
        secondary={{ href: '/account/tickets', label: 'Find my tickets' }}
      />
    </StaticPage>
  );
}
