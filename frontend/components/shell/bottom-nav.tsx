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
  const [hidden, setHidden] = React.useState(false);
  const lastScrollY = React.useRef(0);

  React.useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current + 10 && currentScrollY > 60) {
        setHidden(true);
      } else if (currentScrollY < lastScrollY.current - 10) {
        setHidden(false);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      aria-label="Primary"
      aria-hidden={hidden || undefined}
      className={cn(
        'fixed inset-x-0 bottom-0 z-sticky border-t border-border bg-surface/90 backdrop-blur-glass md:hidden',
        // Somebody who asked for less motion should not get a bar sliding in
        // and out of the bottom of every scroll.
        'motion-reduce:transition-none',
        'pb-[env(safe-area-inset-bottom)]',
        'transition-transform duration-300 ease-out',
        hidden ? 'translate-y-full' : 'translate-y-0',
        // A bar translated off the bottom of the screen is still IN the page:
        // its four links keep their tab stops and stay in the accessibility
        // tree, so tabbing from the last visible control jumped to a nav
        // nobody could see. `pointer-events-none` matters too — the transform
        // leaves its hit area reachable in some engines during the slide.
        hidden && 'pointer-events-none',
        className,
      )}
    >
      <ul className="flex items-stretch justify-around">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-bottom-nav flex-col items-center justify-center gap-1 text-caption transition-colors duration-fast ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex h-7 items-center justify-center rounded-full px-4 transition-colors duration-fast ease-out',
                    active
                      ? 'bg-[#fde047] text-neutral-900 font-semibold dark:bg-amber-400/40 dark:text-amber-100'
                      : 'bg-transparent',
                  )}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Exported for the unit test — see the prefix-match note above. */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
