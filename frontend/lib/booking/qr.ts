/**
 * A QR Code encoder (ISO/IEC 18004), byte mode.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The backend issues each ticket a signed token and emails a PDF with a real
 * vector QR drawn from it. Until now the browser rendered that token as a line
 * of monospace text with a Copy button — honest, but useless at a turnstile,
 * where the only remaining route was a member of staff typing 167 characters
 * into a manual-entry field. Someone who has just paid should be able to hold
 * up their phone. (`frontend/BACKLOG.md` item 36.)
 *
 * QR encoding is PURE COMPUTATION — no network, no image download, no font. So
 * it belongs here rather than as an asset or a request: the code is drawn from
 * the token the page already has, works offline once the page has loaded, and
 * costs one `<path>` element.
 *
 * ── WHY IT IS A PURE MODULE WITH ITS OWN TESTS ────────────────────────────
 *
 * Everything that can go wrong here is invisible by eye. A wrong entry in an
 * error-correction table, an off-by-one in the interleave, a mask chosen by a
 * penalty function with a mis-transcribed rule — every one of those renders a
 * plausible-looking square of noise that no scanner will read. So the matrix is
 * verified against an independent, spec-compliant encoder (reportlab, which the
 * backend already uses to draw the QR in the emailed ticket PDF) in `qr.test.ts`
 * rather than by looking at it. A QR that looks right and does not scan is worse
 * than the text it replaced.
 *
 * The structure follows the reference algorithm in Annex/§8 of the spec: encode
 * to codewords, split into blocks, append Reed-Solomon parity, interleave, draw
 * the function patterns, snake the data in, then pick the mask with the lowest
 * penalty score. Nothing here is novel; the value is in it being right.
 */

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

export type QrMatrix = {
  /** Modules per side, EXCLUDING the quiet zone. */
  size: number;
  /** `modules[y][x]`; `true` is a dark module. */
  modules: boolean[][];
  /** 1–40. Exposed for tests and for debugging a capacity surprise. */
  version: number;
};

/** Thrown when the payload cannot fit in a version-40 symbol. */
export class QrTooLongError extends Error {}

const EC_ORDER: EcLevel[] = ['L', 'M', 'Q', 'H'];
/** The 2-bit level indicator that goes into the format information. */
const EC_FORMAT_BITS: Record<EcLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

const MAX_VERSION = 40;

/**
 * Error-correction codewords per block, indexed `[ecLevel][version]`.
 * Index 0 of each row is a placeholder so `version` indexes directly.
 */
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  // L
  [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  // M
  [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  // Q
  [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  // H
  [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
];

/** Number of error-correction blocks, indexed `[ecLevel][version]`. */
const NUM_EC_BLOCKS: number[][] = [
  // L
  [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  // M
  [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23,
    25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  // Q
  [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  // H
  [
    -1, 1, 1, 2, 4, 4, 4, 5, 5, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35,
    37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
];

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/** The Galois field GF(256) primitive modulus, x^8 + x^4 + x^3 + x^2 + 1. */
const GF_MODULUS = 0x11d;

const getBit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0;

/** Data + EC modules available in a symbol of this version (spec §; a formula
 *  rather than a fifth table — the alignment patterns are the only variable). */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewordCount(version: number, ecl: EcLevel): number {
  const level = EC_ORDER.indexOf(ecl);
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[level][version] * NUM_EC_BLOCKS[level][version]
  );
}

// ── Reed-Solomon over GF(256) ──────────────────────────────────────────────

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * GF_MODULUS);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Coefficients of the generator polynomial of the given degree. */
function rsDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

// ── Data encoding ──────────────────────────────────────────────────────────

/** Byte mode's character-count indicator is 8 bits up to version 9, 16 after. */
const charCountBits = (version: number): number => (version <= 9 ? 8 : 16);

function appendBits(value: number, length: number, bits: number[]): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function chooseVersion(byteLength: number, ecl: EcLevel): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const capacityBits = dataCodewordCount(version, ecl) * 8;
    if (4 + charCountBits(version) + byteLength * 8 <= capacityBits) return version;
  }
  throw new QrTooLongError(`${byteLength} bytes will not fit in any QR symbol at level ${ecl}`);
}

function toCodewords(bytes: Uint8Array, version: number, ecl: EcLevel): number[] {
  const capacityBits = dataCodewordCount(version, ecl) * 8;
  const bits: number[] = [];
  appendBits(0b0100, 4, bits); // byte mode
  appendBits(bytes.length, charCountBits(version), bits);
  for (const byte of bytes) appendBits(byte, 8, bits);

  // Terminator, then pad to a whole codeword, then the specified alternating
  // filler. The filler bytes are fixed by the spec, not arbitrary.
  appendBits(0, Math.min(4, capacityBits - bits.length), bits);
  appendBits(0, (8 - (bits.length % 8)) % 8, bits);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8, bits);

  const codewords: number[] = new Array<number>(bits.length / 8).fill(0);
  bits.forEach((bit, i) => {
    codewords[i >>> 3] |= bit << (7 - (i & 7));
  });
  return codewords;
}

/**
 * Split into blocks, append parity to each, and interleave.
 *
 * The interleave is what makes a QR survive a thumb over one corner: a burst of
 * damage is spread across every block instead of destroying one outright. Short
 * blocks come first and are padded with a placeholder that is skipped on the way
 * out — which is the step an off-by-one hides in.
 */
function addEccAndInterleave(data: number[], version: number, ecl: EcLevel): number[] {
  const level = EC_ORDER.indexOf(ecl);
  const numBlocks = NUM_EC_BLOCKS[level][version];
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[level][version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLength = Math.floor(rawCodewords / numBlocks);

  const divisor = rsDivisor(eccPerBlock);
  const blocks: number[][] = [];
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const block = data.slice(
      offset,
      offset + shortBlockLength - eccPerBlock + (i < numShortBlocks ? 0 : 1),
    );
    offset += block.length;
    const ecc = rsRemainder(block, divisor);
    if (i < numShortBlocks) block.push(0); // placeholder, skipped below
    blocks.push(block.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLength - eccPerBlock || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ── Symbol construction ────────────────────────────────────────────────────

class Symbol_ {
  readonly size: number;
  readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  constructor(
    readonly version: number,
    readonly ecl: EcLevel,
  ) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.isFunction = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }

  private setFunctionModule(x: number, y: number, isDark: boolean): void {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  /** Centres of the alignment patterns, derived rather than tabulated. */
  private alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    // Version 32 is the one case the general formula gets wrong; the spec
    // fixes its step at 26.
    const step = this.version === 32 ? 26 : Math.ceil((this.version * 4 + 4) / (count * 2 - 2)) * 2;
    const result: number[] = [6];
    for (let pos = this.size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  private drawFinderPattern(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev ring
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  /** Format information: EC level + mask, BCH(15,5)-protected, written twice. */
  drawFormatBits(mask: number): void {
    const data = (EC_FORMAT_BITS[this.ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true); // the always-dark module
  }

  private drawVersionBits(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, dark);
      this.setFunctionModule(b, a, dark);
    }
  }

  drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    const positions = this.alignmentPositions();
    const last = positions.length - 1;
    for (let i = 0; i <= last; i++) {
      for (let j = 0; j <= last; j++) {
        // The three corners already hold finder patterns.
        const isCorner = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!isCorner) this.drawAlignmentPattern(positions[i], positions[j]);
      }
    }

    this.drawFormatBits(0); // placeholder; rewritten once the mask is chosen
    this.drawVersionBits();
  }

  /** Snake the codewords in: two columns at a time, right to left, alternating
   *  upward and downward, skipping the vertical timing pattern at column 6. */
  drawCodewords(data: number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  /** XOR, so calling it twice with the same mask undoes it. */
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  // ── Penalty scoring: the four rules that pick the mask ────────────────────

  private finderPenaltyCount(history: number[]): number {
    const n = history[1];
    const core =
      n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (
      (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
      (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    );
  }

  private finderPenaltyAddHistory(runLength: number, history: number[]): void {
    // An edge counts as light: the pattern this rule hunts for is the finder's
    // 1:1:3:1:1 signature, which is only special because of what surrounds it.
    const length = history[0] === 0 ? runLength + this.size : runLength;
    history.pop();
    history.unshift(length);
  }

  private finderPenaltyTerminate(runColor: boolean, runLength: number, history: number[]): number {
    let length = runLength;
    if (runColor) {
      this.finderPenaltyAddHistory(length, history);
      length = 0;
    }
    this.finderPenaltyAddHistory(length + this.size, history);
    return this.finderPenaltyCount(history);
  }

  penaltyScore(): number {
    let result = 0;

    for (let y = 0; y < this.size; y++) {
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < this.size; x++) {
        if (this.modules[y][x] === runColor) {
          runLength++;
          if (runLength === 5) result += PENALTY_N1;
          else if (runLength > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLength, history);
          if (!runColor) result += this.finderPenaltyCount(history) * PENALTY_N3;
          runColor = this.modules[y][x];
          runLength = 1;
        }
      }
      result += this.finderPenaltyTerminate(runColor, runLength, history) * PENALTY_N3;
    }

    for (let x = 0; x < this.size; x++) {
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < this.size; y++) {
        if (this.modules[y][x] === runColor) {
          runLength++;
          if (runLength === 5) result += PENALTY_N1;
          else if (runLength > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLength, history);
          if (!runColor) result += this.finderPenaltyCount(history) * PENALTY_N3;
          runColor = this.modules[y][x];
          runLength = 1;
        }
      }
      result += this.finderPenaltyTerminate(runColor, runLength, history) * PENALTY_N3;
    }

    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color = this.modules[y][x];
        if (
          color === this.modules[y][x + 1] &&
          color === this.modules[y + 1][x] &&
          color === this.modules[y + 1][x + 1]
        ) {
          result += PENALTY_N2;
        }
      }
    }

    let dark = 0;
    for (const row of this.modules) for (const cell of row) if (cell) dark++;
    const total = this.size * this.size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * PENALTY_N4;
  }
}

/**
 * Encode `text` as a QR matrix.
 *
 * Level M (≈15% recovery) matches what the backend draws into the emailed
 * ticket PDF, so the printed and on-screen codes have the same robustness. A
 * higher level would need a bigger symbol for the same token and buy nothing:
 * a phone screen is not a creased piece of paper.
 *
 * `forcedMask` exists ONLY for the tests. The spec does not say which of the
 * eight masks a symbol must use — it says the choice is recorded in the format
 * information and gives a penalty heuristic for picking a readable one, and two
 * conforming encoders routinely disagree. So the cross-check against reportlab
 * pins the mask on both sides: that compares the encoding (tables, blocks,
 * parity, interleave, placement, format bits) rather than comparing two
 * heuristics. Production never passes it.
 */
export function encodeQr(text: string, ecLevel: EcLevel = 'M', forcedMask?: number): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length, ecLevel);
  const codewords = addEccAndInterleave(toCodewords(bytes, version, ecLevel), version, ecLevel);

  const symbol = new Symbol_(version, ecLevel);
  symbol.drawFunctionPatterns();
  symbol.drawCodewords(codewords);

  let chosenMask = forcedMask;
  if (chosenMask === undefined) {
    // Pick the mask with the lowest penalty. Strictly-less keeps the lowest
    // index on a tie, which is what makes the output deterministic.
    let bestPenalty = Infinity;
    chosenMask = 0;
    for (let mask = 0; mask < 8; mask++) {
      symbol.applyMask(mask);
      symbol.drawFormatBits(mask);
      const penalty = symbol.penaltyScore();
      if (penalty < bestPenalty) {
        chosenMask = mask;
        bestPenalty = penalty;
      }
      symbol.applyMask(mask); // undo
    }
  }
  symbol.applyMask(chosenMask);
  symbol.drawFormatBits(chosenMask);

  return { size: symbol.size, modules: symbol.modules, version: symbol.version };
}

/** The quiet zone the spec requires, in modules. Without it a scanner cannot
 *  find the symbol's edge, which is the single most common reason a
 *  correctly-encoded QR fails to read. */
export const QR_QUIET_ZONE = 4;

/**
 * One SVG path covering every dark module, in a coordinate system of 1 unit per
 * module with the quiet zone already offset in.
 *
 * One `<path>` rather than one `<rect>` per module: a version-9 symbol is 53×53,
 * so the naive version is up to 2,809 elements of DOM for a decoration, on the
 * screen someone reaches for while queuing.
 */
export function toSvgPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.modules[y][x]) {
        parts.push(`M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h1v1h-1z`);
      }
    }
  }
  return parts.join('');
}

/** Side of the drawn symbol including both quiet zones, in module units. */
export const svgExtent = (matrix: QrMatrix): number => matrix.size + QR_QUIET_ZONE * 2;
