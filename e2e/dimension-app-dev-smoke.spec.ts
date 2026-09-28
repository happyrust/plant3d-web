import { expect, test } from '@playwright/test';

test('dimension_demo mounts the dimension system and starts a typed creation session', async ({ page }) => {
  await page.goto('/?dimension_demo=1');
  await page.waitForFunction(() => (
    (window as any).__viewerContext?.dimensionSystem?.value
    || typeof (window as any).__dimensionSystemError === 'string'
  ));
  expect(await page.evaluate(
    () => (window as any).__dimensionSystemError ?? null,
  )).toBeNull();

  await expect.poll(() => page.evaluate(() => {
    const scene = (window as any).__dtxViewer?.scene;
    const group = scene?.getObjectByName?.('dimension-scene-overlay');
    return Boolean(group?.visible);
  })).toBe(true);
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
