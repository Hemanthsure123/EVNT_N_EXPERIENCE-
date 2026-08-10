'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * A compact banner that says what you're looking at, in one screen-inch.
 *
 * Explicitly NOT the home hero. The hero's job is to make you want something;
 * this one's job is to confirm you're in the right place and get out of the
 * way. It is fixed at 224px (240px from `md`) — tall enough to carry a real
 * photograph and a headline, short enough that the first row of results is
 * still on screen when the page loads, which is the entire point of a browse
 * page. (An e2e test holds it between 220 and 260px.)
 *
 * ── IT COUNTS NOTHING, AND BELOW `md` IT IS NOT THERE AT ALL ──────────────
 *
 * Both cuts came out of measuring the browse page on a 390px phone, where the
 * chrome above the first card ran to more than a screen and a half and the page
 * announced its own subject four times over.
 *
 *  1. THE RESULT COUNT IS GONE FROM HERE. It used to be a pill on this
 *     photograph AND the toolbar's summary line, on one screen — and the
 *     toolbar's is the one that is live (`role="status"`, announced as the
 *     results change) and the one sitting beside the controls that change it.
 *     Two copies of a number that moves is how they come to disagree. The
 *     today / free-entry / cities pills went with it: each was a floor over
 *     however many pages happened to be loaded, and the honest home for a facet
 *     count is next to the facet, not stacked on a picture. `resultStats()` and
 *     `countLabel()` are still in lib/discovery/facets.ts, so a real facet bar
 *     can have them back (BACKLOG 12) without reviving this one.
 *  2. IT IS HIDDEN BELOW `md`. results-view.tsx owns that wrapper, because the
 *     gutter around the banner has to disappear with it. On a phone the banner
 *     spent ~256px restating, in a second voice, what the `h1` two inches above
 *     it had already said. From `md` up there is room for it to read as
 *     atmosphere rather than as an obstacle, and the photograph then carries
 *     something the heading genuinely cannot.
 *
 * THE PHOTOGRAPH IS REAL, and it's the top result's own poster — blurred and
 * scaled past the frame so it reads as atmosphere rather than as a competing
 * card. That's a deliberate rejection of two easier options: a stock image
 * (which would depict an event nobody can book) and a flat gradient (which the
 * brief rules out, rightly — it looks like a placeholder because it is one).
 * Using the result set's own artwork means the banner is always literally about
 * what's below it, and it costs no new asset pipeline.
 *
 * ── TWO SKINS, BECAUSE THE TEXT'S BACKGROUND IS TWO DIFFERENT THINGS ──────
 *
 * WITH a poster, the copy sits on a photograph: one scrim and `on-gradient`
 * text — this is one of the very few surfaces where that not-theme-adaptive
 * vocabulary is still correct, because what is behind it is an image rather
 * than the page.
 *
 * WITHOUT one, the copy sits on the PAGE, so it uses the page's own ink on a
 * `bg-sunken` band with a hairline. The old build had no second skin: it
 * painted `.hero-atmosphere` plus a 90/70/40 overlay ramp and put white text on
 * it regardless — a dark violet slab that was the second-largest dark surface
 * in a light-first product, and the only thing under the white text on a
 * result set whose top event has no poster.
 *
 * The vignette and the grain are gone with it. Both are drawn in `--overlay`,
 * and neither was doing anything a single scrim was not already doing better.
 *
 * The backdrop arrives as a SLOT from the server component that owns the data,
 * so the photograph is in the initial HTML instead of waiting on hydration,
 * while the banner itself stays a client component inside `ResultsView`.
 *
 * It never repeats the page's `h1`. An earlier pass had the banner headline set
 * to the same string as the title directly above it, which looked deliberate
 * and said nothing — so the banner takes the SCOPE as a small eyebrow and gives
 * its headline over to what that scope actually is ("Arenas, amphitheatres and
 * intimate gigs"), which is information the header doesn't carry.
 */

export function CategoryBanner({
  eyebrow,
  headline,
  /** Server-rendered `<Image>` for the backdrop, or null for the light band. */
  backdrop,
  className,
}: {
  /** The scope, e.g. "Concerts · Mumbai" — small, above the headline. */
  eyebrow: string;
  /**
   * What this scope IS, in a sentence — optional.
   *
   * The all-events band used to carry "Every upcoming event, soonest first",
   * which restates the ordering the page already applies and the heading
   * already implies. With a real photograph behind it the band does not need a
   * sentence to justify itself, so callers may pass nothing and get a
   * photographic header with its scope named and no filler under it.
   */
  headline?: string;
  backdrop?: React.ReactNode;
  className?: string;
}) {
  const onPhoto = Boolean(backdrop);

  return (
    <section
      aria-label={eyebrow}
      className={cn(
        'relative isolate flex h-56 items-end overflow-hidden rounded-2xl border md:h-60',
        onPhoto ? 'border-transparent' : 'border-border bg-sunken',
        className,
      )}
    >
      {onPhoto ? (
        <>
          <div className="absolute inset-0 -z-10" aria-hidden>
            {/* SHARP, not blurred. It was `blur-lg`, which turned a real
                poster into a coloured smear — the band read as a placeholder
                for an image rather than as an image. A photograph somebody
                uploaded is the most interesting thing available to this
                header; the scrim below is what makes text readable over it,
                which is the job the blur was doing badly. */}
            {backdrop}
          </div>
          {/* One scrim, left-weighted because the copy is left-aligned. It is
              what guarantees the text reads no matter which poster landed. */}
          <div
            className="absolute inset-0 -z-10 bg-gradient-to-r from-overlay/85 via-overlay/65 to-overlay/40"
            aria-hidden
          />
        </>
      ) : null}

      <div className="flex w-full flex-col gap-2 p-card-lg md:p-8">
        <p
          className={cn(
            'text-label uppercase tracking-wide',
            onPhoto ? 'text-on-gradient/75' : 'text-muted-foreground',
          )}
        >
          {eyebrow}
        </p>
        {headline ? (
        <h2
          className={cn(
            'max-w-2xl text-h4 md:text-h3',
            onPhoto ? 'text-on-gradient' : 'text-foreground',
          )}
        >
          {headline}
        </h2>
        ) : null}
      </div>
    </section>
  );
}
