import { describe, expect, it } from 'vitest';
import {
  ORIGIN_RESTRAINT,
  flipTransform,
  isUsableSource,
  restrain,
  toCss,
  type Box,
} from './shared-poster';

/**
 * The arithmetic behind the card → hero poster transition.
 *
 * Tested here because none of it is visible by dragging a sheet on one phone:
 * a card scrolled halfway off the top, a viewport that is not the one the
 * recording was made on, a source element with no size because the list is
 * still laying out. Each is a number, and each decides whether the transition
 * plays at all or falls back to the plain slide.
 */

const PHONE = { width: 390, height: 844 };
/** The deck's hero: full card width, 62dvh tall, pinned to the top. */
const HERO: Box = { top: 0, left: 23, width: 343, height: 523 };

describe('isUsableSource', () => {
  it('accepts a card sitting in the middle of the screen', () => {
    const card: Box = { top: 300, left: 24, width: 180, height: 270 };
    expect(isUsableSource(card, PHONE.height, PHONE.width)).toBe(true);
  });

  it('accepts a card only partly on screen — the eye can still follow it', () => {
    // Two thirds visible at the top edge.
    const card: Box = { top: -90, left: 24, width: 180, height: 270 };
    expect(isUsableSource(card, PHONE.height, PHONE.width)).toBe(true);
  });

  it('refuses a card almost entirely scrolled away', () => {
    // 20px of 270 showing. Flying the poster to a point above the viewport
    // reads as the image being discarded, not as it going home — the caller
    // falls back to the plain slide instead.
    const card: Box = { top: -250, left: 24, width: 180, height: 270 };
    expect(isUsableSource(card, PHONE.height, PHONE.width)).toBe(false);
  });

  it('refuses a card scrolled off the bottom', () => {
    const card: Box = { top: 830, left: 24, width: 180, height: 270 };
    expect(isUsableSource(card, PHONE.height, PHONE.width)).toBe(false);
  });

  it('refuses a card scrolled out sideways in a horizontal rail', () => {
    const card: Box = { top: 300, left: 400, width: 180, height: 270 };
    expect(isUsableSource(card, PHONE.height, PHONE.width)).toBe(false);
  });

  it('refuses a zero-sized box', () => {
    // A list that has not laid out yet returns these, and a scale of 0 would
    // make the poster vanish to a point rather than not animate.
    expect(isUsableSource({ top: 0, left: 0, width: 0, height: 0 }, 844, 390)).toBe(false);
  });

  it('refuses when the viewport itself is not measured yet', () => {
    const card: Box = { top: 300, left: 24, width: 180, height: 270 };
    expect(isUsableSource(card, 0, 0)).toBe(false);
  });
});

describe('flipTransform', () => {
  it('maps the hero onto the card centre-to-centre', () => {
    const card: Box = { top: 300, left: 24, width: 180, height: 270 };
    const t = flipTransform(card, HERO);

    // Width-keyed uniform scale: 180 / 343.
    expect(t.scale).toBeCloseTo(180 / 343, 6);
    // Centres: card is at (114, 435), hero at (194.5, 261.5).
    expect(t.x).toBeCloseTo(114 - 194.5, 6);
    expect(t.y).toBeCloseTo(435 - 261.5, 6);
  });

  it('is identity when the two boxes already coincide', () => {
    const t = flipTransform(HERO, HERO);
    expect(t.scale).toBe(1);
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
  });

  it('never distorts — there is one scale, not two', () => {
    // The whole reason for a uniform scale: a 2:3 card and a 3:4 hero cannot
    // both be matched, and squashing a photograph is more visible than an 11%
    // height difference on a moving element.
    const card: Box = { top: 100, left: 10, width: 200, height: 300 };
    const t = flipTransform(card, HERO);
    expect(typeof t.scale).toBe('number');
    expect(t.scale).toBeGreaterThan(0);
  });

  it('scales up when the card is larger than the hero', () => {
    // A full-bleed feature card on a wide phone can be wider than the inset
    // hero. The transform has to run the other way rather than clamping.
    const wide: Box = { top: 40, left: 0, width: 390, height: 260 };
    expect(flipTransform(wide, HERO).scale).toBeGreaterThan(1);
  });

  it('survives a zero-width destination rather than dividing by zero', () => {
    const card: Box = { top: 100, left: 10, width: 200, height: 300 };
    expect(flipTransform(card, { top: 0, left: 0, width: 0, height: 0 }).scale).toBe(1);
  });

  it('is reversible — the same pair drives both directions', () => {
    // The open plays `flip -> identity` and the close plays `identity -> flip`
    // from the SAME function, which is what stops the two drifting apart as
    // one gets tuned.
    const card: Box = { top: 300, left: 24, width: 180, height: 270 };
    const forward = flipTransform(card, HERO);
    const backward = flipTransform(card, HERO);
    expect(forward).toEqual(backward);
  });
});

describe('toCss', () => {
  it('emits translate3d so the layer is composited, not repainted', () => {
    expect(toCss({ x: -80.5, y: 173.5, scale: 0.5248 })).toBe(
      'translate3d(-80.5px, 173.5px, 0) scale(0.5248)',
    );
  });

  it('round-trips an identity transform', () => {
    expect(toCss({ x: 0, y: 0, scale: 1 })).toBe('translate3d(0px, 0px, 0) scale(1)');
  });
});

describe('restrain', () => {
  /**
   * It went the other way. A third of the journey was measured on the real
   * page and the clone entered at 83% of its final size, most of the screen
   * already, four hundred pixels from the card it was supposedly leaving —
   * a fade with a little movement under it rather than a shared element.
   * `ORIGIN_RESTRAINT` is 1 now, so the whole flip plays and these tests pin
   * that rather than the softening that replaced it.
   */
  const CARD: Box = { top: 420, left: 16, width: 171, height: 256 };

  it('starts the poster AT the card size, which is what a shared element is', () => {
    const raw = flipTransform(CARD, HERO);
    const eased = restrain(raw);
    expect(raw.scale).toBeCloseTo(0.499, 3);
    // The whole journey: the eased scale IS the raw one.
    expect(eased.scale).toBeCloseTo(raw.scale, 6);
  });

  it('keeps the direction of travel, over the whole distance', () => {
    const raw = flipTransform(CARD, HERO);
    const eased = restrain(raw);
    expect(Math.sign(eased.x)).toBe(Math.sign(raw.x));
    expect(Math.sign(eased.y)).toBe(Math.sign(raw.y));
    expect(eased.y).toBeCloseTo(raw.y * ORIGIN_RESTRAINT, 6);
  });

  it('is still a dial, so a future softening is one number', () => {
    // The mechanism survives the value: `restrain` is what makes the amount of
    // travel a judgement somebody can retune without touching the animation.
    const raw = flipTransform(CARD, HERO);
    const softened = restrain(raw, 0.5);
    expect(softened.scale).toBeGreaterThan(raw.scale);
    expect(softened.scale).toBeLessThan(1);
    expect(Math.abs(softened.y)).toBeLessThan(Math.abs(raw.y));
  });

  it('is the identity at factor 1 and no movement at factor 0', () => {
    const raw = flipTransform(CARD, HERO);
    const full = restrain(raw, 1);
    // `toBeCloseTo`, not `toEqual`: `1 - (1 - s) * 1` is arithmetically `s` and
    // is not the same double.
    expect(full.x).toBe(raw.x);
    expect(full.y).toBe(raw.y);
    expect(full.scale).toBeCloseTo(raw.scale, 12);
    // Scale interpolates from 1, not from 0 — the poster at rest is full size.
    const none = restrain(raw, 0);
    // `toBeCloseTo`, because `-171.5 * 0` is negative zero and `Object.is`
    // does not consider that the same as zero.
    expect(none.x).toBeCloseTo(0, 10);
    expect(none.y).toBeCloseTo(0, 10);
    expect(none.scale).toBe(1);
  });

  it('does nothing when the card and the hero are already the same box', () => {
    expect(restrain(flipTransform(HERO, HERO))).toEqual({ x: 0, y: 0, scale: 1 });
  });
});
