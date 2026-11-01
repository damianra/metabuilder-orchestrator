import { test, expect } from '@playwright/test';

test('home renders correctly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome')).toBeVisible({ timeout: 30_000 });
});
