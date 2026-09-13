'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Archive,
  BarChart3,
  CalendarDays,
  MapPin,
  Pencil,
  QrCode,
  Star,
  Ticket,
  Wallet,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Chip, ProgressBar } from '@/components/ui';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { formatMoney } from '@/lib/discovery/format';
import type { EventRow } from '@/lib/api/organizer';
import { LIFECYCLE_FILTERS } from '@/lib/organizer/event-status';
import { useInvalidateOrganizer } from '@/lib/organizer/queries';
import { archiveEvent } from '@/lib/api/organizer-writes';
import { ApiError } from '@/lib/api/errors';
import { NOTICE_TEXT } from '@/components/ui/notice';
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

/**
 * THE LIFECYCLE PILLS.
 *
 * Four, over the same `?status=` param the desktop select writes — see
 * `LIFECYCLE_FILTERS` for why four and for why they carry no counts.
 *
 * It is a sticky rail and therefore wears the REAL `glass`: this is chrome the
 * deck scrolls under, which is the one thing that utility is for. `z-[999]`
 * puts it one below the shell header's `z-sticky` (1000), so it pins beneath
 * the header instead of sliding over its bottom edge.
 */
export function LifecyclePills({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'glass sticky top-14 z-[999] flex gap-2 overflow-x-auto border-b px-card py-2.5',
        'touch-manipulation [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {LIFECYCLE_FILTERS.map((option) => (
        <Chip
          key={option.value || 'all'}
          selected={value === option.value}
          onClick={() => onChange(option.value)}
          className="shrink-0"
        >
          {option.label}
        </Chip>
      ))}
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

        {/* ── EDIT AND ARCHIVE, WHERE THE REFERENCE PUTS EDIT AND DELETE ──
            There is no delete and there must not be: an event is referenced by
            bookings, tickets and a settlement, every one of them `PROTECT`ed,
            so the control would either refuse or orphan real money. Archive is
            the real retirement, and it is one-way, which is why it asks. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <IconLink icon={Pencil} label="Edit" href={`/dashboard/events/${row.id}/edit`} />
          <ArchiveButton row={row} />
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
  const scannable = row.status === 'live';

  return (
    <div className="mt-auto grid grid-cols-4 gap-1.5 border-t border-border pt-stack">
      <ActionTile
        icon={QrCode}
        label="Scan desk"
        href={`/dashboard/check-in?event=${row.id}`}
        disabled={!scannable}
        disabledReason="The scan desk opens once the event is published."
      />
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

/**
 * ARCHIVE, AND WHY IT ASKS FIRST.
 *
 * The house rule is that a reversible action gets UNDO rather than a dialog.
 * This is not one: `POST /events/{id}/archive` has no counterpart, so an
 * accidental press on a phone — where this icon is a thumb's width from Edit —
 * retires an event with nothing to press to bring it back.
 *
 * It is drawn for every row and REFUSES with the reason on the ones the
 * endpoint would refuse (`draft`, `rejected` and `finished` are the whole
 * eligible set). Hiding it instead would make the icon appear and disappear as
 * an organizer scrolled, which is harder to learn than a control that is
 * always there and says what it needs.
 */
function ArchiveButton({ row }: { row: EventRow }) {
  const invalidate = useInvalidateOrganizer();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const eligible =
    row.status === 'draft' || row.status === 'rejected' || row.status === 'finished';

  if (!eligible) {
    return (
      <span
        className="inline-flex size-8 cursor-not-allowed items-center justify-center rounded-full text-muted-foreground opacity-50"
        title={
          row.status === 'live'
            ? 'A published event cannot be archived — people hold tickets to it. Cancel it instead.'
            : 'Only drafts, events sent back, and finished events can be archived.'
        }
      >
        <Archive className="size-4" aria-hidden />
        <span className="sr-only">Archive {row.title} (not available)</span>
      </span>
    );
  }

  const run = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await archiveEvent(row.id);
      void invalidate();
      setOpen(false);
    } catch (thrown) {
      setFailure(thrown instanceof ApiError ? thrown.message : 'That request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 rounded-full"
        onClick={() => setOpen(true)}
        aria-label={`Archive ${row.title}`}
        title="Archive"
      >
        <Archive className="size-4" aria-hidden />
      </Button>

      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Archive “{row.title}”?</ModalTitle>
            <ModalDescription>
              It leaves your events list and stops appearing anywhere public. There is no undo —
              bringing it back means creating it again.
            </ModalDescription>
          </ModalHeader>

          {/* NOT red. A failure message is words, never a colour — see
              `notice.tsx`; red is reserved for a control that DESTROYS and for
              an indicator reporting a fact, and neither carries `role="alert"`. */}
          {failure ? (
            <p role="alert" className={NOTICE_TEXT}>
              {failure}
            </p>
          ) : null}

          <ModalFooter>
            {/* The SAFE action is the primary one. A destructive default is how
                a mis-tap costs somebody their event. */}
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="ghost" onClick={() => void run()} disabled={busy}>
              {busy ? 'Archiving…' : 'Archive'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
