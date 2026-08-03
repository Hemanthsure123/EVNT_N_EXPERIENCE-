import * as React from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils/cn';

/**
 * The Curatix mark — a "CX" monogram, drawn as SVG rather than shipped as a
 * raster.
 *
 * ── WHY SVG AND NOT THE PNG ───────────────────────────────────────────────
 *
 * The supplied artwork is a PNG on a black field. Three things follow from
 * that which a vector does not suffer:
 *
 *  1. **Transparency is structural, not edited.** Knocking a background out of
 *     a raster leaves haloed anti-aliased edges wherever the mark meets the
 *     old colour — visible the moment it sits on the light theme's warm
 *     surface. There is nothing to knock out here; the strokes ARE the image.
 *  2. **It is sharp at every size.** The same file serves a 20px header, a
 *     512px PWA icon and a print sheet. A 1024px PNG scaled to 20 is mush and
 *     ~200KB for the privilege; this is under 1KB inline with no request.
 *  3. **It can react to the theme.** The strokes are `currentColor`, so the
 *     header, the footer's tinted band and a disabled state all recolour it
 *     without a second asset.
 *
 * If you want the exact supplied artwork instead, drop it at
 * `frontend/public/curatix-mark.svg` and this component can point at it — but
 * export it as SVG from the source file rather than tracing the PNG.
 *
 * ── THE MARK IS INK NOW, NOT A GRADIENT ───────────────────────────────────
 *
 * It used to be a violet→pink linear gradient, which put the loudest two
 * colours in the palette in the most prominent slot on every page. In a
 * light-first, image-forward product the photography carries the colour and
 * the chrome is quiet, so the strokes are `currentColor` — near-black in the
 * light header, near-white in dark, inherited wherever it is placed. That also
 * retires the `<defs>`/`useId` indirection this file used to need: SVG
 * gradient ids are DOCUMENT-global, so two marks on one page (header + footer,
 * i.e. every page) shared one definition unless each instance minted its own.
 * No gradient, no id, no collision.
 *
 * The one surviving brand colour is the full stop in `BrandLockup` below.
 */
export function BrandMark({
  className,
  title = BRAND_NAME,
}: {
  className?: string;
  /** Empty string marks it decorative, for use beside a visible wordmark. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn('size-7 shrink-0', className)}
    >
      {/* The C: an open ring, drawn as a stroked arc so the counter stays
          crisp at 20px where a filled shape would close up. */}
      <path
        d="M30 12.5a14 14 0 1 0 0 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      {/* The X, overlapping the C's opening exactly as the supplied mark does. */}
      <path
        d="M27 15.5 42 32.5M42 15.5 27 32.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Mark plus wordmark — what the header and the footer render.
 *
 * The word is TEXT, not part of the SVG: it stays selectable, searchable,
 * translatable and legible to a screen reader, and it inherits the type scale
 * instead of being a fixed-size picture of a word.
 *
 * The full stop is the product's ONE decorative use of the wayfinding violet.
 * It was pink-500, which is 3.52:1 on white — below AA for a text glyph, and
 * pink no longer exists in the semantic palette at all. `--accent` is the
 * deeper violet now: 7.10:1 in light, 10.05:1 in dark.
 */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BrandMark title="" />
      <span className="font-display text-h4 tracking-tight">
        {BRAND_NAME}
        <span className="text-accent">.</span>
      </span>
    </span>
  );
}
