'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { categorySceneFor } from './category-scenes';

/**
 * POSTER ART — full-frame card artwork for an event with no photograph.
 *
 * ── THE PROBLEM IT SOLVES ─────────────────────────────────────────────────
 *
 * A poster-less card used to render one small clay icon centred on a pastel
 * tint. Correct as a single card and wrong as a GRID: twenty poster-less
 * events produced twenty identical icons on twenty identical fields, which
 * reads as a page that failed to load rather than as a set of designed cards.
 * Real catalogues are mostly poster-less early on, so this is the common case,
 * not the fallback case.
 *
 * This fills the whole frame instead — a composed scene with depth, in the
 * category's own colours, with the clay object as its hero.
 *
 * ── IT VARIES PER EVENT, DETERMINISTICALLY ────────────────────────────────
 *
 * The composition is driven by a hash of the event's id: the bloom moves, the
 * background shapes rotate and shift, the horizon rises or falls. So a grid
 * reads as a set of related covers rather than a repeated tile.
 *
 * It MUST be a hash and not `Math.random()`. This renders on the server and
 * again in the browser, and a random layout would differ between the two — a
 * hydration mismatch, which React resolves by throwing the server's HTML away
 * and re-rendering, on the single most numerous component on the page.
 *
 * ── AND IT NEVER PRETENDS TO BE A PHOTOGRAPH ──────────────────────────────
 *
 * Abstract shapes and one modelled object. No stock crowd, no invented venue,
 * no AI-looking artwork that a customer might read as a picture OF this event —
 * which on a ticketing site is the same class of fabrication as a rating with
 * nothing behind it. It is unmistakably a designed cover for an event whose
 * organiser has not uploaded artwork yet.
 *
 * ── NOTHING HERE ANIMATES ─────────────────────────────────────────────────
 *
 * Twenty cards in a grid, each with a drifting element, is a page that will not
 * sit still. The spot set's one-slow-move rule is for a single decorative mark
 * beside a heading, not for a repeating tile.
 */

/**
 * A small, stable hash. FNV-1a — chosen because it is a few lines, has no
 * dependencies and distributes short uuid-ish strings well enough for picking
 * between a handful of layouts.
 */
function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return Math.abs(value);
}

/**
 * Four compositions. Enough that a screenful of cards does not visibly repeat,
 * few enough that each was actually art-directed rather than generated.
 *
 * Every value is a viewBox coordinate in a 300×400 (3:4) frame — the same
 * aspect the card's poster box uses, so the art is never letterboxed.
 */
const LAYOUTS = [
  // Arc rising behind the hero — the default, and the most "cover"-like.
  { bloomX: 0.72, bloomY: 0.22, horizon: 268, arcY: 250, arcR: 132, tilt: -8, bars: [0, 1, 2] },
  // Low horizon, hero high, bloom left.
  { bloomX: 0.24, bloomY: 0.3, horizon: 300, arcY: 286, arcR: 108, tilt: 6, bars: [1, 2] },
  // Tall arc, hero centred, bloom top-centre.
  { bloomX: 0.5, bloomY: 0.14, horizon: 250, arcY: 232, arcR: 150, tilt: 0, bars: [0, 2] },
  // Bloom bottom-right, compressed arc — reads as a night shot.
  { bloomX: 0.78, bloomY: 0.68, horizon: 288, arcY: 272, arcR: 118, tilt: 10, bars: [0, 1] },
] as const;

/** Where the three background bars sit. Fixed, so a layout picks a subset. */
const BAR_POSITIONS = [
  { x: 26, w: 54, h: 96 },
  { x: 96, w: 40, h: 148 },
  { x: 226, w: 48, h: 118 },
] as const;

export function EventPosterArt({
  /** Category slug — drives the colour family and the hero object. */
  slug,
  /** Anything stable and per-event. The event id is ideal. */
  seed = '',
  className,
}: {
  slug: string;
  seed?: string;
  className?: string;
}) {
  // SVG <defs> ids are DOCUMENT-global, and this component appears twenty times
  // on a browse page — the exact case where hard-coded ids mean nineteen cards
  // silently adopt the first one's gradient.
  const uid = React.useId();
  const ids = {
    field: `${uid}-field`,
    bloom: `${uid}-bloom`,
    arc: `${uid}-arc`,
    gloss: `${uid}-gloss`,
    shade: `${uid}-shade`,
  };

  const layout = LAYOUTS[hash(seed || slug) % LAYOUTS.length];
  const Hero = categorySceneFor(slug);

  // The category pastel and its deep partner. Both flip with the theme, so a
  // poster-less card is legible in dark mode without a second set of art.
  const tint = slug ? `--tint-${slug}` : '--muted';
  const ink = slug ? `--tint-${slug}-ink` : '--foreground-subtle';

  return (
    <div className={cn('relative size-full overflow-hidden', className)} aria-hidden>
      <svg
        viewBox="0 0 300 400"
        role="presentation"
        aria-hidden
        preserveAspectRatio="xMidYMid slice"
        className="size-full"
      >
        <defs>
          {/* The field: the category pastel, deepening toward the bottom so the
              card has a direction of light rather than a flat wash. */}
          <linearGradient id={ids.field} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0%" stopColor={`rgb(var(${tint}))`} />
            <stop offset="100%" stopColor={`rgb(var(${ink}))`} stopOpacity="0.22" />
          </linearGradient>

          {/* A soft bloom, positioned by the layout. This is what makes four
              compositions read as four different covers rather than one image
              with the furniture moved. */}
          <radialGradient id={ids.bloom} cx={layout.bloomX} cy={layout.bloomY} r="0.62">
            <stop offset="0%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.5" />
            <stop offset="55%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.1" />
            <stop offset="100%" stopColor="rgb(var(--on-gradient))" stopOpacity="0" />
          </radialGradient>

          {/* The arc behind the hero — the one saturated shape. */}
          <linearGradient id={ids.arc} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor={`rgb(var(${ink}))`} stopOpacity="0.9" />
            <stop offset="100%" stopColor={`rgb(var(${ink}))`} stopOpacity="0.55" />
          </linearGradient>

          <linearGradient id={ids.gloss} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.28" />
            <stop offset="60%" stopColor="rgb(var(--on-gradient))" stopOpacity="0" />
          </linearGradient>

          {/* Grounding shadow under the hero, so it sits ON the arc rather than
              floating over it. */}
          <radialGradient id={ids.shade}>
            <stop offset="0%" stopColor="rgb(var(--overlay))" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(var(--overlay))" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="300" height="400" fill={`url(#${ids.field})`} />
        <rect width="300" height="400" fill={`url(#${ids.bloom})`} />

        {/* Background bars — a skyline/stage-flat read, deliberately abstract.
            Subset chosen by the layout, so the silhouette differs per event. */}
        <g opacity="0.18">
          {layout.bars.map((index) => {
            const bar = BAR_POSITIONS[index];
            return (
              <rect
                key={index}
                x={bar.x}
                y={layout.horizon - bar.h}
                width={bar.w}
                height={bar.h}
                rx="10"
                fill={`rgb(var(${ink}))`}
              />
            );
          })}
        </g>

        {/* The arc. Clipped by the frame at the bottom, which is what stops it
            reading as a circle sitting on a background. */}
        <circle
          cx="150"
          cy={layout.arcY}
          r={layout.arcR}
          fill={`url(#${ids.arc})`}
          transform={`rotate(${layout.tilt} 150 ${layout.arcY})`}
        />
        <circle cx="150" cy={layout.arcY} r={layout.arcR} fill={`url(#${ids.gloss})`} />

        {/* The horizon the whole composition sits on. */}
        <rect
          x="0"
          y={layout.horizon}
          width="300"
          height={400 - layout.horizon}
          fill={`rgb(var(${ink}))`}
          opacity="0.28"
        />

        <ellipse cx="150" cy={layout.arcY + 58} rx="86" ry="16" fill={`url(#${ids.shade})`} />
      </svg>

      {/* The scene, layered over the field rather than inlined into it.
          `categorySceneFor` returns a self-contained illustration with its own
          viewBox, lighting defs and per-instance ids — nesting one inside
          another svg's coordinate system would mean rewriting it to accept a
          transform, and this composes the two without touching the set.

          It sits low and wide because a scene has a horizon: centring it the
          way a single object was centred would float the ground line in the
          middle of the card. */}
      <div className="absolute inset-x-0 bottom-0 top-1/4 flex items-end justify-center">
        <Hero className="h-full w-full" />
      </div>
    </div>
  );
}
