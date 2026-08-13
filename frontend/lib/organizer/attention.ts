'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  fetchEventRows,
  fetchOrganizerRefunds,
  fetchSettlements,
  type EventRow,
  type OrganizerRefund,
  type OrganizerSettlement,
} from '@/lib/api/organizer';

/**
 * "What requires attention?" — the question the dashboard exists to answer.
 *
 * ── IT IS DERIVED, NOT INVENTED ───────────────────────────────────────────
 *
 * Every item below is a row in a database with a state that genuinely needs a
 * person: an event an operator sent back, a payout the vendor refused, a draft
 * with no ticket types. Nothing here is a heuristic, a score, or a "you might
 * want to…" nudge. If an organizer has nothing outstanding, this list is
 * EMPTY, and the dashboard says so rather than manufacturing a task.
 *
 * ── WHY IT IS FOUR PARALLEL QUERIES AND NOT ONE ENDPOINT ──────────────────
 *
 * Each source is a filtered first page of a list the dashboard already
 * consumes, so they share TanStack's cache with the surfaces they link to —
 * clicking through to Events shows the same rows, already warm, with no second
 * fetch. A bespoke `/organizer/attention` endpoint would be one round trip
 * instead of four parallel ones, but it would also be a fifth place that has
 * to agree about what "needs attention" means. If the count of sources grows
 * past this, the endpoint becomes worth it — BACKLOG covers it.
 *
 * ── SEVERITY DECIDES ORDER, AND ONLY THREE LEVELS EXIST ───────────────────
 *
 * `critical` costs money or blocks a sale right now. `warning` will do one of
 * those soon. `info` is worth knowing. More levels than that and nobody can
 * tell two adjacent ones apart, which is how a priority system stops working.
 */

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export type AttentionItem = {
  id: string;
  severity: AttentionSeverity;
  title: string;
  /** Says what is true and what to do. Never "something went wrong". */
  detail: string;
  href: string;
  action: string;
  /** Sorts within a severity. Higher is more urgent. */
  weight: number;
};

const SEVERITY_ORDER: Record<AttentionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** A small first page is enough — this is a triage list, not a report. */
const PAGE = 20;

/**
 * ── WHY THESE KEYS CARRY AN `attention` SEGMENT ──────────────────────────
 *
 * They used to be `['organizer','settlements']`, `['organizer','refunds','']`
 * and `['organizer','event-rows',{status}]` — byte-identical to the keys the
 * TABLE hooks in `queries.ts` use. That was the cause of the intermittent
 * "This screen didn't load" on /dashboard, and it is worth stating exactly,
 * because the collision looks harmless.
 *
 * The panel reads these with a PLAIN `useQuery`, which caches `{data, meta}`.
 * The tables read the same keys with `useInfiniteQuery`, which caches
 * `{pages, pageParams}`. One cache entry, two incompatible shapes — and the
 * winner is decided by whichever observer's fetch lands first, because
 * TanStack de-dupes the second onto the in-flight promise and keeps the
 * INITIATOR's behavior.
 *
 * The failure is asymmetric, which is what made it intermittent rather than
 * constant:
 *
 *   plain first  -> InfiniteQueryObserver reads `pages.length` of undefined
 *                   and throws a TypeError. It throws while CONSTRUCTING the
 *                   observer, during render, so it happens on the
 *                   `useSettlements()` line itself — before `query.isError`
 *                   exists to guard it. Nothing downstream can catch it, and
 *                   the route error boundary draws the error screen.
 *   infinite 1st -> no throw; the panel silently reads `[]` and an organizer
 *                   is told nothing needs attention when something does.
 *
 * On a cold load the sidebar renders before `<main>`, so the plain observer
 * usually won and the page usually broke; arriving from /dashboard/payouts, or
 * pressing a retry, flipped it — hence "works after refreshing a few times".
 *
 * The same collision reached /dashboard/events, /refunds and /payouts, because
 * the sidebar's attention dot keeps these mounted on every organizer route.
 *
 * Namespacing is the whole fix. Invalidation still works: it targets the
 * `['organizer']` prefix, which these remain under.
 */
const ATTENTION = ['organizer', 'attention'] as const;

export function useAttention() {
  const results = useQueries({
    queries: [
      {
        queryKey: [...ATTENTION, 'event-rows', { status: 'rejected' }],
        queryFn: () => fetchEventRows({ status: 'rejected' }),
        staleTime: 30_000,
      },
      {
        queryKey: [...ATTENTION, 'event-rows', { status: 'draft' }],
        queryFn: () => fetchEventRows({ status: 'draft' }),
        staleTime: 30_000,
      },
      {
        queryKey: [...ATTENTION, 'event-rows', { status: 'pending_review' }],
        queryFn: () => fetchEventRows({ status: 'pending_review' }),
        staleTime: 30_000,
      },
      {
        queryKey: [...ATTENTION, 'settlements'],
        queryFn: () => fetchSettlements(),
        staleTime: 30_000,
      },
      {
        queryKey: [...ATTENTION, 'refunds', ''],
        queryFn: () => fetchOrganizerRefunds(),
        staleTime: 30_000,
      },
    ],
  });

  const [rejected, drafts, pending, settlements, refunds] = results;

  return useMemo(() => {
    const items: AttentionItem[] = [];

    // ---- an operator sent an event back --------------------------------
    // The single most blocking thing that can happen to an organizer: the
    // event is not on sale and will not be until they act.
    for (const event of (rejected.data?.data ?? []).slice(0, PAGE)) {
      items.push({
        id: `rejected:${event.id}`,
        severity: 'critical',
        title: `“${event.title}” was sent back`,
        detail: event.moderation_note
          ? event.moderation_note
          : 'No reason was recorded. Edit and resubmit, or contact support.',
        href: `/dashboard/events?event=${event.id}`,
        action: 'Fix and resubmit',
        weight: 100,
      });
    }

    // ---- a payout the vendor refused -----------------------------------
    // Money the organizer is owed and has not received. `failed` means the
    // release exhausted its retries; the settlement STAYS OWED.
    for (const settlement of (settlements.data?.data ?? []).filter(
      (row) => row.status === 'failed',
    )) {
      items.push({
        id: `payout:${settlement.id}`,
        severity: 'critical',
        title: `Payout failed for “${settlement.event_title}”`,
        detail:
          'The transfer did not go through. The amount is still owed to you — support can retry it.',
        href: '/dashboard/payouts',
        action: 'View payout',
        weight: 90,
      });
    }

    // ---- an event starting soon with nothing sold ----------------------
    // Not a prediction — a fact about a date and a counter, and the last
    // moment promotion can still change the outcome.
    const soon = Date.now() + 7 * 24 * 60 * 60_000;
    for (const event of upcoming(drafts.data?.data, pending.data?.data)) {
      if (Date.parse(event.starts_at) < soon && event.sold === 0) {
        items.push({
          id: `unsold:${event.id}`,
          severity: 'warning',
          title: `“${event.title}” starts within a week with no sales`,
          detail: `${event.capacity || 'No'} tickets available and none sold yet.`,
          href: `/dashboard/events?event=${event.id}`,
          action: 'Open event',
          weight: 70,
        });
      }
    }

    // ---- an event awaiting an operator ---------------------------------
    // Informational: the organizer cannot do anything, and pretending
    // otherwise would send them looking for a button that is not theirs.
    const waiting = pending.data?.data ?? [];
    if (waiting.length) {
      items.push({
        id: 'pending-review',
        severity: 'info',
        title: `${waiting.length} event${waiting.length === 1 ? '' : 's'} awaiting review`,
        detail:
          'A platform operator has to approve these before they go on sale. Nothing is needed from you.',
        href: '/dashboard/events?status=pending_review',
        action: 'View',
        weight: 40,
      });
    }

    // ---- drafts that have never been submitted -------------------------
    const unsubmitted = (drafts.data?.data ?? []).filter((event) => !event.submitted_at);
    if (unsubmitted.length) {
      items.push({
        id: 'drafts',
        severity: 'info',
        title: `${unsubmitted.length} draft${unsubmitted.length === 1 ? '' : 's'} not yet submitted`,
        detail: 'A draft sells nothing until it is submitted and approved.',
        href: '/dashboard/events?status=draft',
        action: 'Review drafts',
        weight: 30,
      });
    }

    // ---- refunds issued today ------------------------------------------
    // Worth surfacing because a cluster of refunds on one event usually means
    // something is wrong with the event, not with the customers.
    const since = startOfToday();
    const todaysRefunds = (refunds.data?.data ?? []).filter(
      (refund) => Date.parse(refund.created_at) >= since,
    );
    if (todaysRefunds.length >= 3) {
      items.push({
        id: 'refund-cluster',
        severity: 'warning',
        title: `${todaysRefunds.length} refunds today`,
        detail: clusterDetail(todaysRefunds),
        href: '/dashboard/refunds',
        action: 'Review refunds',
        weight: 60,
      });
    }

    items.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.weight - a.weight,
    );

    return {
      items,
      // `isPending` on the FIRST load only. A background refetch must not blank
      // the list an organizer is reading.
      isPending: results.some((result) => result.isPending),
      isError: results.every((result) => result.isError),
      counts: {
        critical: items.filter((item) => item.severity === 'critical').length,
        warning: items.filter((item) => item.severity === 'warning').length,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rejected.data,
    drafts.data,
    pending.data,
    settlements.data,
    refunds.data,
    rejected.isPending,
    drafts.isPending,
    pending.isPending,
    settlements.isPending,
    refunds.isPending,
  ]);
}

function upcoming(...lists: (EventRow[] | undefined)[]): EventRow[] {
  const now = Date.now();
  return lists
    .flatMap((list) => list ?? [])
    .filter((event) => Date.parse(event.starts_at) > now);
}

/** Local midnight — the same day boundary a person means by "today". */
function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Names the event only when the refunds actually concentrate on one.
 *
 * Saying "mostly from X" when they are spread evenly would point somebody at
 * an event that is fine.
 */
function clusterDetail(refunds: OrganizerRefund[]): string {
  const byEvent = new Map<string, number>();
  for (const refund of refunds) {
    byEvent.set(refund.event_title, (byEvent.get(refund.event_title) ?? 0) + 1);
  }
  const [title, count] = [...byEvent.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  return count >= refunds.length * 0.6 && byEvent.size > 1
    ? `Most of them are on “${title}” — worth checking the event page.`
    : 'Spread across your events.';
}

/** Reused by the payouts surface so both agree on what "owed" means. */
export function owedTotal(settlements: OrganizerSettlement[]): number {
  return settlements
    .filter((row) => row.status !== 'paid')
    .reduce((total, row) => total + Math.max(row.net, 0), 0);
}
