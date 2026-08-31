import { describe, expect, it } from 'vitest';
import {
  DISMISS_FRACTION,
  FULL_SNAP_INDEX,
  INITIAL_SNAP_INDEX,
  resolveSnap,
  SHEET_SNAP_FRACTIONS,
  snapPixels,
} from './sheet-snap';

/**
 * The arithmetic behind the widget's drag, tested here because none of it is
 * visible by dragging a sheet with a mouse: a flick that has barely moved, a
 * slow drag that has moved a long way, and a release exactly between two
 * points all look the same on screen and behave differently.
 */

const VIEWPORT = 844; // iPhone 13/14 logical height.
const SNAPS = snapPixels(VIEWPORT);

describe('snapPixels', () => {
  it('resolves fractions against the live viewport, ascending, 0 = full screen', () => {
    expect(SNAPS[FULL_SNAP_INDEX]).toBe(0);
    expect(SNAPS).toHaveLength(SHEET_SNAP_FRACTIONS.length);
    expect([...SNAPS].sort((a, b) => a - b)).toEqual(SNAPS);
  });

  it('rescales when the viewport does — a phone URL bar collapsing must not strand the sheet', () => {
    const short = snapPixels(600);
    const tall = snapPixels(1000);
    expect(short[INITIAL_SNAP_INDEX]).toBeLessThan(tall[INITIAL_SNAP_INDEX]);
  });
});

describe('resolveSnap', () => {
  it('lands on the nearest point when the finger is released at rest', () => {
    const resting = SNAPS[INITIAL_SNAP_INDEX];
    const result = resolveSnap({ y: resting + 4, velocity: 0, snaps: SNAPS, viewportHeight: VIEWPORT });
    expect(result.index).toBe(INITIAL_SNAP_INDEX);
    expect(result.shouldClose).toBe(false);
  });

  it('carries an upward FLICK that has barely moved', () => {
    // THE regression this projection exists for. Snapping to whatever is
    // nearest the release POSITION sends this straight back where it started —
    // the sheet springs back under the thumb that just threw it upward.
    const result = resolveSnap({
      y: SNAPS[INITIAL_SNAP_INDEX] - 6,
      velocity: -1800,
      snaps: SNAPS,
      viewportHeight: VIEWPORT,
    });
    expect(result.index).toBe(FULL_SNAP_INDEX);
    expect(result.y).toBe(0);
  });

  it('does not treat a slow, long upward drag as a flick — position still governs', () => {
    const result = resolveSnap({
      y: SNAPS[1] + 2,
      velocity: -20,
      snaps: SNAPS,
      viewportHeight: VIEWPORT,
    });
    expect(result.index).toBe(1);
  });

  it('dismisses on a downward flick from rest, even though the sheet has hardly moved', () => {
    const result = resolveSnap({
      y: SNAPS[INITIAL_SNAP_INDEX] + 8,
      velocity: 2600,
      snaps: SNAPS,
      viewportHeight: VIEWPORT,
    });
    expect(result.shouldClose).toBe(true);
  });

  it('dismisses on a long slow drag past the lowest point', () => {
    const past = SNAPS[SNAPS.length - 1] + VIEWPORT * DISMISS_FRACTION + 1;
    const result = resolveSnap({ y: past, velocity: 0, snaps: SNAPS, viewportHeight: VIEWPORT });
    expect(result.shouldClose).toBe(true);
  });

  it('does NOT dismiss just inside the threshold — the gesture throws work away, so it must be deliberate', () => {
    const nearly = SNAPS[SNAPS.length - 1] + VIEWPORT * DISMISS_FRACTION - 1;
    const result = resolveSnap({ y: nearly, velocity: 0, snaps: SNAPS, viewportHeight: VIEWPORT });
    expect(result.shouldClose).toBe(false);
  });

  it('scales the dismiss threshold with the viewport, so it is not a twitch on a big phone', () => {
    const small = 640;
    const smallSnaps = snapPixels(small);
    const y = smallSnaps[smallSnaps.length - 1] + small * DISMISS_FRACTION + 1;
    expect(
      resolveSnap({ y, velocity: 0, snaps: smallSnaps, viewportHeight: small }).shouldClose,
    ).toBe(true);
    // The same absolute position on a taller phone is NOT yet a dismiss.
    expect(
      resolveSnap({ y, velocity: 0, snaps: snapPixels(1200), viewportHeight: 1200 }).shouldClose,
    ).toBe(false);
  });

  it('never dismisses when the sheet is not dismissable', () => {
    const past = SNAPS[SNAPS.length - 1] + VIEWPORT;
    const result = resolveSnap({
      y: past,
      velocity: 3000,
      snaps: SNAPS,
      viewportHeight: VIEWPORT,
      dismissable: false,
    });
    expect(result.shouldClose).toBe(false);
  });

  it('resolves an exact tie to the TALLER snap — reveal more, not less', () => {
    const midpoint = (SNAPS[0] + SNAPS[1]) / 2;
    const result = resolveSnap({ y: midpoint, velocity: 0, snaps: SNAPS, viewportHeight: VIEWPORT });
    expect(result.index).toBe(0);
  });

  it('is safe with no snap points rather than throwing on an unmeasured viewport', () => {
    const result = resolveSnap({ y: 120, velocity: 0, snaps: [], viewportHeight: 0 });
    expect(result).toEqual({ index: 0, y: 120, shouldClose: false });
  });
});
