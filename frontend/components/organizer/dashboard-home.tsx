'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, CalendarPlus, CalendarRange, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ui';
import { formatMoney } from '@/lib/discovery/format';
import { useEventRows, useSettlements } from '@/lib/organizer/queries';
import { owedTotal } from '@/lib/organizer/attention';
import type { EventRow } from '@/lib/api/organizer';
import { EmptyState, ErrorState, Panel, Poster, Skeleton, StatusPill } from './primitives';
import { ActivityFeed } from './activity-feed';
import { EarningsStrip, InsightsCard } from './earnings';
import { TodayPanel } from './today-panel';
import { StatusBadge } from './status-badge';

/**
 * The dashboard home.
 *
 * ── THE ORDER IS THE ARGUMENT ─────────────────────────────────────────────
 *
 * The brief asks that an organizer opening this every morning immediately
 * knows: what happened, what needs attention, what to do next. Those are three
 * different questions with three different costs of being missed, so they are
 * answered in order of that cost rather than in order of how impressive they
 * look:
 *
 *   1. **What needs attention** — a rejected event loses sales every hour it
 *      goes unseen. It is in the header bell, reachable from every screen.
 *   2. **What happened** — one lead measure at reading size with its own
 *      fourteen-day chart, switchable between revenue, bookings and tickets,
 *      over a rule of supporting figures. See `today-panel.tsx`.
 *   3. **What is next** — the events actually coming up, with what is sold.
 *   4. **What just happened** — the live feed, on the side, where a glance
 *      finds it and it never pushes the decisions down the page.
 *
 * ── THERE ARE NO DECORATIVE TILES ─────────────────────────────────────────
 *
 * Every number on this page is a column or an aggregate the backend maintains.
 * Views, impressions, conversion funnels, "engagement" and revenue forecasts
 * were each considered and none is here, because nothing measures them. A
 * dashboard that invents one number teaches you to doubt all of them.
 *
 * ── AND NO HERO ───────────────────────────────────────────────────────────
 *
 * The section rhythm is `gap-block` (24px), not the attendee site's
 * `gap-section` (40/48px). This is an operations screen: the four questions
 * above are all worth more, per pixel, than the air between them, and every
 * rung saved here is a row of a real table that stays above the fold. Cards
 * are `p-card` and separate the light-first way — hairline plus a very soft
 * shadow — so the whole page reads as one surface with objects on it rather
 * than a stack of boxes.
 */
export function DashboardHome() {
  return (
    <div className="flex flex-col gap-block-lg">
      {/* ── ONE LEAD, THEN SUPPORT ────────────────────────────────────────
          The page used to open with a worklist that is empty most days, then
          four sibling regions of equal weight — attention, today, upcoming,
          money, activity — each in its own card. Five things shouting at the
          same volume is the same as none of them shouting, and it is why the
          screen read as a pile of boxes rather than an answer.

          It now opens on TODAY, because that is the question an organizer
          actually arrives with, and the numbers are the only thing on the page
          that changes hour to hour. The worklist moved into the header bell,
          where it costs nothing on a quiet day and is reachable from every
          screen instead of just this one.

          THE CARD COUNT WAS THE PROBLEM, so it was cut rather than restyled:
          six KPI tiles became one lead panel with a real chart, and the six
          "Jump to" tiles are gone entirely — every one of them duplicated a
          sidebar item that is permanently on screen two inches to the left.
          A shortcut to somewhere you can already see is not a shortcut, it is
          twelve more objects between an organizer and their answer.

          Everything below is reference: what is coming, what is owed, what
          just happened. Two columns on a wide screen, one on a narrow — and
          the money column comes SECOND in the DOM so a phone gets "what's
          next" before "what you're owed", which is the order somebody checking
          between tasks needs them in. */}
      {/* ── HOW THE BUSINESS IS DOING, THEN HOW TODAY IS GOING ───────────
          Three cards, not six tiles. The six that were cut were six phrasings
          of "today", sitting above a panel that already owned today — so they
          competed with it and lost. These three answer a question the panel
          cannot: lifetime, this month, and what a customer is worth. They come
          FIRST because they are the slowest-moving numbers on the page and the
          ones somebody scans once and stops thinking about; today's figures
          are what they came to watch. */}
      <EarningsStrip />

      <TodayPanel />

      <div className="grid gap-block xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] xl:gap-block-lg">
        <div className="flex min-w-0 flex-col gap-block">
          <UpcomingEvents />
        </div>

        <div className="flex min-w-0 flex-col gap-block">
          <InsightsCard />
          <MoneyStrip />
          <section className="flex flex-col gap-stack">
            <SectionHeading
              title="Activity"
              href="/dashboard/activity"
              linkLabel="Full timeline"
            />
            <ActivityFeed limit={6} />
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  title,
  hint,
  href,
  linkLabel,
}: {
  title: string;
  hint?: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-body font-semibold text-foreground">{title}</h2>
        {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      {href ? (
        // Violet survives here as a LINK accent — text, never a fill. The one
        // filled control on this screen is in the top bar.
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1 rounded-full text-label text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {linkLabel ?? 'View all'}
          <ArrowRight
            className="size-3.5 transition-transform duration-fast group-hover:translate-x-0.5 motion-reduce:transition-none"
            aria-hidden
          />
        </Link>
      ) : null}
    </header>
  );
}

/**
 * What is coming up, soonest first.
 *
 * `live` only, and future only. A draft is not "upcoming" in any sense that
 * matters — nobody can buy a ticket to it — and putting drafts here is how a
 * dashboard reassures somebody about an event that is invisible to the public.
 * Drafts surface in the attention panel instead, which is where they belong.
 */
function UpcomingEvents() {
  const now = React.useMemo(() => new Date().toISOString(), []);
  const query = useEventRows({ status: 'live', starts_after: now });
  const events = React.useMemo(
    () =>
      (query.data?.pages.flatMap((page) => page.data) ?? [])
        .slice()
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
        .slice(0, 4),
    [query.data],
  );

  // The soonest event gets the hero treatment; the rest stay rows. ONE hero,
  // never a stack of them — the point of a hero is that it is the thing to
  // look at, and two of them is just a list with bigger pictures.
  const [next, ...rest] = events;

  return (
    <section className="flex flex-col gap-stack">
      <SectionHeading
        title="Happening next"
        href="/dashboard/events"
        linkLabel="All events"
      />

      {query.isError ? (
        <ErrorState
          message="Could not load your events."
          onRetry={() => void query.refetch()}
          className="rounded-xl border border-border bg-surface shadow-sm"
        />
      ) : query.isPending ? (
        <div className="flex flex-col gap-stack">
          {/* Shaped like the hero, not like a row — a skeleton that promises
              the wrong height is the one thing a skeleton exists to prevent. */}
          <Skeleton className="aspect-[16/10] w-full rounded-xl sm:aspect-[16/7]" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState
            icon={CalendarRange}
            title="Nothing on sale"
            body="Once an event is approved it appears here with live sales, so you can see how it is doing without opening it."
            action={
              <Button asChild size="md">
                <Link href="/dashboard/events/new">
                  <CalendarPlus className="size-4 shrink-0" aria-hidden />
                  Create an event
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-stack">
          <NextEventHero event={next} />
          {rest.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {rest.map((event) => (
                <li key={event.id}>
                  <UpcomingCard event={event} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** "In 3 days" / "Tomorrow" / "Today", from the start time. */
function countdownLabel(startsAt: string): string {
  const days = Math.ceil((Date.parse(startsAt) - Date.now()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

/**
 * The next event, at poster size.
 *
 * ── WHAT IS ON IT, AND WHAT IS DELIBERATELY NOT ──────────────────────────
 *
 * The reference layout this follows carries an "Event Readiness 92%" meter and
 * a "Badges synced" line. Neither is here. Readiness is a WIZARD concept —
 * `completion()` scores a draft against the fields needed to publish — and it
 * is meaningless for an event that is already live and selling: the answer is
 * always 100%, so the bar would be decoration that always agrees with itself.
 * Nothing anywhere syncs a badge.
 *
 * What replaces them is the meter this dashboard already trusts: tickets sold
 * against capacity, from the same two columns the row below uses. It answers
 * the question the reference's bar was gesturing at — is this event ready to
 * happen — with a number that is real.
 *
 * ── THE SCRIM IS THE HOUSE RECIPE ────────────────────────────────────────
 *
 * `from-overlay/85 via-overlay/25 to-transparent` with `text-white`, copied
 * from `discovery/showcase-card.tsx` rather than re-picked: a dark foot and a
 * clear top keeps the poster readable AND the title legible, where a flat wash
 * over the whole image greys the artwork. It is also the only place in this
 * layout where a colour is not a semantic token, and it is the same exception
 * the public poster cards already make.
 */
function NextEventHero({ event }: { event: EventRow }) {
  const starts = new Date(event.starts_at);
  const sellThrough = event.capacity > 0 ? event.sold / event.capacity : null;
  const soldOut = sellThrough !== null && event.sold >= event.capacity;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="relative aspect-[16/10] bg-muted sm:aspect-[16/7]">
        <Poster url={event.poster_url} className="size-full object-cover" />
        <div
          className="absolute inset-0 bg-gradient-to-t from-overlay/85 via-overlay/25 to-transparent"
          aria-hidden
        />

        {/* Two pills at the top, pushed to opposite corners: WHEN on the left
            and the event's STATE on the right. They are the two facts worth
            reading before the title, and stacking them would put one of them
            over the artwork's subject. */}
        <div className="absolute inset-x-card top-card flex items-start justify-between gap-2">
          <StatusPill tone="info">{countdownLabel(event.starts_at)}</StatusPill>
          {soldOut ? <StatusPill tone="success">Sold out</StatusPill> : null}
        </div>

        <h3 className="absolute inset-x-card bottom-card line-clamp-2 text-body-lg font-semibold text-white">
          {event.title}
        </h3>
      </div>

      <div className="flex flex-col gap-stack p-card">
        <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          <time dateTime={event.starts_at}>
            {starts.toLocaleString('en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </time>
        </p>
        <p className="flex items-center gap-2 text-body-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" aria-hidden />
          <span className="truncate">
            {event.venue}
            {event.city ? `, ${event.city}` : ''}
          </span>
        </p>

        {/* A SUNKEN sub-card, not another bordered one. A card inside a card
            with the same treatment reads as a rendering mistake; dropping a
            step on the surface ladder says "part of the thing above" without
            drawing a second edge. */}
        {sellThrough === null ? (
          <div className="rounded-lg bg-sunken p-stack">
            <p className="text-caption text-muted-foreground">
              No ticket types yet — add one and this fills in.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg bg-sunken p-stack">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-caption font-medium text-foreground">Tickets sold</span>
              <span className="text-caption font-semibold tabular-nums text-primary">
                {Math.round(sellThrough * 100)}%
              </span>
            </div>
            <ProgressBar
              value={sellThrough}
              aria-label={`${event.sold} of ${event.capacity} tickets sold`}
            />
            <div className="flex items-baseline justify-between gap-2 text-caption text-muted-foreground">
              <span className="tabular-nums">
                {event.sold} / {event.capacity} issued
              </span>
              <span className="tabular-nums">{formatMoney(event.revenue_minor)}</span>
            </div>
          </div>
        )}

        {/* Full width, because it is the only action on the card and a phone
            gives it the whole thumb. No share button beside it: nothing in the
            organizer surface shares an event, and a control that does nothing
            is worse than no control. */}
        <Button asChild size="md" className="w-full">
          <Link href={`/dashboard/events?event=${event.id}`}>Manage event</Link>
        </Button>
      </div>
    </article>
  );
}

function UpcomingCard({ event }: { event: EventRow }) {
  const starts = new Date(event.starts_at);
  const days = Math.ceil((starts.getTime() - Date.now()) / 86_400_000);
  // Sold ÷ capacity, and only when capacity is real. A percentage with a zero
  // denominator is not 0% — it is undefined, and drawing an empty bar for it
  // says "nobody bought" about an event with no tickets set up.
  const sellThrough = event.capacity > 0 ? event.sold / event.capacity : null;

  return (
    <Link
      href={`/dashboard/events?event=${event.id}`}
      className="group flex gap-3 rounded-xl border border-border bg-surface p-card shadow-sm transition-colors duration-fast hover:bg-muted motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative hidden size-16 shrink-0 overflow-hidden rounded-lg bg-muted sm:block">
        <Poster url={event.poster_url} className="size-full object-cover" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-body-sm font-medium">{event.title}</span>
          <StatusBadge status={event.status} />
        </span>

        <span className="text-caption text-muted-foreground">
          {days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`} ·{' '}
          {starts.toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          · {event.city}
        </span>

        {sellThrough === null ? (
          <span className="text-caption text-muted-foreground">No ticket types yet</span>
        ) : (
          <>
            <ProgressBar
              value={sellThrough}
              aria-label={`${event.sold} of ${event.capacity} tickets sold`}
              className="mt-0.5"
            />
            <span className="text-caption tabular-nums text-muted-foreground">
              {event.sold} of {event.capacity} sold · {formatMoney(event.revenue_minor)}
            </span>
          </>
        )}
      </span>
    </Link>
  );
}

/**
 * Money owed and money settled.
 *
 * `owedTotal` is shared with the payouts page so the two cannot disagree about
 * what "owed" means — the number an organizer reads here and the number they
 * read there being different is worse than neither existing.
 */
function MoneyStrip() {
  const query = useSettlements();
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];
  const owed = owedTotal(rows);
  const paid = rows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + row.net, 0);

  return (
    <section className="flex flex-col gap-stack">
      <SectionHeading
        title="Money"
        href="/dashboard/payouts"
        linkLabel="Payouts"
      />

      {query.isError ? (
        <ErrorState
          message="Could not load payouts."
          onRetry={() => void query.refetch()}
          className="rounded-xl border border-border bg-surface shadow-sm"
        />
      ) : (
        <dl className="grid grid-cols-2 gap-2">
          <MoneyCell
            label="Awaiting payout"
            value={query.isPending ? null : formatMoney(owed)}
            hint={`${rows.filter((row) => row.status !== 'paid').length} settlement(s)`}
          />
          <MoneyCell
            label="Paid out"
            value={query.isPending ? null : formatMoney(paid)}
            hint="Released to your linked account"
          />
        </dl>
      )}
    </section>
  );
}

function MoneyCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-card shadow-sm">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-h4 tabular-nums text-foreground">
        {value ?? <Skeleton className="h-6 w-24" />}
      </dd>
      <p className="text-caption text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Re-exported so the dashboard page keeps its single import. */
export { Panel };
