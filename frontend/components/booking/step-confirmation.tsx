'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Copy,
  Loader2,
  MapPin,
  Receipt,
  Ticket as TicketIcon,
  TicketX,
} from 'lucide-react';
import { fetchBooking } from '@/lib/api/bookings';
import { bumpAllAttemptsForEvent } from '@/lib/booking/attempt';
import { verifyPayment } from '@/lib/api/payments';
import { directionsUrl } from '@/lib/api/maps';
import {
  REFUND_REQUEST_LABELS,
  fetchMyRefundRequests,
  type RefundRequest,
} from '@/lib/api/refund-requests';
import type { Booking } from '@/lib/api/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { fetchTicketsForBooking, type IssuedTicket } from '@/lib/booking/tickets';
import { formatMoney } from '@/lib/discovery/format';
import { bookingRef, refundSettled } from '@/lib/ticketing/booking-state';
import { eventPath } from '@/lib/events/ref';
import { BillLines, bookingBill } from '@/components/ticketing/bill-lines';
import { QrCarousel } from '@/components/ticketing/qr-carousel';
import { TicketActions } from '@/components/ticketing/ticket-actions';
import { RemoteImage } from '@/components/ui/remote-image';
import { ShareReceiptDialog } from '@/components/account/share-receipt';
import { RefundRequestDialog } from '@/components/account/refund-request';
import { cn } from '@/lib/utils/cn';
import { useBooking } from './booking-context';
import { Celebration } from './celebration';

/**
 * THE TICKET — the booking's own page, in every state it can be in.
 *
 * Two roads lead here: straight after a payment, and from the bookings list
 * ("View ticket", "Details"). It used to understand only the first — it polled
 * any booking that was not yet `paid`, so an unpaid booking opened from the
 * list spun for 45 seconds and then said the payment was "taking longer than
 * usual", about a payment nobody was making. The list now says where it came
 * from (`from=bookings`), and the page shows what the booking IS.
 *
 * ── ONE CARD, FIVE STATES, THE SAME DIMENSIONS ────────────────────────────
 *
 *   pass       paid, codes live — the QR strip
 *   unpaid     reserved or lapsed — a stamp where the codes would be
 *   refunded   the money came back — a stamp, and the refund below the card
 *   no-active  paid, but nothing left to scan — used, or cancelled
 *   confirming the payment is still being confirmed — the poll
 *
 * Every state draws the SAME ticket: poster and title on top, a perforation,
 * the middle (codes or a stamp), a second perforation, the facts, the
 * reference. A 24px radius and 24px of padding throughout. Only the middle
 * changes, so an unpaid booking and a live pass read as the same object in two
 * conditions — which is what they are.
 *
 * ── REFUNDS LIVE HERE, AND ONLY HERE ──────────────────────────────────────
 *
 * The bookings list says nothing about refunds, by the owner's rule. This page
 * carries all of it: the refund's status and amount under a refunded card, a
 * request's progress under a live one, and the "Request a refund" control that
 * used to sit on every list card.
 *
 * ── THE SCREEN IS DARK, AND THE PAGE AROUND IT IS DARK WITH IT ────────────
 *
 * It is the OBJECT somebody was handed, not a document, so every colour comes
 * from the theme-INDEPENDENT `ink` ramp and the screen looks the same in both
 * themes. The QR is dark-on-light because a camera needs it that way.
 *
 * ── IT STILL POLLS AFTER A PAYMENT, AND THAT IS UNCHANGED ─────────────────
 *
 * The provider's success callback is a hint, not proof. The backend confirms a
 * booking only from a statement by the provider itself, so after a payment this
 * page polls `GET /bookings/{id}` until it genuinely says `paid`, and re-sends
 * a lost verify nudge on the third and sixth poll if the payment id came
 * through. `payments.reconcile_pending` is the server-side backstop either way.
 *
 * ── WHAT THE REFERENCE HAS THAT THIS CANNOT ───────────────────────────────
 *
 * Seat and screen ("GOLD - G20, G21", "SCREEN 1"): no seat map exists, so the
 * honest row is the tier and the count. A rewards block: nothing in this
 * platform earns or stores rewards. A second "booking code" beside the booking
 * id: there is one reference, and it copies the full uuid.
 */

const POLL_MS = 2000;
/**
 * THE POLL BUDGET IS COUNTED IN POLLS, NOT IN WALL-CLOCK SECONDS — a hidden tab
 * is throttled, and UPI takes people OUT of this tab, so a clock kept burning
 * while the poll did not fire.
 */
const MAX_POLLS = 22;
/** Poll attempts on which a lost verify nudge is retried. */
const RENUDGE_ON = [3, 6];

type TicketView = 'confirming' | 'loading' | 'pass' | 'unpaid' | 'refunded' | 'no-active';

export function ConfirmationStep() {
  const { event, setBooking } = useBooking();
  const { status } = useAuth();
  const searchParams = useSearchParams();
  const bookingId = searchParams?.get('booking') ?? null;
  const providerPaymentId = searchParams?.get('pid') ?? null;
  /** Opened from the bookings list — nobody is paying right now. */
  const fromBookings = searchParams?.get('from') === 'bookings';
  const polls = React.useRef(0);
  const renudged = React.useRef(new Set<number>());

  const [billOpen, setBillOpen] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [requestingRefund, setRequestingRefund] = React.useState(false);

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
    // Coming back to the tab is exactly the moment to ask again.
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data?.status === 'paid') return false;
      // A lapsed or cancelled hold can never become paid, and a booking opened
      // from the list is not being paid for — there is nothing to wait for.
      if (data?.status === 'expired' || data?.status === 'cancelled') return false;
      if (fromBookings) return false;
      if (polls.current >= MAX_POLLS) return false;
      return POLL_MS;
    },
  });

  const booking = query.data;
  const paid = booking?.status === 'paid';
  const timedOut = !paid && polls.current >= MAX_POLLS;
  const unpaid =
    Boolean(booking) &&
    !paid &&
    (fromBookings || booking?.status === 'expired' || booking?.status === 'cancelled');

  // Hand the freshly-fetched booking to the shared context. `GET /bookings/{id}`
  // is the DETAIL serializer, which the summary `POST /bookings` returned was not.
  React.useEffect(() => {
    if (booking) setBooking(booking);
    if (paid && event?.id) bumpAllAttemptsForEvent(event.id);
  }, [booking, paid, event?.id, setBooking]);

  // Only once the BACKEND says paid — the tickets do not exist before that.
  const tickets = useQuery({
    queryKey: ['booking-tickets', bookingId],
    queryFn: () => fetchTicketsForBooking(bookingId as string),
    enabled: Boolean(bookingId) && paid,
    staleTime: Infinity,
  });

  // The same query the bookings list uses, so arriving from it is instant.
  const requests = useQuery({
    queryKey: ['account', 'refund-requests'],
    queryFn: () => fetchMyRefundRequests(),
    enabled: Boolean(bookingId) && paid,
    staleTime: 30_000,
  });

  const issued = tickets.data ?? [];
  const request = bookingId
    ? requests.data?.data.find((row) => row.booking_id === bookingId)
    : undefined;

  const view: TicketView = !booking
    ? 'confirming'
    : paid
      ? refundSettled(request)
        ? 'refunded'
        : tickets.isPending
          ? 'loading'
          : issued.length > 0
            ? 'pass'
            : request
              ? 'refunded'
              : 'no-active'
      : unpaid
        ? 'unpaid'
        : 'confirming';

  const live = Boolean(
    booking &&
      booking.status === 'reserved' &&
      booking.hold_expires_at &&
      Date.parse(booking.hold_expires_at) > Date.now(),
  );

  const eventOver = Date.parse(event.ends_at ?? event.starts_at) <= Date.now();
  const canRequestRefund = view === 'pass' && !request && !eventOver && !requests.isPending;

  return (
    // THE WHOLE VIEWPORT, and it owns its own padding — the page renders this
    // directly, not inside `FunnelScreen`, whose back control offers to CANCEL
    // a hold that on a paid booking cannot be cancelled.
    <div className="min-h-dvh bg-ink-950 pb-block-lg text-ink-50">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-8 pt-5">
        <ConfirmHeader title={HEADER_TITLE[view]} />

        {view === 'pass' && !fromBookings ? <Celebration /> : null}

        <Verdict
          view={view}
          timedOut={timedOut}
          live={live}
          holdExpiresAt={booking?.hold_expires_at ?? null}
          refund={request}
          donation={booking?.donation ?? 0}
        />

        {/* ── THE TICKET ──────────────────────────────────────────────── */}
        <TicketCard
          view={view}
          posterUrl={event.poster_url}
          eventTitle={event.title}
          meta={[event.language, event.age_restriction].filter(Boolean).join(' | ')}
          startsAt={event.starts_at}
          endsAt={event.ends_at}
          venue={event.venue}
          city={event.city}
          latitude={event.latitude}
          longitude={event.longitude}
          tickets={issued}
          booking={booking ?? null}
          reference={bookingId ? bookingRef(bookingId) : null}
          bookingId={bookingId}
        />

        {/* ── WHAT IS LEFT TO DO ──────────────────────────────────────── */}
        {view === 'pass' ? (
          <TicketActions event={event} onEmailReceipt={() => setSharing(true)} />
        ) : null}

        {view === 'unpaid' ? (
          <Link
            href={live ? `/booking/${event.id}/review` : `/booking/${event.id}`}
            className="inline-flex h-control-lg w-full items-center justify-center gap-2 rounded-full bg-ink-25 px-pill-lg text-label text-ink-950 transition-colors duration-fast hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 motion-reduce:transition-none"
          >
            {live ? 'Finish payment' : 'Book again'}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}

        {request && (view === 'pass' || view === 'refunded') ? (
          <RefundCard request={request} donation={booking?.donation ?? 0} />
        ) : null}

        {/* ── THE BILL, ONE PRESS AWAY ────────────────────────────────── */}
        {booking && view !== 'confirming' ? (
          <div className="overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-inset ring-ink-800">
            <button
              type="button"
              onClick={() => setBillOpen((open) => !open)}
              aria-expanded={billOpen}
              className="flex w-full items-center gap-3 p-4 text-left transition-colors duration-fast hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
            >
              <Receipt className="size-4 shrink-0 text-success-500" aria-hidden />
              <span className="min-w-0 flex-1 text-body-sm font-medium text-ink-50">
                Order details &amp; bill summary
              </span>
              <span className="shrink-0 text-body-sm font-bold tabular-nums text-ink-25">
                {formatMoney(booking.total_amount)}
              </span>
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-4 shrink-0 text-ink-400 transition-transform duration-fast motion-reduce:transition-none',
                  billOpen && 'rotate-90',
                )}
              />
            </button>
            {billOpen ? (
              <div className="border-t border-ink-800 p-4">
                <BillLines onDark {...bookingBill(booking)} />
                <p className="mt-3 text-caption text-ink-400">
                  {paid
                    ? `Paid on ${formatDateTime(booking.created_at)}.`
                    : 'Not charged — no payment was received for this booking.'}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {canRequestRefund ? (
          <button
            type="button"
            onClick={() => setRequestingRefund(true)}
            className="mx-auto rounded text-body-sm text-ink-400 underline-offset-4 transition-colors duration-fast hover:text-ink-25 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            Request a refund
          </button>
        ) : null}

        {/* ── AND THE WAYS OUT ────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-4 pt-1 text-body-sm">
          <Link
            href="/account/tickets"
            className="rounded text-ink-300 underline-offset-4 transition-colors duration-fast hover:text-ink-25 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            All my bookings
          </Link>
          <span aria-hidden className="text-ink-700">
            ·
          </span>
          <Link
            href={eventPath(event)}
            className="rounded text-ink-300 underline-offset-4 transition-colors duration-fast hover:text-ink-25 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            Back to the event
          </Link>
        </div>

        {view === 'pass' && !fromBookings ? (
          <p className="text-center text-caption text-ink-500">
            A copy with the same code is on its way to your account email.
          </p>
        ) : null}
      </div>

      <ShareReceiptDialog
        target={
          sharing && bookingId
            ? { bookingId, eventTitle: event.title, ticketCount: issued.length || 1 }
            : null
        }
        onClose={() => setSharing(false)}
      />
      <RefundRequestDialog
        target={
          requestingRefund && bookingId
            ? { bookingId, eventTitle: event.title, ticketCount: issued.length || 1 }
            : null
        }
        onClose={() => setRequestingRefund(false)}
      />
    </div>
  );
}

const HEADER_TITLE: Record<TicketView, string> = {
  confirming: 'Confirming payment',
  loading: 'Booking confirmed',
  pass: 'Booking confirmed',
  unpaid: 'Payment incomplete',
  refunded: 'Refund details',
  'no-active': 'Your booking',
};

/* ─────────────────────────────────────────────────────────────── the header ── */

function ConfirmHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {/* BACK TO THE ACCOUNT, NOT `router.back()`. History at this point is the
          payment provider's page or a review screen whose hold has already
          been converted; the one place forward is the list the booking lives
          in. */}
      <Link
        href="/account/tickets"
        aria-label="Your bookings"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-300 transition-colors duration-fast hover:bg-ink-800 hover:text-ink-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </Link>
      <p className="min-w-0 flex-1 truncate text-center text-body font-bold text-ink-25">{title}</p>
      {/* Balances the back control so the title is centred on the SCREEN. The
          share control that used to sit here is in the row under the ticket. */}
      <span aria-hidden className="size-10 shrink-0" />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── the verdict ── */

function Verdict({
  view,
  timedOut,
  live,
  holdExpiresAt,
  refund,
  donation,
}: {
  view: TicketView;
  timedOut: boolean;
  live: boolean;
  holdExpiresAt: string | null;
  refund: RefundRequest | undefined;
  donation: number;
}) {
  const good = view === 'pass' || view === 'loading' || view === 'refunded';
  const Icon =
    view === 'confirming'
      ? Loader2
      : view === 'unpaid'
        ? Clock3
        : view === 'no-active'
          ? TicketIcon
          : Check;

  const heading =
    view === 'confirming'
      ? 'Confirming your payment'
      : view === 'unpaid'
        ? 'Payment incomplete'
        : view === 'refunded'
          ? refundSettled(refund)
            ? 'Refund processed'
            : 'Refund on its way'
          : view === 'no-active'
            ? 'No active passes'
            : 'Booking confirmed';

  const line =
    view === 'confirming'
      ? timedOut
        ? 'This is taking longer than usual. Your payment is safe — the confirmation is processed on our side and your tickets will appear in your account shortly.'
        : 'We are waiting for the payment provider to confirm. This usually takes a moment.'
      : view === 'unpaid'
        ? live && holdExpiresAt
          ? `Nothing has been charged. Your passes are held for ${minutesLeft(holdExpiresAt)}.`
          : 'No payment was received, so nothing was charged.'
        : view === 'refunded'
          ? refund
            ? `${formatMoney(refundAmount(refund, donation))} ${
                refundSettled(refund)
                  ? 'credited to your original payment method.'
                  : 'is being returned to your original payment method.'
              }`
            : 'The tickets on this booking were cancelled.'
          : view === 'no-active'
            ? 'The tickets on this booking were used or cancelled, so there is no code to show.'
            : 'Show this code at the entrance.';

  return (
    <div className="flex flex-col items-center gap-2 pt-2 text-center">
      <span
        aria-hidden
        className={cn(
          'inline-flex size-14 items-center justify-center rounded-full',
          good ? 'bg-success-500 text-ink-950' : 'bg-ink-800 text-ink-300',
        )}
      >
        <Icon
          className={cn(view === 'confirming' ? 'size-6 animate-spin' : 'size-7')}
          strokeWidth={good ? 3 : 2}
        />
      </span>
      <h1 className="text-h3 font-bold text-ink-25">{heading}</h1>
      <p className="text-body-sm text-ink-400" role="status">
        {line}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── the ticket ── */

function TicketCard({
  view,
  posterUrl,
  eventTitle,
  meta,
  startsAt,
  endsAt,
  venue,
  city,
  latitude,
  longitude,
  tickets,
  booking,
  reference,
  bookingId,
}: {
  view: TicketView;
  posterUrl: string | null | undefined;
  eventTitle: string;
  meta: string;
  startsAt: string;
  endsAt: string | null;
  venue: string;
  city: string;
  /** Nullable DECIMALs the API may serialize as strings — see `pin()`. */
  latitude: number | string | null | undefined;
  longitude: number | string | null | undefined;
  tickets: IssuedTicket[];
  booking: Booking | null;
  reference: string | null;
  bookingId: string | null;
}) {
  // What was bought: from the ISSUED tickets while there are codes (so the row
  // agrees with the strip above it), otherwise from the booking's own lines.
  const bought = React.useMemo(() => {
    if (tickets.length) {
      const counts = new Map<string, number>();
      for (const ticket of tickets) {
        counts.set(ticket.ticket_type_name, (counts.get(ticket.ticket_type_name) ?? 0) + 1);
      }
      return [...counts.entries()].map(([name, count]) => `${count} × ${name}`).join(' · ');
    }
    return (booking?.items ?? [])
      .map((item) => `${item.quantity} × ${item.ticket_type_name}`)
      .join(' · ');
  }, [tickets, booking]);

  return (
    <section
      aria-label="Your ticket"
      className="overflow-hidden rounded-3xl bg-ink-900 ring-1 ring-inset ring-ink-800"
    >
      {/* ── THE EVENT: poster top-left, the title beside it ─────────────── */}
      <div className="flex items-start gap-4 p-6">
        <TicketPoster src={posterUrl} />
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-h4 font-bold text-ink-25">{eventTitle}</h2>
          {meta ? (
            <p className="mt-1 text-caption uppercase tracking-wide text-ink-400">{meta}</p>
          ) : null}
          {bought ? <p className="mt-2 text-body-sm font-medium text-ink-200">{bought}</p> : null}
        </div>
      </div>

      <Perforation />

      {/* ── THE MIDDLE: the codes, or what stands in their place ────────── */}
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-6">
        {view === 'pass' ? (
          <QrCarousel tickets={tickets} eventTitle={eventTitle} />
        ) : view === 'loading' ? (
          <div className="skeleton size-56 rounded-2xl" aria-hidden />
        ) : view === 'confirming' ? (
          <div
            className="flex size-56 items-center justify-center rounded-2xl bg-ink-800"
            aria-hidden
          >
            <Loader2 className="size-6 animate-spin text-ink-400" />
          </div>
        ) : (
          <StateStamp view={view} />
        )}
      </div>

      <Perforation />

      {/* ── THE FACTS ──────────────────────────────────────────────────── */}
      <dl className="flex flex-col gap-4 p-6">
        <Fact icon={CalendarDays} label="When">
          {when(startsAt, endsAt)}
        </Fact>

        <Fact icon={TicketIcon} label="Tickets">
          {/* SEAT AND SCREEN DO NOT EXIST — the tier and the count are the true
              version of the reference's "GOLD - G20, G21 · SCREEN 1". */}
          {bought || `${tickets.length || 1} ticket`}
        </Fact>

        <Fact icon={MapPin} label="Where">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">{[venue, city].filter(Boolean).join(', ')}</span>
            {/* Works without coordinates: `directionsUrl` falls back to the
                venue + city string. A pin is passed only when both halves of
                one exist — never an invented coordinate. */}
            <a
              href={directionsUrl(venue, city, pin(latitude, longitude))}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Directions to the venue"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-800 text-ink-200 transition-colors duration-fast hover:bg-ink-700 hover:text-ink-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <Compass className="size-4" aria-hidden />
            </a>
          </span>
        </Fact>
      </dl>

      {/* ── THE REFERENCE ──────────────────────────────────────────────── */}
      {reference && bookingId ? (
        <div className="mx-6 mb-6 rounded-2xl bg-ink-950 px-4 py-3 text-center">
          <p className="text-caption uppercase tracking-wider text-ink-500">Booking reference</p>
          <CopyableRef value={bookingId} shown={reference} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * The event's poster, top-left of the ticket — portrait, 2:3, like the card it
 * was bought from. `RemoteImage` rather than `next/image` because a poster's
 * host is chosen by a storage env var at deploy time, and `next/image` THROWS
 * for a host it was not built with.
 */
function TicketPoster({ src }: { src: string | null | undefined }) {
  return (
    <span className="relative block aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-lg bg-ink-800 ring-1 ring-inset ring-ink-700">
      {src ? (
        <RemoteImage src={src} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-ink-500">
          <TicketIcon className="size-5" aria-hidden />
        </span>
      )}
    </span>
  );
}

/**
 * Where the codes would be, for a booking that has none — the reference's
 * "TRANSACTION FAILED" stamp, in this booking's own words.
 *
 * Amber for "needs you", green for "money came back", grey for "nothing left
 * to do". Never red: an unpaid booking is somebody who has not finished, not
 * somebody who did something wrong.
 */
function StateStamp({ view }: { view: TicketView }) {
  const stamp =
    view === 'unpaid'
      ? { label: 'Payment incomplete', tone: 'border-warning text-warning', icon: Clock3 }
      : view === 'refunded'
        ? { label: 'Refunded', tone: 'border-success-500 text-success-500', icon: Check }
        : { label: 'No active passes', tone: 'border-ink-600 text-ink-300', icon: TicketX };
  const Icon = stamp.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-2xl border-2 px-6 py-3 text-body-sm font-extrabold uppercase tracking-widest',
        stamp.tone,
      )}
    >
      <Icon className="size-4" aria-hidden />
      {stamp.label}
    </span>
  );
}

/**
 * The perforation between the ticket's sections: two half-circles bitten out
 * of the card's edges and a dashed rule between them. It is what makes the
 * block read as a TICKET rather than as another panel.
 */
function Perforation() {
  return (
    <div className="relative" aria-hidden>
      <span className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-ink-950" />
      <span className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-ink-950" />
      <span className="mx-6 block border-t-2 border-dashed border-ink-700" />
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarDays;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-success-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <dt className="text-caption uppercase tracking-wide text-ink-500">{label}</dt>
        <dd className="mt-0.5 text-body-sm font-medium text-ink-50">{children}</dd>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── the refund ── */

/**
 * The refund, on the booking's own page — the one place it is shown.
 *
 * "Approved" is a decision and "refunded" is a transfer, and the difference is
 * `refund_reference`: it exists only once the provider accepted the refund. The
 * full trail — who decided, when, and the bank's part that nobody can see —
 * is one press further, on the refund's own screen.
 */
function RefundCard({ request, donation }: { request: RefundRequest; donation: number }) {
  const settled = refundSettled(request);
  const label = settled ? 'Refunded' : REFUND_REQUEST_LABELS[request.status].label;

  return (
    <div className="rounded-2xl bg-ink-900 p-4 ring-1 ring-inset ring-ink-800">
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption uppercase tracking-wide text-ink-400">Refund</p>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-caption font-semibold',
            settled
              ? 'bg-success-500/20 text-success-500'
              : request.status === 'rejected'
                ? 'bg-ink-800 text-ink-300'
                : 'bg-warning/20 text-warning',
          )}
        >
          {label}
        </span>
      </div>
      {request.status !== 'rejected' ? (
        <p className="mt-2 text-h4 font-bold tabular-nums text-ink-25">
          {formatMoney(refundAmount(request, donation))}
        </p>
      ) : null}
      {request.refund_reference ? (
        <p className="mt-1 truncate font-mono text-caption text-ink-400">
          Ref: {request.refund_reference}
        </p>
      ) : null}
      {request.status === 'rejected' && request.decision_note ? (
        <p className="mt-2 text-body-sm text-ink-300">&ldquo;{request.decision_note}&rdquo;</p>
      ) : null}
      <Link
        href={`/account/refunds/${encodeURIComponent(request.id)}`}
        className="mt-3 inline-flex items-center gap-1 rounded text-body-sm font-semibold text-ink-25 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Refund details
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * What came back. `refund_amount_minor` is read off the provider's own record;
 * before it exists, the booking total less the donation (a gift is not
 * refunded) is what WILL come back.
 */
function refundAmount(request: RefundRequest, donation: number): number {
  return request.refund_amount_minor ?? request.booking_total_minor - donation;
}

/* ────────────────────────────────────────────────────────────── formatting ── */

/**
 * A usable map pin, or `null` — never an invented coordinate. (0, 0) is a real
 * place in the Atlantic.
 */
function pin(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined,
): { latitude: number; longitude: number } | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (latitude === null || latitude === undefined || Number.isNaN(lat)) return null;
  if (longitude === null || longitude === undefined || Number.isNaN(lng)) return null;
  return { latitude: lat, longitude: lng };
}

function when(startsAt: string, endsAt: string | null): string {
  const start = new Date(startsAt);
  const date = start.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const from = start.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  // A blank `ends_at` means "the organiser did not say" — omitted, not guessed.
  if (!endsAt) return `${date} · ${from}`;
  const to = new Date(endsAt).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${date} · ${from} – ${to}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Whole minutes, floored, never negative. */
function minutesLeft(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.parse(iso) - Date.now()) / 60_000));
  return minutes === 1 ? '1 more minute' : `${minutes} more minutes`;
}

/**
 * The booking reference, and a press that copies it. The FULL id goes to the
 * clipboard while only the short prefix is shown; a refused clipboard leaves
 * the label exactly as it was — no false "Copied".
 */
function CopyableRef({ value, shown }: { value: string; shown: string }) {
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
      className="mt-1 inline-flex items-center gap-2 rounded-md font-mono text-body font-bold tracking-wider text-ink-25 transition-colors duration-fast hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
    >
      {shown}
      {copied ? (
        <Check className="size-4 text-success-500" aria-hidden />
      ) : (
        <Copy className="size-4 text-ink-500" aria-hidden />
      )}
      <span className="sr-only">{copied ? 'Booking reference copied' : 'Copy booking reference'}</span>
    </button>
  );
}
