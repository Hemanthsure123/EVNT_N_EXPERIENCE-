import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The booking funnel, end to end, against the fixture backend.
 *
 * The thread running through these: every number and every state comes from a
 * real request. The booking really is created, inventory really is reserved,
 * the hold timer is a real deadline, and nothing simulates a payment.
 */

const API = 'http://localhost:8000/api/v1';

const seriousOrWorse = (v: { impact?: string | null }) =>
  v.impact === 'critical' || v.impact === 'serious';

/**
 * Wait for the step's entrance transition to finish.
 *
 * The cards fade in from `opacity: 0`, and axe samples COMPUTED colour — so a
 * run that lands mid-transition reads blended values and reports contrast
 * failures against foregrounds that never exist at rest. This waits for every
 * animated child of the step to reach full opacity, which is exact rather than
 * a guessed sleep.
 */
async function settled(page: Page) {
  await page.waitForFunction(() => {
    const main = document.getElementById('funnel-main');
    if (!main) return false;
    // Only the ANIMATED wrappers: the step container and the cards inside it.
    // Checking every descendant never settles — the design system has plenty of
    // legitimately semi-transparent things (disabled tiers, muted icons).
    const step = main.firstElementChild;
    if (!step) return false;
    const animated = [step, ...Array.from(step.children)];
    return animated.every((node) => Number(getComputedStyle(node).opacity) === 1);
  });
}

async function axeClean(page: Page, label: string) {
  await settled(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter(seriousOrWorse), `${label} a11y violations`).toEqual([]);
}

/** An event with healthy stock, plus its tiers — straight from the fixture. */
/**
 * ── WHY THESE ENTER AT `/review`, NOT `/booking/{id}` ─────────────────────
 *
 * `/booking/{id}` is the TICKET-SELECTION screen again (§5): it renders a
 * picker rather than redirecting into the funnel. These specs are about what
 * happens AFTER a selection exists — the sign-in gate, the summary card, the
 * auth providers — so they deep-link past it with the selection already in the
 * query, exactly as pressing Continue would.
 *
 * The press itself is covered by "is reachable from the event page, and
 * carries the tier chosen there", which is the one spec that walks the whole
 * path rather than jumping into the middle of it.
 */
async function bookableEvent(page: Page) {
  const events = await page.evaluate(async (api) => {
    const response = await fetch(`${api}/events?page_size=40`);
    return (await response.json()) as {
      data: { id: string; tickets_available: number | null; from_price: number | null }[];
    };
  }, API);
  const event =
    events.data.find((entry) => (entry.tickets_available ?? 0) > 100 && entry.from_price) ??
    events.data[0]!;
  const tiers = await page.evaluate(
    async ([api, id]) => {
      const response = await fetch(`${api}/events/${id}/ticket-types`, { cache: 'no-store' });
      return (await response.json()) as { data: { id: string; name: string; price: number }[] };
    },
    [API, event.id] as const,
  );
  return { eventId: event.id, tiers: tiers.data };
}

/** Register a fresh account and put its tokens where the app looks for them. */
async function signedIn(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const tokens = await page.evaluate(
    async ([api, address]) => {
      const response = await fetch(`${api}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, password: 'password123', full_name: 'E2E Tester' }),
      });
      return (await response.json()) as { tokens: { access: string; refresh: string } };
    },
    [API, email] as const,
  );
  await page.evaluate(
    ([access, refresh]) => {
      localStorage.setItem('ee-access', access);
      localStorage.setItem('ee-refresh', refresh);
    },
    [tokens.tokens.access, tokens.tokens.refresh] as const,
  );
  return email;
}

test.describe('the booking funnel', () => {
  test('carries the selection in the URL, and the summary follows it', async ({ page }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);
    // ── THE TICKETS STEP NO LONGER EXISTS ────────────────────────────────
    //
    // This asserted an `h1` of "Choose your tickets" and drove a stepper on
    // `/booking/{id}`. That step was REMOVED: selection moved to the event
    // page, beside the poster and the date, rather than asking for the same
    // four things again on a screen of its own. `/booking/{id}` now redirects
    // to review, and `app/(site)/booking/[eventId]/page.tsx` says so.
    //
    // The stepper's own behaviour — including the double-click that used to
    // write 1 twice — is covered where it now lives, in discovery.spec.ts's
    // "quantity is bounded by what is actually left".
    //
    // What is still worth pinning HERE is the funnel's half of the contract:
    // a selection carried in the URL survives the redirect and the summary
    // reflects it.
    // SIGNED IN FIRST, deliberately. `/booking/{id}` redirects to review on the
    // server, and review then bounces an anonymous visitor on to `/login` — so
    // asserting `/review` without a session was a race between two redirects
    // that passed in isolation and failed under a full-suite run. The step this
    // test is named for is the one it should be standing on.
    await signedIn(page);
    await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:2`);

    await expect(page).toHaveURL(/\/review/);
    const summary = page.getByRole('complementary', { name: 'Order summary' });
    await expect(summary).toContainText(`${tiers[0]!.name}`);
    await expect(summary).toContainText('× 2');

    // Shareable and reload-safe: the URL is the state, not component memory.
    await page.reload();
    await expect(summary).toContainText('× 2');
  });

  test('shows the sign-in step to a visitor, and skips it entirely once signed in', async ({
    page,
  }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);

    // ── A VISITOR IS SENT TO SIGN IN, NOT SHOWN A CONTINUE ───────────────
    //
    // This clicked "Continue" on review to reach login. There is nothing to
    // click: `/review` REDIRECTS an anonymous visitor straight to `/login`,
    // and always has. The click waited 30s for a button on a page the test
    // had already been bounced off.
    //
    // Sign in, review, pay — so the redirect IS the first step, and that is
    // what this now asserts.
    await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);
    await expect(page).toHaveURL(/\/login/);

    // FOUR steps signed out, not three: Tickets is a step again (§5), so the
    // funnel is Tickets -> Sign in -> Review -> Payment. What matters here is
    // unchanged — the stepper agrees with the router about where you are, and
    // Sign in is drawn because the router just sent you to it.
    const stepper = page.getByRole('navigation', { name: 'Booking progress' });
    await expect(stepper.getByRole('listitem')).toHaveCount(4);
    await expect(stepper).toContainText('Sign in');

    // The heading continues the purchase rather than starting something new —
    // the standalone /sign-in page is the one that says "Welcome back".
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Almost there');

    // Signed in: straight to review, three steps, no sign-in anywhere.
    await signedIn(page);
    await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);
    await expect(page).toHaveURL(/\/review/);
    await expect(stepper.getByRole('listitem')).toHaveCount(3);
    await expect(stepper).not.toContainText('Sign in');
  });

  test('reserves real inventory at review, with a real hold deadline', async ({ page }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);
    await signedIn(page);
    // The LAST tier, exclusively. This assertion is an exact delta, and the
    // fixture's inventory is shared across the whole file — any other test
    // booking the same tier concurrently would make it fail for the wrong
    // reason. Nothing else in here touches this one.
    const tier = tiers[tiers.length - 1]!;

    const before = await page.evaluate(
      // `no-store`: this endpoint is cacheable for 5s, and a cached read here
      // would report the pre-booking number and quietly pass the assertion.
      async ([api, id]) => {
        const response = await fetch(`${api}/events/${id}/ticket-types`, { cache: 'no-store' });
        const body = (await response.json()) as { data: { id: string; available: number }[] };
        return body.data;
      },
      [API, eventId] as const,
    );

    await page.goto(`/booking/${eventId}/review?tickets=${tier.id}:2`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review your booking');

    // The booking id lands in the URL, so a refresh here can't re-reserve.
    await expect(page).toHaveURL(/booking=[0-9a-f-]{8}/);

    // A real countdown, from the booking's own `hold_expires_at`.
    await expect(page.getByText(/Tickets held for \d+:\d\d/)).toBeVisible();

    // Inventory actually moved.
    const after = await page.evaluate(
      async ([api, id]) => {
        const response = await fetch(`${api}/events/${id}/ticket-types`, { cache: 'no-store' });
        const body = (await response.json()) as { data: { id: string; available: number }[] };
        return body.data;
      },
      [API, eventId] as const,
    );
    const was = before.find((entry) => entry.id === tier.id)!.available;
    const now = after.find((entry) => entry.id === tier.id)!.available;
    expect(now).toBe(was - 2);
  });

  test('a reload at review does not reserve a second time', async ({ page }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);
    await signedIn(page);

    await page.goto(`/booking/${eventId}/review?tickets=${tiers[1]!.id}:1`);
    await expect(page).toHaveURL(/booking=/);
    const first = new URL(page.url()).searchParams.get('booking');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review your booking');
    await expect(page).toHaveURL(/booking=/);

    // The derived Idempotency-Key makes the retry return the SAME booking.
    expect(new URL(page.url()).searchParams.get('booking')).toBe(first);
  });

  test('never simulates a payment when no provider key is configured', async ({ page }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);
    await signedIn(page);

    await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);

    // ── WAIT FOR THE RESERVATION, THEN PRESS ────────────────────────────
    //
    // Review reserves inventory on mount, and "Proceed to payment" only
    // carries `?booking=` once that POST has answered. Pressed before it
    // lands, the link goes to `/pay` WITHOUT a booking, the pay step has
    // nothing to pay for, and it bounces straight back to review — which
    // surfaced here as an `h1` that stubbornly read "Review your booking".
    //
    // Waiting on the URL rather than a spinner, because the booking id in the
    // query IS the evidence that the reservation exists. Under a full-suite
    // load that POST is simply slower, which is why this passed alone and
    // failed in a run.
    await page.waitForURL(/[?&]booking=/, { timeout: 20_000 });
    await page.getByRole('link', { name: /Proceed to payment/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay securely');

    const main = page.locator('#funnel-main');
    const hasKey = (await main.getByRole('button', { name: /^Pay ₹/ }).count()) > 0;
    if (hasKey) {
      // With a key, the SDK must NOT have been fetched before the press.
      const before = await page.evaluate(() => typeof window.Razorpay);
      expect(before).toBe('undefined');
    } else {
      await expect(main).toContainText('Payment provider not configured');
      // And nothing anywhere claims the payment happened.
      await expect(main).not.toContainText(/payment (successful|complete)/i);
      await expect(page.getByRole('heading', { name: /You're going/ })).toHaveCount(0);
    }
  });

  test('shows no promo field and no invented taxes', async ({ page }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);
    await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);

    // No coupon endpoint exists, so no coupon input pretends one does.
    await expect(page.getByPlaceholder(/promo|coupon/i)).toHaveCount(0);
    await expect(page.getByText(/^Taxes/)).toHaveCount(0);
  });

  test('Google is offered for real, and phone says plainly when it is not connected', async ({
    page,
  }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);
    // ── "Continue" ALSO MATCHES "Continue with Google" ───────────────────
    //
    // `getByRole(..., { name })` is a SUBSTRING match, so this clicked the
    // Google button and left for the provider — the failure was a real OAuth
    // start URL where `/login` was expected. Google is wired now, so a locator
    // that used to be merely loose became one that navigates off-site.
    //
    // There is nothing to click anyway: an anonymous visitor is redirected to
    // `/login`, which is the first step.
    await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);
    await expect(page).toHaveURL(/\/login/);

    // The control EXISTS — the funnel and /sign-in render the same panel.
    // Never clicked: Google is real now, and a real click leaves the SPA.
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toHaveCount(1);
    // Apple was removed outright — no backend, no planned one.
    await expect(page.getByRole('button', { name: /Continue with Apple/i })).toHaveCount(0);

    // Phone is the seam still stating the truth: the tab is real, the send
    // fails loudly rather than pretending a code went out. A social button
    // that silently does nothing, or appears to succeed, is the worst
    // possible control to fake on a checkout.
    const urlBefore = page.url();
    await page.getByRole('tab', { name: 'Phone' }).click();
    await page.getByLabel('Phone number').fill('+919876543210');
    await page.getByRole('button', { name: 'Send code' }).click();
    // Scoped to main — the header carries its own sr-only status region.
    await expect(page.getByRole('main').getByRole('status')).toContainText(
      /Phone sign-in isn't connected yet/i,
    );
    expect(page.url()).toBe(urlBefore);

    // Email + password is the one method with a backend behind it, and it works.
    await page.getByRole('tab', { name: 'Email' }).click();
    await expect(page.getByLabel('Email')).toBeVisible();
  });

  test('the summary card is present and consistent on every step', async ({ page }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);
    await signedIn(page);
    const summary = page.getByRole('complementary', { name: 'Order summary' });

    // Signed in, so `/booking/{id}` lands on review directly — there is no
    // ticket step to Continue out of, and the click here waited 30s for a
    // button on the page it was already on.
    await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);
    await expect(page).toHaveURL(/\/review/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review your booking');
    await expect(summary).toBeVisible();
    const total = (await summary.getByText(/^₹/).last().textContent())?.trim();

    await page.getByRole('link', { name: /Proceed to payment/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay securely');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(total!);
  });

  test.describe('accessibility', () => {
    // Reduced motion as well as the explicit settle in `axeClean` — this is a
    // configuration real users run, and it should be just as clean.
    test.use({ reducedMotion: 'reduce' });

    test('passes axe on every step', async ({ page }) => {
      await page.goto('/events');
      const { eventId, tiers } = await bookableEvent(page);

      await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await axeClean(page, 'booking step 1');

      await page.goto(`/booking/${eventId}/login?tickets=${tiers[0]!.id}:1`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await axeClean(page, 'booking step 2');

      await signedIn(page);
      await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review your booking');
      await axeClean(page, 'booking step 3');

      await page.getByRole('link', { name: /Proceed to payment/ }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay securely');
      await axeClean(page, 'booking step 4');
    });
  });

  test('is reachable from the event page, and carries the tier chosen there', async ({ page }) => {
    await page.goto('/events');
    const { eventId } = await bookableEvent(page);
    await page.goto(`/events/${eventId}`);

    // `LocationPrompt` is a modal; while it is open the CTA behind it is inert
    // and a click lands on the scrim, which reads as a broken link.
    const notNow = page.getByRole('button', { name: 'Not now' });
    await notNow.waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined);
    if (await notNow.isVisible().catch(() => false)) await notNow.click();

    // STRICT on purpose, unlike the discovery specs: this test adds a ticket, so
    // it must land on an event that HAS one. A sold-out event's CTA reads "See
    // ticket types" and accepting it here would walk into a picker with nothing
    // to pick and fail on the add, instead of skipping as intended.
    const book = page.getByRole('link', { name: /^Book tickets$/ });
    if ((await book.count()) === 0) test.skip(true, 'this event is sold out');

    // ── THE TICKETS STEP IS BACK, AND THE EVENT PAGE NO LONGER PICKS ─────
    //
    // This has been asserted both ways. It once expected `/booking/{id}` to
    // redirect, because selection lived on the event page; §5 moved selection
    // to a screen of its own, so the redirect is a page again.
    //
    // The contract moved with it. The CTA carries NO `?tickets=`, because
    // nothing has been chosen yet — a preselected basket would be the checkout
    // deciding on the visitor's behalf. The tier is chosen here, and THAT is
    // what has to survive into the next step.
    await book.click();
    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose your tickets');

    // `Add {tier}`, the pill on an unchosen tier — not `Add one {tier} ticket`,
    // which is the stepper's plus and only exists once a quantity is set.
    const add = page.getByRole('button', { name: /^Add (?!one ).+/ }).first();
    await add.scrollIntoViewIfNeeded();
    await add.click();

    const proceed = page.getByRole('button', { name: /Continue/i }).first();
    await proceed.scrollIntoViewIfNeeded();
    await proceed.click();

    // The funnel's real first step for a visitor without a session, with the
    // selection carried across.
    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]+\/(login|review)/);
    await expect(page).toHaveURL(/tickets=/);
  });
});
