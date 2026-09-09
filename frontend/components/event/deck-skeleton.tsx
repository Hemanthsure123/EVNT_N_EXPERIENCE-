import * as React from 'react';
import Image from 'next/image';
import {
  DECK_EDGE_PADDING_PX,
  HERO_ASPECT_H,
  HERO_ASPECT_W,
  HERO_RADIUS_PX,
} from '@/lib/discovery/deck-metrics';

/**
 * The deck's opening frame, as static markup.
 *
 * ── WHY THIS EXISTS TWICE OVER ────────────────────────────────────────────
 *
 * On a phone, `/events/{slug}-{uuid}` resolves into the deck. Two moments on
 * the way there have nothing to show: the route's own loading state, and the
 * gap between first paint and hydration (see `deck-boot.tsx`). Both were
 * showing the DESKTOP event page — which is the one presentation the whole
 * mobile widget exists to replace, appearing for a few hundred milliseconds at
 * the start of every shared link.
 *
 * One component for both, and its geometry is IMPORTED rather than written
 * out. A stand-in whose poster inset and radius are literals is correct until
 * either constant moves, and then it jumps at exactly the instant the handover
 * is meant to be invisible. That has already happened once in this codebase,
 * which is why those numbers live in `lib/discovery/deck-metrics`.
 *
 * `sm:hidden` throughout: above that width the deck does not render and the
 * real page is the right answer.
 */
export function DeckShell({
  posterUrl,
  title,
  categoryLabel,
}: {
  posterUrl?: string | null;
  title?: string;
  /**
   * The category chip the real content leads with, when the event has one.
   *
   * Without it the cover's title sat about fifty pixels higher than the title
   * it hands over to, so the handover — the one moment this component exists to
   * make invisible — moved the largest text on the screen.
   */
  categoryLabel?: string | null;
}) {
  const heroStyle: React.CSSProperties = {
    aspectRatio: `${HERO_ASPECT_W} / ${HERO_ASPECT_H}`,
    borderRadius: HERO_RADIUS_PX,
  };

  return (
    <>
      {/* ── WITHOUT JAVASCRIPT THIS WOULD NEVER COME OFF ──────────────────
          The deck can only open once JS has run, and Next's streaming swap of
          a loading fallback for the resolved page needs it too. So a JS-off
          phone would sit under an opaque overlay forever. Hidden there, it
          falls back to the desktop skeleton and the desktop page — which is
          exactly what a JS-off phone got before any of this existed. */}
      <noscript>
        <style>{'[data-deck-cover]{display:none!important}'}</style>
      </noscript>
      <div
        data-deck-cover
        // `aria-hidden`: a painted stand-in, for a few hundred milliseconds.
        // The accessible content is the page underneath, which is complete.
        aria-hidden
        // `bg-background`, not black. The deck is an ordinary scrolling page
        // now rather than a sheet over an anchored poster, so the whole screen
        // is the page's own surface and a black cover would flash a colour the
        // thing it stands in for never shows.
        className="fixed inset-0 z-modal bg-background sm:hidden"
      >
        <div style={{ padding: DECK_EDGE_PADDING_PX, paddingBottom: 0 }}>
          <div style={heroStyle} className="relative w-full overflow-hidden bg-muted">
            {posterUrl ? (
              <Image src={posterUrl} alt="" fill sizes="100vw" className="object-cover" priority />
            ) : null}
          </div>
        </div>
        {/* Every class here mirrors `EventWidgetContent`'s first block —
            `px-4`, `gap-6`, `pt-4`, and the title's own `leading-snug
            tracking-tight`. A stand-in that is four pixels and one line-height
            away from what replaces it is a stand-in that announces the swap. */}
        <div className="flex flex-col gap-6 px-4 pt-4">
          {categoryLabel ? (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-border bg-muted px-3 py-1 text-caption font-semibold text-muted-foreground">
                {categoryLabel}
              </span>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            {title ? (
              <p className="text-h3 font-extrabold leading-snug tracking-tight text-foreground">
                {title}
              </p>
            ) : (
              <span className="h-7 w-3/4 rounded-md bg-muted" />
            )}
            <span className="h-5 w-1/2 rounded-md bg-muted" />
          </div>
        </div>
      </div>
    </>
  );
}

/** The route's loading state on a phone. */
export function DeckSkeleton() {
  return <DeckShell />;
}
