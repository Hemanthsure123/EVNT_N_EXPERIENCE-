import { describe, expect, it } from 'vitest';
import { progressRingGeometry } from './progress-ring';

/**
 * The arc arithmetic only. The rendering is presentation and is not tested;
 * what IS tested is every way a percentage arrives wrong, because each of them
 * still draws a ring and so none of them is visible by looking at one.
 */
describe('progressRingGeometry', () => {
  const SIZE = 64;
  const STROKE = 6;
  const CIRCUMFERENCE = 2 * Math.PI * ((SIZE - STROKE) / 2);

  it('draws no arc at 0', () => {
    const { value, dashOffset, circumference } = progressRingGeometry(0, SIZE, STROKE);
    expect(value).toBe(0);
    expect(circumference).toBeCloseTo(CIRCUMFERENCE);
    // The dash is offset by the whole circumference, so nothing shows.
    expect(dashOffset).toBeCloseTo(CIRCUMFERENCE);
  });

  it('closes the ring at 100', () => {
    const { value, dashOffset } = progressRingGeometry(100, SIZE, STROKE);
    expect(value).toBe(100);
    expect(dashOffset).toBeCloseTo(0);
  });

  it('halves the offset at 50', () => {
    expect(progressRingGeometry(50, SIZE, STROKE).dashOffset).toBeCloseTo(CIRCUMFERENCE / 2);
  });

  it('clamps over 100 rather than wrapping the arc past its own start', () => {
    // 140% unclamped offsets by -0.4 of the circumference, which draws as 40%
    // — a confident wrong number rather than a broken-looking picture.
    const { value, dashOffset } = progressRingGeometry(140, SIZE, STROKE);
    expect(value).toBe(100);
    expect(dashOffset).toBeCloseTo(0);
  });

  it('clamps a negative value to empty', () => {
    const { value, dashOffset } = progressRingGeometry(-20, SIZE, STROKE);
    expect(value).toBe(0);
    expect(dashOffset).toBeCloseTo(CIRCUMFERENCE);
  });

  it('treats NaN as empty, never as an unrenderable arc', () => {
    // `used / quota * 100` is NaN whenever the quota is zero.
    const { value, dashOffset } = progressRingGeometry(Number.NaN, SIZE, STROKE);
    expect(value).toBe(0);
    expect(Number.isNaN(dashOffset)).toBe(false);
    expect(dashOffset).toBeCloseTo(CIRCUMFERENCE);
  });

  it('treats Infinity as full', () => {
    // Not finite, so it falls to the same guard as NaN: 0, never Infinity.
    expect(progressRingGeometry(Number.POSITIVE_INFINITY, SIZE, STROKE).value).toBe(0);
  });

  it('never returns a negative radius when the stroke is wider than the box', () => {
    // A negative radius makes the browser drop the circle entirely, so the
    // ring vanishes instead of looking wrong.
    const { radius, circumference, dashOffset } = progressRingGeometry(50, 20, 40);
    expect(radius).toBe(0);
    expect(circumference).toBe(0);
    expect(dashOffset).toBe(0);
  });

  it('survives a zero-sized box', () => {
    const { radius, circumference } = progressRingGeometry(50, 0, 6);
    expect(radius).toBe(0);
    expect(circumference).toBe(0);
  });
});
