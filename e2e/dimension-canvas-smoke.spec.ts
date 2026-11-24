import { expect, test } from '@playwright/test';

test('dimension WebGL scene demo renders four types plus MBD and exports SVG', async ({ page }) => {
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
    'demo-radial-zero',
    'demo-mbd-explicit',
    'grid:plane',
    'grid:cyl',
  ]);
  const gridLabels = await page.evaluate(() => (
    (window as any).__dimensionDemo.getLayouts()
      .filter((layout: any) => String(layout.dimensionId).startsWith('grid:'))
      .map((layout: any) => [layout.dimensionId, layout.derived.formattedLabel])
  ));
  expect(gridLabels).toEqual([
    ['grid:plane', '1500.00'],
    ['grid:cyl', 'R300.00'],
  ]);
  const radialFacts = await page.evaluate(() => (
    (window as any).__dimensionDemo.getLayouts()
      .filter((layout: any) => String(layout.dimensionId).startsWith('demo-radial'))
      .map((layout: any) => ({
        id: layout.dimensionId,
        label: layout.derived.formattedLabel,
        primitives: layout.primitives.length,
        errors: layout.derived.validationErrors ?? [],
      }))
  ));
  expect(radialFacts[0]).toMatchObject({
    id: 'demo-radial',
    label: 'STALE ⌀1400.00',
    errors: [],
  });
  expect(radialFacts[0].primitives).toBeGreaterThan(0);
  expect(radialFacts[1]).toEqual({
    id: 'demo-radial-zero',
    label: '',
    primitives: 0,
    errors: ['DEGENERATE_RADIAL_RADIUS'],
  });
  // 画家 group 固定四个 mesh：stroke cores / stroke edges / filled arrows / filled tag bodies
  // （scenePainter.ts:956-970，getStats 返回 group.children.length）。
  expect(await page.evaluate(
    () => (window as any).__dimensionDemo.getSceneObjectCount(),
  )).toBe(4);

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
  expect(exported.svg).toContain('data-dimension-id="grid:plane"');
  expect(exported.svg).toContain('data-dimension-id="grid:cyl"');
  expect(exported.pngSize).toBeGreaterThan(0);

  const inches = await page.evaluate(() => (window as any).__dimensionDemo.setLengthUnit('in'));
  expect(inches).toBe('78.74');
  const millimetres = await page.evaluate(() => (window as any).__dimensionDemo.setLengthUnit('mm'));
  expect(millimetres).toBe('2000.00');
});
