'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/discovery/format';
import type { OrganizerSettlement, SettlementStatus } from '@/lib/api/organizer';
import { useSettlements } from '@/lib/organizer/queries';
import { cn } from '@/lib/utils/cn';
import { TOOLBAR_CONTROL } from './data-table';
import { EmptyState, ErrorState, Panel, Skeleton, StatusPill, type Tone } from './primitives';

/**
 * Payouts.
 *
 * ── THE ONE THING THIS SCREEN MUST GET RIGHT ──────────────────────────────
 *
 * `net` on a settlement row is a DISPLAY total, maintained by handlers as
 * payments and refunds land. At release time the backend RECOMPUTES it
 * authoritatively from the payment records, under the settlement row's lock —
 * so the number shown for a `pending` settlement is an estimate, and the
 * number shown for a `paid` one is what was actually sent. The cards below
 * separate those two on exactly that line, and the copy says which is which.
 * Presenting an estimate as a balance is how a dashboard causes an overdraft.
 *
 * ── EVERY FIGURE IS TABULAR AND RIGHT-ALIGNED ─────────────────────────────
 *
 * Gross, fee, refunds and net are read down the column, not across the row —
 * an organizer checking a settlement is comparing this event's net to the last
 * one's. Proportional digits make that comparison a reading exercise.
 *
 * ── WHAT IS ABSENT ────────────────────────────────────────────────────────
 *
 * "Next payout" as a date: `releasable_at` exists on the model but is NOT on
 * the organizer serializer (only the admin one), so the exact release moment
 * cannot be shown. The rule is stated instead, which is true and checkable.
 * Statement downloads have no endpoint. BACKLOG item 31.
 *
 * There is no filled button anywhere on this screen, and that is right: an
 * organizer cannot release their own payout — a scheduled job does, after the
 * event and its refund window — so nominating a primary action here would be
 * nominating one that does not exist.
 */

const TONES: Record<SettlementStatus, Tone> = {
  paid: 'success',
  pending: 'warning',
  failed: 'danger',
  zero: 'neutral',
};

const LABELS: Record<SettlementStatus, string> = {
  paid: 'Paid out',
  pending: 'Awaiting release',
  failed: 'Needs attention',
  zero: 'Nothing owed',
};

export function Payouts() {
  const query = useSettlements();
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  const paid = rows.filter((row) => row.status === 'paid');
  const pending = rows.filter((row) => row.status === 'pending');
  const failed = rows.filter((row) => row.status === 'failed');

  const sum = (list: OrganizerSettlement[]) => list.reduce((total, row) => total + row.net, 0);
  const lastPaid = paid
    .filter((row) => row.payout_at)
    .sort((a, b) => (a.payout_at! < b.payout_at! ? 1 : -1))[0];

  return (
    <div className="flex flex-col gap-block">
      <div className="grid grid-cols-2 gap-stack xl:grid-cols-4">
        <Card
          label="Paid out"
          value={formatMoney(sum(paid))}
          note={
            lastPaid
              ? `Last on ${new Date(lastPaid.payout_at as string).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}`
              : 'Nothing released yet'
          }
          loading={query.isPending}
        />
        <Card
          label="Awaiting release"
          value={formatMoney(sum(pending))}
          // Deliberately not called "available": it is not available, and it
          // is recomputed from the payment records before it is sent.
          note="Estimated — recomputed at release"
          loading={query.isPending}
        />
        <Card
          label="Events settled"
          value={String(paid.length)}
          note={`of ${rows.length} with a settlement`}
          loading={query.isPending}
        />
        <Card
          label="Needs attention"
          value={String(failed.length)}
          note={failed.length ? 'A payout failed and is still owed' : 'Nothing failed'}
          loading={query.isPending}
          tone={failed.length ? 'danger' : undefined}
        />
      </div>

      <Panel title="How and when you get paid">
        <ol className="flex flex-col gap-stack p-card">
          <Step
            n={1}
            title="A ticket is paid for"
            body="Your share is transferred to your linked account immediately, but held there by the payment provider. The platform never holds your money."
          />
          <Step
            n={2}
            title="The event happens"
            body="Nothing releases while an event could still be refunded."
          />
          <Step
            n={3}
            title="The refund window closes"
            body="Once the event has ended and the refund window has passed, the payout becomes releasable."
          />
          <Step
            n={4}
            title="The transfer is released"
            body="A scheduled job recomputes your net from the actual paid and refunded payments, then releases it — exactly once. A failure retries with backoff and stays owed; it is never lost."
          />
        </ol>
      </Panel>

      <Panel title="Settlements" subtitle="One per event" className="overflow-hidden">
        {query.isError ? (
          <ErrorState message="Could not load your payouts." onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <div className="flex flex-col gap-2 p-card">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No payouts yet"
            body="A settlement is created for an event once it starts selling. It releases after the event ends and its refund window closes."
            action={
              <Button variant="outline" asChild>
                <Link href="/dashboard/events">See your events</Link>
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr>
                  {['Event', 'Gross', 'Platform fee', 'Refunds', 'Net', 'Status', 'Reference'].map(
                    (label, index) => (
                      <th
                        key={label}
                        scope="col"
                        className={cn(
                          // `bg-sunken`, matching every other header on the
                          // dashboard: in light it is the one value step there
                          // is (downward), and in dark it is a real rung below
                          // the card — so one class reads as one idea in both.
                          'border-b border-border bg-sunken px-3 py-2 text-caption font-medium uppercase tracking-wide text-muted-foreground',
                          index >= 1 && index <= 4 ? 'text-right' : 'text-left',
                          index === 2 && 'hidden lg:table-cell',
                          index === 3 && 'hidden md:table-cell',
                          index === 6 && 'hidden xl:table-cell',
                        )}
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border transition-colors last:border-0 hover:bg-muted"
                  >
                    <td className="max-w-0 px-3 py-2">
                      <Link
                        href={`/dashboard/events?event=${row.event_id}`}
                        className="block truncate font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.event_title}
                      </Link>
                      <span className="block text-caption tabular-nums text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.gross)}</td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground lg:table-cell">
                      −{formatMoney(row.platform_fee)}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums text-muted-foreground md:table-cell">
                      {row.refunds ? `−${formatMoney(row.refunds)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatMoney(row.net)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill tone={TONES[row.status] ?? 'neutral'}>
                        {LABELS[row.status] ?? row.status}
                      </StatusPill>
                      {/* The DATE, not the rule. A pending row used to say only
                          "pending", and the rule was restated in a footnote —
                          so the one question this screen exists to answer
                          ("when am I paid") had no answer on the row. This is
                          the same instant the release job acts on. Absent only
                          while the event has no end date, and then nothing is
                          claimed. */}
                      {row.status === 'pending' && row.releasable_at ? (
                        <span className="mt-1 block whitespace-nowrap text-caption text-muted-foreground">
                          Releases{' '}
                          {new Date(row.releasable_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden max-w-0 px-3 py-2 xl:table-cell">
                      <span className="block truncate font-mono text-caption text-muted-foreground">
                        {row.provider_ref || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {query.hasNextPage ? (
          <div className="border-t border-border p-stack text-center">
            <Button
              variant="outline"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className={TOOLBAR_CONTROL}
            >
              {query.isFetchingNextPage ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              Load more
            </Button>
          </div>
        ) : null}
      </Panel>

      <p className="rounded-xl border border-dashed border-border p-card text-caption text-muted-foreground">
        A downloadable statement and an exact next-payout date are not available: there is no
        statement endpoint, and <code>releasable_at</code> is on the admin settlement payload only,
        not the organizer one. BACKLOG item 31.
      </p>
    </div>
  );
}

function Card({
  label,
  value,
  note,
  loading,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  loading: boolean;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-card shadow-sm">
      <p className="truncate text-caption text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-24" />
      ) : (
        <p
          className={cn(
            'truncate text-h4 tabular-nums',
            tone === 'danger' && value !== '0' && 'text-destructive',
          )}
        >
          {value}
        </p>
      )}
      <p className="truncate text-caption text-muted-foreground">{note}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-caption font-semibold tabular-nums text-secondary-foreground"
        aria-hidden
      >
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-body-sm font-medium">{title}</span>
        <span className="block text-caption text-muted-foreground">{body}</span>
      </span>
    </li>
  );
}
