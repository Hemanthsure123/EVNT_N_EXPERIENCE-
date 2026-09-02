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
 * over all of it turns a widget back into a page. Worse, it made the widget
 * change identity mid-gesture — square corners, full-bleed, no neighbours —
 * so a swipe that started on a card ended on something that no longer looked
 * like one.
 *
 * The ceiling is now HALF THE POSTER. `POSTER_FRACTION` is the poster layer's
 * own height (`h-[62dvh]`), so the cap is derived from it rather than being a
 * second number that has to be kept in step by hand — change the poster and
 * the sheet's ceiling follows.
 *
 * The two heights that result, as a share of the screen the CARD occupies:
 *
 *     rest      0.39  ->  61% card, 39% poster
 *     expanded  0.31  ->  69% card, 31% poster (half of it still showing)
 *
 * `MIN_CARD_FRACTION` is the floor: below it the card stops being the thing
 * you are reading and becomes a caption under a picture. Rest sits just clear
 * of it rather than exactly on it, because these resolve to whole pixels and
 * landing exactly on the boundary rounds under it on some viewport heights.
 *
 * Everything past 69% is the content scrolling INSIDE the card, which is what
 * a reader wants once they have decided to read — not more panel.
 */

/** The poster layer's height, mirroring `h-[62dvh]` in the deck. */
export const POSTER_FRACTION = 0.62;
/** The card never occupies less of the screen than this. */
export const MIN_CARD_FRACTION = 0.6;

export const SHEET_SNAP_FRACTIONS = [
  // Half the poster stays visible, always.
  Number((POSTER_FRACTION / 2).toFixed(2)),
  0.39,
] as const;

export function snapPixels(viewportHeight: number): number[] {
  return SHEET_SNAP_FRACTIONS.map((fraction) => Math.round(fraction * viewportHeight));
}

/** Index into the snaps array for the state a freshly-opened sheet rests at. */
export const INITIAL_SNAP_INDEX = SHEET_SNAP_FRACTIONS.length - 1;
/**
 * The tallest the sheet may go — NOT full screen, which is why it is no longer
 * called that. See the note above `SHEET_SNAP_FRACTIONS`.
 */
export const EXPANDED_SNAP_INDEX = 0;
