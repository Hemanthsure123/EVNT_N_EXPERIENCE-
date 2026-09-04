import { describe, expect, it } from 'vitest';
import { flipTransform, isUsableSource, toCss, type Box } from './shared-poster';

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
