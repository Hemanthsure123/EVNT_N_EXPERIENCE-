import { describe, expect, it } from 'vitest';
import { parseMapsLink } from './parse-maps-link';

/**
 * A pasted Maps link becomes the same two columns a dropped pin writes.
 * That equivalence is what makes the pin/link choice genuinely exclusive, so
 * the parsing is worth pinning: a link that silently yields nothing looks
 * exactly like a link that was ignored.
 */
describe('parseMapsLink', () => {
  it('prefers the PLACE over the camera', () => {
    // `@` is where the viewport was, which after any scroll is not the pin.
    // `!3d/!4d` is the place itself, so a link carrying both must use it.
    const link =
      'https://www.google.com/maps/place/Venue/@12.90,77.50,17z/data=!4m6!3m5!1s0x0!8m2!3d12.9716!4d77.5946';
    expect(parseMapsLink(link)).toEqual({ latitude: 12.9716, longitude: 77.5946 });
  });

  it('reads the viewport form when that is all there is', () => {
    expect(parseMapsLink('https://www.google.com/maps/@12.9716,77.5946,17z')).toEqual({
      latitude: 12.9716,
      longitude: 77.5946,
    });
  });

  it('reads a coordinate query and a directions link', () => {
    expect(parseMapsLink('https://maps.google.com/?q=12.9716,77.5946')).toEqual({
      latitude: 12.9716,
      longitude: 77.5946,
    });
    expect(
      parseMapsLink('https://www.google.com/maps/dir/?api=1&destination=12.9716, 77.5946'),
    ).toEqual({ latitude: 12.9716, longitude: 77.5946 });
  });

  it('accepts a bare pair, but only as the whole input', () => {
    expect(parseMapsLink('12.9716, 77.5946')).toEqual({
      latitude: 12.9716,
      longitude: 77.5946,
    });
    // A pair buried in a URL none of the patterns matched is not the answer —
    // it could be anything in a query string.
    expect(parseMapsLink('https://example.com/x?size=12.5,77.5&other=1')).toBeNull();
  });

  it('handles southern and western hemispheres', () => {
    expect(parseMapsLink('https://www.google.com/maps/@-33.8688,-151.2093,17z')).toEqual({
      latitude: -33.8688,
      longitude: -151.2093,
    });
  });

  it('refuses a short link rather than resolving it', () => {
    // `maps.app.goo.gl` carries no coordinates — it is a redirect, and
    // following it means a server-side fetch of a user-supplied URL. That is
    // an SSRF surface in exchange for a convenience, so the UI asks for the
    // full link instead.
    expect(parseMapsLink('https://maps.app.goo.gl/AbCdEfGh')).toBeNull();
  });

  it('refuses out-of-range and transposed pairs', () => {
    // Transposing is the commonest paste error and it lands in the sea.
    expect(parseMapsLink('https://www.google.com/maps/@91,77,17z')).toBeNull();
    expect(parseMapsLink('https://www.google.com/maps/@12,181,17z')).toBeNull();
  });

  it('treats 0,0 as nothing parsed', () => {
    // A real place in the Atlantic and never an event — the same rule
    // `Event.latitude` documents for its null default.
    expect(parseMapsLink('https://www.google.com/maps/@0,0,17z')).toBeNull();
  });

  it('is null for empty and for nonsense', () => {
    expect(parseMapsLink('')).toBeNull();
    expect(parseMapsLink('   ')).toBeNull();
    expect(parseMapsLink('not a link')).toBeNull();
  });
});
