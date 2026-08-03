'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { CalendarDays, MapPin, Undo2 } from 'lucide-react';
import {
  OCCASION_LABELS,
  withdrawQuote,
  type OpenRequest,
  type PerformerQuote,
} from '@/lib/api/performers';
import { ApiError } from '@/lib/api/errors';
import { formatMoney } from '@/lib/discovery/format';
import {
  LANES,
  isPastDay,
  parseDayLocal,
  todayLocal,
  useCalendar,
  useInvalidatePerformer,
  usePipeline,
  useStudioStats,
  type CalendarEntry,
  type PipelineLane,
} from '@/lib/performer/studio';
import { ErrorState, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/* ------------------------------------------------------------- pipeline */

/**
 * Every enquiry, from lead to played.
 *
 * ── FIVE LANES, ALL REAL ──────────────────────────────────────────────────
 *
 * The brief asked for seven. **Negotiation** has no state — a quote is pending
 * or decided, and there is no counter-offer object — and **Accepted vs Booked**
 * are the same event here, because accepting closes the brief and books the
 * act in one transaction. Two lanes holding identical rows teaches somebody
 * there is a step they are missing. Both are BACKLOG items.
 *
 * **Performed** IS real and derived honestly: an accepted quote whose event
 * date has passed. That is a fact about a stored date, not a status somebody
 * forgot to set.
 *
 * ── COLUMNS ON DESKTOP, SECTIONS ON A PHONE ───────────────────────────────
 *
 * Five columns at 380px is five unreadable slivers. The same data stacks into
 * labelled sections below `lg`, which is also the order somebody would read
 * them in.
 *
 * ── NO PRIMARY BUTTON ON THIS BOARD, AND THAT IS CORRECT ──────────────────
 *
 * A pipeline is a place to READ where things stand; the actions live on the
 * screens the cards link to. The only button here is Withdraw, which is
 * destructive, appears only once armed, and is paired with its own escape —
 * it never sits beside a routine control.
 */
export function BookingPipeline({ performerId }: { performerId: string }) {
  const { pipeline, isPending, isError, refetch } = usePipeline(performerId);
  const invalidate = useInvalidatePerformer();
  const [error, setError] = React.useState<string | null>(null);

  const withdraw = useMutation({
    mutationFn: withdrawQuote,
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (thrown) =>
      setError(thrown instanceof ApiError ? thrown.message : 'Could not withdraw that quote.'),
  });

  if (isError) {
    return (
      <ErrorState
        message="Could not load your pipeline."
        onRetry={refetch}
        className="rounded-xl border border-border bg-surface"
      />
    );
  }

  const counts: Record<PipelineLane, number> = {
    leads: pipeline.leads.length,
    quoted: pipeline.quoted.length,
    accepted: pipeline.accepted.length,
    performed: pipeline.performed.length,
    lost: pipeline.lost.length,
  };

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2">Pipeline</h1>
        <p className="text-body-sm text-muted-foreground">
          Every enquiry that has reached you, and where each one stands.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}

      {isPending ? (
        <div className="grid gap-stack-lg lg:grid-cols-5">
          {LANES.map((lane) => (
            <Skeleton key={lane.id} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-stack-lg lg:grid-cols-5">
          {LANES.map((lane) => (
            <section key={lane.id} className="flex min-w-0 flex-col gap-stack">
              <header className="flex items-baseline justify-between gap-2">
                <h2 className="text-body-sm font-semibold">{lane.label}</h2>
                <span className="text-right text-caption tabular-nums text-muted-foreground">
                  {counts[lane.id]}
                </span>
              </header>
              <p className="text-caption text-muted-foreground">{lane.blurb}</p>

              <ul className="flex flex-col gap-2">
                {lane.id === 'leads'
                  ? pipeline.leads.map((lead) => (
                      <li key={lead.id}>
                        <LeadChip lead={lead} performerId={performerId} />
                      </li>
                    ))
                  : pipeline[lane.id].map((quote) => (
                      <li key={quote.id}>
                        <QuoteChip
                          quote={quote}
                          canWithdraw={lane.id === 'quoted'}
                          busy={withdraw.isPending}
                          onWithdraw={() => withdraw.mutate(quote.id)}
                        />
                      </li>
                    ))}
              </ul>

              {counts[lane.id] === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-3 py-block text-center text-caption text-muted-foreground">
                  Nothing here
                </p>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A card in a five-column board is not a page card: `p-stack-lg` (16px) is the
 * tighter rung of the same rhythm, chosen so a lane at `lg` still shows several
 * enquiries at once rather than one and a half.
 */
function LeadChip({ lead, performerId }: { lead: OpenRequest; performerId: string }) {
  return (
    <Link
      href={`/studio/${performerId}/leads`}
      className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-stack-lg shadow-sm transition-colors duration-fast hover:bg-muted motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="truncate text-body-sm font-medium capitalize">
        {OCCASION_LABELS[lead.occasion] ?? lead.occasion}
      </p>
      <p className="truncate text-caption text-muted-foreground">
        {lead.city} · {parseDayLocal(lead.event_date).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
        })}
      </p>
      <p className="text-caption tabular-nums text-muted-foreground">
        {formatMoney(lead.budget_min_minor)} – {formatMoney(lead.budget_max_minor)}
      </p>
    </Link>
  );
}

function QuoteChip({
  quote,
  canWithdraw,
  busy,
  onWithdraw,
}: {
  quote: PerformerQuote;
  canWithdraw: boolean;
  busy: boolean;
  onWithdraw: () => void;
}) {
  const [armed, setArmed] = React.useState(false);

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-stack-lg shadow-sm">
      <p className="truncate text-body-sm font-medium capitalize">
        {OCCASION_LABELS[quote.request_occasion] ?? quote.request_occasion}
      </p>
      <p className="truncate text-caption text-muted-foreground">
        {quote.request_city} ·{' '}
        {parseDayLocal(quote.request_event_date).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
        })}
      </p>
      <p className="text-body-sm tabular-nums">{formatMoney(quote.amount_minor)}</p>

      {quote.status === 'declined' ? (
        <StatusPill tone="neutral">They booked someone else</StatusPill>
      ) : quote.status === 'withdrawn' ? (
        <StatusPill tone="neutral">You withdrew</StatusPill>
      ) : null}

      {canWithdraw ? (
        armed ? (
          <div className="flex flex-col gap-1.5 rounded-lg bg-sunken p-2">
            {/* The consequence, before the click. Withdrawing does not free
                the slot — one quote per brief is a database constraint. */}
            <p className="text-caption text-muted-foreground">
              You cannot quote on this brief again afterwards.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                loading={busy}
                onClick={onWithdraw}
              >
                Withdraw
              </Button>
              <Button variant="outline" size="sm" onClick={() => setArmed(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          // Quiet at rest: a destructive control does not wear a fill until it
          // has been armed and given an escape.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setArmed(true)}
            leftIcon={<Undo2 className="size-3" aria-hidden />}
            className="-ml-3 w-fit text-muted-foreground hover:text-destructive"
          >
            Withdraw
          </Button>
        )
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- calendar */

/**
 * Confirmed dates and open enquiries.
 *
 * ── ONLY REAL DATES ───────────────────────────────────────────────────────
 *
 * There are **no blocked dates and no available dates**, because nothing
 * stores either. A month grid full of green "available" cells would be
 * promising something the platform cannot keep — a performer might be booked
 * elsewhere, ill, or simply not want that Saturday. So this is an AGENDA of
 * what is actually known, not a calendar of what is assumed.
 *
 * BACKLOG "Performer availability calendar" specifies the blackout model it
 * would take to draw the other kind.
 */
export function StudioCalendar({ performerId }: { performerId: string }) {
  const { entries, isPending } = useCalendar(performerId);
  // Date-to-date, not timestamp-to-timestamp — see `isPastDay`. A gig tonight
  // belongs under "Coming up", and west of UTC a parsed date says otherwise.
  const today = todayLocal();
  const upcoming = entries.filter((entry) => !isPastDay(entry.date, today));
  const past = entries.filter((entry) => isPastDay(entry.date, today)).reverse();

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2">Calendar</h1>
        <p className="max-w-prose text-body-sm text-muted-foreground">
          Dates you have actually been booked for, and enquiries you could still win. Curatix does
          not know when you are otherwise busy, so nothing here claims you are free.
        </p>
      </header>

      {isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-card py-section text-center">
          <span
            className="inline-flex size-12 items-center justify-center rounded-full bg-muted"
            aria-hidden
          >
            <CalendarDays className="size-5 text-muted-foreground" />
          </span>
          <p className="text-body font-medium">Nothing in the diary</p>
          <p className="max-w-sm text-body-sm text-muted-foreground">
            Confirmed bookings and the briefs you can answer both appear here, with the soonest
            first.
          </p>
        </div>
      ) : (
        <>
          {upcoming.length ? (
            <Agenda title="Coming up" entries={upcoming} />
          ) : (
            <p className="rounded-xl border border-dashed border-border p-card-lg text-center text-body-sm text-muted-foreground">
              Nothing coming up.
            </p>
          )}
          {past.length ? <Agenda title="Past" entries={past} muted /> : null}
        </>
      )}

      <p className="rounded-xl border border-dashed border-border p-card text-caption text-muted-foreground">
        Blocking out dates you are unavailable is not possible yet — there is nowhere to store
        them, so a calendar showing you as free would be guessing.{' '}
        <code>frontend/BACKLOG.md</code> item 74.
      </p>
    </div>
  );
}

function Agenda({
  title,
  entries,
  muted,
}: {
  title: string;
  entries: CalendarEntry[];
  muted?: boolean;
}) {
  return (
    <section className={cn('flex flex-col gap-stack', muted && 'opacity-70')}>
      <h2 className="text-body font-semibold">{title}</h2>
      <ul className="flex flex-col gap-2">
        {entries.map((entry, index) => {
          const date = parseDayLocal(entry.date);
          return (
            <li key={`${entry.date}-${index}`}>
              <Link
                href={entry.href}
                className="flex items-center gap-4 rounded-xl border border-border bg-surface p-card shadow-sm transition-colors duration-fast hover:bg-muted motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-sunken">
                  <span className="text-caption uppercase text-muted-foreground">
                    {date.toLocaleDateString('en-IN', { month: 'short' })}
                  </span>
                  <span className="text-body font-semibold tabular-nums">{date.getDate()}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-body-sm font-medium capitalize">
                      {entry.title}
                    </span>
                    <StatusPill tone={entry.kind === 'booked' ? 'success' : 'info'}>
                      {entry.kind === 'booked' ? 'Confirmed' : 'Enquiry'}
                    </StatusPill>
                  </p>
                  <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
                    <MapPin className="size-3" aria-hidden />
                    {entry.city}
                  </p>
                </div>

                {entry.amountMinor !== null ? (
                  <p className="shrink-0 text-right text-body tabular-nums">
                    {formatMoney(entry.amountMinor)}
                  </p>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------ analytics */

/**
 * The numbers a performer can act on.
 *
 * ── EVERY FIGURE IS A COUNT OR A SUM OVER THEIR OWN ROWS ──────────────────
 *
 * Quotes sent, decided, won; booked value; average quote. Nothing is modelled,
 * projected or benchmarked against other acts.
 *
 * ── WIN RATE EXCLUDES PENDING QUOTES FROM THE DENOMINATOR ─────────────────
 *
 * Counting a quote nobody has answered yet as a loss makes a performer's rate
 * drop every time they bid, which is the opposite of true. It is `null` until
 * something has actually been decided, because a rate over zero decisions is
 * not 0% — it is unknown, and a dash says that.
 *
 * ── WHAT IS ABSENT, AND WHY IT WOULD BE WORSE TO GUESS ────────────────────
 *
 * Profile views, conversion, click-through and impressions. Nothing records a
 * visit to a performer profile, so each would have to be approximated from
 * lead counts — a different measurement wearing the right label, on the screen
 * a performer would use to decide whether to lower their price.
 */
export function StudioAnalytics({ performerId }: { performerId: string }) {
  const stats = useStudioStats(performerId);
  const { pipeline } = usePipeline(performerId);

  const sent = pipeline.quoted.length + stats.decidedQuotes;

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-col gap-1">
        <h1 className="text-h2">Analytics</h1>
        <p className="max-w-prose text-body-sm text-muted-foreground">
          Counted from your own quotes and bookings. Everything here is a number Curatix actually
          holds — nothing is estimated.
        </p>
      </header>

      <dl className="grid gap-stack sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Quotes sent"
          value={stats.isPending ? null : String(sent)}
          hint="All time"
        />
        <Metric
          label="Win rate"
          value={stats.isPending ? null : stats.winRate === null ? '—' : `${stats.winRate}%`}
          hint={
            stats.decidedQuotes === 0
              ? 'No quote has been decided yet, so there is nothing to divide'
              : `Of ${stats.decidedQuotes} decided — pending ones are not counted against you`
          }
        />
        <Metric
          label="Booked value"
          value={stats.isPending ? null : formatMoney(stats.bookedValueMinor)}
          hint="Agreed with customers. Curatix does not handle this money"
        />
        <Metric
          label="Average quote"
          value={
            stats.isPending
              ? null
              : stats.averageQuoteMinor === null
                ? '—'
                : formatMoney(stats.averageQuoteMinor)
          }
          hint="Across every quote you have sent"
        />
      </dl>

      <section className="flex flex-col gap-stack">
        <h2 className="text-body font-semibold">Where your enquiries stand</h2>
        <ul className="flex flex-col gap-2">
          {LANES.map((lane) => {
            const count =
              lane.id === 'leads' ? pipeline.leads.length : pipeline[lane.id].length;
            const total =
              pipeline.leads.length +
              pipeline.quoted.length +
              pipeline.accepted.length +
              pipeline.performed.length +
              pipeline.lost.length;
            const share = total ? Math.round((count / total) * 100) : 0;
            return (
              <li key={lane.id} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-body-sm">{lane.label}</span>
                <span
                  className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={share}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${lane.label}: ${count} of ${total}`}
                >
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] duration-base ease-out motion-reduce:transition-none"
                    style={{ width: `${share}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right text-caption tabular-nums text-muted-foreground">
                  {count}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Named rather than drawn. A chart of numbers nothing produces is worse
          than an absent one on the screen somebody uses to set their price. */}
      <section className="flex flex-col gap-stack">
        <h2 className="text-body font-semibold">Not measured</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[
            {
              title: 'Profile views',
              why: 'Nothing records a visit to a performer profile, and the public page is edge-cached — a naive counter would miss most traffic anyway.',
            },
            {
              title: 'Conversion rate',
              why: 'Needs views as its denominator. Without them, any figure would really be measuring something else.',
            },
            {
              title: 'Search impressions',
              why: 'The marketplace does not log which acts appeared in which search.',
            },
            {
              title: 'How you compare',
              why: 'Benchmarking against other acts needs their consent and an aggregate nobody computes.',
            },
          ].map((gap) => (
            <li
              key={gap.title}
              className="rounded-xl border border-dashed border-border p-stack-lg text-caption"
            >
              <p className="font-medium text-foreground">{gap.title}</p>
              <p className="text-muted-foreground">{gap.why}</p>
            </li>
          ))}
        </ul>
        <p className="text-caption text-muted-foreground">
          <code>frontend/BACKLOG.md</code> item 75 specifies the view pipeline each of these needs.
        </p>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-card shadow-sm">
      <dt className="text-caption uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-h3 tabular-nums text-foreground">
        {value ?? <Skeleton className="h-7 w-20" />}
      </dd>
      <p className="text-caption text-muted-foreground">{hint}</p>
    </div>
  );
}
