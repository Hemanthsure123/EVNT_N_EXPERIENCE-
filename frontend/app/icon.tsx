import { ImageResponse } from 'next/og';
import { OG_TOKENS, rgb } from '@/lib/seo/og-tokens';

/**
 * The app icon — the CX monogram from `components/shell/brand-mark.tsx`,
 * rasterised at build time.
 *
 * ── WHY GENERATE IT RATHER THAN SHIP A PNG ────────────────────────────────
 *
 * `public/` held exactly one file (`favicon.svg`) before this. The usual fix is
 * to export a set of PNGs from a design tool and drop them in — which creates
 * a second copy of the mark that no longer changes when `BrandMark` does. The
 * mark is already a vector defined in code; drawing it here from the same path
 * data means retuning the monogram updates the header, the footer, the install
 * icon and the OG card together.
 *
 * ── THE SAFE AREA IS NOT DECORATION ───────────────────────────────────────
 *
 * Android's adaptive icons crop a `maskable` icon to whatever shape the
 * launcher uses — circle, squircle, rounded square, teardrop — and the
 * guaranteed-visible region is only the centre **80%** (a circle of 4/5 the
 * width). A mark drawn to the edges loses its extremities on a circular
 * launcher, and the X in this monogram reaches the right edge.
 *
 * So the glyph is inset to ~62% of the canvas: comfortably inside the maskable
 * safe zone, and still large enough that the same asset reads at 32px in a
 * browser tab. That is why one file can serve both `purpose: 'any'` and
 * `purpose: 'maskable'` in the manifest.
 *
 * ── IT IS A DARK TILE, NOT A TRANSPARENT GLYPH ────────────────────────────
 *
 * A transparent icon inherits the launcher's wallpaper, so a near-black mark
 * vanishes on a dark home screen and a near-white one vanishes on a light one.
 * A filled tile is a decision that survives both. `--ink-950` is the light
 * theme's `--cta` — the near-black the product already spends on its primary
 * action, so the icon is the same ink as the button that books a ticket.
 */

/**
 * ── WHY EVERY IMAGE ROUTE DECLARES THE EDGE RUNTIME ───────────────────────
 *
 * Without this, `next build` fails on Windows with `TypeError: Invalid URL`
 * thrown from inside `@vercel/og`:
 *
 *     at fileURLToPath (node:internal/url:1604:12)
 *     at .../next/dist/compiled/@vercel/og/index.node.js:18988
 *
 * The NODE build of `@vercel/og` locates its bundled font and WASM by
 * converting `import.meta.url` back to a filesystem path. On Windows that URL
 * is a `file:///C:/...` form the conversion does not accept, so the module
 * throws while loading — before any of our code runs, which is why the stack
 * names nothing of ours and the message says nothing about images.
 *
 * The EDGE build resolves those assets as bundled imports and never touches the
 * filesystem, so it is unaffected. It is also the runtime these routes should
 * be on regardless: rasterising an image is exactly the short, CPU-bound,
 * dependency-free work edge is for, and the event card in particular wants to
 * render close to whichever crawler asked for it.
 *
 * The constraint this imposes: **nothing an image route imports may use a Node
 * API.** `lib/seo/og-card.tsx` and `lib/api/*` are plain `fetch` and pure
 * functions, which is what makes this safe — adding a route that reads a file
 * or imports `node:*` would reintroduce the failure in a new form.
 */
export const runtime = 'edge';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  const field = rgb(OG_TOKENS.ink950);
  const glyph = rgb(OG_TOKENS.ink50);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: field,
        }}
      >
        {/* 320/512 = 62.5% — inside Android's 80% maskable safe circle with
            room to spare, and still legible in a 32px tab. */}
        <svg width={320} height={320} viewBox="0 0 48 48" fill="none">
          <path
            d="M30 12.5a14 14 0 1 0 0 23"
            stroke={glyph}
            strokeWidth={4.5}
            strokeLinecap="round"
          />
          <path
            d="M27 15.5 42 32.5M42 15.5 27 32.5"
            stroke={glyph}
            strokeWidth={4.5}
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    size,
  );
}
