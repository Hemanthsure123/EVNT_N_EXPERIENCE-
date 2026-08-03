'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CalendarDays, Loader2, QrCode, Ticket as TicketIcon, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cursorFromNextLink } from '@/lib/api/events';
import type { Paginated } from '@/lib/api/types';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
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
 * shows what is real and links to the event page for the rest. `BACKLOG.md`
 * item 35 asks for the four fields that would make a richer card a single
 * cheap join.
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
 * "Show code" is the near-black `--cta` pill; "Event details" is the quiet
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

export function MyTickets() {
  const [filter, setFilter] = React.useState<FilterId>('all');
  const [open, setOpen] = React.useState<Ticket | null>(null);

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

  const all = query.data?.pages.flatMap((page) => page.data) ?? [];
  const rows = filter === 'all' ? all : all.filter((ticket) => ticket.status === filter);

  return (
    <div className="flex flex-col gap-block lg:gap-block-lg">
      <header className="flex flex-col gap-stack">
        <h1 className="text-h3 md:text-h2">Tickets</h1>
        <p className="text-body text-muted-foreground">
          Show the code at the gate. It works offline once this page has loaded.
        </p>
      </header>

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
                : 'Tickets appear here the moment a booking is paid. Browsing is free and needs no account.'
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
          {rows.map((ticket) => (
            <li key={ticket.id}>
              <TicketCard ticket={ticket} onOpen={() => setOpen(ticket)} />
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

      <TicketSheet ticket={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function TicketCard({ ticket, onOpen }: { ticket: Ticket; onOpen: () => void }) {
  const scannable = ticket.status === 'active';
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
            href={`/events/${ticket.event_id}`}
            className="block truncate text-body-lg font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ticket.event_title}
          </Link>
          <p className="truncate text-body-sm text-muted-foreground">{ticket.ticket_type_name}</p>
        </div>
        <StatusPill tone={TONES[ticket.status]}>{LABELS[ticket.status]}</StatusPill>
      </div>

      <p className="flex items-center gap-1.5 text-caption text-foreground-subtle">
        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
        Issued{' '}
        {new Date(ticket.created_at).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </p>

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
          {scannable ? 'Show code' : LABELS[ticket.status]}
        </button>
        <Link href={`/events/${ticket.event_id}`} className={quietPillClass}>
          Event details
        </Link>
      </div>
    </article>
  );
}

/**
 * The code, large enough to scan from a phone held out at a turnstile.
 *
 * The token is rendered as text rather than a QR image: generating a real QR
 * needs an encoder library, and shipping a picture that only *looks* like a
 * scannable code would be the worst possible thing to fake on this screen —
 * it fails at the one moment it matters, in a queue, with no recourse.
 * BACKLOG item 36 covers the encoder; until then the gate's manual-entry field
 * accepts exactly this string, so the ticket genuinely works.
 */
function TicketSheet({ ticket, onClose }: { ticket: Ticket | null; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Drawer open={Boolean(ticket)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side="responsive" hideClose className="flex flex-col gap-0 p-0 sm:max-w-md">
        {ticket ? (
          <>
            <header className="flex items-start gap-3 border-b border-border p-card">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-h4">{ticket.event_title}</h2>
                <p className="truncate text-body-sm text-muted-foreground">
                  {ticket.ticket_type_name}
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

            {/* THE CODE IS THE PICTURE, NOT THE STRING.
                This sheet used to render the 180-character signed token as its
                headline, in a well, with no QR anywhere — so the one thing the
                gate actually scans was missing, and the thing nobody can use
                was the largest element on the screen.

                The token has not been deleted, because the gate has a
                manual-entry field for a cracked screen or a camera that will
                not focus. It has been demoted to a disclosure: reachable in one
                press, invisible until then. */}
            <div className="flex flex-col items-center gap-stack-lg p-card-lg text-center">
              <p className="text-body-sm text-muted-foreground">
                Show this at the gate. It admits one person, once.
              </p>
              <TicketQrCode
                token={ticket.qr_token}
                label={`QR code for your ${ticket.ticket_type_name} ticket — ${ticket.event_title}`}
                className="p-3"
              />
              {ticket.attendee_name ? (
                <p className="text-body-sm text-foreground">Admits {ticket.attendee_name}</p>
              ) : null}

              <details className="w-full text-left">
                <summary
                  className={cn(
                    'mx-auto w-fit cursor-pointer list-none text-caption text-muted-foreground underline underline-offset-2',
                    '[&::-webkit-details-marker]:hidden',
                    focusRing,
                  )}
                >
                  Can&rsquo;t scan it?
                </summary>
                <div className="mt-stack flex flex-col items-center gap-stack">
                  <p className="w-full break-all rounded-xl border border-border bg-sunken p-card font-mono text-caption text-foreground">
                    {ticket.qr_token}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(ticket.qr_token)
                        .then(() => setCopied(true));
                    }}
                    className={quietPillClass}
                  >
                    {copied ? 'Copied' : 'Copy code'}
                  </button>
                </div>
              </details>

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
