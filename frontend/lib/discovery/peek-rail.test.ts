import { describe, expect, it } from 'vitest';
import {
  CENTRED_RAIL_MIN_ITEMS,
  centredRailPadding,
  loopedIndex,
  peekRailItem,
  peekRailItemState,
  peekRailSurfaceState,
  railModeFor,
} from './peek-rail';

/**
 * The rail's LAYOUT DECISION and its wrap arithmetic.
 *
 * Both are pure, and both fail invisibly rather than loudly. A rail that picks
 * the centred layout for one item renders a portrait marooned in the middle of
 * the screen with a void either side — no error, no warning, just a page that
 * looks broken. Wrap arithmetic that is off by one shows the second-to-last
 * item where the last belongs, which nobody notices until they count.
 *
 * The same functions drive the home page's "Featured events" and the event
 * page's "Who's taking the stage", so a change here moves both — which is the
 * point of the module and the reason these are pinned.
 */

describe('railModeFor', () => {
  it('needs two items to be a carousel', () => {
    // This said THREE, on the grounds that centring the first of two pushes
    // half the second off screen. That was true before `centredRailPadding`
    // existed and is not now: with the slack either side, item 1 sits centred
    // and item 2 peeks in from the right, which is exactly the two-item
    // behaviour the brief asks for.
    //
    // ONE is still a row — there is no centre to be in when there is nothing
    // to be centred against, and a lone item with a void each side reads as a
    // layout bug.
    expect(railModeFor(0)).toBe('start');
    expect(railModeFor(1)).toBe('start');
    expect(railModeFor(2)).toBe('centred');
    expect(railModeFor(CENTRED_RAIL_MIN_ITEMS)).toBe('centred');
    expect(railModeFor(20)).toBe('centred');
  });

  it('puts the threshold at two', () => {
    expect(CENTRED_RAIL_MIN_ITEMS).toBe(2);
  });
});

describe('centredRailPadding', () => {
  it('is exactly the space either side of a centred item', () => {
    // 16 + 68 + 16 = 100. The first and last items can therefore reach the
    // centre like every other one.
    expect(centredRailPadding(68)).toBe('16vw');
    expect(centredRailPadding(34)).toBe('33vw');
  });

  it('stays in the same unit the item is sized in', () => {
    // A vw padding against a px-capped item stops agreeing as the phone
    // widens: that mismatch put card one ~12px left of centre at 390px and
    // ~27px off on a Pro Max.
    expect(centredRailPadding(50)).toMatch(/vw$/);
  });
});

describe('peekRailItem', () => {
  it('snaps to the CENTRE in a carousel and to the START in a row', () => {
    // A left-aligned rail that snapped to the middle would scroll its first
    // item away from the gutter it is supposed to line up with.
    expect(peekRailItem('centred')).toContain('snap-center');
    expect(peekRailItem('start')).toContain('snap-start');
  });

  it('always carries the reduced-motion guard', () => {
    for (const mode of ['centred', 'start'] as const) {
      expect(peekRailItem(mode)).toContain('motion-reduce:transition-none');
    }
  });
});

describe('peekRailItemState', () => {
  it('brings the active item to the FRONT and pushes its neighbours back', () => {
    // The depth was `scale-95 / opacity-75` — a five-percent difference that
    // reads as a rendering artefact rather than as depth. A full step apart is
    // the effect: centre unmistakably upfront, sides unmistakably behind.
    expect(peekRailItemState(true, 'centred')).toContain('scale-105');
    expect(peekRailItemState(true, 'centred')).toContain('opacity-100');
    expect(peekRailItemState(false, 'centred')).toContain('scale-[0.85]');
    expect(peekRailItemState(false, 'centred')).toContain('opacity-70');
  });

  it('carries a z-index on BOTH states, not only the active one', () => {
    // Without `z-0` on the neighbours, a scaled-up centre card is still
    // painted UNDER whichever sibling follows it in the DOM — overlapped on
    // one side and not the other.
    expect(peekRailItemState(true, 'centred').split(' ')).toContain('z-10');
    expect(peekRailItemState(false, 'centred').split(' ')).toContain('z-0');
  });

  it('emphasises NOTHING in a row', () => {
    // One or two items are both fully on screen; scaling one of them down is
    // emphasis with nothing behind it.
    expect(peekRailItemState(true, 'start')).toBe(peekRailItemState(false, 'start'));
    expect(peekRailItemState(false, 'start')).toContain('scale-100');
    expect(peekRailItemState(false, 'start')).not.toContain('opacity-70');
  });

  it('never draws a ring', () => {
    // An outline is the language of a control you have FOCUSED. A discovery
    // card is a thing you look at, and a ring made the centre one read as a
    // selected UI component rather than as a poster.
    for (const active of [true, false]) {
      expect(peekRailItemState(active, 'centred')).not.toContain('ring');
      expect(peekRailSurfaceState(active, 'centred')).not.toContain('ring');
    }
  });
});

describe('loopedIndex', () => {
  it('is the identity when the rail does not wrap', () => {
    const { domCount, realFor } = loopedIndex(4, false);
    expect(domCount).toBe(4);
    expect([0, 1, 2, 3].map(realFor)).toEqual([0, 1, 2, 3]);
  });

  it('adds one clone at each end', () => {
    expect(loopedIndex(4, true).domCount).toBe(6);
  });

  it('maps the clones to the items they stand in for', () => {
    const { realFor } = loopedIndex(4, true);
    // Leading clone shows the LAST item, so scrolling left off the first lands
    // on something real-looking before the silent jump.
    expect(realFor(0)).toBe(3);
    // The real run.
    expect([1, 2, 3, 4].map(realFor)).toEqual([0, 1, 2, 3]);
    // Trailing clone shows the FIRST.
    expect(realFor(5)).toBe(0);
  });

  it('survives a single item without dividing by zero', () => {
    const { domCount, realFor } = loopedIndex(0, true);
    expect(domCount).toBe(0);
    expect(realFor(0)).toBe(0);
  });
});

describe('no infinite loop', () => {
  it('is what the rails actually run with', () => {
    // `loopedIndex` still knows how to clone — the tests above prove the
    // arithmetic — but `useSnapRail` pins `looping` to false, so no rail on
    // the platform renders a clone. The hard stop at the first and last item
    // is the contract, and this is the identity mapping it produces: DOM
    // position IS the real index, so nothing downstream has to translate.
    const { domCount, realFor } = loopedIndex(5, false);
    expect(domCount).toBe(5);
    expect([0, 1, 2, 3, 4].map(realFor)).toEqual([0, 1, 2, 3, 4]);
  });
});
