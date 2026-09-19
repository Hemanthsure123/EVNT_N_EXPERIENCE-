import { describe, expect, it } from 'vitest';
import { isShortAgeToken } from './pre-book-gate';

/**
 * The shipped bug this pins.
 *
 * `Event.age_restriction` is FREE TEXT. The gate drew whatever the organiser
 * typed inside a fixed 5rem disc, which is right for "18+" and wrong for
 * "Under 18s with an adult" — that wrapped to four lines, overflowed the ring
 * and struck through its own border, on exactly the events whose entry rule
 * most needs reading.
 *
 * Length is the only question asked. Nothing here reasons about what an age
 * MEANS or decides who may attend — that stays the organiser's, and the server
 * re-validates the questionnaire regardless.
 */
describe('isShortAgeToken', () => {
  it('treats the tokens the disc was designed for as short', () => {
    for (const token of ['18+', '21+', '16+', '13+']) {
      expect(isShortAgeToken(token)).toBe(true);
    }
  });

  it('treats a real sentence as long — the case that broke', () => {
    expect(isShortAgeToken('Under 18s with an adult')).toBe(false);
    expect(isShortAgeToken('Under 16s must be accompanied')).toBe(false);
  });

  it('treats "All ages" as long, because it is words rather than a number', () => {
    // It fits a pill comfortably and does not fit a disc, which is the whole
    // distinction being drawn.
    expect(isShortAgeToken('All ages')).toBe(false);
  });

  it('is blank-safe, so an event with no restriction draws the neutral mark', () => {
    expect(isShortAgeToken('')).toBe(false);
    expect(isShortAgeToken('   ')).toBe(false);
  });

  it('ignores surrounding whitespace rather than counting it', () => {
    expect(isShortAgeToken('  18+  ')).toBe(true);
  });
});
