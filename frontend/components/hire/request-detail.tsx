'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CalendarDays, Check, MapPin, Users, Wallet } from 'lucide-react';
import {
  OCCASION_LABELS,
  PERFORMER_TYPE_LABELS,
  acceptQuote,
  fetchRequest,
  fetchRequestQuotes,
  type Quote,
} from '@/lib/api/performers';
import { ApiError } from '@/lib/api/errors';
import { SceneNotFound, SceneNothingYet } from '@/components/illustrations/scenes';
import { formatMoney } from '@/lib/discovery/format';
import { PerformerArt } from './performer-art';
import { cn } from '@/lib/utils/cn';

/**
 * One brief and the quotes on it.
 *
 * ── ACCEPTING IS THE ONE IRREVERSIBLE ACTION HERE ─────────────────────────
 *
 * It closes the brief, books that act and declines every other quote — in one
 * server transaction, so a customer can never end up having promised the date
 * twice. Because it cannot be undone, this is the one place in the product
 * that keeps an explicit confirm step rather than offering undo: there is no
 * compensating write that un-declines four performers who have already been
 * told they lost.
 *
 * ── QUOTES ARRIVE CHEAPEST FIRST ──────────────────────────────────────────
 *
 * Server-ordered. Somebody comparing quotes is comparing price, and
 * newest-first makes them scroll to do it.
 *
 * ── THE PAGE POLLS ────────────────────────────────────────────────────────
 *
 * A brief is something people leave open while replies come in. Fifteen
 * seconds is fast enough to feel live and slow enough to be polite, and it
 * stops in a background tab.
 *
 * ── ON A PHONE, THE ACCEPT IS THE PAGE ────────────────────────────────────
 *
 * Every control in a quote card is full width and on the 44px floor below
 * `sm`, because the decision this screen exists for is worth thousands of
 * rupees and is irreversible — a 40px button somebody fat-fingers while
 * scrolling is not an acceptable way to reach it. The confirm step stays,
 * unchanged, for the same reason.
 */
export function RequestDetail({ requestId }: { requestId: string }) {
  const client = useQueryClient();
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const request = useQuery({
    queryKey: ['hire', 'request', requestId],
    queryFn: () => fetchRequest(requestId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const quotes = useQuery({
    queryKey: ['hire', 'request', requestId, 'quotes'],
    queryFn: () => fetchRequestQuotes(requestId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const accept = useMutation({
    mutationFn: acceptQuote,
    onSuccess: () => {
      setConfirming(null);
      setError(null);
      void client.invalidateQueries({ queryKey: ['hire'] });
    },
    onError: (thrown) =>
      setError(
        thrown instanceof ApiError
          ? thrown.message
          : 'Could not accept that quote. Nothing was changed.',
      ),
  });

  if (request.isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-sunken px-4 py-10 text-center sm:px-6 sm:py-14"
      >
        <SceneNotFound className="h-24 sm:h-28" />
        <p className="text-body font-medium">We could not find that brief</p>
        <p className="max-w-sm text-body-sm text-muted-foreground">
          It may have been cancelled, or it may belong to another account.
        </p>
        <Link
          href="/hire/requests"
          className="inline-flex h-control items-center rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          All your briefs
        </Link>
      </div>
    );
  }

  if (request.isPending) {
    return <div className="skeleton h-64 w-full rounded-2xl" aria-hidden />;
  }

  const brief = request.data;
  const rows = quotes.data?.data ?? [];
  const booked = brief.status === 'booked';

  return (
    <div className="flex flex-col gap-8 lg:gap-10">
      <header className="flex flex-col gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-3 py-1 text-caption',
              booked
                ? 'bg-success-subtle text-success-subtle-foreground'
                : brief.status === 'open'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-muted text-muted-foreground',
            )}
          >
            {booked
              ? `Booked with ${brief.booked_performer_name}`
              : brief.status === 'open'
                ? 'Open for quotes'
                : brief.status === 'cancelled'
                  ? 'Cancelled'
                  : 'Expired'}
          </span>
        </div>

        <h1 className="text-h3 sm:text-h2">
          {PERFORMER_TYPE_LABELS[brief.performer_type]} for a{' '}
          {(OCCASION_LABELS[brief.occasion] ?? brief.occasion).toLowerCase()}
        </h1>

        {/* Two-up from the smallest screen: each fact is a word or a short
            number, so one per row was four full-width cards saying "Mumbai". */}
        <dl className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
          <Fact icon={MapPin} label="City" value={brief.city} />
          <Fact
            icon={CalendarDays}
            label="Date"
            value={new Date(brief.event_date).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          />
          <Fact
            icon={Wallet}
            label="Budget"
            value={`${formatMoney(brief.budget_min_minor)} – ${formatMoney(brief.budget_max_minor)}`}
          />
          {brief.guests ? (
            <Fact icon={Users} label="Guests" value={String(brief.guests)} />
          ) : null}
        </dl>

        {brief.notes ? (
          <p className="max-w-2xl whitespace-pre-line rounded-xl border border-border bg-surface p-4 text-body-sm text-muted-foreground">
            {brief.notes}
          </p>
        ) : null}
      </header>

      {error ? (
        <p role="alert" className="text-body-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <header className="flex items-baseline justify-between gap-4">
          <h2 className="text-h4">
            {rows.length} quote{rows.length === 1 ? '' : 's'}
          </h2>
          {!booked && brief.status === 'open' ? (
            <p className="text-caption text-muted-foreground">Cheapest first</p>
          ) : null}
        </header>

        {quotes.isPending ? (
          <div className="skeleton h-32 w-full rounded-2xl" aria-hidden />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong bg-sunken px-4 py-10 text-center sm:px-6 sm:py-14">
            <SceneNothingYet className="h-24 sm:h-28" />
            <p className="text-body font-medium">No quotes yet</p>
            {/* This used to end "Replies usually take a day or two". Nothing
                on the platform measures a response time, so that was a
                number-shaped promise with nothing behind it — and the one it
                would have set expectations against is a real person's diary.
                What is left is the matching rule, which is exactly what the
                backend does. */}
            <p className="max-w-sm text-body-sm text-muted-foreground">
              Every {PERFORMER_TYPE_LABELS[brief.performer_type].toLowerCase()} in {brief.city}{' '}
              whose starting price fits your budget can see this brief. This page updates itself as
              they answer.
            </p>
            <Link
              href={`/hire?type=${brief.performer_type}&city=${encodeURIComponent(brief.city)}`}
              className="inline-flex h-control items-center rounded-full border border-border bg-surface px-pill text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Browse acts meanwhile
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((quote) => (
              <li key={quote.id}>
                <QuoteRow
                  quote={quote}
                  briefOpen={brief.status === 'open'}
                  confirming={confirming === quote.id}
                  busy={accept.isPending}
                  onConfirm={() => setConfirming(quote.id)}
                  onCancel={() => setConfirming(null)}
                  onAccept={() => accept.mutate(quote.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <dt className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="truncate text-body-sm text-foreground">{value}</dd>
    </div>
  );
}

function QuoteRow({
  quote,
  briefOpen,
  confirming,
  busy,
  onConfirm,
  onCancel,
  onAccept,
}: {
  quote: Quote;
  briefOpen: boolean;
  confirming: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onAccept: () => void;
}) {
  const verified = quote.verified_level === 'verified';

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border bg-surface p-3 transition-colors sm:p-4',
        quote.status === 'accepted' ? 'border-success' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        {/* The act's own object rather than a photograph: the quote payload
            carries no image, and `performer_type` is a real column — so this
            is a fact about the quote, drawn, not a placeholder avatar. */}
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted sm:size-12">
          <PerformerArt type={quote.performer_type} className="size-9 sm:size-10" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <Link
              href={`/hire/${quote.performer_id}`}
              className="truncate text-body-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-body"
            >
              {quote.performer_name}
            </Link>
            {verified ? (
              <BadgeCheck className="size-4 shrink-0 text-primary" aria-label="Verified" />
            ) : null}
          </p>
          <p className="text-caption text-muted-foreground">
            {PERFORMER_TYPE_LABELS[quote.performer_type]} · {quote.performer_city}
            {quote.performer_experience_years > 0
              ? ` · ${quote.performer_experience_years} yrs`
              : ''}
          </p>
        </div>

        <p className="shrink-0 text-body font-semibold tabular-nums sm:text-h4">
          {formatMoney(quote.amount_minor)}
        </p>
      </div>

      {quote.message ? (
        <p className="whitespace-pre-line text-body-sm text-muted-foreground">{quote.message}</p>
      ) : null}

      {quote.status === 'accepted' ? (
        <p className="flex items-center gap-1.5 text-body-sm text-success">
          <Check className="size-4" aria-hidden />
          Booked. They have your brief and the date is theirs.
        </p>
      ) : quote.status === 'declined' ? (
        <p className="text-caption text-muted-foreground">
          Declined when you booked another act.
        </p>
      ) : quote.status === 'withdrawn' ? (
        <p className="text-caption text-muted-foreground">Withdrawn by the performer.</p>
      ) : !briefOpen ? null : confirming ? (
        // The one confirm step in the product, and the copy says exactly what
        // it will do — there is no compensating write that un-declines four
        // performers already told they lost.
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted p-3">
          <p className="text-body-sm">
            Booking {quote.performer_name} for {formatMoney(quote.amount_minor)} closes this brief
            and declines every other quote. This cannot be undone.
          </p>
          {/* Full width and stacked below `sm`, so the destructive-by-omission
              pair ("book them" / "not yet") can never be two half-width
              buttons a thumb lands between. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={busy}
              onClick={onAccept}
              className="inline-flex h-control items-center justify-center rounded-lg bg-success px-4 text-label text-success-foreground transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10"
            >
              {busy ? 'Booking…' : 'Yes, book them'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-control items-center justify-center rounded-lg border border-border px-4 text-label transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10"
            >
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex h-control items-center justify-center truncate rounded-lg bg-cta px-4 text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10"
          >
            Book {quote.performer_name}
          </button>
          <Link
            href={`/hire/${quote.performer_id}`}
            className="inline-flex h-control items-center justify-center rounded-lg border border-border px-4 text-label transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10"
          >
            View profile
          </Link>
        </div>
      )}
    </div>
  );
}
