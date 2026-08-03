'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Inbox,
  Send,
  Sparkles,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { OCCASION_LABELS } from '@/lib/api/performers';
import { formatMoney } from '@/lib/discovery/format';
import {
  parseDayLocal,
  profileState,
  useAct,
  usePipeline,
  useReadiness,
  useStudioStats,
} from '@/lib/performer/studio';
import { ErrorState, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * The studio's front page.
 *
 * ── THE ORDER IS THE ARGUMENT ─────────────────────────────────────────────
 *
 * A performer opening this needs four answers, laid out by how expensive each
 * is to miss:
 *
 *   1. **What needs me** — an unanswered lead expires when the customer books
 *      somebody else, and a profile stuck in draft earns nothing at all.
 *   2. **What is confirmed** — the dates already sold.
 *   3. **How the business is doing** — quotes, wins, booked value.
 *   4. **What is coming up** — the next performances, in order.
 *
 * ── "BOOKED VALUE", NEVER "REVENUE" ───────────────────────────────────────
 *
 * The platform does not process this money — a quote is an agreement between
 * two people, and Curatix introduces them. So the total of accepted quotes is
 * labelled as what was AGREED, with the distinction stated on the tile rather
 * than buried. Calling it revenue would put a number in somebody's tax return
 * that this platform never saw.
 *
 * ── NOTHING HERE IS A PROXY ───────────────────────────────────────────────
 *
 * Profile views, conversion and impressions are absent rather than
 * approximated from lead counts. Nothing records a visit, so any number would
 * be a different measurement wearing the right label.
 *
 * ── NO FILLED BUTTON, ON PURPOSE ──────────────────────────────────────────
 *
 * "Needs you" is a stack of full-width rows and each one IS its action — a
 * near-black pill in the header competing with them would pull the eye to
 * "see your public profile", the least urgent thing on the screen. The header
 * link is an outline, and the attention rows carry the weight.
 */
export function StudioHome({ performerId }: { performerId: string }) {
  const act = useAct(performerId);
  const readiness = useReadiness(performerId);
  const stats = useStudioStats(performerId);
  const { pipeline, isError } = usePipeline(performerId);

  if (act.isError) {
    return (
      <ErrorState
        message="Could not load this act."
        onRetry={() => void act.refetch()}
        className="rounded-xl border border-border bg-surface"
      />
    );
  }

  if (act.isPending) {
    return (
      <div className="flex flex-col gap-block">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  const state = profileState(act.data);
  const problems = readiness.data?.problems ?? [];
  const upcoming = pipeline.accepted.slice(0, 4);

  return (
    <div className="flex flex-col gap-section">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-h2">{act.data.stage_name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
            <StatusPill tone={state.tone}>{state.label}</StatusPill>
            {act.data.verified_level === 'verified' ? (
              <span className="inline-flex items-center gap-1 text-caption text-primary">
                <BadgeCheck className="size-3.5" aria-hidden />
                Verified organiser
              </span>
            ) : null}
            {act.data.is_featured ? (
              <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden />
                Featured on the landing page
              </span>
            ) : null}
          </p>
        </div>

        <Button asChild variant="outline">
          <Link href={`/studio/${performerId}/preview`}>
            See your public profile
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </header>

      <NeedsYou
        performerId={performerId}
        state={state}
        problems={problems}
        leads={pipeline.leads.length}
        isError={isError}
      />

      <section className="flex flex-col gap-stack">
        <SectionHead
          title="Your business"
          hint="Counted from your own quotes and bookings. Nothing here is estimated."
        />
        <dl className="grid gap-stack sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            icon={Inbox}
            label="Open leads"
            value={stats.isPending ? null : String(stats.openLeads)}
            hint="Briefs you have not answered"
            href={`/studio/${performerId}/leads`}
          />
          <Stat
            icon={Send}
            label="Awaiting a decision"
            value={stats.isPending ? null : String(stats.pendingQuotes)}
            hint="Quotes you have sent"
            href={`/studio/${performerId}/pipeline`}
          />
          <Stat
            icon={CalendarDays}
            label="Confirmed dates"
            value={stats.isPending ? null : String(stats.upcomingBookings)}
            hint="Booked and still to play"
            href={`/studio/${performerId}/calendar`}
          />
          <Stat
            icon={Wallet}
            label="Booked value"
            value={stats.isPending ? null : formatMoney(stats.bookedValueMinor)}
            // The distinction, on the tile rather than buried in a footnote.
            hint="Agreed with customers — Curatix does not handle this money"
            href={`/studio/${performerId}/analytics`}
          />
        </dl>
      </section>

      <section className="flex flex-col gap-stack">
        <SectionHead
          title="Coming up"
          hint="Confirmed bookings, soonest first."
          href={`/studio/${performerId}/calendar`}
          linkLabel="Full calendar"
        />

        {stats.isPending ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : upcoming.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-card py-section text-center">
            <span
              className="inline-flex size-11 items-center justify-center rounded-full bg-muted"
              aria-hidden
            >
              <CalendarDays className="size-5 text-muted-foreground" />
            </span>
            <p className="text-body font-medium">No confirmed dates yet</p>
            <p className="max-w-sm text-body-sm text-muted-foreground">
              A date appears here the moment a customer accepts one of your quotes.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((booking) => {
              const date = parseDayLocal(booking.request_event_date);
              const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
              return (
                <li key={booking.id}>
                  <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-card shadow-sm">
                    <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-sunken">
                      <span className="text-caption uppercase text-muted-foreground">
                        {date.toLocaleDateString('en-IN', { month: 'short' })}
                      </span>
                      <span className="text-body font-semibold tabular-nums">
                        {date.getDate()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-medium capitalize">
                        {OCCASION_LABELS[booking.request_occasion] ?? booking.request_occasion} in{' '}
                        {booking.request_city}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}
                      </p>
                    </div>
                    <p className="shrink-0 text-right text-body tabular-nums">
                      {formatMoney(booking.amount_minor)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * "What needs you", and an empty one is the good outcome.
 *
 * It gets a calm all-clear that NAMES what was checked, rather than an apology
 * or a manufactured task. A panel that always has something in it is a panel
 * people stop reading within a week.
 */
function NeedsYou({
  performerId,
  state,
  problems,
  leads,
  isError,
}: {
  performerId: string;
  state: ReturnType<typeof profileState>;
  problems: string[];
  leads: number;
  isError: boolean;
}) {
  const items: { key: string; tone: 'critical' | 'warning' | 'info'; title: string; detail: string; href: string; action: string }[] =
    [];

  if (state.label === 'Changes needed') {
    items.push({
      key: 'rejected',
      tone: 'critical',
      title: 'Your profile was sent back',
      detail: state.detail,
      href: `/studio/${performerId}/profile`,
      action: 'Fix and resubmit',
    });
  }

  if (problems.length) {
    items.push({
      key: 'incomplete',
      tone: state.label === 'Live' ? 'info' : 'warning',
      title:
        state.label === 'Live'
          ? `${problems.length} thing${problems.length === 1 ? '' : 's'} would strengthen your profile`
          : `${problems.length} thing${problems.length === 1 ? '' : 's'} left before you can submit`,
      detail: problems[0],
      href: `/studio/${performerId}/profile`,
      action: 'Open the profile',
    });
  }

  if (state.label === 'Draft' && problems.length === 0) {
    items.push({
      key: 'submit',
      tone: 'warning',
      title: 'Your profile is ready to submit',
      detail: 'It is complete but still a draft, so nobody can find or book you yet.',
      href: `/studio/${performerId}/profile`,
      action: 'Submit for review',
    });
  }

  if (leads > 0) {
    items.push({
      key: 'leads',
      tone: 'warning',
      title: `${leads} brief${leads === 1 ? '' : 's'} waiting on you`,
      // Why it is urgent, in the terms that actually apply.
      detail:
        'Every one is a customer comparing quotes right now. They book whoever answers, and a brief closes the moment they do.',
      href: `/studio/${performerId}/leads`,
      action: 'Answer them',
    });
  }

  if (state.label === 'Paused') {
    items.push({
      key: 'paused',
      tone: 'info',
      title: 'You are paused',
      detail: state.detail,
      href: `/studio/${performerId}/profile`,
      action: 'Resume',
    });
  }

  // A failed READ is not an all-clear. Saying "nothing needs you" because the
  // network broke is the most damaging thing this panel could do.
  if (isError) {
    return (
      <section
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-destructive-subtle bg-destructive-subtle p-card"
      >
        <TriangleAlert
          className="mt-0.5 size-4 shrink-0 text-destructive-subtle-foreground"
          aria-hidden
        />
        <p className="text-body-sm text-destructive-subtle-foreground">
          Could not check your leads and quotes. This is a failed request, not an all-clear —
          reload to try again.
        </p>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-xl border border-border bg-surface p-card shadow-sm">
        <span
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-success-subtle"
          aria-hidden
        >
          <CheckCircle2 className="size-4 text-success-subtle-foreground" />
        </span>
        <div className="min-w-0">
          <p className="text-body-sm font-medium">Nothing needs you right now</p>
          <p className="text-caption text-muted-foreground">
            Your profile is live and complete, and every brief has been answered.
          </p>
        </div>
      </section>
    );
  }

  const TONES = {
    critical: 'border-destructive-subtle bg-destructive-subtle text-destructive-subtle-foreground',
    warning: 'border-warning-subtle bg-warning-subtle text-warning-subtle-foreground',
    info: 'border-border bg-surface text-muted-foreground shadow-sm',
  } as const;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-body-sm font-semibold">Needs you</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className={cn(
                'group flex items-start gap-3 rounded-xl border p-card transition-colors duration-fast',
                'motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                TONES[item.tone],
                item.tone === 'info' && 'hover:bg-muted',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-foreground">{item.title}</p>
                <p className="text-caption">{item.detail}</p>
              </div>
              <span
                className={cn(
                  'mt-0.5 inline-flex shrink-0 items-center gap-1 text-label',
                  'transition-transform duration-fast group-hover:translate-x-0.5',
                  'motion-reduce:transition-none motion-reduce:group-hover:translate-x-0',
                )}
              >
                <span className="hidden sm:inline">{item.action}</span>
                <ArrowRight className="size-3.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionHead({
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
        <h2 className="text-body font-semibold">{title}</h2>
        {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1 text-label text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  href,
}: {
  icon: typeof Inbox;
  label: string;
  value: string | null;
  hint: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-1 rounded-xl border border-border bg-surface p-card shadow-sm transition-colors duration-fast hover:bg-muted motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <dt className="flex items-center gap-2 text-caption uppercase tracking-wide text-muted-foreground">
        {/* The leading icon is where the violet accent earns its keep now. */}
        <Icon className="size-3.5 shrink-0 text-primary" aria-hidden />
        {label}
      </dt>
      <dd className="text-h3 tabular-nums text-foreground">
        {value ?? <Skeleton className="h-7 w-16" />}
      </dd>
      <p className="text-caption text-muted-foreground">{hint}</p>
    </Link>
  );
}
