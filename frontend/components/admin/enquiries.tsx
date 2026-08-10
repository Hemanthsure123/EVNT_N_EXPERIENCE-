'use client';

import * as React from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Mail, Music4, Phone } from 'lucide-react';
import {
  decideEnquiry,
  fetchAdminEnquiries,
  type AdminEnquiry,
  type EnquiryStatus,
} from '@/lib/api/admin';
import { cursorFromNextLink } from '@/lib/api/events';
import { errorMessage } from '@/lib/api/errors';
import { formatMoney } from '@/lib/discovery/format';
import { useDebouncedValue } from '@/lib/utils/use-debounced-value';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { TableToolbar } from '@/components/organizer/data-table';
import { SearchField } from '@/components/organizer/filters';
import { cn } from '@/lib/utils/cn';

/**
 * The hire desk.
 *
 * ── THIS IS THE WHOLE MECHANISM, NOT A DASHBOARD OF ONE ───────────────────
 *
 * Nothing is matched, nothing is quoted, no performer is notified. Somebody
 * describes what they need and it lands here; if an operator does not read it
 * and pick up the phone, the customer hears nothing. That is why this screen
 * leads with the CONTACT DETAILS rather than the requirement, and why the
 * primary action on every new row is a `tel:` link.
 *
 * ── IT IS A CARD LIST, NOT THE TABLE ENGINE ───────────────────────────────
 *
 * Every other console list is a data table, and this deliberately is not. A
 * table is for comparing rows; this is a queue you work one at a time, and the
 * useful unit is one enquiry with its notes, its budget and a phone number big
 * enough to tap. A row of truncated cells with the notes behind a column
 * chooser would bury the only part anybody reads.
 *
 * ── `new` IS THE DEFAULT VIEW ─────────────────────────────────────────────
 *
 * It is the only state that means somebody is waiting on us. The tabs are
 * ordered by that: what needs doing, what is in hand, then the record.
 */

const TABS: readonly { value: EnquiryStatus | ''; label: string; blurb: string }[] = [
  { value: 'new', label: 'New', blurb: 'Nobody has looked at these yet.' },
  {
    value: 'in_progress',
    label: 'Being handled',
    blurb: 'Somebody has picked these up — check the note before you call.',
  },
  { value: 'closed_won', label: 'Booked', blurb: 'Closed, and we got the work.' },
  { value: 'closed_lost', label: 'Not booked', blurb: 'Closed without a booking.' },
  { value: '', label: 'Everything', blurb: 'Every enquiry ever sent, oldest first.' },
];

const TONE: Record<EnquiryStatus, 'info' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  new: 'warning',
  in_progress: 'info',
  closed_won: 'success',
  closed_lost: 'neutral',
  cancelled: 'danger',
};

export function EnquiryDesk() {
  const client = useQueryClient();
  const [tab, setTab] = React.useState<EnquiryStatus | ''>('new');
  const [term, setTerm] = React.useState('');
  const search = useDebouncedValue(term.trim(), 250);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['admin', 'enquiries', { tab, search }],
    queryFn: ({ pageParam }) =>
      fetchAdminEnquiries({
        status: tab || undefined,
        q: search || undefined,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    // Never served stale: two operators working the same queue must not both
    // see a row as `new` after one of them picked it up.
    staleTime: 0,
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const active = TABS.find((entry) => entry.value === tab) ?? TABS[0]!;

  const move = async (row: AdminEnquiry, status: EnquiryStatus, note?: string) => {
    setBusyId(row.id);
    setError(null);
    try {
      await decideEnquiry(row.id, { status, admin_note: note ?? row.admin_note });
      void client.invalidateQueries({ queryKey: ['admin', 'enquiries'] });
    } catch (thrown) {
      // The server's own message names the refusal ("the customer withdrew
      // this enquiry"), which is more use than anything written here.
      setError(errorMessage(thrown));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-stack-lg">
      <header className="flex flex-col gap-1">
        <h1 className="text-h3">Hire enquiries</h1>
        <p className="max-w-prose text-body-sm text-muted-foreground">
          People asking about a band, a DJ or a performer. They hear back when somebody here
          gets in touch.
        </p>
      </header>

      <div role="tablist" aria-label="Enquiry status" className="flex flex-wrap gap-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.value || 'all'}
            role="tab"
            type="button"
            aria-selected={tab === entry.value}
            onClick={() => setTab(entry.value)}
            className={cn(
              'inline-flex h-control items-center rounded-full border px-4 text-body-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === entry.value
                ? 'border-transparent bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <TableToolbar>
        <SearchField
          value={term}
          onChange={setTerm}
          placeholder="City, name, phone or anything in the notes"
          label="Search enquiries"
        />
      </TableToolbar>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-destructive-subtle px-3 py-2 text-body-sm text-destructive-subtle-foreground"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {query.isError ? (
        <ErrorState message="Could not load the enquiries." onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-44 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Music4}
          title={search ? 'Nothing matches that' : `No ${active.label.toLowerCase()} enquiries`}
          body={
            search
              ? 'Try a different city, name or phrase.'
              : `${active.blurb} They arrive here the moment somebody sends one.`
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <EnquiryCard
              key={row.id}
              row={row}
              busy={busyId === row.id}
              onMove={(status, note) => void move(row, status, note)}
            />
          ))}
        </ul>
      )}

      {query.hasNextPage ? (
        <Button
          variant="outline"
          className="self-center"
          onClick={() => void query.fetchNextPage()}
          loading={query.isFetchingNextPage}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function EnquiryCard({
  row,
  busy,
  onMove,
}: {
  row: AdminEnquiry;
  busy: boolean;
  onMove: (status: EnquiryStatus, note?: string) => void;
}) {
  const [note, setNote] = React.useState(row.admin_note);
  const withdrawn = row.status === 'cancelled';

  return (
    <li className="flex flex-col gap-stack-lg rounded-xl border border-border bg-surface p-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body font-semibold">
            {row.performer_type_display} in {row.city}
          </p>
          <p className="text-caption text-muted-foreground">
            {row.occasion_display} · {new Date(row.event_date).toLocaleDateString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {row.guests ? ` · ${row.guests.toLocaleString('en-IN')} guests` : ''}
          </p>
        </div>
        <StatusPill tone={TONE[row.status]}>{row.status_display}</StatusPill>
      </div>

      {/* The contact block, first and largest. An operator reading this on a
          phone needs the number before they need the budget, and a `tel:` is
          the primary action on every new row. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-sunken p-3">
        <span className="min-w-0 flex-1 truncate text-body-sm font-medium">
          {row.contact_name || row.customer_email}
        </span>
        {row.contact_phone ? (
          <Button variant="outline" size="sm" asChild>
            <a href={`tel:${row.contact_phone.replace(/\s+/g, '')}`}>
              <Phone className="size-3.5" aria-hidden />
              {row.contact_phone}
            </a>
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" asChild>
          <a href={`mailto:${row.contact_email || row.customer_email}`}>
            <Mail className="size-3.5" aria-hidden />
            Email
          </a>
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-caption sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Budget</dt>
          <dd className="tabular-nums text-foreground">
            {formatMoney(row.budget_min_minor)} – {formatMoney(row.budget_max_minor)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sent</dt>
          <dd className="tabular-nums text-foreground">
            {new Date(row.created_at).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
            })}
          </dd>
        </div>
        {row.handled_by_email ? (
          <div className="min-w-0">
            <dt className="text-muted-foreground">Handled by</dt>
            <dd className="truncate text-foreground">{row.handled_by_email}</dd>
          </div>
        ) : null}
      </dl>

      {row.notes ? (
        <p className="whitespace-pre-line rounded-lg bg-muted p-3 text-body-sm text-foreground">
          {row.notes}
        </p>
      ) : null}

      {withdrawn ? (
        // No controls at all. The customer took their request back, and the
        // server refuses every move — a row of buttons that can only 409 is
        // worse than none.
        <p className="text-caption text-muted-foreground">
          The customer withdrew this. Nothing more to do.
        </p>
      ) : (
        <div className="flex flex-col gap-stack border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`note-${row.id}`} className="text-caption font-medium">
              Note for the next operator
            </label>
            <textarea
              id={`note-${row.id}`}
              value={note}
              rows={2}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Called twice, no answer. Trying again Thursday."
              className="w-full rounded-md border border-input bg-surface px-3 py-2 text-body-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            {/* Said plainly, because the alternative is somebody writing a
                judgement they assume is private and it not being. */}
            <p className="text-caption text-muted-foreground">
              Internal. The customer never sees this.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {row.status !== 'in_progress' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onMove('in_progress', note)}
              >
                I am handling this
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onMove('closed_won', note)}
            >
              Booked
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onMove('closed_lost', note)}
            >
              Not booked
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
