'use client';

import * as React from 'react';

/**
 * THE LIGHTING. One light source, one set of `<defs>`, shared by every drawn
 * object in this folder.
 *
 * ── WHY THIS FILE EXISTS: THE SET WAS FLAT AND SAID IT WAS NOT ────────────
 *
 * `clay.tsx`'s own docstring listed the four moves that make an icon read as a
 * modelled solid — volume, a specular, ambient occlusion, rounded everything —
 * and then applied them to the TILE while every glyph on top stayed a
 * lucide-weight outline (`fill="none" stroke="…" strokeWidth="2.6"`). A flat
 * white line drawing on a lit rectangle is a flat white line drawing, so the
 * whole set read as line-icons-on-gradient-squircles. Two of the four moves
 * were also not doing what they claimed:
 *
 *  - the "specular highlight" was a wash over the ENTIRE body (0.42 → 0 by
 *    55%), which is a two-tone flat tile rather than a light catching a curve;
 *  - the "ambient occlusion pool" sat at x=9 y=34 w=30 h=8, INSIDE the body's
 *    own footprint (x=5 y=4 w=38 h=38) and painted FIRST — so the body covered
 *    all but a few units of blur. A contact shadow that the object is standing
 *    on top of is not a contact shadow.
 *
 * The fix is not more gradient on the tile. It is: shade the SUBJECT, put the
 * contact shadow OUTSIDE the footprint it belongs to, and make the highlight
 * small enough to read as a highlight. Those are three shapes and one filter,
 * and they are here rather than copied into four files because a set lit from
 * four slightly different directions is exactly how an illustration set stops
 * looking like one system.
 *
 * ── ONE LIGHT DIRECTION, HELD EVERYWHERE: UPPER-LEFT ─────────────────────
 *
 * Every gradient below runs along the same axis — from the top-left corner of
 * the drawing to `(0.85 · width, height)`. That single decision is what makes a
 * clay category tile, a 96px spot and a 160px scene look like photographs of
 * objects on the same table: the highlight is always on the upper-left face,
 * the terminator always falls to the lower-right, and the contact shadow always
 * pools down and slightly right of the form.
 *
 * ── `userSpaceOnUse`, AND IT IS NOT A STYLE PREFERENCE ───────────────────
 *
 * The gradients that paint STROKES are declared in `userSpaceOnUse`, not the
 * default `objectBoundingBox`. Per the SVG spec, a gradient in bounding-box
 * units on an element whose bbox has zero width or height IS NOT RENDERED — the
 * element vanishes. Half the glyphs in this set contain a single-axis subpath
 * (`M24 32v5`, `M13 21h4`), so painting them through a bounding-box gradient
 * would silently delete them. This codebase has already shipped one control
 * that emitted nothing because a name resolved to nothing; a light source is
 * not worth a second one.
 *
 * User space has the better physics anyway: one light over the whole drawing,
 * so an object at the bottom of a scene is shaded by WHERE IT IS rather than
 * re-lit from its own private corner.
 *
 * The two radial gradients (`spec`, `ground`) stay in bounding-box units,
 * because they are only ever applied to an ellipse — which cannot have a
 * zero-area bbox — and they have to scale with the shape they soften.
 *
 * ── TOKENS ONLY, AND ONE HUE PER TONE ────────────────────────────────────
 *
 * A tone is ONE token, not a two-stop ramp. The old set ran
 * violet-400 → pink-500 and violet-600 → violet-800 for all eleven pictures,
 * which styles/tokens.css had already retired: pink is "RETIRED from the
 * semantic layer", violet is "now the WAYFINDING accent, not the primary
 * action", and `--gradient-brand` was retuned to "stop shouting". The
 * illustrations were the last surface still wearing the loud old brand on a
 * warm cream page — `results-empty.tsx` had already diagnosed it as "a violet
 * bruise" and patched its own halo.
 *
 * Volume now comes from the LIGHT rather than from a second hue, which is why
 * one token is enough and why the whole set cannot drift into a gradient
 * nobody chose. Every tone below is theme-INDEPENDENT (a primitive or one of
 * the `*-strong` pairs, none of which `.dark` remaps) because the thing behind
 * a white glyph must not lighten when the page does — the same reason
 * `--on-gradient` does not flip.
 *
 * Each one carries white ink at 4.6:1 or better, computed rather than
 * eyeballed, so a glyph stays legible on it in both themes:
 *
 *   neutral   ink-700         7.50    the default: warm, quiet, not a hue
 *   ink       ink-900        16.06    near-black — night, and the base ramp
 *   accent    violet-700      7.10    the WAYFINDING violet, used sparingly
 *   indigo    indigo-600      6.29    the Royal gradient's second stop
 *   positive  success-strong  8.02
 *   caution   warning-strong  8.48    deep burnt orange, NOT amber-on-white
 *   critical  error-strong    7.54
 *   info      info-strong     7.48
 *   graphite  slate-700      10.30
 *   magenta   pink-600        4.61    the one surviving pink, for comedy
 *   amber     butter-800      9.34    the warm cream ramp's deep step
 */
export const ILLO_TONES = {
  neutral: 'ink-700',
  ink: 'ink-900',
  accent: 'violet-700',
  indigo: 'indigo-600',
  positive: 'success-strong',
  caution: 'warning-strong',
  critical: 'error-strong',
  info: 'info-strong',
  graphite: 'slate-700',
  magenta: 'pink-600',
  amber: 'butter-800',
} as const;

export type IlloTone = keyof typeof ILLO_TONES;

/** The body colour for a tone, falling back to the quiet default rather than
 *  to nothing — an unknown token name resolves to an empty paint, which is the
 *  silently-invisible failure this folder is careful about. */
export function toneFill(tone: IlloTone): string {
  return `rgb(var(--${ILLO_TONES[tone] ?? ILLO_TONES.neutral}))`;
}

export type DepthIds = {
  /** Body shading: a faint lit edge, then the terminator falling to the shade. */
  volume: string;
  /** The lit rim along the upper-left edge — the strongest single 3D cue. */
  rim: string;
  /** The one small, true specular. Applied to an ellipse, never to the body. */
  spec: string;
  /** The glyph's own light-consistent white ramp. */
  ink: string;
  /** A soft pool, for a contact shadow OUTSIDE the form's footprint. */
  ground: string;
  /** Offsets the glyph's shadow onto the surface below it, so it reads raised. */
  cast: string;
};

/**
 * Per-instance ids for the lighting.
 *
 * SVG `<defs>` ids are DOCUMENT-global, and eight clay tiles render on the
 * homepage at once — with hard-coded ids every tile after the first silently
 * adopts the first one's lighting. `useId` is React's answer and is SSR-stable:
 * the same trap `clay.tsx`, `spots.tsx`, `brand-mark.tsx` and `sign-in-art.tsx`
 * each document, which only ever shows up once more than one is on screen.
 */
export function useDepthIds(scope: string): DepthIds {
  const id = React.useId();
  return React.useMemo(
    () => ({
      volume: `${id}-${scope}-volume`,
      rim: `${id}-${scope}-rim`,
      spec: `${id}-${scope}-spec`,
      ink: `${id}-${scope}-ink`,
      ground: `${id}-${scope}-ground`,
      cast: `${id}-${scope}-cast`,
    }),
    [id, scope],
  );
}

/**
 * The lighting itself. Render inside an `<svg>`'s `<defs>`.
 *
 * `width`/`height` are the host viewBox's extent, because the stroke-safe
 * gradients are in user space (see the note above) and therefore have to know
 * how far across the drawing the light travels. `scale` is how many user units
 * one "unit of depth" is worth in that box — 1 for the 48-unit clay tile, 2 for
 * a 96-unit spot — so a cast shadow is the same visual weight at every rung
 * instead of vanishing in the big boxes and swamping the small ones.
 */
export function DepthDefs({
  ids,
  width,
  height,
  scale = 1,
}: {
  ids: DepthIds;
  width: number;
  height: number;
  scale?: number;
}) {
  const axis = { x1: 0, y1: 0, x2: width * 0.85, y2: height };

  return (
    <>
      {/* BODY SHADING. Mostly shade, deliberately: a broad light wash over the
          whole form is what made the old tiles read two-tone and flat. The
          light in this set comes from the rim and the specular below — this
          gradient's job is the TERMINATOR, the fall-off that tells the eye the
          surface is curving away. The two zero-opacity stops in the middle are
          a pair on purpose: interpolating from a transparent white to a
          transparent black keeps the mid-tone honest instead of dragging a grey
          band through the middle of the form. */}
      <linearGradient id={ids.volume} gradientUnits="userSpaceOnUse" {...axis}>
        <stop offset="0%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.16" />
        <stop offset="36%" stopColor="rgb(var(--on-gradient))" stopOpacity="0" />
        <stop offset="56%" stopColor="rgb(var(--overlay))" stopOpacity="0" />
        <stop offset="100%" stopColor="rgb(var(--overlay))" stopOpacity="0.34" />
      </linearGradient>

      {/* THE LIT RIM. Stroked on the body's own outline, bright where the light
          strikes and gone by a third of the way across. One hairline of light
          along a curved edge does more for "this is a solid" than any amount of
          fill gradient, because it is the thing a photograph of a matte object
          actually has. */}
      <linearGradient id={ids.rim} gradientUnits="userSpaceOnUse" {...axis}>
        <stop offset="0%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.5" />
        <stop offset="34%" stopColor="rgb(var(--on-gradient))" stopOpacity="0" />
      </linearGradient>

      {/* THE SPECULAR — small, soft, and on the upper-left face only. Bounding-
          box units so one declaration serves a highlight of any size; only ever
          applied to an ellipse, which cannot degenerate. */}
      <radialGradient id={ids.spec}>
        <stop offset="0%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.5" />
        <stop offset="70%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.08" />
        <stop offset="100%" stopColor="rgb(var(--on-gradient))" stopOpacity="0" />
      </radialGradient>

      {/* THE CONTACT POOL. A radial gradient rather than a blurred rectangle:
          it is softer, it scales with whatever ellipse it is painted on, and it
          costs no filter region at all — which matters when eight of these are
          on one page in front of the LCP. */}
      <radialGradient id={ids.ground}>
        <stop offset="0%" stopColor="rgb(var(--overlay))" stopOpacity="0.34" />
        <stop offset="65%" stopColor="rgb(var(--overlay))" stopOpacity="0.12" />
        <stop offset="100%" stopColor="rgb(var(--overlay))" stopOpacity="0" />
      </radialGradient>

      {/* THE GLYPH'S OWN SHADING. The object on the tile is lit by the same
          light as the tile, so its far side is dimmer.
          IT BOTTOMS OUT AT 0.84, NOT AT NOTHING, and that number is computed
          rather than chosen: white at 0.84 over `--pink-600` (the LIGHTEST
          tone in the set) composites to 3.49:1 against it, which clears the 3:1
          non-text threshold. Letting the ramp run as dark as it looked good
          would put the shaded half of a glyph at 2.8:1 on the one tone that
          could least afford it. */}
      <linearGradient id={ids.ink} gradientUnits="userSpaceOnUse" {...axis}>
        <stop offset="0%" stopColor="rgb(var(--on-gradient))" stopOpacity="1" />
        <stop offset="100%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.84" />
      </linearGradient>

      {/* THE GLYPH'S CAST SHADOW — the move that lifts the object OFF the plate
          instead of printing it on. One `feDropShadow`, which is a single
          primitive (offset + blur + flood + composite) and therefore cheaper
          than the three-node chain it replaces; it also replaces the plain
          `feGaussianBlur` this set used to declare, so the filter count per
          instance has not gone up. Offset down and right, because the light is
          upper-left. */}
      <filter id={ids.cast} x="-25%" y="-25%" width="160%" height="160%">
        <feDropShadow
          dx={0.7 * scale}
          dy={1.1 * scale}
          stdDeviation={0.9 * scale}
          floodColor="rgb(var(--overlay))"
          floodOpacity="0.38"
        />
      </filter>
    </>
  );
}

/**
 * A contact shadow, drawn where a real one falls: BELOW the form, escaping its
 * footprint, offset a little away from the light.
 *
 * `cy` is meant to sit AT OR PAST the bottom edge of the object it belongs to —
 * that is the whole correction. The pool this replaced was centred four units
 * inside the body it was supposed to be under and painted first, so the body
 * covered it and the only visible shadow was the couple of units of blur that
 * leaked past the edge.
 */
export function ContactShadow({
  cx,
  cy,
  rx,
  ry,
  ground,
  opacity,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  ground: string;
  /** Dial it down where the object is barely lifted (a board on a post). */
  opacity?: number;
}) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={`url(#${ground})`} opacity={opacity} />;
}
