'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { FIGURE, Figure } from './figure';

/**
 * SPOTS — small decorative vignettes for section headers and cards.
 *
 * ── THE THIRD SIZE, AND WHY THERE HAD TO BE ONE ──────────────────────────
 *
 * The illustration language had two rungs and a gap between them. `clay.tsx` is
 * a single OBJECT on a tile at 36-48px, for a category medallion or a nav
 * decoration. `scenes.tsx` is a SITUATION with a character in it at 160-320px,
 * for an empty state or an error page. A section header wants neither: a clay
 * tile is an icon and reads as a control, and a full scene with a person in it
 * beside a heading is a picture of somebody having a problem next to something
 * that is going fine.
 *
 * A spot is the rung between them — a small scene with no character narrative,
 * at 96-160px. It decorates, it says what the section is about, and it stops.
 *
 * ── THESE CARRY THE CLAY VOLUME; THE SCENES DELIBERATELY DO NOT ──────────
 *
 * A spot is one object, so the full clay treatment (a diagonal gradient for
 * volume, a specular highlight on the upper surface, a tight ambient-occlusion
 * pool underneath) lands on the thing the eye is already looking at. Applying
 * the same treatment inside a scene means five highlights in one picture and
 * nowhere for the eye to rest, which is why `scenes.tsx` stays flat. Same four
 * moves, applied at the scale each one works at — that is what keeps three
 * rungs feeling like one system instead of three sets that happen to be violet.
 *
 * ── SQUARE, ALL OF THEM ──────────────────────────────────────────────────
 *
 * One 96x96 viewBox across the set, including the skyline, which would have
 * been happier in a landscape box. Spots get laid out in a row of section
 * headers or in a grid of cards, and a set with two aspect ratios in it means
 * every consumer has to know which is which to keep a row aligned. The skyline
 * pays for that with a slightly taller composition; nothing else notices.
 *
 * ── ONE SLOW MOVE, ON ONE ELEMENT, VIA CSS ───────────────────────────────
 *
 * `illo-float` / `illo-sway` / `illo-pulse` from styles/tokens.css: transform
 * and opacity only, no JS loop, and gone under `prefers-reduced-motion`. An
 * animated group carries NO `transform` attribute of its own — a CSS transform
 * REPLACES the attribute rather than composing with it, so anything animated is
 * drawn in absolute viewBox coordinates and any static positioning goes on an
 * INNER group.
 *
 * ── NO KNOCKOUTS, EVER ───────────────────────────────────────────────────
 *
 * Nothing in this file paints a shape in the page's background colour to fake a
 * hole. A spot has no idea what is behind it — a card, the sunken band, a
 * tinted category panel, a poster — and a notch filled with `--surface` stops
 * being a notch on the first surface that is not `--surface`. Ticket notches
 * are cut into the PATH, the same call `sign-in-art.tsx` makes and for the same
 * reason.
 *
 * ── DECORATIVE, ALWAYS ───────────────────────────────────────────────────
 *
 * `aria-hidden` on every one. A spot sits beside a heading that already says
 * what the section is; announcing "illustration of a skyline" is a second,
 * worse copy of that heading, read out first.
 */

type SpotIds = {
  warm: string;
  cool: string;
  gloss: string;
  ground: string;
  /** The whole form's drop shadow. Applied by the shell to every spot, so the
   *  object reads as sitting above the page rather than printed on it. */
  cast: string;
};

function Spot({
  className,
  gradientId,
  children,
}: {
  className?: string;
  gradientId: string;
  children: (ids: SpotIds) => React.ReactNode;
}) {
  // SVG <defs> ids are DOCUMENT-global. A row of four spots with hard-coded ids
  // means three of them silently adopt the first one's gradient — the same trap
  // clay.tsx, brand-mark.tsx and sign-in-art.tsx each document, and it only
  // ever shows up once more than one of them is on screen.
  const id = React.useId();
  const ids: SpotIds = {
    warm: `${id}-${gradientId}-warm`,
    cool: `${id}-${gradientId}-cool`,
    gloss: `${id}-${gradientId}-gloss`,
    ground: `${id}-${gradientId}-ground`,
    cast: `${id}-${gradientId}-cast`,
  };

  return (
    <svg
      viewBox="0 0 96 96"
      className={cn('size-24 shrink-0', className)}
      aria-hidden
      role="presentation"
    >
      <defs>
        {/* Volume: light at the top-left where the light is, saturated at the
            bottom-right. The same two ramps as the scenes, so the sets match. */}
        {/* Butter and violet, matching scenes.tsx exactly — see the longer note
            there for why the old violet-400 -> pink-500 pair had to go. The two
            sets share one vocabulary or they stop looking like one family. */}
        <linearGradient id={ids.warm} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="rgb(var(--butter-300))" />
          <stop offset="100%" stopColor="rgb(var(--butter-800))" />
        </linearGradient>
        <linearGradient id={ids.cool} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="rgb(var(--violet-500))" />
          <stop offset="100%" stopColor="rgb(var(--violet-700))" />
        </linearGradient>
        {/* THE SPECULAR. A radial on the upper-left face, not a full-width wash
            down the whole form — a wash is what made this set read as two flat
            tones. Bounding-box units, so one declaration serves a highlight of
            any size. */}
        <radialGradient id={ids.gloss} cx="0.32" cy="0.26" r="0.5">
          <stop offset="0%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.52" />
          <stop offset="70%" stopColor="rgb(var(--on-gradient))" stopOpacity="0.08" />
          <stop offset="100%" stopColor="rgb(var(--on-gradient))" stopOpacity="0" />
        </radialGradient>
        {/* The contact pool, at depth.tsx's weight rather than the 0.2 this
            used to carry — a shadow that faint is a shadow nobody reads as one,
            and it was the reason these sat ON the page instead of on a
            surface. */}
        <radialGradient id={ids.ground}>
          <stop offset="0%" stopColor="rgb(var(--overlay))" stopOpacity="0.34" />
          <stop offset="65%" stopColor="rgb(var(--overlay))" stopOpacity="0.12" />
          <stop offset="100%" stopColor="rgb(var(--overlay))" stopOpacity="0" />
        </radialGradient>
        {/* THE CAST SHADOW, and the reason it lives on the SHELL rather than
            inside each spot: it is applied to the whole form as one group, so
            every spot gets an object that sits ABOVE the page instead of being
            printed on it — the single strongest 3D cue available — without any
            of the five having to redraw a path. Offset down and right, because
            the light in this set comes from the upper left, and matched to
            depth.tsx's own numbers at this box's scale (96 units ≈ scale 2). */}
        <filter id={ids.cast} x="-25%" y="-25%" width="160%" height="160%">
          <feDropShadow
            dx="1.4"
            dy="2.2"
            stdDeviation="1.8"
            floodColor="rgb(var(--overlay))"
            floodOpacity="0.32"
          />
        </filter>
      </defs>

      {/* The contact shadow sits BELOW the form and escapes its footprint —
          `cy` past the bottom of the object, not tucked inside it where the
          body would paint over it (the mistake the clay set had). */}
      <ellipse cx="48" cy="85" rx="30" ry="5.5" fill={`url(#${ids.ground})`} />

      <g filter={`url(#${ids.cast})`}>{children(ids)}</g>
    </svg>
  );
}

/**
 * The transform that stands the shared `Figure` on a given line, at a given
 * scale, in a spot's coordinate system.
 *
 * It positions by the FEET rather than by the head, because in a spot the
 * figure is always standing on something that is drawn — a stage, a floor — and
 * the thing that must line up is the contact point. Positioning by the head
 * means every change of scale silently lifts the character off its own stage by
 * a couple of units, which is exactly the "floating figure" tell the ground
 * pool exists to prevent.
 *
 * Computed from `FIGURE`'s published metrics rather than eyeballed: `Figure`
 * draws at a fixed y inside the 160x120 scene box, so a hand-written translate
 * is a number somebody tuned by eye once, and it silently stops being right the
 * moment the character's proportions are touched again — which has already
 * happened to this set once.
 */
function figureOn(x: number, groundY: number, scale: number) {
  return `translate(${x} ${groundY - FIGURE.feet * scale}) scale(${scale})`;
}

/**
 * HIRE A BAND — the marketplace's supply side, in one small picture.
 *
 * A stage with two performers on it, not an instrument. A guitar or a mic on
 * its own is a picture of EQUIPMENT, and what is being hired here is people;
 * the arch and the two figures say "a booked act" in a way a headstock does
 * not. The figures are the SAME character as every scene, scaled — a second
 * body language for the same product is exactly the drift `figure.tsx` exists
 * to prevent.
 */
export function SpotHireABand({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="band">
      {(ids) => (
        <>
          {/* The proscenium arch: the backdrop the act stands in front of. */}
          <path d="M16 68 V40 a32 26 0 0 1 64 0 V68 Z" fill={`url(#${ids.cool})`} />
          <path d="M16 68 V40 a32 26 0 0 1 64 0 V68 Z" fill={`url(#${ids.gloss})`} />

          {/* The stage, drawn BEFORE the performers so they stand on it rather
              than behind its front edge. `--muted` in both themes: one value
              step off the canvas, which is what a floor should be in a picture
              whose subject is the people standing on it. */}
          <rect
            x="10"
            y="66"
            width="76"
            height="10"
            rx="5"
            fill="rgb(var(--muted))"
            stroke="rgb(var(--border))"
            strokeWidth="1.5"
          />

          {/* Two performers, feet on the stage line at y=66. Different scales on
              purpose — two figures at one size read as a repeated stamp rather
              than as two people.

              LIT, not violet. The first version used the character's default
              deep-violet body against this deep-violet arch and rendered as a
              purple blob with two faces on it. The arch is built from PRIMITIVE
              violet tokens, so it is the same deep colour in both themes, which
              is exactly what makes a near-white figure the safe choice here:
              one fill that reads on it in light AND dark, and it happens to be
              what a performer under a stage light actually looks like. */}
          <g transform={figureOn(36, 66, 0.4)}>
            <Figure
              cx={0}
              cool={ids.cool}
              body="rgb(var(--violet-100))"
              head="rgb(var(--on-gradient))"
            />
          </g>
          <g transform={figureOn(61, 66, 0.36)}>
            <Figure
              cx={0}
              cool={ids.cool}
              body="rgb(var(--violet-100))"
              head="rgb(var(--on-gradient))"
            />
          </g>

          {/* The one animated element: a note rising off the stage. Placed
              CLEAR of the arch rather than over it — the warm ramp on top of
              the cool one is two mid violets touching, which is legible on
              paper and mud at 96px. Absolute coordinates, because a CSS
              transform would replace an attribute one rather than compose. */}
          <g className="illo-float motion-reduce:animate-none">
            <path
              d="M84 26 V10 l9 -2.5 V23"
              fill="none"
              stroke={`url(#${ids.warm})`}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="81" cy="26" r="3.2" fill={`url(#${ids.warm})`} />
            <circle cx="90" cy="23" r="3.2" fill={`url(#${ids.warm})`} />
          </g>
        </>
      )}
    </Spot>
  );
}

/**
 * A CITY — for the city landing pages and the city switcher's header.
 *
 * Rounded towers with lit windows, and NO landmark. A recognisable silhouette
 * (a Gateway of India, a Charminar) would be a picture of ONE city used as the
 * decoration for every city page on the platform, which is worse than generic:
 * it is wrong on all but one of them.
 *
 * The windows are `--on-gradient` — white in BOTH themes, unlike every other
 * ink token — because a lit window is lit regardless of which theme the page is
 * in. A window that followed the foreground colour would go dark on the dark
 * theme, which is a picture of an empty building.
 *
 * Window rows and columns are DATA rather than a fitting calculation: a
 * 15-wide tower cannot hold two 4-wide windows with a gap between them, and the
 * arithmetic that discovers that at render time is longer than writing down the
 * four towers this drawing has.
 */
const CITY_TOWERS = [
  { x: 12, y: 54, width: 15, height: 24, rx: 4, rows: 1, cols: [5.5] },
  { x: 29, y: 40, width: 17, height: 38, rx: 5, rows: 2, cols: [3.5, 9.5] },
  { x: 48, y: 28, width: 19, height: 50, rx: 6, rows: 3, cols: [3.5, 11.5] },
  { x: 69, y: 48, width: 15, height: 30, rx: 4, rows: 2, cols: [5.5] },
];

export function SpotCity({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="city">
      {(ids) => (
        <>
          {CITY_TOWERS.map((tower) => (
            <React.Fragment key={tower.x}>
              <rect
                x={tower.x}
                y={tower.y}
                width={tower.width}
                height={tower.height}
                rx={tower.rx}
                fill={`url(#${ids.cool})`}
              />
              <rect
                x={tower.x}
                y={tower.y}
                width={tower.width}
                height={tower.height}
                rx={tower.rx}
                fill={`url(#${ids.gloss})`}
              />
            </React.Fragment>
          ))}

          <g fill="rgb(var(--on-gradient))" opacity="0.55">
            {CITY_TOWERS.map((tower) =>
              Array.from({ length: tower.rows }, (_, row) =>
                tower.cols.map((col) => (
                  <rect
                    key={`${tower.x}-${row}-${col}`}
                    x={tower.x + col}
                    y={tower.y + 8 + row * 10}
                    width="4"
                    height="5"
                    rx="1.5"
                  />
                )),
              ),
            )}
          </g>

          {/* The beacon on the tallest tower — the one animated element. Opacity
              only, so the halo cannot swim off the mast it belongs to. */}
          <circle
            className="illo-pulse motion-reduce:animate-none"
            cx="57.5"
            cy="22"
            r="8"
            fill={`url(#${ids.warm})`}
            opacity="0.25"
          />
          <path
            d="M57.5 25 V29"
            stroke={`url(#${ids.warm})`}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="57.5" cy="22" r="3.4" fill={`url(#${ids.warm})`} />

          {/* The street the towers stand on. */}
          <rect x="8" y="76" width="80" height="8" rx="4" fill="rgb(var(--muted))" />
          <path
            d="M20 80 H30 M40 80 H50 M60 80 H70"
            stroke="rgb(var(--border-strong))"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </Spot>
  );
}

/**
 * AN ENVELOPE — for the subscribe card and anything that collects an email.
 *
 * Drawn OPEN with the letter rising out of it, rather than closed. A sealed
 * envelope is the picture of a message that has already been sent; what is
 * being asked for on a subscribe card is permission to send one, and an open
 * envelope with something coming out of it is the more inviting half of that.
 *
 * The letter is also why the drawing order is back / letter / front rather than
 * one shape: the pocket has to be painted OVER the letter for it to look like
 * it is coming out of the envelope rather than sitting on top of it.
 */
export function SpotSubscribe({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="subscribe">
      {(ids) => (
        <>
          {/* Back of the envelope. */}
          <rect x="16" y="38" width="64" height="36" rx="8" fill={`url(#${ids.cool})`} />

          {/* The letter, floating out. Absolute coordinates on the animated
              group — see the transform note at the top of this file. */}
          <g className="illo-float motion-reduce:animate-none">
            <rect
              x="28"
              y="18"
              width="40"
              height="30"
              rx="5"
              fill="rgb(var(--surface))"
              stroke="rgb(var(--border-strong))"
              strokeWidth="2"
            />
            {/* Two bars of "a message" — the SAME ink at two opacities rather
                than two greys, so they hold their relationship in both themes.
                Never lorem text: at this size it would be grey smudges anyway. */}
            <g fill="rgb(var(--foreground))">
              <rect x="35" y="26" width="26" height="4" rx="2" opacity="0.3" />
              <rect x="35" y="34" width="18" height="4" rx="2" opacity="0.16" />
            </g>
          </g>

          {/* Front pocket, painted over the letter. The V is what reads as
              "open" — a straight top edge is a closed envelope seen from the
              back. */}
          <path
            d="M16 44 L48 66 L80 44 V66 a8 8 0 0 1 -8 8 H24 a8 8 0 0 1 -8 -8 Z"
            fill={`url(#${ids.warm})`}
          />
          <path
            d="M16 44 L48 66 L80 44 V66 a8 8 0 0 1 -8 8 H24 a8 8 0 0 1 -8 -8 Z"
            fill={`url(#${ids.gloss})`}
          />
        </>
      )}
    </Spot>
  );
}

/**
 * A TICKET STUB — for anything about the thing being bought.
 *
 * The notches are IN THE PATH, not painted over the top (see the no-knockouts
 * note above). Both bites use `sweep-flag 0` so they curve INTO the ticket:
 * travelling clockwise, the top edge runs left-to-right and the bottom edge
 * right-to-left, so the same flag bulges down on one and up on the other.
 *
 * The perforation is dashed and the code is three bars, because the honest
 * alternative — a real QR — needs a payload and there is nothing here to
 * encode. Same call `sign-in-art.tsx` makes about its finder squares.
 */
const TICKET_STUB =
  'M21 26 H50 A6 6 0 0 0 62 26 H75 A9 9 0 0 1 84 35 V61 A9 9 0 0 1 75 70 H62' +
  'A6 6 0 0 0 50 70 H21 A9 9 0 0 1 12 61 V35 A9 9 0 0 1 21 26 Z';

export function SpotTicket({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="ticket">
      {(ids) => (
        // The whole stub swings from its own centre, which is exactly what
        // `illo-sway`'s `transform-box: fill-box` gives it. Nothing else in the
        // set may use that class unless its pivot really is its own middle — a
        // board bolted to a post would detach from the post on every cycle.
        <g className="illo-sway motion-reduce:animate-none">
          <path d={TICKET_STUB} fill={`url(#${ids.warm})`} />
          <path d={TICKET_STUB} fill={`url(#${ids.gloss})`} />

          {/* The perforation, stopping short of both notches. */}
          <path
            d="M56 36 V60"
            stroke="rgb(var(--on-gradient))"
            strokeWidth="2.5"
            strokeDasharray="3 5"
            strokeLinecap="round"
            opacity="0.75"
          />

          {/* The stub's three bars, and the body's printed lines. */}
          <g stroke="rgb(var(--on-gradient))" strokeLinecap="round">
            <path d="M66 40 V56 M72 40 V56 M78 40 V56" strokeWidth="2.5" opacity="0.8" />
            <path d="M22 42 H46 M22 50 H40 M22 58 H44" strokeWidth="3" opacity="0.7" />
          </g>
        </g>
      )}
    </Spot>
  );
}

/**
 * THE TICKET, ISSUED — for the confirmation screen.
 *
 * The best moment on the platform had the smallest mark on it: a 24px lucide
 * check in a circle, the same affordance a form uses to say a field validated.
 * Somebody has just spent money and is being told they are going; that deserves
 * a picture of the thing they now own.
 *
 * It is `SpotTicket`'s own stub — the same geometry, so the object they saw
 * while choosing is the object they are handed — with a seal struck across the
 * corner. The seal is drawn in `--success-strong` because this is the one place
 * in the set where the colour carries meaning rather than decoration: the page
 * around it already uses the success tokens for exactly this state.
 *
 * NO SWAY. `SpotTicket` swings, which is right for a decorative stub in a
 * marketing row and wrong here — a confirmation is a settled fact, and motion
 * on it reads as still-processing, which is the one thing this screen must not
 * suggest while it is telling somebody their payment went through.
 */
export function SpotTicketIssued({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="ticket-issued">
      {(ids) => (
        <g>
          <path d={TICKET_STUB} fill={`url(#${ids.warm})`} />
          <path d={TICKET_STUB} fill={`url(#${ids.gloss})`} />

          {/* The perforation and the printed lines, as on the stub they chose. */}
          <path
            d="M56 36 V60"
            stroke="rgb(var(--on-gradient))"
            strokeWidth="2.5"
            strokeDasharray="3 5"
            strokeLinecap="round"
            opacity="0.75"
          />
          <g stroke="rgb(var(--on-gradient))" strokeLinecap="round">
            <path d="M66 40 V56 M72 40 V56 M78 40 V56" strokeWidth="2.5" opacity="0.8" />
            <path d="M22 42 H46 M22 50 H40" strokeWidth="3" opacity="0.7" />
          </g>

          {/* THE SEAL. Its own contact shadow rather than the shell's, because
              it sits ON the ticket rather than on the page — a disc lifted a
              little off the card it is stamped onto. */}
          <circle cx="30" cy="62" r="15" fill="rgb(var(--overlay))" opacity="0.18" />
          <circle cx="29" cy="60" r="14" fill="rgb(var(--success-strong))" />
          {/* The lit rim, upper-left, matching the light everywhere else. */}
          <circle
            cx="29"
            cy="60"
            r="14"
            fill="none"
            stroke="rgb(var(--on-gradient))"
            strokeWidth="1.4"
            strokeOpacity="0.34"
          />
          <path
            d="M22.5 60.5 l4.5 4.5 l8.5 -9"
            fill="none"
            stroke="rgb(var(--on-gradient))"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </Spot>
  );
}

/**
 * A CLUSTER OF CATEGORY SHAPES — for "browse by mood" and category headers.
 *
 * Three clay tiles at slight angles rather than one, because the section it
 * decorates is about CHOOSING between kinds of night out; a single tile is a
 * picture of one category, which is the opposite of the point.
 *
 * The glyphs are lifted straight from `clay.tsx` — the quaver, the handheld
 * mic, the tent with a doorway — at the same stroke weight relative to their
 * tile. A fourth, differently-drawn music note somewhere in the product is how
 * an icon set stops being a set.
 *
 * Drawing order is back-left, right, then the largest tile last and centre, so
 * the stack reads as depth rather than as a row that happens to overlap.
 */
export function SpotMood({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="mood">
      {(ids) => (
        <>
          {/* Back-left: concerts. */}
          <g transform="translate(27 54) rotate(-11)">
            <rect x="-15" y="-15" width="30" height="30" rx="10" fill={`url(#${ids.cool})`} />
            <rect x="-15" y="-15" width="30" height="30" rx="10" fill={`url(#${ids.gloss})`} />
            <path
              d="M-3 6 V-6 l8 -2 V4"
              fill="none"
              stroke="rgb(var(--on-gradient))"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="-5.5" cy="6" r="2.6" fill="rgb(var(--on-gradient))" />
            <circle cx="2.5" cy="4" r="2.6" fill="rgb(var(--on-gradient))" />
          </g>

          {/* Right: festivals. Smallest and furthest round. */}
          <g transform="translate(70 60) rotate(14)">
            <rect x="-13" y="-13" width="26" height="26" rx="9" fill="rgb(var(--pink-600))" />
            <rect x="-13" y="-13" width="26" height="26" rx="9" fill={`url(#${ids.gloss})`} />
            <g
              fill="none"
              stroke="rgb(var(--on-gradient))"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M0 -6 -7 6 H7 Z" />
              <path d="M-2.5 6 0 1 2.5 6" />
            </g>
          </g>

          {/* Front and centre: comedy. Largest and the most upright, so the eye
              lands here first. */}
          <g transform="translate(49 48) rotate(5)">
            <rect x="-17" y="-17" width="34" height="34" rx="11" fill={`url(#${ids.warm})`} />
            <rect x="-17" y="-17" width="34" height="34" rx="11" fill={`url(#${ids.gloss})`} />
            <rect x="-3.4" y="-9" width="6.8" height="11" rx="3.4" fill="rgb(var(--on-gradient))" />
            <g fill="none" stroke="rgb(var(--on-gradient))" strokeWidth="2.4" strokeLinecap="round">
              <path d="M-7 0a7 7 0 0 0 14 0" />
              <path d="M0 7v4" />
            </g>
          </g>

          {/* The one animated element: a sparkle above the stack. */}
          <g className="illo-float motion-reduce:animate-none">
            <path
              d="M30 14 l2.4 6.2 6.2 2.4 -6.2 2.4 -2.4 6.2 -2.4 -6.2 -6.2 -2.4 6.2 -2.4 Z"
              fill={`url(#${ids.warm})`}
            />
          </g>
        </>
      )}
    </Spot>
  );
}

/**
 * TWO SPEECH BUBBLES — for the help centre and the contact page.
 *
 * A question and an answer, not a headset. A headset draws a CALL CENTRE, and
 * this platform does not have one: support today is a written set of answers
 * and an inbox, and a person in a headset would be the illustrated twin of a
 * five-star rating with no reviews behind it. Two bubbles say "somebody writes
 * back", which is exactly what is on offer.
 *
 * The asking bubble is warm, smaller and BEHIND; the answering one is cool,
 * larger, in front, and carries the tail. Reading order is the conversation.
 */
export function SpotSupport({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="support">
      {(ids) => (
        <>
          {/* The question, behind and up-left. */}
          <rect x="14" y="18" width="38" height="28" rx="10" fill={`url(#${ids.warm})`} />
          <rect x="14" y="18" width="38" height="28" rx="10" fill={`url(#${ids.gloss})`} />
          {/* Two short rules, not a question mark. A glyph at this size is four
              pixels of ambiguity; two lines read as "text" immediately. */}
          <g fill="rgb(var(--on-gradient))" opacity="0.62">
            <rect x="22" y="26" width="22" height="3.6" rx="1.8" />
            <rect x="22" y="34" width="14" height="3.6" rx="1.8" />
          </g>

          {/* The answer: larger, in front, with the tail — so the eye finishes
              on the reply rather than on the question. */}
          <path
            d="M44 40h30a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10H60l-9 8v-8h-7a10 10 0 0 1-10-10V50a10 10 0 0 1 10-10Z"
            fill={`url(#${ids.cool})`}
          />
          <path
            d="M44 40h30a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10H60l-9 8v-8h-7a10 10 0 0 1-10-10V50a10 10 0 0 1 10-10Z"
            fill={`url(#${ids.gloss})`}
          />
          <g fill="rgb(var(--on-gradient))" opacity="0.7">
            <rect x="44" y="50" width="30" height="3.8" rx="1.9" />
            <rect x="44" y="59" width="20" height="3.8" rx="1.9" />
          </g>

          {/* The one animated element: the typing dot. Opacity only. */}
          <circle
            className="illo-pulse motion-reduce:animate-none"
            cx="70"
            cy="61"
            r="3"
            fill="rgb(var(--on-gradient))"
          />
        </>
      )}
    </Spot>
  );
}

/**
 * A SHIELD WITH A DOCUMENT IN IT — for the four policy pages.
 *
 * A padlock was the obvious first draft and is wrong here: a padlock is about
 * SECRECY, and a terms page, a refund policy and a cookie notice are its
 * opposite — they are the documents a platform publishes so the reader does not
 * have to take its word for anything. A shield around a written page says "this
 * is set down, and it protects you", which is what those four pages are for.
 *
 * The seal is `--on-gradient` on a warm disc rather than the success green.
 * This is not a status, and a green tick on a Terms page reads as "you have
 * accepted" — a claim about the reader that no illustration is entitled to
 * make.
 */
export function SpotPolicy({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="policy">
      {(ids) => (
        <>
          {/* A flat top with rounded shoulders and a soft point. A heraldic
              notch would read as a badge, which is a claim of accreditation
              nobody granted. */}
          <path
            d="M48 12 78 22v24c0 16-12 27-30 34-18-7-30-18-30-34V22Z"
            fill={`url(#${ids.cool})`}
          />
          <path
            d="M48 12 78 22v24c0 16-12 27-30 34-18-7-30-18-30-34V22Z"
            fill={`url(#${ids.gloss})`}
          />

          {/* The document inside. Surface-coloured, so it reads as paper
              against the shield in both themes. */}
          <rect x="35" y="29" width="26" height="32" rx="4" fill="rgb(var(--surface))" />
          <g fill="rgb(var(--border-strong))">
            <rect x="40" y="36" width="16" height="2.8" rx="1.4" />
            <rect x="40" y="43" width="16" height="2.8" rx="1.4" />
            <rect x="40" y="50" width="10" height="2.8" rx="1.4" />
          </g>

          {/* The seal, on the corner of the page — the one animated mark. */}
          <g className="illo-float motion-reduce:animate-none">
            <circle cx="63" cy="57" r="9" fill={`url(#${ids.warm})`} />
            <path
              d="M59 57 l3 3 6 -6.5"
              fill="none"
              stroke="rgb(var(--on-gradient))"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </>
      )}
    </Spot>
  );
}

/**
 * A POSTER ON A STAND — for "list your event".
 *
 * The supply side's picture is the LISTING, not the crowd. A drawing of an
 * audience is a picture of the outcome an organizer is hoping for, and opening
 * the page that asks them to sign up with it is the illustrated version of a
 * fabricated statistic. A poster on a stand is the artefact they actually make
 * here.
 *
 * `SpotHireABand` already owns the stage-with-performers composition, so this
 * is deliberately a different object — the two supply pages should not open
 * with the same picture.
 */
export function SpotListing({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="listing">
      {(ids) => (
        <>
          {/* The A-frame legs, behind the board. */}
          <path
            d="M34 76 L40 46 M62 76 L56 46"
            stroke="rgb(var(--border-strong))"
            strokeWidth="3.4"
            strokeLinecap="round"
          />

          <rect x="20" y="16" width="56" height="44" rx="8" fill={`url(#${ids.cool})`} />
          <rect x="20" y="16" width="56" height="44" rx="8" fill={`url(#${ids.gloss})`} />

          {/* A headline block and a date pill. Enough to read as a listing, not
              so much that it reads as lorem text. */}
          <g fill="rgb(var(--on-gradient))">
            <rect x="28" y="25" width="30" height="5" rx="2.5" opacity="0.85" />
            <rect x="28" y="34" width="20" height="4" rx="2" opacity="0.55" />
          </g>
          <rect x="28" y="45" width="22" height="9" rx="4.5" fill={`url(#${ids.warm})`} />

          <rect x="16" y="74" width="64" height="7" rx="3.5" fill="rgb(var(--muted))" />

          {/* The one animated element: a "live" spark leaving the board. */}
          <g className="illo-float motion-reduce:animate-none">
            <path
              d="M74 16 l2.2 5.6 5.6 2.2 -5.6 2.2 -2.2 5.6 -2.2 -5.6 -5.6 -2.2 5.6 -2.2 Z"
              fill={`url(#${ids.warm})`}
            />
          </g>
        </>
      )}
    </Spot>
  );
}

/**
 * COINS, WITH ONE LEAVING THE STACK — for the pricing page.
 *
 * The subject of that page is not "money"; it is which SLICE of the money moves
 * and when. So this is a stack with a single coin lifting off it — a picture of
 * a fee coming OUT of a total, rather than a pile of cash or a price tag.
 *
 * The direction is the whole point and is why this is not a wallet: this
 * platform takes its fee out of what the customer pays and never adds it on
 * top, and that sentence is the pricing page's entire argument.
 */
export function SpotPayout({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="payout">
      {(ids) => (
        <>
          {/* Bottom-up, so each disc overlaps the one below it. */}
          {[70, 60, 50].map((y, index) => (
            <React.Fragment key={y}>
              <ellipse cx="44" cy={y} rx="26" ry="9" fill={`url(#${ids.cool})`} />
              {index === 2 ? (
                <ellipse cx="44" cy={y} rx="26" ry="9" fill={`url(#${ids.gloss})`} />
              ) : null}
            </React.Fragment>
          ))}

          {/* A rupee on the top face. The one glyph in this set worth drawing:
              every amount on this platform is in rupees, and an unmarked coin
              reads as a foreign currency. */}
          <g
            fill="none"
            stroke="rgb(var(--on-gradient))"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.82"
          >
            <path d="M38 45 h12 M38 49 h12 M40 45 c7 0 7 8 0 8 h-2 l10 7" />
          </g>

          {/* The coin that leaves. Warm, so it reads as the slice that moves,
              and the only animated element. */}
          <g className="illo-float motion-reduce:animate-none">
            <ellipse cx="72" cy="26" rx="13" ry="5" fill={`url(#${ids.warm})`} />
            <path
              d="M72 34 V40 M68 36 l4 5 4 -5"
              fill="none"
              stroke={`url(#${ids.warm})`}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </>
      )}
    </Spot>
  );
}

/**
 * A MAGNIFIER OVER A DOCUMENT — for the support desk's lookup.
 *
 * The operator surface's empty state is "search for a booking", and the object
 * that says that is a document being READ, not a magnifier alone. A bare
 * magnifier is the icon on the input directly above it, and repeating a
 * control as decoration teaches somebody it is a second control.
 *
 * The document carries a small warm chip — the row an operator is hunting for —
 * so the drawing is of finding a specific record rather than of searching in
 * general.
 */
export function SpotLookup({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="lookup">
      {(ids) => (
        <>
          {/* The record. Two sheets, the back one offset, so it reads as a set
              of records rather than a single page. */}
          <rect x="20" y="16" width="42" height="54" rx="6" fill="rgb(var(--muted))" />
          <rect x="26" y="22" width="42" height="54" rx="6" fill={`url(#${ids.cool})`} />
          <rect x="26" y="22" width="42" height="54" rx="6" fill={`url(#${ids.gloss})`} />

          <g fill="rgb(var(--on-gradient))" opacity="0.6">
            <rect x="33" y="31" width="26" height="3.6" rx="1.8" />
            <rect x="33" y="40" width="18" height="3.6" rx="1.8" />
            <rect x="33" y="58" width="22" height="3.6" rx="1.8" />
          </g>
          {/* THE row being looked for. */}
          <rect x="33" y="47" width="28" height="6" rx="3" fill={`url(#${ids.warm})`} />

          {/* The magnifier, over the highlighted row. The one animated element
              — a slow drift, so it reads as searching rather than as found. */}
          <g className="illo-float motion-reduce:animate-none">
            <circle
              cx="62"
              cy="50"
              r="15"
              fill="rgb(var(--surface))"
              fillOpacity="0.55"
              stroke={`url(#${ids.warm})`}
              strokeWidth="4"
            />
            <path
              d="M73 61 L83 71"
              stroke={`url(#${ids.warm})`}
              strokeWidth="5"
              strokeLinecap="round"
            />
          </g>
        </>
      )}
    </Spot>
  );
}

/**
 * AN OPEN HAND RETURNING A COIN — for the refund-request queues.
 *
 * Not the same drawing as `SpotPayout`, and the difference is the whole point.
 * A payout is money LEAVING the platform to an organizer; a refund is money
 * GOING BACK to the person who paid it. Drawn as a coin descending into an open
 * palm, so the direction is legible without a label — a queue of these appears
 * on the organizer's screen next to their payouts, and the two must not read as
 * the same thing.
 *
 * The palm is cool and still; the coin is warm and is the one animated element,
 * because the coin is what moves.
 */
export function SpotRefund({ className }: { className?: string }) {
  return (
    <Spot className={className} gradientId="refund">
      {(ids) => (
        <>
          {/* The palm: a shallow bowl with a thumb, open upward. */}
          <path d="M22 56 a26 16 0 0 0 52 0 v4 a26 22 0 0 1 -52 0 Z" fill={`url(#${ids.cool})`} />
          <path d="M22 56 a26 16 0 0 0 52 0 v4 a26 22 0 0 1 -52 0 Z" fill={`url(#${ids.gloss})`} />
          {/* The thumb, and the wrist it sits on. */}
          <rect x="16" y="50" width="12" height="9" rx="4.5" fill={`url(#${ids.cool})`} />
          <rect x="38" y="72" width="20" height="8" rx="4" fill="rgb(var(--muted))" />

          {/* The coin, coming DOWN into the palm — the opposite direction to
              SpotPayout's, which lifts away from the stack. */}
          <g className="illo-float motion-reduce:animate-none">
            <circle cx="48" cy="26" r="13" fill={`url(#${ids.warm})`} />
            <path
              d="M43 21 h10 M43 25 h10 M45 21 c6 0 6 7 0 7 h-2 l9 6"
              fill="none"
              stroke="rgb(var(--on-gradient))"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
            />
            <path
              d="M48 42 V47 M44 44 l4 4 4 -4"
              fill="none"
              stroke={`url(#${ids.warm})`}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </>
      )}
    </Spot>
  );
}
