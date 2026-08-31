import { test, expect } from '@playwright/test';
import path from 'path';

const scratchDir = 'C:\\Users\\NXTWAVE\\.gemini\\antigravity\\brain\\f7c93be5-fca5-4cab-bf5b-0c716fdc09ee\\scratch';

test.use({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
});

test('verify District mobile event widget deck interaction', async ({ page }) => {
  console.log('Navigating to live production site on mobile viewport...');
  await page.goto('https://fastride.xyz', { waitUntil: 'networkidle' });

  // 1. Locate an event card and click it
  const cardTitleBtn = page.locator('h3 button').first();
  await cardTitleBtn.click();
  await page.waitForTimeout(1000);

  // 2. Take screenshot of the opened District Event Deck Widget
  const screenshotWidget = path.join(scratchDir, 'district_deck_widget_open.png');
  await page.screenshot({ path: screenshotWidget });
  console.log(`Saved open widget screenshot: ${screenshotWidget}`);

  // 3. Verify NO "Peek" or "Full Screen" text buttons exist
  const peekBtn = page.getByText('Peek', { exact: true });
  const fullScreenBtn = page.getByText('Full Screen', { exact: true });
  await expect(peekBtn).toHaveCount(0);
  await expect(fullScreenBtn).toHaveCount(0);

  // 4. Perform horizontal swipe right/left simulation by clicking next peeking card indicator
  const nextIndicator = page.locator('button[aria-label="Next event"]');
  if (await nextIndicator.isVisible()) {
    await nextIndicator.click();
    await page.waitForTimeout(800);
    const screenshotSwiped = path.join(scratchDir, 'district_deck_swiped_next.png');
    await page.screenshot({ path: screenshotSwiped });
    console.log(`Saved swiped next screenshot: ${screenshotSwiped}`);
  }

  // 5. Test back button closing the deck
  const backBtn = page.locator('button[aria-label="Back to discovery"]');
  await expect(backBtn).toBeVisible();
  await backBtn.click();
  await page.waitForTimeout(500);

  const screenshotClosed = path.join(scratchDir, 'district_deck_closed_feed.png');
  await page.screenshot({ path: screenshotClosed });
  console.log(`Saved closed deck feed screenshot: ${screenshotClosed}`);
});
