'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, ChevronRight, GripVertical, X } from 'lucide-react';
import { inferCategory } from '@/lib/discovery/categories';
import { formatEventDate, formatFromPrice } from '@/lib/discovery/format';
import { useDraggable } from '@/lib/discovery/use-draggable';
import { cn } from '@/lib/utils/cn';
import { categoryTint } from './category-tint';
import { useFeatured } from './featured-context';

/**
 * The featured carousel, continued — a compact floating island that takes over
 * once the hero scrolls away.
 *
 * The problem it solves: the hero spends real estate on a rotating set of
 * featured events, and the moment someone scrolls, all of it is gone. The
 * carousel keeps running for nobody. This keeps the same rotation alive in a
 * form that costs a strip of screen instead of a screenful, so the page's most
 * commercially valuable content stays one tap away for the whole session.
 *
 * Why it reads as ONE object rather than a second widget: it shares the
 * carousel's index (see featured-context), so it is always showing exactly what
 * the hero would be showing. When the event changes it re-keys and plays a
 * short settle animation, which is what makes it feel like the thing morphed
 * rather than swapped.
 *
 * Placement is bottom-centre, not top. The top edge already belongs to the
 * sticky header and a second bar there would read as two competing chromes; the
 * bottom-centre band is where transient "now" surfaces live (a player, a
 * toast), it never covers the content being read, and on mobile it sits clear
 * of the bottom nav.
 *
 * It is PORTALLED to `document.body`. It's rendered from inside the hero (which
 * is where the featured data lives), and the hero clips its overflow — a fixed
 * element whose ancestor establishes a containing block gets clipped with it.
 * Portalling makes the island's position depend on the viewport and nothing
 * else, which is the only correct answer for an overlay.
 *
 * It is DRAGGABLE. A persistent floating element will eventually sit on top of
 * the one thing someone is trying to read, and the honest fix is to let them
 * move it rather than to guess a position that is never wrong. Grab it anywhere
 * — the whole pill is the handle, and a gesture only becomes a drag past a few
 * pixels, so a tap still opens the event — or use the grip, which is focusable
 * and moves with the arrow keys for anyone without a pointer. Where it's put
 * persists per device, because someone who moved it out of the way meant it.
 *
 * SURFACE, in the light-first language: it keeps `.glass`, because this is
 * genuinely floating chrome with the page scrolling underneath it — the one
 * thing the frost is for. Its View chip is the near-black action pill and its
 * autoplay hairline is plain ink; both were the brand gradient, which on a
 * white frost was the loudest object on the screen for the least important
 * information on it.
 *
 * Restraint, deliberately:
 * - it only appears once the hero is genuinely out of view,
 * - it is dismissible, and stays dismissed for the session,
 * - `prefers-reduced-motion` gets the island with no motion at all,
 * - it hides itself while the search palette is open, so it can never sit on
 *   top of a modal surface.
 */

/** The hero renders this; the island watches it to know when to appear. */
export const HERO_SENTINEL_ID = 'featured-hero-sentinel';

export function FeaturedIsland() {
  const featured = useFeatured();
  const { setNode, position, dragging, handleProps, guardClick, nudge, reset } = useDraggable();
  const [mounted, setMounted] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  // Portals need a DOM to target, so nothing renders until after hydration.
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    const sentinel = document.getElementById(HERO_SENTINEL_ID);
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  if (!mounted || !featured || !featured.events.length || dismissed) return null;

  const { events, index, autoplaying, goTo } = featured;
  const event = events[index];
  if (!event) return null;

  const category = inferCategory(event);
  const price = formatFromPrice(event.from_price);
  const CategoryIcon = category?.icon;

  // Until it's been moved it stays anchored bottom-centre by class; once moved
  // it's positioned outright, and the anchoring classes have to stop applying.
  const moved = position !== null;

  // Hover is tracked even mid-drag, but not ACTED on until the drag ends: a pill
  // that resizes under a moving cursor feels broken, and gating the hover itself
  // would leave it collapsed afterwards — the pointer is still on it, and no
  // second `mouseenter` is coming.
  const showExpanded = expanded && !dragging;

  return createPortal(
    <div
      className={cn(
        'pointer-events-none fixed z-drawer flex justify-center',
        moved ? 'left-0 top-0' : 'inset-x-0 bottom-20 px-4 md:bottom-6',
        // `visibility`, not just opacity. An opacity-0 element is still in the
        // hit-test, still in the tab order, and still in the accessibility
        // tree; `visibility: hidden` removes it from all three, which is what
        // "not shown yet" actually means. Transitioning it alongside opacity
        // keeps the fade. This is also why there's no `aria-hidden`/`inert`
        // here: they'd be a second, redundant source of truth for the same
        // state, and the two disagreed.
        'transition-[opacity,transform,visibility] duration-slow ease-spring',
        visible ? 'visible opacity-100' : 'invisible opacity-0',
        !moved && (visible ? 'translate-y-0' : 'translate-y-6'),
        // Nothing eases while a finger is on it — a lagging drag feels broken.
        dragging && 'transition-none',
        'motion-reduce:translate-y-0 motion-reduce:transition-none',
      )}
      style={moved ? { left: position.x, top: position.y } : undefined}
    >
      <div
        ref={setNode}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocusCapture={() => setExpanded(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setExpanded(false);
        }}
        // One guard for everything inside: a drag that happens to end over the
        // link or the dismiss button must not open or close anything. Capture
        // phase, so it runs before any child handler rather than after it.
        onClickCapture={guardClick}
        // An <a> and an <img> are natively draggable: press-and-move on either
        // hands the gesture to the browser's own link/image drag, which fires
        // `pointercancel` and kills ours. That's why this only used to move by
        // the grip. Cancelling `dragstart` (plus `draggable={false}` on the
        // link and the poster) leaves the pointer gesture to us, so the pill
        // drags from anywhere on it, on the first press.
        onDragStart={(dragEvent) => dragEvent.preventDefault()}
        {...handleProps}
        className={cn(
          'glass pointer-events-auto relative flex max-w-full touch-none select-none items-center gap-2 overflow-hidden rounded-full border py-2 pl-2 pr-2 shadow-xl',
          'transition-[padding,box-shadow] duration-base ease-spring',
          showExpanded && 'pr-3 shadow-xl',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
          'motion-reduce:transition-none',
        )}
      >
        {/* The grip is the visible affordance that this moves, and the route to
            moving it WITHOUT a pointer — arrow keys nudge, Escape puts it back.
            It is not the only drag handle: the whole pill is one. */}
        <button
          type="button"
          aria-label="Move featured events panel. Use arrow keys to reposition, Escape to reset."
          onKeyDown={(keyEvent) => {
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const move = moves[keyEvent.key];
            if (move) {
              keyEvent.preventDefault();
              nudge(move[0], move[1]);
              return;
            }
            if (keyEvent.key === 'Escape') {
              keyEvent.preventDefault();
              reset();
            }
          }}
          className={cn(
            'inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-full text-muted-foreground',
            'transition-colors duration-fast hover:bg-muted hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>

        <Link
          href={`/events/${event.id}`}
          draggable={false}
          className={cn(
            'group/island flex min-w-0 items-center gap-3 rounded-full',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {/* Re-keyed on the event so the content settles in rather than
              snapping — the morph that makes this read as one live object. */}
          <span
            key={event.id}
            className="flex min-w-0 animate-fade-rise items-center gap-3 motion-reduce:animate-none"
          >
            <span className="relative size-9 shrink-0 overflow-hidden rounded-full bg-muted">
              {event.poster_url ? (
                <Image
                  src={event.poster_url}
                  alt=""
                  fill
                  sizes="36px"
                  draggable={false}
                  className="object-cover"
                />
              ) : (
                <span
                  className={cn('absolute inset-0', categoryTint(category?.slug).surface)}
                  aria-hidden
                />
              )}
            </span>

            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                {CategoryIcon ? <CategoryIcon className="size-3" aria-hidden /> : null}
                <span className="truncate">
                  {category?.label ?? 'Featured'} · {formatEventDate(event.starts_at)}
                </span>
              </span>
              <span className="max-w-[42vw] truncate text-body-sm font-semibold text-foreground sm:max-w-xs">
                {event.title}
              </span>
            </span>

            {price ? (
              <span className="hidden shrink-0 border-l border-border pl-3 text-body-sm font-semibold tabular-nums text-foreground sm:block">
                {price === 'Free' ? 'Free' : price}
              </span>
            ) : null}

            <span
              className={cn(
                // The same near-black pill as everywhere else, and the same
                // reason its label is `cta-foreground`: in dark theme the fill
                // is near-white, so `on-gradient` would be invisible here.
                'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-cta text-label text-cta-foreground',
                'transition-all duration-base ease-spring',
                showExpanded ? 'px-4 py-2' : 'size-9 justify-center p-0',
                'motion-reduce:transition-none',
              )}
            >
              {showExpanded ? (
                <>
                  View
                  <ArrowRight className="size-3.5" aria-hidden />
                </>
              ) : (
                <ChevronRight className="size-4" aria-hidden />
              )}
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Hide featured events"
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground',
            'transition-colors duration-fast hover:bg-muted hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <X className="size-3.5" aria-hidden />
        </button>

        {/* The same timer as the banner's hairline, wrapped to the island. */}
        {events.length > 1 ? (
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-border" aria-hidden>
            <span
              key={`${index}-${autoplaying}`}
              className={cn(
                'block h-full bg-foreground',
                autoplaying ? 'animate-progress' : 'w-0',
              )}
            />
          </span>
        ) : null}
      </div>

      {/* Keyboard/AT route to the other featured events without the hero. */}
      <div className="sr-only">
        {events.map((other, i) => (
          <button key={other.id} type="button" onClick={() => goTo(i)}>
            {`Show featured event ${i + 1}: ${other.title}`}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
