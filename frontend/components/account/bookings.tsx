'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  CreditCard,
  Headset,
  Loader2,
  MapPin,
  QrCode,
  Send,
  Ticket as TicketIcon,
  TriangleAlert,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cursorFromNextLink } from '@/lib/api/events';
import { fetchMyBookings } from '@/lib/api/bookings';
import type { MyBooking, Paginated } from '@/lib/api/types';
import { fetchMyRefundRequests, type RefundRequest } from '@/lib/api/refund-requests';
import { formatMoney } from '@/lib/discovery/format';
import {
  STATE_FILTERS,
  bookingRef,
  bookingState,
  eventEndsAt,
  holdIsLive,
  refundSettled,
  type BookingState,
  type StateFilter,
} from '@/lib/ticketing/booking-state';
import { OpenEventLink } from '@/components/event/open-event-link';
import { eventPath } from '@/lib/events/ref';
import { PendingReviewCard } from '@/components/reviews/review-prompt';
import { EmptyState, ErrorState, Skeleton } from '@/components/organizer/primitives';
import { TrustStrip, WALLET_TRUST } from '@/components/booking/trust';
import {
  InsetPanel,
  MetaRow,
  PosterThumb,
  StatusChip,
  SurfaceCard,
  type TicketingTone,
} from '@/components/ticketing/primitives';
import { TicketSheet, type SheetTicket } from '@/components/ticketing/ticket-sheet';
import { RefundRequestDialog, type RefundTarget } from './refund-request';
import { ShareReceiptDialog } from './share-receipt';
import { cn } from '@/lib/utils/cn';

/**
 * YOUR BOOKINGS & PURCHASES.
 *
 * ── WHAT THIS REPLACED, AND WHY IT HAD TO ─────────────────────────────────
 *
 * This screen was a ticket WALLET: it read `GET /me/tickets`, which returns
 * ACTIVE tickets and nothing else. Three consequences, all of them bad and all
 * of them invisible from the code:
 *
 *   1. The "Used" and "Refunded" filters could only ever count ZERO. The rows
 *      they filtered were excluded by the query before the client saw them.
 *   2. A booking whose payment FAILED left nothing on any screen the buyer
 *      could reach — no record, no retry, no explanation — which is precisely
 *      the case somebody most urgently opens their account to look at.
 *   3. A card could name the event and nothing else. No date, no venue, no
 *      artwork, no amount, because the ticket payload carries a title and a
 *      tier name. The old file's own comment asked for the join that fixes it.
 *
 * It reads `GET /me/bookings` now — every booking in every state, with the
 * event joined — so the list is a PURCHASE HISTORY rather than a wallet, and
 * the four chips are four real answers.
 *
 * ── TWO REQUESTS FOR THE WHOLE SCREEN, NOT TWO PER ROW ────────────────────
 *
 * `/me/bookings` gives the rows; `/me/tickets` gives the signed codes (a code
 * is a bearer credential and is deliberately absent from the history payload);
 * `/me/refund-requests` gives the refund lifecycle, which lives in another
 * module and so cannot ride on the booking row. Three flat requests, joined by
 * `booking_id` in a `Map`. A request per card on a screen somebody opens while
 * walking towards a venue is the wrong trade.
 *
 * ── EVERY BADGE AND NUMBER HERE IS BACKED ─────────────────────────────────
 *
 * The reference this was built to shows seat numbers ("Sec A • G12, G13"), a
 * downloadable invoice, a "100% genuine" guarantee and a live concierge dot.
 * This platform has no seat map (`venues` is an explicitly deferred module),
 * no invoice endpoint (the receipt is EMAILED as a PDF — which is what the
 * Share control does), and nothing that measures whether support is online. So
 * seats are a ticket COUNT and a tier name, "Download invoice" is "Email the
 * receipt", and the trust strip is `components/booking/trust.tsx` — the same
 * four claims the checkout makes, each one a property of the system a reader
 * could go and confirm.
 */

/** The signed codes. Only ACTIVE tickets exist here — a used or refunded
 *  ticket has no code to present. */
type WalletTicket = {
  id: string;
  booking_id: string;
  event_title: string;
  ticket_type_name: string;
  status: 'active' | 'used' | 'void';
  qr_token: string;
  attendee_name?: string;
};

const TONE: Record<BookingState, TicketingTone> = {
  upcoming: 'pass',
  finished: 'finished',
  refunded: 'refunded',
  unpaid: 'failed',
};

const STATE_LABEL: Record<BookingState, string> = {
  upcoming: 'Upcoming pass',
  finished: 'Completed',
  refunded: 'Refund settled',
  unpaid: 'Payment incomplete',
};

export function MyBookings() {
  const [filter, setFilter] = React.useState<StateFilter>('all');
  const [showing, setShowing] = React.useState<SheetTicket[] | null>(null);
  const [sharing, setSharing] = React.useState<MyBooking | null>(null);
  const [refunding, setRefunding] = React.useState<RefundTarget | null>(null);

  // `now` is state, not `Date.now()` inline: a booking moves from "upcoming" to
  // "finished" and a hold from live to lapsed while this page is open, and a
  // value read during render would freeze both at first paint. Ticked once a
  // minute — the finest granularity anything on this screen displays.
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const bookings = useInfiniteQuery({
    queryKey: ['account', 'bookings'],
    queryFn: ({ pageParam }) => fetchMyBookings(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    // A booking's state can change while the page is open — a refund voids its
    // tickets, a hold lapses. This is the one thing a person must not be wrong
    // about at a door.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const wallet = useQuery({
    queryKey: ['account', 'tickets'],
    queryFn: () => api.get<Paginated<WalletTicket>>('/me/tickets'),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // One request per booking is a backend invariant (a partial unique index), so
  // a flat map by booking id cannot lose one.
  const requests = useQuery({
    queryKey: ['account', 'refund-requests'],
    queryFn: () => fetchMyRefundRequests(),
    staleTime: 30_000,
  });

  const rows = React.useMemo(
    () => bookings.data?.pages.flatMap((page) => page.data) ?? [],
    [bookings.data],
  );

  const requestByBooking = React.useMemo(() => {
    const map = new Map<string, RefundRequest>();
    for (const row of requests.data?.data ?? []) map.set(row.booking_id, row);
    return map;
  }, [requests.data]);

  const codesByBooking = React.useMemo(() => {
    const map = new Map<string, SheetTicket[]>();
    for (const ticket of wallet.data?.data ?? []) {
      if (ticket.status !== 'active') continue;
      const list = map.get(ticket.booking_id) ?? [];
      list.push(ticket);
      map.set(ticket.booking_id, list);
    }
    return map;
  }, [wallet.data]);

  const decorated = React.useMemo(
    () =>
      rows.map((booking) => ({
        booking,
        request: requestByBooking.get(booking.id),
        state: bookingState(booking, requestByBooking.get(booking.id), now),
      })),
    [rows, requestByBooking, now],
  );

  const counts = React.useMemo(() => {
    const map: Record<StateFilter, number> = {
      all: decorated.length,
      upcoming: 0,
      finished: 0,
      refunded: 0,
      unpaid: 0,
    };
    for (const entry of decorated) map[entry.state] += 1;
    return map;
  }, [decorated]);

  const visible = filter === 'all' ? decorated : decorated.filter((row) => row.state === filter);

  /**
   * The banner: the soonest live pass, and nothing else.
   *
   * `/me/bookings` is ordered by PURCHASE date, so the first upcoming row is
   * the most recently bought, not the next one you are going to. Sorting by
   * `event_starts_at` is what makes this say the thing somebody needs on the
   * day — and it is why the banner is computed here rather than taken off the
   * top of the list.
   */
  const nextUp = React.useMemo(() => {
    const live = decorated
      .filter((row) => row.state === 'upcoming' && row.booking.active_ticket_count > 0)
      .sort((a, b) => Date.parse(a.booking.event_starts_at) - Date.parse(b.booking.event_starts_at));
    return live[0] ?? null;
  }, [decorated]);

  const loading = bookings.isPending;

  return (
    <div className="flex flex-col gap-5">
      {nextUp ? (
        <button
          type="button"
          onClick={() => setShowing(codesByBooking.get(nextUp.booking.id) ?? null)}
          disabled={!codesByBooking.get(nextUp.booking.id)?.length}
          className={cn(
            'group flex w-full items-center gap-3 rounded-2xl bg-primary/10 px-4 py-3 text-left',
            'transition-colors duration-fast hover:bg-primary/15 disabled:cursor-default disabled:opacity-70',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'motion-reduce:transition-none',
          )}
        >
          <TicketIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-foreground">
            {nextUp.booking.active_ticket_count === 1
              ? '1 pass ready for entry at '
              : `${nextUp.booking.active_ticket_count} passes ready for entry at `}
            <span className="font-semibold">{nextUp.booking.event_title}</span>
          </span>
          <ArrowRight
            className="size-4 shrink-0 text-primary transition-transform duration-fast group-hover:translate-x-0.5 motion-reduce:transform-none"
            aria-hidden
          />
        </button>
      ) : null}

      <header className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-h3 md:text-h2">Your Bookings &amp; Purchases</h1>
          {/* A LINK to browse, not a search field. There is no endpoint that
              searches a person's own bookings, and a box that filtered the
              loaded page only would go quiet the moment somebody paged. */}
          <Link
            href="/events"
            aria-label="Browse events"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          >
            <TicketIcon className="size-4" aria-hidden />
          </Link>
        </div>
        <p className="text-body-sm text-muted-foreground">
          Every ticket, pass and refund on this account, newest first.
        </p>
      </header>

      <PendingReviewCard />

      {/* ── ONE LINE THAT SCROLLS, NOT TWO THAT WRAP ──────────────────────
          Five chips wrap to two rows on a phone, which costs a full card of
          the first screen before a single booking appears. `-mx-4 px-4` bleeds
          the scroller to the viewport rim so the last chip can be reached;
          `scrollbar-none` because the project's global scrollbar styling would
          otherwise draw a grey bar under it that reads as a broken underline. */}
      <div
        role="tablist"
        aria-label="Filter bookings"
        className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {STATE_FILTERS.map((entry) => {
          const active = filter === entry.value;
          const count = counts[entry.value];
          // A chip for a state nothing is in is noise. "All" always shows.
          if (count === 0 && entry.value !== 'all' && !active) return null;
          return (
            <button
              key={entry.value}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setFilter(entry.value)}
              className={cn(
                'inline-flex h-control shrink-0 items-center gap-2 rounded-full border px-4 text-label transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'motion-reduce:transition-none',
                active
                  ? 'border-transparent bg-cta text-cta-foreground'
                  : 'border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {entry.label}
              {count > 0 ? (
                <span
                  className={cn(
                    'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-caption tabular-nums',
                    active ? 'bg-white/20' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {bookings.isError ? (
        <ErrorState
          message="Could not load your bookings."
          onRetry={() => void bookings.refetch()}
          className="rounded-2xl border border-border bg-surface"
        />
      ) : loading ? (
        <ul className="flex flex-col gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index}>
              <Skeleton className="h-52 w-full rounded-2xl" />
            </li>
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface">
          <EmptyState
            icon={TicketIcon}
            title={decorated.length ? 'Nothing in this view' : 'No bookings yet'}
            body={
              decorated.length
                ? 'Try another filter — your other bookings are still here.'
                : 'Anything you book appears here, paid or not.'
            }
            action={
              decorated.length ? undefined : (
                <Link
                  href="/events"
                  className="inline-flex h-control items-center justify-center rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover"
                >
                  Find something to do
                </Link>
              )
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {visible.map(({ booking, request, state }) => (
            <li key={booking.id}>
              <BookingCard
                booking={booking}
                request={request}
                state={state}
                now={now}
                codes={codesByBooking.get(booking.id) ?? []}
                onShowCodes={() => setShowing(codesByBooking.get(booking.id) ?? [])}
                onShare={() => setSharing(booking)}
                onRequestRefund={() =>
                  setRefunding({
                    bookingId: booking.id,
                    eventTitle: booking.event_title,
                    ticketCount: booking.active_ticket_count || booking.ticket_count,
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      {bookings.hasNextPage ? (
        <button
          type="button"
          onClick={() => void bookings.fetchNextPage()}
          disabled={bookings.isFetchingNextPage}
          className="mx-auto inline-flex h-control items-center justify-center gap-2 rounded-full border border-border bg-surface px-pill text-label text-foreground transition-colors duration-fast hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {bookings.isFetchingNextPage ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Load more
        </button>
      ) : null}

      {/* ── HELP, AND WHAT IT DOES NOT CLAIM ──────────────────────────────
          The reference says "24/7 Concierge Support" with an "Online" dot.
          Nothing in this platform measures whether anybody is at a desk, and a
          green dot that is always on is the one badge a person leans on at
          exactly the wrong moment. This links to the support form that
          actually exists and promises only what it does. */}
      <SurfaceCard className="flex items-center gap-3.5 p-4">
        <span
          aria-hidden
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          <Headset className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body-sm font-semibold text-foreground">Need help with an order?</p>
          <p className="text-caption text-muted-foreground">
            Entry, refunds and payment questions.
          </p>
        </div>
        <Link
          href="/support"
          className="inline-flex h-control-sm shrink-0 items-center rounded-full bg-muted px-4 text-label text-foreground transition-colors duration-fast hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          Contact us
        </Link>
      </SurfaceCard>

      {/* The SAME four claims the checkout makes — `components/booking/trust.tsx`
          — rather than a second set written for this screen. Each is a property
          of the system a reader could go and confirm. */}
      <TrustStrip marks={WALLET_TRUST} />

      <TicketSheet
        open={showing !== null && showing.length > 0}
        tickets={showing ?? []}
        onClose={() => setShowing(null)}
      />
      <RefundRequestDialog target={refunding} onClose={() => setRefunding(null)} />
      <ShareReceiptDialog
        target={
          sharing
            ? {
                bookingId: sharing.id,
                eventTitle: sharing.event_title,
                ticketCount: sharing.ticket_count,
              }
            : null
        }
        onClose={() => setSharing(null)}
      />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────── the card ── */

function BookingCard({
  booking,
  request,
  state,
  now,
  codes,
  onShowCodes,
  onShare,
  onRequestRefund,
}: {
  booking: MyBooking;
  request: RefundRequest | undefined;
  state: BookingState;
  now: number;
  codes: SheetTicket[];
  onShowCodes: () => void;
  onShare: () => void;
  onRequestRefund: () => void;
}) {
  const live = holdIsLive(booking, now);
  const finished = eventEndsAt(booking) <= now;
  const tiers = booking.items.map((item) => item.ticket_type_name);
  const tierLabel = tiers.length === 1 ? tiers[0] : tiers.length ? `${tiers.length} tiers` : null;

  return (
    <SurfaceCard as="article" rail={state === 'unpaid' ? 'danger' : undefined} className="p-4">
      {/* ── THE STATUS ROW ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusChip
            tone={TONE[state]}
            dot={state === 'upcoming'}
            icon={
              state === 'refunded'
                ? Check
                : state === 'unpaid'
                  ? TriangleAlert
                  : state === 'finished'
                    ? Check
                    : undefined
            }
          >
            {STATE_LABEL[state]}
          </StatusChip>
          {state === 'upcoming' ? (
            <StatusChip tone="confirmed" icon={Check}>
              Confirmed
            </StatusChip>
          ) : null}
          {/* A live hold IS a countdown, and it is the only number on this
              card that changes while you look at it. */}
          {state === 'unpaid' && live ? (
            <StatusChip tone="failed" icon={Clock3}>
              {minutesLeft(booking.hold_expires_at as string, now)}
            </StatusChip>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-caption text-foreground-subtle">
          {bookingRef(booking.id)}
        </span>
      </div>

      {/* ── THE EVENT ─────────────────────────────────────────────────── */}
      <div className="mt-3 flex gap-3.5">
        <PosterThumb src={booking.event_poster_url} alt="" className="size-16" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <OpenEventLink
            event={{ id: booking.event_id, title: booking.event_title, slug: booking.event_slug }}
            /* NO DISPLAY CLASS HERE. `OpenEventLink` renders a `sm:hidden`
               button beside a `hidden sm:inline` anchor and lets CSS pick; a
               `block` passed in merges LAST and wins the display slot on both,
               so the title rendered twice on every card. Caught by the
               screenshot pass, and invisible in a unit test that queries by
               role. */
            className="max-w-full truncate text-body font-bold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {booking.event_title}
          </OpenEventLink>
          <MetaRow icon={CalendarDays}>{eventWhen(booking.event_starts_at)}</MetaRow>
          <MetaRow icon={MapPin}>
            {[booking.event_venue, booking.event_city].filter(Boolean).join(', ')}
          </MetaRow>
        </div>
      </div>

      {/* ── WHAT WAS BOUGHT, AND FOR HOW MUCH ─────────────────────────── */}
      {state !== 'refunded' ? (
        <InsetPanel className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-body-sm font-semibold text-foreground">
              {tierLabel ?? 'Tickets'}
            </p>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {/* SEATS DO NOT EXIST. `venues`/seat-maps is a deferred module and
                  no row anywhere stores a seat, a row or a section, so the
                  reference's "Sec A • G12, G13" would be four invented facts on
                  a screen somebody presents at a door. The count is the true
                  version of the same sentence. */}
              {booking.ticket_count === 1 ? '1 pass' : `${booking.ticket_count} passes`}
              {state === 'upcoming' && booking.active_ticket_count !== booking.ticket_count
                ? ` · ${booking.active_ticket_count} still valid`
                : ''}
            </p>
          </div>
          <p className="shrink-0 text-body font-bold tabular-nums text-primary">
            {formatMoney(booking.total_amount)}
          </p>
        </InsetPanel>
      ) : (
        <RefundPanel booking={booking} request={request} />
      )}

      {/* ── WHAT IS LEFT TO DO ────────────────────────────────────────── */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {state === 'upcoming' ? (
          <>
            <button
              type="button"
              onClick={onShowCodes}
              disabled={codes.length === 0}
              /* `whitespace-nowrap` and a basis floor. As a bare `flex-1` in a
                 wrapping row the pill shrank instead of letting the tertiary
                 "Request refund" wrap below it, so at 360px the primary action
                 on this screen read "View / ticket" over two lines. */
              className="inline-flex h-control flex-1 basis-40 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover active:bg-cta-active disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
            >
              <QrCode className="size-4" aria-hidden />
              {codes.length > 1 ? `View ${codes.length} tickets` : 'View ticket'}
            </button>
            <IconAction label="Email the receipt" onClick={onShare} icon={Send} />
          </>
        ) : null}

        {state === 'finished' ? (
          <>
            <button
              type="button"
              onClick={onShare}
              className="inline-flex h-control items-center justify-center gap-2 rounded-full px-3 text-label text-primary transition-colors duration-fast hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <Send className="size-4" aria-hidden />
              {/* NOT "Download invoice". There is no invoice endpoint and no
                  download URL anywhere; the receipt is a PDF the backend EMAILS
                  (`POST /bookings/{id}/share-receipt`). Naming the button after
                  the thing that happens is the whole difference between a
                  control and a dead end. */}
              Email receipt
            </button>
            <Link
              // `eventPath`, never a hand-built `/events/{slug}-{id}`. The
              // slug is computed once on the backend and serialized; a second
              // derivation here is how a link and a canonical drift apart.
              href={`${eventPath({ id: booking.event_id, slug: booking.event_slug })}#reviews`}
              className="ml-auto inline-flex h-control items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 text-label text-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
            >
              Rate experience
            </Link>
          </>
        ) : null}

        {state === 'refunded' && request ? (
          <Link
            href={`/account/refunds/${encodeURIComponent(request.id)}`}
            className="ml-auto inline-flex h-control items-center justify-center gap-1.5 rounded-full px-3 text-label text-primary transition-colors duration-fast hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            View refund details
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}

        {state === 'unpaid' ? (
          <Link
            href={
              live
                ? `/booking/${booking.event_id}/review`
                : eventPath({ id: booking.event_id, slug: booking.event_slug })
            }
            className="ml-auto inline-flex h-control items-center justify-center gap-1.5 rounded-full bg-primary px-pill text-label text-primary-foreground transition-colors duration-fast hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
          >
            {live ? 'Finish payment' : 'Book again'}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}

        {/* Only a paid booking with live tickets, an event still to come and no
            request outstanding can start one. A second request on the same
            booking is a 409, so offering the control would be a button whose
            only outcome is an error. */}
        {state === 'upcoming' && !request && !finished ? (
          <button
            type="button"
            onClick={onRequestRefund}
            className="inline-flex h-control shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-label text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          >
            Request refund
          </button>
        ) : null}
      </div>

      {/* An outstanding or declined request, said in the organiser's own words
          where there are any. A refusal with no reason is what turns a declined
          refund into a chargeback. */}
      {request && state !== 'refunded' ? (
        <InsetPanel className="mt-3">
          <p className="text-caption font-semibold text-foreground">
            Refund request · {request.status === 'pending' ? 'awaiting decision' : request.status}
          </p>
          {request.status === 'rejected' && request.decision_note ? (
            <p className="mt-1 text-caption text-muted-foreground">
              &ldquo;{request.decision_note}&rdquo;
            </p>
          ) : null}
        </InsetPanel>
      ) : null}

      {/* The unpaid explanation, and it is careful about what it claims.
          The gateway never tells this backend that a card was declined, so the
          booking is simply RESERVED and unpaid — "we did not receive a payment"
          is true whether it failed, was abandoned, or never started. Claiming
          "your payment failed" would be asserting an outcome nobody recorded. */}
      {state === 'unpaid' ? (
        <p className="mt-3 text-caption text-muted-foreground">
          {live
            ? `No payment was received, so nothing was charged. These ${
                booking.ticket_count || 'your'
              } passes stay held until the timer runs out.`
            : 'No payment was received, so nothing was charged and the passes went back on sale.'}
        </p>
      ) : null}
    </SurfaceCard>
  );
}

/**
 * The refunded card's band.
 *
 * `refund_amount_minor` is the amount that ACTUALLY moved, read off the
 * provider's own refund record. `booking_total_minor` is deliberately not used
 * here: it includes the donation, which an ordinary refund withholds, so on any
 * booking with one it overstates what came back — on the single screen where
 * being wrong about a number is worst.
 */
function RefundPanel({
  booking,
  request,
}: {
  booking: MyBooking;
  request: RefundRequest | undefined;
}) {
  const settled = refundSettled(request);
  const amount = request?.refund_amount_minor ?? booking.total_amount - booking.donation;

  return (
    <InsetPanel className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-body-sm text-muted-foreground">
          <CreditCard className="size-4 shrink-0 text-success-subtle-foreground" aria-hidden />
          {/* The INSTRUMENT is unknown — `Payment` stores the provider's
              reference ids and the amount, and no method, network, last-4, bank
              or VPA. "Credited to UPI" would be a guess about somebody's bank
              statement. */}
          <span className="min-w-0 truncate">
            {settled ? 'Credited to your original method' : 'Refund approved'}
          </span>
        </p>
        <p className="shrink-0 text-body font-bold tabular-nums text-success-subtle-foreground">
          {formatMoney(amount)}
        </p>
      </div>
      {request?.refund_reference ? (
        <p className="mt-1.5 truncate font-mono text-caption text-foreground-subtle">
          Ref: {request.refund_reference}
        </p>
      ) : null}
    </InsetPanel>
  );
}

function IconAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Send;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-control shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────── formatting ── */

function eventWhen(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} · ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
}

/** Whole minutes, floored, never negative — a hold that reads "0 mins left"
 *  has lapsed and the card says so in words instead. */
function minutesLeft(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((Date.parse(iso) - now) / 60_000));
  return minutes === 1 ? '1 min left' : `${minutes} mins left`;
}
