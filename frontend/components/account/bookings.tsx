'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock3,
  Headset,
  Loader2,
  MapPin,
  QrCode,
  Star,
  Ticket as TicketIcon,
} from 'lucide-react';
import { cursorFromNextLink } from '@/lib/api/events';
import { fetchMyBookings } from '@/lib/api/bookings';
import type { MyBooking } from '@/lib/api/types';
import { fetchMyRefundRequests, type RefundRequest } from '@/lib/api/refund-requests';
import { formatMoney } from '@/lib/discovery/format';
import {
  TICKETS_TABS,
  bookingRef,
  bookingState,
  holdIsLive,
  rowsForTab,
  type BookingState,
  type TicketsTab,
} from '@/lib/ticketing/booking-state';
import { OpenEventLink } from '@/components/event/open-event-link';
import { eventPath } from '@/lib/events/ref';
import {
  PendingReviewRow,
  uniquePendingReviews,
  usePendingReviews,
} from '@/components/reviews/review-prompt';
import { EmptyState, ErrorState, Skeleton } from '@/components/organizer/primitives';
import { SegmentedControl } from '@/components/ui/segmented-control';
import {
  InsetPanel,
  MetaRow,
  PosterThumb,
  StatusChip,
  SurfaceCard,
} from '@/components/ticketing/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * YOUR BOOKINGS & PURCHASES.
 *
 * ── THREE VIEWS, ONE SLIDING CONTROL ──────────────────────────────────────
 *
 * This screen had five pill chips (All, Upcoming, Unpaid, Past, Cancelled)
 * and a separate "Rate your recent experiences" card above them. It is one
 * segmented control now — Upcoming, Unpaid, Yet to Rate — with Upcoming as the
 * default, because the next thing you are going to is why most people open
 * it. See `TICKETS_TABS` / `rowsForTab` in `lib/ticketing/booking-state.ts`
 * for exactly which booking lands where, and why a refunded booking still
 * lists under Upcoming.
 *
 * ── HEADINGS ONLY ─────────────────────────────────────────────────────────
 *
 * Every descriptive line under a heading is gone at the owner's instruction:
 * the page subtitle, the explanation under an unpaid card, the help card's
 * second line, the trust strip and the empty states' body copy. What is left
 * is the page heading, the card titles and the facts on each card.
 *
 * ── REFUNDS ARE THE TICKET PAGE'S BUSINESS ────────────────────────────────
 *
 * Nothing on this list says "refunded" — no chip, no refund band, no refund
 * request panel and no "Request refund" button. All of it moved to the ticket's
 * own page (`step-confirmation.tsx`), which a refunded booking's card still
 * opens. The list is a list of things you bought; what happened to the money
 * afterwards is one press away, on the page about that booking.
 *
 * ── COLOUR ────────────────────────────────────────────────────────────────
 *
 * Black (`bg-cta`) for the primary action on each card, biscuit (`nav-active`)
 * for the selected view. The brand violet is off this screen's controls
 * entirely.
 *
 * ── MINIMAL CARDS ─────────────────────────────────────────────────────────
 *
 * An upcoming card is the event, what was bought, and one full-width "View
 * ticket". The next-pass banner above the list, the "Confirmed" chip on every
 * card (everything under Upcoming is confirmed) and the envelope beside the
 * button are gone — the receipt is emailed from the ticket's own page.
 *
 * ── TWO REQUESTS FOR THE WHOLE SCREEN, NOT TWO PER ROW ────────────────────
 *
 * `/me/bookings` gives the rows and `/me/refund-requests` gives the refund
 * lifecycle (it lives in another module, so it cannot ride on the booking
 * row), joined by `booking_id` in a `Map`. The list needs the second only to
 * FILE a booking correctly — a settled refund is not an upcoming pass — never
 * to display it.
 *
 * ── EVERY NUMBER HERE IS BACKED ───────────────────────────────────────────
 *
 * No seat numbers (there is no seat map — `venues` is deferred), no invoice
 * download (the receipt is EMAILED as a PDF, from the ticket's page).
 */

export function MyBookings() {
  const [tab, setTab] = React.useState<TicketsTab>('upcoming');

  // `now` is state, not `Date.now()` inline: a booking moves from "upcoming" to
  // "finished" and a hold from live to lapsed while this page is open, and a
  // value read during render would freeze both at first paint.
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

  // One request per booking is a backend invariant (a partial unique index), so
  // a flat map by booking id cannot lose one.
  const requests = useQuery({
    queryKey: ['account', 'refund-requests'],
    queryFn: () => fetchMyRefundRequests(),
    staleTime: 30_000,
  });

  const pending = usePendingReviews();

  const rows = React.useMemo(
    () => bookings.data?.pages.flatMap((page) => page.data) ?? [],
    [bookings.data],
  );

  const requestByBooking = React.useMemo(() => {
    const map = new Map<string, RefundRequest>();
    for (const row of requests.data?.data ?? []) map.set(row.booking_id, row);
    return map;
  }, [requests.data]);

  const decorated = React.useMemo(
    () =>
      rows.map((booking) => ({
        booking,
        request: requestByBooking.get(booking.id),
        state: bookingState(booking, requestByBooking.get(booking.id), now),
      })),
    [rows, requestByBooking, now],
  );

  const visible = React.useMemo(
    () => (tab === 'rate' ? [] : rowsForTab(decorated, tab, now)),
    [decorated, tab, now],
  );

  const toRate = React.useMemo(
    () => uniquePendingReviews(pending.data?.data ?? []),
    [pending.data],
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
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
      </header>

      {/* ── THE SLIDING CONTROL ──────────────────────────────────────────
          One track, three equal columns and a biscuit pill that slides to the
          chosen one (`SegmentedControl` — radiogroup semantics, roving
          tabindex, arrow keys). Full width, so each view is a third of the
          row wherever it is pressed. */}
      <SegmentedControl
        aria-label="Filter bookings"
        options={TICKETS_TABS}
        value={tab}
        onValueChange={setTab}
        tone="biscuit"
        size="lg"
        className="w-full p-1"
      />

      {tab === 'rate' ? (
        <RateView
          loading={pending.isPending}
          failed={pending.isError}
          onRetry={() => void pending.refetch()}
          rows={toRate}
        />
      ) : bookings.isError ? (
        <ErrorState
          message="Could not load your bookings."
          onRetry={() => void bookings.refetch()}
          className="rounded-2xl border border-border bg-surface"
        />
      ) : bookings.isPending ? (
        <CardSkeletons />
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface">
          <EmptyState
            icon={TicketIcon}
            title={tab === 'upcoming' ? 'No upcoming bookings' : 'No unpaid bookings'}
            action={
              tab === 'upcoming' ? (
                <Link
                  href="/events"
                  className="inline-flex h-control items-center justify-center rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover"
                >
                  Book tickets
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {visible.map(({ booking, state }) => (
            <li key={booking.id}>
              <BookingCard booking={booking} state={state} now={now} />
            </li>
          ))}
        </ul>
      )}

      {tab !== 'rate' && bookings.hasNextPage ? (
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

      {/* ── HELP ─────────────────────────────────────────────────────────
          A heading and a way in, nothing else. No "online" dot: nothing in
          this platform measures whether anybody is at a desk. */}
      <SurfaceCard className="flex items-center gap-3.5 p-4">
        <span
          aria-hidden
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-nav-active text-nav-active-foreground"
        >
          <Headset className="size-5" />
        </span>
        <p className="min-w-0 flex-1 text-body-sm font-semibold text-foreground">
          Need help with an order?
        </p>
        <Link
          href="/support"
          className="inline-flex h-control-sm shrink-0 items-center rounded-full bg-cta px-4 text-label text-cta-foreground transition-colors duration-fast hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          Contact us
        </Link>
      </SurfaceCard>

    </div>
  );
}

/* ─────────────────────────────────────────────────────────── yet to rate ── */

function RateView({
  loading,
  failed,
  onRetry,
  rows,
}: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  rows: ReturnType<typeof uniquePendingReviews>;
}) {
  if (failed) {
    return (
      <ErrorState
        message="Could not load the events waiting for a rating."
        onRetry={onRetry}
        className="rounded-2xl border border-border bg-surface"
      />
    );
  }
  if (loading) return <CardSkeletons />;
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface">
        <EmptyState icon={Star} title="Nothing to rate" />
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((row) => (
        <li key={row.event_id}>
          <PendingReviewRow row={row} />
        </li>
      ))}
    </ul>
  );
}

function CardSkeletons() {
  return (
    <ul className="flex flex-col gap-4">
      {Array.from({ length: 3 }, (_, index) => (
        <li key={index}>
          <Skeleton className="h-52 w-full rounded-2xl" />
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────────────────────────────────────────── the card ── */

/**
 * The ticket's own page, told it was opened from this list. It then shows the
 * booking as it is — an unpaid one as unpaid, rather than polling for a
 * payment nobody is making — and skips the post-payment confetti on a ticket
 * somebody bought last week.
 */
function ticketHref(booking: MyBooking): string {
  return `/booking/${booking.event_id}/confirmation?booking=${booking.id}&from=bookings`;
}

/**
 * The two card buttons share ONE box: `h-control` tall, `flex-1 basis-0` wide
 * (so two of them split a row exactly in half), `min-w-0` so a label can
 * truncate rather than push its neighbour. Only the colours differ.
 */
const CARD_BUTTON =
  'inline-flex h-control min-w-0 flex-1 basis-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border px-4 text-label transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none';

/**
 * Black: the one primary action on a card. Its border is TRANSPARENT, not
 * absent: a zero flex-basis still counts padding and border, so an outlined
 * neighbour with a 1px border came out 2px wider than this one.
 */
const PRIMARY = cn(
  CARD_BUTTON,
  'border-transparent bg-cta text-cta-foreground shadow-sm hover:bg-cta-hover active:bg-cta-active',
);

/** Outline: the other one. */
const SECONDARY = cn(CARD_BUTTON, 'border-border bg-surface text-foreground hover:bg-muted');

function BookingCard({
  booking,
  state,
  now,
}: {
  booking: MyBooking;
  state: BookingState;
  now: number;
}) {
  const live = holdIsLive(booking, now);
  const tiers = booking.items.map((item) => item.ticket_type_name);
  const tierLabel = tiers.length === 1 ? tiers[0] : tiers.length ? `${tiers.length} tiers` : null;
  const count = booking.active_ticket_count || booking.ticket_count;
  // What was BOOKED, not what was issued: `ticket_count` counts issued tickets,
  // and an unpaid booking has none — it read "0 passes" beside a price.
  const booked =
    booking.ticket_count || booking.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <SurfaceCard as="article" className="p-4">
      {/* ── THE STATUS ROW — UNPAID ONLY ────────────────────────────────
          An upcoming card carries no "Confirmed" chip: everything under
          Upcoming is confirmed, so the chip said the tab's name again on every
          card. (A refunded booking gets no chip either — "Refunded" belongs to
          the ticket's page.) An unpaid card keeps its chip because it is the
          one with news: a countdown, or that the hold lapsed. */}
      {state === 'unpaid' ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <StatusChip tone="failed" icon={Clock3}>
            {live ? minutesLeft(booking.hold_expires_at as string, now) : 'Payment incomplete'}
          </StatusChip>
          <span className="shrink-0 font-mono text-caption text-foreground-subtle">
            {bookingRef(booking.id)}
          </span>
        </div>
      ) : null}

      {/* ── THE EVENT ─────────────────────────────────────────────────── */}
      <div className="flex gap-3.5">
        <PosterThumb src={booking.event_poster_url} alt="" className="size-16" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <OpenEventLink
            event={{ id: booking.event_id, title: booking.event_title, slug: booking.event_slug }}
            /* NO DISPLAY CLASS HERE. `OpenEventLink` renders a `sm:hidden`
               button beside a `hidden sm:inline` anchor and lets CSS pick; a
               `block` passed in merges LAST and wins the display slot on both,
               so the title rendered twice on every card. */
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
      <InsetPanel className="mt-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold text-foreground">
            {tierLabel ?? 'Tickets'}
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {/* SEATS DO NOT EXIST — no row anywhere stores one, so the count is
                the true version of the reference's "Sec A • G12, G13". The
                reference support asks for rides here on an upcoming card,
                which has no status row to carry it. */}
            {booked === 1 ? '1 pass' : `${booked} passes`}
            {state !== 'unpaid' ? (
              <span className="font-mono text-foreground-subtle"> · {bookingRef(booking.id)}</span>
            ) : null}
          </p>
        </div>
        <p className="shrink-0 text-body font-bold tabular-nums text-foreground">
          {formatMoney(booking.total_amount)}
        </p>
      </InsetPanel>

      {/* ── WHAT IS LEFT TO DO ────────────────────────────────────────────
          One full-width black button on an upcoming card. Two EQUAL buttons
          on an unpaid one: `flex-1` with a zero basis on both, so the split is
          exactly half and half whatever each label says — a content-sized
          basis made "Book again" wide and "Details" a stub. */}
      <div className="mt-3.5 flex flex-row gap-3">
        {state === 'unpaid' ? (
          <>
            <Link
              href={
                live
                  ? `/booking/${booking.event_id}/review`
                  : eventPath({ id: booking.event_id, slug: booking.event_slug })
              }
              className={PRIMARY}
            >
              {live ? 'Finish payment' : 'Book again'}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href={ticketHref(booking)} className={SECONDARY}>
              Details
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </>
        ) : (
          <>
            {/* The receipt is emailed from the ticket's own page (its Receipt
                pill); a second copy of that control here was clutter. */}
            <Link href={ticketHref(booking)} className={cn(PRIMARY, 'w-full')}>
              <QrCode className="size-4" aria-hidden />
              {state === 'upcoming' && count > 1 ? `View ${count} tickets` : 'View ticket'}
            </Link>
          </>
        )}
      </div>
    </SurfaceCard>
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

/** Whole minutes, floored, never negative. */
function minutesLeft(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((Date.parse(iso) - now) / 60_000));
  return minutes === 1 ? '1 min left' : `${minutes} mins left`;
}
