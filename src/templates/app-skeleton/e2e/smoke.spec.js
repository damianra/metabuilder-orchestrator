import { test, expect } from '@playwright/test';

test('la app carga sin errores de consola', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  expect(errors).toEqual([]);
});
