import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The discovery funnel, end to end: home -> deep search -> results.
 *
 * Runs against the fixture backend on port 8000 (see playwright.config.ts),
 * which speaks the real `GET /events` contract — so these assertions hold
 * against the real backend too.
 */

/**
 * A canonical event URL: `/events/{slug}-{uuid}`, of which a bare `/events/{uuid}`
 * is the degenerate case (an event whose title yields no ASCII slug).
 *
 * This used to be `/\/events\/[0-9a-f-]+$/`, which is the URL shape from before
 * event slugs existed. The uuid is still there — it is what resolves the event,
 * and it is why every link shared under the old shape still works — but it is no
 * longer the whole segment.
 */
const EVENT_URL =
  /\/events\/(?:[a-z0-9-]*-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const seriousOrWorse = (v: { impact?: string | null }) =>
  v.impact === 'critical' || v.impact === 'serious';

/**
 * Scroll the page once, end to end, and wait for it to stop animating.
 *
 * ── WHY AN AXE SCAN NEEDS THIS ───────────────────────────────────────────
 *
 * Two of this app's own performance devices make a naive scan report hundreds
 * of contrast failures that do not exist:
 *
 *  - `Reveal` starts blocks at `opacity: 0` and fades them in on an
 *    IntersectionObserver. Scanned mid-fade, every colour inside is a BLEND of
 *    the text and the background, so axe reads e.g. 2.57:1 where the settled
 *    value is 12:1. Measured directly with `getComputedStyle` on a settled
 *    page, the same elements have ZERO failures.
 *  - `content-visibility: auto` (`.cv-card`) takes off-screen grid rows out of
 *    the render tree entirely, and axe then resolves their colours to
 *    near-identical near-whites (~1.02:1).
 *
 * Scrolling to the bottom triggers every observer and renders every deferred
 * row; waiting for the transitions to finish removes the blends. What is left
 * is real.
 */
async function settleForAxe(page: Page) {
  // Already settled — the dark pass runs straight after the light one on the
  // same page, and sweeping a long page twice is what pushed this test past
  // even a tripled timeout.
  const alreadyRevealed = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-revealed]'));
    return nodes.length > 0 && nodes.every((n) => Number(getComputedStyle(n).opacity) === 1);
  });

  if (!alreadyRevealed) {
    // ── DRIVEN FROM THE TEST SIDE, NOT FROM AN IN-PAGE LOOP ─────────────
    //
    // The first version ran the whole sweep inside one `page.evaluate`,
    // awaiting `requestAnimationFrame` between steps. In headless Chromium a
    // page that is not being composited can stop firing rAF entirely — so the
    // promise never settled, `evaluate` has no timeout of its own, and the
    // test hung for twenty minutes without reaching its own deadline. Each
    // step is a round trip now, so Playwright's timeouts cover all of them.
    //
    // BOUNDED, because the point is to trip every observer, not to render the
    // page frame by frame: the reveals fire well inside a dozen viewports and
    // an unbounded sweep of a long page is pure cost.
    const height = await page.evaluate(() => window.innerHeight);
    const total = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(total / height), 12);
    for (let step = 1; step <= steps; step += 1) {
      await page.evaluate((top) => window.scrollTo(0, top), step * height);
      await page.waitForTimeout(40);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  // ── DISMISS THE LOCATION PROMPT IF THE SWEEP SUMMONED IT ─────────────
  //
  // `LocationPrompt` opens once the visitor has scrolled — which is exactly
  // what the sweep above does. It is a MODAL dialog, so everything outside it
  // becomes inert: the theme toggle this test clicks next simply stops
  // existing in the accessibility tree, and the failure reads as a missing
  // control rather than as a dialog sitting over the top of it. That is what
  // was timing this test out at three minutes.
  //
  // Dismissed rather than scanned around, because "Not now" is what a real
  // visitor does and it leaves the PAGE — the thing under test — reachable.
  //
  // WAITED FOR, not merely probed: the dialog animates in after the scroll, so
  // an immediate `isVisible()` reports false and the modal opens a moment
  // later anyway. `.catch` because on every page that never shows it, this
  // correctly times out and there is nothing to do.
  const notNow = page.getByRole('button', { name: 'Not now' });
  await notNow.waitFor({ state: 'visible', timeout: 2500 }).catch(() => undefined);
  if (await notNow.isVisible().catch(() => false)) {
    await notNow.click();
    await notNow.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined);
  }

  // The reveal transition is `--duration-reveal`; comfortably past it.
  await page.waitForTimeout(500);
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[data-revealed]')).every(
          (node) => Number(getComputedStyle(node).opacity) === 1,
        ),
      undefined,
      { timeout: 5000 },
    )
    // A page with no `Reveal` blocks never changes, so the predicate is already
    // true; one that legitimately stays hidden should not fail the a11y gate.
    .catch(() => undefined);
}

async function axeClean(page: Page, label: string) {
  await settleForAxe(page);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    // Still excluded even after settling: `content-visibility: auto` re-skips a
    // subtree the moment it scrolls back out of view, so a row rendered during
    // the pass above can be unresolved again by the time axe reaches it.
    //
    // `[class*="cv-card"]`, NOT `.cv-card`: the utility is applied as the
    // RESPONSIVE variant `sm:cv-card`, so that is the literal class name in the
    // DOM and a `.cv-card` selector matches nothing at all — and excluding a
    // selector that matches nothing fails silently.
    //
    // This hides nothing real. Every excluded card is the SAME component, with
    // the same chips and the same tokens, as the first six cards, which ARE
    // scanned on every one of these pages.
    .exclude('[class*="cv-card"]')
    // The browse page's sticky filter toolbar is parked off-screen with
    // `-translate-y-full` until you scroll. It is RENDERED — so axe scans it —
    // and its colours mid-transform resolve to `#edeceb` on `#ffffff` (1.17:1),
    // which is the same unresolved-subtree artefact as the two above rather
    // than anything a user can see. `display: none` would have hidden it from
    // axe and would also kill the slide animation, which is why the app does
    // not use it.
    .exclude('[class*="-translate-y-full"]')
    .analyze();
  expect(results.violations.filter(seriousOrWorse), `${label} a11y violations`).toEqual([]);
}

/** Browsing must never be gated: no route in this funnel may redirect to auth. */
async function expectPublic(page: Page) {
  expect(page.url()).not.toMatch(/sign-?in|login|auth/i);
}

test.describe('home', () => {
  test('renders the personalised landing with specific categories, spotlight and rows', async ({
    page,
  }) => {
    await page.goto('/');

    // ── THE h1 IS REAL, CORRECT AND NOT DRAWN ────────────────────────────
    //
    // The redesigned front page has no visible page heading: the biggest text
    // on the first screen is the name of an EVENT. The hero's title cannot be
    // the h1 either — it changes on every chevron press, and a document whose
    // heading mutates on a carousel click has no stable outline. So the h1 is
    // visually hidden, first in the document, and names the PAGE.
    //
    // Asserted with `toBeAttached`, not `toBeVisible`: `sr-only` clips it to a
    // 1px box, which is exactly what it should do and exactly what would fail
    // a visibility check.
    const pageHeading = page.getByRole('heading', { level: 1 });
    await expect(pageHeading).toBeAttached();
    await expect(pageHeading).toContainText(/Live events/i);

    // Eight SPECIFIC categories, each its own landing page — no "Explore".
    for (const label of [
      'Concerts',
      'Comedy',
      'Workshops',
      'Sports',
      'Festivals',
      'Nightlife',
      'Food & Drink',
      'Tech',
    ]) {
      await expect(
        page.getByRole('link', { name: new RegExp(`^${label.replace('&', '&')}`) }).first(),
      ).toBeVisible();
    }
    await expect(page.getByRole('link', { name: /^Concerts/ }).first()).toHaveAttribute(
      'href',
      '/categories/concerts',
    );

    // The hero. A labelled `<section>` — so, a `region` — carrying the
    // carousel, whose name says whether the events in it were CURATED by an
    // operator or fell back to the index. Either is fine here; what must be
    // true is that it exists and leads somewhere real.
    const hero = page.getByRole('region', { name: /Featured events|Events on sale now/ });
    await expect(hero).toBeVisible();
    await expect(hero.getByRole('link', { name: 'Book tickets' })).toHaveAttribute(
      'href',
      /^\/events\//,
    );

    // The listing under it, with the browse page's own filter vocabulary.
    await expect(page.getByRole('heading', { name: 'All Events', exact: true })).toBeVisible();
    // Every chip is a real, shareable URL rather than a client-side toggle —
    // which is the whole reason they are links and not buttons.
    //
    // SCOPED to the section: the footer offers "This weekend" too, and an
    // unscoped role query resolves to both. Two links to the same filter from
    // two places is correct product behaviour; a spec that cannot say which
    // one it means is not.
    const allEvents = page.getByRole('region', { name: 'All Events' });
    await expect(allEvents.getByRole('link', { name: 'This Weekend' })).toHaveAttribute(
      'href',
      '/events?when=weekend',
    );
    await expect(allEvents.getByRole('link', { name: 'Free', exact: true })).toHaveAttribute(
      'href',
      '/events?price=free',
    );

    await expect(page.getByRole('heading', { name: 'Browse by mood', exact: true })).toBeVisible();
    // "Trending near you" is deliberately GONE from this page. Its cards
    // carried urgency badges computed from remaining stock, and the poster
    // cards in "All Events" carry the same badge from the same helper — so the
    // rail was showing the same events again under a heading implying they
    // were different ones.
    await expect(page.getByRole('heading', { name: 'Trending near you' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Why Curatix', exact: true })).toBeVisible();
    await expect(page.getByText('Instant tickets')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();

    // The homepage is deliberately SHORT now: the rails that used to sit here
    // are one tap away behind a filter, not stacked below the fold.
    await expect(page.getByRole('heading', { name: 'Upcoming', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Popular cities', exact: true })).toHaveCount(0);

    await expectPublic(page);
  });

  test('carries SEO metadata, Open Graph and JSON-LD', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Discover live events, or hire a band/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /.+/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /.+/);

    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.map((b) => JSON.parse(b)['@type']);
    expect(types).toContain('WebSite'); // sitelinks search box
    expect(types).toContain('ItemList'); // the featured events

    const itemList = blocks.map((b) => JSON.parse(b)).find((d) => d['@type'] === 'ItemList');
    expect(itemList.itemListElement.length).toBeGreaterThan(0);
    expect(itemList.itemListElement[0].item['@type']).toBe('Event');
  });

  test('uses the icon set, never emojis', async ({ page }) => {
    await page.goto('/');
    const text = await page.locator('body').innerText();
    // Pictographic ranges — the design system uses lucide icons instead.
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(await page.locator('svg').count()).toBeGreaterThan(10);
  });

  test('passes axe in light and dark', async ({ page }) => {
    // TWO axe passes over the longest page in the app, in two themes, plus the
    // scroll sweep that makes them honest. Each scan measures ~9s here and the
    // home page is the biggest DOM of the three that run one, so the default
    // 30s budget is genuinely too small — it was timing out on the theme
    // toggle CLICK between the passes, which reads as a missing control and is
    // not. `test.slow()` (90s) was still short; this is the measured need with
    // room, and it is the only test in the file that asks for more.
    test.setTimeout(180_000);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await axeClean(page, 'home (light)');

    await page.getByRole('button', { name: /switch to dark theme/i }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await axeClean(page, 'home (dark)');
  });

  // 1024 is in here because it's where the header used to overflow by 123px:
  // the wide nav pills appeared at `lg` before the actions had room for them.
  //
  // This checks the PAGE never scrolls sideways, which is necessary and not
  // sufficient — a header can destroy itself internally without moving
  // `scrollWidth` by a pixel, and did. See "header nav never wraps or collides
  // with the search" below for the check that catches that.
  for (const width of [360, 768, 1024, 1280, 1440]) {
    test(`lays out at ${width}px with no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

test.describe('deep search', () => {
  test('opens with the keyboard, shows category shortcuts, then grouped suggestions', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');

    const palette = page.getByRole('combobox', { name: /Search events, artists/ });
    await expect(palette).toBeFocused();

    // Idle state: no options list — curated searches only feed the rolling
    // placeholder hint now (see `rolling-placeholder.test.tsx`); category
    // shortcuts are what a first-time visitor with no recent search gets.
    await expect(page.getByText('Browse by category')).toBeVisible();

    // Type-ahead: suggestions GROUPED by type.
    await palette.fill('comedy');
    await expect(page.getByRole('group', { name: 'Events' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Venues' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Organizers' })).toBeVisible();
  });

  test('is fully keyboard navigable and records a recent search', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: /Search events, artists/ }).fill('comedy');
    await expect(page.getByRole('group', { name: 'Events' })).toBeVisible();

    // Arrow through the options; the active one is reflected on the input.
    await page.keyboard.press('ArrowDown');
    const active = await page
      .getByRole('combobox', { name: /Search events, artists/ })
      .getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/events\//);
    await expectPublic(page);

    // Reopening from home now offers it under "Recent". The group is labelled
    // with the one word, not "Recent searches" — it sits inside a search
    // palette, so the second word was only ever restating the container.
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('group', { name: 'Recent' })).toBeVisible();
    await expect(page.getByRole('option', { name: /comedy/i }).first()).toBeVisible();
  });

  test('Escape closes and returns focus', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('combobox', { name: /Search events, artists/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: /Search events, artists/ })).toBeHidden();
  });

  test('free-text search lands on results', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: /Search events, artists/ }).fill('kabaddi');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/events\?q=kabaddi/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Search: kabaddi');
  });
});

test.describe('browse and results', () => {
  test('server-renders the first page of cards', async ({ page }) => {
    const response = await page.goto('/events');
    const html = (await response!.text()) ?? '';
    // Real cards in the HTML, not a client-side spinner.
    expect(html).toContain('/events/');
    // The card's anchor now holds only the title (it's a stretched link, so the
    // hit area is the card but the accessible name isn't the whole card) — so
    // assert on the card itself, which is what actually has to be server-rendered.
    await expect(
      page
        .locator('main ul li')
        .filter({ hasText: /from ₹|Free|Pricing soon/ })
        .first(),
    ).toBeVisible();
  });

  test('one-tap chips combine, update the URL, and clear', async ({ page }) => {
    await page.goto('/events');

    await page.getByRole('button', { name: 'This weekend', exact: true }).click();
    await expect(page).toHaveURL(/when=weekend/);

    await page.getByRole('button', { name: 'Free', exact: true }).click();
    await expect(page).toHaveURL(/price=free/);
    await expect(page).toHaveURL(/when=weekend/);

    await expect(page.getByRole('button', { name: 'This weekend', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);
  });

  test('a shared filtered URL renders the same filters on a cold load', async ({ page }) => {
    await page.goto('/events?category=comedy&city=Mumbai');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Comedy in Mumbai');
    // Whatever is applied always appears as a removable chip on the Active row —
    // the one place a filter can never be hidden by overflow.
    await expect(page.getByRole('button', { name: 'Comedy Remove filter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mumbai Remove filter' })).toBeVisible();
  });

  test('cursor-based infinite scroll pulls the next page', async ({ page }) => {
    await page.goto('/events');
    const cards = page.locator('main ul li a[href^="/events/"]');
    const first = await cards.count();
    expect(first).toBeGreaterThan(0);

    await page.mouse.wheel(0, 20000);
    await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBeGreaterThan(first);
  });

  test('empty state names the likely culprit and offers ways out', async ({ page }) => {
    await page.goto('/events?category=concerts&when=weekend&city=Nowhere');
    await expect(page.getByRole('heading', { name: 'Nothing matched all of that' })).toBeVisible();

    // The date window is relaxed first — it's the filter that most often empties
    // a list, and the one people care least about keeping.
    const relax = page.getByRole('button', { name: /Any date instead of this weekend/ });
    await expect(relax).toBeVisible();

    // ...plus real routes sideways, every one of them a control that works.
    await expect(page.getByRole('heading', { name: 'Try another category' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nearby cities' })).toBeVisible();
    await expect(page.getByRole('link', { name: /comedy night/ })).toBeVisible();

    await relax.click();
    await expect(page).not.toHaveURL(/when=weekend/);
  });

  test('error state offers a retry', async ({ page }) => {
    // The fixture returns 503 for this query, mirroring the backend error envelope.
    await page.goto('/events?q=__boom__');
    await expect(page.getByText(/couldn't load these events/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('offline state appears and recovers', async ({ page, context }) => {
    await page.goto('/events');
    await expect(page.getByRole('button', { name: 'This weekend', exact: true })).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText(/You're offline/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/You're offline/)).toBeHidden();
  });

  test('passes axe', async ({ page }) => {
    await page.goto('/events?category=comedy');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Comedy');
    await axeClean(page, 'results');
  });

  test('passes axe with the filter panel open', async ({ page }) => {
    await page.goto('/events');
    await page.getByRole('button', { name: /^All filters/ }).click();
    await expect(page.getByRole('heading', { name: 'All filters' })).toBeVisible();
    await axeClean(page, 'results (filter panel)');
  });
});

/**
 * The browse page redesign: header, banner, toolbar, drawer, layouts.
 *
 * The thread running through these: nothing is unreachable and nothing is
 * invented. Every control has a home at every width, and every number on screen
 * comes from a column the backend actually maintains.
 */
test.describe('the browse page', () => {
  test('orients you: breadcrumb, title, and a banner that adds rather than repeats', async ({
    page,
  }) => {
    await page.goto('/events?category=concerts&city=Mumbai');

    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(crumbs.getByRole('link', { name: 'Mumbai' })).toBeVisible();
    await expect(crumbs).toContainText('Concerts');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Concerts in Mumbai');

    // The banner carries the scope as an eyebrow and spends its headline on
    // something the h1 doesn't already say.
    const banner = page.getByRole('region', { name: 'Concerts \u00b7 Mumbai' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('heading')).not.toHaveText('Concerts in Mumbai');

    // Compact by contract: the banner must not push the grid off-screen.
    const box = (await banner.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(220);
    expect(box.height).toBeLessThanOrEqual(260);
  });

  test('counts are floors, never invented totals', async ({ page }) => {
    await page.goto('/events');
    // Cursor pagination has no COUNT(*), so anything still growing says so.
    await expect(page.getByText(/^\d+\+ events$/).first()).toBeVisible();
  });

  test('has no permanent sidebar; the full filter set is a slide-over', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'All filters' })).toBeHidden();

    await page.getByRole('button', { name: /^All filters/ }).click();
    const panel = page.getByRole('dialog', { name: 'All filters' });
    await expect(panel.getByRole('heading', { name: 'All filters' })).toBeVisible();

    // Draft-then-apply: choosing changes nothing until Apply is pressed.
    await panel.getByRole('button', { name: 'Comedy' }).click();
    await expect(page).not.toHaveURL(/category=comedy/);

    await panel.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/category=comedy/);
    await expect(panel).toBeHidden();
  });

  test('the drawer can reset everything it applied', async ({ page }) => {
    await page.goto('/events?category=comedy&when=today');
    await page.getByRole('button', { name: /^All filters/ }).click();
    const panel = page.getByRole('dialog', { name: 'All filters' });

    await panel.getByRole('button', { name: 'Reset' }).click();
    await panel.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/\/events$/);
  });

  test('filters that do not fit collapse into More, never into a scrollbar', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/events');

    const more = page.getByRole('button', { name: /More filters/ });
    await expect(more).toBeVisible();

    // Everything trimmed is still reachable — More opens the full set.
    await more.click();
    // `exact`, or this also matches the "Nightlife Collective" organiser facet.
    await expect(
      page
        .getByRole('dialog', { name: 'All filters' })
        .getByRole('button', { name: 'Nightlife', exact: true }),
    ).toBeVisible();
  });

  test('lays out 4 / 3 / 1 columns', async ({ page }) => {
    const columns = async () => {
      const tops = await page
        .locator('main ul li')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
      return tops.filter((top) => top === tops[0]).length;
    };

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/events');
    await expect(page.locator('main ul li').first()).toBeVisible();
    // FOUR at `lg`, not three. The grid was made denser on purpose — three
    // columns on a wide screen gave each card ~400px, and a 3:4 poster of that
    // width is 533px of image before a word of text (see event-grid.tsx). A
    // screenful now shows twelve events rather than six.
    expect(await columns()).toBe(4);

    // THREE at `sm`, not two: the grid is `sm:grid-cols-3 lg:grid-cols-4`, and
    // 800px is past the 640px `sm` breakpoint. The two-column step is below
    // that, and below `sm` the card becomes a compact ROW rather than a tile,
    // so the ladder is 4 / 3 / 1 with no two-column state at all.
    await page.setViewportSize({ width: 800, height: 900 });
    expect(await columns()).toBe(3);

    await page.setViewportSize({ width: 390, height: 900 });
    expect(await columns()).toBe(1);
  });

  test('grid and list are both available, and the choice sticks', async ({ page }) => {
    await page.goto('/events');
    await page.getByRole('button', { name: 'List view' }).click();
    await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.reload();
    await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('shows no rating, interest count or verified badge anywhere', async ({ page }) => {
    await page.goto('/events');
    await expect(page.locator('main')).not.toContainText(/interested|verified/i);
    await expect(page.getByText(/\d+% booked|\d+ people/i)).toHaveCount(0);
    // ...and no card promises a checkout that doesn't exist yet.
    await expect(page.locator('main')).not.toContainText(/Book tickets|Buy now/i);
  });
});

test.describe('the whole funnel', () => {
  test('home -> search -> results -> event', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: /Search events, artists/ }).fill('comedy');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/events\?q=comedy/);

    await page.getByRole('button', { name: 'This weekend', exact: true }).click();
    await expect(page).toHaveURL(/when=weekend/);

    await page.goto('/events?category=comedy');
    await page.locator('main ul li a[href^="/events/"]').first().click();
    await expect(page).toHaveURL(EVENT_URL);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tickets' })).toBeVisible();
    await expectPublic(page);
  });

  test('city and category landing pages are server-rendered with structured data', async ({
    page,
  }) => {
    await page.goto('/cities/mumbai');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Events in Mumbai');
    let blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.map((b) => JSON.parse(b)['@type'])).toContain('BreadcrumbList');

    await page.goto('/categories/concerts');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Concerts events');
    blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.map((b) => JSON.parse(b)['@type'])).toContain('ItemList');
  });

  test('the sitemap lists the landing pages', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml).toContain('/categories/concerts');
    expect(xml).toContain('/cities/mumbai');
    expect(xml).toContain('/events');
  });
});

test.describe('layout and navigation', () => {
  test('the first screen is a bookable event, not a screenful of chrome', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    const hero = page.getByRole('region', { name: /Featured events|Events on sale now/ });
    await expect(hero).toBeVisible();

    // The event's NAME, its PRICE and the way to buy it are all above the
    // fold. That is the whole argument for a hero that commits to one event
    // instead of shelving five: there is room to say what it is and what it
    // costs, and the CTA is reachable without a scroll.
    const cta = hero.getByRole('link', { name: 'Book tickets' });
    await expect(cta).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox!.y).toBeLessThan(900);

    // And it is a real event page, not a placeholder.
    await expect(cta).toHaveAttribute('href', EVENT_URL);
  });

  test('nav marks the current page, and the pill follows the route', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/events');
    const header = page.getByRole('banner');
    const nav = header.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');

    // The sliding pill is placed on the active item, not on a fixed slot.
    const pill = nav.locator('span[aria-hidden]').first();
    const events = await nav.getByRole('link', { name: 'Events' }).boundingBox();
    expect(Math.round((await pill.boundingBox())!.x)).toBe(Math.round(events!.x));

    // Everything the bar drops at narrower widths is in the menu, so nothing
    // is ever unreachable — that is what pays for a short nav.
    await nav.getByRole('button', { name: /^Categories/ }).click();
    const workshops = page.getByRole('link', { name: /^Workshops/ });
    await expect(workshops).toBeVisible();
    await expect(page.getByRole('link', { name: /^All events/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Browse by city/ })).toBeVisible();
    await workshops.click();
    await expect(page).toHaveURL('/categories/workshops');

    await expect(nav.getByRole('link', { name: 'Events' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    const trigger = await nav.getByRole('button', { name: /^Categories/ }).boundingBox();
    await expect
      .poll(async () => Math.round((await pill.boundingBox())!.x))
      .toBe(Math.round(trigger!.x));
  });

  /**
   * The regression test for the bug this header was rebuilt to fix.
   *
   * The old row was `[1fr auto 1fr]` with `min-w-0` on the side columns and a
   * 448px search in the middle: the nav overflowed its own column and painted
   * UNDER the search field at 1280 and 1440, and wrapped "Hire a band" onto
   * three lines at 1024. The existing overflow test never saw any of it,
   * because none of it moved `documentElement.scrollWidth` — which is exactly
   * why this one measures the boxes against each other instead.
   */
  for (const width of [768, 1024, 1280, 1440, 1920]) {
    test(`header nav never wraps or collides with the controls at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/events');
      const header = page.getByRole('banner');
      const items = header.getByRole('navigation', { name: 'Primary' }).locator('a, button');

      const boxes = [];
      for (const item of await items.all()) {
        if (!(await item.isVisible())) continue;
        boxes.push({ label: (await item.innerText()).trim(), box: (await item.boundingBox())! });
      }
      expect(boxes.length).toBeGreaterThan(0);

      for (const { label, box } of boxes) {
        // One line of 14px text in a py-2 pill. A wrap doubles this.
        expect(box.height, `${label} wrapped onto more than one line`).toBeLessThan(44);
      }

      // ── THE SEARCH IS ON ITS OWN ROW NOW ─────────────────────────────
      //
      // This used to assert that every nav item ended before the search field
      // began, because both lived in one bar and the nav was painting on top
      // of it. The field moved to a full-width row beneath, so the two are
      // never on the same line and that comparison is meaningless.
      //
      // What still has to hold — and what broke a header once already — is
      // that the nav does not run into the CONTROLS beside it. Same class of
      // bug, same measurement, against the element it can actually collide
      // with now.
      const row = header.locator(':scope > div').first();
      const rowBox = (await row.boundingBox())!;
      const actionsBox = (await row.locator(':scope > div').last().boundingBox())!;
      expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);

      for (const { label, box } of boxes) {
        expect(box.x + box.width, `${label} overlaps the header controls`).toBeLessThanOrEqual(
          actionsBox.x + 1,
        );
      }

      // And the field spans the row it was given, rather than being squeezed
      // by anything still sharing it.
      const search = header.getByRole('button', { name: /Search events, artists/ });
      await expect(search).toBeVisible();
      const field = (await search.boundingBox())!;
      expect(field.width, 'the search row is not full width').toBeGreaterThan(rowBox.width * 0.9);
      expect(field.y, 'the search sits below the nav row').toBeGreaterThan(rowBox.y);
    });
  }

  test('"/" opens search, but never while typing', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('/');
    const palette = page.getByRole('combobox', { name: /Search events, artists/ });
    await expect(palette).toBeFocused();

    // Inside the input, "/" must be a literal slash, not a re-trigger.
    await palette.fill('rock/pop');
    await expect(palette).toHaveValue('rock/pop');
  });

  test('rails and grids share one left edge at desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    // "All Events", not "Trending near you": the trending rail is no longer on
    // the front page (its cards showed the same events as the grid, under a
    // heading implying they were different ones). The claim is unchanged — a
    // heading and the first card under it share one left edge — and this is
    // the section that now carries it.
    const heading = await page
      .getByRole('heading', { name: 'All Events', exact: true })
      .boundingBox();
    const firstCard = await page
      .getByRole('heading', { name: 'All Events', exact: true })
      .locator('xpath=ancestor::section')
      .locator('a[href^="/events/"]')
      .first()
      .boundingBox();

    // Same column: a rail that bleeds past the container reads as misaligned.
    expect(Math.abs(firstCard!.x - heading!.x)).toBeLessThanOrEqual(1);
  });
});

/**
 * The Sort control is the page's one overlay launched from a sticky bar, which
 * is exactly the combination that used to put it UNDER the grid: the z-scale
 * had `sticky` above `dropdown`, so the options rendered behind the very bar
 * they came from.
 */
test.describe('the sort dropdown floats above everything', () => {
  const openSort = async (page: Page) => {
    await page.goto('/events');
    // Scrolled, so the toolbar is genuinely stuck and cards are underneath it.
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.getByLabel('Sort results').click();
    const option = page.getByRole('option', { name: 'Price: high to low' });
    await expect(option).toBeVisible();
    return option;
  };

  test('renders on top of the grid and the sticky toolbar, and is clickable', async ({ page }) => {
    const option = await openSort(page);

    // The real test isn't "is it visible" — a covered element is still visible.
    // It's whether the option is what the browser would hit at its own centre.
    const box = (await option.boundingBox())!;
    const onTop = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return Boolean(el?.closest('[role="option"]'));
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(onTop).toBe(true);

    await option.click();
    await expect(page).toHaveURL(/sort=price-desc/);
  });

  test('opens below its trigger with breathing room, and never clips', async ({ page }) => {
    const option = await openSort(page);
    const trigger = (await page.getByLabel('Sort results').boundingBox())!;
    // The POSITIONED wrapper, not the inner listbox — the listbox sits inside
    // the popup's own padding, so measuring it reports the offset PLUS that
    // padding and never matches what was actually configured.
    const popup = (await page.locator('[data-radix-popper-content-wrapper]').boundingBox())!;

    // Directly below, 8-12px clear of the trigger.
    const gap = popup.y - (trigger.y + trigger.height);
    expect(gap).toBeGreaterThanOrEqual(8);
    expect(gap).toBeLessThanOrEqual(12);

    // Fully inside the viewport: no ancestor's overflow can crop a portal.
    const viewport = page.viewportSize()!;
    expect(popup.y + popup.height).toBeLessThanOrEqual(viewport.height);
    expect(await option.isVisible()).toBe(true);
  });

  test('closes on Escape and on an outside click, and keeps focus', async ({ page }) => {
    await openSort(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(page.getByLabel('Sort results')).toBeFocused();

    await page.getByLabel('Sort results').click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.mouse.click(20, 400);
    await expect(page.getByRole('listbox')).toBeHidden();
  });

  test('is operable by keyboard alone', async ({ page }) => {
    await page.goto('/events');
    await page.getByLabel('Sort results').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    // `End`, not `ArrowDown`: the list opens with the current value highlighted,
    // so one ArrowDown can land back on the default — which is omitted from the
    // URL, and the assertion then fails for a reason that isn't a bug.
    await page.keyboard.press('End');
    // Wait for the highlight to actually land before committing. Pressing Enter
    // in the same tick sometimes commits the previously-active option, which
    // fails on a value that was never chosen.
    await expect(page.getByRole('option', { name: 'Price: high to low' })).toHaveAttribute(
      'data-highlighted',
      '',
    );
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/sort=price-desc/);
  });

  test('works on a phone too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/events');
    // Sort lives in the filter panel below `md`, where the toolbar has no room.
    await page.getByRole('button', { name: /^All filters/ }).click();
    const panel = page.getByRole('dialog', { name: 'All filters' });
    await panel.getByRole('button', { name: 'Price: low to high' }).click();
    await panel.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/sort=price-asc/);
  });
});

/**
 * The subscribe card offers real push reminders (`usePush`, see
 * `components/discovery/subscribe-card.tsx`) — it replaced an earlier card
 * that asked for a browser permission and claimed notifications were on when
 * nothing was subscribed. It renders for anonymous AND signed-in visitors
 * alike (every state says something true, including "sign in to use this"),
 * so signing in changes its content rather than removing it.
 */
test.describe('the subscribe card', () => {
  const CARD = { name: 'Event reminders' } as const;

  // Headless Chromium defaults Notification.permission to 'denied', which is
  // a real, correctly-handled state (`blocked`) but not the one these tests
  // are after — granting it up front exercises 'off'/'on' instead.
  test.use({ permissions: ['notifications'] });

  test('is offered to anonymous visitors, with the exact value it can deliver', async ({
    page,
  }) => {
    await page.goto('/events');
    const card = page.getByRole('region', CARD);
    await expect(card).toBeAttached();
    await expect(card).toContainText('Get a reminder before the doors open');
    // The ANONYMOUS copy, which is what this state actually renders. It used
    // to assert the signed-in description — a sentence the card only shows to
    // somebody who already has tickets, which is precisely who this state is
    // not for.
    await expect(card).toContainText(
      'to turn these on — a reminder is tied to the tickets on your account',
    );
    await expect(card.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('offers the real toggle once signed in, instead of a sign-in prompt', async ({ page }) => {
    // Headless Chromium reports Notification.permission as 'denied' from a
    // cold start rather than the real browser default of 'default' — the
    // granted context permission above overrides what a REQUEST would
    // resolve to, not this static property, so the card reads a permanently
    // blocked device unless this is corrected before the app's first read.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', {
        value: 'default',
        configurable: true,
      });
    });
    await page.goto('/events');
    const card = page.getByRole('region', CARD);
    await expect(card).toBeAttached();
    const withCard = await page.locator('main ul li').count();

    // A REAL session. A made-up token used to be enough, but the auth provider
    // now verifies a stored token against `/auth/me` before believing it — a
    // stale or revoked token must not present a signed-in UI that then fails at
    // the first real request. So the test has to sign in for real too.
    await page.evaluate(async () => {
      const response = await fetch('http://localhost:8000/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `card-${Date.now()}@example.com`,
          password: 'password123',
          full_name: 'Card Tester',
        }),
      });
      const body = (await response.json()) as { tokens: { access: string; refresh: string } };
      localStorage.setItem('ee-access', body.tokens.access);
      localStorage.setItem('ee-refresh', body.tokens.refresh);
    });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Still exactly one card — a reminder is tied to an account, not offered
    // twice, and the grid gains no cell either way.
    await expect(page.getByRole('region', CARD)).toHaveCount(1);
    await expect(page.locator('main ul li')).toHaveCount(withCard);
    await expect(card.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Turn on reminders' })).toBeVisible();
  });
});

/**
 * The event page. The thread here is the same as everywhere else on this site:
 * every number comes from a column the backend maintains, and inventory is
 * never served from a cache.
 */
test.describe('the event page', () => {
  const anEvent = async (page: Page) => {
    await page.goto('/events');
    await page.locator('main ul li a[href^="/events/"]').first().click();
    await expect(page).toHaveURL(EVENT_URL);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  };

  test('answers the questions in order: what, when, how much, where, who', async ({ page }) => {
    await anEvent(page);

    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Starts in', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tickets' })).toBeVisible();

    for (const heading of [
      'Good to know',
      'Organiser',
      'Getting there',
      'Frequently asked',
      'Before you book',
    ]) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }

    // The reading order is the DOM order, which is what a screen reader follows.
    const headings = await page.locator('h1, h2').allTextContents();
    const order = ['Good to know', 'Organiser', 'Getting there', 'Frequently asked'];
    const indexes = order.map((h) => headings.findIndex((text) => text.trim() === h));
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(indexes.every((i) => i >= 0)).toBe(true);
  });

  test('counts down without flashing a wrong value', async ({ page }) => {
    await anEvent(page);
    const clock = page.getByText('Starts in', { exact: true }).locator('..');
    await expect(clock).toBeVisible();
    const first = await clock.innerText();
    await page.waitForTimeout(2200);
    const second = await clock.innerText();
    // It ticks...
    expect(second).not.toBe(first);
    // ...and never shows a placeholder after the first tick.
    expect(second).not.toContain('—');
  });

  test('shows live availability and real tiers, never cached inventory', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/ticket-types')) requests.push(r.url());
    });

    await anEvent(page);
    const panel = page.getByRole('region', { name: 'Tickets' });

    // Every tier button names a price. `sold` and `available` are real columns.
    const tiers = panel.getByRole('button', { name: /₹|Free/ });
    expect(await tiers.count()).toBeGreaterThan(0);

    // The client re-verifies inventory rather than trusting the server payload.
    await expect.poll(() => requests.length, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test('quantity is bounded by what is actually left', async ({ page }) => {
    // Walk the results until an event with a sellable tier turns up. Skipping
    // when the first card happens to be sold out would mean this test quietly
    // never runs — which is the same as not having it.
    await page.goto('/events');
    const cards = page.locator('main ul li a[href^="/events/"]');
    const hrefs = (await cards.evaluateAll((links) =>
      links.map((a) => (a as HTMLAnchorElement).getAttribute('href')),
    )) as string[];

    let panel = page.getByRole('region', { name: 'Tickets' });
    let plus = panel.getByRole('button', { name: 'Increase quantity' });
    let found = false;
    for (const href of hrefs.slice(0, 8)) {
      await page.goto(href);
      panel = page.getByRole('region', { name: 'Tickets' });
      plus = panel.getByRole('button', { name: 'Increase quantity' });
      // ── WAIT, DO NOT SNAPSHOT ──────────────────────────────────────────
      //
      // This asked `plus.count()` immediately after `goto`. `count()` is a
      // SNAPSHOT — the one locator method that does not auto-wait — and the
      // ticket panel is a client island fed by an UNCACHED tier read, so on a
      // loaded machine it has not rendered yet. All eight events then read as
      // zero and the test failed as "no event has a sellable tier" while the
      // fixture was serving six perfectly sellable ones. Passing alone and
      // failing in a full run is exactly the shape a missing wait produces.
      const appeared = await plus
        .first()
        .waitFor({ state: 'attached', timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (appeared) {
        found = true;
        break;
      }
    }
    expect(found, 'no event in the first page has a sellable tier').toBe(true);

    for (let i = 0; i < 15; i += 1) {
      if (await plus.isDisabled()) break;
      await plus.click();
    }
    await expect(plus).toBeDisabled();
    await expect(panel.getByText(/Up to \d+ per order/)).toBeVisible();
  });

  test('one booking CTA per viewport, and it never promises a checkout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await anEvent(page);
    // Exactly ONE ticket panel exists in the document at every width — it is
    // placed by the grid, not duplicated per breakpoint. (It was duplicated
    // once, which put two `id="tickets"` anchors in every page.)
    await expect(page.getByRole('region', { name: 'Tickets' })).toHaveCount(1);
    await expect(page.locator('#tickets')).toHaveCount(1);

    // Desktop: the panel owns the CTA; the mobile bar is hidden.
    await expect(page.getByRole('link', { name: /Choose tickets|See tiers/ })).toBeHidden();

    // Exactly ONE booking CTA. It's a link into the funnel when there is stock
    // to sell, and a disabled button when there isn't — never both, and never a
    // live-looking button that goes nowhere.
    const cta = page
      .getByRole('link', { name: 'Book tickets' })
      .or(page.getByRole('button', { name: /^(Book tickets|Sold out)$/ }));
    await expect(cta).toHaveCount(1);
    if ((await page.getByRole('link', { name: 'Book tickets' }).count()) === 1) {
      await expect(page.getByRole('link', { name: 'Book tickets' })).toHaveAttribute(
        'href',
        /\/booking\/[0-9a-f-]+\?tickets=/,
      );
    } else {
      await expect(page.getByRole('button', { name: /^(Book tickets|Sold out)$/ })).toBeDisabled();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 2400));
    await expect(page.getByRole('link', { name: /Choose tickets|See tiers/ })).toBeVisible();
  });

  test('the photo opens full size and closes on Escape', async ({ page }) => {
    await anEvent(page);
    const open = page.getByRole('button', { name: 'View photo full size' });
    if ((await open.count()) === 0) test.skip(true, 'this event has no poster');
    await open.click();
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test('offers share fallbacks and directions that leave the site safely', async ({ page }) => {
    await anEvent(page);
    await page.getByRole('button', { name: /^Share/ }).click();
    // Scoped to the popover: "X" is one character and matches half the page.
    const menu = page.getByRole('dialog').filter({ hasText: 'Copy link' });
    await expect(menu.getByRole('button', { name: 'Copy link' })).toBeVisible();
    for (const label of ['WhatsApp', 'X', 'Facebook', 'Email']) {
      await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');

    const directions = page.getByRole('link', { name: /Directions/ });
    await expect(directions).toHaveAttribute('href', /google\.com\/maps/);
    await expect(directions).toHaveAttribute('target', '_blank');
    await expect(directions).toHaveAttribute('rel', /noopener/);
  });

  test('carries Event and BreadcrumbList structured data', async ({ page }) => {
    await anEvent(page);
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.map((b) => JSON.parse(b)['@type']);
    expect(types).toContain('Event');
    expect(types).toContain('BreadcrumbList');
  });

  test('invents no ratings, interest counts or trust badges', async ({ page }) => {
    await anEvent(page);
    await expect(page.getByText(/interested|verified organi[sz]er/i)).toHaveCount(0);
    await expect(page.getByText(/\d(\.\d)? ?(★|stars?)|\d+% booked/i)).toHaveCount(0);
  });

  test('passes axe', async ({ page }) => {
    await anEvent(page);
    await axeClean(page, 'event detail');
  });
});

test.describe('saving an event', () => {
  test('toggles without navigating, and survives a reload', async ({ page }) => {
    await page.goto('/');
    const save = page.getByRole('button', { name: /^Save .* for later$/ }).first();
    await expect(save).toHaveAttribute('aria-pressed', 'false');

    const label = await save.getAttribute('aria-label');
    await save.click();
    // The card is a link — saving must not navigate.
    // Relative, so it resolves against the config's baseURL. Hard-coding the
    // port made this assert on which port the dev server happened to get
    // rather than on whether anything navigated — it fails on :3001 while
    // the behaviour under test is perfectly fine.
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('button', { name: /^Remove .* from saved$/ }).first(),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('button', {
        name: label!.replace('Save ', 'Remove ').replace(' for later', ' from saved'),
      }),
    ).toBeVisible();
  });
});

test.describe('urgency is real', () => {
  test('every "selling fast" card states a concrete remaining count', async ({ page }) => {
    await page.goto('/');
    const section = page.locator('section', {
      has: page.getByRole('heading', { name: 'Selling fast' }),
    });
    if ((await section.count()) === 0) test.skip(true, 'nothing genuinely scarce right now');

    const cards = section.locator('a[href^="/events/"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      // A real number, never a vague "almost gone" or an invented percentage.
      await expect(cards.nth(i)).toContainText(/Only \d+ left|Last ticket left/);
    }
    // No fabricated social proof anywhere on the page.
    await expect(page.getByText(/interested|people viewing|\d+% booked/i)).toHaveCount(0);
  });
});
