import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NO FAILURE MESSAGE IS RED.
 *
 * A source scan, not a render test, and deliberately so: the guarantee is about
 * the whole component tree and there is no single screen that mounts all of it.
 * `app/static-routes.test.ts` reads the filesystem for the same reason — "is in
 * the nav" and "is a route" are different claims, and only one of them can be
 * checked by rendering something.
 *
 * The rule and the two exemptions are documented in `notice.tsx`. In short: an
 * element that announces itself with `role="alert"` is telling somebody their
 * input was rejected or their action failed, and this platform reports that in
 * words. Red is kept for controls that DESTROY something and for indicators
 * that report a FACT (sold out, a denied scan, a health probe that is down) —
 * neither of which carries `role="alert"`.
 */

/**
 * Vitest runs from the frontend root, exactly as `app/static-routes.test.ts`
 * relies on. `import.meta.url` is NOT usable here: the environment is jsdom, so
 * it resolves to an `http:` URL and `fileURLToPath` refuses it.
 */
const ROOT = process.cwd();
const SCANNED = ['components', 'app'];

/**
 * Severity surfaces: `role="alert"` here reports a condition of the SYSTEM, not
 * the outcome of something the reader just did. Each is an operator's
 * what-needs-attention panel, where the colour is the signal.
 */
const EXEMPT = new Set([
  'components/admin/health-centre.tsx',
  'components/admin/attention-panel.tsx',
  'components/performer/studio-home.tsx',
]);

/** Every opening JSX tag with attributes. Good enough: it only has to find `role`. */
const TAG = /<[A-Za-z][A-Za-z0-9.]*\s[^<>]*?>/gs;
const RED = /\btext-destructive(-subtle-foreground)?\b/;

function tsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx') && !entry.endsWith('.stories.tsx')) found.push(full);
  }
  return found;
}

describe('failure messaging is never red', () => {
  it('no role="alert" element carries a red text class', () => {
    const offenders: string[] = [];

    for (const dir of SCANNED) {
      for (const file of tsxFiles(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split(sep).join('/');
        if (EXEMPT.has(rel)) continue;
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(TAG)) {
          const tag = match[0];
          if (!tag.includes('role="alert"')) continue;
          if (!RED.test(tag)) continue;
          const line = source.slice(0, match.index ?? 0).split('\n').length;
          offenders.push(`${rel}:${line}`);
        }
      }
    }

    // Named rather than counted: a bare `toHaveLength(0)` tells whoever
    // reintroduces one that a number moved, not which file to open.
    expect(offenders).toEqual([]);
  });

  it('the shared notice vocabulary is neutral', async () => {
    const { NOTICE_TEXT, NOTICE_PANEL } = await import('./notice');
    expect(NOTICE_TEXT).not.toMatch(RED);
    expect(NOTICE_PANEL).not.toMatch(RED);
    expect(NOTICE_PANEL).not.toContain('destructive');
  });
});
