'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  QrCode,
  Send,
  Ticket as TicketIcon,
  X,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cursorFromNextLink } from '@/lib/api/events';
import type { Paginated } from '@/lib/api/types';
import {
  REFUND_REQUEST_LABELS,
  fetchMyRefundRequests,
  type RefundRequest,
} from '@/lib/api/refund-requests';
import { RefundRequestDialog, type RefundTarget } from './refund-request';
import { ShareReceiptDialog } from './share-receipt';
import { PendingReviewCard } from '@/components/reviews/review-prompt';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import { TicketQrCode } from '@/components/booking/qr-code';
import {
  EmptyState,
  ErrorState,
  Skeleton,
  StatusPill,
  type Tone,
} from '@/components/organizer/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * My tickets.
 *
 * ── THE PAYLOAD IS SMALL, AND THE UI RESPECTS THAT ────────────────────────
 *
 * `GET /me/tickets` returns id, event id + title, tier name, status, the
 * signed QR token and a created date. That is all. The brief asked each card
 * to also show an event banner, venue, date and seat — none of which are on
 * this payload, and a seat number does not exist anywhere in the platform
 * (there is no seat map).
 *
 * Rather than fabricate them or fire one event request per ticket, the card
 * shows what is real and links to the event page for the rest. Widening the
 * payload with venue, date and poster would make a richer card one cheap join
 * — do that before adding a second request per row.
 *
 * ── THE QR IS THE PRODUCT ─────────────────────────────────────────────────
 *
 * The token is an HMAC-signed `v1.<payload>.<hmac>` carrying ids only — no
 * PII. It is what a gate scans. It is therefore shown large, on demand, in a
 * sheet, rather than shrunk into a list row where nobody could scan it.
 *
 * A VOID ticket deliberately does not render its code at all. A refunded
 * ticket is already denied at the gate, but presenting a scannable-looking
 * code to someone who will be turned away at a door is a cruelty the UI can
 * simply decline to commit.
 *
 * ── ONE PRIMARY ACTION PER CARD, AND IT IS "SHOW CODE" ────────────────────
 *
 * "Show code" is the near-black `--cta` pill; the rest are quiet
 * outline pill beside it. That ranking is the whole point of the card — a
 * person opening this page in a queue is doing exactly one thing. The status
 * FILTERS above are state, not action, so they wear the warm `--nav-active`
 * pill instead; if they were black too, four filters and eight buttons would
 * all shout at the same volume.
 *
 * Every control on this screen is `h-control` (44px) — this is the surface most
 * likely to be used one-handed, standing up, in a hurry.
 */

type Ticket = {
  id: string;
  /** Which booking issued it — the unit a refund actually acts on. */
  booking_id: string;
  event_id: string;
  event_title: string;
  ticket_type_id: string;
  ticket_type_name: string;
  status: 'active' | 'used' | 'void';
  qr_token: string;
  /** Who this ticket admits, when the buyer named somebody. Blank means the
   *  buyer is going — the default, and it needs no label on their own screen. */
  attendee_name?: string;
  attendee_email?: string;
  created_at: string;
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Ready to use' },
  { value: 'used', label: 'Used' },
  { value: 'void', label: 'Refunded' },
] as const;

type FilterId = (typeof FILTERS)[number]['value'];

const TONES: Record<Ticket['status'], Tone> = {
  active: 'success',
  used: 'neutral',
  void: 'danger',
};

const LABELS: Record<Ticket['status'], string> = {
  active: 'Ready to use',
  used: 'Checked in',
  void: 'Refunded',
};

/**
 * The two button shapes this screen uses, written once.
 *
 * `ctaPillClass` is the light-first language's primary action: a near-black
 * fill (near-white in dark, from the same `--cta` token), a white label, fully
 * rounded, `px-pill` of horizontal room because a capsule's corners eat the
 * ends of its label. `quietPillClass` is its outline partner — same height and
 * radius so a pair of them lines up, but it never competes.
 */
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const ctaPillClass = cn(
  'inline-flex h-control items-center justify-center gap-2 rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm',
  'transition-colors duration-fast hover:bg-cta-hover active:bg-cta-active',
  focusRing,
);

const quietPillClass = cn(
  'inline-flex h-control items-center justify-center gap-2 rounded-full border border-border bg-surface px-pill text-label text-foreground',
  'transition-colors duration-fast hover:bg-muted',
  focusRing,
);

/**
 * The refund tones, mapped onto the pills this screen already uses.
 *
 * `approved` is `info`, deliberately NOT `success` — a green tick beside
 * "Approved" reads as money returned, and the money has not necessarily moved.
 * `failed` is `danger` for the opposite reason: the approval stood but the
 * transfer did not, and that must never look like a finished refund.
 */
const REFUND_TONES: Record<RefundRequest['status'], Tone> = {
  pending: 'warning',
  approved: 'info',
  rejected: 'neutral',
  failed: 'danger',
};

export function MyTickets() {
  const [filter, setFilter] = React.useState<FilterId>('all');
  const [open, setOpen] = React.useState<BookingGroup | null>(null);
  const [sharing, setSharing] = React.useState<BookingGroup | null>(null);
  const [refunding, setRefunding] = React.useState<RefundTarget | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['account', 'tickets'],
    queryFn: ({ pageParam }) =>
      api.get<Paginated<Ticket>>(`/me/tickets${pageParam ? `?cursor=${pageParam}` : ''}`),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    // A ticket's status can change while the page is open — a refund voids it.
    // This is the one thing a person must not be wrong about at a door.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  // One request per booking is a backend invariant (a partial unique index),
  // so a flat map by booking id cannot lose one. Fetched ONCE for the screen
  // rather than per card — the alternative is a request per ticket, which on a
  // page that exists to load fast in a queue is the wrong trade.
  const requests = useQuery({
    queryKey: ['account', 'refund-requests'],
    queryFn: () => fetchMyRefundRequests(),
    staleTime: 30_000,
  });

  const requestByBooking = React.useMemo(() => {
    const map = new Map<string, RefundRequest>();
    for (const row of requests.data?.data ?? []) map.set(row.booking_id, row);
    return map;
  }, [requests.data]);

  // Memoised because two derived maps below depend on it. A fresh array each
  // render would rebuild both on every keystroke elsewhere in the tree.
  const all = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const rows = filter === 'all' ? all : all.filter((ticket) => ticket.status === filter);

  /**
   * Every ticket that can actually admit somebody, in list order.
   *
   * A used or refunded ticket has no code to show (see the note at the top of
   * this file), so the sheet filters to active ones — including the rest would
   * put blank slides between the live codes.
   */
  /**
   * ── ONE CARD PER BOOKING, NOT PER TICKET ────────────────────────────────
   *
   * Twelve tickets on one booking rendered twelve identical cards — same
   * event, same tier, same date, same buttons — and the only thing that
   * distinguished them was nothing. The screen became a wall of duplicates
   * that pushed every OTHER booking below the fold, which is the opposite of
   * what a ticket wallet is for.
   *
   * Google Wallet does exactly this for grouped event passes: one item, and
   * the individual passes appear on a carousel inside it. The sheet was
   * already a carousel; it just had no reason to exist while the list was
   * doing its job twelve times over.
   *
   * Grouped by BOOKING rather than by event: a booking is what was paid for
   * once, refunded as a unit, and carried by one party through one gate.
   * Insertion order is preserved, so the list keeps the server's ordering.
   */
  const groups = React.useMemo(() => {
    const map = new Map<string, BookingGroup>();
    for (const ticket of rows) {
      const existing = map.get(ticket.booking_id);
      if (existing) {
        existing.tickets.push(ticket);
        if (existing.tierName !== ticket.ticket_type_name) existing.tierName = null;
      } else {
        map.set(ticket.booking_id, {
          bookingId: ticket.booking_id,
          eventId: ticket.event_id,
          eventTitle: ticket.event_title,
          tierName: ticket.ticket_type_name,
          issuedAt: ticket.created_at,
          tickets: [ticket],
        });
      }
    }
    return [...map.values()];
  }, [rows]);

  // How many of this account's tickets one booking covers. A refund voids all
  // of them, and the dialog says so before the button.
  const ticketsPerBooking = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const ticket of all) {
      counts.set(ticket.booking_id, (counts.get(ticket.booking_id) ?? 0) + 1);
    }
    return counts;
  }, [all]);

  return (
    <div className="flex flex-col gap-block lg:gap-block-lg">
      <header className="flex flex-col gap-stack">
        <h1 className="text-h3 md:text-h2">Tickets</h1>
        <p className="text-body text-muted-foreground">
          Show the code at the gate.
        </p>
      </header>

      {/* The non-interrupting half of the review prompt. Renders nothing at
          all when there is nothing to rate, so it costs the page no space in
          the common case. */}
      <PendingReviewCard />

      <div role="tablist" aria-label="Filter tickets" className="flex flex-wrap gap-2">
        {FILTERS.map((entry) => {
          const count =
            entry.value === 'all'
              ? all.length
              : all.filter((ticket) => ticket.status === entry.value).length;
          return (
            <button
              key={entry.value}
              role="tab"
              type="button"
              aria-selected={filter === entry.value}
              onClick={() => setFilter(entry.value)}
              className={cn(
                'inline-flex h-control items-center gap-2 rounded-full border px-4 text-label transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                filter === entry.value
                  ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                  : 'border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {entry.label}
              {count > 0 ? <span className="tabular-nums">{count}</span> : null}
            </button>
          );
        })}
      </div>

      {query.isError ? (
        <ErrorState
          message="Could not load your tickets."
          onRetry={() => void query.refetch()}
          className="rounded-xl border border-border bg-surface shadow-sm"
        />
      ) : query.isPending ? (
        <ul className="grid gap-stack-lg sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index}>
              <Skeleton className="h-44 w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState
            icon={TicketIcon}
            title={all.length ? 'Nothing in this view' : 'No tickets yet'}
            body={
              all.length
                ? 'Try another filter — your other tickets are still here.'
                : 'Tickets appear here as soon as a booking is paid.'
            }
            action={
              all.length ? undefined : (
                <Link href="/events" className={ctaPillClass}>
                  Find something to do
                </Link>
              )
            }
          />
        </div>
      ) : (
        <ul className="grid gap-stack-lg sm:grid-cols-2">
          {groups.map((group) => (
            <li key={group.bookingId}>
              <BookingCard
                group={group}
                refundRequest={requestByBooking.get(group.bookingId)}
                onOpen={() => setOpen(group)}
                onShare={() => setSharing(group)}
                onRequestRefund={() =>
                  setRefunding({
                    bookingId: group.bookingId,
                    eventTitle: group.eventTitle,
                    ticketCount: ticketsPerBooking.get(group.bookingId) ?? group.tickets.length,
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      {query.hasNextPage ? (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className={cn(quietPillClass, 'mx-auto disabled:opacity-60')}
        >
          {query.isFetchingNextPage ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          Load more
        </button>
      ) : null}

      {/* Scoped to the BOOKING that was pressed. It used to receive every
          scannable ticket on the account, so at a gate you could swipe past
          the end of your own party into somebody else's event.

          `open` is an explicit boolean. It was derived as `startAt >= 0`,
          with the parent passing `0` when nothing was selected — so closing
          set the state that reopened it at index 0, and the dialog could not
          be dismissed at all while the account held a scannable ticket. An
          index is a position; it should never have been carrying "is this
          thing open" as well. */}
      <TicketSheet
        open={open !== null}
        tickets={open ? open.tickets.filter((t) => t.status === 'active') : []}
        onClose={() => setOpen(null)}
      />
      <RefundRequestDialog target={refunding} onClose={() => setRefunding(null)} />
      <ShareReceiptDialog
        target={
          sharing
            ? {
                bookingId: sharing.bookingId,
                eventTitle: sharing.eventTitle,
                ticketCount: sharing.tickets.length,
              }
            : null
        }
        onClose={() => setSharing(null)}
      />
    </div>
  );
}

/**
 * A BOOKING — the thing that was paid for once and is carried by one party.
 *
 * See the grouping note in `MyTickets`: this used to be one card per TICKET,
 * so a booking of twelve drew twelve identical cards and buried every other
 * booking under them.
 */
type BookingGroup = {
  bookingId: string;
  eventId: string;
  eventTitle: string;
  /** `null` when the booking spans more than one tier — then the card counts
   *  instead of naming, because "PREMIUM FOOD" over a mixed booking is wrong. */
  tierName: string | null;
  issuedAt: string;
  tickets: Ticket[];
};

function BookingCard({
  group,
  refundRequest,
  onOpen,
  onShare,
  onRequestRefund,
}: {
  group: BookingGroup;
  refundRequest: RefundRequest | undefined;
  onOpen: () => void;
  onShare: () => void;
  onRequestRefund: () => void;
}) {
  const live = group.tickets.filter((t) => t.status === 'active');
  const total = group.tickets.length;
  const scannable = live.length > 0;
  // Only live tickets with no request outstanding can start one. A used ticket
  // has been admitted, a void one is already refunded, and a second request on
  // the same booking is a 409 — offering the control anyway would be a button
  // whose only outcome is an error.
  const refundable = scannable && !refundRequest;

  /**
   * What the pill says for a MIXED booking.
   *
   * Two of twelve used is not "Used" and not "Ready to use" — reporting either
   * one is a false statement about ten tickets. So a mixed booking counts what
   * is still live and the rest is legible from the number beside the title.
   */
  const uniform = group.tickets.every((t) => t.status === group.tickets[0].status);
  const pillStatus = group.tickets[0].status;

  return (
    <article
      className={cn(
        'flex h-full flex-col gap-stack rounded-xl border border-border bg-surface p-card shadow-sm',
        'transition-shadow duration-fast hover:shadow-md motion-reduce:transition-none',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/events/${group.eventId}`}
            className="block truncate text-body-lg font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {group.eventTitle}
          </Link>
          <p className="truncate text-body-sm text-muted-foreground">
            {group.tierName ?? `${total} tickets across tiers`}
          </p>
        </div>
        {uniform ? (
          <StatusPill tone={TONES[pillStatus]}>{LABELS[pillStatus]}</StatusPill>
        ) : (
          <StatusPill tone="info">
            {live.length} of {total} live
          </StatusPill>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-foreground-subtle">
        <span className="flex items-center gap-1.5">
          <TicketIcon className="size-3.5 shrink-0" aria-hidden />
          {/* The count IS the card's reason to exist now — it is what twelve
              duplicate cards were previously communicating by being twelve. */}
          {total === 1 ? '1 ticket' : `${total} tickets`}
        </span>
        <span className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5 shrink-0" aria-hidden />
          Issued{' '}
          {new Date(group.issuedAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      </div>

      {refundRequest ? (
        <div className="rounded-lg border border-border bg-sunken p-3">
          <div className="flex items-center gap-2">
            <StatusPill tone={REFUND_TONES[refundRequest.status]}>
              {REFUND_REQUEST_LABELS[refundRequest.status].label}
            </StatusPill>
            <span className="text-caption text-muted-foreground">Refund request</span>
          </div>
          <p className="mt-1.5 text-caption text-foreground-subtle">
            {REFUND_REQUEST_LABELS[refundRequest.status].customerHint}
          </p>
          {/* The organiser's note on a refusal. Shown verbatim and only when
              there is one — a declined refund with no reason given is what
              turns a customer into a chargeback. */}
          {refundRequest.status === 'rejected' && refundRequest.decision_note ? (
            <p className="mt-1.5 text-caption text-foreground">
              “{refundRequest.decision_note}”
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2 pt-stack">
        <button
          type="button"
          onClick={onOpen}
          disabled={!scannable}
          className={cn(
            scannable
              ? ctaPillClass
              : cn(
                  'inline-flex h-control cursor-not-allowed items-center justify-center gap-2 rounded-full bg-muted px-pill text-label text-muted-foreground',
                  focusRing,
                ),
          )}
        >
          <QrCode className="size-4" aria-hidden />
          {!scannable
            ? LABELS[pillStatus]
            : live.length === 1
              ? 'Show code'
              : `Show ${live.length} codes`}
        </button>
        {/* Sends a RECEIPT, never a ticket. See `ShareBookingDialog`. */}
        <button type="button" onClick={onShare} className={quietPillClass}>
          <Send className="size-4" aria-hidden />
          Share receipt
        </button>
        {refundable ? (
          <button
            type="button"
            onClick={onRequestRefund}
            className={cn(
              'inline-flex h-control items-center justify-center rounded-full px-4 text-label text-muted-foreground',
              'transition-colors duration-fast hover:bg-muted hover:text-foreground',
              focusRing,
            )}
          >
            Request refund
          </button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The codes, large enough to scan from a phone held out at a turnstile.
 *
 * ── IT IS A CAROUSEL, BECAUSE PARTIES ARRIVE TOGETHER ─────────────────────
 *
 * It used to show exactly the ticket whose card was pressed. Four people
 * walking into a venue on one booking meant: show code, let one through, close
 * the sheet, find the next card, press it, show code — five interactions per
 * person, at a turnstile, with a queue behind. The set is what somebody holds,
 * so the set is what the sheet shows, and the arrows step through it in place.
 *
 * Only ACTIVE tickets are in it. A used or refunded ticket has no code to
 * present (see the note at the top of this file), so including them would put
 * blank slides between the live ones.
 *
 * ── "CAN'T SCAN IT?" GOES TO SUPPORT, NOT TO A STRING ─────────────────────
 *
 * It used to disclose the 180-character signed token with a Copy button. That
 * is the right artefact for a GATE — their scanner has a manual-entry field —
 * and the wrong one for the person holding the phone: somebody whose code will
 * not scan cannot do anything useful with the raw token, and copying it to
 * paste somewhere is a step towards nothing.
 *
 * What they actually need is a human. The link opens a support query with this
 * ticket already attached, which reaches the organiser and an operator.
 *
 * The token has NOT been deleted — it is on the ticket email, which is where
 * gate staff read it from when a camera will not focus.
 */
function TicketSheet({
  open,
  tickets,
  onClose,
}: {
  /** Explicit, and never derived from an index. See the note at the call
   *  site: deriving it from `startAt >= 0` is what made this undismissable. */
  open: boolean;
  tickets: Ticket[];
  onClose: () => void;
}) {
  const [index, setIndex] = React.useState(0);

  // Back to the first code each time it opens, rather than resuming wherever
  // it was left — a party arrives at the gate in order.
  React.useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const safe = Math.min(index, Math.max(tickets.length - 1, 0));
  const ticket = tickets[safe];
  const many = tickets.length > 1;

  const step = React.useCallback(
    (delta: number) => setIndex((current) => (current + delta + tickets.length) % tickets.length),
    [tickets.length],
  );

  // Left/right arrows step through, because this is a gallery and a keyboard
  // user expects them to. Scoped to the sheet being open.
  React.useEffect(() => {
    if (!open || !many) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, many, step]);

  return (
    <Drawer open={open && tickets.length > 0} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent side="responsive" hideClose className="flex flex-col gap-0 p-0 sm:max-w-md">
        {ticket ? (
          <>
            <header className="flex items-start gap-3 border-b border-border p-card">
              <div className="min-w-0 flex-1">
                {/* `DrawerTitle`, not a bare `h2`. This is a Radix Dialog, and
                    without a `Dialog.Title` descendant it has NO accessible
                    name — a screen reader announces an unnamed dialog on the
                    surface that holds the QR code somebody is about to present
                    at a gate — and Radix logs an error on every open. It
                    already renders `text-h4`, so nothing moves. */}
                <DrawerTitle className="truncate">{ticket.event_title}</DrawerTitle>
                <p className="truncate text-body-sm text-muted-foreground">
                  {ticket.ticket_type_name}
                  {many ? ` · Ticket ${safe + 1} of ${tickets.length}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={cn(
                  'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground',
                  'transition-colors hover:bg-muted hover:text-foreground',
                  focusRing,
                )}
              >
                <X className="size-4" aria-hidden />
              </button>
            </header>

            <div className="flex flex-col items-center gap-stack-lg p-card-lg text-center">
              <p className="text-body-sm text-muted-foreground">
                Show this at the gate. It admits one person, once.
              </p>

              <div className="flex w-full items-center justify-center gap-2">
                {many ? (
                  <SheetArrow side="left" onClick={() => step(-1)} />
                ) : null}
                <TicketQrCode
                  token={ticket.qr_token}
                  label={`QR code for your ${ticket.ticket_type_name} ticket — ${ticket.event_title}`}
                  className="p-3"
                />
                {many ? <SheetArrow side="right" onClick={() => step(1)} /> : null}
              </div>

              {ticket.attendee_name ? (
                <p className="text-body-sm text-foreground">Admits {ticket.attendee_name}</p>
              ) : null}

              {many ? (
                /* Dots, because the count in the header is a fact and this is
                   the position. Buttons rather than decoration: on a phone
                   they are the fastest way to the third person's code. */
                <ul className="flex items-center justify-center gap-2" aria-label="Your tickets">
                  {tickets.map((entry, position) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setIndex(position)}
                        aria-label={`Show ticket ${position + 1}`}
                        aria-current={position === safe}
                        className={cn(
                          'size-2.5 rounded-full transition-colors duration-fast',
                          focusRing,
                          position === safe ? 'bg-foreground' : 'bg-border hover:bg-border-strong',
                        )}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}

              <Link
                href={`/support?ticket=${encodeURIComponent(ticket.id)}`}
                className={cn(
                  'text-caption text-muted-foreground underline underline-offset-2',
                  'transition-colors hover:text-foreground',
                  focusRing,
                )}
              >
                Can&rsquo;t scan it?
              </Link>

              <p className="text-caption text-foreground-subtle">
                This code identifies your ticket and nothing else — it carries no personal
                information.
              </p>
            </div>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

function SheetArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous ticket' : 'Next ticket'}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-foreground',
        'transition-colors duration-fast hover:bg-muted',
        focusRing,
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
