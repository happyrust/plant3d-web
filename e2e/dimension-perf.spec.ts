import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1920, height: 1080 } });
test.skip(
  process.env.DIMENSION_PERF_GATE !== '1',
  'Run explicitly through npm run perf:dimensions:browser',
);

/**
 * 2k 可见尺寸的浏览器管线预算（W5-5）。
 *
 * 两条断言各管一件事，别混：
 *
 * 1. `hitP95Ms ≤ 2` —— 与 ADR 0040 的「pointer hit-test p95」同口径。`run()`
 *    的命中循环是纯 CPU（`src/debug/dimensionPerf.ts:245-255`），可以直判。
 * 2. `settle(20)` 的 `layoutP95Ms` / `paintP95Ms` —— 这才是 ADR 0040 说的
 *    「layout → collision → paint」那一半。`run()` 的 `updateP95Ms` **不能**
 *    用来判它：那 60 帧循环只测 `renderer.render`（`:223-235`），不含布局、
 *    不含碰撞、不含 `scenePainter.paint`。旧版拿它对着 16 ms 判，测的不是
 *    ADR 那个数（README「已知口径问题」第 7 条）。
 *
 * layout 的 16 ms 预算在内核基准里已经钉住（`npm run perf:dimensions:kernel`，
 * ADR 口径 DPR 2、实测 200 次，2026-10-30 实测 p95 = 3.746 ms）。浏览器这条
 * 之所以不直接对 16 ms 判，是因为它是 **dev 构建 + DPR 1 + headless GPU**，
 * 档位与 ADR 参考环境不同，拿 16 ms 硬卡会在档位差异上误报。这里判的是
 * **不退化**：相对本机 dev 档实测基线（三次中位数）允许 1.2 倍。
 *
 * 基线来源：`docs/verification/mbd-perf-baseline-2026-10-29/README.md` 的
 * `settle(20)` 行（`layoutP95Ms` 26.20 / `paintP95Ms` 78.60，2026-10-29 三次
 * 中位数，Ryzen 9 7950X / RX590 GME）。换机器时先跑一次
 * `DIMENSION_PERF_BASELINE_WRITE=1` 把新基线打出来，再更新下面的常量——
 * **不得为了放行而调大**，调大等于承认退化。
 */
const SETTLE_PASSES = 20;
const BASELINE_LAYOUT_P95_MS = 26.2;
const BASELINE_PAINT_P95_MS = 78.6;
const REGRESSION_FACTOR = 1.2;

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
  expect(result.external).toBe(500);
  expect(result.samples).toBe(60);
  // ADR 0040's hit-test budget, same accounting as the kernel benchmark.
  expect(result.hitP95Ms).toBeLessThanOrEqual(2);

  const settle = await page.evaluate(
    (passes) => (window as any).__dimensionPerf.settle(passes),
    SETTLE_PASSES,
  );
  console.log('dimension-perf settle', settle);
  expect(settle.passes).toBe(SETTLE_PASSES);

  if (process.env.DIMENSION_PERF_BASELINE_WRITE === '1') {
    // Not an assertion: prints the numbers to paste into the constants above
    // after a deliberate, machine-changing re-baseline.
    console.log(
      'dimension-perf new baseline',
      { layoutP95Ms: settle.layoutP95Ms, paintP95Ms: settle.paintP95Ms },
    );
    return;
  }

  // The layout -> paint half of ADR 0040, judged as "does not regress" against
  // the dev-tier baseline rather than against a budget measured elsewhere.
  expect(settle.layoutP95Ms).toBeLessThanOrEqual(
    BASELINE_LAYOUT_P95_MS * REGRESSION_FACTOR,
  );
  expect(settle.paintP95Ms).toBeLessThanOrEqual(
    BASELINE_PAINT_P95_MS * REGRESSION_FACTOR,
  );
});
