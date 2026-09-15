'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  BarChart3,
  CalendarDays,
  MapPin,
  Pencil,
  QrCode,
  Star,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui';
import { formatMoney } from '@/lib/discovery/format';
import type { EventRow } from '@/lib/api/organizer';
import { cn } from '@/lib/utils/cn';
import { Poster } from './primitives';
import { StatusBadge } from './status-badge';

/**
 * MANAGE EVENTS — the deck.
 *
 * ── IT IS THE ONLY VIEW ON A PHONE, AND THAT IS THE POINT ─────────────────
 *
 * `/dashboard/events` opened on an eight-column table with a sticky header, a
 * column chooser and resizable columns, on a 390px screen. All of that is real
 * work on a desktop — comparing which event sold more is a table's job — and
 * none of it survives the width: what an organizer got was a horizontal
 * scroller in which the title and the number they wanted were never on screen
 * together.
 *
 * A phone asks a different question. Not "which of these twenty sold best" but
 * "here is the one I mean, let me do the thing" — so the deck is built around
 * RECOGNISING an event (the poster, the title, the date) and then ACTING on
 * it, with the four places an organizer goes next on the card itself rather
 * than two navigations away.
 *
 * ── ONE CARD COMPONENT, TWO MOUNTS ───────────────────────────────────────
 *
 * This is also the `lg`+ "cards" view of the same table — the same rows, the
 * same filters, the same selection. A second card recipe for the phone is
 * exactly the drift `events-table.tsx` opens by refusing: two cards that look
 * alike this week.
 *
 * The one thing that differs by width is the SELECT checkbox, which is
 * `lg:inline-flex` — bulk submit/archive is a desktop workflow, and on a phone
 * the bulk bar would land in the same corner as the organizer's bottom nav.
 * Nothing below `lg` can be selected, so that bar can never appear there.
 *
 * ── THE FROST IS `glass-card`, NOT `glass` ───────────────────────────────
 *
 * A blur is a per-frame repaint of everything under it, and this is twenty
 * surfaces on one scroll. `glass-card` keeps the pane, the hairline and the
 * fall-off and drops the `backdrop-filter` — see the note beside it in
 * `globals.css`, which is the same trade `.glass-media` already made.
 */
export function EventDeck({
  rows,
  isSelected,
  onToggle,
  onOpen,
  hasMore,
}: {
  rows: EventRow[];
  isSelected: (id: string) => boolean;
  onToggle: (id: string) => void;
  onOpen: (row: EventRow) => void;
  /** Whether another page is waiting, which is what turns the count into a
   *  floor. */
  hasMore: boolean;
}) {
  return (
    <div className="flex flex-col gap-stack">
      {/* ── THE COUNT LIVES HERE, NOT ON THE PILLS ──────────────────────
          A cursor-paginated list has no total, so this is what is LOADED and
          says so. On a pill there is no room for that caveat and the number
          would read as "you have 20 events"; in a sentence it can be true. */}
      <p className="text-caption text-muted-foreground">
        {hasMore ? `${rows.length}+` : rows.length} event{rows.length === 1 ? '' : 's'}
        {hasMore ? ' loaded so far' : ''}
      </p>

      <ul className="grid gap-stack xl:grid-cols-2">
        {rows.map((row) => (
          <li key={row.id}>
            <DeckCard
              row={row}
              chosen={isSelected(row.id)}
              onToggle={() => onToggle(row.id)}
              onOpen={() => onOpen(row)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- one card */

function DeckCard({
  row,
  chosen,
  onToggle,
  onOpen,
}: {
  row: EventRow;
  chosen: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const sellThrough = row.capacity > 0 ? row.sold / row.capacity : null;
  const remaining = Math.max(0, row.capacity - row.sold);
  const soldOut = sellThrough !== null && row.sold >= row.capacity;

  return (
    <article
      className={cn(
        'glass-card flex h-full flex-col gap-stack rounded-2xl border p-card shadow-sm',
        'transition-shadow duration-fast motion-reduce:transition-none',
        chosen && 'ring-2 ring-nav-active',
      )}
    >
      <div className="flex items-start gap-stack">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
          <Poster
            url={row.poster_url}
            className="size-full object-cover"
            fallback={
              <span className="flex size-full items-center justify-center px-1 text-center text-caption leading-tight text-muted-foreground">
                No cover
              </span>
            }
          />

          {/* Desktop only — see the note on the module. */}
          <label className="glass-media absolute left-1 top-1 hidden cursor-pointer items-center rounded-md border p-1 lg:inline-flex">
            <input
              type="checkbox"
              checked={chosen}
              onChange={onToggle}
              aria-label={`Select ${row.title}`}
              className="size-4 cursor-pointer accent-primary"
            />
          </label>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <button
            type="button"
            onClick={onOpen}
            className="rounded-sm text-left text-body-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="line-clamp-2">{row.title}</span>
          </button>

          {/* ── THE STATUS, AND NOT A CATEGORY ────────────────────────────
              The reference pairs the badge with a category tag. `EventRow`
              carries no category — the column exists and the organizer list
              serializer does not expose it — so there is nothing to draw, and
              a tag guessed from the title is the invented data this frontend
              refuses. BACKLOG has the field. */}
          <span className="w-fit">
            <StatusBadge status={row.status} capacity={row.capacity} sold={row.sold} />
          </span>
        </div>

        {/* ── EDIT, AND ONLY EDIT ─────────────────────────────────────────
            The card's Archive icon was removed at the owner's instruction —
            archiving is still a bulk action on the desktop table. There is no
            delete and there must not be: an event is referenced by bookings,
            tickets and a settlement, every one of them `PROTECT`ed, so the
            control would either refuse or orphan real money. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <IconLink icon={Pencil} label="Edit" href={`/dashboard/events/${row.id}/edit`} />
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="size-3.5 shrink-0" aria-hidden />
          <time dateTime={row.starts_at}>
            {new Date(row.starts_at).toLocaleString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </time>
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {row.venue}
            {row.city ? `, ${row.city}` : ''}
          </span>
        </span>
      </p>

      {/* The meter drops a step on the surface ladder rather than drawing a
          second border: a card inside a card with the same treatment reads as
          a rendering fault. */}
      {sellThrough === null ? (
        <p className="rounded-xl bg-sunken p-stack text-caption text-muted-foreground">
          No ticket types yet — add one and sales appear here.
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl bg-sunken p-stack">
          <div className="flex items-baseline justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
              <Ticket className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate tabular-nums">
                {row.sold} / {row.capacity}
                {soldOut ? ' · Sold out' : ` · ${remaining} left`}
              </span>
            </span>
            <span className="shrink-0 text-body font-semibold tabular-nums text-foreground">
              {formatMoney(row.revenue_minor)}
            </span>
          </div>
          <ProgressBar value={sellThrough} aria-label={`${row.sold} of ${row.capacity} sold`} />
        </div>
      )}

      <ActionRow row={row} />
    </article>
  );
}

/* ------------------------------------------------------------ the actions */

/**
 * THE FOUR PLACES AN ORGANIZER GOES NEXT.
 *
 * Every one is a real route carrying a real event id, which is the whole
 * difference between this row and a row of decorations:
 *
 * - **Scan desk** opens the gate for THIS event (`?event=`). It is offered
 *   only while the event is published, because the check-in screen lists live
 *   events and nothing else — a button that landed there and silently showed a
 *   different event's gate is how somebody scans a queue against the wrong
 *   event and denies every ticket in it.
 * - **Analytics** is the event's own screen.
 * - **Reviews** filters to this event (`?event=`).
 * - **Payouts** is the settlements list, UNFILTERED. There is one settlement
 *   per event and the endpoint takes no event filter, so scoping it here would
 *   mean searching the loaded page in the browser and reporting "nothing" for
 *   an event whose row is simply on the next one.
 */
function ActionRow({ row }: { row: EventRow }) {
  // Selling: the door is the job. Past its sale window: "who came" is.
  const scannable = row.status === 'live';
  const hasSold =
    row.status === 'finished' ||
    row.status === 'paused' ||
    row.status === 'cancelled' ||
    row.status === 'archived';

  return (
    <div className="mt-auto grid grid-cols-4 gap-1.5 border-t border-border pt-stack">
      {/* ── THE DOOR, AT THE TWO POINTS IT MATTERS ────────────────────
          While the event is selling, the job is scanning; once its sale window
          has passed, the job is "who came". Same tile position, because it is
          the same question at two points in an event's life.

          An event that was NEVER live has neither: there are no tickets to
          scan and nobody to list, so the tile refuses with the reason rather
          than linking to a page that can only be empty. */}
      {scannable ? (
        <ActionTile
          icon={QrCode}
          label="Scan desk"
          href={`/dashboard/check-in?event=${row.id}`}
        />
      ) : hasSold ? (
        <ActionTile
          icon={Users}
          label="Attendees"
          href={`/dashboard/events/${row.id}/attendees`}
        />
      ) : (
        <ActionTile
          icon={QrCode}
          label="Scan desk"
          disabled
          href={`/dashboard/check-in?event=${row.id}`}
          disabledReason="The scan desk opens once the event is published."
        />
      )}
      <ActionTile
        icon={BarChart3}
        label="Analytics"
        href={`/dashboard/events/${row.id}/analytics`}
      />
      <ActionTile icon={Star} label="Reviews" href={`/dashboard/reviews?event=${row.id}`} />
      <ActionTile icon={Wallet} label="Payouts" href="/dashboard/payouts" />
    </div>
  );
}

function ActionTile({
  icon: Icon,
  label,
  href,
  disabled,
  disabledReason,
}: {
  icon: typeof QrCode;
  label: string;
  href: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const shape =
    'flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-caption leading-tight';

  if (disabled) {
    // A `<span>`, not a disabled `<button>`: a disabled control is not
    // focusable, so the reason would be unreachable by keyboard and invisible
    // to a screen reader. `title` carries WHY, because a greyed affordance with
    // no explanation is what reads as "the platform is broken".
    return (
      <span
        className={cn(shape, 'cursor-not-allowed text-muted-foreground opacity-60')}
        title={disabledReason}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="text-center">{label}</span>
        <span className="sr-only">{disabledReason}</span>
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        shape,
        'text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground',
        'motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="text-center">{label}</span>
    </Link>
  );
}

function IconLink({
  icon: Icon,
  label,
  href,
}: {
  icon: typeof Pencil;
  label: string;
  href: string;
}) {
  return (
    <Button variant="ghost" size="icon" asChild className="size-8 rounded-full">
      <Link href={href} aria-label={label} title={label}>
        <Icon className="size-4" aria-hidden />
      </Link>
    </Button>
  );
}
