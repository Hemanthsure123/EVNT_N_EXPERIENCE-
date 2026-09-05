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
export function DeckShell({ posterUrl, title }: { posterUrl?: string | null; title?: string }) {
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
        <div
          className="absolute overflow-hidden rounded-3xl border border-border bg-background shadow-deck"
          style={{ top: cardTop, bottom: 0, left: sideInset, right: sideInset }}
        >
          <div className="flex justify-center pb-1 pt-2.5">
            <span className="h-1.5 w-12 rounded-full bg-border-strong" />
          </div>
          <div className="flex flex-col gap-3 px-5 pt-5">
            {title ? (
              <p className="line-clamp-2 text-h3 font-extrabold leading-tight text-foreground">
                {title}
              </p>
            ) : (
              <span className="h-6 w-3/4 rounded-md bg-muted" />
            )}
            <span className="h-4 w-1/2 rounded-md bg-muted" />
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
