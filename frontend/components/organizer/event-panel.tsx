'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, BarChart3, Clock, ExternalLink, Receipt, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { formatMoney } from '@/lib/discovery/format';
import type { EventRow } from '@/lib/api/organizer';
import { eventBadge } from '@/lib/organizer/event-status';
import { useEventAnalytics, useInvalidateOrganizer } from '@/lib/organizer/queries';
import { publishEvent } from '@/lib/api/organizer-writes';
import { CancelEventButton } from './cancel-event';
import { describePublishFailure } from '@/lib/organizer/publish-error';
import { submitBlockers } from '@/lib/organizer/submit-gate';
import { TOOLBAR_CONTROL, TOOLBAR_ICON } from './data-table';
import { ErrorState, Percent, Skeleton, StatusPill } from './primitives';
import { cn } from '@/lib/utils/cn';

/**
 * The row side panel — an event's numbers without leaving the table.
 *
 * "Click row -> side panel, not a page" was the brief's whole point here, and
 * the reason it matters is that comparing two events means opening one,
 * reading it, closing it and opening the next. A route change would lose the
 * table's scroll position, its filters and its loaded pages each time.
 *
 * The panel is a Drawer (right on desktop, bottom sheet on mobile) so it
 * inherits the design system's focus trap, scrim and Escape handling rather
 * than growing its own.
 *
 * The brief listed nine tabs. Six of them — Coupons, Reports, Settings,
 * plus Messages/Reviews/Team elsewhere — have no backend, so this shows the
 * three that do: Overview (real aggregates), Tiers (the authoritative tier
 * counters) and Timeline (real captured payments per day). Empty tabs would
 * make the panel look complete while teaching an organizer to stop opening it.
 *
 * The panel's own actions are outlined doors out of it. The ONE filled pill
 * that can appear here is "Resubmit for approval", and only on a rejected
 * event — which is the one moment this panel has something to DO rather than
 * something to show.
 */
export function EventPanel({ row, onClose }: { row: EventRow | null; onClose: () => void }) {
  // Keep the last row while the drawer animates out, so the content does not
  // vanish mid-transition and collapse the panel to zero height.
  const [sticky, setSticky] = React.useState<EventRow | null>(row);
  React.useEffect(() => {
    if (row) setSticky(row);
  }, [row]);

  const analytics = useEventAnalytics(row?.id ?? null, 30);
  const shown = row ?? sticky;

  return (
    <Drawer open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side="responsive" hideClose className="flex flex-col gap-0 p-0 sm:max-w-lg">
        {shown ? (
          <>
            <header className="flex items-start gap-3 border-b border-border p-card">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusPill tone={eventBadge(shown).tone}>{eventBadge(shown).label}</StatusPill>
                  <span className="truncate text-caption text-muted-foreground">
                    {shown.organization_name}
                  </span>
                </div>
                <h2 className="mt-1 truncate text-h4">{shown.title}</h2>
                <p className="truncate text-body-sm text-muted-foreground">
                  {shown.venue}, {shown.city} ·{' '}
                  {new Date(shown.starts_at).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close"
                className={cn(TOOLBAR_ICON, 'shrink-0')}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </header>

            <ModerationBanner row={shown} />

            <div className="flex flex-wrap gap-2 border-b border-border px-card py-stack">
              {/* The panel is a glance; the page is a session. This is the
                  way out of one and into the other, so an organizer who
                  opened a row to check a number and then had a real question
                  is not sent back to the table to find another door. */}
              <PanelAction href={`/dashboard/events/${shown.id}/analytics`} icon={BarChart3}>
                Full analytics
              </PanelAction>
              <PanelAction href={`/dashboard/bookings?event_id=${shown.id}`} icon={Receipt}>
                Bookings
              </PanelAction>
              {shown.status === 'live' ? (
                <PanelAction href={`/events/${shown.id}`} icon={ExternalLink} external>
                  Public page
                </PanelAction>
              ) : null}
              {/* Last, and quiet. It renders only for `live`/`paused` — the
                  states with somebody to tell — and it is the one control here
                  that spends money, so it is a ghost button behind a typed
                  confirmation rather than sitting flush with the navigation
                  links beside it. */}
              <span className="ml-auto">
                <CancelEventButton row={shown} />
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-card">
              {analytics.isError ? (
                <ErrorState
                  message="Could not load this event's analytics."
                  onRetry={() => void analytics.refetch()}
                />
              ) : analytics.isPending ? (
                <div className="flex flex-col gap-stack">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : (
                <div className="flex flex-col gap-block">
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Metric label="Revenue" value={formatMoney(analytics.data.revenue_minor)} />
                    <Metric
                      label="Sold"
                      value={`${analytics.data.sold}${
                        analytics.data.capacity ? ` / ${analytics.data.capacity}` : ''
                      }`}
                    />
                    <Metric
                      label="Conversion"
                      value={<Percent value={analytics.data.conversion_pct} />}
                    />
                    <Metric
                      label="Attendance"
                      value={<Percent value={analytics.data.attendance_pct} />}
                    />
                  </dl>

                  <section className="flex flex-col gap-stack">
                    <h3 className="text-body-sm font-semibold">Ticket tiers</h3>
                    {analytics.data.tiers.length === 0 ? (
                      <p className="text-body-sm text-muted-foreground">
                        No ticket types yet — an event cannot be published without at least one.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {analytics.data.tiers.map((tier) => {
                          const ratio = tier.quantity ? tier.sold / tier.quantity : 0;
                          return (
                            <li key={tier.id} className="rounded-lg border border-border p-stack">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-body-sm font-medium">
                                  {tier.name}
                                </span>
                                <span className="shrink-0 text-body-sm tabular-nums text-muted-foreground">
                                  {formatMoney(tier.price_minor)}
                                </span>
                              </div>
                              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${Math.round(ratio * 100)}%` }}
                                />
                              </div>
                              <p className="mt-1 text-caption tabular-nums text-muted-foreground">
                                {tier.sold} sold · {tier.reserved} on hold · {tier.quantity} total ·{' '}
                                {formatMoney(tier.revenue_minor)}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section className="flex flex-col gap-stack">
                    <h3 className="text-body-sm font-semibold">Sales, last 30 days</h3>
                    <SalesBars points={analytics.data.sales_timeline} />
                  </section>

                  {analytics.data.bookings_by_status.length > 0 ? (
                    <section className="flex flex-col gap-stack">
                      <h3 className="text-body-sm font-semibold">Bookings by status</h3>
                      <ul className="flex flex-wrap gap-2">
                        {analytics.data.bookings_by_status.map((item) => (
                          <li
                            key={item.label}
                            className="rounded-full bg-muted px-3 py-1 text-caption capitalize text-muted-foreground"
                          >
                            {item.label}: <span className="tabular-nums">{item.value}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              )}
            </div>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}

/**
 * A metric tile.
 *
 * `p-stack`, not `p-card`: four of these share the width of a drawer, and card
 * padding would leave a rupee figure too little room and truncate it. Still a
 * token — the point of the rule is that nobody picks a number, not that every
 * box gets 20px.
 */
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-stack">
      <dt className="truncate text-caption text-muted-foreground">{label}</dt>
      <dd className="truncate text-body-lg tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * A 30-bar column chart, drawn as divs.
 *
 * Bars rather than a line, because daily sales are discrete counts and a line
 * implies values between the days. An all-zero window renders flat baselines
 * rather than dividing by a zero range.
 */
function SalesBars({ points }: { points: { date: string; value: number }[] }) {
  const max = Math.max(...points.map((point) => point.value), 1);
  const total = points.reduce((sum, point) => sum + point.value, 0);

  if (total === 0) {
    return <p className="text-body-sm text-muted-foreground">No sales in the last 30 days.</p>;
  }

  return (
    <div>
      <div className="flex h-20 items-end gap-0.5" role="img" aria-label="Daily sales">
        {points.map((point) => (
          <div
            key={point.date}
            title={`${point.date}: ${formatMoney(point.value)}`}
            className={cn(
              'min-h-px flex-1 rounded-sm',
              point.value > 0 ? 'bg-primary' : 'bg-muted',
            )}
            style={{ height: `${Math.max((point.value / max) * 100, 2)}%` }}
          />
        ))}
      </div>
      <p className="mt-1.5 text-caption text-muted-foreground">{formatMoney(total)} over 30 days</p>
      {/* The same numbers as text, for anyone who cannot read the bars. */}
      <table className="sr-only">
        <caption>Daily sales for the last 30 days</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.date}</th>
              <td>{formatMoney(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelAction({
  href,
  icon: Icon,
  external,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button variant="outline" asChild className={TOOLBAR_CONTROL}>
      <Link href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        <Icon className="size-3.5" aria-hidden />
        {children}
      </Link>
    </Button>
  );
}

/**
 * Where an organizer finds out what happened to their submission.
 *
 * Three states, and the difference between them is the whole point of the
 * moderation gate being visible rather than silent:
 *
 * - `pending_review` — submitted, waiting. Says so, and says it is not yet
 *   visible to attendees, because "Published" on the button and nothing on
 *   the screen is how an organizer tells their audience to go and buy.
 * - `rejected` — sent back, with the operator's exact words and a resubmit
 *   button. A rejection is a state to recover from.
 * - anything else — nothing rendered.
 */
function ModerationBanner({ row }: { row: EventRow }) {
  const invalidate = useInvalidateOrganizer();
  const [busy, setBusy] = React.useState(false);
  // The THROWN value, not a message. `describePublishFailure` reads the machine
  // `code` and `details` the backend has always sent, and turns a refusal into
  // somewhere to go — "get verified" rather than a red sentence with no exit.
  const [error, setError] = React.useState<unknown>(null);

  if (row.status !== 'pending_review' && row.status !== 'rejected') return null;

  const blockers = submitBlockers(row);
  const failure = error ? describePublishFailure(error) : null;

  const resubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await publishEvent(row.id);
      void invalidate();
    } catch (thrown) {
      // If the refusal only means it is already submitted, the row we are
      // looking at is stale — refresh rather than argue with the server. The
      // banner then re-renders as the "waiting for approval" state, which is
      // the truth.
      if (describePublishFailure(thrown).alreadyDone) {
        void invalidate();
        return;
      }
      setError(thrown);
      setBusy(false);
    }
  };

  if (row.status === 'pending_review') {
    return (
      <div className="flex items-start gap-2.5 border-b border-border bg-secondary px-card py-stack">
        <Clock className="mt-0.5 size-4 shrink-0 text-secondary-foreground" aria-hidden />
        <p className="text-body-sm text-secondary-foreground">
          <span className="font-medium">Waiting for approval.</span> Not visible to attendees yet.
          {row.submitted_at
            ? ` Submitted ${new Date(row.submitted_at).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              })}.`
            : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-stack border-b border-border bg-destructive-subtle px-card py-stack">
      <p className="flex items-start gap-2.5 text-body-sm text-destructive-subtle-foreground">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-medium">Changes requested.</span>{' '}
          {row.moderation_note || 'No reason was recorded.'}
        </span>
      </p>
      {/* What is still missing, BEFORE the button rather than after it fails.
          This panel is one of the three places that submits an event, and it
          used to offer Resubmit unconditionally — on an event that had, say, no
          ticket type, that button could only ever produce an error. */}
      {blockers.length ? (
        <ul className="flex flex-col gap-1 text-caption text-destructive-subtle-foreground">
          {blockers.map((blocker) => (
            <li key={blocker}>• {blocker}</li>
          ))}
        </ul>
      ) : null}
      {failure ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-caption text-destructive">
          <span>{failure.message}</span>
          {failure.action?.href ? (
            <Link href={failure.action.href} className="underline underline-offset-2">
              {failure.action.label}
            </Link>
          ) : null}
        </p>
      ) : null}
      {/* The near-black pill, and the only one in this panel: a rejection is a
          state to recover from, and recovering is a real action. `loading`
          gives it the spinner and `aria-busy` the primitive already owns. */}
      <Button
        onClick={() => void resubmit()}
        loading={busy}
        disabled={busy || blockers.length > 0}
        className={cn(TOOLBAR_CONTROL, 'w-fit')}
      >
        Resubmit for approval
      </Button>
    </div>
  );
}
