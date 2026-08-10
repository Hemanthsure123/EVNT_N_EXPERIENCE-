import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Aurora } from '@/components/discovery/aurora';
import { categoryTint } from '@/components/discovery/category-tint';
import { ClayIcon } from '@/components/illustrations/clay';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/**
 * ── THE CATEGORY BANNER ───────────────────────────────────────────────────
 *
 * What this replaced: a 56px tinted square with a 40px illustration inside it,
 * a heading, a sentence of description and a button — four things stacked in a
 * column, which is a form, not an arrival. Somebody presses a big illustrated
 * tile on the front page and lands on a page whose largest element is the same
 * artwork at a seventh of the size. The transition reads as a downgrade.
 *
 * So the artwork is the banner. It is the SAME illustration resolved from the
 * SAME slug — the tile the visitor pressed and the page it opens are the same
 * picture, at the size the arrival deserves.
 *
 * ── THE COLOUR COMES FROM THE DESIGN SYSTEM, NOT FROM A HEX ───────────────
 *
 * The panel wears the category's own tint token — the one the tiles, the chips
 * and the badges already use — so eight categories are eight recognisable
 * pages without eight bespoke gradients to maintain. `categoryTint` is the one
 * place that mapping lives; a slug with no entry gets the neutral surface
 * rather than an accidental colour.
 *
 * ── THE MOTION IS THE PRODUCT'S OWN, AND IT IS FREE ───────────────────────
 *
 * `Aurora` is the same three-blurred-divs field as the front page: no canvas,
 * no shader, no request, `transform`/`opacity` only, and stopped outright
 * under `prefers-reduced-motion` by the tokens that define it. Reusing it also
 * means this page cannot drift into having its own idea of what the product's
 * background motion looks like.
 *
 * ── NO SUBTITLE ───────────────────────────────────────────────────────────
 *
 * "Stand-up, improv and open mics." sat under the heading and was removed on
 * purpose. It is copy explaining the word above it to somebody who chose that
 * word deliberately one press ago, and the events beneath it describe the
 * category far better than a sentence about it can. District and BookMyShow
 * both put the listings straight under the name for exactly this reason.
 */
export function CategoryHero({
  slug,
  label,
  browseHref,
  count,
}: {
  slug: string;
  label: string;
  browseHref: string;
  /** Rendered as a floor ("24+"), never a total — the list is cursor-paginated
   *  and nothing counts the rest. Omitted entirely when there is nothing. */
  count?: number;
}) {
  const tint = categoryTint(slug);

  return (
    <section
      className={cn(
        'relative isolate overflow-hidden rounded-3xl border border-border',
        tint.surface,
      )}
    >
      <Aurora className="opacity-60" />

      <div className="flex flex-col-reverse items-center gap-6 p-6 sm:p-8 md:flex-row md:items-center md:justify-between md:gap-10 md:p-10">
        <div className="flex min-w-0 flex-col items-center gap-4 text-center md:items-start md:text-left">
          <h1 className={cn('text-h1', tint.ink)}>{label}</h1>
          {count ? (
            <p className={cn('text-body-sm font-medium opacity-80', tint.ink)}>
              {count}+ on sale now
            </p>
          ) : null}
          <Button asChild size="lg">
            <Link href={browseHref}>
              Filter by date, city and price
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>

        {/* The artwork, at banner scale. `aria-hidden` because the heading
            beside it already says which category this is — announcing it
            twice is noise on a screen reader and the illustration carries no
            information the words do not. */}
        <div className="shrink-0" aria-hidden>
          <ClayIcon slug={slug} className="size-32 drop-shadow-sm sm:size-40 md:size-48" />
        </div>
      </div>
    </section>
  );
}
