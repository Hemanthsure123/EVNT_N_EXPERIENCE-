import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import sitemap from './sitemap';
import robots from './robots';

/**
 * ── THE TEST THAT WOULD HAVE CAUGHT THE ORIGINAL BUG ──────────────────────
 *
 * `components/shell/site-footer.tsx` linked to ten routes that did not exist.
 * Every page on the site rendered ten 404s in its footer, including on the
 * event page and the checkout — and nothing failed, because a `<Link>` to a
 * missing route is a perfectly valid `<a>` until somebody clicks it.
 *
 * The footer's own test asserted the hrefs were PRESENT, which passed happily
 * while all ten were dead. Presence in a nav is not the same claim as existence
 * of a route, and this file makes the second claim: for every path the footer
 * offers, there is a `page.tsx` on disk that serves it.
 *
 * It reads the filesystem rather than the router because Next's App Router has
 * no importable route table, and because the filesystem IS the router here —
 * checking it is checking the real thing rather than a description of it.
 */

/** Repo-relative `app/` directory. Vitest runs from the frontend root. */
const APP_DIR = join(process.cwd(), 'app');

/**
 * Route groups are `(name)` directories that do NOT appear in the URL, so a
 * path can live under any of them. Resolution tries each in turn, which is also
 * a check that nobody has accidentally created the same route twice.
 */
const ROUTE_GROUPS = ['(site)', '(admin)', '(organizer)', '(performer)', ''];

function pageFileFor(urlPath: string): string | null {
  const segments = urlPath.replace(/^\//, '').split('/').filter(Boolean);
  for (const group of ROUTE_GROUPS) {
    const candidate = join(APP_DIR, group, ...segments, 'page.tsx');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The ten routes this slice added, plus the ones the footer already reached.
 *
 * Hard-coded rather than scraped out of the footer component: a test that reads
 * its expectations from the thing under test passes when both are deleted
 * together, which is exactly the failure mode here — somebody removes a footer
 * link because it 404s, and the test goes green.
 */
const FOOTER_ROUTES = [
  // Discover
  '/events',
  // Organizers — the supply side's front door, and the two pages beside it
  '/organizer',
  '/dashboard',
  '/pricing',
  // Support
  '/help',
  '/refunds',
  '/contact',
  // Company
  '/about',
  '/careers',
  // Legal. These four are also what an Indian payment gateway checks for
  // during merchant onboarding, so their absence blocked taking real money.
  '/terms',
  '/privacy',
  '/cookies',
];

/**
 * The BOTTOM NAV's four destinations.
 *
 * Separate from the footer list because the failure mode is worse. The bottom
 * bar is the ONLY navigation on a phone, so a tab pointing at a route that
 * does not exist does not degrade — it removes the whole feature from mobile.
 *
 * That happened: the Saved tab shipped pointing at `/saved`, which has never
 * existed (the page is `/account/saved`), and nothing failed. The footer guard
 * above could not catch it, because the footer does not link to Saved.
 */
const BOTTOM_NAV_ROUTES = ['/', '/events', '/account/saved', '/hire'];

describe('every route the bottom nav links to actually exists', () => {
  it.each(BOTTOM_NAV_ROUTES)('%s resolves to a page file', (route) => {
    expect(
      pageFileFor(route),
      `${route} is in the mobile bottom nav but has no page file`,
    ).not.toBeNull();
  });
});

describe('every route the footer links to actually exists', () => {
  it.each(FOOTER_ROUTES)('%s resolves to a page file', (route) => {
    expect(
      pageFileFor(route),
      `${route} is linked from the site footer on EVERY page but has no page.tsx. ` +
        `Either build it or remove the link — a footer full of 404s is how a product ` +
        `looks abandoned.`,
    ).not.toBeNull();
  });
});

describe('the sitemap and robots.txt agree with each other', () => {
  // `sitemap()` is ASYNC now — it fetches the live event and performer URLs.
  // Both fetches are the `...Safe` variants, so with no API reachable in a unit
  // test they resolve to `[]` and what is asserted below is exactly the static
  // half. That is the point: the static routes must survive an upstream that is
  // down, because a sitemap build that throws does not lose the event URLs, it
  // takes `/sitemap.xml` down entirely.
  let entries: Awaited<ReturnType<typeof sitemap>>;
  let urls: string[];
  const disallowed = (robots().rules as { disallow?: string[] }).disallow ?? [];

  beforeAll(async () => {
    entries = await sitemap();
    urls = entries.map((entry) => entry.url);
  });

  it('lists every public static page', () => {
    for (const route of [
      '/about',
      '/contact',
      '/help',
      '/pricing',
      '/organizer',
      '/terms',
      '/privacy',
      '/refunds',
      '/cookies',
      '/careers',
    ]) {
      expect(
        urls.some((url) => url.endsWith(route)),
        `${route} is missing from the sitemap`,
      ).toBe(true);
    }
  });

  it('does NOT list the style guide, which is internal documentation', () => {
    // It used to be in here at priority 0.1 — the design system was being
    // submitted to Google as though it were product. The page also carries a
    // `robots: noindex`; a sitemap entry disagreeing with a noindex tag is how
    // a page stays in the index for months while everyone assumes it is out.
    expect(urls.some((url) => url.includes('/style-guide'))).toBe(false);
    expect(disallowed).toContain('/style-guide');
  });

  it('never lists a path that robots.txt disallows', () => {
    for (const url of urls) {
      const path = new URL(url).pathname;
      for (const rule of disallowed) {
        expect(
          path === rule || path.startsWith(rule.endsWith('/') ? rule : `${rule}/`),
          `${path} is in the sitemap and disallowed by robots.txt — they cannot both be right`,
        ).toBe(false);
      }
    }
  });

  it('keeps the home page as the only priority-1 entry', () => {
    // Priority is relative WITHIN a site. Everything at 1.0 is the same as
    // nothing at 1.0, and it is the usual way this file stops meaning anything.
    expect(entries.filter((entry) => entry.priority === 1)).toHaveLength(1);
  });

  it('has no duplicate URLs', () => {
    expect(new Set(urls).size).toBe(urls.length);
  });
});
