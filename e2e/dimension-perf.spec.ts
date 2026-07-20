import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1920, height: 1080 } });
test.skip(
  process.env.DIMENSION_PERF_GATE !== '1',
  'Run explicitly through npm run perf:dimensions:browser',
);

test('2k visible dimension browser pipeline stays within ADR-0040 budgets', async ({ page }) => {
  await page.goto('/dimension-perf.html');
  await page.waitForFunction(() => (
    (window as any).__dimensionPerf?.ready === true
    || typeof (window as any).__dimensionPerfError === 'string'
  ));
  expect(await page.evaluate(
    () => (window as any).__dimensionPerfError ?? null,
  )).toBeNull();

  const result = await page.evaluate(
    () => (window as any).__dimensionPerf.run(),
  );
  console.log('dimension-perf', result);
  expect(result.loaded).toBe(10_000);
  expect(result.visible).toBe(2_000);
  expect(result.samples).toBe(60);
  expect(result.updateP95Ms).toBeLessThanOrEqual(16);
  expect(result.hitP95Ms).toBeLessThanOrEqual(2);
});
