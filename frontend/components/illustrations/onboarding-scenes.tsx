'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { ContactShadow, DepthDefs, toneFill, useDepthIds, type IlloTone } from './depth';

/**
 * ONBOARDING SCENES — one per step of the welcome flow, plus the finish.
 *
 * Same language as `category-scenes.tsx` and `performer-scenes.tsx`, reusing
 * `depth.tsx` rather than a fourth lighting model: one light from the upper
 * left, filled bodies with a lit rim, contact shadows so nothing floats, and
 * depth by overlap and atmosphere.
 *
 * ── THESE ONES DO ANIMATE, AND THAT IS THE DIFFERENCE ─────────────────────
 *
 * The category and performer sets are deliberately still: eight or nine of
 * them render at once on a browse grid, and a page of drifting artwork will
 * not sit still. Here there is exactly ONE on screen at a time, it is the
 * largest thing on it, and the person is being asked to fill in a form they
 * did not come for — so a scene with a little life in it is doing work rather
 * than competing for attention.
 *
 * Every animation is a CSS class from `tokens.css`, which means every one of
 * them is off under `prefers-reduced-motion` by the rule already written
 * there. Nothing here uses SMIL (`<animate>`), which that media query cannot
 * reach.
 *
 * ── SIZE: 200×150, LARGER THAN THE OTHER SETS ─────────────────────────────
 *
 * The others are 160×120 because they render at 40-60px in a grid. These are
 * the hero of a dialog at 200-260px, where the extra room buys detail that
 * would be mud at tile size.
 */

const W = 200;
const H = 150;
const GROUND = 122;

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

/* ── Welcome ──────────────────────────────────────────────────────────────
   A door standing open with light coming through it, and a ticket on the mat.
   The first thing the flow says is "you are in", and a door that is open is
   the picture of that — where a waving hand or a confetti burst would be
   celebrating something the person has not done yet. */

export function SceneWelcome({ className }: SceneProps) {
  return (
    <Scene scope="onb-welcome" tone="accent" className={className}>
      {(ids, body) => (
        <>
          {/* The light through the doorway, widening across the floor. */}
          <path
            className="illo-a-pulse"
            d="M78 30 L152 122 H36Z"
            fill="rgb(var(--on-gradient))"
            opacity="0.16"
          />

          <ContactShadow cx={78} cy={123} rx={40} ry={5} ground={ids.ground} />
          {/* The frame, then the leaf swung open towards the light. */}
          <Solid d="M46 122V38a32 32 0 0 1 64 0v84h-10V44a22 22 0 0 0-44 0v78Z" body={body} ids={ids} />
          <Solid
            d="M110 122V40l34 10v72Z"
            body={body}
            ids={ids}
            opacity={0.9}
            className="illo-a-swing"
          />
          <circle cx="116" cy="86" r="3.5" fill="rgb(var(--on-gradient))" opacity="0.7" />

          {/* A ticket on the mat — the reason anybody is here. */}
          <ContactShadow cx={64} cy={121} rx={20} ry={3.5} ground={ids.ground} />
          <g className="illo-a-float">
            <rect
              x="42"
              y="104"
              width="44"
              height="16"
              rx="4"
              fill={body}
              transform="rotate(-8 64 112)"
            />
            <circle cx="64" cy="112" r="3" fill="rgb(var(--overlay))" opacity="0.34" />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Your name ────────────────────────────────────────────────────────────
   A ticket being written on — a nib above a name line. The step asks for the
   name that is PRINTED on tickets, so the picture is that, rather than a
   generic form or a person icon. */

export function SceneYourName({ className }: SceneProps) {
  return (
    <Scene scope="onb-name" tone="indigo" className={className}>
      {(ids, body) => (
        <>
          <circle cx="100" cy="60" r="52" fill={body} opacity="0.12" />

          <ContactShadow cx={98} cy={123} rx={54} ry={6} ground={ids.ground} />
          {/* The ticket, lying at a slight angle so it reads as an object on a
              surface rather than a rectangle on a page. */}
          <g transform="rotate(-4 100 88)">
            <Solid d="M40 56h120v64H40Z" body={body} ids={ids} />
            {/* The stub perforation. */}
            <path
              d="M126 56v64"
              stroke="rgb(var(--overlay))"
              strokeWidth="2"
              strokeDasharray="5 5"
              opacity="0.4"
              fill="none"
            />
            {/* The name line, and a second shorter one under it. */}
            <rect x="54" y="80" width="58" height="6" rx="3" fill="rgb(var(--on-gradient))" opacity="0.5" />
            <rect x="54" y="94" width="34" height="5" rx="2.5" fill="rgb(var(--on-gradient))" opacity="0.3" />
            <circle cx="143" cy="88" r="9" fill="rgb(var(--on-gradient))" opacity="0.35" />
          </g>

          {/* The nib, drifting just above the line it is about to write. */}
          <g className="illo-a-write">
            <path d="M126 22l14 14-46 46-18 4 4-18Z" fill={body} />
            <path d="M126 22l14 14-46 46-18 4 4-18Z" fill={`url(#${ids.rim})`} />
            <path d="M80 68l18 18" stroke="rgb(var(--overlay))" strokeWidth="2" opacity="0.3" fill="none" />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Your photo ───────────────────────────────────────────────────────────
   A framed picture on an easel with a camera beside it. The step is about a
   portrait, and a frame with something IN it says that better than a camera
   alone, which would read as "take a photo now". */

export function SceneYourPhoto({ className }: SceneProps) {
  return (
    <Scene scope="onb-photo" tone="magenta" className={className}>
      {(ids, body) => (
        <>
          <circle cx="86" cy="58" r="48" fill={body} opacity="0.12" />

          <ContactShadow cx={86} cy={123} rx={46} ry={6} ground={ids.ground} />
          {/* Easel legs, behind the frame so the frame overlaps them. */}
          <path
            d="M62 122l16-58M110 122L94 64M70 96h32"
            stroke={body}
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.55"
            fill="none"
          />

          {/* The frame, and the portrait inside it: a horizon and a head, which
              is what a photograph of a person looks like at this size. */}
          <g className="illo-a-float">
            <Solid d="M44 20h84v66H44Z" body={body} ids={ids} />
            <rect x="52" y="28" width="68" height="50" rx="3" fill="rgb(var(--overlay))" opacity="0.26" />
            <circle cx="86" cy="48" r="11" fill="rgb(var(--on-gradient))" opacity="0.42" />
            <path d="M64 78a22 22 0 0 1 44 0Z" fill="rgb(var(--on-gradient))" opacity="0.42" />
          </g>

          {/* The camera, to the right and a step back. */}
          <ContactShadow cx={156} cy={123} rx={22} ry={4} ground={ids.ground} />
          <Solid d="M132 122V88h48v34Z" body={body} ids={ids} opacity={0.85} />
          <rect x="146" y="82" width="20" height="8" rx="3" fill={body} opacity="0.85" />
          <circle cx="156" cy="104" r="11" fill="rgb(var(--overlay))" opacity="0.34" />
          <circle className="illo-a-pulse" cx="156" cy="104" r="6" fill="rgb(var(--on-gradient))" opacity="0.5" />
        </>
      )}
    </Scene>
  );
}

/* ── About you ────────────────────────────────────────────────────────────
   A calendar page with a card beside it. Both steps' fields in one picture —
   the date is the date of birth, the card is the optional detail — and
   deliberately quiet, because this is the step people are most likely to
   want to walk past. */

export function SceneAboutYou({ className }: SceneProps) {
  return (
    <Scene scope="onb-about" tone="info" className={className}>
      {(ids, body) => (
        <>
          <circle cx="100" cy="62" r="50" fill={body} opacity="0.12" />

          <ContactShadow cx={80} cy={123} rx={40} ry={5} ground={ids.ground} />
          {/* The calendar: block, torn header, rings, a marked day. */}
          <g className="illo-a-float">
            <Solid d="M34 40h92v80H34Z" body={body} ids={ids} />
            <rect x="34" y="40" width="92" height="20" fill="rgb(var(--overlay))" opacity="0.3" />
            {[52, 80, 108].map((x) => (
              <rect key={x} x={x} y="30" width="6" height="18" rx="3" fill={body} opacity="0.9" />
            ))}
            {[0, 1, 2].map((row) =>
              [0, 1, 2, 3].map((col) => (
                <rect
                  key={`${row}-${col}`}
                  x={46 + col * 20}
                  y={70 + row * 16}
                  width="12"
                  height="9"
                  rx="2"
                  fill="rgb(var(--on-gradient))"
                  opacity="0.24"
                />
              )),
            )}
            {/* The one marked day. */}
            <circle className="illo-a-pulse" cx="92" cy="91" r="9" fill="rgb(var(--on-gradient))" opacity="0.55" />
          </g>

          {/* A small card, leaning against the calendar. */}
          <ContactShadow cx={152} cy={123} rx={24} ry={4} ground={ids.ground} />
          <g transform="rotate(6 152 100)">
            <Solid d="M126 122V78h52v44Z" body={body} ids={ids} opacity={0.88} />
            <circle cx="142" cy="94" r="7" fill="rgb(var(--on-gradient))" opacity="0.42" />
            <rect x="154" y="90" width="18" height="4" rx="2" fill="rgb(var(--on-gradient))" opacity="0.34" />
            <rect x="154" y="99" width="12" height="4" rx="2" fill="rgb(var(--on-gradient))" opacity="0.24" />
          </g>
        </>
      )}
    </Scene>
  );
}

/* ── Done ─────────────────────────────────────────────────────────────────
   A ticket with a seal on it, rising. The flow ends where the product starts,
   so the last picture is the thing they came for — not a tick in a circle,
   which is a picture of the form being over. */

export function SceneOnboardingDone({ className }: SceneProps) {
  return (
    <Scene scope="onb-done" tone="positive" className={className}>
      {(ids, body) => (
        <>
          <circle className="illo-a-pulse" cx="100" cy="66" r="50" fill={body} opacity="0.14" />

          {/* Sparks around it, rising slowly. */}
          <g className="illo-a-drift" opacity="0.7">
            {[
              [46, 34, 5],
              [156, 44, 4],
              [62, 96, 3.5],
              [150, 100, 3],
            ].map(([cx, cy, r]) => (
              <path
                key={`${cx}-${cy}`}
                d={`M${cx} ${cy - r}l${r * 0.32} ${r * 0.68} ${r * 0.68} ${r * 0.32}-${r * 0.68} ${r * 0.32}-${r * 0.32} ${r * 0.68}-${r * 0.32}-${r * 0.68}-${r * 0.68}-${r * 0.32} ${r * 0.68}-${r * 0.32}Z`}
                fill={body}
              />
            ))}
          </g>

          <ContactShadow cx={100} cy={124} rx={46} ry={6} ground={ids.ground} />
          <g className="illo-a-float" transform="rotate(-5 100 76)">
            <Solid d="M46 44h108v64H46Z" body={body} ids={ids} />
            <path
              d="M122 44v64"
              stroke="rgb(var(--overlay))"
              strokeWidth="2"
              strokeDasharray="5 5"
              opacity="0.4"
              fill="none"
            />
            <rect x="60" y="62" width="48" height="6" rx="3" fill="rgb(var(--on-gradient))" opacity="0.45" />
            <rect x="60" y="76" width="32" height="5" rx="2.5" fill="rgb(var(--on-gradient))" opacity="0.3" />
            {/* The seal. */}
            <circle cx="138" cy="76" r="12" fill="rgb(var(--on-gradient))" opacity="0.5" />
            <path
              d="M132 76l4.5 4.5L145 71"
              stroke={body}
              strokeWidth="3"
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
