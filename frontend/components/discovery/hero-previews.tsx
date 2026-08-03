'use client';

import * as React from 'react';
import Image from 'next/image';
import type { EventCard as EventCardData } from '@/lib/api/types';
import { inferCategory } from '@/lib/discovery/categories';
import { cn } from '@/lib/utils/cn';
import { categoryTint } from './category-tint';

/**
 * "Up next" — the carousel's indicator, made of content.
 *
 * Dots tell you there is more; a thumbnail tells you what. So the space under
 * the banner carries the next events themselves rather than an abstract
 * position widget: same information, plus a reason to keep looking, in the same
 * room. The autoplay timer moved onto the banner's bottom edge as a hairline
 * (see carousel.tsx), which is why this row is now content and not chrome.
 *
 * A fixed grid, never a scroller — nothing in the hero scrolls.
 */
export function HeroPreviews({
  events,
  index,
  goTo,
}: {
  events: EventCardData[];
  index: number;
  goTo: (index: number) => void;
}) {
  if (events.length < 2) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption uppercase tracking-wide text-muted-foreground">Up next</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((offset) => {
          const target = (index + offset) % events.length;
          const event = events[target];
          if (!event) return null;
          const category = inferCategory(event);

          return (
            // The third preview needs ~110px of title width to say anything
            // useful; below sm there isn't any, so it's dropped rather than
            // truncated into initials.
            <li
              key={`${offset}-${event.id}`}
              className={offset === 3 ? 'hidden sm:block' : undefined}
            >
              <button
                type="button"
                onClick={() => goTo(target)}
                className={cn(
                  // Opaque, with a hairline. The 60% surface was tuned to
                  // blend into a dark hero; against a white page a
                  // semi-transparent white card has no edge at all.
                  'group/preview flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-2 text-left shadow-sm',
                  'transition duration-base ease-spring hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
                  'motion-reduce:hover:translate-y-0',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {event.poster_url ? (
                    <Image
                      src={event.poster_url}
                      alt=""
                      fill
                      sizes="48px"
                      className="object-cover transition-transform duration-base ease-spring group-hover/preview:scale-[1.06] motion-reduce:group-hover/preview:scale-100"
                    />
                  ) : (
                    <span
                      className={cn('absolute inset-0', categoryTint(category?.slug).surface)}
                      aria-hidden
                    />
                  )}
                </span>

                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-caption uppercase tracking-wide text-muted-foreground">
                    {category?.label ?? event.city}
                  </span>
                  <span className="line-clamp-1 text-body-sm font-medium text-foreground">
                    {event.title}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
