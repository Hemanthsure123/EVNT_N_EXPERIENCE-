import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Signing in from the header, and the standalone `/sign-in` page.
 *
 * The funnel's own sign-in step is covered in `booking.spec.ts`; these are the
 * surfaces that exist for someone who is NOT mid-purchase. Both render the same
 * `AuthPanel`, so a change that breaks one breaks both here.
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

/** Register an account through the fixture and store its tokens. */
async function register(page: Page, { staff = false } = {}) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}${staff ? '+staff' : ''}@example.com`;
  const password = 'password123';
  const tokens = await page.evaluate(
    async ([api, address, secret]) => {
      const response = await fetch(`${api}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, password: secret, full_name: 'Asha Rao' }),
      });
      return (await response.json()) as { tokens: { access: string; refresh: string } };
    },
    [API, email, password] as const,
  );
  return { email, password, tokens: tokens.tokens };
}

async function signedIn(page: Page, options?: { staff?: boolean }) {
  const account = await register(page, options);
  await page.evaluate(
    ([access, refresh]) => {
      localStorage.setItem('ee-access', access);
      localStorage.setItem('ee-refresh', refresh);
    },
    [account.tokens.access, account.tokens.refresh] as const,
  );
  return account;
}

test.describe('signing in from the header', () => {
  test('offers Sign in to a visitor, and returns them to where they were', async ({ page }) => {
    await page.goto('/about');

    const signIn = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
    await expect(signIn).toBeVisible();
    // The destination is carried, so signing in is never a detour that loses
    // the page you were reading.
    await expect(signIn).toHaveAttribute('href', /next=%2Fabout/);

    await signIn.click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fabout/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back');

    const account = await register(page);
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();

    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  });

  test('never follows an off-site next, however it is dressed up', async ({ page }) => {
    // A real page first — `localStorage` is inaccessible on about:blank.
    await page.goto('/');
    const account = await signedIn(page);
    expect(account.email).toContain('@');

    for (const hostile of ['https://evil.example/login', '//evil.example', '/\\evil.example']) {
      await page.goto(`/sign-in?next=${encodeURIComponent(hostile)}`);
      // Already signed in, so the page redirects immediately — to the fallback,
      // never to the attacker's URL.
      // Relative: resolves against baseURL, so this asserts the redirect target
      // rather than the dev server's port.
      await expect(page).toHaveURL('/');
    }
  });

  test('shows an account menu once signed in, with the console only for operators', async ({
    page,
  }) => {
    await page.goto('/');
    await signedIn(page);
    await page.reload();

    await page.getByRole('button', { name: 'Account menu' }).click();
    // ── ASSERT A LINK THE MENU ACTUALLY HAS ──────────────────────────────
    //
    // This looked for "Browse events", which the account menu does not
    // contain — the match was the SITE FOOTER's link, page-wide and visible
    // whether or not the menu had opened. It passed for the wrong reason
    // until a second "Browse events" appeared on the page, and then failed as
    // a strict-mode violation rather than as the assertion it was pretending
    // to make.
    //
    // The menu's bookings link, by the label it ACTUALLY carries. It was
    // "My tickets"; the menu was redesigned and the row became "View all
    // bookings", and this assertion was never moved with it — so the test has
    // been failing on stale copy rather than on behaviour.
    await expect(page.getByRole('link', { name: 'View all bookings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Operator console' })).toHaveCount(0);
    await expect(page.getByText('Platform operator')).toHaveCount(0);

    // A staff account gets the one extra door — nothing else linked to /admin
    // before this existed.
    await signedIn(page, { staff: true });
    await page.reload();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('link', { name: 'Operator console' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });

  test('signs out and puts the Sign in control back', async ({ page }) => {
    await page.goto('/');
    await signedIn(page);
    await page.reload();

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ee-access'))).toBeNull();
  });
});

test.describe('the sign-in page', () => {
  test('offers Google for real, and says phone is not connected yet', async ({ page }) => {
    await page.goto('/sign-in');

    // Google is real now (`apps/accounts`'s GoogleSignInService) — the button
    // renders once the backend confirms it, and is never clicked here: a real
    // click leaves the SPA for Google's own address bar.
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();

    // Apple was removed outright — no backend, no planned one, and the glyph
    // went with it (see `components/auth/provider-marks.tsx`). Phone is the
    // one seam still stating the truth instead of pretending.
    await expect(page.getByRole('button', { name: /Continue with Apple/i })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Phone' }).click();
    await page.getByLabel('Phone number').fill('+919876543210');
    await page.getByRole('button', { name: 'Send code' }).click();
    // Scoped to main — the header carries its own sr-only status region.
    await expect(page.getByRole('main').getByRole('status')).toContainText(
      /Phone sign-in isn't connected yet/i,
    );
  });

  test('creates an account, and reports a wrong password rather than swallowing it', async ({
    page,
  }) => {
    await page.goto('/sign-in');

    const account = await register(page);
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    // Scoped to main — Next's own route announcer is also `role="alert"`.
    await expect(page.getByRole('main').getByRole('alert')).toContainText(/incorrect/i);

    // The tab row really switches the form, and sign-up asks for the one extra
    // field the backend needs.
    await page.getByRole('tab', { name: 'Create account' }).click();
    await expect(page.getByLabel('Full name')).toBeVisible();
    await page.getByLabel('Full name').fill('Asha Rao');
    await page.getByLabel('Email').fill(`e2e-new-${Date.now()}@example.com`);
    await page.getByLabel('Password', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Create account', exact: true }).last().click();

    // Registering issues NO session — verifying is what signs someone in (see
    // CLAUDE.md's "Email verification" section), so the account isn't usable
    // yet and there is no account menu to check for.
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  });

  test('is not offered to search engines', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('passes axe', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter(seriousOrWorse), 'sign-in a11y violations').toEqual([]);
  });
});
