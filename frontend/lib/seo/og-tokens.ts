/**
 * ── DESIGN TOKENS, MIRRORED FOR THE IMAGE RENDERERS ───────────────────────
 *
 * `styles/tokens.css` is the single source of truth for every colour in this
 * product, and `local-rules/no-raw-values` fails the build on any hex literal
 * in TS/TSX to keep it that way. This file is the ONE documented exception, and
 * it exists because of a hard constraint rather than convenience:
 *
 * `next/og`'s `ImageResponse` rasterises with Satori, which resolves inline
 * styles only. There is no document, no stylesheet and no cascade — a
 * `var(--primary)` inside an OG card renders as nothing at all, silently, and
 * you find out when somebody shares a link and gets a black rectangle. So the
 * icon, apple-icon and OpenGraph routes need literal values.
 *
 * Two things keep the mirror from drifting:
 *
 *  1. **It is RGB triples, in the same shape tokens.css stores them** — that
 *     file's colours are `--primary: var(--violet-600)` over
 *     `--violet-600: 124 58 237`, so a channel triple is the native unit here,
 *     not a translation of one.
 *  2. **`og-tokens.test.ts` parses `styles/tokens.css` and asserts every value
 *     below still matches.** Retune a ramp and the test fails naming the token,
 *     rather than the share card quietly going off-brand for a release.
 *
 * Only the handful of roles the share images actually use are mirrored. Do not
 * grow this into a second palette — if an image needs a colour that is not
 * here, add the one role, not the ramp.
 */

/** A colour as `styles/tokens.css` stores it: space-separated RGB channels. */
type Channels = readonly [number, number, number];

/** The token name in `styles/tokens.css` each value is copied from. */
export const OG_TOKENS = {
  /** `--ink-950` — the light theme's `--cta`, and the card's field. */
  ink950: [18, 17, 16],
  /** `--ink-900` — `--foreground` in light. */
  ink900: [28, 27, 25],
  /** `--ink-800`. */
  ink800: [55, 52, 48],
  /** `--ink-400` — the muted rung that reads correctly on a dark field. */
  ink400: [168, 163, 154],
  /** `--ink-300`. */
  ink300: [205, 201, 193],
  /** `--ink-50` — `--foreground` in dark, and the wordmark on the dark card. */
  ink50: [249, 247, 244],
  /** `--white`. */
  white: [255, 255, 255],
  /** `--violet-600` — `--primary`. The one brand accent on the card. */
  violet600: [124, 58, 237],
  /** `--violet-500`. */
  violet500: [139, 92, 246],
  /** `--butter-300` — the warm secondary the nav pill uses. */
  butter300: [238, 206, 124],
} as const satisfies Record<string, Channels>;

/**
 * ── LEGACY COMMA SYNTAX, AND IT IS NOT A STYLE PREFERENCE ─────────────────
 *
 * These emit `rgb(124, 58, 237)` and `rgba(124, 58, 237, 0.42)` rather than the
 * modern space-separated `rgb(124 58 237 / 0.42)` that `styles/tokens.css` uses,
 * because **Satori's CSS gradient parser does not accept the slash-alpha form**.
 *
 * It fails in a genuinely nasty way: a flat `background` accepts either syntax
 * happily, so the icons rendered correctly and the whole thing looked fine —
 * but the OG card's `radial-gradient(...)` threw at request time with
 *
 *     Error: 58 237 / 0) 46%): Missing )
 *
 * naming a fragment of the gradient string and nothing else. The card 500'd for
 * every crawler while the two icons beside it were served normally, which is
 * exactly the kind of half-broken that ships.
 *
 * Neither form contains a `#`, so `local-rules/no-raw-values` is satisfied
 * either way — the comma form simply also survives the gradient parser.
 */
export function rgb(channels: Channels): string {
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

/** Same, with an alpha channel. Legacy `rgba()` for the reason above. */
export function rgba(channels: Channels, alpha: number): string {
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

/**
 * The PWA manifest's `theme_color` and `background_color`.
 *
 * `theme_color` tints the Android status bar and the desktop title bar, so it
 * has to be the colour of the CHROME rather than the brand accent — a violet
 * title bar above a white app looks like a rendering fault. It is the light
 * theme's canvas.
 *
 * Manifest colours must be CSS colour strings; `rgb()` is valid there.
 */
export const MANIFEST_THEME_COLOR = rgb(OG_TOKENS.white);
export const MANIFEST_BACKGROUND_COLOR = rgb(OG_TOKENS.white);
