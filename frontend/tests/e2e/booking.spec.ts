import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The booking funnel, end to end, against the fixture backend.
 *
 * The thread running through these: every number and every state comes from a
 * real request. The booking really is created, inventory really is reserved,
 * the hold timer is a real deadline, and nothing simulates a payment.
 */

/**
 * The fixture's origin, overridable.
 *
 * Hard-coded, this file could only ever run against port 8000 — and on a
 * developer machine 8000 is as contended as 3000: the real Django backend uses
 * it, and so does anything else somebody happens to have open. When it is
 * taken, every test here fails in `bookableEvent` with a 404 that says nothing
 * about ports. `E2E_API` is the same escape hatch `E2E_PORT` already gives the
 * app server; CI sets neither and gets exactly what it had.
 */
const API = process.env.E2E_API ?? 'http://localhost:8000/api/v1';

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

  test('asks a visitor to sign in WITHOUT taking the screen away', async ({ page }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);

    // ── SIGNING IN IS AN INTERRUPTION, NOT A STEP ────────────────────────
    //
    // This has been asserted three ways, and the history is the point. It
    // once clicked a Continue on review to reach `/login`; then it asserted
    // the REDIRECT to `/login`, because review always bounced an anonymous
    // visitor there; now there is no sign-in screen at all.
    //
    // A whole navigation for a thing that is not part of buying a ticket,
    // counted by the progress row as a quarter of the journey, and reached by
    // leaving the selection behind. It is a sheet over whichever screen asked
    // for it, so the tickets stay chosen and stay on screen behind it.
    //
    // The redirect that remains sends an anonymous visitor back to the PICKER,
    // which is where the sheet lives — carrying the selection, so one press of
    // Continue raises it.
    await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);
    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]+(\?|$)/);
    await expect(page).toHaveURL(/tickets=/);

    // TWO steps, and the same two whether or not there is a session. The rule
    // that decided every previous version of this assertion is unchanged: the
    // stepper says what the ROUTER does, and the router no longer navigates to
    // sign in.
    const stepper = page.getByRole('navigation', { name: 'Booking progress' });
    await expect(stepper.getByRole('listitem')).toHaveCount(2);
    await expect(stepper).not.toContainText('Sign in');

    await page.getByRole('button', { name: /Continue/i }).first().click();

    // The sheet, over the ticket screen — which is still there underneath.
    const sheet = page.getByRole('dialog').filter({ hasText: 'Sign in to continue' });
    await expect(sheet).toBeVisible();
    // A CSS locator, deliberately, not `getByRole('heading')`: Radix takes the
    // background OUT of the accessibility tree while the dialog is open, which
    // is the dialog doing its job — so the role query correctly finds nothing,
    // and asking that way would assert the opposite of what it looks like.
    // What is being checked here is that the ticket screen was never navigated
    // away from, and that is a DOM fact.
    await expect(page.locator('h1').first()).toHaveText('Choose your tickets');

    // Closing it returns to exactly what was behind, selection intact — the
    // whole reason it is a sheet.
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('output').first()).toHaveText('1');

    // Signed in: no sheet, straight through to review.
    await signedIn(page);
    await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);
    await expect(page).toHaveURL(/\/review/);
    await expect(stepper.getByRole('listitem')).toHaveCount(2);
    await expect(
      page.getByRole('dialog').filter({ hasText: 'Sign in to continue' }),
    ).toHaveCount(0);
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

    // ── WAIT FOR THE RESERVATION ─────────────────────────────────────────
    //
    // Review reserves inventory on mount, and the payment control only has
    // something to pay for once that POST has answered. Waiting on the URL
    // rather than a spinner, because the booking id in the query IS the
    // evidence that the reservation exists. Under a full-suite load that POST
    // is simply slower, which is why this once passed alone and failed in a
    // run.
    //
    // There is no press to make any more: `/pay` was a screen that restated
    // the order and offered a button, and the button is on the summary now.
    await page.waitForURL(/[?&]booking=/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review your booking');

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
    // ── THE PANEL IS THE SAME ONE, IN A SHEET ────────────────────────────
    //
    // It used to be reached by a redirect to `/login`. Signing in is a sheet
    // now, so the panel is opened by pressing Continue without a session — but
    // it is the SAME `AuthPanel` the standalone /sign-in route renders, which
    // is the point: two copies of an auth form is how the two drift, and this
    // one sits in front of a payment.
    await page.goto(`/booking/${eventId}?tickets=${tiers[0]!.id}:1`);
    await page.getByRole('button', { name: /Continue/i }).first().click();
    const sheet = page.getByRole('dialog').filter({ hasText: 'Sign in to continue' });
    await expect(sheet).toBeVisible();

    // The control EXISTS. Never clicked: Google is real now, and a real click
    // leaves the SPA. (`getByRole(..., {name})` is a SUBSTRING match, so a
    // loose /Continue/ inside this sheet would find the Google button too —
    // which is exactly how an earlier version of this test navigated off-site.)
    await expect(sheet.getByRole('button', { name: /Continue with Google/i })).toHaveCount(1);
    // Apple was removed outright — no backend, no planned one.
    await expect(sheet.getByRole('button', { name: /Continue with Apple/i })).toHaveCount(0);

    // Phone is the seam still stating the truth: the tab is real, the field
    // takes a country code and a number, and the send fails loudly rather than
    // pretending a code went out. A control that silently does nothing, or
    // appears to succeed, is the worst possible thing to fake on a checkout.
    const urlBefore = page.url();
    await sheet.getByRole('tab', { name: 'Phone' }).click();
    await expect(sheet.getByLabel('Country calling code')).toHaveValue('+91');
    await sheet.getByLabel('Phone number').fill('9876543210');
    await sheet.getByRole('button', { name: 'Send code' }).click();
    await expect(sheet.getByRole('status')).toContainText(
      /Phone sign-in isn't connected yet/i,
    );
    // A sheet, not a navigation: the ticket screen is still underneath.
    expect(page.url()).toBe(urlBefore);

    // Email + password is the one method with a backend behind it, and it works.
    await sheet.getByRole('tab', { name: 'Email' }).click();
    await expect(sheet.getByLabel('Email')).toBeVisible();
  });

  test('the summary card is present and consistent on every step', async ({ page }) => {
    await page.goto('/events');
    const { eventId, tiers } = await bookableEvent(page);
    await signedIn(page);
    const summary = page.getByRole('complementary', { name: 'Order summary' });

    // The funnel is TWO screens now, so "every step" is the picker and review.
    // The card is mounted by the route group's layout, which is what makes two
    // routes read as one journey — the total must not change across the hop.
    await page.goto(`/booking/${eventId}?tickets=${tiers[0]!.id}:1`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose your tickets');
    await expect(summary).toBeVisible();
    const total = (await summary.getByText(/^₹/).last().textContent())?.trim();

    await page.getByRole('button', { name: /Continue/i }).first().click();
    await expect(page).toHaveURL(/\/review/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review your booking');
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

      // Two screens and one sheet — the sheet included BECAUSE it is a focus
      // trap over a live page, which is where dialog accessibility actually
      // goes wrong: an unlabelled dialog, or a background that is still
      // reachable by tab.
      await page.goto(`/booking/${eventId}?tickets=${tiers[0]!.id}:1`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose your tickets');
      await axeClean(page, 'booking step 1 (tickets)');

      await page.getByRole('button', { name: /Continue/i }).first().click();
      await expect(page.getByRole('dialog').filter({ hasText: 'Sign in to continue' })).toBeVisible();
      await axeClean(page, 'the sign-in sheet');

      await signedIn(page);
      await page.goto(`/booking/${eventId}/review?tickets=${tiers[0]!.id}:1`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review your booking');
      await axeClean(page, 'booking step 2 (review and pay)');
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

    // Without a session, Continue raises the sheet rather than navigating —
    // so the URL must NOT have moved, and the selection must still be in it.
    const sheet = page.getByRole('dialog').filter({ hasText: 'Sign in to continue' });
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]+(\?|$)/);
    await expect(page).toHaveURL(/tickets=/);
  });
});
