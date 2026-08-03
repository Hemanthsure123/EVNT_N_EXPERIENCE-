import { describe, expect, it } from 'vitest';
import { placeAnchoredPanel } from './anchored-position';

/**
 * Where the search panel lands when it is hung beneath a trigger.
 *
 * Pure arithmetic, extracted from the effect so it can be tested without a
 * layout engine. The cases that matter are the edges: a trigger near the right
 * rim, a trigger low on a short viewport, and a viewport narrower than the
 * panel's preferred width. Each of those, done wrong, puts results off-screen
 * where nobody can reach them — and none of them is visible on a developer's
 * 1440px monitor.
 */

const rect = (over: Partial<DOMRect> = {}): DOMRect =>
  ({
    left: 100,
    right: 500,
    top: 20,
    bottom: 60,
    width: 400,
    height: 40,
    x: 100,
    y: 20,
    ...over,
  }) as DOMRect;

describe('placeAnchoredPanel', () => {
  it('hangs the panel just beneath the trigger', () => {
    const placed = placeAnchoredPanel(rect(), { width: 1440, height: 900 });

    expect(placed.top).toBe(68); // bottom (60) + the 8px gap
    expect(placed.left).toBe(100); // left-aligned with the trigger
  });

  it('matches the trigger width when the trigger is wide enough', () => {
    const placed = placeAnchoredPanel(rect(), { width: 1440, height: 900 });
    expect(placed.width).toBe(400);
  });

  it('widens a narrow trigger so the panel is still readable', () => {
    // A panel narrower than ~380px cannot show a result's title and its
    // subtitle on one line, which is the whole point of the list.
    const placed = placeAnchoredPanel(rect({ left: 100, right: 260, width: 160 }), {
      width: 1440,
      height: 900,
    });
    expect(placed.width).toBe(380);
  });

  it('keeps the panel on screen when the trigger is near the right edge', () => {
    // THE case a developer never sees: a right-aligned trigger on a laptop.
    const placed = placeAnchoredPanel(rect({ left: 1200, right: 1400, width: 200 }), {
      width: 1440,
      height: 900,
    });

    expect(placed.left + placed.width).toBeLessThanOrEqual(1440 - 16);
    expect(placed.left).toBeGreaterThanOrEqual(16);
  });

  it('never exceeds the viewport on a narrow screen', () => {
    const placed = placeAnchoredPanel(rect(), { width: 360, height: 640 });

    expect(placed.left).toBeGreaterThanOrEqual(16);
    expect(placed.left + placed.width).toBeLessThanOrEqual(360 - 16);
  });

  it('caps the height to the space beneath the trigger', () => {
    // Plenty of room below: stays below, and stops short of the bottom edge.
    const placed = placeAnchoredPanel(rect(), { width: 1440, height: 900 });

    expect(placed.top).toBe(68);
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(900);
  });

  it('flips above the trigger when there is no usable room below', () => {
    // A trigger near the bottom of a short viewport. Capping the height would
    // render a sliver; forcing a minimum would push results off-screen. Every
    // dropdown flips, and so does this.
    const placed = placeAnchoredPanel(rect({ top: 600, bottom: 640 }), {
      width: 1440,
      height: 700,
    });

    expect(placed.top).toBeLessThan(600); // above the trigger
    expect(placed.top).toBeGreaterThanOrEqual(16); // still on screen
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(600); // clears it
  });

  it('stays below when below is the roomier side', () => {
    const placed = placeAnchoredPanel(rect({ top: 20, bottom: 60 }), { width: 1440, height: 400 });
    expect(placed.top).toBe(68);
  });
});
