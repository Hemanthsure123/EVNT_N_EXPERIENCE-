'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  BadgePercent,
  CalendarDays,
  Download,
  MapPin,
  Receipt,
  ScanLine,
  Star,
  Ticket,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import type {
  EventAnalytics as EventAnalyticsData,
  EventStatus,
  OrganizerSettlement,
  TierAnalytics,
} from '@/lib/api/organizer';
import type { Coupon } from '@/lib/api/coupons';
import { fetchCoupons } from '@/lib/api/coupons';
import { ApiError } from '@/lib/api/errors';
import { useActiveOrganization } from '@/lib/organizer/active-organization';
import { useEventAnalytics, useEventSettlement, useReviews } from '@/lib/organizer/queries';
import { downloadCsv, toCsv, type ColumnDef } from '@/lib/organizer/table';
import { formatMoney } from '@/lib/discovery/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { BarList, Meter, TrendLine, statusTone } from './charts';
import { ErrorState, GLASS_PANEL, Panel, Percent, Skeleton } from './primitives';
import { StatusBadge } from './status-badge';

/**
 * One event, everything known about it.
 *
 * ── WHY THIS IS A ROUTE AND NOT THE SIDE PANEL ────────────────────────────
 *
 * `event-panel.tsx` shows a summary beside the table, which is the right shape
 * for glancing while triaging a list. It is the wrong shape for the question
 * "how is this event actually doing" — that is a session, not a glance, and it
 * wants a URL somebody can bookmark, share with a co-organizer, and come back
 * to. The panel stays; this is where "View analytics" now leads.
 *
 * ── THE SECTIONS, IN THE ORDER SOMEBODY ASKS THEM ─────────────────────────
 *
 *   1. Revenue performance    what came in, what went back, what will be PAID
 *   2. Sales over time        the shape of the on-sale
 *   3. Booking insights       started -> paid, and where it leaks
 *   4. Attendance             sold vs admitted, and the gate's audit trail
 *   5. Tier sales             which tier is actually moving
 *   6. Coupon usage           what the discounts cost and whether they worked
 *   7. Feedback               what people said afterwards
 *
 * This used to be four unlabelled regions of KPI tiles and charts. The
 * headings are not decoration: an organizer arrives with ONE of those seven
 * questions and a page with no named parts makes them read all of it.
 *
 * ── THE SETTLEMENT IS THE REVENUE NUMBER THAT MATTERS ─────────────────────
 *
 * "Revenue" here is captured payments still held. What an organizer is
 * actually paid is `gross - platform_fee - refunds`, released after the event
 * AND its refund window — a figure `settlements` owns and this page never
 * computed, so the money question was answered on a different screen entirely.
 * It is now on this one, and it is labelled as the DISPLAY copy that it is:
 * `net` is recomputed authoritatively from the payment records at release
 * time, so nothing here may be presented as the amount that will be paid.
 *
 * ── EVERY RATE CAN BE `null`, AND IS DRAWN THAT WAY ───────────────────────
 *
 * The backend returns `null` rather than `0` for a rate whose denominator is
 * zero, and `Percent` renders that as an em dash. A 0% conversion on an event
 * nobody has opened yet is a false statement, not a neutral one — and it is
 * the kind of false statement an organizer makes a pricing decision on.
 *
 * ── NOTHING HERE IS DERIVED FROM A NUMBER THE BACKEND DID NOT SEND ────────
 *
 * No projections, no "expected sell-out", no comparison against events this
 * organizer does not have. Five capabilities the brief asked for are NAMED at
 * the bottom of the page rather than approximated — see `NotMeasuredYet`.
 *
 * ── THERE IS NO FILLED BUTTON ON THIS SCREEN, ON PURPOSE ──────────────────
 *
 * It is a read surface. Everything on it — the deep links, the CSV export, the
 * range switch — is navigation or a filter, and giving any of them the
 * near-black primary pill would claim an action that does not exist here. The
 * range switch wears the warm "you are here" pill because it is an applied
 * filter, which is the one thing that IS being asserted about state.
 */

const RANGES = [
  { days: 7, short: '7d', label: '7 days' },
  { days: 30, short: '30d', label: '30 days' },
  { days: 90, short: '90d', label: '90 days' },
] as const;

export function EventAnalytics({ eventId }: { eventId: string }) {
  const [days, setDays] = React.useState<number>(30);
  const analytics = useEventAnalytics(eventId, days);

  return (
    <div className="flex flex-col gap-stack-lg">
      <Link
        href="/dashboard/events"
        className="inline-flex w-fit items-center gap-2 rounded-full text-label text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>

      {analytics.isError ? (
        <ErrorState
          message="Could not load this event's analytics."
          onRetry={() => void analytics.refetch()}
        />
      ) : analytics.isPending ? (
        <LoadingShape />
      ) : (
        <Loaded data={analytics.data} days={days} onDays={setDays} eventId={eventId} />
      )}
    </div>
  );
}

function Loaded({
  data,
  days,
  onDays,
  eventId,
}: {
  data: EventAnalyticsData;
  days: number;
  onDays: (days: number) => void;
  eventId: string;
}) {
  const event = data.event;

  return (
    <>
      <Hero data={data} eventId={eventId} />
      <RevenuePerformance data={data} eventId={eventId} />
      <SalesOverTime data={data} days={days} onDays={onDays} />
      <BookingInsights data={data} />
      <Attendance data={data} />
      <TierSales data={data} eventTitle={event?.title ?? 'event'} />
      <CouponUsage eventId={eventId} />
      <Feedback eventId={eventId} />
      <NotMeasuredYet />
    </>
  );
}

/* ------------------------------------------------------------------- head */

/**
 * WHAT THIS PAGE IS ABOUT, AND THE TWO LISTS IT DOES NOT DUPLICATE.
 *
 * Bookings and refunds already filter by event; rebuilding either here would
 * be a second implementation of the same list to keep in step. They are links.
 */
function Hero({ data, eventId }: { data: EventAnalyticsData; eventId: string }) {
  const event = data.event;

  if (!event) {
    return (
      <Panel className={GLASS_PANEL}>
        <p className="p-card text-body-sm text-muted-foreground">
          This event has been deleted. The figures below are what was recorded before it went.
        </p>
      </Panel>
    );
  }

  return (
    <header className={cn(GLASS_PANEL, 'flex flex-col gap-stack rounded-xl p-card shadow-sm')}>
      <div className="flex flex-wrap items-start justify-between gap-stack">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h4">{event.title}</h1>
            <StatusBadge status={event.status as EventStatus} />
          </div>

          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden />
              <time dateTime={event.starts_at}>
                {new Date(event.starts_at).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
            </span>
            {event.venue ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">
                  {event.venue}
                  {event.city ? `, ${event.city}` : ''}
                </span>
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {/* Full width on a phone and a thumb's height, because on this surface
          they are the only two things that are pressable. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:w-fit">
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/bookings?event=${eventId}`}>
            <Receipt className="size-3.5" aria-hidden />
            Bookings
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/refunds?event=${eventId}`}>
            <Ticket className="size-3.5" aria-hidden />
            Refunds
          </Link>
        </Button>
      </div>
    </header>
  );
}

/* --------------------------------------------------------- 1. the revenue */

function RevenuePerformance({ data, eventId }: { data: EventAnalyticsData; eventId: string }) {
  const remaining = Math.max(0, data.capacity - data.sold);

  return (
    <Section title="Revenue performance" hint="Money in, money back, and money owed to you">
      <div className="grid grid-cols-2 gap-stack lg:grid-cols-4">
        <Kpi
          icon={TrendingUp}
          label="Revenue"
          value={formatMoney(data.revenue_minor)}
          hint="Captured payments still held — refunded ones are already out of this"
        />
        <Kpi
          icon={Receipt}
          label="Refunded"
          value={formatMoney(data.refunded_minor)}
          hint={
            data.refunded_count
              ? `${data.refunded_count} refund${data.refunded_count === 1 ? '' : 's'} issued`
              : 'No refunds issued'
          }
        />
        <Kpi
          icon={Ticket}
          label="Sold"
          value={data.capacity ? `${data.sold} / ${data.capacity}` : String(data.sold)}
          hint={data.capacity ? `${remaining} still available` : 'No ticket types yet'}
          rate={data.sell_through_pct}
        />
        <Kpi
          icon={Wallet}
          label="Avg per ticket"
          // DERIVED from two figures on this same payload, and only when the
          // denominator is real. It is the one arithmetic on this page, and it
          // is here because "what is a ticket worth" is the question a tier
          // table makes somebody do on paper.
          value={data.sold > 0 ? formatMoney(Math.floor(data.revenue_minor / data.sold)) : '—'}
          hint={data.sold > 0 ? 'Revenue held, over tickets sold' : 'Nothing sold yet'}
        />
      </div>

      <Payout eventId={eventId} />
    </Section>
  );
}

/**
 * WHAT YOU WILL ACTUALLY BE PAID — and the sentence that has to go with it.
 *
 * `net` here is the running DISPLAY total. At release the figure is recomputed
 * authoritatively from the payment records under the settlement row's lock, so
 * presenting this as "you will receive X" would be a promise made by the wrong
 * copy of the number. The caption says which one this is.
 *
 * A `404` is the ordinary answer for an event that has not started selling —
 * the row is created on the first confirmed payment — so it renders as a
 * sentence rather than as an error state over an otherwise healthy page.
 */
function Payout({ eventId }: { eventId: string }) {
  const settlement = useEventSettlement(eventId);

  if (settlement.isPending) return <Skeleton className="h-24 w-full" />;

  if (settlement.isError) {
    const missing = settlement.error instanceof ApiError && settlement.error.status === 404;
    return (
      <p className="rounded-xl bg-sunken p-card text-caption text-muted-foreground">
        {missing
          ? 'No payout yet. A settlement opens on this event’s first confirmed payment, and releases after the event and its refund window.'
          : 'Could not load this event’s payout.'}
      </p>
    );
  }

  const row: OrganizerSettlement = settlement.data;

  return (
    <div className="flex flex-col gap-stack rounded-xl bg-sunken p-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body-sm font-semibold text-foreground">Payout</h3>
        <SettlementState row={row} />
      </div>

      <dl className="grid grid-cols-2 gap-x-stack gap-y-2 sm:grid-cols-4">
        <Money label="Gross" value={row.gross} />
        <Money label="Platform fee" value={-row.platform_fee} />
        <Money label="Refunds" value={-row.refunds} />
        <Money label="Net" value={row.net} strong />
      </dl>

      <p className="text-caption text-muted-foreground">
        A running total for display. The amount actually transferred is recomputed from the
        payment records when the payout is released.
      </p>
    </div>
  );
}

function SettlementState({ row }: { row: OrganizerSettlement }) {
  if (row.status === 'paid') {
    return (
      <span className="text-caption text-muted-foreground">
        Paid out
        {row.payout_at
          ? ` on ${new Date(row.payout_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
          : ''}
      </span>
    );
  }
  if (row.status === 'failed') {
    // NOT "lost". A failed transfer leaves the money owed, and the label on an
    // organizer's own payout must not imply otherwise.
    return (
      <span className="text-caption text-muted-foreground">Transfer failed — still owed</span>
    );
  }
  if (row.status === 'zero') {
    return <span className="text-caption text-muted-foreground">Nothing to pay</span>;
  }
  return (
    <span className="text-caption text-muted-foreground">
      {row.releasable_at
        ? `Releases ${new Date(row.releasable_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`
        : 'Releases after the event and its refund window'}
    </span>
  );
}

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'truncate tabular-nums',
          strong ? 'text-body font-semibold text-foreground' : 'text-body-sm text-foreground',
        )}
      >
        {/* The sign is `rupees`' own job and it puts it OUTSIDE the symbol —
            prepending one here would give '−₹-128' on a negative net, which a
            settlement can genuinely have when refunds exceed captures. */}
        {formatMoney(value)}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------ 2. the sale */

/**
 * THE ON-SALE, DAY BY DAY — and the toggle that is deliberately not here.
 *
 * The brief asks for a Spots/Tickets switch on this chart. `sales_timeline` is
 * a single series: the sum of PAID payment amounts per day. There is no
 * per-day ticket count and no per-day booking count behind this endpoint, so a
 * switch would either redraw the identical line under a different name or
 * divide revenue by an average price and call the result tickets. Both are
 * worse than one honestly-labelled series. BACKLOG has the field.
 */
function SalesOverTime({
  data,
  days,
  onDays,
}: {
  data: EventAnalyticsData;
  days: number;
  onDays: (days: number) => void;
}) {
  return (
    <Section
      title="Sales over time"
      hint="Paid revenue per day"
      actions={
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Date range">
          {RANGES.map((range) => (
            <Button
              key={range.days}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDays(range.days)}
              aria-pressed={days === range.days}
              // The visible label is abbreviated so three of them fit beside a
              // heading on a phone; the accessible name is not.
              aria-label={range.label}
              className={cn(
                'px-2.5',
                days === range.days
                  ? 'bg-nav-active text-nav-active-foreground hover:bg-nav-active-hover'
                  : 'text-muted-foreground',
              )}
            >
              {range.short}
            </Button>
          ))}
        </div>
      }
    >
      <div className={cn(GLASS_PANEL, 'rounded-xl p-card shadow-sm')}>
        {/* The same line the account-wide trends use. Two time-series forms on
            two adjacent analytics screens is two chart languages to keep in
            step, and the reader has to re-learn the second one. */}
        <TrendLine points={data.sales_timeline} label="Daily revenue" format={formatMoney} />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------- 3. the bookings */

function BookingInsights({ data }: { data: EventAnalyticsData }) {
  return (
    <Section title="Booking insights" hint="Every booking ever started for this event">
      <div className="grid gap-stack lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="grid grid-cols-2 gap-stack">
          <Kpi
            icon={Users}
            label="Conversion"
            value={<Percent value={data.conversion_pct} />}
            hint="Bookings that reached payment"
          />
          <Kpi
            icon={Users}
            label="Abandoned"
            value={<Percent value={data.abandonment_pct} />}
            // The denominator INCLUDES lapsed holds, which is the point: a
            // reserved-then-expired hold is the abandonment this measures.
            hint="Started and never paid, lapsed holds included"
          />
        </div>

        <div className={cn(GLASS_PANEL, 'rounded-xl shadow-sm')}>
          <Distribution items={data.bookings_by_status} empty="No bookings yet." />
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------- 4. show-up quality */

/**
 * SOLD IS NOT THE SAME QUESTION AS SHOWED UP.
 *
 * No-shows are two real counts subtracted, never a rate invented from one.
 * `checkins` comes from the TICKET rows — the used-ticket count is the source
 * of truth — while `scans_by_result` is the gate's parallel audit trail, which
 * answers a different question: how many were REFUSED, and why.
 */
function Attendance({ data }: { data: EventAnalyticsData }) {
  const noShows = data.sold > 0 ? Math.max(0, data.sold - data.checkins) : null;

  return (
    <Section title="Attendance" hint="Who came, and what happened at the gate">
      <div className="grid gap-stack lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className={cn(GLASS_PANEL, 'flex flex-col gap-stack rounded-xl p-card shadow-sm')}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-muted-foreground">
              <ScanLine className="size-3.5 text-primary" aria-hidden />
              Admitted
            </span>
            <span className="text-h4 tabular-nums text-foreground">
              {data.checkins}
              {data.sold ? (
                <span className="text-body-sm text-muted-foreground"> / {data.sold}</span>
              ) : null}
            </span>
          </div>

          {typeof data.attendance_pct === 'number' ? (
            <Meter value={data.attendance_pct / 100} />
          ) : null}

          <p className="text-caption text-muted-foreground">
            <Percent value={data.attendance_pct} /> of tickets sold
            {noShows !== null ? ` · ${noShows} did not show` : ''}
          </p>
        </div>

        <div className={cn(GLASS_PANEL, 'rounded-xl shadow-sm')}>
          <Distribution
            items={data.scans_by_result}
            empty="Nothing has been scanned at the gate yet."
          />
        </div>
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------- 5. the tiers */

function TierSales({ data, eventTitle }: { data: EventAnalyticsData; eventTitle: string }) {
  return (
    <Section
      title="Tier sales"
      // NOT "where the revenue came from", which is what this said and what it
      // is not. The per-tier figure is `sold x list price` — a GROSS — while
      // the headline revenue counts only payments still held, so a refunded
      // ticket is in one and not the other. Those two numbers sitting side by
      // side unexplained is how an organizer decides the dashboard is lying to
      // them; naming the difference is the whole fix.
      hint="Sold at list price, before refunds"
      actions={
        data.tiers.length ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => exportTiers(data.tiers, eventTitle)}
            className="shrink-0 text-muted-foreground"
          >
            <Download className="size-3.5" aria-hidden />
            CSV
          </Button>
        ) : null
      }
    >
      <div className={cn(GLASS_PANEL, 'rounded-xl shadow-sm')}>
        <Tiers tiers={data.tiers} refundedMinor={data.refunded_minor} />
      </div>
    </Section>
  );
}

/* --------------------------------------------------------- 6. the coupons */

/**
 * WHAT THE DISCOUNTS DID — and the one number that must not be misread.
 *
 * Coupons hang off the ORGANIZATION, not the event, so the list here is every
 * code that can be typed at this event's checkout: the ones scoped to it, and
 * the organization-wide ones (`event_id === null`).
 *
 * `redeemed_count` is the code's TOTAL. For an event-scoped code that is this
 * event's number; for an org-wide code it is not, and the two are drawn in
 * separate groups with the wider one saying so. Splitting an org-wide code's
 * redemptions per event needs a grouped read that does not exist — showing the
 * total under an event heading would attribute another event's discounts to
 * this one.
 */
function CouponUsage({ eventId }: { eventId: string }) {
  const { organization, ready } = useActiveOrganization();

  // The SAME key promotions uses, so the two screens share one cache entry
  // rather than each fetching the organization's codes.
  const coupons = useQuery({
    queryKey: ['organizer', 'coupons', organization?.id],
    queryFn: () => fetchCoupons(organization!.id),
    enabled: Boolean(organization?.id),
    staleTime: 30_000,
  });

  if (!ready || coupons.isPending) {
    return (
      <Section title="Coupon usage" hint="Codes that work at this event’s checkout">
        <Skeleton className="h-28 w-full" />
      </Section>
    );
  }

  if (!organization || coupons.isError) {
    return (
      <Section title="Coupon usage" hint="Codes that work at this event’s checkout">
        <Empty>
          {organization
            ? 'Could not load your promo codes.'
            : 'Choose an organisation in the header to see its promo codes.'}
        </Empty>
      </Section>
    );
  }

  const all = coupons.data ?? [];
  const scoped = all.filter((coupon) => coupon.event_id === eventId);
  const wide = all.filter((coupon) => coupon.event_id === null);

  if (!scoped.length && !wide.length) {
    return (
      <Section title="Coupon usage" hint="Codes that work at this event’s checkout">
        <Empty>
          No promo code applies to this event.{' '}
          <Link href="/dashboard/promotions" className="underline underline-offset-2">
            Create one
          </Link>
          .
        </Empty>
      </Section>
    );
  }

  return (
    <Section
      title="Coupon usage"
      hint="You fund the discount, so our fee and your payout both shrink with it"
    >
      <div className="flex flex-col gap-stack">
        {scoped.length ? <CouponGroup coupons={scoped} caption="For this event" /> : null}
        {wide.length ? (
          <CouponGroup
            coupons={wide}
            caption="Works on every event you run"
            // The caveat that stops a number being read as this event's.
            note="Redemptions below are the code’s total across all your events, not this event’s share."
          />
        ) : null}
      </div>
    </Section>
  );
}

function CouponGroup({
  coupons,
  caption,
  note,
}: {
  coupons: Coupon[];
  caption: string;
  note?: string;
}) {
  return (
    <div className={cn(GLASS_PANEL, 'flex flex-col gap-stack rounded-xl p-card shadow-sm')}>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-body-sm font-semibold text-foreground">{caption}</h3>
        {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
      </div>

      <ul className="flex flex-col gap-2">
        {coupons.map((coupon) => (
          <li
            key={coupon.id}
            className="flex flex-wrap items-center justify-between gap-x-stack gap-y-1 rounded-lg bg-sunken px-3 py-2"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <BadgePercent className="size-3.5 shrink-0 text-primary" aria-hidden />
              <span className="truncate font-mono text-body-sm font-semibold">{coupon.code}</span>
              <span className="shrink-0 text-caption text-muted-foreground">
                {couponTerms(coupon)}
              </span>
              {coupon.is_active ? null : (
                <span className="shrink-0 text-caption text-muted-foreground">· switched off</span>
              )}
            </span>

            <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
              {coupon.redeemed_count} used
              {coupon.max_redemptions === null ? '' : ` of ${coupon.max_redemptions}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The terms as the customer would read them, never the stored shape. */
function couponTerms(coupon: Coupon): string {
  if (coupon.kind === 'percent') {
    const cap = coupon.max_discount_minor
      ? `, up to ${formatMoney(coupon.max_discount_minor)}`
      : '';
    return `${coupon.value}% off${cap}`;
  }
  return `${formatMoney(coupon.value)} off`;
}

/* -------------------------------------------------------- 7. the feedback */

/**
 * WHAT PEOPLE SAID, AND THE SCOPE OF THE AVERAGE.
 *
 * The reviews endpoint is cursor-paginated with no aggregate, so a mean here
 * can only describe the reviews currently loaded. Presenting that as "your
 * rating" would be the invented number this codebase refuses elsewhere — a
 * figure that changes as somebody scrolls, from an endpoint that never claimed
 * it. It is labelled, exactly as the account-wide reviews screen labels it.
 *
 * The distribution is FIVE fixed buckets, always all five: a shape that omits
 * the ratings nobody gave is a different shape from the one the data has, and
 * "no 1-stars" is the most reassuring fact on this card.
 */
function Feedback({ eventId }: { eventId: string }) {
  const reviews = useReviews(eventId);

  const rows = React.useMemo(
    () => reviews.data?.pages.flatMap((page) => page.data) ?? [],
    [reviews.data],
  );

  if (reviews.isPending) {
    return (
      <Section title="Feedback" hint="What attendees said afterwards">
        <Skeleton className="h-28 w-full" />
      </Section>
    );
  }

  if (!rows.length) {
    return (
      <Section title="Feedback" hint="What attendees said afterwards">
        <Empty>
          No reviews yet. They can only be written by somebody who held a ticket, so they arrive
          after the event.
        </Empty>
      </Section>
    );
  }

  const average = rows.reduce((sum, review) => sum + review.rating, 0) / rows.length;
  const verified = rows.filter((review) => review.verified_attendee).length;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    label: `${star}★`,
    value: rows.filter((review) => review.rating === star).length,
  }));

  return (
    <Section
      title="Feedback"
      hint="What attendees said afterwards"
      actions={
        <Button asChild variant="ghost" size="sm" className="shrink-0 text-muted-foreground">
          <Link href={`/dashboard/reviews?event=${eventId}`}>Read them</Link>
        </Button>
      }
    >
      <div
        className={cn(
          GLASS_PANEL,
          'grid gap-stack rounded-xl p-card shadow-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-stack-lg',
        )}
      >
        <div className="flex flex-col justify-center gap-1">
          <span className="inline-flex items-baseline gap-1.5">
            <Star className="size-4 shrink-0 self-center text-primary" aria-hidden />
            <span className="text-h3 tabular-nums leading-none text-foreground">
              {average.toFixed(1)}
            </span>
          </span>
          <p className="text-caption text-muted-foreground">
            over {rows.length} review{rows.length === 1 ? '' : 's'} loaded
            {verified > 0 ? ` · ${verified} attended` : ''}
          </p>
        </div>

        <div className="min-w-0">
          <BarList
            items={distribution}
            format={(value) => String(value)}
            emptyLabel="No ratings yet."
          />
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------- what is not here */

/**
 * THE FIVE THINGS THE BRIEF ASKED FOR THAT NOTHING BACKS.
 *
 * Named rather than approximated, and named ON THE PAGE rather than only in a
 * comment — the same rule the performer studio's analytics follows. An
 * organizer who cannot find "when do people book" concludes the dashboard is
 * hiding it; one who reads that it is not measured knows exactly where they
 * stand, and it is the honest form of "coming soon".
 *
 * Each needs a real change, not a render:
 *
 * - **Booking window trend** ("how far ahead do people buy") needs each
 *   booking's `created_at` against the event's `starts_at`, grouped. The
 *   analytics payload carries neither.
 * - **A tickets/spots series** needs a per-day ticket count; `sales_timeline`
 *   is a sum of payment amounts.
 * - **Price change timeline** needs price history. A tier's price is a column
 *   that is overwritten, and nothing records what it was.
 * - **Pricing feature change log** needs an audit trail of which pricing
 *   features were switched on and when. There is no such log.
 * - **Group offer uptake** needs each booking item attributed to the group
 *   band it was priced under. `BookingItem` stores the unit price it paid, not
 *   which band produced it.
 * - **Per-event audience quality** — `GET /organizer/audience` is
 *   account-wide, and showing an account figure under an event heading is the
 *   most quietly wrong thing this page could do.
 */
function NotMeasuredYet() {
  const absent = [
    ['Booking window trend', 'needs each booking’s date against the event’s'],
    ['Tickets per day', 'the sales series is money, not a ticket count'],
    ['Price change timeline', 'a tier’s price is overwritten, never versioned'],
    ['Pricing change log', 'nothing records which pricing features were switched on'],
    ['Group offer uptake', 'a booking stores the price it paid, not the band it came from'],
    ['Audience quality', 'the repeat-customer figure is account-wide, not per event'],
  ];

  return (
    <section aria-labelledby="not-measured" className="flex flex-col gap-stack">
      <h2 id="not-measured" className="text-body-sm font-semibold text-foreground">
        Not measured yet
      </h2>
      <p className="max-w-prose text-caption text-muted-foreground">
        These are absent rather than empty. Nothing on this platform records them, so any figure
        here would be one we made up — and a made-up number on a page you price from is worse than
        a gap you can see.
      </p>
      <ul className="flex flex-col gap-1">
        {absent.map(([title, why]) => (
          <li key={title} className="text-caption text-muted-foreground">
            <span className="font-medium text-foreground">{title}</span> — {why}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ parts */

/**
 * A NAMED REGION.
 *
 * A heading and one line of what it means, then the content. The page had four
 * unlabelled regions before and an organizer arriving with one question had to
 * read all of them to find out which was theirs.
 */
function Section({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-stack">
      <header className="flex items-start gap-stack">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-body-sm font-semibold text-foreground">
            {title}
          </h2>
          {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn(GLASS_PANEL, 'rounded-xl p-card text-body-sm text-muted-foreground shadow-sm')}>
      {children}
    </p>
  );
}

/**
 * A stat tile: an icon and a quiet capped label, then the figure in tabular
 * figures, then at most two lines of context. When the tile carries a rate it
 * also carries the bar for it — sell-through is the one number on this page an
 * organizer reads as a position rather than as a quantity.
 */
function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  rate,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint: string;
  rate?: number | null;
}) {
  return (
    <div className={cn(GLASS_PANEL, 'flex flex-col gap-1 rounded-xl p-card shadow-sm')}>
      <span className="inline-flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5 text-primary" aria-hidden />
        {label}
      </span>
      <span className="text-h4 tabular-nums text-foreground">{value}</span>
      {rate !== undefined ? (
        <>
          {typeof rate === 'number' ? <Meter value={rate / 100} className="mt-0.5" /> : null}
          <span className="text-caption tabular-nums text-muted-foreground">
            <Percent value={rate} /> sold
          </span>
        </>
      ) : null}
      <span className="text-caption text-muted-foreground">{hint}</span>
    </div>
  );
}

function Tiers({ tiers, refundedMinor }: { tiers: TierAnalytics[]; refundedMinor: number }) {
  if (!tiers.length) {
    return (
      <p className="p-card text-body-sm text-muted-foreground">
        This event has no ticket types, so there is nothing to sell yet.
      </p>
    );
  }

  const top = Math.max(...tiers.map((tier) => tier.sold), 1);
  const gross = tiers.reduce((sum, tier) => sum + tier.revenue_minor, 0);

  return (
    <>
      {/* Shown only when the two figures actually disagree — an explanation
          permanently pinned under a panel is read as boilerplate and stops
          being read at all. */}
      {refundedMinor > 0 ? (
        <p className="border-b border-border px-card py-2 text-caption text-muted-foreground">
          {formatMoney(gross)} sold at list price. {formatMoney(refundedMinor)} of it was refunded,
          which is why the headline revenue above is lower.
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {tiers.map((tier) => (
          <li key={tier.id} className="flex flex-col gap-1.5 px-card py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-body-sm font-medium text-foreground">
                {tier.name}
              </span>
              <span className="shrink-0 text-right text-body-sm tabular-nums text-foreground">
                {formatMoney(tier.revenue_minor)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Meter value={tier.sold / top} className="flex-1" />
              <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                {tier.sold}/{tier.quantity} at {formatMoney(tier.price_minor)}
              </span>
            </div>
            {tier.reserved > 0 ? (
              <span className="text-caption text-muted-foreground">
                {tier.reserved} held in carts right now
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * A labelled count list, coloured by STATE rather than by rank.
 *
 * Bars are relative to the largest row, not to a total — these are counts by
 * category, not parts of a whole. The tone comes from the backend's own state
 * string (`statusTone`), so an "allowed" scan and a "denied" one do not read
 * alike, and the row's own label is what carries its identity: several denial
 * reasons legitimately share the destructive tone.
 */
function Distribution({
  items,
  empty,
}: {
  items: { label: string; value: number }[];
  empty: string;
}) {
  return (
    <div className="p-card">
      <BarList
        items={items}
        format={(value) => String(value)}
        emptyLabel={empty}
        toneFor={statusTone}
        humaniseLabels
      />
    </div>
  );
}

function LoadingShape() {
  return (
    <div className="flex flex-col gap-stack-lg">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-stack lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-56" />
    </div>
  );
}

/**
 * Tier performance as a spreadsheet.
 *
 * MAJOR UNITS in the export, unlike everywhere else in this codebase, and it
 * is the one place that conversion belongs: a CSV is opened by a human and
 * summed by a formula. Exporting paise would make every total somebody builds
 * on top of it wrong by a factor of 100, silently.
 */
const TIER_EXPORT_COLUMNS: ColumnDef<TierAnalytics>[] = [
  {
    key: 'name',
    header: 'Tier',
    width: 200,
    render: (tier) => tier.name,
    sortValue: (t) => t.name,
  },
  {
    key: 'price',
    header: 'Price',
    width: 120,
    numeric: true,
    render: (tier) => tier.price_minor,
    exportValue: (tier) => (tier.price_minor / 100).toFixed(2),
  },
  {
    key: 'quantity',
    header: 'Quantity',
    width: 100,
    numeric: true,
    render: (tier) => tier.quantity,
    exportValue: (tier) => tier.quantity,
  },
  {
    key: 'sold',
    header: 'Sold',
    width: 100,
    numeric: true,
    render: (tier) => tier.sold,
    exportValue: (tier) => tier.sold,
  },
  {
    key: 'reserved',
    header: 'Held',
    width: 100,
    numeric: true,
    render: (tier) => tier.reserved,
    exportValue: (tier) => tier.reserved,
  },
  {
    key: 'revenue',
    header: 'Revenue',
    width: 140,
    numeric: true,
    render: (tier) => tier.revenue_minor,
    exportValue: (tier) => (tier.revenue_minor / 100).toFixed(2),
  },
];

function exportTiers(tiers: TierAnalytics[], eventTitle: string) {
  const slug = eventTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'event';
  downloadCsv(`${slug}-tiers.csv`, toCsv(TIER_EXPORT_COLUMNS, tiers));
}
