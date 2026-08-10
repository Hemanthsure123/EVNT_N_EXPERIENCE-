'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { ContactShadow, DepthDefs, toneFill, useDepthIds, type IlloTone } from './depth';

/**
 * CATEGORY SCENES — the fourth and largest rung of the illustration set.
 *
 * ── WHY THE CLAY ICONS WERE NOT ENOUGH ────────────────────────────────────
 *
 * `clay.tsx` is well-built and is still right for what it is: a single object
 * on a rounded-square plate. But that IS the iOS app-icon idiom, and a grid of
 * them reads exactly as it was described — "more likely an icon or emoji". A
 * squircle with a music note on it is a SYMBOL FOR concerts; it is not a
 * picture of one.
 *
 * These are pictures. A stage with a lit backdrop and a speaker stack. A mic
 * under a spotlight against a brick wall. Tents under bunting. Each is a small
 * composed scene with a horizon, a foreground and a background, so the eye
 * reads a place rather than a pictogram.
 *
 * ── WHAT MAKES THEM READ AS DIMENSIONAL ───────────────────────────────────
 *
 * The same five moves `clay.tsx` documents, applied to a SCENE instead of an
 * object, and reusing `depth.tsx` outright rather than a second lighting model:
 *
 *  1. One light direction, upper-left, across every element.
 *  2. Bodies are FILLED forms with a rim on the lit edge — never stroked
 *     outlines, which is what makes an illustration read as a line icon.
 *  3. A specular on the one or two surfaces actually facing the light.
 *  4. Cast shadows onto the surface below, so objects sit IN the scene.
 *  5. Depth by overlap and by atmosphere: far elements are lower-contrast, near
 *     ones are fully saturated. That is what a flat icon cannot do.
 *
 * ── 4:3, AND WHY NOT SQUARE ───────────────────────────────────────────────
 *
 * A 160×120 box. Scenes have a horizon and a horizon needs width; the clay set
 * is square because a single object is. It also matches the aspect these are
 * actually placed in — a category tile's artwork band and a card's poster area
 * are both wider than tall at the sizes that matter.
 *
 * ── NOTHING ANIMATES ──────────────────────────────────────────────────────
 *
 * Eight on the homepage, twenty on a browse grid. One drifting mark beside a
 * heading is charm; twenty is a page that will not sit still. The set's
 * existing test enforces this.
 */

const W = 160;
const H = 120;
/** The line everything stands on. */
const GROUND = 96;

type SceneProps = { className?: string };

/**
 * The shell: viewBox, lighting defs, ground plane and the tinted backdrop every
 * scene shares. Written once so eight scenes cannot drift into eight different
 * lighting models — which is precisely how an illustration set stops looking
 * like a set.
 */
function Scene({
  scope,
  tone,
  className,
  children,
}: {
  scope: string;
  /** The scene's dominant body colour. */
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

      {/* The floor. A soft band rather than a hard line — a hard edge reads as
          a horizon on a poster, a soft one as a surface receding. */}
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
}: {
  d: string;
  body: string;
  ids: ReturnType<typeof useDepthIds>;
  opacity?: number;
}) {
  return (
    <g opacity={opacity}>
      <path d={d} fill={body} />
      <path d={d} fill={`url(#${ids.volume})`} />
      <path d={d} fill={`url(#${ids.rim})`} />
    </g>
  );
}

/* ── Concerts ─────────────────────────────────────────────────────────────
   A stage: a lit arch backdrop, a speaker stack either side, a mic stand
   centre. NOT a music note — a note is notation, and what somebody buys a
   concert ticket for is a room with a stage in it. */

export function SceneConcerts({ className }: SceneProps) {
  return (
    <Scene scope="concerts" tone="accent" className={className}>
      {(ids, body) => (
        <>
          {/* The lit arch behind everything — the stage wash. */}
          <path d="M40 96 V56a40 40 0 0 1 80 0v40Z" fill={body} opacity="0.22" />
          <path d="M52 96 V60a28 28 0 0 1 56 0v36Z" fill={body} opacity="0.16" />

          {/* Light beams from the rig, widening downward. Low opacity so they
              read as light rather than as solid wedges. */}
          <path
            className="illo-r-glow"
            d="M62 24 L44 96 H60 L70 24Z"
            fill="rgb(var(--on-gradient))"
            opacity="0.14"
          />
          <path
            className="illo-r-glow"
            d="M98 24 L116 96 H100 L90 24Z"
            fill="rgb(var(--on-gradient))"
            opacity="0.14"
          />

          {/* The lighting bar. */}
          <rect x="34" y="18" width="92" height="6" rx="3" fill={body} opacity="0.75" />
          {[46, 66, 94, 114].map((x) => (
            <circle key={x} cx={x} cy="27" r="4" fill={body} />
          ))}

          {/* Speaker stacks. Two boxes each, the near one fully saturated and
              the far one dropped back — atmosphere, which is the thing an icon
              cannot do. */}
          <ContactShadow cx={34} cy={97} rx={20} ry={4} ground={ids.ground} />
          <ContactShadow cx={126} cy={97} rx={20} ry={4} ground={ids.ground} />
          <Solid d="M20 96 V52h28v44Z" body={body} ids={ids} />
          <Solid d="M112 96 V52h28v44Z" body={body} ids={ids} />
          {[
            [26, 60],
            [26, 78],
            [118, 60],
            [118, 78],
          ].map(([x, y]) => (
            <circle
              key={`${x}-${y}`}
              cx={x + 8}
              cy={y + 6}
              r="6.5"
              fill="rgb(var(--overlay))"
              opacity="0.34"
            />
          ))}

          {/* The mic stand, centre, nearest the viewer. */}
          <ContactShadow cx={80} cy={97} rx={14} ry={3.5} ground={ids.ground} />
          <rect x="78.5" y="58" width="3" height="38" rx="1.5" fill={body} />
          <g className="illo-r-lift">
            <Solid
              d="M80 44a7 7 0 0 1 7 7v5a7 7 0 0 1-14 0v-5a7 7 0 0 1 7-7Z"
              body={body}
              ids={ids}
            />
            <ellipse cx="77" cy="48" rx="2.4" ry="3.4" fill={`url(#${ids.spec})`} />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Comedy ───────────────────────────────────────────────────────────────
   The single most recognisable image in stand-up: one mic on a stand, one
   stool, one spotlight, a brick wall. */

export function SceneComedy({ className }: SceneProps) {
  return (
    <Scene scope="comedy" tone="magenta" className={className}>
      {(ids, body) => (
        <>
          {/* Brick wall, receding. Rows offset like real bond, at low opacity so
              it sits behind. */}
          <g opacity="0.13" fill={body}>
            {[30, 42, 54, 66, 78].map((y, row) =>
              Array.from({ length: 7 }, (_, col) => (
                <rect
                  key={`${y}-${col}`}
                  x={18 + col * 20 + (row % 2 ? -10 : 0)}
                  y={y}
                  width="17"
                  height="9"
                  rx="2"
                />
              )),
            )}
          </g>

          {/* The spotlight cone. */}
          <path
            className="illo-r-glow"
            d="M80 8 L48 96 H112Z"
            fill="rgb(var(--on-gradient))"
            opacity="0.16"
          />
          <ellipse cx="80" cy="96" rx="32" ry="7" fill="rgb(var(--on-gradient))" opacity="0.2" />

          {/* The stool, slightly off-centre — dead centre reads as a diagram. */}
          <ContactShadow cx={108} cy={97} rx={16} ry={4} ground={ids.ground} />
          <Solid d="M96 70h24v4H96Z" body={body} ids={ids} />
          <g fill={body} opacity="0.9">
            <rect x="99" y="74" width="3" height="22" rx="1.5" />
            <rect x="114" y="74" width="3" height="22" rx="1.5" />
            <rect x="99" y="84" width="18" height="2.5" rx="1.25" />
          </g>

          {/* The mic, front and centre and fully saturated. */}
          <ContactShadow cx={62} cy={97} rx={16} ry={4} ground={ids.ground} />
          <path d="M56 96q6-4 12 0Z" fill={body} opacity="0.8" />
          <rect x="60.5" y="56" width="3" height="40" rx="1.5" fill={body} />
          <g className="illo-r-lift">
            <Solid
              d="M62 30a8 8 0 0 1 8 8v8a8 8 0 0 1-16 0v-8a8 8 0 0 1 8-8Z"
              body={body}
              ids={ids}
            />
            <path
              d="M52 46a10 10 0 0 0 20 0"
              fill="none"
              stroke={body}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <ellipse cx="58.5" cy="35" rx="2.6" ry="3.6" fill={`url(#${ids.spec})`} />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Workshops ────────────────────────────────────────────────────────────
   A workbench seen from the front: a board, tools in a pot, an open notebook.
   Making something, rather than a pencil floating on a tile. */

export function SceneWorkshops({ className }: SceneProps) {
  return (
    <Scene scope="workshops" tone="info" className={className}>
      {(ids, body) => (
        <>
          {/* A pegboard behind the bench. */}
          <rect x="26" y="16" width="108" height="46" rx="6" fill={body} opacity="0.14" />
          <g fill={body} opacity="0.22">
            {[24, 34, 44, 54].map((y) =>
              [36, 48, 60, 72, 84, 96, 108, 120].map((x) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />
              )),
            )}
          </g>

          {/* The bench top — the horizon of the scene. */}
          <ContactShadow cx={80} cy={98} rx={58} ry={5} ground={ids.ground} />
          <Solid d="M18 74h124v9a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3Z" body={body} ids={ids} />
          <g fill={body} opacity="0.55">
            <rect x="28" y="86" width="5" height="10" rx="2" />
            <rect x="127" y="86" width="5" height="10" rx="2" />
          </g>

          {/* A pot of tools, standing on the bench. */}
          <Solid d="M34 74V56h20v18Z" body={body} ids={ids} />
          <g className="illo-r-lift" opacity="0.9">
            <rect x="38" y="38" width="3.5" height="20" rx="1.75" fill={body} />
            <path d="M44 38l4 4-4 4Z" fill={body} />
            <rect x="46" y="42" width="3.5" height="16" rx="1.75" fill={body} />
          </g>

          {/* An open notebook, near side, catching the light. */}
          <Solid d="M66 74l16-8 16 8-16 6Z" body={body} ids={ids} />
          <path d="M82 66v14" stroke="rgb(var(--overlay))" strokeWidth="1.4" opacity="0.4" />

          {/* A plant, because a bench with something living on it reads as a
              room somebody works in rather than a product shot. */}
          <Solid d="M108 74V62h14v12Z" body={body} ids={ids} />
          <g fill={body} opacity="0.85">
            <path d="M115 62c-8-2-10-10-4-14 5 3 6 9 4 14Z" />
            <path d="M115 62c8-3 9-11 3-14-5 4-5 10-3 14Z" />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Sports ───────────────────────────────────────────────────────────────
   A stand under floodlights with a pitch line — the place, not a trophy. A
   trophy is the outcome; a ticket buys the stadium. */

export function SceneSports({ className }: SceneProps) {
  return (
    <Scene scope="sports" tone="positive" className={className}>
      {(ids, body) => (
        <>
          {/* Two floodlight masts. */}
          {[
            [28, 20],
            [132, 20],
          ].map(([x, y]) => (
            <g key={x}>
              <rect
                x={x - 1.5}
                y={y}
                width="3"
                height={GROUND - y}
                rx="1.5"
                fill={body}
                opacity="0.6"
              />
              <Solid d={`M${x - 13} ${y - 12}h26v11h-26Z`} body={body} ids={ids} />
              <path
                d={`M${x - 13} ${y - 1} L${x - 34} 96 H${x + 34} L${x + 13} ${y - 1}Z`}
                fill="rgb(var(--on-gradient))"
                opacity="0.1"
              />
            </g>
          ))}

          {/* The stand: a raked block of seats, receding. */}
          <path d="M34 96V70l46-14 46 14v26Z" fill={body} opacity="0.22" />
          <g fill={body} opacity="0.34">
            {[76, 83, 90].map((y, row) => (
              <rect key={y} x={40 + row * 4} y={y} width={80 - row * 8} height="4" rx="2" />
            ))}
          </g>

          {/* The pitch line and centre circle, in front. */}
          <path
            d="M14 112a66 22 0 0 1 132 0"
            fill="none"
            stroke="rgb(var(--on-gradient))"
            strokeWidth="2"
            opacity="0.5"
          />
          <ContactShadow cx={80} cy={106} rx={26} ry={5} ground={ids.ground} />

          {/* The ball, nearest the viewer and fully lit. */}
          <ContactShadow cx={80} cy={105} rx={12} ry={3} ground={ids.ground} />
          <g className="illo-r-hop">
            <circle cx="80" cy="96" r="11" fill={body} />
            <circle cx="80" cy="96" r="11" fill={`url(#${ids.volume})`} />
            <circle cx="80" cy="96" r="11" fill={`url(#${ids.rim})`} />
            <g fill="rgb(var(--overlay))" opacity="0.34">
              <path d="M80 89l4 3-1.5 5h-5L76 92Z" />
            </g>
            <ellipse cx="76" cy="92" rx="3" ry="4" fill={`url(#${ids.spec})`} />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Festivals ────────────────────────────────────────────────────────────
   Tents under bunting with a big wheel behind. Outdoors, several days, more
   than one thing happening at once. */

export function SceneFestivals({ className }: SceneProps) {
  return (
    <Scene scope="festivals" tone="amber" className={className}>
      {(ids, body) => (
        <>
          {/* The big wheel, far back and low contrast. */}
          <g className="illo-r-turn" opacity="0.2" fill="none" stroke={body} strokeWidth="2.5">
            <circle cx="122" cy="52" r="24" />
            <path d="M122 28v48M98 52h48M105 35l34 34M139 35l-34 34" />
          </g>
          <rect x="120.5" y="52" width="3" height="44" fill={body} opacity="0.2" />

          {/* Bunting, strung across the top. A catenary, not a straight line —
              a straight rope reads as a border. */}
          <path d="M8 20q72 26 144 0" fill="none" stroke={body} strokeWidth="1.6" opacity="0.45" />
          {Array.from({ length: 9 }, (_, index) => {
            const t = index / 8;
            const x = 8 + t * 144;
            // Same catenary, sampled — so a flag never floats off its own rope.
            const y = 20 + 26 * (1 - (2 * t - 1) ** 2) * 0.75;
            return (
              <path
                key={index}
                d={`M${x - 4} ${y}h8l-4 9Z`}
                fill={body}
                opacity={index % 2 ? 0.75 : 0.5}
              />
            );
          })}

          {/* Two tents. The near one overlaps the far one, which is the
              cheapest and most reliable depth cue there is. */}
          <ContactShadow cx={102} cy={97} rx={26} ry={5} ground={ids.ground} />
          <Solid d="M102 50l30 46H72Z" body={body} ids={ids} opacity={0.72} />

          <ContactShadow cx={58} cy={98} rx={34} ry={6} ground={ids.ground} />
          <Solid d="M58 40l38 56H20Z" body={body} ids={ids} />
          {/* The doorway, CUT with evenodd rather than painted in a background
              colour — a knockout stops being a hole on any surface that is not
              that colour. */}
          <path
            d="M58 40l38 56H20Z M58 66l12 30H46Z"
            fill="rgb(var(--overlay))"
            fillRule="evenodd"
            opacity="0.34"
          />
          <ellipse cx="48" cy="62" rx="4" ry="7" fill={`url(#${ids.spec})`} />
        </>
      )}
    </Scene>
  );
}

/* ── Nightlife ────────────────────────────────────────────────────────────
   A booth under a mirror ball, with beams. The room, at 1am. */

export function SceneNightlife({ className }: SceneProps) {
  return (
    <Scene scope="nightlife" tone="indigo" className={className}>
      {(ids, body) => (
        <>
          {/* Beams from the ball, radiating. Drawn before the ball so they
              emerge from behind it. */}
          <g className="illo-r-glow" opacity="0.15" fill="rgb(var(--on-gradient))">
            <path d="M80 26L26 96h16l40-70Z" />
            <path d="M80 26l54 70h-16L78 26Z" />
            <path d="M80 26L54 96h12l16-70Z" />
            <path d="M80 26l26 70H94L78 26Z" />
          </g>

          {/* The mirror ball. */}
          <rect x="78.5" y="4" width="3" height="10" fill={body} opacity="0.6" />
          <g className="illo-r-turn">
            <circle cx="80" cy="24" r="14" fill={body} />
            <circle cx="80" cy="24" r="14" fill={`url(#${ids.volume})`} />
            <circle cx="80" cy="24" r="14" fill={`url(#${ids.rim})`} />
          </g>
          <g fill="rgb(var(--overlay))" opacity="0.3">
            {[-8, -2, 4, 10].map((dy) =>
              [-9, -3, 3, 9].map((dx) => (
                <rect key={`${dx}-${dy}`} x={80 + dx} y={24 + dy} width="4" height="4" rx="1" />
              )),
            )}
          </g>
          <ellipse cx="75" cy="19" rx="3.4" ry="4.4" fill={`url(#${ids.spec})`} />

          {/* The booth, with two decks. */}
          <ContactShadow cx={80} cy={98} rx={48} ry={6} ground={ids.ground} />
          <Solid d="M34 96V66h92v30Z" body={body} ids={ids} />
          <g>
            {[54, 106].map((cx) => (
              <React.Fragment key={cx}>
                <circle cx={cx} cy="60" r="11" fill={body} />
                <circle cx={cx} cy="60" r="11" fill={`url(#${ids.rim})`} />
                <circle cx={cx} cy="60" r="3" fill="rgb(var(--overlay))" opacity="0.45" />
              </React.Fragment>
            ))}
            {/* The mixer between them. */}
            <rect x="70" y="54" width="20" height="12" rx="3" fill={body} />
            <rect x="70" y="54" width="20" height="12" rx="3" fill={`url(#${ids.rim})`} />
            <g fill="rgb(var(--overlay))" opacity="0.4">
              <rect x="73" y="57" width="2" height="6" rx="1" />
              <rect x="79" y="57" width="2" height="6" rx="1" />
              <rect x="85" y="57" width="2" height="6" rx="1" />
            </g>
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Food & Drink ─────────────────────────────────────────────────────────
   A laid table: a plate, a glass, steam. Not cutlery on a tile — cutlery is a
   pictogram for "restaurant"; a laid place is an evening out. */

export function SceneFoodDrink({ className }: SceneProps) {
  return (
    <Scene scope="food" tone="critical" className={className}>
      {(ids, body) => (
        <>
          {/* An arch behind, suggesting a room. */}
          <path d="M44 96V50a36 36 0 0 1 72 0v46Z" fill={body} opacity="0.13" />

          {/* Steam, rising. Thin, wavy, low opacity — the one soft thing. */}
          <g
            fill="none"
            stroke="rgb(var(--on-gradient))"
            strokeWidth="2.4"
            strokeLinecap="round"
            opacity="0.4"
          >
            <path d="M70 46q6-6 0-12t0-12" />
            <path d="M84 42q6-6 0-11t0-10" />
          </g>

          {/* The table. */}
          <ContactShadow cx={80} cy={99} rx={56} ry={6} ground={ids.ground} />
          <Solid d="M14 88h132v8a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2Z" body={body} ids={ids} />

          {/* The plate, in perspective — an ellipse, never a circle. A circle
              here is the single strongest tell that a scene is a flat icon. */}
          <ellipse cx="74" cy="82" rx="30" ry="9" fill={body} />
          <ellipse cx="74" cy="82" rx="30" ry="9" fill={`url(#${ids.rim})`} />
          <ellipse cx="74" cy="80.5" rx="20" ry="5.5" fill="rgb(var(--overlay))" opacity="0.26" />

          {/* The glass, catching the light. */}
          <ContactShadow cx={122} cy={90} rx={12} ry={3} ground={ids.ground} />
          <Solid d="M112 52h20l-4 30h-12Z" body={body} ids={ids} />
          <rect x="119.5" y="82" width="5" height="6" fill={body} />
          <ellipse cx="127" cy="88" rx="9" ry="2.6" fill={body} />
          <ellipse cx="117" cy="60" rx="2.4" ry="6" fill={`url(#${ids.spec})`} />

          {/* Cutlery, laid — flat on the table, at the plate's side. */}
          <g fill={body} opacity="0.85">
            <rect x="34" y="74" width="2.6" height="14" rx="1.3" />
            <path d="M32 68h6v6h-6Z" />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Tech ─────────────────────────────────────────────────────────────────
   A talk: a screen with a slide, a lectern, seat backs in the foreground. A
   conference is a room of people watching something, not a microchip. */

export function SceneTech({ className }: SceneProps) {
  return (
    <Scene scope="tech" tone="graphite" className={className}>
      {(ids, body) => (
        <>
          {/* The projection screen. */}
          <ContactShadow cx={86} cy={97} rx={46} ry={5} ground={ids.ground} />
          <Solid d="M32 14h108v52H32Z" body={body} ids={ids} />
          {/* A slide: a title bar and a simple rising chart. Abstract on
              purpose — a legible chart would be data nobody measured. */}
          <g fill="rgb(var(--on-gradient))" opacity="0.5">
            <rect x="40" y="22" width="34" height="4" rx="2" />
            <rect className="illo-r-grow" x="40" y="52" width="8" height="8" rx="2" />
            <rect className="illo-r-grow" x="52" y="46" width="8" height="14" rx="2" />
            <rect className="illo-r-grow" x="64" y="38" width="8" height="22" rx="2" />
            <rect className="illo-r-grow" x="76" y="42" width="8" height="18" rx="2" />
          </g>
          <path d="M32 14h108v10H32Z" fill={`url(#${ids.spec})`} opacity="0.5" />

          {/* The stand. */}
          <rect x="84.5" y="66" width="3" height="12" fill={body} opacity="0.7" />

          {/* The lectern, offset right. */}
          <Solid d="M116 96V70h20v26Z" body={body} ids={ids} opacity={0.9} />
          <rect x="113" y="66" width="26" height="5" rx="2.5" fill={body} />

          {/* Seat backs, foreground, cropped by the frame — the cheapest way to
              say "you are sitting in the audience". */}
          <g fill={body} opacity="0.55">
            {[6, 44, 82, 120].map((x) => (
              <rect key={x} x={x} y="88" width="30" height="20" rx="7" />
            ))}
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Fallback ─────────────────────────────────────────────────────────────
   For an event whose wording matches none of the eight. A ticket on a stand:
   generic without being empty, and the one shape that is true of EVERY event
   on the platform. */

export function SceneEvent({ className }: SceneProps) {
  return (
    <Scene scope="event" tone="neutral" className={className}>
      {(ids, body) => (
        <>
          <path d="M40 96V44a40 26 0 0 1 80 0v52Z" fill={body} opacity="0.14" />
          <ContactShadow cx={80} cy={98} rx={40} ry={6} ground={ids.ground} />
          {/* The stub, with its notches CUT into the path. */}
          <Solid d="M36 40h88v20a8 8 0 0 0 0 16v20H36V76a8 8 0 0 0 0-16Z" body={body} ids={ids} />
          <g fill="rgb(var(--overlay))" opacity="0.34">
            <rect x="48" y="52" width="34" height="4" rx="2" />
            <rect x="48" y="62" width="22" height="4" rx="2" />
            <rect x="48" y="78" width="28" height="4" rx="2" />
          </g>
          <ellipse cx="52" cy="50" rx="4" ry="6" fill={`url(#${ids.spec})`} />
        </>
      )}
    </Scene>
  );
}

/* ───────────────────────────────────────────────────────────────────────── */

const BY_SLUG: Record<string, (props: SceneProps) => React.JSX.Element> = {
  concerts: SceneConcerts,
  comedy: SceneComedy,
  workshops: SceneWorkshops,
  sports: SceneSports,
  festivals: SceneFestivals,
  nightlife: SceneNightlife,
  'food-drink': SceneFoodDrink,
  tech: SceneTech,
};

/**
 * The scene for a category slug, falling back to the generic ticket rather than
 * to nothing — an unknown slug is common (`inferCategory` returns none whenever
 * an event's wording matches no keyword) and must never render an empty box.
 */
export function categorySceneFor(slug: string | null | undefined) {
  return (slug && BY_SLUG[slug]) || SceneEvent;
}

export function CategoryScene({ slug, className }: { slug: string; className?: string }) {
  const Component = categorySceneFor(slug);
  return <Component className={className} />;
}
