import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QR_QUIET_ZONE, QrTooLongError, encodeQr, svgExtent, toSvgPath } from './qr';
import { LEN167, QR_ALL_MASKS, QR_REFERENCES, type QrReference } from './qr.fixtures';

/**
 * The encoder is checked against an INDEPENDENT implementation rather than by
 * eye, because every failure mode here produces a plausible-looking square of
 * noise that no scanner will read. See `qr.fixtures.ts` for where the reference
 * digests come from, why the mask is pinned, and how to regenerate them.
 */

const digest = (modules: boolean[][]): string =>
  createHash('sha256')
    .update(modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join('')).join('\n'))
    .digest('hex');

const check = (reference: QrReference) => {
  const matrix = encodeQr(reference.text, reference.level, reference.mask);
  // Version first: a mismatch there is a capacity bug, and saying so is more
  // useful than "the digests differ".
  expect(matrix.version).toBe(reference.version);
  expect(matrix.size).toBe(reference.size);
  expect(digest(matrix.modules)).toBe(reference.sha256);
};

describe('matches an independent encoder', () => {
  for (const reference of QR_REFERENCES) {
    it(`${reference.level} · ${reference.text.length} bytes · v${reference.version} · mask ${reference.mask}`, () => {
      check(reference);
    });
  }
});

describe('every mask pattern and the format bits that record it', () => {
  for (const reference of QR_ALL_MASKS) {
    it(`mask ${reference.mask}`, () => check(reference));
  }
});

describe('structure', () => {
  it('places the three finder patterns and the always-dark module', () => {
    const { modules, size } = encodeQr('finder');
    for (const [ox, oy] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ]) {
      // The 7×7 finder: dark ring, light ring, dark 3×3 core.
      expect(modules[oy][ox]).toBe(true);
      expect(modules[oy + 1][ox + 1]).toBe(false);
      expect(modules[oy + 3][ox + 3]).toBe(true);
    }
    expect(modules[size - 8][8]).toBe(true);
  });

  it('draws the timing patterns as an unbroken alternation', () => {
    const { modules, size } = encodeQr('timing');
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6][i]).toBe(i % 2 === 0);
      expect(modules[i][6]).toBe(i % 2 === 0);
    }
  });

  it('picks a mask deterministically — the same token always draws the same code', () => {
    expect(digest(encodeQr(LEN167).modules)).toBe(digest(encodeQr(LEN167).modules));
  });

  it('picks one of the eight masks it can actually record', () => {
    // The chosen mask has to be one the pinned-mask fixtures cover, or the
    // heuristic is selecting something the format bits cannot describe.
    const chosen = digest(encodeQr(LEN167, 'M').modules);
    expect(QR_ALL_MASKS.map((m) => m.sha256)).toContain(chosen);
  });

  it('grows the symbol rather than truncating a longer token', () => {
    expect(encodeQr('a'.repeat(400)).size).toBeGreaterThan(encodeQr('a'.repeat(20)).size);
  });

  it('refuses a payload no symbol can hold instead of silently dropping bytes', () => {
    expect(() => encodeQr('a'.repeat(3000), 'H')).toThrow(QrTooLongError);
  });
});

describe('svg output', () => {
  it('emits one sub-path per dark module, offset by the quiet zone', () => {
    const matrix = encodeQr('svg');
    const dark = matrix.modules.flat().filter(Boolean).length;
    const path = toSvgPath(matrix);

    expect(path.split('M').length - 1).toBe(dark);
    // The symbol starts at the quiet-zone offset, never at the origin: a QR
    // flush to the edge of its box is one a scanner cannot find, which is the
    // most common reason a correct encoding still fails to read.
    expect(svgExtent(matrix)).toBe(matrix.size + QR_QUIET_ZONE * 2);
    expect(path.startsWith('M0 0')).toBe(false);
  });
});
