/**
 * The mobile event page's geometry, in one place.
 *
 * ── WHAT THIS REPLACED ────────────────────────────────────────────────────
 *
 * `sheet-snap.ts` held the snap ladder for a draggable bottom sheet: a set of
 * resting heights, a projection that picked one from a release velocity, and a
 * poster fraction the ceiling was derived from. The deck is a normally
 * scrolling page now — no sheet, no snaps, no drag — so all of it went, and
 * what is left is the handful of numbers two files still have to agree on.
 *
 * The discipline is the one that module's own header set out and is the reason
 * this file exists rather than four literals: `deck-skeleton.tsx` paints the
 * deck's opening frame, and a stand-in whose poster inset and radius are
 * written out by hand is correct until either constant moves — at which point
 * it jumps at exactly the instant the handover is meant to be invisible. That
 * has already happened once in this codebase.
 */

/** The gutter down each side of the hero, in px. Also its top offset. */
export const DECK_EDGE_PADDING_PX = 16;

/** The hero's aspect ratio, width / height. Portrait, like the artwork. */
export const HERO_ASPECT_W = 4;
export const HERO_ASPECT_H = 5;

/**
 * The hero's corner radius, in px.
 *
 * A NUMBER and not a Tailwind class, because framer-motion has to animate it:
 * a layout animation scales the element, and an un-corrected radius scales with
 * it — a 24px corner drawn at 0.12 scale is a 200px corner for the length of
 * the transition. framer only applies that correction to a radius it owns, so
 * this has to arrive through `style`.
 */
export const HERO_RADIUS_PX = 24;

/** The docked thumbnail: a circle, so its radius is simply half its size. */
export const THUMB_SIZE_PX = 44;
export const THUMB_RADIUS_PX = THUMB_SIZE_PX / 2;

/**
 * How much of the hero must have scrolled away before it docks.
 *
 * Slightly past half, so the trigger fires while the poster is still partly on
 * screen: framer animates from wherever the element WAS, and a hero that has
 * left the viewport entirely flies in from above the fold rather than shrinking
 * out of the page. It is a fraction of the MEASURED hero rather than a pixel
 * count, so it stays right on a tall phone and on a short one.
 */
export const DOCK_AT_FRACTION = 0.55;

/**
 * The band the threshold has to be re-crossed by to undock, in px.
 *
 * Without it a rest position within a pixel of the threshold flips the state on
 * every jitter of an inertial scroll — and each flip is a layout animation, so
 * the poster strobes between the page and the bar. Hysteresis is the standard
 * answer and it costs one subtraction.
 */
export const DOCK_HYSTERESIS_PX = 48;

/** A floor for the threshold, for the frame before the hero has been measured. */
export const DOCK_MIN_PX = 120;

/**
 * Where the docking state flips, given the hero's measured height.
 *
 * Pure, and tested, because its two failure modes are invisible in a running
 * browser: a threshold that never fires leaves the poster in the page for ever,
 * and one that fires at zero docks it before the reader has scrolled at all.
 */
export function dockThreshold(heroHeight: number): number {
  return Math.max(DOCK_MIN_PX, heroHeight * DOCK_AT_FRACTION);
}

/**
 * Should the poster be docked in the booking bar at this scroll offset?
 *
 * `wasDocked` is what makes it hysteretic: the bar to dock is the full
 * threshold, and the bar to come back out is that threshold less the band.
 */
export function shouldDock(scrollTop: number, heroHeight: number, wasDocked: boolean): boolean {
  const threshold = dockThreshold(heroHeight);
  return wasDocked ? scrollTop > threshold - DOCK_HYSTERESIS_PX : scrollTop > threshold;
}
