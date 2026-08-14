'use client';

import * as React from 'react';
import type { PerformerType } from '@/lib/api/performers';
import { cn } from '@/lib/utils/cn';
import { RemoteImage } from '@/components/ui/remote-image';

/**
 * A performer's artwork, and what stands in when there is no photograph.
 *
 * ── WHY THIS EXISTS: AN ACT WITH NO PHOTO WAS A DEAD RECTANGLE ────────────
 *
 * `photo_url` is empty for most acts that have just been approved — a profile
 * can go live with a bio and a price before anybody has uploaded a picture.
 * The card rendered `bg-muted` with the words "No photos yet" centred in it,
 * which on a white page is a grey box: it reads as an image that FAILED TO
 * LOAD, and a grid with three of them reads as a broken page rather than as a
 * marketplace with three acts in it.
 *
 * So the fallback is the same move `components/booking/poster-frame.tsx` makes
 * for an event with no poster: a soft pastel plate keyed to the kind of act,
 * carrying a modelled object drawn in the clay language. It says something
 * TRUE about the listing — the performer type is a real column — instead of
 * reserving space for nothing.
 *
 * ── WHY THE GLYPHS ARE DRAWN HERE AND NOT TAKEN FROM `clay.tsx` ───────────
 *
 * The clay set is keyed by EVENT CATEGORY, and the marketplace's taxonomy is
 * not the catalogue's: there is no category for a dance crew or a magician,
 * and three of the nine performer types (singer, anchor, comedian) would all
 * have collapsed onto the one microphone glyph. Bending nine acts into eight
 * event categories would have put a circuit board on a magician.
 *
 * The CONSTRUCTION is identical, deliberately — the same four moves
 * `clay.tsx` documents (a diagonal gradient for volume, a specular highlight,
 * a tight occlusion pool underneath, rounded everything), the same
 * `rgb(var(--token))` colours in both themes, and `useId` for the gradient ids
 * because SVG `<defs>` ids are document-global and twenty cards render at once.
 * Two files, one illustration language.
 */

/** Token pairs per act, drawn from the same ramps the clay set uses. */
const TONES: Record<PerformerType, readonly [string, string]> = {
  band: ['violet-500', 'pink-600'],
  singer: ['pink-500', 'warning'],
  dj: ['violet-700', 'pink-600'],
  instrumentalist: ['info', 'violet-600'],
  anchor: ['violet-600', 'info'],
  comedian: ['pink-500', 'warning'],
  dance_crew: ['success', 'info'],
  magician: ['violet-700', 'info'],
  other: ['violet-500', 'violet-700'],
};

/**
 * The pastel plate behind the object.
 *
 * Written out as literal class names because Tailwind scans source TEXT — a
 * `bg-tint-${slug}` built at runtime is a class that was never generated. Same
 * reason `components/discovery/category-tint.ts` spells its pairs out.
 */
const PLATE: Record<PerformerType, string> = {
  band: 'bg-tint-concerts',
  singer: 'bg-tint-concerts',
  dj: 'bg-tint-nightlife',
  instrumentalist: 'bg-tint-concerts',
  anchor: 'bg-tint-workshops',
  comedian: 'bg-tint-comedy',
  dance_crew: 'bg-tint-festivals',
  magician: 'bg-tint-nightlife',
  other: 'bg-muted',
};

/** The plate for an act, falling back to a warm neutral rather than a hole. */
export function performerPlate(type: PerformerType | string): string {
  return PLATE[type as PerformerType] ?? PLATE.other;
}

/** The shared tile: body, lighting, shadow. Only the glyph differs per act. */
function ClayShell({
  type,
  className,
  children,
}: {
  type: PerformerType;
  className?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const [from, to] = TONES[type] ?? TONES.other;

  const fill = `${id}-fill`;
  const gloss = `${id}-gloss`;
  const soften = `${id}-soften`;

  return (
    // Always decorative: the act's name and its type are already words on the
    // card beside it, and a screen reader announcing "illustration of a guitar"
    // adds nothing an assistive user can act on.
    <svg viewBox="0 0 48 48" role="presentation" aria-hidden className={cn('size-16', className)}>
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor={`rgb(var(--${from}))`} />
          <stop offset="100%" stopColor={`rgb(var(--${to}))`} />
        </linearGradient>
        <linearGradient id={gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.42" />
          <stop offset="55%" stopColor="rgb(var(--on-gradient))" stopOpacity="0" />
        </linearGradient>
        <filter id={soften} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>

      {/* Ambient occlusion — tight, low, UNDER the form. Without it the tile
          floats, which is the tell of an unfinished illustration. */}
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

      <rect x="5" y="4" width="38" height="38" rx="13" fill={`url(#${fill})`} />
      <rect x="5" y="4" width="38" height="38" rx="13" fill={`url(#${gloss})`} />

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

/* Each glyph is ONE chunky, closed idea, for the reason clay.tsx gives: at
   64px a five-line drawing becomes texture rather than an object. The set was
   chosen so no two acts share a silhouette — three of them would naturally
   have been a microphone, so the singer gets the STAND, the anchor gets the
   handheld with sound coming out of it, and comedy is a laugh rather than a
   piece of equipment. */
const GLYPHS: Record<PerformerType, React.ReactNode> = {
  // A quaver: two round heads and a joined stem.
  band: (
    <>
      <circle cx="18" cy="30" r="4" fill="rgb(var(--on-gradient))" stroke="none" />
      <circle cx="30" cy="27" r="4" fill="rgb(var(--on-gradient))" stroke="none" />
      <path d="M22 30V16l12-3v14" />
    </>
  ),

  // A mic ON A STAND — the vocalist's silhouette, with a base the handheld
  // versions below deliberately do not have.
  singer: (
    <>
      <rect x="20" y="12" width="8" height="13" rx="4" fill="rgb(var(--on-gradient))" stroke="none" />
      <path d="M16 23a8 8 0 0 0 16 0" />
      <path d="M24 31v5M18 36h12" />
    </>
  ),

  // A turntable: platter, spindle, tone arm coming in from the top right.
  dj: (
    <>
      <circle cx="22" cy="27" r="9" />
      <circle cx="22" cy="27" r="2.2" fill="rgb(var(--on-gradient))" stroke="none" />
      <path d="M34 14l-6 8" strokeWidth="2.2" />
      <path d="M28 22l-2.5 3" strokeWidth="3.2" />
    </>
  ),

  // An acoustic guitar on the diagonal: body, sound hole, neck, headstock.
  instrumentalist: (
    <>
      <circle cx="20" cy="30" r="7.5" />
      <circle cx="20" cy="30" r="2.2" fill="rgb(var(--on-gradient))" stroke="none" />
      <path d="M25.5 24.5 33 17" strokeWidth="3.2" />
      <path d="M31.5 15.5l3 3" strokeWidth="2.2" />
    </>
  ),

  // A handheld mic with sound leaving it — a host talks TO a room.
  anchor: (
    <>
      <rect x="15" y="14" width="7" height="12" rx="3.5" fill="rgb(var(--on-gradient))" stroke="none" />
      <path d="M18.5 26v9" />
      <path d="M28 19a7 7 0 0 1 0 11" strokeWidth="2.2" />
      <path d="M32.5 15.5a13 13 0 0 1 0 18" strokeWidth="2.2" />
    </>
  ),

  // A laugh, not a piece of equipment: a speech bubble with a smile in it.
  // The stand-up's microphone belongs to `singer`/`anchor` already, and three
  // microphones in one set is three acts that look the same in a grid.
  comedian: (
    <>
      <path d="M13 19a5 5 0 0 1 5-5h12a5 5 0 0 1 5 5v7a5 5 0 0 1-5 5h-7l-6 5v-5.4A5 5 0 0 1 13 26v-7Z" />
      <path d="M20 21.5a4.5 4.5 0 0 0 8 0" strokeWidth="2.2" />
    </>
  ),

  // A figure mid-move. The arms across the body are what stop it reading as
  // the generic "person" pictogram every empty state already uses.
  dance_crew: (
    <>
      <circle cx="23" cy="14" r="3.4" fill="rgb(var(--on-gradient))" stroke="none" />
      <path d="M23 18.5v8" />
      <path d="M23 26.5l-5 9M23 26.5l6 8" />
      <path d="M16 21l7 2 8-5" strokeWidth="2.4" />
    </>
  ),

  // A top hat and the spark that came out of it.
  magician: (
    <>
      <path d="M16 31h14" strokeWidth="3" />
      <path d="M19 31V16h9v15" />
      <path d="M19 22h9" strokeWidth="2.2" />
      <path d="M34 13l1.3 3.2L38.5 17.5 35.3 18.8 34 22l-1.3-3.2L29.5 17.5l3.2-1.3L34 13Z" strokeWidth="1.8" />
    </>
  ),

  // Anything unrecognised. A real object, never a hole.
  other: <path d="M24 13l3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" />,
};

/** The modelled object for one kind of act. */
export function PerformerArt({ type, className }: { type: PerformerType; className?: string }) {
  return (
    <ClayShell type={type} className={className}>
      {GLYPHS[type] ?? GLYPHS.other}
    </ClayShell>
  );
}

/**
 * A performer's picture, wherever the marketplace shows one.
 *
 * Sizing is the CALLER's: `className` shapes the frame (it is `relative`, so
 * an aspect utility or a fixed size both work) and `artClassName` sizes the
 * clay object, because a 64px avatar and a full-width profile plate want very
 * different glyph sizes.
 *
 * A plain `<img>` rather than `next/image`: the URL comes from a configurable
 * storage adapter, which is not a host that can be declared at build time.
 * That is the same reason the gallery gives.
 */
export function PerformerFrame({
  type,
  photoUrl,
  photoAlt,
  className,
  artClassName,
  imageClassName,
  priority,
}: {
  type: PerformerType;
  photoUrl?: string | null;
  photoAlt?: string;
  className?: string;
  artClassName?: string;
  imageClassName?: string;
  /** Set on the first row only — everything below the fold stays lazy. */
  priority?: boolean;
}) {
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden',
        // The plate is painted even when a photo IS present: it is what shows
        // through while the bytes decode, so a slow connection sees the act's
        // colour rather than a grey hole.
        performerPlate(type),
        className,
      )}
    >
      {photoUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element -- see above. */
        <RemoteImage
          src={photoUrl}
          alt={photoAlt ?? ''}
          loading={priority ? 'eager' : 'lazy'}
          className={cn('size-full object-cover', imageClassName)}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          <PerformerArt type={type} className={artClassName} />
        </span>
      )}
    </div>
  );
}
