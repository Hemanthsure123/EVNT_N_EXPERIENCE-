'use client';

import * as React from 'react';
import Link from 'next/link';
import { useEventDeck, type EventSeed } from '@/lib/discovery/event-deck-context';
import { eventPath } from '@/lib/events/ref';
import { cn } from '@/lib/utils/cn';

/**
 * One way to reach an event, correct on both halves of the breakpoint.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * The widget is the mobile event page, but only four components ever opened
 * it. Everything else — a ticket in the account area, the "rate the events you
 * went to" list, an organiser's "more from" list, the trending rail — was a
 * plain `<Link>`, so a tap there dropped out of the app-shaped experience and
 * onto the standalone page with its site header, its search bar and its own
 * scroll position. Two different event pages depending on which card you
 * happened to touch.
 *
 * The four card components that already do this do it inline, as a `sm:hidden`
 * button beside a `hidden sm:inline` link. That is right for THEM — the link
 * is a stretched `after:absolute` overlay covering the whole card, which is a
 * card concern. It is wrong to copy six more times for places that just need a
 * title to be tappable, hence this.
 *
 * ── AND WHY THE LINK STILL EXISTS ─────────────────────────────────────────
 *
 * `/events/{slug}-{uuid}` is the canonical URL. It carries the `Event` JSON-LD
 * that earns rich results and it is what every entry in `sitemap.xml` points
 * at, so it cannot go away — deleting the route would remove every event from
 * Google. What changes is the EXPERIENCE, not the URL: above `sm` this renders
 * a real anchor to the real page, and a crawler (which does not run the
 * breakpoint) sees an anchor too.
 *
 * Below `sm` it is a button that opens the widget. Both are rendered and CSS
 * picks, rather than reading a viewport at runtime: a media query is resolved
 * before paint, where `matchMedia` in an effect flashes the wrong one first.
 */
export function OpenEventLink({
  event,
  className,
  children,
}: {
  /** As much as the caller knows — see `EventSeed`; an id and a title suffice. */
  event: EventSeed;
  className?: string;
  children: React.ReactNode;
}) {
  const { openEvent } = useEventDeck();

  return (
    <>
      <span className="inline-block max-w-full min-w-0 sm:hidden">
        <button
          type="button"
          onClick={() => openEvent(event)}
          className={cn('text-left max-w-full', className)}
        >
          {children}
        </button>
      </span>
      <span className="hidden sm:inline-block max-w-full min-w-0">
        <Link
          // `eventPath` handles a missing slug by falling back to the bare-id
          // URL, which is what the platform served before slugs existed — so a
          // seed carrying no slug still produces a URL that resolves.
          href={eventPath(event)}
          className={cn('max-w-full', className)}
        >
          {children}
        </Link>
      </span>
    </>
  );
}
