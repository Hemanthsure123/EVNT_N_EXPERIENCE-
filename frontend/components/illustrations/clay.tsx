'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The 3D clay icon system.
 *
 * ── WHAT MAKES AN ICON READ AS "CLAY" ────────────────────────────────────
 *
 * Four things, and all four are needed — two of them alone just look like a
 * flat icon with a shadow:
 *
 *  1. **Volume**: a soft diagonal gradient, light at the top-left where the
 *     light is, saturated at the bottom-right.
 *  2. **A specular highlight**: a small, very soft light shape on the upper
 *     surface. This is what sells "matte solid" over "coloured rectangle".
 *  3. **Ambient occlusion**: a soft dark pool directly under the form, tight
 *     and low-opacity — not a drop shadow offset into the distance.
 *  4. **Rounded everything**: no sharp corner, no hairline stroke. Clay has
 *     no edges, which is why every path here is built from thick round-capped
 *     strokes and generously rounded rectangles rather than from outlines.
 *
 * ── WHY THESE ARE DRAWN, NOT DOWNLOADED ──────────────────────────────────
 *
 * A clay icon set bought as PNGs would be: eight raster files at 3 densities,
 * fixed colours that ignore the theme, and ~200KB in front of the LCP on the
 * busiest page on the platform. Drawn as SVG they are a few hundred bytes
 * each, sharp on any display, and — because every colour resolves through
 * `rgb(var(--token))` — they RESKIN with the brand instead of being pictures
 * of one palette. The design system's no-raw-values rule pushed this the right
 * way: it bans hex in TSX, so tokens were the only option available.
 *
 * ── THE GRADIENT IDS MUST BE UNIQUE PER INSTANCE ─────────────────────────
 *
 * SVG `<defs>` ids are DOCUMENT-global. Eight of these render on the homepage
 * at once; with hard-coded ids every icon after the first would silently adopt
 * the first one's gradient. `useId` is React's answer and is SSR-stable — the
 * same trap `brand-mark.tsx` documents, hit again at eight times the scale.
 *
 * ── SIZE DISCIPLINE: CLAY IS FOR BIG SLOTS ONLY ──────────────────────────
 *
 * These are used at 36px and above — category medallions, empty states, card
 * placeholders. Small functional slots (nav rows, chips, buttons, table cells)
 * keep their lucide line icons, because a soft-shadowed volume at 14px is
 * mud. That split is deliberate and is what keeps the set feeling consistent
 * rather than merely uniform: one language for decoration, one for controls.
 */

/** Token pairs per category, continuous with the gradient each tile already
 *  wore — so this reads as the same product gaining depth, not a re-skin. */
export const CLAY_TONES = {
  concerts: ['violet-500', 'pink-600'],
  comedy: ['pink-500', 'warning'],
  workshops: ['info', 'violet-600'],
  sports: ['success', 'info'],
  festivals: ['pink-500', 'warning'],
  nightlife: ['violet-700', 'pink-600'],
  'food-drink': ['warning', 'destructive'],
  tech: ['violet-600', 'info'],
  neutral: ['violet-500', 'violet-700'],
} as const;

export type ClayTone = keyof typeof CLAY_TONES;

/**
 * The shared shell: the rounded clay tile, its lighting, and its shadow.
 *
 * Every icon is this tile plus a glyph drawn on top in a single light ink, so
 * the eight of them cannot drift apart stylistically — the only thing an icon
 * chooses is its two tone tokens and its glyph geometry.
 */
function ClayTile({
  tone,
  className,
  title,
  children,
}: {
  tone: ClayTone;
  className?: string;
  /** Empty string marks it decorative — the usual case beside a visible label. */
  title?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const [from, to] = CLAY_TONES[tone] ?? CLAY_TONES.neutral;

  const fill = `${id}-fill`;
  const gloss = `${id}-gloss`;
  const soften = `${id}-soften`;

  return (
    <svg
      viewBox="0 0 48 48"
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn('size-10 shrink-0', className)}
    >
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor={`rgb(var(--${from}))`} />
          <stop offset="100%" stopColor={`rgb(var(--${to}))`} />
        </linearGradient>

        {/* The specular highlight: white at the top, gone by the middle. */}
        <linearGradient id={gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.42" />
          <stop offset="55%" stopColor="rgb(var(--on-gradient))" stopOpacity="0" />
        </linearGradient>

        {/* One cheap blur, reused for the occlusion pool. A per-icon
            `feDropShadow` would be a second filter region per instance and
            eight of them on one page is measurable. */}
        <filter id={soften} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>

      {/* Ambient occlusion — tight, low, and UNDER the form. */}
      <rect
        x="9"
        y="34"
        width="30"
        height="8"
        rx="4"
        fill="rgb(var(--overlay))"
        opacity="0.28"
        filter={`url(#${soften})`}
      />

      {/* The body. A superellipse-ish radius is what stops it reading as a
          rounded rectangle and starts it reading as a moulded object. */}
      <rect x="5" y="4" width="38" height="38" rx="13" fill={`url(#${fill})`} />
      <rect x="5" y="4" width="38" height="38" rx="13" fill={`url(#${gloss})`} />

      {/* The glyph, in one light ink so the whole set matches. */}
      <g
        fill="none"
        stroke="rgb(var(--on-gradient))"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.96"
      >
        {children}
      </g>
    </svg>
  );
}

type ClayProps = { className?: string; title?: string };

/* Each glyph is deliberately ONE simple, chunky, closed idea. Clay does not
   render detail — a five-line drawing at this size becomes texture, not an
   icon — so every one of these is the single most recognisable silhouette for
   its category and nothing else. */

export function ClayConcerts({ className, title }: ClayProps) {
  return (
    <ClayTile tone="concerts" className={className} title={title}>
      {/* A quaver: two round note heads and a joined stem. */}
      <circle cx="18" cy="30" r="4" fill="rgb(var(--on-gradient))" stroke="none" />
      <circle cx="30" cy="27" r="4" fill="rgb(var(--on-gradient))" stroke="none" />
      <path d="M22 30V16l12-3v14" />
    </ClayTile>
  );
}

export function ClayComedy({ className, title }: ClayProps) {
  return (
    <ClayTile tone="comedy" className={className} title={title}>
      {/* A handheld mic — the stand-up silhouette, not a studio condenser. */}
      <rect x="20" y="12" width="8" height="14" rx="4" fill="rgb(var(--on-gradient))" stroke="none" />
      <path d="M16 24a8 8 0 0 0 16 0" />
      <path d="M24 32v5" />
    </ClayTile>
  );
}

export function ClayWorkshops({ className, title }: ClayProps) {
  return (
    <ClayTile tone="workshops" className={className} title={title}>
      {/* A paintbrush, NOT a palette. The palette was drawn first and read as
          a face — a blob with two dots on it is a face before it is anything
          else, and no amount of nudging the thumb hole fixed that. A brush is
          one diagonal stroke with a ferrule; it is unmistakable at 36px and it
          does not collide with any other glyph in the set. */}
      <path d="M31 14 20 25" strokeWidth="3.4" />
      <path d="M17 22l6 6-3.5 3.5a4.2 4.2 0 0 1-6-6L17 22Z" strokeWidth="2.4" />
      <path d="M15 33c-1.5 1.5-3.5 1.8-5 1.5.4-1.6.7-3.4 2.2-4.9" strokeWidth="2.2" />
    </ClayTile>
  );
}

export function ClaySports({ className, title }: ClayProps) {
  return (
    <ClayTile tone="sports" className={className} title={title}>
      {/* A cup with handles — reads as "trophy" faster than a medal does. */}
      <path d="M18 13h12v7a6 6 0 0 1-12 0v-7Z" />
      <path d="M18 15h-3v2a4 4 0 0 0 3 4M30 15h3v2a4 4 0 0 1-3 4" />
      <path d="M24 26v5M20 34h8" />
    </ClayTile>
  );
}

export function ClayFestivals({ className, title }: ClayProps) {
  return (
    <ClayTile tone="festivals" className={className} title={title}>
      {/* A tent with a DOORWAY and a pennant. The first attempt was an
          outline triangle with a vertical line down the middle, which is a
          warning sign — the exact wrong thing to put on a category tile. The
          inner inverted-V is the opening, and the little flag at the apex is
          what settles it as "festival" rather than "mountain". */}
      <path d="M24 16 12 34h24L24 16Z" />
      <path d="M20 34l4-9 4 9" />
      <path d="M24 16v-4M24 12l5 2-5 2" strokeWidth="2.2" />
    </ClayTile>
  );
}

export function ClayNightlife({ className, title }: ClayProps) {
  return (
    <ClayTile tone="nightlife" className={className} title={title}>
      {/* A record: outer edge, groove, spindle. */}
      <circle cx="24" cy="24" r="11" />
      <circle cx="24" cy="24" r="4.5" />
      <circle cx="24" cy="24" r="1.4" fill="rgb(var(--on-gradient))" stroke="none" />
    </ClayTile>
  );
}

export function ClayFoodDrink({ className, title }: ClayProps) {
  return (
    <ClayTile tone="food-drink" className={className} title={title}>
      {/* Fork and knife, because a plate at this size is just a circle. */}
      <path d="M19 13v9a3 3 0 0 0 6 0v-9M22 22v13" />
      <path d="M31 13c2 3 2 6 0 9v13" />
    </ClayTile>
  );
}

export function ClayTech({ className, title }: ClayProps) {
  return (
    <ClayTile tone="tech" className={className} title={title}>
      {/* A chip with legs — the one universally read "tech" object. */}
      <rect x="17" y="17" width="14" height="14" rx="4" />
      <path d="M21 13v4M27 13v4M21 31v4M27 31v4M13 21h4M13 27h4M31 21h4M31 27h4" />
    </ClayTile>
  );
}

/** Anything unrecognised. A real object, never a hole — same rule the icon
 *  allow-list already follows for a CMS-authored name nobody mapped. */
export function ClaySparkle({ className, title }: ClayProps) {
  return (
    <ClayTile tone="neutral" className={className} title={title}>
      <path d="M24 13l3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" />
    </ClayTile>
  );
}

/**
 * Slug -> clay icon, mirroring `categoryIcon`'s allow-list.
 *
 * Keyed by SLUG rather than by the CMS's free-text icon name on purpose: the
 * slug is the thing that already decides the tone and the landing page, so an
 * operator renaming an icon can never leave a tile with a mismatched colour
 * and glyph.
 */
const BY_SLUG: Record<string, React.ComponentType<ClayProps>> = {
  concerts: ClayConcerts,
  comedy: ClayComedy,
  workshops: ClayWorkshops,
  sports: ClaySports,
  festivals: ClayFestivals,
  nightlife: ClayNightlife,
  'food-drink': ClayFoodDrink,
  tech: ClayTech,
};

export function clayIconFor(slug: string): React.ComponentType<ClayProps> {
  return BY_SLUG[slug] ?? ClaySparkle;
}

/** The call-site form. Saves every consumer a `const Icon = clayIconFor(...)`
 *  line and keeps the lookup in one place. */
export function ClayIcon({
  slug,
  className,
  title,
}: {
  slug: string;
  className?: string;
  title?: string;
}) {
  const Icon = clayIconFor(slug);
  return <Icon className={className} title={title} />;
}
