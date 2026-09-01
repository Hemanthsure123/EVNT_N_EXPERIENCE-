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
 * The three resting heights, as fractions of the viewport measured from the
 * TOP. Ascending, so index 0 is full screen.
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
 * exactly how much artwork you can see. 45% leaves the poster as the top half
 * of the screen with the title, date and venue below it — which is the whole
 * shape the reference is built around — and 22% is the reading position on the
 * way to full.
 */
export const SHEET_SNAP_FRACTIONS = [0, 0.22, 0.45] as const;

export function snapPixels(viewportHeight: number): number[] {
  return SHEET_SNAP_FRACTIONS.map((fraction) => Math.round(fraction * viewportHeight));
}

/** Index into the snaps array for the state a freshly-opened sheet rests at. */
export const INITIAL_SNAP_INDEX = SHEET_SNAP_FRACTIONS.length - 1;
export const FULL_SNAP_INDEX = 0;
