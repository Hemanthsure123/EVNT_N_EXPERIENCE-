/**
 * Where the search panel sits when it hangs beneath a trigger.
 *
 * Pure arithmetic, deliberately separated from the effect that reads the DOM.
 * The edge cases here — a trigger near the right rim, a short viewport, a
 * screen narrower than the panel — are the ones that put results off-screen,
 * and none of them is visible on the wide monitor this was written on. Kept
 * pure so they can be asserted instead of eyeballed.
 */

/** Distance kept from the viewport edges. */
const GUTTER = 16;
/** Space between the trigger and the panel. */
const GAP = 8;
/**
 * Narrower than this and a result cannot show its title and subtitle on one
 * line, which is the point of the list.
 */
const MIN_WIDTH = 380;
/** Below this a panel is an empty box; better to overlap the trigger slightly. */
const MIN_HEIGHT = 240;

export type Viewport = { width: number; height: number };

export type PanelPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function placeAnchoredPanel(anchor: DOMRect, viewport: Viewport): PanelPosition {
  // Match the trigger, widened to the readable minimum — but the VIEWPORT
  // WINS. Writing the cap as `max(MIN_WIDTH, available)` let the floor beat it,
  // so on a 360px phone the panel came out 380px wide and hung off the screen.
  // A panel narrower than ideal is survivable; one the user cannot see is not.
  const available = viewport.width - GUTTER * 2;
  const width = Math.min(Math.max(anchor.width, MIN_WIDTH), available);

  // Left-aligned with the trigger, then pulled back so the right edge stays on
  // screen. `Math.max(GUTTER, …)` guards the case where the panel is wider
  // than the viewport itself, where the pull-back would otherwise go negative.
  const left = Math.min(
    Math.max(anchor.left, GUTTER),
    Math.max(GUTTER, viewport.width - width - GUTTER),
  );

  // ── BELOW, OR FLIPPED ABOVE ────────────────────────────────────────────
  //
  // Below is the default and what people expect. But a trigger near the
  // bottom of a short viewport leaves no usable room there, and the two
  // obvious escapes are both wrong: capping the height renders a sliver, and
  // enforcing a minimum height pushes the panel off the bottom where its last
  // results cannot be reached.
  //
  // So it flips — the standard dropdown behaviour, and the only option that
  // keeps the panel both on screen AND usable.
  const spaceBelow = viewport.height - anchor.bottom - GAP - GUTTER;
  const spaceAbove = anchor.top - GAP - GUTTER;
  const flip = spaceBelow < MIN_HEIGHT && spaceAbove > spaceBelow;

  const maxHeight = Math.max(0, flip ? spaceAbove : spaceBelow);
  const top = flip ? Math.max(GUTTER, anchor.top - GAP - maxHeight) : anchor.bottom + GAP;

  return { top, left, width, maxHeight };
}
