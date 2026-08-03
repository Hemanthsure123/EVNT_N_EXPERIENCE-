'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Ticket,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  type ActivityEntry,
  type HealthCheck,
  fetchActivity,
  fetchBreakdown,
  fetchHealth,
  fetchOverview,
  fetchTimeseries,
} from '@/lib/api/admin';
import { errorMessage } from '@/lib/api/errors';
import { formatMoney } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';
import { BarList, DonutChart, TrendChart } from './charts';
import { AdminAttentionPanel } from './attention-panel';

/**
 * The console's front page.
 *
 * ── THE ORDER IS THE ARGUMENT ─────────────────────────────────────────────
 *
 * An operator opening this needs four answers, and they are laid out in order
 * of how expensive each is to miss:
 *
 *   1. **What requires attention** — a degraded dependency compounds by the
 *      minute; an event stuck in review is an organizer losing sales. First,
 *      even though on a good day it is empty.
 *   2. **What is failing** — the probed dependencies, honestly labelled.
 *   3. **What changed** — today's counts and the 30-day trends.
 *   4. **What just happened** — the outbox, which is the platform's real
 *      activity log rather than a second pipeline that can drift.
 *
 * Every tile, series and row comes from `/api/v1/admin/*` — real counts over
 * real rows. Nothing on this screen is illustrative.
 *
 * Each panel owns its own query, so a slow or failing one degrades alone
 * instead of blanking the dashboard. That is why there is no single top-level
 * loading state: an operator checking whether payouts are failing should not
 * be blocked by a chart.
 *
 * ── WHAT THE BRIEF ASKED FOR THAT IS NOT HERE ─────────────────────────────
 *
 * A support queue, recent incidents and recent deployments. None has a model:
 * there is no support desk, no incident record, and nothing reports a deploy.
 * Each would be a tile with a made-up number on the screen operators trust
 * most. BACKLOG items 49, 50 and 55 specify what each needs.
 *
 * ── IT IS A CONSOLE, NOT A LANDING PAGE ───────────────────────────────────
 *
 * Density is the design. There is no hero, no illustration and no filled
 * primary button anywhere on this screen — the one toolbar control is an
 * outline Refresh, because "refresh" is not the thing an operator came here to
 * do. Selection state (the metric switcher) wears the warm `--nav-active` pill,
 * the same "you are here" fill the sidebar uses; the brand violet appears only
 * as a link or a leading glyph, never as a button. Every number is
 * `tabular-nums` so a column of them does not shimmer as it polls.
 */

const REFRESH_MS = 30_000;

export function AdminOverview() {
  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: fetchOverview,
    refetchInterval: REFRESH_MS,
  });

  return (
    <div className="flex flex-col gap-block">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-h3">Operations</h1>
          <p className="text-body-sm text-muted-foreground">
            Live counts across every organization, event and payment.
          </p>
        </div>
        {/* The only control in this toolbar, and deliberately NOT the filled
            pill: refreshing is housekeeping, not the task. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void overview.refetch()}
          loading={overview.isFetching}
        >
          <RefreshCw className="size-4" aria-hidden />
          Refresh
        </Button>
      </header>

      <AdminAttentionPanel limit={4} />

      <StatGrid />

      <div className="grid gap-block xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-block">
          <TrendPanel />
          <CityPanels />
        </div>
        <div className="flex flex-col gap-block">
          <QuickActions />
          <HealthPanel />
          <ActivityPanel />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tiles */

function StatGrid() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: fetchOverview,
    refetchInterval: REFRESH_MS,
  });

  if (isError) {
    return (
      <Panel>
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </Panel>
    );
  }

  const tiles: { label: string; value: string; icon: LucideIcon; href?: string; tone?: string }[] =
    [
      {
        label: "Today's revenue",
        value: formatMoney(data?.revenue_today_minor ?? 0),
        icon: TrendingUp,
      },
      { label: 'Bookings today', value: String(data?.bookings_today ?? 0), icon: CalendarCheck },
      { label: 'Check-ins today', value: String(data?.checkins_today ?? 0), icon: ScanLine },
      { label: 'Events live', value: String(data?.events_live ?? 0), icon: CalendarDays },
      { label: 'Tickets issued', value: String(data?.tickets_issued ?? 0), icon: Ticket },
      {
        label: 'Organizations',
        value: String(data?.organizations ?? 0),
        icon: Building2,
        href: '/admin/organizations',
      },
      {
        label: 'Pending verifications',
        value: String(data?.pending_verifications ?? 0),
        icon: ShieldCheck,
        href: '/admin/verifications',
        tone: data?.pending_verifications ? 'warn' : undefined,
      },
      {
        label: 'Failed payouts',
        value: String(data?.failed_payouts ?? 0),
        icon: Wallet,
        href: '/admin/settlements?status=failed',
        tone: data?.failed_payouts ? 'bad' : undefined,
      },
    ];

  return (
    <ul className="grid gap-stack-lg sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => {
        const body = (
          <div
            className={cn(
              // `p-card`, not a number somebody picked: every panel on this
              // screen now shares one padding token.
              'flex h-full flex-col gap-1.5 rounded-xl border bg-surface p-card shadow-sm',
              // Colour, not motion. A tile that lifts on hover moves the number
              // an operator is reading; a border that firms up says "this goes
              // somewhere" without displacing anything.
              'transition-colors duration-fast motion-reduce:transition-none',
              tile.href && 'group-hover:border-border-strong group-hover:bg-sunken',
              tile.tone === 'warn'
                ? 'border-warning-subtle'
                : tile.tone === 'bad'
                  ? 'border-destructive-subtle'
                  : 'border-border',
            )}
          >
            <span className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-muted-foreground">
              <tile.icon className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{tile.label}</span>
              {/* A visible affordance instead of a hover-only one: which tiles
                  open a screen is something you should be able to see without
                  moving a mouse over all eight. */}
              {tile.href ? (
                <ArrowUpRight
                  className="ml-auto size-3.5 shrink-0 text-foreground-subtle"
                  aria-hidden
                />
              ) : null}
            </span>
            {isPending ? (
              <div className="skeleton h-8 w-20 rounded" aria-hidden />
            ) : (
              <span
                className={cn(
                  'text-h3 tabular-nums',
                  // The count carries the tone, not just the hairline. A "3"
                  // next to "Failed payouts" has to be findable in a grid of
                  // eight numbers, and a subtle border is not findable.
                  tile.tone === 'bad'
                    ? 'text-destructive-subtle-foreground'
                    : tile.tone === 'warn'
                      ? 'text-warning-subtle-foreground'
                      : 'text-foreground',
                )}
              >
                {tile.value}
              </span>
            )}
          </div>
        );
        return (
          <li key={tile.label}>
            {tile.href ? (
              <Link
                href={tile.href}
                className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------------------------------------------- charts */

/**
 * The three series, declared once.
 *
 * The panel heading used to be `metric === 'revenue' ? 'Revenue…' : 'Bookings…'`
 * — a two-way ternary over three options, so selecting **Signups** drew the
 * signup series under a heading that said "Bookings, last 30 days". A chart
 * labelled as the wrong metric is worse than no chart, and it is exactly the
 * class of bug a lookup makes impossible.
 */
const METRICS = {
  revenue: { label: 'Revenue', series: 'Captured revenue per day' },
  bookings: { label: 'Bookings', series: 'Paid bookings per day' },
  signups: { label: 'Signups', series: 'New accounts per day' },
} as const;

type Metric = keyof typeof METRICS;

function TrendPanel() {
  const [metric, setMetric] = React.useState<Metric>('revenue');
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin-timeseries', metric],
    queryFn: () => fetchTimeseries(metric, 30),
  });

  return (
    <Panel
      title={`${METRICS[metric].label}, last 30 days`}
      action={
        // A SELECTION, not an action — so it wears the warm `--nav-active` pill
        // on a `--sunken` track, the same pairing the sign-in tabs and the
        // ticket filters use. It was a brand gradient, which read as the
        // primary thing to press on a screen whose job is to be read.
        <div
          role="group"
          aria-label="Metric"
          className="flex h-control shrink-0 items-center rounded-full border border-border bg-sunken p-1"
        >
          {(Object.keys(METRICS) as Metric[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={metric === option}
              onClick={() => setMetric(option)}
              className={cn(
                'inline-flex h-full items-center rounded-full px-3 text-caption transition-colors duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                metric === option
                  ? 'bg-nav-active font-semibold text-nav-active-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {METRICS[option].label}
            </button>
          ))}
        </div>
      }
    >
      {isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : isPending ? (
        <div className="skeleton h-40 w-full rounded-lg" aria-hidden />
      ) : (
        <TrendChart
          points={data.points}
          label={METRICS[metric].series}
          format={(value) => (metric === 'revenue' ? formatMoney(value) : String(value))}
        />
      )}
    </Panel>
  );
}

function CityPanels() {
  const events = useQuery({
    queryKey: ['admin-breakdown', 'events_by_city'],
    queryFn: () => fetchBreakdown('events_by_city', 6),
  });
  const revenue = useQuery({
    queryKey: ['admin-breakdown', 'revenue_by_city'],
    queryFn: () => fetchBreakdown('revenue_by_city', 6),
  });

  return (
    <div className="grid gap-block lg:grid-cols-2">
      <Panel title="Live events by city">
        {events.isPending ? (
          <div className="skeleton h-40 w-full rounded-lg" aria-hidden />
        ) : (
          <BarList
            items={events.data?.items ?? []}
            format={(value) => String(value)}
            emptyLabel="No live events yet."
          />
        )}
      </Panel>

      <Panel title="Revenue by city">
        {revenue.isPending ? (
          <div className="skeleton h-40 w-full rounded-lg" aria-hidden />
        ) : (
          <DonutChart items={revenue.data?.items ?? []} format={(value) => formatMoney(value)} />
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------- health */

/** Proper names — `capitalize` turns "sms" into "Sms". */
const HEALTH_LABELS: Record<string, string> = {
  database: 'Database',
  cache: 'Cache',
  payments: 'Payments',
  storage: 'Storage',
  queue: 'Queue',
  event_bus: 'Event bus',
  email: 'Email',
  sms: 'SMS',
};

/**
 * Which checks the backend actually contacts. Everything else is CONFIGURED —
 * the same split `components/admin/health-centre.tsx` makes, kept identical on
 * purpose so the summary here and the full screen can never tell an operator
 * two different stories.
 */
const PROBED = new Set(['database', 'cache']);

/**
 * THE RULE THIS PANEL EXISTS TO KEEP: a tile is never green because nobody
 * looked.
 *
 * Three statuses, three genuinely different treatments — a shape, an icon and a
 * word each, not three shades of one dot. `unknown` gets a DASHED border and
 * the words "not contacted", because a grey dot beside a green dot in a summary
 * panel reads as "fine, but less so", and this is the widget an operator would
 * trust to decide whether to page somebody.
 */
const HEALTH_TONE: Record<
  HealthCheck['status'],
  { chip: string; wrap: string; icon: LucideIcon; word: string }
> = {
  ok: { chip: 'text-success', wrap: 'border-border', icon: CheckCircle2, word: 'Healthy' },
  degraded: {
    chip: 'text-destructive-subtle-foreground',
    wrap: 'border-destructive-subtle bg-destructive-subtle',
    icon: AlertTriangle,
    word: 'Degraded',
  },
  unknown: {
    chip: 'text-muted-foreground',
    wrap: 'border-dashed border-border',
    icon: CircleHelp,
    word: 'Not contacted',
  },
};

function HealthPanel() {
  const { data, isPending } = useQuery({
    queryKey: ['admin-health'],
    queryFn: fetchHealth,
    refetchInterval: REFRESH_MS,
  });

  const checks = data?.checks ?? [];
  const probed = checks.filter((check) => PROBED.has(check.name));
  const configured = checks.filter((check) => !PROBED.has(check.name));

  return (
    <Panel
      title="System health"
      action={
        // Violet as a LINK — the wayfinding accent's job. Not a button.
        <Link
          href="/admin/health"
          className="rounded-full text-label text-primary hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Full health
        </Link>
      }
    >
      {isPending ? (
        <div className="skeleton h-32 w-full rounded-lg" aria-hidden />
      ) : (
        <div className="flex flex-col gap-stack-lg">
          <HealthGroup
            heading="Probed just now"
            blurb="Contacted on this request. Green here is evidence."
            checks={probed}
          />
          <HealthGroup
            heading="Configured only"
            blurb="Which adapter is wired up. NOT contacted from this page."
            checks={configured}
          />
        </div>
      )}
    </Panel>
  );
}

function HealthGroup({
  heading,
  blurb,
  checks,
}: {
  heading: string;
  blurb: string;
  checks: HealthCheck[];
}) {
  if (checks.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <header>
        <h3 className="text-caption uppercase tracking-wide text-foreground-subtle">{heading}</h3>
        <p className="text-caption text-muted-foreground">{blurb}</p>
      </header>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-1">
        {checks.map((check) => {
          const tone = HEALTH_TONE[check.status];
          const StatusIcon = tone.icon;
          // The single most important thing this panel can say in production:
          // a fake adapter means nothing is actually being sent or charged.
          const fake = check.detail.includes('local/fake');
          return (
            <li
              key={check.name}
              title={check.detail}
              className={cn(
                'flex items-center gap-2 rounded-lg border bg-surface px-2.5 py-2',
                tone.wrap,
              )}
            >
              <StatusIcon className={cn('size-3.5 shrink-0', tone.chip)} aria-hidden />
              <span className="min-w-0 truncate text-caption text-foreground">
                {HEALTH_LABELS[check.name] ?? check.name}
              </span>
              <span
                className={cn(
                  'ml-auto min-w-0 shrink truncate text-caption',
                  fake ? 'text-warning-subtle-foreground' : tone.chip,
                )}
              >
                {check.status === 'unknown' ? check.detail : tone.word}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------- activity */

/** Domain event type → how an operator would say it. */
const ACTIVITY_LABELS: Record<string, string> = {
  'organizations.organization_created': 'Organization created',
  'organizations.organization_verified': 'Organizer verified',
  'organizations.organization_verification_rejected': 'Verification rejected',
  'organizations.payout_account_linked': 'Payout account linked',
  'events.event_published': 'Event published',
  'booking.booking_created': 'Booking created',
  'booking.booking_confirmed': 'Booking confirmed',
  'booking.ticket_issued': 'Ticket issued',
  'payments.payment_confirmed': 'Payment confirmed',
  'payments.payment_refunded': 'Refund processed',
  'checkin.ticket_checked_in': 'Ticket checked in',
  'settlements.payout_released': 'Payout released',
  'settlements.payout_failed': 'Payout failed',
  'accounts.user_registered': 'User registered',
  'ticketing.ticket_type_sold_out': 'Tier sold out',
};

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

function ActivityPanel() {
  const { data, isPending } = useQuery({
    queryKey: ['admin-activity'],
    queryFn: () => fetchActivity(12),
    refetchInterval: REFRESH_MS,
  });

  const entries: ActivityEntry[] = data?.data ?? [];

  return (
    <Panel title="Recent activity">
      {isPending ? (
        <div className="flex flex-col gap-3" aria-hidden>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-10 w-full rounded" />
          ))}
        </div>
      ) : entries.length ? (
        // A timeline, not a table: the rail and the dots are what make the
        // ordering readable at a glance, which is the whole point of a feed.
        //
        // TWO CHANGES FOR DENSITY. The label and its time share one row —
        // twelve entries fit where six did, and the times form a right-aligned
        // `tabular-nums` column you can read straight down instead of a value
        // hidden on a second line. And the dots are NEUTRAL: twelve violet dots
        // spend the wayfinding accent on decoration, and none of these entries
        // is more important than the others.
        <ol className="relative flex flex-col gap-stack border-l border-border pl-4">
          {entries.map((entry) => (
            <li key={entry.id} className="relative flex items-baseline gap-3">
              <span
                className="absolute -left-[1.25rem] top-1.5 size-2 rounded-full bg-border-strong ring-4 ring-surface"
                aria-hidden
              />
              <p className="min-w-0 flex-1 truncate text-body-sm text-foreground">
                {ACTIVITY_LABELS[entry.type] ?? entry.type.split('.').pop()?.replace(/_/g, ' ')}
              </p>
              <time
                dateTime={entry.created_at}
                className="shrink-0 text-caption tabular-nums text-muted-foreground"
              >
                {relativeTime(entry.created_at)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-body-sm text-muted-foreground">
          Nothing has happened yet. Every domain event the platform emits appears here.
        </p>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------- quick actions */

function QuickActions() {
  const { data } = useQuery({ queryKey: ['admin-overview'], queryFn: fetchOverview });

  // Only actions that lead somewhere real. "Create admin" and "Create
  // announcement" have no endpoint, so they are not offered — a quick action
  // that opens nothing is worse than one fewer button.
  const actions = [
    {
      href: '/admin/verifications',
      label: 'Review verifications',
      icon: ShieldCheck,
      badge: data?.pending_verifications,
    },
    {
      href: '/admin/settlements?status=failed',
      label: 'Re-drive failed payouts',
      icon: AlertTriangle,
      badge: data?.failed_payouts,
    },
    { href: '/admin/organizations', label: 'Browse organizations', icon: Building2 },
  ];

  return (
    <Panel title="Quick actions">
      <ul className="flex flex-col gap-1.5">
        {actions.map((action) => (
          <li key={action.href}>
            <Link
              href={action.href}
              className="flex min-h-control items-center gap-3 rounded-full border border-border px-3 py-2 text-body-sm text-foreground transition-colors duration-fast hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <action.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">{action.label}</span>
              {action.badge ? (
                <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 text-caption tabular-nums text-secondary-foreground">
                  {action.badge}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------- shared */

function Panel({
  title,
  action,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // In light theme a card cannot separate by value (surface === background),
    // so the recipe is always hairline + soft shadow; in dark the surface rung
    // does it. `p-card` everywhere, so no panel picks its own number.
    <section className="flex flex-col gap-stack-lg rounded-xl border border-border bg-surface p-card shadow-sm">
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-body font-semibold text-foreground">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="inline-flex items-center gap-2 text-body-sm text-destructive-subtle-foreground">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        {message}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
