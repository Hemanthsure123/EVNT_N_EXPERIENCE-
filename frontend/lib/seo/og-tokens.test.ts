import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANIFEST_THEME_COLOR, OG_TOKENS, rgb, rgba } from './og-tokens';

/**
 * `og-tokens.ts` is a hand-copied mirror of `styles/tokens.css`, which it has to
 * be — Satori resolves inline styles only, so an OG card cannot read a CSS
 * variable. A mirror nobody checks is a palette that silently forks the first
 * time a ramp is retuned, and the symptom (share cards off-brand) is invisible
 * from inside the app.
 *
 * So this parses the real stylesheet and asserts every mirrored value against
 * it. When it fails it names the token, which is the whole point: the fix is to
 * copy one line, not to go hunting for what changed.
 */

const TOKENS_CSS = readFileSync(join(process.cwd(), 'styles', 'tokens.css'), 'utf8');

/** Reads `--name: 1 2 3;` out of tokens.css. Returns null when the token is absent. */
function readChannels(name: string): readonly [number, number, number] | null {
  // The `:root` block declares each primitive ramp once. A token may be
  // redeclared under `.dark`, but only the PRIMITIVE ramps are mirrored here
  // and those are theme-independent by construction — so the first match is
  // the right one, and a token that is theme-dependent would be caught by the
  // "is a primitive" assertion below rather than read wrongly.
  const match = TOKENS_CSS.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

/** Mirror key -> the tokens.css primitive it claims to copy. */
const CLAIMS: Record<keyof typeof OG_TOKENS, string> = {
  ink950: 'ink-950',
  ink900: 'ink-900',
  ink800: 'ink-800',
  ink400: 'ink-400',
  ink300: 'ink-300',
  ink50: 'ink-50',
  white: 'white',
  violet600: 'violet-600',
  violet500: 'violet-500',
  butter300: 'butter-300',
};

describe('og-tokens mirrors styles/tokens.css', () => {
  it.each(Object.entries(CLAIMS))('OG_TOKENS.%s matches --%s in tokens.css', (key, tokenName) => {
    const fromCss = readChannels(tokenName);
    expect(
      fromCss,
      `--${tokenName} was not found in styles/tokens.css. Either the token was ` +
        `renamed (update CLAIMS) or removed (drop it from OG_TOKENS).`,
    ).not.toBeNull();
    expect(OG_TOKENS[key as keyof typeof OG_TOKENS]).toEqual(fromCss);
  });

  it('covers every key in OG_TOKENS, so a new one cannot skip the check', () => {
    expect(Object.keys(OG_TOKENS).sort()).toEqual(Object.keys(CLAIMS).sort());
  });
});

describe('the colour helpers emit what Satori and the manifest accept', () => {
  it('rgb() emits comma-separated channels and no hex', () => {
    expect(rgb(OG_TOKENS.violet600)).toBe('rgb(124, 58, 237)');
    // A `#` here would trip local-rules/no-raw-values at every call site, which
    // is exactly why these helpers exist rather than inline literals.
    expect(rgb(OG_TOKENS.violet600)).not.toContain('#');
  });

  /**
   * The regression test for a real, shipped bug.
   *
   * These emitted the modern `rgb(r g b / a)` slash-alpha form first. Satori
   * accepts it in a flat `background` — so the app icons rendered perfectly —
   * but its GRADIENT parser does not, and the OG card threw
   * `Error: 58 237 / 0) 46%): Missing )` for every crawler that asked for it.
   * Half the image routes worked, which is how it got as far as a build.
   */
  it('rgba() uses the LEGACY comma form, which Satori gradients can parse', () => {
    expect(rgba(OG_TOKENS.white, 0.6)).toBe('rgba(255, 255, 255, 0.6)');
    expect(rgba(OG_TOKENS.white, 0.6)).not.toContain('/');
  });

  it('neither helper emits a slash, in any combination', () => {
    for (const channels of Object.values(OG_TOKENS)) {
      expect(rgb(channels)).not.toContain('/');
      expect(rgba(channels, 0)).not.toContain('/');
      expect(rgba(channels, 1)).not.toContain('/');
    }
  });

  it('the manifest theme colour is the CHROME, not the brand accent', () => {
    // A violet Android status bar above a white app reads as a rendering fault.
    expect(MANIFEST_THEME_COLOR).toBe(rgb(OG_TOKENS.white));
    expect(MANIFEST_THEME_COLOR).not.toBe(rgb(OG_TOKENS.violet600));
  });
});
