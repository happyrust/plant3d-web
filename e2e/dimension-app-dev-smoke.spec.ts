import { expect, test } from '@playwright/test';

test('cutover default mounts the dimension system and starts a typed creation session', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (
    (window as any).__viewerContext?.dimensionSystem?.value
    || typeof (window as any).__dimensionSystemError === 'string'
  ));
  expect(await page.evaluate(
    () => (window as any).__dimensionSystemError ?? null,
  )).toBeNull();

  await expect(page.locator('.dimension-viewport-overlay')).toBeVisible();
  await page.getByText('尺寸标注', { exact: true }).click();
  const linearButton = page.getByTestId('dimension.create.linear');
  await expect(linearButton).toBeVisible();
  await linearButton.click();

  await expect.poll(() => page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.pointer.hasActiveSession
  ))).toBe(true);

  await page.getByTestId('dimension.cancel').click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__viewerContext.dimensionSystem.value.pointer.hasActiveSession
  ))).toBe(false);
});
