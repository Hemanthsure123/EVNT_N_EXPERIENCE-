import { describe, expect, it } from 'vitest';
import {
  DOCK_AT_FRACTION,
  DOCK_HYSTERESIS_PX,
  DOCK_MIN_PX,
  HERO_RADIUS_PX,
  THUMB_RADIUS_PX,
  THUMB_SIZE_PX,
  dockThreshold,
  shouldDock,
} from './deck-metrics';

/**
 * When the mobile event page's poster docks into the booking bar.
 *
 * Pure, and tested, because both failure modes are invisible in a running
 * browser rather than obvious: a threshold that never fires leaves the poster
 * in the page for ever and the bar simply never gains a thumbnail, and one that
 * fires at zero docks it before the reader has scrolled at all. Neither throws,
 * neither logs, and both look like "the animation is broken".
 */

const HERO = 450; // a 4:5 hero on a 390px-wide phone, less the 16px gutters

describe('dockThreshold', () => {
  it('is a fraction of the MEASURED hero, not a fixed pixel count', () => {
    // A tall phone and a short one dock at different offsets on purpose: the
    // trigger is "the poster is mostly gone", which is a fact about the poster.
    expect(dockThreshold(HERO)).toBeCloseTo(HERO * DOCK_AT_FRACTION, 5);
    expect(dockThreshold(800)).toBeGreaterThan(dockThreshold(400));
  });

  it('fires while the poster is still partly on screen', () => {
    // framer animates from where the element WAS. Past 100% the hero has left
    // the viewport, and the thumbnail would fly in from above the fold rather
    // than shrinking out of the page.
    expect(DOCK_AT_FRACTION).toBeGreaterThan(0.5);
    expect(DOCK_AT_FRACTION).toBeLessThan(1);
  });

  it('floors at DOCK_MIN_PX, for the frame before the hero is measured', () => {
    // `offsetHeight` is 0 on the first pass. Without the floor the threshold
    // would be 0 and the poster would dock at a scroll offset of one pixel.
    expect(dockThreshold(0)).toBe(DOCK_MIN_PX);
  });
});

describe('shouldDock', () => {
  it('does not dock at the top of the page', () => {
    expect(shouldDock(0, HERO, false)).toBe(false);
    expect(shouldDock(0, 0, false)).toBe(false);
  });

  it('docks once the poster has mostly gone', () => {
    expect(shouldDock(dockThreshold(HERO) + 1, HERO, false)).toBe(true);
  });

  it('does not dock just short of the threshold', () => {
    expect(shouldDock(dockThreshold(HERO) - 1, HERO, false)).toBe(false);
  });

  describe('hysteresis', () => {
    /**
     * A rest position within a pixel of the threshold flips the state on every
     * jitter of an inertial scroll — and each flip is a layout animation, so the
     * poster strobes between the page and the bar.
     */
    it('stays docked inside the band', () => {
      const justUnder = dockThreshold(HERO) - DOCK_HYSTERESIS_PX / 2;
      expect(shouldDock(justUnder, HERO, true)).toBe(true);
      // ...and the SAME offset would not have docked it in the first place.
      expect(shouldDock(justUnder, HERO, false)).toBe(false);
    });

    it('undocks once the band is cleared', () => {
      expect(shouldDock(dockThreshold(HERO) - DOCK_HYSTERESIS_PX - 1, HERO, true)).toBe(false);
    });

    it('always undocks at the very top, whatever the band says', () => {
      // The reversal has to complete: scrolling back to the top must return the
      // poster to the hero, or the page keeps an empty box where its artwork is.
      expect(shouldDock(0, HERO, true)).toBe(false);
    });
  });
});

describe('the docked thumbnail is a circle', () => {
  it('has a radius of exactly half its size', () => {
    // Anything less is a rounded square. It is derived rather than written
    // twice so resizing the thumbnail cannot quietly leave it one.
    expect(THUMB_RADIUS_PX).toBe(THUMB_SIZE_PX / 2);
  });

  it('is smaller than the hero radius it animates from', () => {
    expect(HERO_RADIUS_PX).toBeLessThan(THUMB_RADIUS_PX * 2);
  });
});
