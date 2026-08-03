'use client';

import * as React from 'react';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react';
import {
  OCCASION_LABELS,
  PERFORMER_TYPE_LABELS,
  fetchMyRequests,
  type BookingRequest,
} from '@/lib/api/performers';
import { cursorFromNextLink } from '@/lib/api/events';
import { SceneNothingYet, SceneOffline } from '@/components/illustrations/scenes';
import { useAuth } from '@/lib/auth/auth-provider';
import { formatMoney } from '@/lib/discovery/format';
import { cn } from '@/lib/utils/cn';

/**
 * The customer's briefs.
 *
 * Ordered newest first by the server. The quote count is the thing worth
 * scanning for, so it is the largest number on each row — "four replies" is
 * why somebody opened this page.
 *
 * ── THE ROW STAYS A ROW ON A PHONE ────────────────────────────────────────
 *
 * Everything on it is short (a type, a city, a date, a range, a count), so
 * stacking it into a card would have made a scannable list into four screens
 * of blocks. What changes below `sm` is the padding, the meta gaps and the
 * chevron — which is decoration next to a row that is already entirely a link.
 */
export function MyRequests() {
  const { status } = useAuth();

  const query = useInfiniteQuery({
    queryKey: ['hire', 'my-requests'],
    queryFn: ({ pageParam }) => fetchMyRequests({ cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorFromNextLink(last.meta.next),
    enabled: status === 'authenticated',
    staleTime: 0,
  });

  if (status === 'anonymous') {
    return (
      <Empty
        scene={<SceneNothingYet className="h-24 sm:h-28" />}
        title="Sign in to see your briefs"
        body="Quotes come back to the account that posted the brief, so this page needs to know who you are."
        action={
          <Link
            href="/sign-in?next=%2Fhire%2Frequests"
            className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in
          </Link>
        }
      />
    );
  }

  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  if (query.isPending || status === 'unknown') {
    return <div className="skeleton h-64 w-full rounded-2xl" aria-hidden />;
  }

  if (query.isError) {
    return (
      <Empty
        role="alert"
        scene={<SceneOffline className="h-24 sm:h-28" />}
        title="Could not load your briefs"
        body="The connection dropped on the way. Your briefs are safe — nothing here writes anything."
        action={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="inline-flex h-control items-center rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        }
      />
    );
  }

  if (rows.length === 0) {
    return (
      <Empty
        scene={<SceneNothingYet className="h-24 sm:h-28" />}
        title="No briefs yet"
        body="Tell us what you need, where and when — every act that fits answers with a real quote. Four short steps."
        action={
          <Link
            href="/hire/new"
            className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Post your first brief
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {rows.map((request) => (
          <li key={request.id}>
            <RequestRow request={request} />
          </li>
        ))}
      </ul>

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="inline-flex h-control items-center rounded-full border border-border px-pill text-label transition-colors hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Show older briefs'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RequestRow({ request }: { request: BookingRequest }) {
  const booked = request.status === 'booked';

  return (
    <Link
      href={`/hire/requests/${request.id}`}
      className={cn(
        'group flex min-h-control items-center gap-3 rounded-2xl border border-border bg-surface p-3 sm:gap-4 sm:p-4',
        'transition-colors duration-fast hover:bg-muted motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-body-sm font-medium sm:text-body">
            {PERFORMER_TYPE_LABELS[request.performer_type]} ·{' '}
            {OCCASION_LABELS[request.occasion] ?? request.occasion}
          </span>
          {booked ? (
            <span className="rounded-full bg-success-subtle px-2 py-0.5 text-caption text-success-subtle-foreground">
              Booked
            </span>
          ) : request.status !== 'open' ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
              {request.status === 'cancelled' ? 'Cancelled' : 'Expired'}
            </span>
          ) : null}
        </p>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" aria-hidden />
            {request.city}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3" aria-hidden />
            {new Date(request.event_date).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
          <span>
            {formatMoney(request.budget_min_minor)} – {formatMoney(request.budget_max_minor)}
          </span>
        </p>

        {booked ? (
          <p className="mt-1 text-caption text-success">
            Booked with {request.booked_performer_name}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-h4 tabular-nums">{request.quote_count}</p>
        <p className="text-caption text-muted-foreground">
          quote{request.quote_count === 1 ? '' : 's'}
        </p>
      </div>

      {/* The whole row is already the link; below `sm` the chevron is width
          spent on saying so a second time. */}
      <ArrowRight
        className="hidden size-4 shrink-0 text-muted-foreground transition-transform duration-fast group-hover:translate-x-0.5 motion-reduce:transition-none sm:block"
        aria-hidden
      />
    </Link>
  );
}

/**
 * Every "there is nothing to list" screen on this page.
 *
 * The illustration is drawn from the tokens rather than shipped as an asset —
 * it themes correctly in both, costs no request, and cannot be the thing that
 * fails to load on the one screen whose job is to reassure.
 */
function Empty({
  scene,
  title,
  body,
  action,
  role,
}: {
  scene: React.ReactNode;
  title: string;
  body: string;
  action: React.ReactNode;
  role?: 'alert';
}) {
  return (
    <div
      role={role}
      className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-sunken px-4 py-10 text-center sm:px-6 sm:py-14"
    >
      {scene}
      <p className="text-body font-medium">{title}</p>
      <p className="max-w-sm text-body-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}
