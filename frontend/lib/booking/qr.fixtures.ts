/**
 * Reference QR matrices, produced by an INDEPENDENT encoder.
 *
 * Generated from reportlab's `reportlab.graphics.barcode.qrencoder` inside the
 * backend container — the same library that draws the QR into the ticket PDF
 * the buyer is emailed. Two implementations that were not written from each
 * other agreeing bit-for-bit is a far stronger statement than either one
 * looking plausible, and it is the only check available offline: there is no
 * decoder here to read the output back.
 *
 * ── THE MASK IS PINNED ON BOTH SIDES ──────────────────────────────────────
 *
 * The spec does not mandate WHICH of the eight data masks a symbol uses; it
 * records the choice in the format information and offers a penalty heuristic
 * for picking a readable one. Two conforming encoders disagree on that heuristic
 * routinely, and this pair does. So each case pins a mask, which turns the
 * comparison into a test of the ENCODING — capacity tables, block structure,
 * Reed-Solomon parity, interleave, module placement, format bits — instead of a
 * test of two heuristics. The mask index rotates across the cases so all eight
 * patterns are exercised, and one payload is checked against all eight.
 *
 * ── THE VERSION IS PINNED TOO, AND THAT IS ALSO A TEST ────────────────────
 *
 * `version` is the value THIS encoder picks as the smallest that fits. The
 * generator asserts that reportlab can encode into it (so the capacity is not
 * over-stated) and that reportlab overflows at one version smaller (so it is
 * not under-stated). Both assertions passed for every case below.
 *
 * ── ONE CASE IS ABSENT ON PURPOSE ─────────────────────────────────────────
 *
 * Version 15 at level H is excluded: reportlab's own error-correction block
 * table is wrong there, listing 396 total codewords where the symbol has 655,
 * and it is the ONLY one of the 160 (version, level) pairs where reportlab
 * disagrees with the total-codeword formula. It therefore cannot serve as an
 * oracle for that pair. That is a defect in the reference, not in this encoder,
 * and it is why the generator audits the whole table rather than trusting it.
 *
 * ── REGENERATING ──────────────────────────────────────────────────────────
 *
 * From the repo root with the backend container running:
 *
 *   docker compose exec -T web python - <<'PY'
 *   import hashlib
 *   from reportlab.graphics.barcode import qrencoder as q
 *   code = q.QRCode(1, q.QRErrorCorrectLevel.M)          # version, level
 *   code.addData(q.QR8bitByte("HELLO")); code.makeImpl(False, 1)   # mask
 *   n = code.getModuleCount()
 *   rows = ["".join("1" if code.isDark(r, c) else "0" for c in range(n)) for r in range(n)]
 *   print(n, hashlib.sha256("\n".join(rows).encode()).hexdigest())
 *   PY
 */

import type { EcLevel } from './qr';

export type QrReference = {
  text: string;
  level: EcLevel;
  /** The version this encoder must choose (smallest that fits). */
  version: number;
  /** Pinned on both sides — see the note above. */
  mask: number;
  /** Modules per side, so a version regression fails with a clearer message. */
  size: number;
  sha256: string;
};

const LEN1 = 'u';
const LEN17 = '8jzPde0IgxLd6Gncf';
const LEN34 = 'BAepfJBd0Kh8oOOL8dKLzdocJ2isAjIhKt';
const LEN62 = 'J0RlgLKOmxgJTeKdNnFRIBXuDL7DxtpYlSXpfKtHF4vUCsMehGAkWvj7FAc9Qe';
const LEN120 =
  'WJKY40uvSwMFLZDe1f8rESQedUStPKR0CsTy4Qwb8DwkNhFdnXsiVpzz63FfkCzJr4i0B3JrTAwR4y9ojfljoQoaF1LlqsajAIxNKu8iS2G8NPRVdD53X83R';
/** ≈ the length of a real signed ticket token — the case that actually ships. */
export const LEN167 =
  'ZJzzzzgEOzdmenCkhvMdgaKjIg8xNbe3nNyjOq9wMxEhh2FDEEtfjgVvVqE1SkHbn88HxjSI6bWHtP3fS2qHx6kwXoIIXGvOoNZYW2mZp0zVZomHFwUbbYrEqmSM9wCZ7Uw9xfogoEmvnEN5N1aE6PwZPf1Qh6yYTWmE4lB';
const LEN200 =
  'YOvfZ8UzDzV8fUkkibjL5DZPjN0MEQ7wjJJibaZUPgHV7iB3m03nbqnsGpWLuqIA1id6Vw5DQL05HA064GiIjHGb3CXlMaXZjljENUhJduRHHJEYXg4JdpmrcXgGCJbW56eCuNGMGmSrCGIZEG8pSH4487q7J58m1CiAhzCueQpBenQtYh5Xj8TPQxjq4i9DoV8gz4Fk';
const LEN300 =
  'Q1okTBGzvAmwufUxbvJDCTbyvHNsG9eh6Yo4gfqrc5XlrWi0B26R08qzjI6GKFSufrdZSlB5er8bOfZqfM2oeq3hDavJA76rNicHTp8hkqdlm7tOtHWnsCGRlrwZbqcabUGJmGEp7CgQ0PBQFI14zGtSnovm14TUOizwd1iaeOV4qBkdfQ1y3GQsMpSscDlkrCaqx9vJupc94tnwlavyfErGPmpGXafq0fjzLczbttOofL9H2WjQ5TY4MyWuUFjsUNPjc01T5GOBUSZGi6HWGK10Zb0RLZ5TR9SPofbciOx9';

const HELLO = 'HELLO';

/** One case per (level, length), with the mask rotating through all eight. */
export const QR_REFERENCES: QrReference[] = [
  // ── Level L ──────────────────────────────────────────────────────────────
  { text: HELLO, level: 'L', version: 1, mask: 0, size: 21, sha256: 'd51e6b3d78d8b096ca2040e60a6b738e6d61f498c4cb0c3b63f035650114d050' }, // prettier-ignore
  { text: LEN1, level: 'L', version: 1, mask: 1, size: 21, sha256: '92b6e4d4ae8a558ae768906dbde3b88d51a885c554c52b6c8f7e9a67de026583' }, // prettier-ignore
  { text: LEN17, level: 'L', version: 1, mask: 2, size: 21, sha256: '66b0027bb45d0951f69d4cbd55f3a475e8b75b025290f5863610c1254c568751' }, // prettier-ignore
  { text: LEN34, level: 'L', version: 3, mask: 3, size: 29, sha256: 'ee908781f596119452b5056b257f5fa9f2256c39159e77175255ac78c4c42661' }, // prettier-ignore
  { text: LEN62, level: 'L', version: 4, mask: 4, size: 33, sha256: '5fb1aa82aa86886b821e621d0d0ac6f6353af818ba9b31adfe4fe53a75820e91' }, // prettier-ignore
  { text: LEN120, level: 'L', version: 6, mask: 5, size: 41, sha256: 'e9bfa338b2e067930f52ca2867c360513444c0ed55c9efff9c553e237f066c74' }, // prettier-ignore
  { text: LEN167, level: 'L', version: 8, mask: 6, size: 49, sha256: '841d575de3b7f0a20a095142ed94b6fd9bdb49ef351c859861889ab34b79551a' }, // prettier-ignore
  { text: LEN200, level: 'L', version: 9, mask: 7, size: 53, sha256: 'fb030acac2ca374ed1287144e1db83bae420f498ed80850ab6392453cea4c2ad' }, // prettier-ignore
  { text: LEN300, level: 'L', version: 11, mask: 0, size: 61, sha256: '440158168ca42197de28e8fdd9aa1cea2475a4cbabc901618f70ec418dc72fff' }, // prettier-ignore

  // ── Level M — what the product actually renders ─────────────────────────
  { text: HELLO, level: 'M', version: 1, mask: 1, size: 21, sha256: 'aac7b8561561aa9ae4f5c8a20a12321e0a1ad77028376a765f63e49f263c210b' }, // prettier-ignore
  { text: LEN1, level: 'M', version: 1, mask: 2, size: 21, sha256: '420a43e34e76d59dcd4942c8be419521f7774c182545d7d62cc12e3f0148b5e2' }, // prettier-ignore
  { text: LEN17, level: 'M', version: 2, mask: 3, size: 25, sha256: 'e120715cfc22e4b184a61568638e8416c02f661cab893dc61a61a981f03e9491' }, // prettier-ignore
  { text: LEN34, level: 'M', version: 3, mask: 4, size: 29, sha256: '1b5bed50d8c13e020b8f9cc812f7f3f3ae68522a655cbf27b0de1ec431eceda3' }, // prettier-ignore
  { text: LEN62, level: 'M', version: 4, mask: 5, size: 33, sha256: 'c509a234023d838fc0e53a3765817721f0b89f73d877aa82c2cbe56e2ad24e21' }, // prettier-ignore
  { text: LEN120, level: 'M', version: 7, mask: 6, size: 45, sha256: '4b98af30c44508abea1e7ca2f879fa7c75123d26c632b666fc55e81c6caee6f4' }, // prettier-ignore
  { text: LEN167, level: 'M', version: 9, mask: 7, size: 53, sha256: '93e52ac11f61e9374b4f335637feb0d0ba6d94f83bac08f53b95797f1b4b46e2' }, // prettier-ignore
  { text: LEN200, level: 'M', version: 10, mask: 0, size: 57, sha256: '8e51db29df353ce24f1d9fce81de282d6a78429d196330379513b391d66f23cb' }, // prettier-ignore
  { text: LEN300, level: 'M', version: 13, mask: 1, size: 69, sha256: '6300824526b1cf621e7b21a7567479feca009a43dd3bfbeba24d59a1867b9a22' }, // prettier-ignore

  // ── Level Q ──────────────────────────────────────────────────────────────
  { text: HELLO, level: 'Q', version: 1, mask: 2, size: 21, sha256: '2e2b848ee1ea004044e2328c0cd24a405d3cd111fd123fb83225c4c5e3572338' }, // prettier-ignore
  { text: LEN1, level: 'Q', version: 1, mask: 3, size: 21, sha256: 'bd379107d2b0e63c6e2b3b57a97e6a4440e6b1619a674f0522428d3d9ac6ba7a' }, // prettier-ignore
  { text: LEN17, level: 'Q', version: 2, mask: 4, size: 25, sha256: '86d690bd9174ca29fdb9cd2aedda1d79743a02a2304d7a456b582f33eccd39a3' }, // prettier-ignore
  { text: LEN34, level: 'Q', version: 4, mask: 5, size: 33, sha256: '8a8ff706967ac0f6100749d3ea13269def4561a0c79d852f373798eb048d33d9' }, // prettier-ignore
  { text: LEN62, level: 'Q', version: 6, mask: 6, size: 41, sha256: 'e08a7cf5ab583662100180b7b48d4da1253768efd4e9ed5f5c66a20d40558250' }, // prettier-ignore
  { text: LEN120, level: 'Q', version: 9, mask: 7, size: 53, sha256: 'f1c9811c271f1083f576ba4c71201f9c55c547b1d073da745418e718ffdd87e7' }, // prettier-ignore
  { text: LEN167, level: 'Q', version: 11, mask: 0, size: 61, sha256: 'c503bd971d512fb2f7e7d75dad8886bb06aa90b51bd23a7d691b4143f9bd2f7c' }, // prettier-ignore
  { text: LEN200, level: 'Q', version: 12, mask: 1, size: 65, sha256: '8a14e1de1c4ea8451106a4f61e6013c04c3dea005df72ea270c1f78cdad574af' }, // prettier-ignore
  { text: LEN300, level: 'Q', version: 16, mask: 2, size: 81, sha256: '94e32ed4c0cbcdf19347513b54e1bb60151b7d70ebc67c1aff4a6b7cd591af96' }, // prettier-ignore

  // ── Level H (v15 absent — see the note at the top) ──────────────────────
  { text: HELLO, level: 'H', version: 1, mask: 3, size: 21, sha256: '38af38cb462ce7d0c0cd8c819b2fca12a85414441751643c0a21f73bf68ac9e3' }, // prettier-ignore
  { text: LEN1, level: 'H', version: 1, mask: 4, size: 21, sha256: 'e06dd53d19c9257999b7a14863a401cdd501cd5a957fd7a95d5f522fc7c87b58' }, // prettier-ignore
  { text: LEN17, level: 'H', version: 3, mask: 5, size: 29, sha256: 'ef2c197574c142944520b77d89f3cf1d5e467f8d80b64ae67e38446ba7ef9cdf' }, // prettier-ignore
  { text: LEN34, level: 'H', version: 4, mask: 6, size: 33, sha256: 'caa32d7a429f33feaf3f209aa6fdd0bb425ce2a366163c9fe2b0a601d6e329cd' }, // prettier-ignore
  { text: LEN62, level: 'H', version: 7, mask: 7, size: 45, sha256: '4ab0c712320335c6ef19e6c94267917f576f0fd894b26845e4f1aac2d1991807' }, // prettier-ignore
  { text: LEN120, level: 'H', version: 11, mask: 0, size: 61, sha256: 'af86f19c458baef9c22bd9a8133a40cd8a0229673cd9706cea177bfde6af9cfe' }, // prettier-ignore
  { text: LEN167, level: 'H', version: 13, mask: 1, size: 69, sha256: '729a438f671c6757e79dd617219897bb15ce9c3ca821a88c0287b300951e23b1' }, // prettier-ignore
  { text: LEN300, level: 'H', version: 18, mask: 2, size: 89, sha256: 'e1db897692186f87b315b7cd3647923a69e9f68749621dba3809003f953ef20f' }, // prettier-ignore
];

/** The same payload under every mask — the eight patterns and the format bits
 *  that record them, checked one by one. */
export const QR_ALL_MASKS: QrReference[] = [
  { text: LEN167, level: 'M', version: 9, mask: 0, size: 53, sha256: 'd51557059f8e30769e41e3a30a2576b16f1df5e5d6e61aaad7bab8af21306c49' }, // prettier-ignore
  { text: LEN167, level: 'M', version: 9, mask: 1, size: 53, sha256: '24f21c87e857a1bd2f0badbe79159b7075f19d0ac8a7d6b25a8f7d30adf2c72f' }, // prettier-ignore
  { text: LEN167, level: 'M', version: 9, mask: 2, size: 53, sha256: '7bebaf96b8765458cd88fcdd957d3e0b435838705e643572bb69dec9f0fb2a28' }, // prettier-ignore
  { text: LEN167, level: 'M', version: 9, mask: 3, size: 53, sha256: 'f06b5ff50c40084f04fdd274dee2aad7aa0d9971202356021a5d07114aad6c12' }, // prettier-ignore
  { text: LEN167, level: 'M', version: 9, mask: 4, size: 53, sha256: '325724878436ed42371355a242b7841cfa8fc0e8ea82b751f294bc5cebcfef49' }, // prettier-ignore
  { text: LEN167, level: 'M', version: 9, mask: 5, size: 53, sha256: '474027b9cfe041c4557670fec4285831ffe3331dce2e4be23ddcdb7273c2b30e' }, // prettier-ignore
  { text: LEN167, level: 'M', version: 9, mask: 6, size: 53, sha256: '8fd3fb9149be82babfd9f9635e91cba515662bfde22d930f294a8be7e6ae4a2f' }, // prettier-ignore
  { text: LEN167, level: 'M', version: 9, mask: 7, size: 53, sha256: '93e52ac11f61e9374b4f335637feb0d0ba6d94f83bac08f53b95797f1b4b46e2' }, // prettier-ignore
];
