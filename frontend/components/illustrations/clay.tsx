'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { ContactShadow, DepthDefs, type IlloTone, toneFill, useDepthIds } from './depth';

/**
 * The 3D clay icon system.
 *
 * ── WHAT MAKES AN ICON READ AS "CLAY" ────────────────────────────────────
 *
 * Five things, and the SUBJECT has to get four of them. The first version of
 * this file lit the TILE and left every glyph a `fill="none"` outline at
 * lucide's own stroke weight, which is why the set read as line icons on
 * gradient squircles no matter how carefully the squircle was shaded:
 *
 *  1. **A solid body.** Every glyph below is a FILLED form — an annulus, a
 *     tapered tuft, a plinth — not a stroked path. Where a shape needs a hole
 *     (a tent's doorway, a record's label, a chip's die) the hole is cut with
 *     `fillRule="evenodd"` so the tile shows THROUGH it. A knockout painted in
 *     a background colour would stop being a hole the first time a tile is
 *     drawn on something that is not that colour.
 *  2. **One light direction, upper-left**, held across the icon, the tile and
 *     every other rung of the set. That lives in `depth.tsx`.
 *  3. **A small specular**, on the upper-left face — not a wash over the whole
 *     body, which is a two-tone rectangle.
 *  4. **A cast shadow under the GLYPH**, so the object sits above the plate
 *     rather than being printed on it.
 *  5. **A contact shadow OUTSIDE the body's footprint.** The pool this replaced
 *     was drawn at x=9 y=34 w=30 h=8, inside a body occupying x=5 y=4 w=38
 *     h=38, and painted first — so the body covered it and the shadow move was
 *     very nearly a no-op.
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
 * the first one's gradient. `useDepthIds` (i.e. `useId`) is React's answer and
 * is SSR-stable — the same trap `brand-mark.tsx` documents, hit again at eight
 * times the scale.
 *
 * ── SIZE DISCIPLINE: CLAY IS FOR BIG SLOTS ONLY ──────────────────────────
 *
 * These are used at **36px and above** — category medallions, empty-state
 * badges, card placeholders. Small functional slots (nav rows, chips, buttons,
 * table cells) keep their lucide line icons, because a modelled volume with a
 * specular and a cast shadow at 14px is mud. That split is deliberate and is
 * what keeps the set feeling consistent rather than merely uniform: one
 * language for decoration, one for controls.
 *
 * The floor is enforced by nothing but review, so it is written here and the
 * call sites are listed: `components/discovery/category-tiles.tsx` (56px),
 * `components/shell/categories-menu.tsx` (36px — it was 28px, below the floor,
 * and the row's disc grew rather than the art shrinking further),
 * `components/hire/performer-art.tsx` (36px and up).
 */

/** The clay body, in viewBox units. Named because the contact shadow, the
 *  specular and every glyph's safe area are all derived from it — the old file
 *  hard-coded the same four numbers in three places and the shadow ended up
 *  inside the body it was supposed to be under. */
const BODY = { x: 6, y: 4, size: 36, r: 12 } as const;
const BODY_BOTTOM = BODY.y + BODY.size;

/**
 * Category → tone. ONE token each, drawn from `depth.tsx`'s vocabulary.
 *
 * The old map was eight two-stop ramps built out of violet, pink, warning,
 * info, success and destructive — a palette styles/tokens.css had already moved
 * on from (pink retired from the semantic layer, violet demoted to wayfinding,
 * `--gradient-brand` retuned to "stop shouting"). Volume comes from the light
 * now, so a tone does not need a second hue to look modelled, and the set is
 * warm-led with violet spent only where it means something.
 *
 * The hues mirror the category tints (`--tint-<slug>`) the surrounding pastel
 * plates already use, so a tile and the disc it sits on are the same colour
 * family. They are NOT the `--tint-<slug>-ink` tokens themselves: those flip to
 * a LIGHT value in dark theme, and a white glyph on a light violet is
 * unreadable in exactly the theme nobody screenshots.
 */
export const CLAY_TONES = {
  concerts: 'accent',
  comedy: 'magenta',
  workshops: 'info',
  sports: 'positive',
  festivals: 'caution',
  nightlife: 'ink',
  'food-drink': 'critical',
  tech: 'graphite',
  neutral: 'neutral',
} as const satisfies Record<string, IlloTone>;

export type ClayTone = keyof typeof CLAY_TONES;

/**
 * The shared shell: the clay body, its lighting, its contact shadow, and the
 * lit-and-shaded ink every glyph is drawn in.
 *
 * Exported, because `components/hire/performer-art.tsx` needs exactly this and
 * used to hold a verbatim copy of it — right down to a byte-identical quaver
 * glyph. Two copies of the lighting is two illustration languages one refactor
 * apart, which is the whole failure this folder was consolidated to avoid.
 */
export function ClayTile({
  tone,
  className,
  title,
  children,
}: {
  tone: IlloTone;
  className?: string;
  /** Empty string marks it decorative — the usual case beside a visible label. */
  title?: string;
  children: React.ReactNode;
}) {
  const ids = useDepthIds('clay');

  return (
    <svg
      viewBox="0 0 48 48"
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn('size-10 shrink-0', className)}
    >
      <defs>
        <DepthDefs ids={ids} width={48} height={48} />
      </defs>

      {/* THE CONTACT SHADOW, and note where it is: centred at y=42.5 against a
          body whose bottom edge is y=40, so most of the pool falls OUTSIDE the
          footprint and survives the body being painted over it. Nudged right of
          centre because the light is upper-left. */}
      <ContactShadow cx={25} cy={BODY_BOTTOM + 2.5} rx={15} ry={3.6} ground={ids.ground} />

      {/* The body. A generous radius is what stops it reading as a rounded
          rectangle and starts it reading as a moulded object. */}
      <rect
        x={BODY.x}
        y={BODY.y}
        width={BODY.size}
        height={BODY.size}
        rx={BODY.r}
        fill={toneFill(tone)}
      />
      {/* The terminator: the same geometry, shaded toward the lower right. */}
      <rect
        x={BODY.x}
        y={BODY.y}
        width={BODY.size}
        height={BODY.size}
        rx={BODY.r}
        fill={`url(#${ids.volume})`}
      />
      {/* The lit rim. Half a unit inset so the stroke sits ON the edge rather
          than straddling it, which is what keeps the corner reading as round. */}
      <rect
        x={BODY.x + 0.7}
        y={BODY.y + 0.7}
        width={BODY.size - 1.4}
        height={BODY.size - 1.4}
        rx={BODY.r - 0.7}
        fill="none"
        stroke={`url(#${ids.rim})`}
        strokeWidth="1.4"
      />
      {/* The one true specular. Small, soft, tilted along the light axis, and
          sitting comfortably inside the top-left corner arc (its far edge is
          11.2 units from the corner circle's centre, which has radius 12) so it
          needs no clip path to stay on the body. */}
      <ellipse
        cx="17.5"
        cy="14"
        rx="9"
        ry="6"
        transform="rotate(-28 17.5 14)"
        fill={`url(#${ids.spec})`}
      />

      {/* THE GLYPH. Filled, lit from the same direction as the body, and
          casting its own shadow onto the plate — the three things that make it
          an object on a tile instead of a line drawing over one.
          `fill` and `stroke` both point at the ink ramp, so a glyph part can be
          either without restating the paint; the few genuinely linear parts (a
          trophy handle, a chip leg) set `fill="none"` themselves. */}
      <g filter={`url(#${ids.cast})`}>
        <g
          fill={`url(#${ids.ink})`}
          stroke={`url(#${ids.ink})`}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {children}
        </g>
      </g>
    </svg>
  );
}

type ClayProps = { className?: string; title?: string };

/* Each glyph is deliberately ONE simple, chunky, closed idea. Clay does not
   render detail — a five-line drawing at this size becomes texture, not an
   icon — so every one of these is the single most recognisable silhouette for
   its category and nothing else.

   All of them now live inside the body's safe area (roughly x 12-36, y 8-36),
   because a filled form with a cast shadow needs room for the shadow to land
   on the plate rather than off the edge of it. */

export function ClayConcerts({ className, title }: ClayProps) {
  return (
    <ClayTile tone={CLAY_TONES.concerts} className={className} title={title}>
      {/* A quaver: two tilted note heads under one beamed pair of stems. The
          heads are ellipses rather than circles and they are rotated — a note
          head is an oval on the slant, and two plain circles is the giveaway
          that nobody looked at one. */}
      <ellipse cx="17.5" cy="30.6" rx="5" ry="4" transform="rotate(-20 17.5 30.6)" />
      <ellipse cx="29.5" cy="27.6" rx="5" ry="4" transform="rotate(-20 29.5 27.6)" />
      <path d="M20.6 30.6 V16.6 L34 13.2 V27.6 H31 V17 L23.6 18.8 V30.6 Z" stroke="none" />
    </ClayTile>
  );
}

export function ClayComedy({ className, title }: ClayProps) {
  return (
    <ClayTile tone={CLAY_TONES.comedy} className={className} title={title}>
      {/* A handheld mic — the stand-up silhouette, not a studio condenser. The
          cradle is a filled BAND rather than a stroked arc, so it has a
          thickness the light can fall across. */}
      <rect x="19.9" y="10" width="8.4" height="13" rx="4.2" stroke="none" />
      <path d="M15.5 21 A8.6 8.6 0 0 0 32.7 21 H30 A5.9 5.9 0 0 1 18.2 21 Z" stroke="none" />
      <rect x="22.7" y="28.6" width="2.8" height="5.6" rx="1.4" stroke="none" />
      <rect x="18" y="33.8" width="12.2" height="2.8" rx="1.4" stroke="none" />
    </ClayTile>
  );
}

export function ClayWorkshops({ className, title }: ClayProps) {
  return (
    <ClayTile tone={CLAY_TONES.workshops} className={className} title={title}>
      {/* A paintbrush, NOT a palette. The palette was drawn first and read as
          a face — a blob with two dots on it is a face before it is anything
          else, and no amount of nudging the thumb hole fixed that. A brush is
          one diagonal object with a ferrule; it is unmistakable at 36px and it
          does not collide with any other glyph in the set.
          Drawn upright and rotated -45° about the body's centre, so the handle
          runs INTO the light and the bristles into the shade — the same
          diagonal every other glyph's shading follows. */}
      <g transform="rotate(-45 24 22)" stroke="none">
        <rect x="22.2" y="9.6" width="3.6" height="11.6" rx="1.8" />
        <rect x="21.2" y="20.6" width="5.6" height="3.8" rx="1.1" />
        <path d="M21.5 24.4 H26.5 L25.3 32.4 q-1.3 2.4 -2.6 0 Z" />
      </g>
    </ClayTile>
  );
}

export function ClaySports({ className, title }: ClayProps) {
  return (
    <ClayTile tone={CLAY_TONES.sports} className={className} title={title}>
      {/* A cup with handles — reads as "trophy" faster than a medal does. The
          bowl, the stem and the plinth are solids; only the handles stay
          linear, because a handle IS a piece of wire. */}
      <path d="M17.6 11.4 H30.4 V19 a6.4 6.4 0 0 1 -12.8 0 Z" stroke="none" />
      <path d="M17.6 14.4 h-3.4 a4.2 4.2 0 0 0 3.6 4.6" fill="none" strokeWidth="2.2" />
      <path d="M30.4 14.4 h3.4 a4.2 4.2 0 0 1 -3.6 4.6" fill="none" strokeWidth="2.2" />
      <path d="M22.6 25.2 h2.8 v4.4 h2.6 l1.4 3.2 H17.6 l1.4 -3.2 h3.6 Z" stroke="none" />
      <rect x="16.4" y="33.4" width="15.2" height="2.8" rx="1.4" stroke="none" />
    </ClayTile>
  );
}

export function ClayFestivals({ className, title }: ClayProps) {
  return (
    <ClayTile tone={CLAY_TONES.festivals} className={className} title={title}>
      {/* A tent with a DOORWAY and a pennant. The first attempt was an
          outline triangle with a vertical line down the middle, which is a
          warning sign — the exact wrong thing to put on a category tile.
          The doorway is now a real HOLE (`fillRule="evenodd"`), so the tile's
          own colour shows through it, which is both what an opening looks like
          and the only version that survives being drawn on any surface. */}
      <path d="M24 13 L37 34 H11 Z M24 23.6 L28.8 34 H19.2 Z" fillRule="evenodd" stroke="none" />
      <rect x="23.2" y="7.6" width="1.8" height="6" rx="0.9" stroke="none" />
      <path d="M25 8.2 L30.4 10.4 25 12.6 Z" stroke="none" />
    </ClayTile>
  );
}

export function ClayNightlife({ className, title }: ClayProps) {
  return (
    <ClayTile tone={CLAY_TONES.nightlife} className={className} title={title}>
      {/* A record: a filled annulus with the label cut out of it, one groove,
          and a spindle. The groove is `--overlay` rather than a second ink
          value, so it darkens whatever tone the tile is wearing instead of
          being a grey that only works on one of them. */}
      <path
        d="M24 10.4 a11.6 11.6 0 1 0 0 23.2 a11.6 11.6 0 1 0 0 -23.2 Z
           M24 17.4 a4.6 4.6 0 1 0 0 9.2 a4.6 4.6 0 1 0 0 -9.2 Z"
        fillRule="evenodd"
        stroke="none"
      />
      <circle
        cx="24"
        cy="22"
        r="8.6"
        fill="none"
        stroke="rgb(var(--overlay))"
        strokeWidth="1"
        opacity="0.22"
      />
      <circle cx="24" cy="22" r="1.5" stroke="none" />
    </ClayTile>
  );
}

export function ClayFoodDrink({ className, title }: ClayProps) {
  return (
    <ClayTile tone={CLAY_TONES['food-drink']} className={className} title={title}>
      {/* Fork and knife, because a plate at this size is just a circle. The
          fork's two slots are cut with `evenodd` — three solid prongs would be
          a comb, and the gaps are what make it a fork. */}
      <path
        d="M17.6 11 H26.2 v7.4 a4.3 4.3 0 0 1 -3 4.1 V34.4 a1.3 1.3 0 0 1 -2.6 0 V22.5
           a4.3 4.3 0 0 1 -3 -4.1 Z
           M19.9 12.4 h1.3 v4.8 h-1.3 Z
           M22.6 12.4 h1.3 v4.8 h-1.3 Z"
        fillRule="evenodd"
        stroke="none"
      />
      <path
        d="M30.2 10.8 c2.8 3.4 3.4 6.6 3.4 10 0 2.2 -1 3.4 -2.1 3.8 V34.4
           a1.3 1.3 0 0 1 -2.6 0 V24.6 c-1.1 -0.4 -2.1 -1.6 -2.1 -3.8 0 -3.4 0.6 -6.6 3.4 -10 Z"
        stroke="none"
      />
    </ClayTile>
  );
}

export function ClayTech({ className, title }: ClayProps) {
  return (
    <ClayTile tone={CLAY_TONES.tech} className={className} title={title}>
      {/* A chip with legs — the one universally read "tech" object. The die is
          cut out of the package rather than drawn on it, so the tone shows
          through the window. */}
      <path
        d="M20.6 15.6 H27.4 A5 5 0 0 1 32.4 20.6 V27.4 A5 5 0 0 1 27.4 32.4 H20.6
           A5 5 0 0 1 15.6 27.4 V20.6 A5 5 0 0 1 20.6 15.6 Z
           M21.4 21.4 h5.2 v5.2 h-5.2 Z"
        fillRule="evenodd"
        stroke="none"
      />
      <path
        d="M20.4 12.4 v3.2 M27.6 12.4 v3.2 M20.4 32.4 v3.2 M27.6 32.4 v3.2
           M12.4 20.4 h3.2 M12.4 27.6 h3.2 M32.4 20.4 h3.2 M32.4 27.6 h3.2"
        fill="none"
        strokeWidth="2.2"
      />
    </ClayTile>
  );
}

/** Anything unrecognised. A real object, never a hole — same rule the icon
 *  allow-list already follows for a CMS-authored name nobody mapped. */
export function ClaySparkle({ className, title }: ClayProps) {
  return (
    <ClayTile tone={CLAY_TONES.neutral} className={className} title={title}>
      {/* Concave sides, not a straight-edged four-pointed star: the pinch is
          what makes it read as a sparkle rather than as a compass rose. */}
      <path
        d="M24 12.7 C25.1 19.1 26.9 20.9 33.4 22 26.9 23.1 25.1 24.9 24 31.3
           22.9 24.9 21.1 23.1 14.6 22 21.1 20.9 22.9 19.1 24 12.7 Z"
        stroke="none"
      />
    </ClayTile>
  );
}

/**
 * A LUCIDE GLYPH, ON A CLAY BODY.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `components/organizer/primitives.tsx`'s `EmptyState` takes an `icon` prop,
 * and roughly twenty-six real callers pass a lucide component that carries
 * genuine meaning: a QR code on the check-in screen, a credit card on payments,
 * a bookmark on a saved list. Rendering it as a 20px line glyph in a 40px grey
 * circle threw all of that away visually — every empty state on the organizer
 * dashboard and the admin console looked identical, and looked like the
 * framework's default.
 *
 * The alternative was to drop the prop and draw one generic scene everywhere,
 * which would have thrown the meaning away for real. This keeps it and gives it
 * the set's depth instead: the caller's own glyph, on a modelled body, lit from
 * the same direction as everything else, casting a shadow onto the plate.
 *
 * ── THE GLYPH IS PAINTED FLAT, AND THAT IS DELIBERATE ────────────────────
 *
 * Every drawn glyph in this file takes the `ink` ramp so its far side is
 * shaded. A lucide icon cannot: it renders its own nested `<svg>` with its own
 * viewBox, which RESCALES user space — so a user-space gradient would only
 * cover part of it — and its bounding-box alternative silently renders NOTHING
 * for a single-axis icon (`Minus`, `Equal`) because a zero-area bbox is not
 * paintable. Either way the paint would be wrong or absent. A flat
 * `--on-gradient` fill plus the cast shadow is honest, and the shadow is what
 * was actually doing the lifting.
 */
export function ClayBadge({
  icon: Icon,
  tone = 'neutral',
  className,
  title,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  tone?: IlloTone;
  className?: string;
  title?: string;
}) {
  return (
    <ClayTile tone={tone} className={className} title={title}>
      {/* 24 lucide units centred on the body's own centre (23, 22). Round-capped
          at 2.3 so the weight sits between lucide's default 2 and the drawn
          glyphs' 2.4 — a line icon on a modelled body needs a little more
          presence than it does in a table cell. */}
      <g transform="translate(11 10)">
        <Icon
          stroke="rgb(var(--on-gradient))"
          strokeWidth={2.3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        />
      </g>
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
