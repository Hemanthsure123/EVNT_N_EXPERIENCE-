'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CATEGORIES, type CategorySlug } from '@/lib/discovery/categories';
import { ClayIcon } from '@/components/illustrations/clay';
import { cn } from '@/lib/utils/cn';
import { useNavItemClass } from './nav-rail';
import { useRouteTransition } from './route-transition';

/**
 * The soft pastel disc behind each clay icon — the same treatment the category
 * TILES use, one size down, so the menu and the page a visitor lands on read as
 * the same object.
 *
 * Spelled out rather than built as `` `bg-tint-${slug}` ``: Tailwind scans
 * source text for complete class names, and an interpolated one is simply never
 * generated. Both halves of each pair are contrast-checked in tokens.css and
 * both flip with the theme.
 */
const TINT_CLASS: Record<CategorySlug, string> = {
  concerts: 'bg-tint-concerts',
  comedy: 'bg-tint-comedy',
  workshops: 'bg-tint-workshops',
  sports: 'bg-tint-sports',
  festivals: 'bg-tint-festivals',
  nightlife: 'bg-tint-nightlife',
  'food-drink': 'bg-tint-food-drink',
  tech: 'bg-tint-tech',
};

/**
 * The header's one menu: every category, plus the two destinations the nav
 * drops at narrow widths.
 *
 * ── IT IS THE COMPLETE INDEX, WHICH IS WHY THE BAR CAN BE SHORT ───────────
 *
 * The nav thins out by breakpoint (`site-header.tsx` owns the budget). That is
 * only acceptable because everything it drops is in here — "All events" and
 * "Browse by city" are in the footer row for exactly the widths where those
 * pills are gone. Trimming a nav to fit is a layout decision; making a
 * destination unreachable is a product one, and this menu is what keeps the
 * first from becoming the second.
 *
 * ── CLICK, NOT HOVER ──────────────────────────────────────────────────────
 *
 * A hover-opened menu has no equivalent on a touch screen and fires on the way
 * past for anyone using a pointer imprecisely. Radix's Popover is press-driven,
 * focus-trapped and Escape-closable for free; the chevron is the affordance
 * that says so.
 */
export function CategoriesMenu({ active }: { active: boolean }) {
  const [open, setOpen] = React.useState(false);
  const applyClass = useNavItemClass();
  const { onNavigate } = useRouteTransition();

  const go = (event: React.MouseEvent<HTMLElement>, href: string) => {
    setOpen(false);
    onNavigate(event, href);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-nav-active={active ? 'true' : undefined}
        className={applyClass(active, 'hidden md:inline-flex')}
      >
        Categories
        <ChevronDown
          className={cn(
            'size-3.5 transition-transform duration-base ease-spring motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        // Wide enough that no blurb truncates — a description clipped to
        // "Arenas, amphitheatres and intim…" is worse than none, because it
        // costs a line and still doesn't finish the sentence. Capped against
        // the viewport as well as sized: at 768px a fixed panel this wide
        // would hang off the right edge.
        className="w-[38rem] max-w-[calc(100vw-2rem)] p-2"
      >
        <p className="px-2 pb-1.5 pt-1 text-label uppercase tracking-wide text-foreground-subtle">
          Browse by category
        </p>

        <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
          {CATEGORIES.map((category) => (
            <li key={category.slug}>
              <Link
                href={`/categories/${category.slug}`}
                onClick={(event) => go(event, `/categories/${category.slug}`)}
                className="group flex items-center gap-3 rounded-lg p-2 transition-colors duration-fast ease-out hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* ── THE ARTWORK, AT A SIZE THAT READS AS ARTWORK ──────────
                    A 28px illustration inside a 40px plate was reported as
                    "no illustrations", and that reading was correct: the clay
                    set is modelled — gradients, a specular highlight, a cast
                    shadow — and none of it survives at 28px. It rendered as a
                    flat glyph on a coloured square, which is exactly what it
                    was built not to be.

                    56px plate, 40px object. The lighting is now visible, and
                    it is the same artwork at the same relative scale as the
                    homepage tiles and the category banner — one object per
                    category across the whole product.

                    Hover LIFTS rather than only scaling: a modelled object
                    rising off its plate is the movement that matches how it
                    is drawn, and the shadow it already casts does the rest. */}
                <span
                  className={cn(
                    'inline-flex size-14 shrink-0 items-center justify-center rounded-2xl',
                    'transition-shadow duration-base ease-spring group-hover:shadow-md',
                    'motion-reduce:transition-none',
                    TINT_CLASS[category.slug],
                  )}
                  aria-hidden
                >
                  <ClayIcon
                    slug={category.slug}
                    className={cn(
                      'size-10 transition-transform duration-base ease-spring',
                      'group-hover:-translate-y-0.5 group-hover:scale-105',
                      'motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 motion-reduce:group-hover:scale-100',
                    )}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-body-sm font-semibold text-foreground">
                    {category.label}
                  </span>
                  <span className="block truncate text-caption font-normal text-muted-foreground">
                    {category.blurb}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {/* The two destinations the bar drops at narrow widths. `text-primary`
            is the WAYFINDING violet — the one place in this panel that is not
            ink — so a link still reads as a link now that the primary action
            colour elsewhere is near-black. */}
        <div className="mt-1.5 flex flex-wrap gap-1 border-t border-border pt-1.5">
          {[
            { href: '/events', label: 'All events' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => go(event, item.href)}
              className="group inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-body-sm font-semibold text-primary transition-colors duration-fast ease-out hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
              <ArrowRight
                className="size-4 transition-transform duration-base ease-spring group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                aria-hidden
              />
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
