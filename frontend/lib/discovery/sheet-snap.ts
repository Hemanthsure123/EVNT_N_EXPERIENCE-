/**
 * Where a dragged bottom sheet should land when the finger lifts.
 *
 * ── WHY THIS IS A PURE MODULE ─────────────────────────────────────────────
 *
 * Its failure cases are the ones you cannot see by looking at a sheet that
 * renders: a fast flick that has barely moved, a slow drag that has moved a
 * long way, a release exactly between two snap points, a downward flick from
 * the lowest point that should DISMISS rather than snap back. Each of those is
 * a line of arithmetic and a test, and none of them is a thing to check by
 * dragging with a mouse.
 *
 * ── PROJECTION, NOT POSITION ──────────────────────────────────────────────
 *
 * Snapping to whichever point is nearest the RELEASE position gets flicks
 * wrong: a quick upward flick barely moves the sheet, so the nearest point is
 * the one it started at and the sheet springs back under the finger that just
 * threw it. So the release position is projected forward along the release
 * velocity first — the same trick a native scroll view uses — and the nearest
 * snap to that PROJECTION wins. `PROJECTION_SECONDS` is how far ahead to look:
 * large enough that a flick carries, small enough that a slow drag is still
 * governed by where you actually put it.
 *
 * Everything here is in PIXELS FROM THE TOP OF THE VIEWPORT, i.e. the sheet's
 * translate-Y. Smaller = taller sheet. `0` is full screen.
 */

/** How far ahead of the release point to look, in seconds of travel. */
const PROJECTION_SECONDS = 0.12;

/**
 * Past the lowest snap by this much (in px) and the gesture is a DISMISS.
 *
 * A fraction of the viewport rather than a constant: 96px is a decisive shove
 * on a small phone and a twitch on a large one, and this is the gesture that
 * throws away what the reader was looking at, so it must be hard to do by
 * accident on any device.
 */
export const DISMISS_FRACTION = 0.12;

export type SnapResolution = {
  /** Index into the snaps array that the sheet should animate to. */
  index: number;
  /** Pixels from the top of the viewport for that snap. */
  y: number;
  /** True when the gesture should close the sheet outright. */
  shouldClose: boolean;
};

export type ResolveSnapInput = {
  /** Where the sheet is right now, in px from the top of the viewport. */
  y: number;
  /** Release velocity in px/s. Positive = downward. */
  velocity: number;
  /** Snap positions in px from the top, ASCENDING (0 = full screen first). */
  snaps: readonly number[];
  /** Viewport height, for the dismiss threshold. */
  viewportHeight: number;
  /** Set false for a sheet that must not be dismissable by dragging. */
  dismissable?: boolean;
};

export function resolveSnap({
  y,
  velocity,
  snaps,
  viewportHeight,
  dismissable = true,
}: ResolveSnapInput): SnapResolution {
  if (snaps.length === 0) return { index: 0, y, shouldClose: false };

  const projected = y + velocity * PROJECTION_SECONDS;

  // The dismiss check reads the PROJECTION too, so a downward flick from the
  // resting position closes even though the sheet has barely moved — which is
  // what a flick down means, and what every native sheet does.
  const lowest = snaps[snaps.length - 1];
  if (dismissable && projected > lowest + viewportHeight * DISMISS_FRACTION) {
    return { index: snaps.length - 1, y: lowest, shouldClose: true };
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  snaps.forEach((snap, index) => {
    const distance = Math.abs(snap - projected);
    // Strictly-less-than, so an exact tie resolves to the TALLER snap (lower
    // index). Releasing dead between two points should reveal more, not less:
    // the reader is on their way somewhere, and going up is undoable with a
    // flick while going down may have scrolled content away.
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return { index: bestIndex, y: snaps[bestIndex], shouldClose: false };
}

/**
 * The resting heights, as fractions of the viewport measured from the TOP.
 * Ascending, so index 0 is the tallest the sheet is allowed to be.
 *
 * These are fractions rather than pixels because a phone's viewport height
 * changes under it — the URL bar collapses on scroll, the keyboard opens — and
 * a sheet pinned to a stale pixel value ends up floating or clipped. They are
 * resolved against the live `window.innerHeight` on every resize.
 */
/**
 * ── THEY MOVED WHEN THE POSTER STOPPED SCROLLING ──────────────────────────
 *
 * These were `[0, 0.06, 0.17]` — near-full-screen at every rest position —
 * because the artwork lived INSIDE the sheet and scrolled with the content, so
 * a sheet that stopped short just showed a strip of dimmed page above it.
 *
 * The poster is anchored behind the sheet now, so where the sheet rests is
 * exactly how much artwork you can see.
 *
 * ── AND THEN THE TOP ONE STOPPED BEING ZERO ───────────────────────────────
 *
 * `0` meant the sheet could cover the screen completely, and covering the
 * artwork is the one thing this layout exists not to do: the poster IS the
 * event, it is the reason somebody opened the card, and a panel that slides
 * over all of it turns a widget back into a page.
 *
 * ── AND THEN THE DERIVATION TURNED AROUND ─────────────────────────────────
 *
 * The ceiling used to be `POSTER_FRACTION / 2` — the sheet's stops derived
 * from the poster's height — and the note here said to move it by raising the
 * poster, never by editing the ceiling directly.
 *
 * That direction stopped being able to express the requirement. What is
 * specified now is the CARD's height ("shorten the content widget by ten per
 * cent"), and a `toFixed(2)` on a halved poster cannot land on an exact tenth:
 * asking for 0.594 through the poster gives 0.59, which is a 10.6% reduction
 * and a number nobody chose.
 *
 * So the CARD fractions are the primary constants, the sheet's stops are one
 * subtraction away from them, and `POSTER_FRACTION` is derived from the
 * ceiling instead — twice it, which is the SAME invariant as before (half the
 * artwork still showing at the tallest stop) read from the other end. Nothing
 * about the rule changed; only which number is written down and which is
 * computed, so that the one that is written down is the one somebody asked
 * for.
 *
 * The heights that result, as a share of the screen the CARD occupies:
 *
 *     rest      y 0.451  ->  54.9% card, 45.1% poster
 *     expanded  y 0.406  ->  59.4% card, 40.6% poster (half of it still showing)
 *
 * Both are exactly nine tenths of what they were (0.61 and 0.66). The poster
 * grew from 68dvh to 81dvh to keep the ceiling on half of it, which is the
 * "let the artwork breathe" half of the same request.
 *
 * `MIN_CARD_FRACTION` is the floor: below it the card stops being the thing
 * you are reading and becomes a caption under a picture. It moved by the same
 * tenth — a floor that did not move would simply have made the new heights
 * illegal, which is a floor being used as a veto on a decision rather than as
 * a guard against a mistake.
 *
 * Everything past the card's own height is the content scrolling INSIDE it,
 * which is what a reader wants once they have decided to read — not more panel.
 */

/** Kills float noise: `1 - 0.594` is `0.40600000000000003` without it. */
const round = (value: number, places: number): number => Number(value.toFixed(places));

/**
 * How much shorter the content widget is than it used to be.
 *
 * One constant, applied to both stops and to the floor, so "ten per cent
 * shorter" is a thing the file states once rather than three rounded numbers
 * that happen to agree.
 */
export const CARD_HEIGHT_REDUCTION = 0.1;

/** The card heights this replaced, kept so the reduction is checkable. */
const PREVIOUS_EXPANDED_CARD_HEIGHT_FRACTION = 0.66;
const PREVIOUS_RESTING_CARD_HEIGHT_FRACTION = 0.61;

/** The card's height at its tallest stop, as a fraction of the viewport. */
export const EXPANDED_CARD_HEIGHT_FRACTION = round(
  PREVIOUS_EXPANDED_CARD_HEIGHT_FRACTION * (1 - CARD_HEIGHT_REDUCTION),
  3,
);
/** The card's height at the stop a freshly-opened sheet rests at. */
export const RESTING_CARD_HEIGHT_FRACTION = round(
  PREVIOUS_RESTING_CARD_HEIGHT_FRACTION * (1 - CARD_HEIGHT_REDUCTION),
  3,
);

export const SHEET_SNAP_FRACTIONS = [
  round(1 - EXPANDED_CARD_HEIGHT_FRACTION, 3),
  round(1 - RESTING_CARD_HEIGHT_FRACTION, 3),
] as const;

/**
 * The poster layer's height — twice the ceiling, so half of it is still
 * showing when the sheet is as tall as it goes.
 *
 * The deck reads this rather than carrying a `h-[81dvh]` class, because the
 * height has already been written out as a literal in three files once and
 * disagreed with this constant in a fourth.
 */
export const POSTER_FRACTION = round(SHEET_SNAP_FRACTIONS[0] * 2, 2);

/** The card never occupies less of the screen than this. */
export const MIN_CARD_FRACTION = round(0.6 * (1 - CARD_HEIGHT_REDUCTION), 2);

export function snapPixels(viewportHeight: number): number[] {
  return SHEET_SNAP_FRACTIONS.map((fraction) => Math.round(fraction * viewportHeight));
}

/**
 * How much of the screen's width one event occupies. It is the whole screen.
 *
 * ── IT USED TO BE 0.96, AND BEFORE THAT 0.88 ──────────────────────────────
 *
 * The deck showed the active event centred with its neighbours peeking a few
 * percent in at both edges, and that peek was argued for at length: two real
 * posters at the rim say "there are more of these and they move sideways"
 * without an instruction.
 *
 * It also meant the event somebody opened was never the whole screen. Slivers
 * of two other events sat down both sides of the poster and the ticket panel,
 * which reads as bleed rather than as an affordance — and the width CHANGED
 * with the snap state (0.88 inset, 0.96 expanded), so expanding re-measured
 * the stride and slid the whole track sideways underneath a finger that had
 * only moved up.
 *
 * One page, the full width of the viewport, at every stop. The swipe is
 * untouched: the track is positioned by arithmetic (`-index * stride`), so a
 * stride of exactly the viewport width is a full-screen pager and nothing
 * about the gesture, the projection or the rubber-band had to change. What is
 * gone is the visual peek, and with it the only thing that hinted the deck can
 * be swiped — see the note in the deck about what replaced that hint.
 *
 * Read in two places: the deck itself, and the pre-hydration cover a shared
 * link paints before the deck can open.
 */
export const EXPANDED_CARD_FRACTION = 1;

/** Index into the snaps array for the state a freshly-opened sheet rests at. */
export const INITIAL_SNAP_INDEX = SHEET_SNAP_FRACTIONS.length - 1;
/**
 * The tallest the sheet may go — NOT full screen, which is why it is no longer
 * called that. See the note above `SHEET_SNAP_FRACTIONS`.
 */
export const EXPANDED_SNAP_INDEX = 0;
