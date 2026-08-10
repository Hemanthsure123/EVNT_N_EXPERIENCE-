'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  fetchAdminSettlements,
  fetchHealth,
  fetchModerationQueue,
  fetchOverview,
  fetchPendingVerifications,
} from '@/lib/api/admin';
import { adminQueryKeys } from './query-keys';

/**
 * "What requires attention?" — the question the console exists to answer.
 *
 * ── EVERY ITEM IS A QUEUE WITH A HUMAN AT THE END OF IT ───────────────────
 *
 * An event nobody has decided on, an organizer waiting to be verified, a
 * payout the vendor refused, a dependency that failed its probe. Each is a
 * real row (or a real failed probe) with a state that will not resolve itself.
 * Nothing here is a score, a trend, or a "you might want to look at" nudge.
 *
 * ── AGE IS THE URGENCY, NOT VOLUME ────────────────────────────────────────
 *
 * Ten events submitted this morning is a normal Tuesday; one submitted nine
 * days ago is an organizer who has concluded the platform ignores them. So the
 * moderation and verification items escalate on the OLDEST wait rather than on
 * the count — which is also the number an operator should be judged on.
 *
 * ── A FAILED READ IS NEVER AN ALL-CLEAR ───────────────────────────────────
 *
 * If the queries fail, the panel says so. Rendering "nothing needs you"
 * because the network broke is the single most dangerous thing an operations
 * dashboard can do.
 */

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export type AdminAttentionItem = {
  id: string;
  severity: AttentionSeverity;
  title: string;
  /** States what is true and what to do. Never "something went wrong". */
  detail: string;
  href: string;
  action: string;
  /** Sorts within a severity. Higher is more urgent. */
  weight: number;
  count?: number;
};

const ORDER: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** A submission older than this has been waiting too long to call normal. */
const STALE_REVIEW_HOURS = 48;
/** A verification is a business blocker — an unverified organizer cannot be paid. */
const STALE_VERIFICATION_HOURS = 72;

export function useAdminAttention() {
  const results = useQueries({
    queries: [
      { queryKey: ['admin', 'overview'], queryFn: fetchOverview, staleTime: 30_000 },
      { queryKey: ['admin', 'health'], queryFn: fetchHealth, staleTime: 30_000 },
      {
        // A COUNT probe, and keyed as one. The queue screen reads the same
        // endpoint through useInfiniteQuery, which stores a differently
        // shaped cache entry — see lib/admin/query-keys for what sharing one
        // key between the two did.
        queryKey: adminQueryKeys.moderationCount('pending_review'),
        queryFn: () => fetchModerationQueue({ status: 'pending_review' }),
        staleTime: 30_000,
      },
      {
        queryKey: ['admin', 'verifications'],
        queryFn: fetchPendingVerifications,
        staleTime: 30_000,
      },
      {
        queryKey: ['admin', 'settlements', { status: 'failed' }],
        queryFn: () => fetchAdminSettlements({ status: 'failed' }),
        staleTime: 30_000,
      },
    ],
  });

  const [overview, health, moderation, verifications, failedPayouts] = results;

  return useMemo(() => {
    const items: AdminAttentionItem[] = [];

    // ---- a dependency that failed its PROBE ----------------------------
    // Only probed checks can be degraded. `unknown` means "configured but not
    // contacted", which is not evidence of a problem and must not raise an
    // alarm — see `apps/console/health.py`.
    for (const check of health.data?.checks ?? []) {
      if (check.status !== 'degraded') continue;
      items.push({
        id: `health:${check.name}`,
        severity: 'critical',
        title: `${check.name} is degraded`,
        detail: `${check.detail}. This was probed just now, not inferred — the platform is affected.`,
        href: '/admin/health',
        action: 'Open health',
        weight: 100,
      });
    }

    // ---- payouts the vendor refused ------------------------------------
    // Money an organizer is owed and has not received. `failed` means the
    // release exhausted its retries; the settlement STAYS OWED.
    const failed = failedPayouts.data?.data ?? [];
    if (failed.length) {
      items.push({
        id: 'payouts:failed',
        severity: 'critical',
        title: `${failed.length} payout${failed.length === 1 ? '' : 's'} failed`,
        detail:
          'The transfers exhausted their retries. The organizers are still owed — each needs a person to look at the vendor error.',
        href: '/admin/settlements?status=failed',
        action: 'Review payouts',
        weight: 90,
        count: failed.length,
      });
    }

    // ---- events waiting on a decision ----------------------------------
    const pending = moderation.data?.data ?? [];
    if (pending.length) {
      const oldest = oldestWaitHours(pending.map((row) => row.submitted_at));
      const stale = oldest !== null && oldest >= STALE_REVIEW_HOURS;
      items.push({
        id: 'moderation:pending',
        severity: stale ? 'warning' : 'info',
        title: `${pending.length} event${pending.length === 1 ? '' : 's'} awaiting review`,
        detail: stale
          ? `The oldest has been waiting ${Math.round(oldest / 24)} days. Nothing it contains can be sold until somebody decides.`
          : 'None can be sold until somebody decides. The queue is oldest-first.',
        href: '/admin/moderation',
        action: 'Open queue',
        weight: stale ? 80 : 40,
        count: pending.length,
      });
    }

    // ---- organizers waiting to be verified -----------------------------
    const waiting = verifications.data?.data ?? [];
    if (waiting.length) {
      const oldest = oldestWaitHours(waiting.map((row) => row.created_at));
      const stale = oldest !== null && oldest >= STALE_VERIFICATION_HOURS;
      items.push({
        id: 'verifications:pending',
        severity: stale ? 'warning' : 'info',
        title: `${waiting.length} verification${waiting.length === 1 ? '' : 's'} pending`,
        detail: stale
          ? `The oldest has been waiting ${Math.round(oldest / 24)} days. An unverified organizer cannot be paid out.`
          : 'An unverified organizer cannot receive a payout.',
        href: '/admin/verifications',
        action: 'Review',
        weight: stale ? 75 : 35,
        count: waiting.length,
      });
    }

    items.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.weight - a.weight);

    return {
      items,
      isPending: results.some((result) => result.isPending),
      // EVERY query failing means the console cannot see the platform. One
      // failing is a gap in this list, and the panel still shows what it knows.
      isError: results.every((result) => result.isError),
      counts: {
        critical: items.filter((item) => item.severity === 'critical').length,
        warning: items.filter((item) => item.severity === 'warning').length,
      },
      overview: overview.data,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    overview.data,
    health.data,
    moderation.data,
    verifications.data,
    failedPayouts.data,
    overview.isPending,
    health.isPending,
    moderation.isPending,
    verifications.isPending,
    failedPayouts.isPending,
  ]);
}

/** Hours since the OLDEST of a set of timestamps. `null` when none are set. */
function oldestWaitHours(stamps: (string | null)[]): number | null {
  const times = stamps
    .filter((stamp): stamp is string => Boolean(stamp))
    .map((stamp) => Date.parse(stamp))
    .filter((time) => Number.isFinite(time));
  if (times.length === 0) return null;
  return (Date.now() - Math.min(...times)) / 3_600_000;
}
