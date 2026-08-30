'use client';

import * as React from 'react';
import Link from 'next/link';
import { BrandMark } from '@/components/shell/brand-mark';
import { BRAND_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils/cn';
import { Container } from './container';
import { RouteProgress, RouteTransitionProvider } from './route-transition';

export interface HeaderProps {
  /** Brand slot (defaults to the Curatix lockup, linked home). */
  logo?: React.ReactNode;
  /** Primary nav slot. Supply your own `<nav>` — see the note on the grid. */
  nav?: React.ReactNode;
  /** Search slot (rendered in the centre column on lg+). */
  search?: React.ReactNode;
  /**
   * A full-width row UNDER the bar — the site's search field.
   *
   * A slot rather than a second header component: the sticky positioning, the
   * glass-on-scroll transition and the route-progress bar all belong to one
   * element, and two stacked sticky headers is how you get a 1px seam that
   * only shows up on a scrolled retina screen.
   */
  belowBar?: React.ReactNode;
  /**
   * ── REMOVED, DELIBERATELY: `collapseOnScroll` ─────────────────────────
   *
   * The reference design hides its whole nav row once scrolled, leaving only
   * the search field docked. That was built here and then taken back out,
   * because in THIS header the same row also holds the theme toggle and the
   * ACCOUNT CONTROL — so collapsing it meant a signed-in visitor had no route
   * to their tickets, saved events or sign-out until they scrolled back to
   * the top. A layout that hides the only path to the account menu is not a
   * layout decision, it is a lost affordance dressed up as one.
   *
   * The row still CONDENSES (`h-header-lg` -> `h-header`), which is most of
   * the space the collapse was buying, and the search bar is full-width in
   * both states.
   */
  /** Right-side actions slot, in visual order. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Sticky app header that condenses on scroll (§10.3).
 *
 * ── THE GRID, AND THE BUG IT REPLACES ─────────────────────────────────────
 *
 * This was `grid-cols-[1fr_auto_1fr]` with `min-w-0` on both side columns, on
 * the reasoning that equal side tracks centre the middle one on the container
 * regardless of what the sides hold. That is true, and it is also how the
 * header broke: the middle track was `auto`, sized by a 448px search field,
 * while `min-w-0` let the side tracks shrink BELOW their content. There was no
 * width at which the arithmetic failed loudly — the nav simply overflowed its
 * own column and painted underneath the search field. At 1280 and 1440 "Hire a
 * band" and "More" sat behind it; at 1024 "Hire a band" wrapped onto three
 * lines and "More" was sliced in half. None of it moved
 * `documentElement.scrollWidth`, so the overflow test passed the whole time.
 *
 * The columns are now `[auto minmax(0,1fr) auto]`: the sides are sized by their
 * content and CANNOT shrink below it, and the search absorbs whatever is left.
 * Overlap is no longer a state this layout can reach. The cost is that the
 * search is centred in the space that remains rather than on the container —
 * which is what Airbnb and Stripe both do, and is the correct trade: an
 * optically centred field is worth less than a nav that is never destroyed by
 * one.
 *
 * The other half of the fix lives on the items themselves (`shrink-0`,
 * `whitespace-nowrap` — see `nav-rail.tsx`); a track that refuses to shrink is
 * only half a defence if its contents happily wrap.
 *
 * ── EVERYTHING IN THE ROW HAS TO FIT AT EVERY WIDTH ───────────────────────
 *
 * Which is a budget, not a hope, and it is why the nav thins out by breakpoint
 * rather than scrolling or wrapping. `site-header.tsx` owns those decisions and
 * documents the width each one buys.
 *
 * ── THE BAR IS A SURFACE AT REST, AND GLASS ONCE IT FLOATS ────────────────
 *
 * It used to be `bg-background` with a TRANSPARENT bottom border, which worked
 * only because the old canvas was a violet-tinted off-white and the hero behind
 * it was dark. On a pure white page a borderless white band is not a bar at
 * all — it is the top of the page — so at rest it is now `bg-surface` with a
 * permanent `border-border` hairline. That hairline is the whole "there is
 * chrome here" signal in the light theme, exactly as it is on a card.
 *
 * Once scrolled, content passes UNDERNEATH it, which is the one condition in
 * this shell that earns a backdrop-filter: `.glass` plus a `shadow-md` that
 * says the bar is above the page rather than part of it. Glass is sanctioned
 * HERE and nowhere else in the shell — see the two rules on `.glass` in
 * globals.css.
 */
export function Header({ logo, nav, search, belowBar, actions, className }: HeaderProps) {
  const [scrolled, setScrolled] = React.useState(false);

  const rootRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /**
   * ── PUBLISH THE HEADER'S REAL HEIGHT ────────────────────────────────────
   *
   * Every sticky bar on the site offsets itself by `--sticky-top`, which was
   * arithmetic over `--header-height` — the identity ROW. When the header grew
   * a second row for the search field, that arithmetic did not follow, so the
   * browse page's filter bar pinned ~80px down a ~128px header and sat half
   * behind it.
   *
   * Measuring removes the class of bug rather than this instance of it: the
   * offset now tracks whatever the header actually is, including the condense
   * on scroll and any future row. A `ResizeObserver` rather than a one-off
   * read, because the height changes on scroll, on resize, and when a webfont
   * lands and reflows the row.
   */
  React.useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const publish = () => {
      const height = node.getBoundingClientRect().height;
      if (height > 0) {
        document.documentElement.style.setProperty('--header-total', `${height}px`);
        document.documentElement.style.setProperty('--header-total-lg', `${height}px`);
      }
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <RouteTransitionProvider>
      <header
        ref={rootRef}
        className={cn(
          'sticky top-0 z-sticky border-b transition-[height,background-color,border-color,box-shadow] duration-base ease-out',
          // Glass only once scrolled: at rest there is nothing behind the header
          // to blur, so the filter would be pure cost. See the note on `.glass`.
          scrolled ? 'glass shadow-md' : 'border-border bg-surface',
          className,
        )}
      >
        <Container
          className={cn(
            'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 transition-[height,opacity] duration-base ease-out sm:gap-4 lg:gap-block',
            scrolled ? 'h-header' : 'h-header md:h-header-lg',
          )}
        >
          <div className="flex items-center gap-1 lg:gap-3">
            {logo ?? (
              <Link
                href="/"
                aria-label={`${BRAND_NAME} — home`}
                className="group inline-flex shrink-0 items-center gap-2 rounded-full py-1 pr-2 font-display text-h4 tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {/* `currentColor`, so the mark is the same ink as the wordmark
                    beside it and flips with the theme — see brand-mark.tsx. */}
                <BrandMark
                  title=""
                  className="size-7 transition-transform duration-base ease-spring group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
                <span className="transition-opacity duration-fast ease-out group-hover:opacity-80">
                  {BRAND_NAME}
                  <span className="text-accent">.</span>
                </span>
              </Link>
            )}
            {nav}
          </div>

          {/* Always rendered, even when empty: it is the column that absorbs
              the slack, so removing it would let the actions slide left into
              the nav. */}
          <div className="flex min-w-0 justify-center">
            {search ? <div className="hidden w-full max-w-md lg:block">{search}</div> : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-0.5 sm:gap-1">{actions}</div>
        </Container>

        {belowBar ? <Container className="pb-1.5 pt-0">{belowBar}</Container> : null}

        <RouteProgress />
      </header>
    </RouteTransitionProvider>
  );
}
