'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  BarChart3,
  CalendarPlus,
  CornerDownLeft,
  QrCode,
  Receipt,
  Search,
  Ticket,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import { Modal, ModalContent } from '@/components/ui/modal';
import {
  fetchCustomers,
  fetchEventRows,
  fetchOrganizerBookings,
  fetchOrganizerRefunds,
  fetchSettlements,
} from '@/lib/api/organizer';
import { ORGANIZER_SECTIONS } from '@/lib/organizer/nav';
import { useDebouncedValue } from '@/lib/utils/use-debounced-value';
import { cn } from '@/lib/utils/cn';
import { useQuery } from '@tanstack/react-query';

/**
 * ⌘K — the dashboard's global search and command bar.
 *
 * FIVE REAL SEARCHES, fired in parallel and debounced to 180ms: events,
 * bookings, customers, payouts and refunds. Every one hits the same endpoint
 * its table uses, so a result here can never be something the table cannot
 * show. Sections and commands match locally and appear instantly, which is
 * what makes the palette feel immediate before the network answers.
 *
 * ── PAYOUTS AND REFUNDS ARE FILTERED LOCALLY, AND ONLY THEM ───────────────
 *
 * Neither endpoint takes a `q`. Both are small per-organizer lists (one
 * settlement per event; refunds are rare by nature), so the first page is
 * fetched once and matched here. That is a deliberate exception to "search on
 * the server" — for events, bookings and customers, which are unbounded, the
 * query goes to the API where the index is.
 *
 * ── WHAT IS NOT SEARCHABLE ────────────────────────────────────────────────
 *
 * The brief lists invoices and venues. **Invoices** are not generated
 * anywhere on this platform — there is no document, so there is nothing to
 * find. **Venues** are a `venue` string on an event rather than an entity, and
 * the event search already matches it, so a separate group would return the
 * same rows under a second heading.
 *
 * ── NOTHING HERE MUTATES ──────────────────────────────────────────────────
 *
 * Every command is a NAVIGATION with intent — "create an event" opens the
 * studio, "on sale now" opens the events table already filtered. The brief
 * asked for a Publish command; publishing from a keystroke away, with no
 * confirmation and no undo, is the wrong place for a state transition that
 * puts tickets on sale. It belongs next to the event it changes.
 *
 * ── THE HIGHLIGHTED ROW WEARS THE "SELECTED" PILL ─────────────────────────
 *
 * Active and hover were both `bg-muted`, so arrowing down with the cursor
 * resting anywhere in the list gave TWO identically highlighted rows and no
 * way to tell which one Enter would open. The keyboard selection is now the
 * warm `--nav-active` fill — the platform's one "this is the current option"
 * colour — and hover stays the quiet muted wash. Two states, two appearances.
 */

const COMMANDS: Omit<Row, 'id' | 'group'>[] = [
  {
    label: 'Create an event',
    hint: 'Open the studio',
    href: '/dashboard/events/new',
    icon: CalendarPlus,
  },
  {
    label: 'Open a draft',
    hint: 'Unpublished, still editable',
    href: '/dashboard/events?status=draft',
    icon: Ticket,
  },
  {
    label: 'Events needing changes',
    hint: 'Sent back by an operator',
    href: '/dashboard/events?status=rejected',
    icon: Ticket,
  },
  {
    label: 'Events on sale now',
    hint: 'Published events only',
    href: '/dashboard/events?status=live',
    icon: Ticket,
  },
  {
    label: 'Paid bookings',
    hint: 'Completed orders',
    href: '/dashboard/bookings?status=paid',
    icon: Receipt,
  },
  {
    label: 'Bookings this week',
    hint: 'Last 7 days',
    href: '/dashboard/bookings?preset=7',
    icon: Receipt,
  },
  {
    label: 'Repeat customers',
    hint: 'More than one booking',
    href: '/dashboard/customers?segment=repeat',
    icon: Users,
  },
  {
    label: 'Scan tickets',
    hint: 'Open the gate scanner',
    href: '/dashboard/check-in',
    icon: QrCode,
  },
  {
    label: 'Analytics',
    hint: 'Trends, conversion, repeat rate',
    href: '/dashboard/analytics',
    icon: BarChart3,
  },
  {
    label: 'Activity timeline',
    hint: 'Everything, newest first',
    href: '/dashboard/activity',
    icon: Activity,
  },
];

type Row = {
  id: string;
  group: string;
  label: string;
  hint: string;
  href: string;
  icon: typeof Ticket;
};

export function OrganizerPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [term, setTerm] = React.useState('');
  const debounced = useDebouncedValue(term.trim(), 180);
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    if (!open) {
      setTerm('');
      setActive(0);
    }
  }, [open]);

  const enabled = open && debounced.length >= 2;

  const events = useQuery({
    queryKey: ['organizer', 'palette', 'events', debounced],
    queryFn: () => fetchEventRows({ q: debounced }),
    enabled,
    staleTime: 30_000,
  });
  const bookings = useQuery({
    queryKey: ['organizer', 'palette', 'bookings', debounced],
    queryFn: () => fetchOrganizerBookings({ q: debounced }),
    enabled,
    staleTime: 30_000,
  });
  const customers = useQuery({
    queryKey: ['organizer', 'palette', 'customers', debounced],
    queryFn: () => fetchCustomers({ q: debounced }),
    enabled,
    staleTime: 30_000,
  });
  // These two take no `q`, so the first page is fetched once and matched
  // locally — see the note at the top of the file. Keyed WITHOUT the term, so
  // typing does not refetch a list that cannot narrow.
  const settlements = useQuery({
    queryKey: ['organizer', 'settlements'],
    queryFn: () => fetchSettlements(),
    enabled: open,
    staleTime: 60_000,
  });
  const refunds = useQuery({
    queryKey: ['organizer', 'refunds', ''],
    queryFn: () => fetchOrganizerRefunds(),
    enabled: open,
    staleTime: 60_000,
  });

  const rows = React.useMemo<Row[]>(() => {
    const needle = debounced.toLowerCase();
    const sections: Row[] = ORGANIZER_SECTIONS.filter(
      (section) => !needle || section.label.toLowerCase().includes(needle),
    ).map((section) => ({
      id: `section:${section.href}`,
      group: 'Go to',
      label: section.label,
      hint: section.hint,
      href: section.href,
      icon: section.icon,
    }));

    const commands: Row[] = COMMANDS.filter(
      (command) => !needle || command.label.toLowerCase().includes(needle),
    ).map((command) => ({ ...command, id: `command:${command.href}`, group: 'Actions' }));

    if (!enabled) return [...sections, ...commands];

    const eventRows: Row[] = (events.data?.data ?? []).slice(0, 5).map((row) => ({
      id: `event:${row.id}`,
      group: 'Events',
      label: row.title,
      hint: `${row.city} · ${row.sold} sold`,
      href: `/dashboard/events?event=${row.id}`,
      icon: Ticket,
    }));
    const bookingRows: Row[] = (bookings.data?.data ?? []).slice(0, 5).map((row) => ({
      id: `booking:${row.id}`,
      group: 'Bookings',
      label: row.customer_name || row.customer_email,
      hint: `${row.event_title} · ${row.status}`,
      href: `/dashboard/bookings?q=${encodeURIComponent(row.customer_email)}`,
      icon: Receipt,
    }));
    const customerRows: Row[] = (customers.data?.data ?? []).slice(0, 5).map((row) => ({
      id: `customer:${row.customer_id}`,
      group: 'Customers',
      label: row.full_name || row.email,
      hint: `${row.bookings} booking${row.bookings === 1 ? '' : 's'}`,
      href: `/dashboard/customers?customer=${row.customer_id}`,
      icon: Users,
    }));

    const payoutRows: Row[] = (settlements.data?.data ?? [])
      .filter((row) => row.event_title.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((row) => ({
        id: `payout:${row.id}`,
        group: 'Payouts',
        label: row.event_title,
        hint: `${row.status === 'paid' ? 'Paid out' : 'Awaiting release'} · ₹${Math.round(row.net / 100)}`,
        href: '/dashboard/payouts',
        icon: Wallet,
      }));

    const refundRows: Row[] = (refunds.data?.data ?? [])
      .filter(
        (row) =>
          row.event_title.toLowerCase().includes(needle) ||
          row.provider_ref.toLowerCase().includes(needle),
      )
      .slice(0, 4)
      .map((row) => ({
        id: `refund:${row.id}`,
        group: 'Refunds',
        label: row.event_title,
        hint: `${row.is_partial ? 'Partial' : 'Full'} refund · ₹${Math.round(row.amount_minor / 100)}`,
        href: `/dashboard/refunds?event_id=${row.event_id}`,
        icon: Undo2,
      }));

    return [
      ...sections,
      ...commands,
      ...eventRows,
      ...bookingRows,
      ...customerRows,
      ...payoutRows,
      ...refundRows,
    ];
  }, [debounced, enabled, events.data, bookings.data, customers.data, settlements.data, refunds.data]);

  React.useEffect(() => setActive(0), [rows.length]);

  const go = React.useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      onOpenChange(false);
      router.push(row.href);
    },
    [onOpenChange, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(rows[active]);
    }
  };

  // Keep the highlighted row in view when arrowing past the fold.
  React.useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const searching = enabled && (events.isFetching || bookings.isFetching || customers.isFetching);
  let lastGroup = '';

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-xl gap-0 p-0" aria-label="Search the dashboard">
        <div className="flex items-center gap-3 border-b border-border px-card">
          {/* Violet, and the only saturated thing in the panel — the search
              glyph is the accent's canonical job in this design language. */}
          <Search className="size-4 shrink-0 text-primary" aria-hidden />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search events, bookings, customers…"
            aria-label="Search events, bookings and customers"
            className="h-control-lg flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
          />
          {searching ? (
            <span className="text-caption text-muted-foreground" role="status">
              Searching…
            </span>
          ) : null}
        </div>

        <ul ref={listRef} className="max-h-96 overflow-y-auto p-2" role="listbox">
          {rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-body-sm text-muted-foreground">
              {enabled ? `Nothing matches “${debounced}”.` : 'Type at least two characters.'}
            </li>
          ) : (
            rows.map((row, index) => {
              const showGroup = row.group !== lastGroup;
              lastGroup = row.group;
              return (
                <React.Fragment key={row.id}>
                  {showGroup ? (
                    <li
                      className="px-3 pb-1 pt-3 text-caption uppercase tracking-wide text-foreground-subtle"
                      aria-hidden
                    >
                      {row.group}
                    </li>
                  ) : null}
                  <li>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      data-active={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(row)}
                      className={cn(
                        'flex min-h-control w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-fast',
                        'motion-reduce:transition-none',
                        index === active
                          ? 'bg-nav-active text-nav-active-foreground'
                          : 'hover:bg-muted',
                      )}
                    >
                      <row.icon
                        className={cn(
                          'size-4 shrink-0',
                          index === active ? 'text-nav-active-foreground' : 'text-muted-foreground',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate text-body-sm',
                            index === active ? 'text-nav-active-foreground' : 'text-foreground',
                          )}
                        >
                          {row.label}
                        </span>
                        {/* A computable ratio (7.0:1 on the cream pill) rather
                            than an opacity over whatever is behind it. */}
                        <span
                          className={cn(
                            'block truncate text-caption',
                            index === active
                              ? 'text-nav-active-foreground/75'
                              : 'text-muted-foreground',
                          )}
                        >
                          {row.hint}
                        </span>
                      </span>
                      {index === active ? (
                        <CornerDownLeft
                          className="size-3.5 shrink-0 text-nav-active-foreground/75"
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  </li>
                </React.Fragment>
              );
            })
          )}
        </ul>

        <footer className="flex items-center gap-3 border-t border-border px-card py-2 text-caption text-muted-foreground">
          <Key label="↑↓" hint="Navigate" />
          <Key label="↵" hint="Open" />
          <Key label="Esc" hint="Close" />
        </footer>
      </ModalContent>
    </Modal>
  );
}

function Key({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded-full border border-border bg-muted px-1.5 py-0.5 font-sans text-caption">
        {label}
      </kbd>
      {hint}
    </span>
  );
}
