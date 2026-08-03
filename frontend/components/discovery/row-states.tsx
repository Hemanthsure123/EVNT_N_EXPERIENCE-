'use client';

import * as React from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { SceneNothingYet, SceneOffline, SceneError } from '@/components/illustrations/scenes';
import { useOnline } from '@/lib/utils/use-online';

/**
 * What a content row shows when it has nothing to show.
 *
 * Every listing surface needs both: a row that fails to load must not take the
 * page down with it, and an empty row must still offer a way forward rather
 * than being a hole in the layout.
 *
 * Both actions are fully-rounded pills on the shared control height. The empty
 * state's is the near-black `--cta` — it IS the one thing to press on a screen
 * that has nothing else — and the error state's stays the quiet neutral,
 * because "try again" is a retry, not a destination.
 *
 * ── WHY THESE ARE DRAWN SCENES NOW, NOT LINE ICONS ───────────────────────
 *
 * Both states used a 32px lucide glyph in a grey circle. That is a competent
 * placeholder and it is also the single most templated-looking thing on a page:
 * every product ships it, so it reads as the framework's default rather than as
 * something anybody decided. The scenes cost no request, theme correctly in
 * both modes, and — because they are drawn from the same tokens as everything
 * else — they cannot be the asset that fails to load on the one row whose job
 * is to explain why something else failed to load.
 *
 * ── AND WHY THIS FILE BECAME A CLIENT COMPONENT ──────────────────────────
 *
 * `RowError` now has to know whether the reader has a connection, and
 * `navigator.onLine` only exists in a browser. Its two server-rendered callers
 * (the category and city landing pages) pass nothing but strings, so the
 * boundary costs them nothing; `useOnline` is SSR-safe and assumes ONLINE until
 * the client says otherwise, so the server render and the first client render
 * agree and nobody with a working connection ever sees an offline flash.
 */

/**
 * A row that failed to load must not take the page down with it.
 *
 * ── OFFLINE IS A DIFFERENT PROBLEM WITH A DIFFERENT FIX ──────────────────
 *
 * The same rejected fetch produces this component whether our API is down or
 * the reader is in a tunnel, and telling somebody on a train that our platform
 * is broken is the wrong answer twice over: it points them at a fix they cannot
 * make, and it costs us the trust of a person whose connection came back thirty
 * seconds later to a working site that had just called itself broken. So the
 * offline branch changes the picture, the heading AND the instruction — and it
 * drops the server-supplied `message`, which describes an HTTP failure nobody
 * offline needs to read.
 *
 * The retry link is kept in BOTH branches. Offline it will not resolve today,
 * but it is still the honest affordance: it is the thing that works the moment
 * the connection is back, and a screen with no control on it at all reads as a
 * dead end rather than as a wait.
 */
export function RowError({ message, retryHref }: { message: string; retryHref: string }) {
  const online = useOnline();

  return (
    <EmptyState
      icon={
        online ? (
          <SceneError className="h-28 w-auto sm:h-32" />
        ) : (
          <SceneOffline className="h-28 w-auto sm:h-32" />
        )
      }
      title={online ? "Couldn't load this row" : "You're offline"}
      description={
        online ? message : 'Check your connection — this row will load as soon as you’re back.'
      }
      action={
        <Link
          href={retryHref}
          className="inline-flex h-control items-center rounded-full bg-secondary px-pill text-label text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Try again
        </Link>
      }
    />
  );
}

export function RowEmpty({
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <EmptyState
      // "Nothing here yet" and "nothing matched" are different situations with
      // different next actions, so they get different pictures — an empty state
      // that draws the same thing for both teaches people to ignore it.
      icon={<SceneNothingYet className="h-28 w-auto sm:h-32" />}
      title={title}
      description={description}
      action={
        <Link
          href={ctaHref}
          className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {ctaLabel}
        </Link>
      }
    />
  );
}
