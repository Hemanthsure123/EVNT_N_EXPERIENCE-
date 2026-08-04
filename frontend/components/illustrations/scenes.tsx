'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { Figure } from './figure';

/**
 * Flat-vector scenes with a friendly character, for empty and failure states.
 *
 * ── WHY A CHARACTER, AND WHY THIS RESTRAINED A ONE ───────────────────────
 *
 * A scene from this file is read at the exact moment somebody is mildly
 * frustrated — they searched and got nothing, arrived somewhere with no data
 * yet, lost their connection, or hit a page that broke. A glyph in a grey
 * square reports the fact; a character absorbs a little of the disappointment,
 * which is the whole reason the pattern exists.
 *
 * It is deliberately GEOMETRIC and faceless-but-for-two-dots. Hand-drawn
 * character work at this fidelity is where illustration sets go wrong: the
 * more expressive the face, the more it dates, the harder it is to keep
 * consistent across scenes, and the closer it drifts to clip art. A simple
 * rounded figure built from circles and capsules stays modern, reads at 96px,
 * and — crucially — can be drawn the same way six times. `figure.tsx` holds the
 * one definition; nothing here redraws a person.
 *
 * ── SAME CONSTRUCTION RULES AS THE CLAY SET ──────────────────────────────
 *
 * Soft gradient ground shadow, one light source top-left, rounded everything,
 * every colour through `rgb(var(--token))`. The two sets have to look like one
 * illustration language, and they do because they are built from the same four
 * moves — the clay icons just add volume where these stay flat.
 *
 * These scenes stay FLAT rather than growing the clay set's gloss-and-occlusion
 * volume, and that is a decision rather than an omission. A scene is a picture
 * with several objects in it; giving each object its own specular highlight at
 * 160px makes a busy, shiny composition where the eye has nowhere to rest. The
 * dimensionality here comes from the ground pool, from one soft contact shadow
 * under whichever object is the subject, and from the gradients — the three
 * cheapest depth cues, applied to the one thing that should read as lifted.
 * `spots.tsx` is where the full clay treatment lives, because a spot is a
 * single object and can carry it.
 *
 * ── DECORATIVE, ALWAYS ───────────────────────────────────────────────────
 *
 * Every scene is `aria-hidden`. The state's heading and body already say what
 * happened in words; a screen reader announcing "illustration of a person with
 * a magnifying glass" adds nothing an assistive user can act on, and puts a
 * paragraph of alt text between them and the button that fixes it.
 *
 * ── ONE SLOW MOVE, ON ONE ELEMENT ────────────────────────────────────────
 *
 * Each of the failure scenes animates exactly one thing, via the `illo-*`
 * classes in styles/tokens.css — transform/opacity only, no JS, and off under
 * `prefers-reduced-motion` (belt and braces: the class, the `motion-reduce:`
 * variant, and the global rule in globals.css). The three original empty-state
 * scenes stay completely still: a list that is merely empty is not a situation
 * that needs the page to prove it is still alive.
 */

function Scene({
  className,
  children,
  gradientId,
}: {
  className?: string;
  children: (ids: {
    warm: string;
    cool: string;
    ground: string;
    soften: string;
  }) => React.ReactNode;
  gradientId: string;
}) {
  const id = React.useId();
  const ids = {
    warm: `${id}-${gradientId}-warm`,
    cool: `${id}-${gradientId}-cool`,
    ground: `${id}-${gradientId}-ground`,
    soften: `${id}-${gradientId}-soften`,
  };

  return (
    <svg
      viewBox="0 0 160 120"
      className={cn('h-28 w-auto', className)}
      aria-hidden
      role="presentation"
    >
      <defs>
        {/* Warm is BUTTER, not the old violet-400 -> pink-500.
            tokens.css retired pink from the semantic layer and demoted violet
            to a wayfinding accent, and said `--gradient-brand` should "stop
            shouting" — but every picture in this folder kept painting the loud
            old brand, which left the illustrations as the last surface still
            wearing it, on a warm cream page. results-empty.tsx had already
            diagnosed the result as "a violet bruise" and fixed it for its own
            halo only. These are quiet screens; a saturated illustration here
            shouts over the sentence that matters. */}
        <linearGradient id={ids.warm} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--butter-300))" />
          <stop offset="100%" stopColor="rgb(var(--butter-800))" />
        </linearGradient>
        {/* Cool stays violet — it is the wayfinding accent, so it still reads
            as "this product" — but starts a step lower so the pair sits in the
            page rather than on top of it. */}
        <linearGradient id={ids.cool} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--violet-500))" />
          <stop offset="100%" stopColor="rgb(var(--violet-700))" />
        </linearGradient>
        <radialGradient id={ids.ground}>
          <stop offset="0%" stopColor="rgb(var(--overlay))" stopOpacity="0.18" />
          <stop offset="100%" stopColor="rgb(var(--overlay))" stopOpacity="0" />
        </radialGradient>
        {/* ONE blur, declared once and reused for every contact shadow in the
            scene. A `feDropShadow` per object would be a separate filter region
            per object, and a scene can have three. */}
        <filter id={ids.soften} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* The ground pool. Without it every figure floats, which is the single
          most common tell of an unfinished illustration. */}
      <ellipse cx="80" cy="104" rx="56" ry="8" fill={`url(#${ids.ground})`} />

      {children(ids)}
    </svg>
  );
}

/**
 * A tight contact shadow under one object.
 *
 * Separate from the scene-wide ground pool because they say different things:
 * the pool seats the whole composition on a surface, this says "THIS object is
 * the subject and it is lifted off it". Near-invisible in dark theme on
 * purpose — that theme carries elevation with value, not with shadow, so a
 * heavier pool there would just be a grey smudge on a dark canvas.
 */
function Contact({ cx, cy, rx, soften }: { cx: number; cy: number; rx: number; soften: string }) {
  return (
    <ellipse
      cx={cx}
      cy={cy}
      rx={rx}
      ry="4"
      fill="rgb(var(--overlay))"
      opacity="0.16"
      filter={`url(#${soften})`}
    />
  );
}

/**
 * NOTHING MATCHED A SEARCH.
 *
 * The magnifier is oversized and tilted on purpose: at 96px a correctly
 * proportioned one is a grey circle nobody parses. The character holding
 * something too big for them is also the friendliest reading of "we looked".
 */
export function SceneNoResults({ className }: { className?: string }) {
  return (
    <Scene className={className} gradientId="search">
      {(ids) => (
        <>
          <Figure cool={ids.cool} />
          {/* The magnifier is the HERO of this scene, not a prop: it is the
              metaphor, so it is drawn large and clear of the character's head
              rather than tucked beside it. */}
          <g transform="translate(112 48) rotate(14)">
            <circle
              cx="0"
              cy="0"
              r="23"
              fill="rgb(var(--surface))"
              fillOpacity="0.92"
              stroke={`url(#${ids.warm})`}
              strokeWidth="6"
            />
            <path
              d="M16 16 29 29"
              stroke={`url(#${ids.warm})`}
              strokeWidth="7"
              strokeLinecap="round"
            />
          </g>
          {/* Two ticks of motion — "we looked", with nothing animating. */}
          <path
            d="M22 44h9M17 56h5"
            stroke="rgb(var(--violet-400))"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.5"
          />
        </>
      )}
    </Scene>
  );
}

/**
 * A LIST THAT HAS NOTHING IN IT YET — as opposed to a search that failed.
 *
 * Different picture on purpose. "Nothing matched" and "nothing here yet" are
 * different situations with different next actions, and an empty state that
 * draws the same thing for both teaches people to ignore it.
 */
export function SceneNothingYet({ className }: { className?: string }) {
  return (
    <Scene className={className} gradientId="empty">
      {(ids) => (
        <>
          {/* A calendar card, tilted, with its grid drawn but unfilled. */}
          <g transform="translate(46 30) rotate(-6)">
            <rect width="68" height="60" rx="10" fill="rgb(var(--surface))" />
            <rect
              width="68"
              height="60"
              rx="10"
              fill="none"
              stroke="rgb(var(--border))"
              strokeWidth="2"
            />
            <rect width="68" height="16" rx="10" fill={`url(#${ids.warm})`} />
            <rect y="10" width="68" height="6" fill={`url(#${ids.warm})`} />
            {/* Empty cells — the point of the picture. */}
            {[0, 1, 2].map((row) =>
              [0, 1, 2, 3].map((col) => (
                <rect
                  key={`${row}-${col}`}
                  x={9 + col * 13}
                  y={25 + row * 11}
                  width="8"
                  height="6"
                  rx="2"
                  fill="rgb(var(--muted))"
                />
              )),
            )}
          </g>
          {/* The figure, smaller and beside it — the card is the subject here. */}
          <g transform="translate(4 34) scale(0.6)">
            <Figure cool={ids.cool} />
          </g>
        </>
      )}
    </Scene>
  );
}

/**
 * A QUEUE THAT HAS BEEN CLEARED — an operator's "nothing waiting on you".
 *
 * Reads as an accomplishment rather than an absence, which is the correct
 * emotional register for a moderation queue at zero.
 */
export function SceneAllClear({ className }: { className?: string }) {
  return (
    <Scene className={className} gradientId="clear">
      {(ids) => (
        <>
          <Figure cool={ids.cool} />
          <g transform="translate(114 46)">
            <circle cx="0" cy="0" r="22" fill={`url(#${ids.warm})`} />
            <path
              d="M-9 1 -3 7 10 -7"
              fill="none"
              stroke="rgb(var(--on-gradient))"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <path
            d="M20 38l4-4M15 52h6M24 64l3 3"
            stroke="rgb(var(--violet-400))"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.45"
          />
        </>
      )}
    </Scene>
  );
}

/**
 * THE CONNECTION IS GONE — not our fault, and not the same as an error.
 *
 * This distinction is the entire reason the scene exists. Telling somebody on a
 * train that our platform is broken sends them to look for a status page, mail
 * support, or simply leave, when the fix is thirty seconds of signal. So the
 * picture has to say "the link between you and us is cut", not "something blew
 * up here" — hence signal arcs with a bar through them rather than a warning
 * triangle, which is the visual vocabulary of a fault at the far end.
 *
 * THE BAR IS OPAQUE, WHICH IS WHY IT WORKS ANYWHERE. The obvious way to draw a
 * "no signal" slash is a thick knockout in the page colour with a thin coloured
 * stroke on top — and it stops being a knockout the moment the scene is placed
 * on `bg-sunken`, on a card, or over the recessed well the results-empty panel
 * uses. A single opaque gradient bar covers the arcs it crosses with no
 * knowledge of what is behind the SVG at all.
 *
 * THE ARCS SPAN 120°, NOT 90°. At 90° a 45° bar leaves through the arc's own
 * endpoints and reads as tangent to them rather than through them — the drawing
 * looked like a wifi glyph next to a stick, not a wifi glyph crossed out.
 */
export function SceneOffline({ className }: { className?: string }) {
  return (
    <Scene className={className} gradientId="offline">
      {(ids) => (
        <>
          <Figure cool={ids.cool} />

          {/* Arcs radiating from (114, 70). Endpoints are that centre plus
              (±0.866r, −0.5r) — 60° either side of vertical. */}
          <g fill="none" stroke="rgb(var(--violet-400))" strokeWidth="6" strokeLinecap="round">
            {/* Innermost first, so the outer (animated) arc is not painted over. */}
            {/* Opacities step DOWN outward, and none of them starts low: on the
                dark canvas a violet-400 arc at 0.3 is already almost gone, and
                the whole glyph has to survive there too. */}
            <path d="M105.34 65 A10 10 0 0 1 122.66 65" opacity="0.95" />
            <path d="M99.28 61.5 A17 17 0 0 1 128.72 61.5" opacity="0.65" />
            {/* The one animated element in this scene. It fades in and out
                rather than scaling: the arc's bounding box centre is not the
                point it radiates from, so a scale would swim. Reads as the
                device still reaching for a signal, which is what is happening. */}
            <path
              className="illo-pulse motion-reduce:animate-none"
              d="M93.22 58 A24 24 0 0 1 134.78 58"
              opacity="0.4"
            />
          </g>

          <circle cx="114" cy="70" r="4.5" fill="rgb(var(--violet-500))" />

          {/* The bar, through the same centre. Drawn last and fully opaque, so
              it cuts the arcs and the dot without a background-coloured
              knockout that would break on a non-white surface. */}
          <path
            d="M94 50 L134 90"
            stroke={`url(#${ids.warm})`}
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
          />
        </>
      )}
    </Scene>
  );
}

/**
 * SOMETHING BROKE AT OUR END.
 *
 * A cracked panel rather than a warning triangle, for two reasons. A triangle
 * is the icon of DANGER — it is what a payment failure or a destructive
 * confirmation should wear, and spending it on "the page did not render" leaves
 * nothing louder for the cases that genuinely are. And a triangle says nothing
 * about what broke, where a fractured surface with content bars behind the
 * crack quite literally shows a page that came apart.
 *
 * The figure stays calm and stays looking at it. An illustration of distress on
 * an error page raises the temperature of a moment that is usually a retry
 * away from being over.
 */
export function SceneError({ className }: { className?: string }) {
  return (
    <Scene className={className} gradientId="error">
      {(ids) => (
        <>
          <Figure cool={ids.cool} />

          <Contact cx={113} cy={96} rx={28} soften={ids.soften} />

          <g transform="translate(113 58) rotate(-7)">
            <rect
              x="-27"
              y="-33"
              width="54"
              height="64"
              rx="12"
              fill="rgb(var(--surface))"
              stroke="rgb(var(--border-strong))"
              strokeWidth="2"
            />
            {/* Content bars — the SAME ink at two opacities rather than two
                greys, so they hold their relationship in both themes. Without
                them the panel is a slab and the crack has nothing to break. */}
            <g fill="rgb(var(--foreground))">
              <rect x="-17" y="-22" width="34" height="6" rx="3" opacity="0.26" />
              <rect x="-17" y="-9" width="24" height="6" rx="3" opacity="0.16" />
              <rect x="-17" y="8" width="30" height="6" rx="3" opacity="0.16" />
              <rect x="-17" y="19" width="18" height="6" rx="3" opacity="0.1" />
            </g>
            {/* The fracture, running clean off both edges. */}
            <path
              d="M-5 -33 L4 -14 L-6 -3 L5 15 L-2 31"
              fill="none"
              stroke={`url(#${ids.warm})`}
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          {/* The one animated element: a shard that came off, drifting.
              Deliberately the PANEL's material (surface + the same hairline)
              rather than the crack's warm gradient — a pink triangle beside a
              white panel is a pink triangle, where a chip of the same stuff is
              unmistakably a piece OF it. The group carries NO transform
              attribute of its own: a CSS transform would overwrite one, which
              is why the shard is drawn in absolute scene coordinates. */}
          <g className="illo-float motion-reduce:animate-none">
            <path
              d="M78 20 L89 15 L86 28 Z"
              fill="rgb(var(--surface))"
              stroke="rgb(var(--border-strong))"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </g>
        </>
      )}
    </Scene>
  );
}

/**
 * THE ADDRESS DOES NOT LEAD ANYWHERE.
 *
 * A signpost, and the boards are BLANK. Writing destinations on them was the
 * first draft and it is exactly the kind of invention this codebase refuses
 * elsewhere: the boards would have to name pages, at illustration scale, in a
 * picture that ships to every 404 on the platform including ones inside the
 * console. Blank boards with a worn printed rule read as "the sign is no help",
 * which is the honest content of a 404.
 *
 * The thought bubble carries the question mark and is what makes the scene
 * legible in the half-second before anyone reads the heading. It is also the
 * animated element: a bobbing thought is warm, and — unlike a swaying board —
 * its pivot is its own centre, so it needs no transform-origin gymnastics to
 * stay attached to something.
 */
export function SceneNotFound({ className }: { className?: string }) {
  return (
    <Scene className={className} gradientId="notfound">
      {(ids) => (
        <>
          <Figure cx={36} cool={ids.cool} />

          <Contact cx={113} cy={99} rx={16} soften={ids.soften} />

          {/* The post, planted on the ground line rather than floating above it. */}
          <rect x="110" y="42" width="7" height="59" rx="3.5" fill={`url(#${ids.cool})`} />

          {/* Upper board, pointing back the way they came. */}
          <path
            d="M113 47 H76 L67 55.5 L76 64 H113 Z"
            fill="rgb(var(--surface))"
            stroke="rgb(var(--border-strong))"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M79 55.5 H104"
            stroke="rgb(var(--foreground))"
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.14"
          />

          {/* Lower board, pointing on. Shorter, so the pair reads as a signpost
              rather than as a symmetrical arrow. */}
          <path
            d="M114 72 H141 L150 80.5 L141 89 H114 Z"
            fill="rgb(var(--surface))"
            stroke="rgb(var(--border-strong))"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M120 80.5 H138"
            stroke="rgb(var(--foreground))"
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.14"
          />

          {/* The thought. Absolute coordinates on the animated group; the glyph
              inside gets the attribute transform (see the note in SceneError). */}
          <g className="illo-float motion-reduce:animate-none">
            <circle cx="52" cy="45" r="2" fill="rgb(var(--violet-300))" />
            <circle cx="57" cy="38" r="3.4" fill="rgb(var(--violet-300))" />
            <circle
              cx="70"
              cy="24"
              r="15"
              fill="rgb(var(--surface))"
              stroke="rgb(var(--border-strong))"
              strokeWidth="2"
            />
            {/* The hook: one arc taking the LONG way round (large-arc + sweep),
                which is what turns a 4.2-radius curve into a question mark
                rather than a comma. */}
            <g
              transform="translate(70 25)"
              fill="none"
              stroke={`url(#${ids.warm})`}
              strokeWidth="2.8"
              strokeLinecap="round"
            >
              <path d="M-4.2 -3.4 a4.2 4.2 0 1 1 4.2 4.8 v1.6" />
            </g>
            <circle cx="70" cy="31.6" r="1.8" fill="rgb(var(--violet-500))" />
          </g>
        </>
      )}
    </Scene>
  );
}
