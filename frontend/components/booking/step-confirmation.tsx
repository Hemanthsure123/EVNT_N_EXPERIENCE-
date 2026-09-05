'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Copy,
  Loader2,
  MapPin,
  Receipt,
  Send,
  Ticket as TicketIcon,
} from 'lucide-react';
import { fetchBooking } from '@/lib/api/bookings';
import { bumpAllAttemptsForEvent } from '@/lib/booking/attempt';
import { verifyPayment } from '@/lib/api/payments';
import { directionsUrl } from '@/lib/api/maps';
import { useAuth } from '@/lib/auth/auth-provider';
import { fetchTicketsForBooking, type IssuedTicket } from '@/lib/booking/tickets';
import { formatMoney } from '@/lib/discovery/format';
import { bookingRef } from '@/lib/ticketing/booking-state';
import { eventPath } from '@/lib/events/ref';
import { TicketQrCode } from '@/components/booking/qr-code';
import { BillLines, bookingBill } from '@/components/ticketing/bill-lines';
import { ShareReceiptDialog } from '@/components/account/share-receipt';
import { AddToCalendar } from '@/components/event/add-to-calendar';
import { cn } from '@/lib/utils/cn';
import { useBooking } from './booking-context';
import { Celebration } from './celebration';

/**
 * BOOKING CONFIRMED — and it waits for the BACKEND to say so.
 *
 * ── THE SCREEN IS DARK, AND THE PAGE AROUND IT IS DARK WITH IT ────────────
 *
 * Everything else in this product is a light document. This is not a document:
 * it is the OBJECT somebody was just handed, and the whole screen is the
 * object's own surface. A ticket does not invert when the reader flips a theme
 * toggle, for the same reason a boarding pass does not — so every colour here
 * comes from the theme-INDEPENDENT `ink` ramp, and the screen looks identical
 * in both themes. The one exception is the QR itself, which is dark-on-light
 * because a camera needs it that way (see `TicketQrCode`).
 *
 * It is also the reason the QR is the biggest thing on the screen. The previous
 * version of this file led with a headline, then a receipt strip, then a "View
 * my tickets" button, and put the actual code below the fold behind a carousel:
 * three scrolls between paying and the thing you present at a door.
 *
 * ── IT STILL POLLS, AND THAT IS UNCHANGED ─────────────────────────────────
 *
 * The provider's success callback fired in the browser, which is a hint, not
 * proof. The backend confirms a booking only from a statement by the provider
 * itself, so this screen polls `GET /bookings/{id}` until the status it reads is
 * genuinely `paid`. Showing a tick because a client callback fired would mean
 * congratulating someone for a payment the system has not recorded — and on
 * this platform the tickets are issued by that same confirmation step.
 *
 * ── THE RE-NUDGE ──────────────────────────────────────────────────────────
 *
 * Where no public webhook can reach the backend (a laptop, a not-yet-DNS'd
 * deployment), the only thing that tells it a real payment was captured is
 * `POST /payments/verify` — and the pay step fires that exactly once, without
 * awaiting it. One dropped request was therefore the difference between a
 * ticket and nothing, silently. If the payment id came through in the URL, this
 * screen re-asks on the third and sixth poll.
 *
 * ── WHAT THE REFERENCE HAS THAT THIS CANNOT ───────────────────────────────
 *
 * Seat ("GOLD CLASS-H-21") and screen ("SCREEN 3"): no seat map exists — the
 * `venues` module is explicitly deferred — and there is no auditorium concept
 * anywhere in this product. The honest version of that row is the TIER and the
 * COUNT, which is what was actually bought.
 *
 * A separate "Booking code" beside a "Booking ID": `Booking.id` is a uuid and
 * there is no short-code column, so the two rows would print the same value
 * twice. There is one reference, and it copies the full uuid.
 *
 * A rewards block ("You've won 2 Rewards!"): a repo-wide search for
 * reward/loyalty/coupon/promo returns nothing in the backend or the frontend.
 * There is no points balance, no earn rate and no voucher. A block nothing
 * backs is absent, not empty.
 *
 * "Share Ticket": a ticket is a BEARER CREDENTIAL — whoever holds the QR is
 * admitted — so a one-tap share of it is a way to give your seat away by
 * accident. The existing money-path share emails a PDF RECEIPT
 * (`POST /bookings/{id}/share-receipt`), which is the artefact you actually
 * want to send to whoever you are going with, and it is what the button does.
 */

const POLL_MS = 2000;
/**
 * THE POLL BUDGET IS COUNTED IN POLLS, NOT IN WALL-CLOCK SECONDS.
 *
 * It used to be `Date.now() - startedAt > 45s`, and that is a different thing
 * than it looks. Browsers throttle timers in a hidden tab to roughly once a
 * minute, and Razorpay's own flow — plus every UPI payment — takes people OUT
 * of this tab. The clock kept burning while the poll did not fire, so somebody
 * paying by UPI came back to a screen that had already given up.
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

  const [billOpen, setBillOpen] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);

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
    // wrong for this one: coming back to the tab is exactly the moment to ask
    // again.
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
  const timedOut = !paid && polls.current >= MAX_POLLS;

  // Hand the freshly-fetched booking to the shared context. The card holds
  // whatever `POST /bookings` returned — the SUMMARY serializer, with no
  // `items` and `status: 'reserved'` forever. `GET /bookings/{id}` is the
  // DETAIL serializer and is already being polled here.
  React.useEffect(() => {
    if (booking) setBooking(booking);
    if (paid && event?.id) bumpAllAttemptsForEvent(event.id);
  }, [booking, paid, event?.id, setBooking]);

  // Only once the BACKEND says paid — the tickets do not exist before that, and
  // asking for them earlier would render an empty state that reads as a loss.
  const tickets = useQuery({
    queryKey: ['booking-tickets', bookingId],
    queryFn: () => fetchTicketsForBooking(bookingId as string),
    enabled: Boolean(bookingId) && paid,
    staleTime: Infinity,
  });

  const issued = tickets.data ?? [];

  return (
    // THE WHOLE VIEWPORT, and it owns its own padding.
    //
    // The confirmation page renders this directly rather than inside
    // `FunnelScreen`: that wrapper pairs a title with a back control offering to
    // CANCEL a live hold, which on a booking that is already paid is an offer
    // for something that cannot happen. So there is no parent padding to cancel
    // out — an earlier `-mx-4 -mt-5` here, written for the wrapper that is not
    // there, pulled the header hard against the top of the screen.
    <div className="min-h-dvh bg-ink-950 pb-block-lg text-ink-50">
      <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-8 pt-5">
        <ConfirmHeader onShare={() => setSharing(true)} canShare={paid} />

        {paid ? <Celebration /> : null}

        {/* ── THE VERDICT ─────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-2 pt-2 text-center">
          <span
            className={cn(
              'inline-flex size-14 items-center justify-center rounded-full',
              paid ? 'bg-success-500 text-ink-950' : 'bg-ink-800 text-ink-300',
            )}
            aria-hidden
          >
            {paid ? (
              <Check className="size-7" strokeWidth={3} />
            ) : (
              <Loader2 className="size-6 animate-spin" />
            )}
          </span>
          <h1 className="text-h3 font-bold text-ink-25">
            {paid ? 'Booking confirmed' : 'Confirming your payment'}
          </h1>
          <p className="text-body-sm text-ink-400" role="status">
            {paid
              ? 'Show this code at the entrance.'
              : timedOut
                ? 'This is taking longer than usual. Your payment is safe — the confirmation is processed on our side and your tickets will appear in your account shortly.'
                : 'We are waiting for the payment provider to confirm. This usually takes a moment.'}
          </p>
        </div>

        {/* ── THE TICKET ──────────────────────────────────────────────── */}
        <TicketObject
          eventTitle={event.title}
          meta={[event.language, event.age_restriction].filter(Boolean).join(' | ')}
          startsAt={event.starts_at}
          endsAt={event.ends_at}
          venue={event.venue}
          city={event.city}
          latitude={event.latitude}
          longitude={event.longitude}
          tickets={issued}
          reference={bookingId ? bookingRef(bookingId) : null}
          bookingId={bookingId}
          pending={!paid}
          loadingTickets={paid && tickets.isPending}
        />

        {/* ── WHAT IS LEFT TO DO ──────────────────────────────────────── */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={() => setSharing(true)}
            disabled={!paid}
            className="inline-flex h-control-lg flex-1 items-center justify-center gap-2 rounded-full bg-ink-25 px-pill-lg text-label text-ink-950 transition-colors duration-fast hover:bg-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 motion-reduce:transition-none"
          >
            <Send className="size-4" aria-hidden />
            Email the receipt
          </button>
          {event ? (
            <AddToCalendar
              event={event}
              className="h-control-lg flex-1 justify-center border-ink-800 bg-ink-900 text-ink-25 hover:bg-ink-800 hover:text-white focus-visible:ring-offset-ink-950"
            />
          ) : null}
        </div>

        {/* ── THE BILL, ONE PRESS AWAY ────────────────────────────────── */}
        {booking ? (
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
                  Paid on{' '}
                  {new Date(booking.created_at).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })}
                  .
                </p>
              </div>
            ) : null}
          </div>
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

        <p className="text-center text-caption text-ink-500">
          A copy with the same code is on its way to your account email.
        </p>
      </div>

      <ShareReceiptDialog
        target={
          sharing && bookingId
            ? {
                bookingId,
                eventTitle: event.title,
                ticketCount: issued.length || 1,
              }
            : null
        }
        onClose={() => setSharing(false)}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── the header ── */

function ConfirmHeader({ onShare, canShare }: { onShare: () => void; canShare: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {/* BACK TO THE ACCOUNT, NOT `router.back()`.
          History at this point is the payment provider's own page or the review
          screen holding a hold that has already been converted; going back to
          either is a dead end at best. The one place forward from a confirmed
          booking is the list it now lives in. */}
      <Link
        href="/account/tickets"
        aria-label="Your bookings"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-300 transition-colors duration-fast hover:bg-ink-800 hover:text-ink-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </Link>
      <p className="min-w-0 flex-1 truncate text-center text-body font-bold text-ink-25">
        Booking confirmed
      </p>
      <button
        type="button"
        onClick={onShare}
        disabled={!canShare}
        aria-label="Email the receipt"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-300 transition-colors duration-fast hover:bg-ink-800 hover:text-ink-25 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <Send className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── the ticket ── */

function TicketObject({
  eventTitle,
  meta,
  startsAt,
  endsAt,
  venue,
  city,
  latitude,
  longitude,
  tickets,
  reference,
  bookingId,
  pending,
  loadingTickets,
}: {
  eventTitle: string;
  meta: string;
  startsAt: string;
  endsAt: string | null;
  venue: string;
  city: string;
  /** Nullable, and a DECIMAL that the API may serialize as a string — hence
   *  `coord()` below rather than a bare cast. */
  latitude: number | string | null | undefined;
  longitude: number | string | null | undefined;
  tickets: IssuedTicket[];
  reference: string | null;
  bookingId: string | null;
  pending: boolean;
  loadingTickets: boolean;
}) {
  // The party arrives together, so the sheet steps through the set in place
  // rather than making somebody go back to a list between people.
  const [index, setIndex] = React.useState(0);
  const safe = Math.min(index, Math.max(tickets.length - 1, 0));
  const current = tickets[safe];
  const many = tickets.length > 1;

  const tiers = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const ticket of tickets) {
      counts.set(ticket.ticket_type_name, (counts.get(ticket.ticket_type_name) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => `${count} × ${name}`).join(' · ');
  }, [tickets]);

  return (
    <section
      aria-label="Your ticket"
      className="overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-inset ring-ink-800"
    >
      <div className="flex flex-col items-center gap-1 px-4 pt-5 text-center">
        <h2 className="text-h4 font-bold text-ink-25">{eventTitle}</h2>
        {meta ? <p className="text-caption uppercase tracking-wide text-ink-400">{meta}</p> : null}
      </div>

      {/* ── THE CODE ───────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-3 px-4 py-5">
        {pending ? (
          <div
            className="flex size-56 items-center justify-center rounded-2xl bg-ink-800"
            aria-hidden
          >
            <Loader2 className="size-6 animate-spin text-ink-400" />
          </div>
        ) : loadingTickets ? (
          <div className="skeleton size-56 rounded-2xl" aria-hidden />
        ) : current ? (
          <div className="relative flex w-full items-center justify-center">
            {many ? (
              <button
                type="button"
                onClick={() => setIndex((i) => (i - 1 + tickets.length) % tickets.length)}
                aria-label="Previous ticket"
                className="absolute left-1 z-10 inline-flex size-9 items-center justify-center rounded-full bg-ink-800 text-ink-300 transition-colors hover:bg-ink-700 hover:text-ink-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="size-5" />
              </button>
            ) : null}
            <TicketQrCode
              token={current.qr_token}
              label={`QR code for your ${current.ticket_type_name} ticket — ${eventTitle}`}
              className="w-56 max-w-full rounded-2xl p-3"
            />
            {many ? (
              <button
                type="button"
                onClick={() => setIndex((i) => (i + 1) % tickets.length)}
                aria-label="Next ticket"
                className="absolute right-1 z-10 inline-flex size-9 items-center justify-center rounded-full bg-ink-800 text-ink-300 transition-colors hover:bg-ink-700 hover:text-ink-25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="size-5" />
              </button>
            ) : null}
          </div>
        ) : (
          // Issued, but this page of /me/tickets did not carry them (a very
          // large account). Say where they are rather than implying a loss.
          <p className="rounded-xl bg-ink-800 p-card text-center text-body-sm text-ink-300">
            Your tickets are issued and waiting in{' '}
            <Link href="/account/tickets" className="underline">
              your account
            </Link>
            .
          </p>
        )}

        {many ? (
          <>
            <ul className="flex items-center justify-center gap-2" aria-label="Your tickets">
              {tickets.map((entry, position) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setIndex(position)}
                    aria-label={`Show ticket ${position + 1}`}
                    aria-current={position === safe}
                    className={cn(
                      'size-2.5 rounded-full transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
                      position === safe ? 'bg-ink-25' : 'bg-ink-700 hover:bg-ink-500',
                    )}
                  />
                </li>
              ))}
            </ul>
            <p className="text-caption uppercase tracking-wide text-ink-500">
              Ticket {safe + 1} of {tickets.length} · each admits one person, once
            </p>
          </>
        ) : current ? (
          <p className="text-caption uppercase tracking-wide text-ink-500">
            Admits one person, once
          </p>
        ) : null}
      </div>

      {/* ── THE PERFORATION ────────────────────────────────────────────
          Two half-circles bitten out of the card's edges plus a dashed rule.
          It is the one piece of pure decoration on this screen and it earns
          its place: it is what makes the block read as a TICKET rather than as
          another panel, which is the whole premise of the dark treatment. */}
      <div className="relative">
        <span
          aria-hidden
          className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-ink-950"
        />
        <span
          aria-hidden
          className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-ink-950"
        />
        <span aria-hidden className="block border-t border-dashed border-ink-700" />
      </div>

      {/* ── THE FACTS ──────────────────────────────────────────────────── */}
      <dl className="flex flex-col gap-3 p-4">
        <Fact icon={CalendarDays} label="When">
          {when(startsAt, endsAt)}
        </Fact>

        <Fact icon={TicketIcon} label="Tickets">
          {/* SEAT AND SCREEN DO NOT EXIST. No row anywhere stores a seat, a row,
              a section or an auditorium — `venues`/seat-maps is a deferred
              module — so the reference's "GOLD CLASS-H-21 · SCREEN 3" would be
              two invented facts on the artefact somebody presents at a door.
              The tier and the count are the true version of the same line. */}
          {tiers || `${tickets.length || 1} ticket`}
        </Fact>

        <Fact icon={MapPin} label="Where">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">{[venue, city].filter(Boolean).join(', ')}</span>
            {/* Real, and it works without coordinates: `directionsUrl` falls
                back to the venue + city string, which is what Maps searches
                anyway. `latitude`/`longitude` are nullable and the rule is
                never to invent a coordinate — so the pin is passed when it
                exists and simply omitted when it does not. */}
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
        <div className="mx-4 mb-4 rounded-xl bg-ink-950 px-4 py-3 text-center">
          <p className="text-caption uppercase tracking-wider text-ink-500">Booking reference</p>
          {/* ONE reference, not two. `Booking.id` is a uuid and there is no
              short-code column, so a "booking code" printed above a "booking
              ID" would be the same value twice. The prefix is what support
              quotes; the press copies the whole thing. */}
          <CopyableRef value={bookingId} shown={reference} />
        </div>
      ) : null}
    </section>
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

/**
 * A usable map pin, or `null`.
 *
 * `Event.latitude`/`longitude` are nullable DECIMALs and arrive as strings from
 * some serializers, so a truthiness check on the pair is not enough — and the
 * codebase rule is NEVER TO INVENT A COORDINATE. (0, 0) is a real place in the
 * Atlantic, so a default would be a confident lie rather than an approximation.
 * `directionsUrl` falls back to the venue + city string, which is what somebody
 * would have typed into Maps anyway.
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
  const from = start.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  // `ends_at` is nullable and blank means "the organiser did not say" — so the
  // range is omitted rather than defaulted to a duration nobody stated.
  if (!endsAt) return `${date} · ${from}`;
  const to = new Date(endsAt).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${date} · ${from} – ${to}`;
}

/**
 * The booking reference, and a press that copies it.
 *
 * This is the string every support conversation opens with. On a phone the
 * alternative to copying it is reading eight characters off a screen or taking
 * a screenshot, which is why it is a control rather than a label.
 *
 * The FULL id goes to the clipboard while only the short prefix is shown.
 * `navigator.clipboard` is absent on an insecure origin and can be refused
 * outright, so a failure leaves the label exactly as it was — no error, and no
 * false "Copied".
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
      className="mt-1 inline-flex items-center gap-2 rounded-md font-mono text-body font-bold tracking-wider text-ink-25 transition-colors duration-fast hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
    >
      {shown}
      {copied ? (
        <Check className="size-4 text-success-500" aria-hidden />
      ) : (
        <Copy className="size-4 text-ink-500" aria-hidden />
      )}
      <span className="sr-only">
        {copied ? 'Booking reference copied' : 'Copy booking reference'}
      </span>
    </button>
  );
}
