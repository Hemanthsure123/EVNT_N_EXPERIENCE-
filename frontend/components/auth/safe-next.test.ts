import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

/**
 * This helper is the only thing standing between `?next=` and an open redirect,
 * so the hostile inputs are the point of the test — not the happy path.
 */
describe('safeNext', () => {
  it('keeps a same-origin path, query and hash intact', () => {
    expect(safeNext('/events?city=Mumbai#results')).toBe('/events?city=Mumbai#results');
    expect(safeNext('/booking/abc/review')).toBe('/booking/abc/review');
  });

  it('falls back when there is nothing to return to', () => {
    expect(safeNext(null)).toBe('/');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('')).toBe('/');
    expect(safeNext(null, '/events')).toBe('/events');
  });

  it('rejects absolute URLs', () => {
    expect(safeNext('https://evil.example/login')).toBe('/');
    expect(safeNext('http://evil.example')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
  });

  it('rejects protocol-relative URLs, which a startsWith("/") check would pass', () => {
    expect(safeNext('//evil.example/login')).toBe('/');
    expect(safeNext('/\\evil.example/login')).toBe('/');
  });
});
