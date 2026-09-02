'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Check, Clock3, Copy, Loader2, Mail, Ticket } from 'lucide-react';
import { SpotTicketIssued } from '@/components/illustrations/spots';
import { Button } from '@/components/ui/button';
import { fetchBooking } from '@/lib/api/bookings';
import { verifyPayment } from '@/lib/api/payments';
import { useAuth } from '@/lib/auth/auth-provider';
import { fetchTicketsForBooking } from '@/lib/booking/tickets';
import { formatFromPrice } from '@/lib/discovery/format';
import { eventPath } from '@/lib/events/ref';
import { CTA_PILL_LG } from './cta';
import { cn } from '@/lib/utils/cn';
import { useBooking } from './booking-context';
import { Celebration } from './celebration';
import { Rise, StepTransition } from './motion';
import { TicketCarousel } from './ticket-carousel';

/**
 * After payment — and it waits for the BACKEND to say so.
 *
 * The provider's success callback fired in the browser, which is a hint, not
 * proof. The backend confirms a booking only from a statement by the provider
 * itself, so this screen polls `GET /bookings/{id}` until the status it reads is
 * genuinely `paid`. Showing a tick because a client callback fired would mean
 * congratulating someone for a payment the system hasn't recorded — and on this
 * platform, the tickets are issued by that same confirmation step.
 *
 * The wait is normally a second or two. It is shown as "confirming", not as a
 * spinner with no explanation, because someone who has just paid needs to know
 * that the delay is the system checking rather than the money vanishing.
 *
 * ── THE RE-NUDGE ──────────────────────────────────────────────────────────
 *
 * Where no public webhook can reach the backend (a laptop, a not-yet-DNS'd
 * deployment), the only thing that tells it a real payment was captured is
 * `POST /payments/verify` — and the pay step fires that exactly once, without
 * awaiting it. One dropped request was therefore the difference between a
 * ticket and nothing, silently. If the payment id came through in the URL, this
 * screen re-asks on the third and sixth poll: still not the browser asserting
 * payment (the server goes and asks the provider, and uses only its answer),
 * just a retry of a request that has no business being fire-and-forget on the
 * money path.
 *
 * ── AND THEN IT SHOWS THE TICKET ──────────────────────────────────────────
 *
 * The screen used to end at "your QR tickets arrive at your account email" with
 * two links, both AWAY from the ticket: browse more events, or back to the
 * event. So the one artifact the buyer needed was somewhere they had not been
 * told about, in an email that may not have arrived. It now renders the actual
 * scannable codes and links to `/account/tickets` as their permanent home.
 *
 * The headline is the biggest type in the funnel (`text-h2 md:text-h1`) — this
 * is the one screen whose whole job is to be read from across a room and
 * believed — and the medallion is the only place a semantic fill appears: green
 * once genuinely paid, neutral while still confirming. Those two states must
 * never look alike, which is why the pending one is not a paler green.
 */

const POLL_MS = 2000;
/**
 * THE POLL BUDGET IS COUNTED IN POLLS, NOT IN WALL-CLOCK SECONDS.
 *
 * It used to be `Date.now() - startedAt > 45s`, and that is a different thing
 * than it looks. Browsers throttle timers in a hidden tab to roughly once a
 * minute, and Razorpay's own flow — plus every UPI payment — takes people OUT
 * of this tab. The clock kept burning while the poll did not fire, so somebody
 * paying by UPI came back to a screen that had already given up, with the
 * booking pinned at `reserved`: no tickets, a hold countdown still ticking, and
 * then "your hold has expired" over a payment that had gone through.
 *
 * Counting actual attempts makes the budget mean what it says — 22 polls really
 * are 22 questions asked — and it cannot be exhausted by a tab nobody is
 * looking at. `refetchOnWindowFocus` is turned back on for this one query for
 * the same reason: returning to the tab is the single best moment to re-ask.
 *
 * Giving up is cosmetic in any case. `payments.reconcile_pending` runs
 * server-side every two minutes and fulfils or refunds regardless of what this
 * browser does — this screen is the fast path, never the only one.
 */
const MAX_POLLS = 22;
/** Poll attempts on which a lost verify nudge is retried. */
const RENUDGE_ON = [3, 6];

export function ConfirmationStep() {
  const { event, setBooking } = useBooking();
  const { status } = useAuth();
  const searchParams = useSearchParams();
  const bookingId = searchParams?.get('booking') ?? null;
  const providerPaymentId = searchParams?.get('pid') ?? null;
  const polls = React.useRef(0);
  const renudged = React.useRef(new Set<number>());

  const query = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: async () => {
      const booking = await fetchBooking(bookingId as string);
      polls.current += 1;
      if (
        booking.status !== 'paid' &&
        providerPaymentId &&
        RENUDGE_ON.includes(polls.current) &&
        !renudged.current.has(polls.current)
      ) {
        renudged.current.add(polls.current);
        // Best-effort, and deliberately not awaited: the answer that matters
        // arrives through the next poll of the booking itself.
        void verifyPayment(providerPaymentId).catch(() => {});
      }
      return booking;
    },
    enabled: Boolean(bookingId) && status === 'authenticated',
    // The global default is `false`, which is right for every other query and
    // wrong for this one. See the POLL BUDGET note below: coming back to the
    // tab is exactly the moment to ask again.
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (q) => {
      if (q.state.data?.status === 'paid') return false;
      if (polls.current >= MAX_POLLS) return false;
      return POLL_MS;
    },
  });

  const booking = query.data;
  const paid = booking?.status === 'paid';
  // Same budget the poll uses, so the copy and the behaviour cannot disagree.
  const timedOut = !paid && polls.current >= MAX_POLLS;

  // Hand the freshly-fetched booking to the shared summary card.
  //
  // The card holds whatever `POST /bookings` returned, and that is the SUMMARY
  // serializer — no `items`, and `status: 'reserved'` forever. So on this screen
  // it said "No tickets chosen yet." beside a ₹998 total, and kept counting down
  // a hold that had already been converted into tickets. `GET /bookings/{id}` is
  // the DETAIL serializer: it carries the lines and the real status, and it is
  // already being polled here. Publishing it costs nothing and is the only copy
  // on the page that is actually current.
  React.useEffect(() => {
    if (booking) setBooking(booking);
  }, [booking, setBooking]);

  // Only once the BACKEND says paid — the tickets do not exist before that, and
  // asking for them earlier would render an empty state that reads as a loss.
  const tickets = useQuery({
    queryKey: ['booking-tickets', bookingId],
    queryFn: () => fetchTicketsForBooking(bookingId as string),
    enabled: Boolean(bookingId) && paid,
    staleTime: Infinity,
  });

  return (
    <StepTransition stepKey="confirmation" className="flex flex-col gap-block-lg">
      <Rise>
        <div className="relative isolate flex flex-col items-start gap-stack-lg overflow-hidden rounded-2xl border border-border bg-surface p-card-lg shadow-md md:p-8">
          {/* Only once the money is actually confirmed. Playing it while the
              webhook is still in flight would celebrate a payment that might
              still fail — the one lie this screen cannot tell, and the same
              reason the illustration above stays a spinner until `paid`. */}
          {paid ? <Celebration /> : null}
          {/* THE ISSUED TICKET, not a 12px status badge.
              This is the best moment on the platform — somebody has paid and is
              being told they are going — and it had the same mark a form uses
              to say a field validated. The picture is `SpotTicket`'s own stub
              with a seal struck across it, so the object they are handed is the
              object they were choosing.
              While CONFIRMING it stays the spinner: an issued ticket drawn over
              a payment that has not been confirmed yet would be the one lie
              this screen cannot tell. */}
          {paid ? (
            <SpotTicketIssued className="size-28 sm:size-32" />
          ) : (
            <span
              className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
              aria-hidden
            >
              <Loader2 className="size-6 animate-spin" />
            </span>
          )}

          <div className="flex flex-col gap-stack">
            <h1 className="text-h2 md:text-h1">
              {paid ? "You're going" : 'Confirming your payment'}
            </h1>
            <p className="text-body text-muted-foreground" role="status">
              {paid
                ? `Your tickets for ${event.title} are issued. They're below, and in your account.`
                : timedOut
                  ? 'This is taking longer than usual. Your payment is safe — the confirmation is processed on our side and your tickets will appear in your account shortly.'
                  : 'We are waiting for the payment provider to confirm. This usually takes a moment.'}
            </p>
          </div>

          {/* ── THE TWO FACTS SOMEBODY COMES BACK FOR ────────────────────
              These were a `text-caption text-muted-foreground` list — the
              quietest type on the screen — for the reference every support
              conversation starts with and the amount that will appear on a
              statement. They are a receipt strip now, and the reference is
              TAPPABLE TO COPY, because the alternative on a phone is reading
              eight characters aloud or screenshotting them. */}
          {booking ? (
            <dl className="flex w-full max-w-sm flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface text-body-sm">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-muted-foreground">Booking</dt>
                <dd>
                  <CopyableRef value={booking.id} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <dt className="text-muted-foreground">Paid</dt>
                <dd className="font-semibold tabular-nums text-foreground">
                  {formatFromPrice(booking.total_amount)}
                </dd>
              </div>
            </dl>
          ) : null}

          {/* ── ONE ACTION, THEN TWO WAYS OUT ────────────────────────────
              Three pills in a `flex-wrap` stacked into three ragged rows on a
              phone — each a different width, all reading as choices of equal
              standing. Only one of them is what somebody wants here, and the
              other two lead AWAY from the thing that was just bought. So the
              ticket gets the full-width press and the exits share a quieter
              row beneath it. */}
          <div className="flex w-full max-w-sm flex-col gap-3">
            <Button asChild size="lg" className={cn(CTA_PILL_LG, 'w-full')}>
              <Link href="/account/tickets">View my tickets</Link>
            </Button>
            {/* The two exits are LINKS, not pills.
                As pills they were `flex-1` in a row, and a pill will not shrink
                below its own label — so "Back to the event" ran off the right
                edge of a 390px screen, clipped mid-word, inside a card that had
                itself overflowed. Three stacked full-width pills was the other
                option and it gives three actions the same weight when only one
                of them is what somebody wants after paying.
                Links carry both exits in one line, in the register they belong
                to: quiet, available, plainly secondary to the ticket. */}
            <div className="flex items-center justify-center gap-4 text-body-sm">
              <Link
                href="/events"
                className="rounded text-muted-foreground underline-offset-4 transition-colors duration-fast hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Find your next event
              </Link>
              <span aria-hidden className="text-border-strong">
                ·
              </span>
              <Link
                href={eventPath(event)}
                className="rounded text-muted-foreground underline-offset-4 transition-colors duration-fast hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Back to the event
              </Link>
            </div>
          </div>
        </div>
      </Rise>

      {paid ? (
        <Rise index={1}>
          <section className="flex flex-col gap-stack-lg" aria-labelledby="tickets-heading">
            <div className="flex flex-col gap-1">
              <h2 id="tickets-heading" className="text-h3">
                {tickets.data?.length === 1 ? 'Your ticket' : 'Your tickets'}
              </h2>
              <p className="text-body-sm text-muted-foreground">
                Swipe through them. Show one code at the gate — each admits one person, once.
              </p>
            </div>

            {tickets.isPending ? (
              <div className="skeleton h-72 w-full rounded-2xl" aria-hidden />
            ) : tickets.data?.length ? (
              <TicketCarousel tickets={tickets.data} eventTitle={event.title} />
            ) : (
              // Issued, but this page of /me/tickets did not carry them (a very
              // large account). Say where they are rather than implying a loss.
              <p className="rounded-xl border border-border bg-sunken p-card text-body-sm text-muted-foreground">
                Your tickets are issued and waiting in{' '}
                <Link href="/account/tickets" className="underline">
                  your account
                </Link>
                , and a copy is on its way to your email.
              </p>
            )}
          </section>
        </Rise>
      ) : null}

      <Rise index={2}>
        {/* Three full-width CARDS for three one-line facts filled most of a
            phone screen with reassurance nobody had asked for twice. Rows on
            mobile, cards from `sm` where there is room to set them side by
            side. */}
        <ul className="flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:gap-stack-lg">
          {[
            {
              icon: Mail,
              title: 'Emailed to you',
              body: 'A PDF with the same QR arrives at your account email.',
            },
            {
              icon: Ticket,
              title: 'Always in your account',
              body: 'Every ticket you hold lives under Account → Tickets.',
            },
            {
              icon: Clock3,
              title: 'Arrive a little early',
              body: 'Scanning opens shortly before the start.',
            },
          ].map((item) => (
            <li
              key={item.title}
              className="flex items-start gap-3 rounded-xl border border-border bg-surface p-card shadow-sm sm:flex-col sm:gap-2"
            >
              <item.icon className="mt-0.5 size-5 shrink-0 text-foreground-subtle" aria-hidden />
              <div className="flex min-w-0 flex-col gap-0.5 sm:gap-2">
                <p className="text-body-sm font-medium text-foreground">{item.title}</p>
                <p className="text-caption text-muted-foreground">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Rise>
    </StepTransition>
  );
}

/**
 * The booking reference, and a press that copies it.
 *
 * This is the string every support conversation opens with. On a phone the
 * alternative to copying it is reading eight characters off a screen or taking
 * a screenshot of them, which is why it is a control rather than a label.
 *
 * The FULL id goes to the clipboard while only the short prefix is shown: the
 * prefix is what the platform quotes back at people, and the whole id is what
 * anyone looking it up actually needs.
 *
 * `navigator.clipboard` is absent on an insecure origin and can be refused
 * outright, so a failure leaves the label exactly as it was — no error, no
 * false "Copied". Nothing here is lost by the press not working; the reference
 * is still on screen and still selectable.
 */
function CopyableRef({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
      className="inline-flex items-center gap-1.5 rounded-md font-mono text-body-sm text-foreground transition-colors duration-fast hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {value.slice(0, 8)}
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : (
        <Copy className="size-3.5 text-foreground-subtle" aria-hidden />
      )}
      <span className="sr-only">{copied ? 'Booking reference copied' : 'Copy booking reference'}</span>
    </button>
  );
}
