import { expect, test } from '@playwright/test';

test('dimension Canvas2D demo renders four types and exports deterministic SVG', async ({ page }) => {
  await page.goto('/dimension-kernel-demo.html');
  await page.waitForFunction(() => (
    (window as any).__dimensionDemo?.ready === true
    || typeof (window as any).__dimensionDemoError === 'string'
  ));
  const initializationError = await page.evaluate(
    () => (window as any).__dimensionDemoError ?? null,
  );
  expect(initializationError).toBeNull();

  const ids = await page.evaluate(() => (
    (window as any).__dimensionDemo.getLayouts().map((layout: any) => layout.dimensionId)
  ));
  expect(ids).toEqual([
    'demo-linear',
    'demo-projected',
    'demo-angular',
    'demo-radial',
  ]);

  const size = await page.evaluate(() => (window as any).__dimensionDemo.getCanvasSize());
  expect(size.width).toBe(Math.round(size.cssWidth * size.dpr));
  expect(size.height).toBe(Math.round(size.cssHeight * size.dpr));

  await page.evaluate(() => (window as any).__dimensionDemo.setState('demo-linear', 'selected'));
  await page.waitForFunction(() => (
    (window as any).__dimensionDemo
      .getLayouts()
      .find((layout: any) => layout.dimensionId === 'demo-linear')
      ?.primitives.some((primitive: any) => primitive.styleRole === 'selected')
  ));

  const exported = await page.evaluate(async () => ({
    svg: (window as any).__dimensionDemo.exportSvg(),
    pngSize: await (window as any).__dimensionDemo.capturePngSize(),
  }));
  expect(exported.svg).toContain('<path');
  expect(exported.svg).toContain('<line');
  expect(exported.svg).not.toContain('<text');
  expect(exported.pngSize).toBeGreaterThan(0);
});
