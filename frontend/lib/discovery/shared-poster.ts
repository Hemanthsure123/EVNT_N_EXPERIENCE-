/**
 * The geometry behind the card → detail poster transition.
 *
 * ── WHY THIS IS A PURE MODULE ─────────────────────────────────────────────
 *
 * Every failure mode here is invisible by looking at it on one phone: a card
 * scrolled half off the top, a viewport that changed between the tap and the
 * frame, a source element that no longer exists because the list re-rendered.
 * Those are arithmetic, so they are tested as arithmetic — the component that
 * consumes this only has to decide whether to play.
 *
 * ── AND WHY IT IS A UNIFORM SCALE ─────────────────────────────────────────
 *
 * A card poster is 2:3 and the deck's hero is roughly 3:4, so no single
 * transform maps one onto the other exactly. The two candidates:
 *
 *   - NON-UNIFORM scale (scaleX/scaleY to the source box) matches the box
 *     exactly and squashes the photograph. Fixing that needs an inverse scale
 *     on the image inside, which then shows a CROP of the final-size image
 *     rather than what the card was showing — a visible content jump traded
 *     for an invisible box error.
 *   - UNIFORM scale keyed to WIDTH matches the card's width exactly, leaves
 *     the height about 11% out, and cannot distort anything.
 *
 * Eleven percent of height, for around 300ms, while the element is moving —
 * against a photograph that visibly stretches. The uniform scale wins, and it
 * is also the one with no bookkeeping to get wrong.
 */

/** The only part of a DOMRect this needs. Plain data, so it is testable. */
export type Box = { top: number; left: number; width: number; height: number };

/** What the transition layer is told to do. `transform` is applied as-is. */
export type FlipTransform = { x: number; y: number; scale: number };

/**
 * A source box is only worth animating from if it is actually on screen.
 *
 * A card scrolled out of view produces a perfectly valid rect with a negative
 * top, and flying the poster to a point above the viewport reads as the image
 * being thrown away rather than as it returning home. The caller falls back to
 * the plain slide in that case, which is what §7 asks for.
 *
 * The threshold is deliberately generous: a card only half visible is still
 * somewhere the eye can follow, and refusing those would make the reverse
 * transition feel arbitrary.
 */
export function isUsableSource(box: Box, viewportHeight: number, viewportWidth: number): boolean {
  if (!(box.width > 0) || !(box.height > 0)) return false;
  if (!(viewportHeight > 0) || !(viewportWidth > 0)) return false;
  // Any overlap with the viewport at all, vertically and horizontally.
  const visibleTop = Math.max(box.top, 0);
  const visibleBottom = Math.min(box.top + box.height, viewportHeight);
  const visibleLeft = Math.max(box.left, 0);
  const visibleRight = Math.min(box.left + box.width, viewportWidth);
  if (visibleBottom - visibleTop <= 0) return false;
  if (visibleRight - visibleLeft <= 0) return false;
  // At least a third of the card's height showing. Below that the movement is
  // mostly off-screen and reads as a glitch rather than a journey.
  return (visibleBottom - visibleTop) / box.height >= 0.34;
}

/**
 * The transform that puts `target` exactly over `source`.
 *
 * The layer is rendered AT the target's geometry and then transformed back to
 * the source, so playing it forward is `flip()` → identity and playing it
 * backward is identity → `flip()`. One function serves both directions, which
 * is what stops the open and the close drifting apart.
 *
 * `transform-origin` is the element's centre (the CSS default), so the
 * translation is centre-to-centre. Anchoring at a corner instead would make
 * the poster appear to grow out of its top-left rather than out of itself.
 */
export function flipTransform(source: Box, target: Box): FlipTransform {
  const scale = target.width > 0 ? source.width / target.width : 1;
  const sourceCentreX = source.left + source.width / 2;
  const sourceCentreY = source.top + source.height / 2;
  const targetCentreX = target.left + target.width / 2;
  const targetCentreY = target.top + target.height / 2;
  return {
    x: sourceCentreX - targetCentreX,
    y: sourceCentreY - targetCentreY,
    scale,
  };
}

export function toCss(transform: FlipTransform): string {
  // `translate3d` rather than `translate`: it promotes the element to its own
  // compositor layer, which is the difference between a transform the GPU
  // handles and one that repaints on the main thread each frame.
  return `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`;
}

/** The attribute a card puts on its poster so the deck can find it again. */
export const POSTER_ATTR = 'data-event-poster';
/** The attribute the deck's own hero carries, for reading the target box. */
export const DECK_POSTER_ATTR = 'data-deck-poster';

function toBox(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/**
 * The card's poster for this event, if one is on the page.
 *
 * `querySelector`, not a ref threaded through ten call sites. The deck can be
 * opened from the browse grid, the home rail, a "more from this organiser"
 * list, an account ticket and five other places; giving each of them a rect to
 * carry would be ten signatures to change and ten chances to forget. A single
 * lookup also means the CLOSE targets whichever event is current after a
 * swipe, rather than the one that happened to be tapped.
 *
 * Returns null freely. Every caller treats that as "no shared element
 * available" and falls back to the plain transition, which is the behaviour
 * that shipped before this existed.
 */
export function readCardPoster(eventId: string): Box | null {
  if (typeof document === 'undefined' || !eventId) return null;
  // Two surfaces can legitimately hold the same event at once — a rail and the
  // grid below it. The LAST match is preferred only if the first is unusable;
  // see the caller, which validates before committing.
  const nodes = document.querySelectorAll(`[${POSTER_ATTR}="${CSS.escape(eventId)}"]`);
  if (nodes.length === 0) return null;
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  let fallback: Box | null = null;
  for (const node of nodes) {
    const box = toBox(node);
    if (isUsableSource(box, viewportHeight, viewportWidth)) return box;
    fallback ??= box;
  }
  return fallback;
}

/** The deck's own hero box, read rather than recomputed from constants. */
export function readDeckPoster(): Box | null {
  if (typeof document === 'undefined') return null;
  const node = document.querySelector(`[${DECK_POSTER_ATTR}]`);
  if (!node) return null;
  const box = toBox(node);
  return box.width > 0 && box.height > 0 ? box : null;
}
