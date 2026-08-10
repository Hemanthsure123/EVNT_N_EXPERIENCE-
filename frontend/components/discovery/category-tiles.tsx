import * as React from 'react';
import Link from 'next/link';
import type { HomepageCategory } from '@/lib/api/cms';
import { CATEGORIES } from '@/lib/discovery/categories';
import { cn } from '@/lib/utils/cn';
import { CategoryScene } from '@/components/illustrations/category-scenes';
import { categoryTint } from './category-tint';
import { Reveal } from './reveal';

/**
 * "What do you feel like today?" — eight SPECIFIC things, each with its own
 * icon from the clay set. No "Browse", no "Explore", no emoji: a tile has to
 * name something a person could actually be in the mood for.
 *
 * ── LABEL AT THE TOP, ARTWORK BELOW IT ────────────────────────────────────
 *
 * The tile is a white card with a hairline border: the words first, then a
 * soft pastel plate carrying the category's clay object. It used to be a
 * horizontal row — 48px icon, label, chevron — which reads as a menu item, and
 * eight menu items in a grid read as a settings screen. Vertical with the
 * artwork given real size reads as a choice, which is what this actually is.
 *
 * THE PLATE'S TINT IS THE CATEGORY'S OWN HUE (`category-tint.ts`), keyed off
 * the slug exactly as the artwork is — so an operator renaming a category can
 * never leave a tile whose colour and glyph disagree, and the CMS payload
 * (which carries no `tone`) resolves the same way the bundled lifeboat does.
 *
 * The chevron is gone. The whole tile is the link and it lifts on hover; a
 * right-pointing arrow on a card that has no second destination was chrome
 * standing in for an affordance the card already had.
 *
 * 4×2 at desktop, not 8×1. Eight columns squeezes every tile below the width
 * its description needs, so the row reads as a toolbar rather than as eight
 * considered choices. Two rows of four also mirrors the card grid further down
 * the page, which is what makes the whole column feel aligned.
 *
 * ── ON A PHONE IT IS A DIFFERENT OBJECT, NOT A NARROWER ONE ───────────────
 *
 * The smallest breakpoint in this system is `sm: 640px`, so under 640px every
 * grid falls back to its BASE class — and the base here was `grid-cols-1`. One
 * 358px-wide tile carrying `p-card`, a 64px clay object on a `py-6` plate and a
 * two-line blurb measures ~210px, so eight of them were ~1,800px: four full
 * phone screens to look at eight words.
 *
 * Below `sm` the tile is therefore a COMPACT CHIP — a 48px plate on the left,
 * the label beside it, ~72px tall, two up. Eight of those are ~324px: one
 * comfortable thumb-scroll instead of four screens.
 *
 * `flex-row-reverse` rather than reordering the markup: the label stays FIRST
 * in the DOM (so the link's accessible name still begins with it) while the
 * plate paints on the left, where a scanning eye expects the picture.
 *
 * THE BLURB IS GONE BELOW `sm`, and that is a decision rather than an
 * omission. At 89px of text width it is two or three wrapped lines of "Search
 * 'concert'" — a restatement of the label in worse words, which is exactly the
 * noise the chip is trying to remove. It comes back at `sm`, where the tile is
 * tall enough for it to be read rather than skipped.
 *
 * A Server Component: eight icons and eight links for zero client JS.
 */
/**
 * The browse taxonomy.
 *
 * ── CMS FIRST, CODE AS A LIFEBOAT ─────────────────────────────────────────
 *
 * `categories` comes from `GET /homepage`, which an operator edits with no
 * deploy. The bundled `CATEGORIES` array is used ONLY when that request failed
 * — never as a competing source of truth. Without the fallback a CMS hiccup
 * would leave the front page with no way in at all; with it as a *default* the
 * operator's edits would be silently ignored whenever the network hiccupped.
 * Lifeboat, not co-pilot.
 *
 * Artwork is resolved from the SLUG (`components/illustrations/clay`), not
 * from the CMS's icon name and not from a URL. Same safety property the icon
 * allow-list had — an operator cannot put an unvalidated remote image in front
 * of the LCP — and one better: the glyph, its colour and the plate behind it
 * can no longer disagree, because a single slug picks all three.
 */
export function CategoryTiles({
  categories,
  className,
}: {
  categories?: HomepageCategory[];
  className?: string;
}) {
  const tiles = categories?.length
    ? categories.map((category) => ({
        slug: category.slug,
        label: category.label,
        // ── NO SUBTITLE FROM THE CMS PATH ────────────────────────────────
        // This used to render `Search “concert”`, on the reasoning that no
        // description column exists so the tile should show what it resolves
        // to rather than invent copy. Refusing to invent was right; showing
        // the query string was the wrong alternative. It exposes an
        // implementation detail as product copy, restates the label in worse
        // words, and is the kind of line that makes a page read as scaffolding
        // rather than as a product.
        //
        // The bundled fallback below has real, human blurbs. When the CMS
        // gains a description column it maps to that. Until then a tile is its
        // picture and its name, which is enough — nobody needs "Search
        // 'comedy'" under a tile labelled Comedy.
        blurb: '',
      }))
    : CATEGORIES.map((category) => ({
        slug: category.slug,
        label: category.label,
        blurb: category.blurb,
      }));

  return (
    <ul
      className={cn('grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4', className)}
    >
      {tiles.map((category, index) => {
        const tint = categoryTint(category.slug);
        return (
          <li key={category.slug}>
            <Reveal delayMs={Math.min(index, 5) * 60} className="h-full">
              <Link
                href={`/categories/${category.slug}`}
                className={cn(
                  'group flex h-full items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm',
                  // The chip below `sm`, the considered card from `sm` up. One
                  // element, two shapes — see the note above.
                  'flex-row-reverse sm:flex-col sm:items-stretch sm:gap-4 sm:p-card',
                  'transition duration-base ease-spring hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg',
                  // Press cancels the lift and scales in — the beat the whole
                  // landing page was missing. See `discovery/cta.tsx`.
                  'active:translate-y-0 active:scale-[0.98] active:duration-fast',
                  'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                {/* The words come first, and the accessible name therefore
                    still STARTS with the category label — the artwork beside
                    it is decorative and contributes nothing to it. */}
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
                  <span className="text-body-sm font-semibold leading-tight text-foreground sm:text-body-lg">
                    {category.label}
                  </span>
                  {/* Absent rather than empty when there is no blurb — an empty
                      span still costs the parent's `gap-1` and would push the
                      artwork band down on the CMS-backed tiles only, so a row
                      would line up inconsistently for no visible reason. */}
                  {category.blurb ? (
                    <span className="hidden text-caption text-muted-foreground sm:line-clamp-2">
                      {category.blurb}
                    </span>
                  ) : null}
                </span>

                {/* The pastel plate. A 48px square beside the label on a phone;
                    from `sm` a full-width band, with `mt-auto` so tiles whose
                    blurb wraps to two lines still line their artwork up across
                    the row. */}
                <span
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center rounded-lg',
                    'sm:mt-auto sm:h-auto sm:w-full sm:py-6',
                    tint.surface,
                  )}
                  aria-hidden
                >
                  {/* A SCENE, not a glyph on a plate. The clay icon that used
                      to sit here was a rounded square with a symbol on it —
                      which is the app-icon idiom, and a grid of eight read as
                      emoji rather than as illustration. See
                      `illustrations/category-scenes.tsx`. */}
                  <CategoryScene
                    slug={category.slug}
                    className="h-12 w-full transition-transform duration-base ease-spring group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100 sm:h-24"
                  />
                </span>
              </Link>
            </Reveal>
          </li>
        );
      })}
    </ul>
  );
}
