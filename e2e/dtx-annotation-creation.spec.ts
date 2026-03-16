import { expect, test, type Page } from '@playwright/test';

const DEMO_OBJECTS = 50;
const DEMO_URL = `/?output_project=AvevaMarineSample&dtx_demo=primitives&dtx_demo_count=${DEMO_OBJECTS}`;

async function waitForDtxReady(page: Page) {
  await page.waitForFunction(
    () => {
      const v = (window as any).__xeokitViewer;
      const layer = v && v.__dtxLayer;
      if (!layer || typeof layer.getStats !== 'function') return false;
      const stats = layer.getStats();
      return !!stats && stats.compiled === true && Number(stats.totalObjects) > 0;
    },
    null,
    { timeout: 60_000 },
  );
}

async function waitForToolStoreReady(page: Page) {
  await page.waitForFunction(
    () => typeof (window as any).__viewerToolStore?.clearAll === 'function',
    null,
    { timeout: 10_000 },
  );
}

async function resetToolStore(page: Page) {
  await page.evaluate(() => {
    const store = (window as any).__viewerToolStore;
    if (!store) {
      throw new Error('viewer tool store is not ready');
    }
    store.clearAll();
  });
}

async function setToolMode(
  page: Page,
  mode: 'annotation' | 'annotation_rect' | 'annotation_cloud',
) {
  await page.evaluate((nextMode) => {
    const store = (window as any).__viewerToolStore;
    if (!store) {
      throw new Error('viewer tool store is not ready');
    }
    store.setToolMode(nextMode);
  }, mode);
}

async function readAnnotationState(page: Page) {
  return page.evaluate(() => {
    const store = (window as any).__viewerToolStore;
    if (!store) {
      throw new Error('viewer tool store is not ready');
    }
    return {
      textCount: store.annotations.value.length,
      rectCount: store.rectAnnotations.value.length,
      cloudCount: store.cloudAnnotations.value.length,
      obbCount: store.obbAnnotations.value.length,
      firstText: store.annotations.value[0] ?? null,
      firstRect: store.rectAnnotations.value[0] ?? null,
      firstCloud: store.cloudAnnotations.value[0] ?? null,
      pendingRectEditId: store.pendingRectAnnotationEditId.value,
    };
  });
}

async function findPickablePoint(page: Page) {
  const point = await page.evaluate(() => {
    const v = (window as any).__xeokitViewer;
    const sel = v?.__dtxSelection;
    const canvas = document.querySelector('canvas.viewer') as HTMLCanvasElement | null;
    if (!sel || !canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const ratios = [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65];
    for (const ry of ratios) {
      for (const rx of ratios) {
        const x = rect.width * rx;
        const y = rect.height * ry;
        const hit = sel.pick?.({ x, y });
        if (!hit?.objectId) continue;
        return {
          x: rect.left + x,
          y: rect.top + y,
          objectId: hit.objectId,
        };
      }
    }
    return null;
  });

  expect(point).not.toBeNull();
  return point as { x: number; y: number; objectId: string };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test.describe('DTX 批注真实创建', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    await waitForDtxReady(page);
    await waitForToolStoreReady(page);
    await resetToolStore(page);
  });

  test('文字批注应能通过 mesh 点选创建', async ({ page }) => {
    const point = await findPickablePoint(page);

    await setToolMode(page, 'annotation');
    await page.mouse.click(point.x, point.y);

    await expect
      .poll(() => readAnnotationState(page), { timeout: 10_000 })
      .toMatchObject({
        textCount: 1,
        firstText: {
          entityId: point.objectId,
          refno: point.objectId,
        },
      });
  });

  test('矩形批注应能通过单击对象创建矩形批注', async ({ page }) => {
    const point = await findPickablePoint(page);

    await setToolMode(page, 'annotation_rect');
    await page.mouse.click(point.x, point.y);

    await expect
      .poll(() => readAnnotationState(page), { timeout: 10_000 })
      .toMatchObject({
        rectCount: 1,
      });

    const state = await readAnnotationState(page);
    expect(state.firstRect?.refnos).toEqual([point.objectId]);
    expect(state.firstRect?.anchorWorldPos).toEqual(state.firstRect?.obb.center);
    expect(state.firstRect?.leaderEndWorldPos).toHaveLength(3);
  });

  test('云线批注应能通过屏幕框选创建', async ({ page }) => {
    const point = await findPickablePoint(page);

    await setToolMode(page, 'annotation_cloud');
    await page.mouse.click(point.x, point.y);
    await drag(
      page,
      { x: point.x - 70, y: point.y - 70 },
      { x: point.x + 70, y: point.y + 70 },
    );

    await expect
      .poll(() => readAnnotationState(page), { timeout: 10_000 })
      .toMatchObject({
        cloudCount: 1,
      });

    const state = await readAnnotationState(page);
    expect(state.firstCloud?.anchorRefno).toBe(point.objectId);
    expect(state.firstCloud?.refnos.length ?? 0).toBeGreaterThan(0);
  });
});
