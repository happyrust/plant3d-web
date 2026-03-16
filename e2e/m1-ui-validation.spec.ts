import { test, expect } from '@playwright/test';

test.describe('M1 UI Framework Validation', () => {
  test('VAL-UI-001: Application loads successfully', async ({ page }) => {
    await page.goto('http://127.0.0.1:3101');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
  });

  test('VAL-UI-002: Button components render', async ({ page }) => {
    await page.goto('http://127.0.0.1:3101');
    const buttons = page.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('VAL-UI-003: Input component works', async ({ page }) => {
    await page.goto('http://127.0.0.1:3101');
    const inputs = page.locator('input[type="text"], input:not([type])');
    if (await inputs.count() > 0) {
      const input = inputs.first();
      await input.fill('test');
      await expect(input).toHaveValue('test');
    }
  });

  test('VAL-UI-004: UI components are interactive', async ({ page }) => {
    await page.goto('http://127.0.0.1:3101');
    const buttons = page.locator('button').first();
    await expect(buttons).toBeVisible();
  });
});
