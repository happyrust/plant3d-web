import { expect, test, type Page } from '@playwright/test';

/**
 * legacy（`:3100` + parquet）真机用例。
 *
 * 2026-09-18：原第 2 条「BRAN 24381_145018 装 sesno 791 / 898 做版本对比」已删——它按 A1（`ec187960`）之前的
 * 事件形状（`artifactSesno / manifestUrl / generatedAt`，没有 `version / entries`）派发 `plant3d:model-unit-version-compare`，
 * ViewerPanel 现在读的是 `detail.before.entries`，这条早已跑不通；且它期待的 791 / 898 来自另一份 ams7997 库副本
 * （现在这份只有 332 个会话）。版本对比的真机回归见 `e2e/model-version-compare-gen-model-v1.spec.ts`
 * （plan `docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md` Q21）。
 * 剩下这一条（MBD 行数 = 0 时尺寸场景绘制器仍挂着）与版本无关，随 legacy 整体退役再处理。
 */

const BACKEND_ORIGIN = (process.env.PLANT3D_API_BASE || 'http://127.0.0.1:3100').replace(/\/$/, '');
const BACKEND_QUERY = `backend=${encodeURIComponent(BACKEND_ORIGIN)}`;
const PROJECT = 'AvevaMarineSample';
const DBNUM = 7997;

test.setTimeout(120_000);

async function waitForDimensionSystem(page: Page): Promise<void> {
  await page.getByText('三维查看器', { exact: true }).click();
  await page.waitForFunction(() => (
    (window as any).__viewerContext?.dimensionSystem?.value
    || typeof (window as any).__dimensionSystemError === 'string'
  ), null, { timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__dimensionSystemError ?? null)).toBeNull();
}

test('AMS 7997 empty parquet MBD source keeps the Three scene painter mounted safely', async ({ page }) => {
  await page.goto(
    `/?${BACKEND_QUERY}&output_project=${PROJECT}&dimension_demo=1&show_dbnum=${DBNUM}`,
    { waitUntil: 'domcontentloaded' },
  );
  await waitForDimensionSystem(page);

  const state = await page.evaluate(() => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const records = system.externalRegistry.snapshot.records
      .filter((record: any) => record.source === 'mbd');
    system.notifyViewerChanged();
    const group = (window as any).__dtxViewer.scene.getObjectByName('dimension-scene-overlay');
    return {
      recordCount: records.length,
      layoutCount: system.viewport.getLayouts().length,
      groupVisible: Boolean(group?.visible),
      childNames: group?.children?.map((child: any) => child.name) ?? [],
    };
  });

  expect(state.recordCount).toBe(0);
  expect(state.layoutCount).toBe(0);
  expect(state.groupVisible).toBe(true);
  expect(state.childNames).toEqual(expect.arrayContaining([
    'dimension-scene-lines',
    'dimension-scene-arrows',
  ]));

  const mbdRows = await page.evaluate(async (dbnum) => {
    const mod = await import('/src/composables/useDbnoInstancesParquetLoader.ts');
    const loaded = await mod.useDbnoInstancesParquetLoader().queryMbdDimensionsByDbno(dbnum, {
      forceRefresh: true,
    });
    return loaded.dimensions.length;
  }, DBNUM);
  expect(mbdRows).toBe(0);
});
