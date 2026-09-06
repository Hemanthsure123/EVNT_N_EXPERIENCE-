'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, X } from 'lucide-react';
import { eventPath } from '@/lib/events/ref';
import { fetchMyWaitlist, leaveWaitlist, type WaitlistEntry } from '@/lib/api/waitlist';
import { errorMessage } from '@/lib/api/errors';
import { formatEventDateTime } from '@/lib/discovery/format';
import { EmptyState } from '@/components/organizer/primitives';
import { RemoteImage } from '@/components/ui/remote-image';
import { cn } from '@/lib/utils/cn';

/**
 * What this account is waiting for.
 *
 * ── IT IS A LIST OF PROMISES, NOT A GRID OF POSTERS ──────────────────────
 *
 * Saved events next door is a grid of `EventCard`s, because a bookmark is
 * something you browse back through and the artwork is what you recognise it
 * by. A waiting-list row carries two facts a card has no room for and no
 * vocabulary for — WHETHER WE HAVE WRITTEN YET, and whether the show is still
 * happening — and those are the whole state of the thing. So it is a row with
 * a thumbnail, not a card.
 *
 * ── "WE HAVE WRITTEN TO YOU" IS THE FACT THAT MATTERS ────────────────────
 *
 * A person is emailed about an event exactly ONCE, which is what the message
 * itself promises. That makes `notified_at` terminal rather than a step: after
 * it, this row is a record of something that happened, not a queue position.
 * Saying so is the difference between "still waiting" and "we told you and you
 * did not come" — and somebody who missed the email needs to know which they
 * are looking at.
 *
 * ── AND A CANCELLED SHOW STAYS ───────────────────────────────────────────
 *
 * Carrying `is_available: false`, exactly as a saved event does. Removing it
 * would look like the join was lost, and a show that was called off is
 * precisely the thing somebody waiting most needs to be told about.
 */
export function WaitingList() {
  const client = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: ['my-waitlist'],
    queryFn: fetchMyWaitlist,
    staleTime: 30_000,
  });

  const leave = useMutation({
    mutationFn: (eventId: string) => leaveWaitlist(eventId),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ['my-waitlist'] });
    },
    onError: (thrown) => setError(errorMessage(thrown)),
  });

  const rows = query.data?.data ?? [];

  return (
    <div className="flex flex-col gap-block lg:gap-block-lg">
      <header className="flex flex-col gap-stack">
        <h1 className="text-h3 md:text-h2">Waiting for tickets</h1>
        <p className="max-w-prose text-body text-muted-foreground">
          Events you asked to be told about. We email you once if tickets come back — they go
          first come, first served, and nothing is held for you.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}

      {query.isPending ? (
        <ul className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, index) => (
            <li key={index} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState
            icon={BellRing}
            title="You are not waiting for anything"
            body="When an event is sold out, ask to be told if tickets come back and it will show up here."
            action={
              <Link
                href="/events"
                className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover active:bg-cta-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Browse events
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <WaitingRow
                row={row}
                leaving={leave.isPending && leave.variables === row.id}
                onLeave={() => leave.mutate(row.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WaitingRow({
  row,
  leaving,
  onLeave,
}: {
  row: WaitlistEntry;
  leaving: boolean;
  onLeave: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-card shadow-sm">
      <Link
        href={eventPath(row)}
        className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted"
      >
        <RemoteImage src={row.poster_url} className="size-full object-cover" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link href={eventPath(row)} className="truncate text-body font-semibold text-foreground">
          {row.title}
        </Link>
        <span className="truncate text-caption text-muted-foreground">
          {formatEventDateTime(row.starts_at)} · {row.venue}, {row.city}
        </span>
        <Status row={row} />
      </div>

      <button
        type="button"
        onClick={onLeave}
        disabled={leaving}
        aria-label={`Stop waiting for ${row.title}`}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The one line that says what this row IS.
 *
 * Three states, in the order they override each other. A cancelled show comes
 * first because it makes the other two irrelevant — telling somebody "we will
 * email you" about an event that is not happening is the worst sentence on
 * this screen.
 */
function Status({ row }: { row: WaitlistEntry }) {
  if (!row.is_available) {
    return (
      <span className="mt-0.5 w-fit rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
        This event is no longer on sale
      </span>
    );
  }
  if (row.notified_at) {
    return (
      <span
        className={cn(
          'mt-0.5 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-caption',
          'bg-success-subtle text-success-subtle-foreground',
        )}
      >
        <Check className="size-3" aria-hidden />
        We emailed you — tickets came back
      </span>
    );
  }
  return (
    <span className="mt-0.5 w-fit rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
      Waiting — we will email you once
    </span>
  );
}
