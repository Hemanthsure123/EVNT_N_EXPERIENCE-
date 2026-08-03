'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Loader2, Music4, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-provider';
import { PERFORMER_TYPE_LABELS } from '@/lib/api/performers';
import { profileState, useMyActs } from '@/lib/performer/studio';
import { ErrorState, Skeleton, StatusPill } from '@/components/organizer/primitives';
import { Button } from '@/components/ui/button';

/**
 * The door into the studio.
 *
 * One act goes straight through — a chooser with a single option is a click
 * charged for nothing. Several, and this is the only screen where seeing them
 * side by side is useful, because every other screen is act-scoped.
 *
 * A performer with none is shown what a listing is FOR before being asked to
 * fill in a form, and told the one thing that surprises people: an act belongs
 * to an organisation, which is the same entity that gets paid and verified.
 *
 * ── THE ROWS ARE THE PRIMARY ACTION, SO "ADD" IS NOT FILLED ───────────────
 *
 * Somebody who already has acts came here to open one. The filled near-black
 * pill appears only in the EMPTY state, where creating a listing is genuinely
 * the one thing to do; with rows on screen it steps back to an outline so the
 * acts themselves are what the eye lands on.
 */
export function ActPicker() {
  const { status } = useAuth();
  const acts = useMyActs();
  const pathname = usePathname() ?? '/studio';

  if (status === 'unknown') {
    return (
      <p className="inline-flex items-center gap-2 py-16 text-body-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Checking your access…
      </p>
    );
  }

  if (status === 'anonymous') {
    return (
      <div className="flex flex-col items-center gap-stack py-section text-center">
        <h1 className="text-h2">Sign in to open your studio</h1>
        <p className="max-w-sm text-body-sm text-muted-foreground">
          Your acts, leads and quotes live behind your account.
        </p>
        <Button asChild className="mt-1">
          <Link href={`/sign-in?next=${encodeURIComponent(pathname)}`}>Sign in</Link>
        </Button>
      </div>
    );
  }

  if (acts.isError) {
    return (
      <ErrorState
        message="Could not load your acts."
        onRetry={() => void acts.refetch()}
        className="rounded-xl border border-border bg-surface"
      />
    );
  }

  const rows = acts.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="flex flex-col gap-block py-block">
      <header className="flex flex-col gap-1">
        {/* h2, not h1: this is a workspace door, and a 40px marketing headline
            here pushes the list of acts — the only thing anyone came for —
            further down the page. */}
        <h1 className="text-h2">Performer Studio</h1>
        <p className="text-body-sm text-muted-foreground">
          Where you manage the acts you take bookings for.
        </p>
      </header>

      {acts.isPending ? (
        <ul className="grid gap-stack sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <li key={index}>
              <Skeleton className="h-32 w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-start gap-stack-lg rounded-xl border border-border bg-surface p-card-lg shadow-sm">
          <span
            className="inline-flex size-12 items-center justify-center rounded-full bg-muted"
            aria-hidden
          >
            <Music4 className="size-5 text-primary" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-h3">List your act</h2>
            <p className="max-w-prose text-body-sm text-muted-foreground">
              A listing puts you in front of people planning weddings, college fests and corporate
              nights, and lets them send you a brief with a date, a city and a budget. You reply
              with one price. Curatix takes no cut of what you agree — the booking is between you
              and the customer.
            </p>
          </div>
          <p className="max-w-prose text-caption text-muted-foreground">
            An act belongs to an organisation, the same one used for events and payouts. If you do
            not have one yet, you will be asked to create it first.
          </p>
          <Button asChild>
            <Link href="/studio/new">
              <Plus className="size-4" aria-hidden />
              Create a listing
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <ul className="grid gap-stack sm:grid-cols-2">
            {rows.map((act) => {
              const state = profileState(act);
              return (
                <li key={act.id}>
                  <Link
                    href={`/studio/${act.id}`}
                    className="group flex h-full items-center gap-4 rounded-xl border border-border bg-surface p-card shadow-sm transition-colors duration-fast hover:bg-muted motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {act.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- storage-adapter URL
                      <img
                        src={act.photos[0].url}
                        alt=""
                        className="size-16 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <span
                        className="inline-flex size-16 shrink-0 items-center justify-center rounded-xl bg-muted"
                        aria-hidden
                      >
                        <Music4 className="size-5 text-muted-foreground" />
                      </span>
                    )}

                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-body font-semibold">{act.stage_name}</span>
                      <span className="truncate text-caption text-muted-foreground">
                        {PERFORMER_TYPE_LABELS[act.performer_type]} · {act.city}
                      </span>
                      <StatusPill tone={state.tone} className="w-fit">
                        {state.label}
                      </StatusPill>
                    </span>

                    <ArrowRight
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-fast group-hover:translate-x-0.5 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>

          <Button asChild variant="outline" className="w-fit">
            <Link href="/studio/new">
              <Plus className="size-4" aria-hidden />
              Add another act
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}
