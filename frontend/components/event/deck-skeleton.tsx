import * as React from 'react';
import Image from 'next/image';
import {
  EXPANDED_CARD_FRACTION,
  EXPANDED_SNAP_INDEX,
  POSTER_FRACTION,
  SHEET_SNAP_FRACTIONS,
} from '@/lib/discovery/sheet-snap';

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
 * out. A stand-in whose poster height and card top are literals is correct
 * until either constant moves, and then it jumps at exactly the instant the
 * handover is meant to be invisible. That has already happened once in this
 * codebase, which is why `EXPANDED_CARD_FRACTION` was moved into `sheet-snap`
 * to be importable here.
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
   * Without it the cover's title sat about fifty pixels higher than the
   * title it hands over to, so the handover — the one moment this component
   * exists to make invisible — moved the largest text on the screen.
   */
  categoryLabel?: string | null;
}) {
  const cardTop = `${SHEET_SNAP_FRACTIONS[EXPANDED_SNAP_INDEX] * 100}dvh`;
  const posterHeight = `${POSTER_FRACTION * 100}dvh`;
  const sideInset = `${((1 - EXPANDED_CARD_FRACTION) / 2) * 100}vw`;

  return (
    <>
      {/* ── WITHOUT JAVASCRIPT THIS WOULD NEVER COME OFF ──────────────────
          The deck can only open once JS has run, and Next's streaming swap of
          a loading fallback for the resolved page needs it too. So a JS-off
          phone would sit under an opaque black overlay forever. Hidden there,
          it falls back to the desktop skeleton and the desktop page — which is
          exactly what a JS-off phone got before any of this existed. */}
      <noscript>
        <style>{'[data-deck-cover]{display:none!important}'}</style>
      </noscript>
      <div
        data-deck-cover
        // `aria-hidden`: a painted stand-in, for a few hundred milliseconds.
        // The accessible content is the page underneath, which is complete.
        aria-hidden
        className="fixed inset-0 z-modal bg-black sm:hidden"
      >
        {posterUrl ? (
          <div
            className="absolute inset-x-0 top-0 overflow-hidden"
            style={{ height: posterHeight }}
          >
            <Image src={posterUrl} alt="" fill sizes="100vw" className="object-cover" priority />
          </div>
        ) : (
          <div className="absolute inset-x-0 top-0 bg-muted" style={{ height: posterHeight }} />
        )}
        {/* `rounded-t-3xl border-t`, matching the deck's own page exactly. A
            page is the full width of the viewport now, so its side and bottom
            edges are off screen and a full border here would draw a hairline
            the deck does not — visible for the one frame of the handover,
            which is the frame this component exists to make invisible. */}
        <div
          className="absolute overflow-hidden rounded-t-3xl border-t border-border bg-background shadow-deck"
          style={{ top: cardTop, bottom: 0, left: sideInset, right: sideInset }}
        >
          <div className="flex h-11 items-center justify-center">
            <span className="h-1.5 w-12 rounded-full bg-border-strong" />
          </div>
          {/* Every class here mirrors `EventWidgetContent`'s first block —
              `px-4` not `px-5`, `gap-6` not `gap-3`, and the title's own
              `leading-snug tracking-tight`. A stand-in that is four pixels and
              one line-height away from what replaces it is a stand-in that
              announces the swap. */}
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
      </div>
    </>
  );
}

/** The route's loading state on a phone. */
export function DeckSkeleton() {
  return <DeckShell />;
}
