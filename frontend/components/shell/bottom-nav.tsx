/* eslint-disable local-rules/no-raw-values */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

export interface BottomNavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

/**
 * The padding anything above the bar needs so its last row is not underneath it.
 *
 * Exported because the bar's clearance is TWO numbers that have to move
 * together — the row height AND the safe-area inset the bar pads itself with —
 * and every caller that re-derived them by hand is a place they can silently
 * desynchronise. It is written against `--bottom-nav-height` rather than the
 * literal `4rem` the token happens to hold today, for the same reason.
 *
 * `md:pb-0` because the bar is `md:hidden`; leaving the padding in place above
 * `md` is a strip of dead space at the bottom of every desktop page.
 *
 * Tailwind normalises the missing whitespace around `+` inside `calc()`, but
 * the `_+_` is written explicitly here — `calc(a+b)` is invalid CSS and a
 * dropped declaration is a silent failure, not a visible one.
 */
export const BOTTOM_NAV_CLEARANCE =
  'pb-[calc(var(--bottom-nav-height)_+_env(safe-area-inset-bottom))] md:pb-0';

/**
 * How far the floating pill sits off the bottom edge.
 *
 * A number rather than a token because it is the pill's own inset and nothing
 * else consumes it — but `--bottom-nav-height` STILL has to cover the pill's
 * full footprint (its height plus this gap), because `BOTTOM_NAV_CLEARANCE` is
 * what stops the last row of every page from ending up underneath it, and the
 * event page's booking bar stacks on the same variable.
 */
const FLOAT_GAP = '0.75rem';

/**
 * Mobile bottom navigation (hidden on md+). Marks the active route.
 *
 * ── THE ACTIVE ITEM WEARS THE SAME BUTTER PILL AS THE HEADER NAV ──────────
 *
 * It used to be `text-primary` on an otherwise identical row — a hue change
 * and nothing else, which is the weakest possible "you are here" on the one
 * surface people navigate by thumb without reading. The icon now sits in the
 * `--nav-active` pill the header rail uses, so the two navigations mark the
 * current page the same way, and the mark survives at a glance and in
 * greyscale.
 *
 * ── ACTIVE IS A PREFIX MATCH, EXCEPT AT THE ROOT ──────────────────────────
 *
 * It was `pathname === item.href`, so the moment you opened an event from the
 * Events tab — `/events/{id}`, which is most of the time anyone spends in this
 * app — the bar showed NOTHING selected. A navigation that forgets where you
 * are as soon as you go somewhere is worse than one with no marker at all,
 * because the blank state reads as "you are outside the app". `/` is the one
 * exception: every path starts with it, so a prefix match there would light
 * Home up permanently. The trailing slash in `${href}/` is what stops a future
 * `/events-archive` from marking `/events` active.
 *
 * ── IT IS A FLOATING BAR, SO IT IS ALLOWED THE BLUR ───────────────────────
 *
 * Content scrolls underneath it — the same condition that earns the header its
 * glass. `bg-surface/90` rather than `bg-background/90`: on a pure white canvas
 * a translucent canvas-coloured bar is not a bar, so the fill is the surface
 * token and the `border-t` hairline carries the edge.
 *
 * ── THE SAFE AREA IS PADDING, NOT LUCK ────────────────────────────────────
 *
 * On a notched iOS device the home indicator sits in the bottom inset. Without
 * `env(safe-area-inset-bottom)` the last row of targets is under it — 64px of
 * nav with the bottom ~20px unhittable. The row itself stays exactly
 * `--bottom-nav-height` tall; the inset is added BELOW it, which is why the
 * clearance above is `--bottom-nav-height` PLUS the inset rather than a flat
 * `4rem`. Both halves have to move together.
 *
 * NOTE: `env(safe-area-inset-*)` resolves to 0 until the document opts in with
 * `viewport-fit=cover`, and `app/layout.tsx`'s `viewport` export does not set
 * it today — so iOS Safari letterboxes the page inside the safe area and this
 * padding is currently a no-op that costs nothing. It stops being a no-op the
 * moment the app is installed to the home screen or `viewportFit: 'cover'` is
 * set for an edge-to-edge hero, and the ordering here is what makes that a
 * one-line change rather than a bug report from an iPhone.
 */
export function BottomNav({ items, className }: { items: BottomNavItem[]; className?: string }) {
  const pathname = usePathname();
  /**
   * ── IT MINIMISES NOW; IT USED TO DISAPPEAR ──────────────────────────────
   *
   * The bar translated fully off the bottom of the screen on a downward
   * scroll, which meant the primary navigation of the entire mobile site was
   * absent for as long as somebody kept reading — and getting it back required
   * scrolling the wrong way first. Condensing keeps every destination one tap
   * away at all times and still returns the vertical space that hiding it was
   * really after: the labels come off, and the pill shrinks to its icons.
   *
   * The thresholds are unchanged (+10px past 60px to condense, -10px to
   * expand) so the feel of the gesture is the same one people already have.
   */
  const [condensed, setCondensed] = React.useState(false);
  const lastScrollY = React.useRef(0);

  React.useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current + 10 && currentScrollY > 60) {
        setCondensed(true);
      } else if (currentScrollY < lastScrollY.current - 10) {
        setCondensed(false);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    /* ── A FLOATING PILL, NOT AN EDGE-TO-EDGE BAR ─────────────────────────
       The outer element is a positioning frame with no paint of its own, so
       the pill inside can be centred and can shrink without the surface it
       sits on resizing with it. `pointer-events-none` on the frame and
       `pointer-events-auto` on the pill means the page stays scrollable
       through the gap on either side — a full-width invisible strip across
       the bottom of every page would swallow taps on whatever is behind it.

       It is NOT `aria-hidden` any more. Hiding was a visual state that took
       the whole nav out of the accessibility tree and made it untabbable;
       condensing is a visual state that changes nothing about reachability,
       so both `aria-hidden` and `pointer-events-none` came off with it. */
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-sticky flex justify-center px-4 md:hidden',
        className,
      )}
      style={{ bottom: `calc(${FLOAT_GAP} + env(safe-area-inset-bottom))` }}
    >
      <nav
        aria-label="Primary"
        className={cn(
          'glass pointer-events-auto flex max-w-full items-center gap-1 overflow-hidden rounded-full border p-1.5 shadow-lg',
          'transition-[padding,gap] duration-300 ease-out motion-reduce:transition-none',
          condensed && 'gap-0.5 p-1',
        )}
      >
        <ul className="flex items-center gap-0.5">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-11 items-center gap-2 rounded-full px-3 text-caption transition-[background-color,color,padding] duration-300 ease-out',
                    'motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    // The active item wears the butter pill the header rail
                    // uses, so both navigations mark the current page the same
                    // way and the mark survives in greyscale.
                    active
                      ? 'bg-nav-active font-semibold text-nav-active-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    condensed && 'px-2.5',
                  )}
                >
                  <span aria-hidden className="inline-flex shrink-0 items-center justify-center">
                    {item.icon}
                  </span>
                  {/* ── THE LABEL COLLAPSES; IT IS NEVER REMOVED ──────────
                      `max-w` + `opacity`, not `hidden`: an animated width lets
                      the pill contract smoothly around its icons, where
                      `display:none` would snap. And the text stays in the DOM
                      throughout, so the link keeps its accessible name — a nav
                      whose items lose their names on scroll is unusable with a
                      screen reader for the rest of the page.

                      Only the INACTIVE labels collapse. Keeping the current
                      page's label is what stops the condensed pill from being
                      four anonymous glyphs: it still says where you are. */}
                  <span
                    className={cn(
                      'overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-out',
                      'motion-reduce:transition-none',
                      condensed && !active ? 'max-w-0 opacity-0' : 'max-w-24 opacity-100',
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** Exported for the unit test — see the prefix-match note above. */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
