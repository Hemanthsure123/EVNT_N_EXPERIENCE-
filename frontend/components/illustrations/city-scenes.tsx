'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { ContactShadow, DepthDefs, toneFill, useDepthIds, type IlloTone } from './depth';

/**
 * CITY SCENES — one landmark per curated city.
 *
 * ── WHY TEN DRAWINGS AND NOT ONE PIN ──────────────────────────────────────
 *
 * Every city tile showed the same `SpotCity` glyph. Ten identical pictures in
 * a ten-tile grid is not artwork, it is a bullet — the eye stops reading them
 * after the second and the tiles become a list of words with decoration.
 *
 * A landmark is the one thing that makes a city instantly itself. Nobody has
 * to be told the Charminar is Hyderabad; the shape does it faster than the
 * word underneath. That is the whole justification for the extra weight.
 *
 * ── SILHOUETTES, NOT DEPICTIONS ───────────────────────────────────────────
 *
 * These render at 36-56px on a tile. A faithful drawing of the Hawa Mahal is
 * mud at that size, so each is reduced to the two or three shapes that carry
 * the recognition — an arch, a dome, four minarets, a suspension span — in the
 * same lighting language `category-scenes.tsx` and `performer-scenes.tsx`
 * already use, reusing `depth.tsx` rather than a fourth model.
 *
 * ── AND WHERE THERE IS NO LANDMARK, THERE IS A SKYLINE ────────────────────
 *
 * `POPULAR_CITIES` is CURATION — ten cities out of every city with an event in
 * it. Every other city still gets a tile, a landing page and a chip, so the
 * fallback has to be a real picture rather than a hole: a generic skyline,
 * which is honest about being generic. Goa is drawn as a coast for the same
 * reason — a state, not a city, and it has no single building.
 *
 * ── NOTHING ANIMATES ──────────────────────────────────────────────────────
 *
 * Ten of these on the home page. The rule the other tile sets follow, and for
 * the same reason: one drifting mark is charm, ten is a page that will not sit
 * still. They react on hover through `illo-r-*` like the rest.
 */

const W = 160;
const H = 120;
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

/** A sun or moon behind the landmark — the one element every scene shares, so
 *  ten different buildings still read as one set. */
function Sky({ body, className }: { body: string; className?: string }) {
  return <circle className={cn('illo-r-glow', className)} cx="122" cy="30" r="16" fill={body} opacity="0.2" />;
}

/* ── Mumbai — the Gateway of India ────────────────────────────────────── */

export function SceneMumbai({ className }: SceneProps) {
  return (
    <Scene scope="city-mumbai" tone="accent" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={48} ry={5} ground={ids.ground} />
          {/* The great arch, and the two flanking towers with their small domes. */}
          <Solid d="M44 96V44h72v52Z" body={body} ids={ids} />
          <path d="M66 96V62a14 14 0 0 1 28 0v34Z" fill="rgb(var(--overlay))" opacity="0.36" />
          <Solid d="M36 96V56h12v40Z" body={body} ids={ids} opacity={0.92} />
          <Solid d="M112 96V56h12v40Z" body={body} ids={ids} opacity={0.92} />
          <path d="M34 56a8 8 0 0 1 16 0Z" fill={body} />
          <path d="M110 56a8 8 0 0 1 16 0Z" fill={body} />
          <path d="M62 44a18 10 0 0 1 36 0Z" fill={body} />
          {/* Water, because it stands on the harbour. */}
          <path
            d="M8 108h20M36 108h26M70 108h18M96 108h24M128 108h20"
            stroke={body}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.4"
            fill="none"
          />
        </>
      )}
    </Scene>
  );
}

/* ── Delhi — India Gate ───────────────────────────────────────────────── */

export function SceneDelhi({ className }: SceneProps) {
  return (
    <Scene scope="city-delhi" tone="amber" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={42} ry={5} ground={ids.ground} />
          <Solid d="M48 96V38h64v58Z" body={body} ids={ids} />
          {/* The single deep arch is the whole silhouette. */}
          <path d="M66 96V60a14 14 0 0 1 28 0v36Z" fill="rgb(var(--overlay))" opacity="0.4" />
          <rect x="42" y="30" width="76" height="9" rx="3" fill={body} />
          <rect x="52" y="22" width="56" height="7" rx="3" fill={body} opacity="0.85" />
          <rect x="74" y="12" width="12" height="10" rx="3" fill={body} opacity="0.7" />
        </>
      )}
    </Scene>
  );
}

/* ── Hyderabad — the Charminar ────────────────────────────────────────── */

export function SceneHyderabad({ className }: SceneProps) {
  return (
    <Scene scope="city-hyderabad" tone="magenta" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={44} ry={5} ground={ids.ground} />
          <Solid d="M50 96V46h60v50Z" body={body} ids={ids} />
          <path d="M68 96V64a12 12 0 0 1 24 0v32Z" fill="rgb(var(--overlay))" opacity="0.38" />
          <rect x="46" y="42" width="68" height="6" rx="2" fill={body} />
          {/* FOUR minarets — the name means "four towers", and it is the one
              detail that stops this being any other arch. */}
          {[42, 60, 100, 118].map((x, index) => (
            <React.Fragment key={x}>
              <rect
                x={x}
                y={index === 0 || index === 3 ? 30 : 24}
                width="8"
                height={index === 0 || index === 3 ? 14 : 20}
                rx="3"
                fill={body}
                opacity={index === 0 || index === 3 ? 0.9 : 1}
              />
              <path
                d={`M${x - 1} ${index === 0 || index === 3 ? 30 : 24}a5 6 0 0 1 10 0Z`}
                fill={body}
              />
            </React.Fragment>
          ))}
        </>
      )}
    </Scene>
  );
}

/* ── Bengaluru — the Vidhana Soudha ───────────────────────────────────── */

export function SceneBengaluru({ className }: SceneProps) {
  return (
    <Scene scope="city-bengaluru" tone="positive" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={52} ry={5} ground={ids.ground} />
          <Solid d="M28 96V58h104v38Z" body={body} ids={ids} />
          {/* The central dome on its drum. */}
          <Solid d="M62 58V46h36v12Z" body={body} ids={ids} />
          <path d="M62 46a18 16 0 0 1 36 0Z" fill={body} />
          <rect x="78" y="22" width="4" height="8" rx="2" fill={body} opacity="0.8" />
          {/* A colonnade, which is what the building actually reads as. */}
          {[34, 46, 58, 102, 114, 126].map((x) => (
            <rect key={x} x={x} y="66" width="5" height="30" rx="2" fill="rgb(var(--overlay))" opacity="0.3" />
          ))}
          <rect x="24" y="54" width="112" height="6" rx="2" fill={body} opacity="0.9" />
        </>
      )}
    </Scene>
  );
}

/* ── Chennai — a temple gopuram ───────────────────────────────────────── */

export function SceneChennai({ className }: SceneProps) {
  return (
    <Scene scope="city-chennai" tone="caution" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={40} ry={5} ground={ids.ground} />
          {/* Stepped tiers, narrowing — the gopuram's whole signature. */}
          <Solid d="M46 96V74h68v22Z" body={body} ids={ids} />
          <Solid d="M52 74V58h56v16Z" body={body} ids={ids} opacity={0.95} />
          <Solid d="M58 58V44h44v14Z" body={body} ids={ids} opacity={0.9} />
          <Solid d="M64 44V32h32v12Z" body={body} ids={ids} opacity={0.85} />
          <path d="M64 32a16 9 0 0 1 32 0Z" fill={body} />
          {[70, 80, 90].map((x) => (
            <rect key={x} x={x} y="16" width="4" height="8" rx="2" fill={body} opacity="0.75" />
          ))}
          <path d="M74 96V82a6 6 0 0 1 12 0v14Z" fill="rgb(var(--overlay))" opacity="0.38" />
        </>
      )}
    </Scene>
  );
}

/* ── Kolkata — the Howrah Bridge ──────────────────────────────────────── */

export function SceneKolkata({ className }: SceneProps) {
  return (
    <Scene scope="city-kolkata" tone="info" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={56} ry={4} ground={ids.ground} />
          {/* Two towers and the truss between them — a cantilever, not a
              suspension curve, which is what tells it from every other bridge. */}
          <Solid d="M32 92V28h14v64Z" body={body} ids={ids} />
          <Solid d="M114 92V28h14v64Z" body={body} ids={ids} />
          <rect x="24" y="86" width="112" height="7" rx="2" fill={body} />
          <path
            d="M46 34h68M46 34l22 46M114 34L92 80M68 80h24M56 34v46M104 34v46"
            stroke={body}
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.75"
            fill="none"
          />
          <path
            d="M10 106h26M44 106h30M82 106h22M112 106h30"
            stroke={body}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.4"
            fill="none"
          />
        </>
      )}
    </Scene>
  );
}

/* ── Jaipur — the Hawa Mahal ──────────────────────────────────────────── */

export function SceneJaipur({ className }: SceneProps) {
  return (
    <Scene scope="city-jaipur" tone="magenta" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={46} ry={5} ground={ids.ground} />
          <Solid d="M42 96V36h76v60Z" body={body} ids={ids} />
          {/* A honeycomb of small windows is the entire recognition, so it is
              drawn as a grid rather than as detail. */}
          {[0, 1, 2].map((row) =>
            [0, 1, 2, 3, 4].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={50 + col * 13}
                y={46 + row * 15}
                width="8"
                height="10"
                rx="4"
                fill="rgb(var(--overlay))"
                opacity="0.34"
              />
            )),
          )}
          {/* The stepped crown. */}
          {[46, 62, 78, 94, 110].map((x) => (
            <path key={x} d={`M${x} 36V28a5 5 0 0 1 10 0v8Z`} fill={body} opacity="0.9" />
          ))}
        </>
      )}
    </Scene>
  );
}

/* ── Pune — the Shaniwar Wada gate ────────────────────────────────────── */

export function ScenePune({ className }: SceneProps) {
  return (
    <Scene scope="city-pune" tone="graphite" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={44} ry={5} ground={ids.ground} />
          <Solid d="M40 96V46h80v50Z" body={body} ids={ids} />
          {/* A heavy studded gateway, deep-set. */}
          <path d="M64 96V64a16 16 0 0 1 32 0v32Z" fill="rgb(var(--overlay))" opacity="0.42" />
          {[72, 80, 88].map((x) => (
            <circle key={x} cx={x} cy="74" r="2" fill={body} opacity="0.6" />
          ))}
          {/* Battlements. */}
          {[38, 50, 62, 74, 86, 98, 110].map((x) => (
            <rect key={x} x={x} y="38" width="8" height="9" rx="2" fill={body} opacity="0.92" />
          ))}
          <Solid d="M30 96V58h12v38Z" body={body} ids={ids} opacity={0.85} />
          <Solid d="M118 96V58h12v38Z" body={body} ids={ids} opacity={0.85} />
        </>
      )}
    </Scene>
  );
}

/* ── Goa — a coast, because it is a state and has no one building ─────── */

export function SceneGoa({ className }: SceneProps) {
  return (
    <Scene scope="city-goa" tone="info" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={54} cy={97} rx={26} ry={4} ground={ids.ground} />
          {/* A palm, a shack and the sea. Drawn as a place rather than a
              landmark, and honest about that: Goa is a state. */}
          <path d="M52 96V58" stroke={body} strokeWidth="5" strokeLinecap="round" fill="none" />
          <g className="illo-r-tilt">
            <path
              d="M52 58c-12-8-22-6-28 2 10-2 16 0 20 4M52 58c12-8 22-6 28 2-10-2-16 0-20 4M52 58c-4-12 0-20 8-24-2 8-2 14 0 18"
              stroke={body}
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
          <Solid d="M92 96V74h44v22Z" body={body} ids={ids} opacity={0.9} />
          <path d="M86 74l28-14 28 14Z" fill={body} />
          <path
            d="M8 106h22M38 106h28M74 106h20M102 106h26M136 106h16"
            stroke={body}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.45"
            fill="none"
          />
        </>
      )}
    </Scene>
  );
}

/* ── Ahmedabad — the Sidi Saiyyed jaali ───────────────────────────────── */

export function SceneAhmedabad({ className }: SceneProps) {
  return (
    <Scene scope="city-ahmedabad" tone="positive" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={44} ry={5} ground={ids.ground} />
          <Solid d="M44 96V34h72v62Z" body={body} ids={ids} />
          {/* The arched lattice window the city is known for. */}
          <path d="M58 88V56a22 22 0 0 1 44 0v32Z" fill="rgb(var(--overlay))" opacity="0.34" />
          <path
            d="M80 88V54M62 70h36M68 60c8 4 8 20 0 24M92 60c-8 4-8 20 0 24"
            stroke={body}
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.65"
            fill="none"
          />
          <rect x="40" y="28" width="80" height="7" rx="2" fill={body} />
        </>
      )}
    </Scene>
  );
}

/* ── Anywhere else — a skyline, honest about being generic ────────────── */

export function SceneCityDefault({ className }: SceneProps) {
  return (
    <Scene scope="city-default" tone="neutral" className={className}>
      {(ids, body) => (
        <>
          <Sky body={body} />
          <ContactShadow cx={80} cy={97} rx={56} ry={5} ground={ids.ground} />
          {[
            [20, 62, 22],
            [46, 44, 26],
            [76, 54, 20],
            [100, 36, 24],
            [128, 66, 18],
          ].map(([x, y, w]) => (
            <Solid key={x} d={`M${x} 96V${y}h${w}v${96 - y}Z`} body={body} ids={ids} />
          ))}
          {[
            [26, 70],
            [52, 52],
            [82, 62],
            [106, 44],
            [106, 62],
          ].map(([x, y]) => (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="8"
              height="10"
              rx="2"
              fill="rgb(var(--on-gradient))"
              opacity="0.34"
            />
          ))}
        </>
      )}
    </Scene>
  );
}

const SCENES: Record<string, (props: SceneProps) => React.JSX.Element> = {
  mumbai: SceneMumbai,
  delhi: SceneDelhi,
  hyderabad: SceneHyderabad,
  bengaluru: SceneBengaluru,
  chennai: SceneChennai,
  kolkata: SceneKolkata,
  jaipur: SceneJaipur,
  pune: ScenePune,
  goa: SceneGoa,
  ahmedabad: SceneAhmedabad,
};

/**
 * The scene for a city slug, falling back to a skyline.
 *
 * The fallback is a real picture rather than a hole: `POPULAR_CITIES` is ten
 * out of every city with an event in it, and every other city still gets a
 * tile, a landing page and a chip.
 */
export function cityScene(slug: string | null | undefined) {
  return SCENES[(slug ?? '').toLowerCase()] ?? SceneCityDefault;
}

export function CityScene({ slug, className }: { slug: string; className?: string }) {
  const Art = cityScene(slug);
  return <Art className={className} />;
}
