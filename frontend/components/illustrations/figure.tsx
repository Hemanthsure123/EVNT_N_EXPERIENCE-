'use client';

import * as React from 'react';

/**
 * THE character. One definition, shared by every scene and every spot.
 *
 * ── WHY IT IS ITS OWN FILE ───────────────────────────────────────────────
 *
 * It used to be a private helper inside `scenes.tsx`, which was correct while
 * scenes were the only thing that drew a person. `spots.tsx` draws two of them
 * on a stage, and the moment a second file needs a person there are exactly two
 * outcomes: one definition in a shared module, or two figures that look like
 * they came from different illustration sets within a release or two. The
 * second is the specific failure this whole set was rebuilt to avoid.
 *
 * ── PROPORTIONS ARE THE WHOLE JOB ────────────────────────────────────────
 *
 * The first pass drew a 24-wide body under a 24-wide head and read as a peg
 * doll — crude beside the clay icons, which is precisely the "inconsistent
 * illustration style" failure this set exists to avoid. A head slightly
 * NARROWER than the shoulders, a body that occupies roughly two thirds of the
 * height, and a generous shoulder radius are what make a three-shape figure
 * read as designed rather than as assembled.
 *
 * The numbers below are that decision, written down. `FIGURE` publishes them so
 * a caller placing a scaled copy (a band member on a 96px stage) can compute
 * the transform from the metrics rather than eyeballing a translate — an
 * eyeballed one is how a figure ends up standing 2px above its own stage.
 *
 * ── IT IS DRAWN AT A FIXED PLACE, ON PURPOSE ─────────────────────────────
 *
 * The figure sits in the SCENE's 160x120 coordinate system with its feet on the
 * ground line, and moves horizontally via `cx` only. Callers that need it
 * somewhere else wrap it in a `<g transform="translate(...) scale(...)">`, so
 * there is one set of geometry rather than a prop for every dimension.
 */
export const FIGURE = {
  /** Centre of the head, in scene units. */
  headCy: 44,
  headR: 14,
  /** Top and bottom of the torso — the bottom is the ground line. */
  torsoTop: 76,
  feet: 102,
  /** Half the shoulder width. Wider than `headR`, which is the point. */
  shoulderHalf: 17,
  /** Full height of the drawn figure, crown to feet. */
  height: 102 - (44 - 14),
} as const;

export function Figure({
  cx = 58,
  cool,
  /**
   * Torso and head fills, and the ink of the face.
   *
   * They exist for ONE reason, and it is worth writing down because the obvious
   * reading of them is "a theming hook", which they are not. Every scene stands
   * the character on the PAGE, where a deep violet body reads in both themes —
   * so every scene uses the defaults. `SpotHireABand` stands it on a stage, in
   * front of a deep violet backdrop, and there the default body is the same
   * value as the thing behind it: the first version of that spot rendered as a
   * purple blob with two faces on it, which is the small-scale twin of the peg
   * doll this figure was rebuilt to stop being.
   *
   * So: pass these ONLY when the character is drawn against something that is
   * not the page. Anything else and the set stops being one character.
   */
  body,
  head = 'rgb(var(--violet-300))',
  ink = 'rgb(var(--violet-900))',
}: {
  cx?: number;
  cool: string;
  body?: string;
  head?: string;
  ink?: string;
}) {
  return (
    <g>
      {/* Shoulders and torso: one path, round-shouldered, flat on the ground. */}
      <path
        d={`M${cx - FIGURE.shoulderHalf} ${FIGURE.feet} V${FIGURE.torsoTop} a${FIGURE.shoulderHalf} ${FIGURE.shoulderHalf} 0 0 1 ${FIGURE.shoulderHalf * 2} 0 v${FIGURE.feet - FIGURE.torsoTop} Z`}
        fill={body ?? `url(#${cool})`}
      />
      {/* Head, a touch narrower than the shoulders. */}
      <circle cx={cx} cy={FIGURE.headCy} r={FIGURE.headR} fill={head} />
      {/* Two dots and one arc. The entire face — anything more dates fast and
          is impossible to keep identical across three scenes. */}
      <circle cx={cx - 5} cy="42" r="1.9" fill={ink} />
      <circle cx={cx + 5} cy="42" r="1.9" fill={ink} />
      <path
        d={`M${cx - 4.5} 48.5a4.5 4.5 0 0 0 9 0`}
        fill="none"
        stroke={ink}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.75"
      />
    </g>
  );
}
