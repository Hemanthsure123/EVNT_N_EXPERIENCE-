import { type Page, expect, test } from '@playwright/test';

/**
 * What a crawler sees.
 *
 * None of this was asserted anywhere before: the canonical tags, the sitemap
 * and `robots.txt` were all correct by inspection and by nothing else, which is
 * how a canonical quietly starts pointing at the wrong page for six months.
 *
 * These run against the FIXTURE backend (see playwright.config.ts), whose event
 * payloads carry a `slug` exactly as the real one does — so the URL shape under
 * test here is the shape production serves.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const canonicalOf = (page: Page) => page.locator('link[rel="canonical"]').getAttribute('href');

test.describe('canonical URLs', () => {
  test('every main public page declares one, and it is self-referencing', async ({ page }) => {
    for (const path of ['/', '/events', '/cities', '/hire', '/about', '/pricing']) {
      await page.goto(path);
      const canonical = await canonicalOf(page);
      expect(canonical, `${path} has no canonical`).toBeTruthy();
      expect(new URL(canonical!).pathname.replace(/\/$/, '') || '/').toBe(path);
    }
  });

  test('a filtered browse URL points at the landing page that owns that filter', async ({
    page,
  }) => {
    // Without this, every filter permutation is its own indexable near-
    // duplicate competing with the prerendered landing pages built to rank for
    // exactly these queries.
    await page.goto('/events?category=comedy');
    expect(new URL((await canonicalOf(page))!).pathname).toBe('/categories/comedy');

    await page.goto('/events?city=Mumbai');
    expect(new URL((await canonicalOf(page))!).pathname).toBe('/cities/mumbai');

    // Two filters have no landing page of their own, so they consolidate onto
    // the browse hub rather than inventing a URL for every possible pair.
    await page.goto('/events?category=comedy&city=Mumbai');
    expect(new URL((await canonicalOf(page))!).pathname).toBe('/events');
  });

  test('a free-text search is crawlable but not indexable', async ({ page }) => {
    await page.goto('/events?q=kabaddi');
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
    expect(robots).toContain('follow');
  });
});

test.describe('event URLs', () => {
  test('an event page is at /events/{slug}-{uuid} and says so', async ({ page }) => {
    await page.goto('/events');
    const href = await page.locator('main ul li a[href^="/events/"]').first().getAttribute('href');
    expect(href).toMatch(new RegExp(`^/events/[a-z0-9-]+-${UUID.source}$`));

    await page.goto(href!);
    const canonical = await canonicalOf(page);
    expect(new URL(canonical!).pathname).toBe(href);
  });

  test('the bare uuid URL still works, and 308s to the canonical one', async ({ page }) => {
    // Every link shared before slugs existed, every ticket email and every
    // organizer bookmark is this shape. It must never break, and it should not
    // sit in the index as a duplicate of the URL it redirects to.
    await page.goto('/events');
    const href = await page.locator('main ul li a[href^="/events/"]').first().getAttribute('href');
    const id = href!.match(UUID)![0];

    const response = await page.request.get(`/events/${id}`, { maxRedirects: 0 });

    expect(response.status()).toBe(308);
    expect(response.headers()['location']).toContain(`-${id}`);
  });

  test('the redirect keeps the query string, so a basket survives it', async ({ page }) => {
    // The funnel's "Change tickets" link carries the tier selection in `?sel=`.
    // Dropping it here would silently empty a customer's basket mid-checkout.
    await page.goto('/events');
    const href = await page.locator('main ul li a[href^="/events/"]').first().getAttribute('href');
    const id = href!.match(UUID)![0];

    const response = await page.request.get(`/events/${id}?sel=abc%3A2`, { maxRedirects: 0 });

    expect(response.status()).toBe(308);
    expect(response.headers()['location']).toContain('sel=abc%3A2');
  });

  test('a canonical URL is served directly, with no redirect hop', async ({ page }) => {
    await page.goto('/events');
    const href = await page.locator('main ul li a[href^="/events/"]').first().getAttribute('href');

    const response = await page.request.get(href!, { maxRedirects: 0 });

    expect(response.status()).toBe(200);
  });
});

test.describe('a URL that does not resolve', () => {
  // ── A SOFT 404 IS A REAL SEO DEFECT ──────────────────────────────────────
  //
  // `notFound()` inside these routes renders the right page with a `200`.
  // Google calls that a soft 404: it crawls the URL, may index it, and reports
  // it in Search Console — and every mistyped or expired event link becomes an
  // indexable duplicate of the not-found page. `middleware.ts` returns the real
  // status for the cases it can decide without new I/O.

  test('a segment that is not an event ref is a real 404', async ({ request }) => {
    const response = await request.get('/events/not-an-event');
    expect(response.status()).toBe(404);
  });

  test('an event that does not exist is a real 404', async ({ request }) => {
    const response = await request.get('/events/00000000-0000-4000-8000-000000000000');
    expect(response.status()).toBe(404);
  });

  test('a city with no landing page is a real 404', async ({ request }) => {
    // The curated list is a constant in the bundle, so this costs no I/O.
    const response = await request.get('/cities/nowhere-at-all');
    expect(response.status()).toBe(404);
  });

  test('the 404 still renders the styled page, not a bare status', async ({ page }) => {
    // The status and the page are not a trade: `NextResponse.rewrite` with a
    // status keeps both. A bare 404 body would be a UX regression for anybody
    // who mistyped a link.
    await page.goto('/events/not-an-event');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('a live event and a curated city are untouched', async ({ page, request }) => {
    // The guard rail: middleware that 404s must never catch a real page.
    await page.goto('/events');
    const href = await page.locator('main ul li a[href^="/events/"]').first().getAttribute('href');
    expect((await request.get(href!, { maxRedirects: 0 })).status()).toBe(200);
    expect((await request.get('/cities/mumbai')).status()).toBe(200);
  });
});

test.describe('structured data', () => {
  const blocks = async (page: Page) => {
    const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
    return raw.map((b) => JSON.parse(b) as Record<string, unknown>);
  };

  test('the home page declares the site, the publisher and what is on sale', async ({ page }) => {
    await page.goto('/');
    const types = (await blocks(page)).map((b) => b['@type']);

    expect(types).toContain('WebSite'); // the sitelinks search box
    expect(types).toContain('Organization'); // WHO is saying this
    expect(types).toContain('ItemList'); // what is actually on sale
  });

  test('an event advertises availability that matches the page', async ({ page }) => {
    await page.goto('/events');
    const href = await page.locator('main ul li a[href^="/events/"]').first().getAttribute('href');
    // A direct navigation rather than a click, and a POLL rather than a single
    // read: the event page is `force-dynamic` behind a Suspense shell, so the
    // structured data lands after the first flush. Reading once, however well
    // timed, finds only the shell's Organization block often enough to be
    // flaky in a full-suite run and not in isolation — which is the worst kind
    // of test to leave behind.
    await page.goto(href!);
    await expect
      .poll(async () => (await blocks(page)).some((b) => b['@type'] === 'Event'))
      .toBe(true);

    const event = (await blocks(page)).find((b) => b['@type'] === 'Event') as
      | Record<string, unknown>
      | undefined;
    expect(event).toBeTruthy();

    // The JSON-LD `url` must byte-match the canonical, or Google reports an
    // inconsistency and may drop the rich result.
    expect(event!.url).toBe(await canonicalOf(page));

    const offers = event!.offers as { availability?: string } | undefined;
    if (offers?.availability) {
      // Whatever it says, it is one of the two real answers — never a
      // hard-coded "in stock" for an event nobody has counted.
      expect(['https://schema.org/InStock', 'https://schema.org/SoldOut']).toContain(
        offers.availability,
      );
    }
  });
});

test.describe('robots and the sitemap', () => {
  test('robots.txt points at the sitemap and shuts the private surfaces out', async ({
    request,
  }) => {
    const body = await (await request.get('/robots.txt')).text();

    expect(body).toContain('Sitemap:');
    expect(body).toContain('/sitemap.xml');
    for (const path of ['/admin', '/dashboard', '/account', '/booking']) {
      expect(body, `${path} must be disallowed`).toContain(`Disallow: ${path}`);
    }
  });

  test('the sitemap lists real event URLs, not just the landing pages', async ({ request }) => {
    // This is the whole point of `GET /events/sitemap`. Event pages carry the
    // `Event` structured data and are the only ones anybody searches for, and
    // they appeared in no sitemap at all — reachable to a crawler only by
    // walking landing pages that show twenty events each.
    const body = await (await request.get('/sitemap.xml')).text();

    const eventUrls = [...body.matchAll(/<loc>([^<]*\/events\/[^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(eventUrls.length).toBeGreaterThan(0);
    for (const url of eventUrls) expect(url).toMatch(UUID);
  });

  test('every sitemap entry carries a real lastmod, not the build time', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text();
    const stamps = [...body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);

    expect(stamps.length).toBeGreaterThan(0);
    // More than one distinct date: a single value everywhere is the signature
    // of `new Date()` on every row, which tells a crawler nothing.
    expect(new Set(stamps).size).toBeGreaterThan(1);
  });

  test('the sitemap never lists a path robots.txt disallows', async ({ request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text();
    const robots = await (await request.get('/robots.txt')).text();

    const disallowed = [...robots.matchAll(/Disallow:\s*(\S+)/g)].map((m) => m[1]);
    const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);

    for (const path of paths) {
      for (const rule of disallowed) {
        const blocked = path === rule || path.startsWith(rule.endsWith('/') ? rule : `${rule}/`);
        expect(blocked, `${path} is in the sitemap AND disallowed — both cannot be right`).toBe(
          false,
        );
      }
    }
  });
});

test.describe('sharing', () => {
  test('an event previews as the designed card, not a raw poster', async ({ page }) => {
    // `openGraph.images` on the page used to override `opengraph-image.tsx` in
    // the same segment, so every event WITH a poster shared as a bare image of
    // arbitrary aspect ratio and the designed 1200x630 card — the one carrying
    // the title, date and price — only appeared for events that had none.
    await page.goto('/events');
    await page.locator('main ul li a[href^="/events/"]').first().click();

    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(image).toContain('/opengraph-image');
    expect(await page.locator('meta[property="og:image:width"]').getAttribute('content')).toBe(
      '1200',
    );
    expect(await page.locator('meta[property="og:image:height"]').getAttribute('content')).toBe(
      '630',
    );
  });

  test('the site declares an Indian locale', async ({ page }) => {
    await page.goto('/');
    expect(await page.locator('meta[property="og:locale"]').getAttribute('content')).toBe('en_IN');
  });
});
