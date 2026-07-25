import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const seriousOrWorse = (v: { impact?: string | null }) =>
  v.impact === 'critical' || v.impact === 'serious';

test('home links through to the style guide', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /open the living style guide/i }).click();
  await expect(page).toHaveURL(/style-guide/);
  await expect(page.getByRole('heading', { name: 'Living style guide' })).toBeVisible();
});

test('style guide renders and passes axe in light and dark', async ({ page }) => {
  await page.goto('/style-guide');
  await expect(page.getByRole('heading', { name: 'Living style guide' })).toBeVisible();

  // Light theme
  const light = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(light.violations.filter(seriousOrWorse)).toEqual([]);

  // Toggle to dark via the design tokens, then re-scan
  await page.getByRole('button', { name: /switch to dark theme/i }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);

  const dark = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(dark.violations.filter(seriousOrWorse)).toEqual([]);
});
