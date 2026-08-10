'use client';

import * as React from 'react';
import type { PerformerType } from '@/lib/api/enquiries';
import { cn } from '@/lib/utils/cn';
import { ContactShadow, DepthDefs, toneFill, useDepthIds, type IlloTone } from './depth';

/**
 * PERFORMER SCENES — the marketplace's half of the illustration set.
 *
 * ── WHY THESE EXIST ───────────────────────────────────────────────────────
 *
 * `components/hire/performer-art.tsx` draws a glyph on a rounded-square plate.
 * That is well-built and it is still the right thing on a 40px avatar, but a
 * GRID of them is the iOS app-icon idiom — the exact thing the category tiles
 * were rebuilt to stop being. A squircle with a turntable on it is a symbol
 * for a DJ; it is not a picture of one.
 *
 * These are pictures, built in exactly the language `category-scenes.tsx`
 * established and reusing `depth.tsx` outright rather than a second lighting
 * model: one light from the upper left, filled bodies with a lit rim, a
 * specular on the surfaces facing the light, contact shadows so nothing
 * floats, and depth by overlap and atmosphere.
 *
 * ── THEY REACT INSIDE THEMSELVES ──────────────────────────────────────────
 *
 * Every scene carries one or two `illo-r-*` marks, which move on the ANCHOR's
 * hover — the mic lifts, the ball turns, the sparks rise. That was the whole
 * point of the reaction system: something happens inside the drawing, not to
 * the card around it. The classes are defined once in `tokens.css` and are all
 * disabled under `prefers-reduced-motion`.
 *
 * ── NO TWO ACTS SHARE A SILHOUETTE ────────────────────────────────────────
 *
 * The hard constraint, and the reason for several of the choices below. Three
 * of the nine acts — singer, anchor, comedian — would each naturally be a
 * microphone, and three identical scenes in a four-column grid is a grid
 * nobody can use. So the singer gets a STAGE with a stand, the anchor gets a
 * LECTERN with a handheld, and comedy gets a brick wall and a stool, which is
 * what a comedy room actually looks like.
 */

const W = 160;
const H = 120;
/** The line everything stands on. Shared with the category scenes, so the two
 *  sets can sit on one page without two horizons. */
const GROUND = 96;

type SceneProps = { className?: string };

function Scene({
  scope,
  tone,
  className,
  children,
}: {
  scope: string;
  tone: IlloTone;
  className?: string;
  children: (ids: ReturnType<typeof useDepthIds>, body: string) => React.ReactNode;
}) {
  const ids = useDepthIds(scope);
  const body = toneFill(tone);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="presentation"
      aria-hidden
      className={cn('size-full', className)}
    >
      <defs>
        <DepthDefs ids={ids} width={W} height={H} scale={2.5} />
      </defs>

      <rect x="0" y={GROUND} width={W} height={H - GROUND} fill={body} opacity="0.14" />
      <rect x="0" y={GROUND} width={W} height="1.5" fill={body} opacity="0.22" />

      {children(ids, body)}
    </svg>
  );
}

/** A filled form with the set's rim + volume shading, in one place. */
function Solid({
  d,
  body,
  ids,
  opacity,
  className,
}: {
  d: string;
  body: string;
  ids: ReturnType<typeof useDepthIds>;
  opacity?: number;
  className?: string;
}) {
  return (
    <g opacity={opacity} className={className}>
      <path d={d} fill={body} />
      <path d={d} fill={`url(#${ids.volume})`} />
      <path d={d} fill={`url(#${ids.rim})`} />
    </g>
  );
}

/* ── Band ─────────────────────────────────────────────────────────────────
   Three players on a small stage: a kit behind, a guitarist and a keyboard
   either side. A BAND is a group, so the scene has to show more than one
   figure — that is the whole distinction from `singer`. */

export function SceneBand({ className }: SceneProps) {
  return (
    <Scene scope="perf-band" tone="accent" className={className}>
      {(ids, body) => (
        <>
          <path d="M26 96V52a54 54 0 0 1 108 0v44Z" fill={body} opacity="0.16" />

          {/* The kit, furthest back and lowest contrast. */}
          <circle cx="80" cy="62" r="15" fill={body} opacity="0.5" />
          <circle cx="80" cy="62" r="9" fill="rgb(var(--overlay))" opacity="0.22" />
          <rect x="62" y="46" width="10" height="4" rx="2" fill={body} opacity="0.45" />
          <rect x="88" y="46" width="10" height="4" rx="2" fill={body} opacity="0.45" />

          {/* Guitarist, left. The headstock is the `illo-r-tilt` mark. */}
          <ContactShadow cx={48} cy={97} rx={16} ry={4} ground={ids.ground} />
          <circle cx="48" cy="52" r="7" fill={body} />
          <Solid d="M38 96V70a10 10 0 0 1 20 0v26Z" body={body} ids={ids} />
          <g className="illo-r-tilt">
            <ellipse cx="56" cy="76" rx="9" ry="7" fill={body} opacity="0.9" />
            <ellipse cx="56" cy="76" rx="3" ry="2.4" fill="rgb(var(--overlay))" opacity="0.34" />
            <rect
              x="60"
              y="62"
              width="18"
              height="4"
              rx="2"
              fill={body}
              transform="rotate(-28 60 64)"
            />
          </g>

          {/* Keys, right. */}
          <ContactShadow cx={114} cy={97} rx={18} ry={4} ground={ids.ground} />
          <circle cx="114" cy="52" r="7" fill={body} />
          <Solid d="M104 96V70a10 10 0 0 1 20 0v26Z" body={body} ids={ids} />
          <rect x="96" y="74" width="34" height="7" rx="2.5" fill={body} opacity="0.9" />
          {[100, 106, 112, 118, 124].map((x) => (
            <rect key={x} x={x} y="74" width="2" height="7" fill="rgb(var(--overlay))" opacity="0.3" />
          ))}
        </>
      )}
    </Scene>
  );
}

/* ── Singer ───────────────────────────────────────────────────────────────
   A mic on a stand under a spotlight, on a stage with a curtain behind. The
   STAND is what tells this apart from the anchor's handheld. */

export function SceneSinger({ className }: SceneProps) {
  return (
    <Scene scope="perf-singer" tone="magenta" className={className}>
      {(ids, body) => (
        <>
          {/* Curtain: alternating folds, dropped back. */}
          {[18, 34, 50, 96, 112, 128].map((x) => (
            <rect key={x} x={x} y="12" width="14" height="84" rx="7" fill={body} opacity="0.18" />
          ))}

          {/* The cone. It brightens rather than moves — its bounding-box centre
              is not where it radiates from. */}
          <path
            className="illo-r-glow"
            d="M80 8 L108 96 H52Z"
            fill="rgb(var(--on-gradient))"
            opacity="0.16"
          />

          <ContactShadow cx={80} cy={97} rx={22} ry={4.5} ground={ids.ground} />
          {/* The stand: base, column, boom. */}
          <ellipse cx="80" cy="94" rx="16" ry="4" fill={body} opacity="0.8" />
          <rect x="77.5" y="46" width="5" height="48" rx="2.5" fill={body} />
          <g className="illo-r-lift">
            <rect
              x="76"
              y="26"
              width="9"
              height="20"
              rx="4.5"
              fill={body}
              transform="rotate(-12 80 36)"
            />
            <rect
              x="78"
              y="29"
              width="2.5"
              height="12"
              rx="1.2"
              fill="rgb(var(--on-gradient))"
              opacity="0.45"
              transform="rotate(-12 80 36)"
            />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── DJ ───────────────────────────────────────────────────────────────────
   A booth: two decks and a mixer, a mirror ball above. The BALL is the
   reaction — it turns, which is the one thing a mirror ball does. */

export function SceneDj({ className }: SceneProps) {
  return (
    <Scene scope="perf-dj" tone="indigo" className={className}>
      {(ids, body) => (
        <>
          <rect x="76" y="0" width="3" height="16" fill={body} opacity="0.5" />
          <g className="illo-r-turn">
            <circle cx="78" cy="24" r="11" fill={body} opacity="0.85" />
            <circle cx="74" cy="20" r="4" fill="rgb(var(--on-gradient))" opacity="0.4" />
            <path
              d="M67 24h22M78 13v22M70 16l16 16M86 16L70 32"
              stroke="rgb(var(--overlay))"
              strokeWidth="1.2"
              opacity="0.3"
            />
          </g>

          <ContactShadow cx={80} cy={97} rx={44} ry={5} ground={ids.ground} />
          {/* The booth front. */}
          <Solid d="M28 96V64h104v32Z" body={body} ids={ids} />
          {/* The deck surface, catching the light. */}
          <rect x="26" y="58" width="108" height="8" rx="3" fill={body} opacity="0.95" />
          <rect x="26" y="58" width="108" height="3" rx="1.5" fill="rgb(var(--on-gradient))" opacity="0.3" />

          {/* Platters. */}
          {[52, 108].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy="48" r="13" fill={body} opacity="0.9" />
              <circle cx={cx} cy="48" r="3" fill="rgb(var(--on-gradient))" opacity="0.5" />
              <circle
                cx={cx}
                cy="48"
                r="9"
                fill="none"
                stroke="rgb(var(--overlay))"
                strokeWidth="1"
                opacity="0.28"
              />
            </g>
          ))}
          {/* The mixer's faders, between the decks. */}
          {[74, 80, 86].map((x) => (
            <rect key={x} x={x} y="42" width="3" height="12" rx="1.5" fill={body} opacity="0.7" />
          ))}
        </>
      )}
    </Scene>
  );
}

/* ── Instrumentalist ──────────────────────────────────────────────────────
   A cello and a stool under a warm wash: a solo player's corner. Strings
   rather than a guitar, so it does not read as a second `band`. */

export function SceneInstrumentalist({ className }: SceneProps) {
  return (
    <Scene scope="perf-instr" tone="amber" className={className}>
      {(ids, body) => (
        <>
          <circle cx="80" cy="52" r="40" fill={body} opacity="0.14" />

          {/* The music stand, behind and to the left. */}
          <rect x="34" y="52" width="3" height="44" fill={body} opacity="0.45" />
          <rect
            x="22"
            y="40"
            width="26"
            height="16"
            rx="3"
            fill={body}
            opacity="0.5"
            transform="rotate(-10 35 48)"
          />

          <ContactShadow cx={92} cy={97} rx={26} ry={5} ground={ids.ground} />
          {/* The body: two lobes and a waist, which is what makes it a cello
              rather than a rounded rectangle. */}
          <g className="illo-r-tilt">
            <Solid
              d="M92 96c-13 0-20-9-20-19 0-7 4-12 8-15-3-3-5-7-5-11 0-8 7-13 17-13s17 5 17 13c0 4-2 8-5 11 4 3 8 8 8 15 0 10-7 19-20 19Z"
              body={body}
              ids={ids}
            />
            {/* f-holes and the neck. */}
            <path
              d="M84 60c-2 4-2 12 0 16M100 60c2 4 2 12 0 16"
              stroke="rgb(var(--overlay))"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.35"
              fill="none"
            />
            <rect x="89.5" y="14" width="5" height="26" rx="2.5" fill={body} opacity="0.9" />
            <rect x="86" y="8" width="12" height="9" rx="4" fill={body} opacity="0.8" />
          </g>

          {/* The bow, crossing the body. */}
          <rect
            x="58"
            y="66"
            width="52"
            height="3"
            rx="1.5"
            fill={body}
            opacity="0.75"
            transform="rotate(-16 84 68)"
          />
        </>
      )}
    </Scene>
  );
}

/* ── Anchor ───────────────────────────────────────────────────────────────
   A lectern with a handheld mic and sound leaving it, in front of a screen.
   A host talks TO a room, which is why the room is in the picture. */

export function SceneAnchor({ className }: SceneProps) {
  return (
    <Scene scope="perf-anchor" tone="info" className={className}>
      {(ids, body) => (
        <>
          {/* The screen behind. */}
          <rect x="26" y="14" width="108" height="50" rx="5" fill={body} opacity="0.2" />
          <rect x="34" y="22" width="52" height="5" rx="2.5" fill={body} opacity="0.4" />
          <rect x="34" y="33" width="76" height="4" rx="2" fill={body} opacity="0.28" />
          <rect x="34" y="42" width="64" height="4" rx="2" fill={body} opacity="0.28" />

          <ContactShadow cx={80} cy={97} rx={30} ry={5} ground={ids.ground} />
          {/* The lectern: a tapered body with a lit top surface. */}
          <Solid d="M62 96V76h36v20Z" body={body} ids={ids} />
          <path d="M56 76h48l-4-8H60Z" fill={body} opacity="0.95" />
          <rect x="56" y="68" width="48" height="3" rx="1.5" fill="rgb(var(--on-gradient))" opacity="0.3" />

          {/* The handheld, and the sound coming out of it. */}
          <g className="illo-r-lift">
            <rect
              x="104"
              y="46"
              width="8"
              height="18"
              rx="4"
              fill={body}
              transform="rotate(24 108 55)"
            />
          </g>
          <g className="illo-r-glow" fill="none" stroke={body} strokeWidth="2.5" strokeLinecap="round" opacity="0.4">
            <path d="M120 44a12 12 0 0 1 0 16" />
            <path d="M128 38a22 22 0 0 1 0 28" />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Comedian ─────────────────────────────────────────────────────────────
   A brick wall, a stool and a mic stand — what a comedy room actually looks
   like. Deliberately NOT a third microphone-on-a-plate. */

export function SceneComedian({ className }: SceneProps) {
  return (
    <Scene scope="perf-comedy" tone="critical" className={className}>
      {(ids, body) => (
        <>
          {/* Brick: two offset courses, low contrast so it stays a backdrop. */}
          {[16, 30, 44, 58, 72].map((y, row) => (
            <g key={y} opacity="0.16">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <rect
                  key={i}
                  x={12 + i * 24 + (row % 2 ? -12 : 0)}
                  y={y}
                  width="21"
                  height="11"
                  rx="2"
                  fill={body}
                />
              ))}
            </g>
          ))}

          <path
            className="illo-r-glow"
            d="M96 6 L124 96 H68Z"
            fill="rgb(var(--on-gradient))"
            opacity="0.14"
          />

          {/* The stool. */}
          <ContactShadow cx={50} cy={97} rx={18} ry={4} ground={ids.ground} />
          <ellipse cx="50" cy="66" rx="15" ry="5" fill={body} opacity="0.9" />
          <rect x="48" y="66" width="4" height="28" rx="2" fill={body} opacity="0.8" />
          <path d="M38 94l10-28M62 94L52 66" stroke={body} strokeWidth="3" strokeLinecap="round" opacity="0.7" fill="none" />
          <ellipse cx="50" cy="82" rx="11" ry="3" fill={body} opacity="0.45" />

          {/* The mic stand, empty — the comic is holding it. */}
          <ContactShadow cx={100} cy={97} rx={16} ry={4} ground={ids.ground} />
          <ellipse cx="100" cy="94" rx="13" ry="3.5" fill={body} opacity="0.8" />
          <rect x="98" y="44" width="4" height="50" rx="2" fill={body} />
          <g className="illo-r-lift">
            <rect x="95" y="28" width="10" height="18" rx="5" fill={body} />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Dance crew ───────────────────────────────────────────────────────────
   Three figures mid-move on a lit floor. A CREW is a group, and the varied
   poses are what stop it reading as the generic person pictogram. */

export function SceneDanceCrew({ className }: SceneProps) {
  return (
    <Scene scope="perf-dance" tone="positive" className={className}>
      {(ids, body) => (
        <>
          {/* Floor panels, receding. */}
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={12 + i * 36}
              y="84"
              width="32"
              height="12"
              rx="2"
              fill={body}
              opacity={0.1 + i * 0.03}
            />
          ))}

          <ContactShadow cx={44} cy={97} rx={16} ry={4} ground={ids.ground} />
          <ContactShadow cx={80} cy={97} rx={16} ry={4} ground={ids.ground} />
          <ContactShadow cx={116} cy={97} rx={16} ry={4} ground={ids.ground} />

          {/* Left: arms out, leaning. Dropped back a little. */}
          <g opacity="0.68">
            <circle cx="44" cy="42" r="7" fill={body} />
            <path
              d="M44 50v22M44 72l-8 22M44 72l9 22M30 56l14 4 14-10"
              stroke={body}
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>

          {/* Centre: the tallest, one arm up. This one carries the reaction. */}
          <g className="illo-r-lift">
            <circle cx="80" cy="34" r="8" fill={body} />
            <path
              d="M80 43v24M80 67l-9 27M80 67l10 27M80 50l-14 8M80 50l16-14"
              stroke={body}
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>

          {/* Right: crouched. */}
          <g opacity="0.68">
            <circle cx="116" cy="46" r="7" fill={body} />
            <path
              d="M116 54v18M116 72l-9 22M116 72l10 22M104 62l12 2 12 6"
              stroke={body}
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Magician ─────────────────────────────────────────────────────────────
   A hat on a table with cards fanning out and sparks above it. The SPARKS
   rise on hover, which is the one reaction the act itself is about. */

export function SceneMagician({ className }: SceneProps) {
  return (
    <Scene scope="perf-magic" tone="ink" className={className}>
      {(ids, body) => (
        <>
          <circle cx="80" cy="44" r="36" fill={body} opacity="0.12" />

          {/* Sparks. */}
          <g className="illo-r-rise" opacity="0.9">
            {[
              [56, 22, 4],
              [80, 12, 5.5],
              [104, 24, 4],
              [68, 32, 3],
              [96, 34, 3],
            ].map(([cx, cy, r]) => (
              <path
                key={`${cx}-${cy}`}
                d={`M${cx} ${cy - r}l${r * 0.32} ${r * 0.68} ${r * 0.68} ${r * 0.32}-${r * 0.68} ${r * 0.32}-${r * 0.32} ${r * 0.68}-${r * 0.32}-${r * 0.68}-${r * 0.68}-${r * 0.32} ${r * 0.68}-${r * 0.32}Z`}
                fill={body}
                opacity="0.7"
              />
            ))}
          </g>

          <ContactShadow cx={80} cy={97} rx={40} ry={5} ground={ids.ground} />
          {/* The table. */}
          <rect x="24" y="86" width="112" height="7" rx="3" fill={body} opacity="0.85" />
          <rect x="24" y="86" width="112" height="2.5" rx="1.25" fill="rgb(var(--on-gradient))" opacity="0.28" />

          {/* Cards, fanned to the right. Behind the hat, so the hat overlaps
              them — overlap is what builds the depth an icon cannot have. */}
          {[-24, -12, 0, 12].map((angle, i) => (
            <rect
              key={angle}
              x="106"
              y="58"
              width="16"
              height="24"
              rx="2.5"
              fill={body}
              opacity={0.4 + i * 0.12}
              transform={`rotate(${angle} 114 82)`}
            />
          ))}

          {/* The hat: brim, then crown, then the band. */}
          <ellipse cx="72" cy="84" rx="30" ry="7" fill={body} opacity="0.95" />
          <Solid d="M54 84V52a18 8 0 0 1 36 0v32Z" body={body} ids={ids} />
          <rect x="54" y="72" width="36" height="7" fill="rgb(var(--overlay))" opacity="0.34" />
        </>
      )}
    </Scene>
  );
}

/* ── Other ────────────────────────────────────────────────────────────────
   An empty stage with the rig lit. It is the honest picture for "an act we do
   not have a drawing for": a place waiting for somebody, rather than a
   question mark. */

export function ScenePerformerOther({ className }: SceneProps) {
  return (
    <Scene scope="perf-other" tone="neutral" className={className}>
      {(ids, body) => (
        <>
          <path d="M30 96V56a50 50 0 0 1 100 0v40Z" fill={body} opacity="0.16" />

          <rect x="30" y="16" width="100" height="6" rx="3" fill={body} opacity="0.75" />
          {[44, 66, 94, 116].map((x) => (
            <React.Fragment key={x}>
              <circle cx={x} cy="26" r="4.5" fill={body} />
              <path
                className="illo-r-glow"
                d={`M${x - 6} 30 L${x - 20} 96 H${x + 20} L${x + 6} 30Z`}
                fill="rgb(var(--on-gradient))"
                opacity="0.1"
              />
            </React.Fragment>
          ))}

          <ContactShadow cx={80} cy={97} rx={44} ry={5} ground={ids.ground} />
          <Solid d="M36 96V80h88v16Z" body={body} ids={ids} />
          <rect x="34" y="76" width="92" height="5" rx="2.5" fill={body} opacity="0.95" />
        </>
      )}
    </Scene>
  );
}

const SCENES: Record<PerformerType, (props: SceneProps) => React.JSX.Element> = {
  band: SceneBand,
  singer: SceneSinger,
  dj: SceneDj,
  instrumentalist: SceneInstrumentalist,
  anchor: SceneAnchor,
  comedian: SceneComedian,
  dance_crew: SceneDanceCrew,
  magician: SceneMagician,
  other: ScenePerformerOther,
};

/**
 * The scene for one kind of act, falling back to the empty stage.
 *
 * The fallback is a real picture rather than nothing: `PerformerType` is a
 * server enum, and a value this build has not seen yet must render as a stage
 * waiting for somebody, not as a hole in the grid.
 */
export function performerScene(type: PerformerType | string) {
  return SCENES[type as PerformerType] ?? ScenePerformerOther;
}

export function PerformerScene({
  type,
  className,
}: {
  type: PerformerType | string;
  className?: string;
}) {
  const Art = performerScene(type);
  return <Art className={className} />;
}
