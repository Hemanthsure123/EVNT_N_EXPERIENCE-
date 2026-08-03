'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Bookmark } from 'lucide-react';
import { fetchEventDetail } from '@/lib/api/events';
import { useSavedEventIds } from '@/lib/discovery/use-favourites';
import { fetchSavedEvents } from '@/lib/api/saved-events';
import { useAuth } from '@/lib/auth/auth-provider';
import { EventCard } from '@/components/discovery/event-card';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { EmptyState, Skeleton } from '@/components/organizer/primitives';

/**
 * Saved events.
 *
 * ── TWO SOURCES, BECAUSE SAVING WORKS WITHOUT AN ACCOUNT ──────────────────
 *
 * Signed in, the list comes from `GET /me/saved-events`: ONE request that
 * returns the cards already joined, and a set that follows the user to their
 * next device.
 *
 * Anonymous, it is still `localStorage` — browsing needs no account, and a
 * bookmark that demanded one would remove the affordance for exactly the
 * people still deciding. Each id is then fetched individually, sharing the
 * SAME query keys the browse and detail pages use, so an event already loaded
 * elsewhere is served from cache. A saved list is realistically a handful; the
 * one-request path is the signed-in one.
 *
 * The page says which of the two it is showing, rather than implying a sync
 * that is not happening for an anonymous visitor.
 *
 * An event that 404s (deleted, or taken down by moderation) is dropped rather
 * than rendered as a broken card. A saved event that is merely no longer ON
 * SALE still shows, marked unavailable — hiding it would look like the save
 * was lost.
 *
 * ── THE PAGE IS A GRID OF PHOTOGRAPHS, SO ITS CHROME IS SILENT ────────────
 *
 * The only filled control here is the empty state's "Browse events" — the
 * near-black `--cta` pill, and the one thing to do when there is nothing to
 * look at. Once there IS something, the posters carry all the colour and this
 * component adds none: heading, one line of context, `EventCard`. That is the
 * light-first rule applied literally.
 */
export function SavedEvents() {
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  const savedIds = useSavedEventIds();

  // Signed in: one joined request.
  const account = useQuery({
    queryKey: ['saved-events'],
    queryFn: fetchSavedEvents,
    enabled: signedIn,
    staleTime: 30_000,
  });

  // Anonymous: one request per id, from the shared cache where possible.
  const queries = useQueries({
    queries: (signedIn ? [] : (savedIds ?? [])).map((id) => ({
      queryKey: ['event', id],
      queryFn: () => fetchEventDetail(id),
      staleTime: 60_000,
      retry: false,
    })),
  });

  // `null` means the client has not read storage yet — distinct from "empty".
  const loading = signedIn
    ? account.isPending
    : savedIds === null || queries.some((query) => query.isPending);
  // Both shapes carry the card's fields; the account one adds `is_available`,
  // which the badge reads to mark a saved event that is no longer on sale.
  const events: (EventCardData & { is_available?: boolean })[] = signedIn
    ? (account.data ?? [])
    : queries.flatMap((query) => (query.data ? [query.data] : []));

  return (
    <div className="flex flex-col gap-block lg:gap-block-lg">
      <header className="flex flex-col gap-stack">
        <h1 className="text-h3 md:text-h2">Saved events</h1>
        <p className="text-body text-muted-foreground">
          {signedIn
            ? 'Saved to your account, so they follow you to any device you sign in on.'
            : 'Kept on this device while you are signed out. Sign in and they move to your account.'}
        </p>
      </header>

      {loading ? (
        // The reserved height matches the PORTRAIT card the discovery language
        // uses now (3:4 image with the text block below it), so the grid does
        // not jump when the real cards land.
        <ul className="grid gap-block sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: savedIds?.length || 3 }, (_, index) => (
            <li key={index}>
              <Skeleton className="h-[28rem] w-full rounded-xl" />
            </li>
          ))}
        </ul>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface shadow-sm">
          <EmptyState
            icon={Bookmark}
            title="You haven't saved anything"
            body="Tap the bookmark on any event while browsing and it will wait for you here."
            action={
              <Link
                href="/events"
                className="inline-flex h-control items-center rounded-full bg-cta px-pill text-label text-cta-foreground shadow-sm transition-colors duration-fast hover:bg-cta-hover active:bg-cta-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Browse events
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-block sm:grid-cols-2 xl:grid-cols-3">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex animate-fade-rise flex-col gap-2 motion-reduce:animate-none"
            >
              {/* Three-up at xl, two at sm, one below — the `sizes` the
                  grid actually resolves to, so the browser never fetches a
                  poster wider than the slot. */}
              <EventCard
                event={event}
                sizes="(min-width: 1280px) 30vw, (min-width: 640px) 45vw, 100vw"
                className={event.is_available === false ? 'opacity-70' : undefined}
              />
              {event.is_available === false ? (
                // Kept in the list, marked. Dropping it silently is
                // indistinguishable from losing the save.
                <p className="text-caption text-foreground-subtle">
                  No longer on sale — it was cancelled or has already happened.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
