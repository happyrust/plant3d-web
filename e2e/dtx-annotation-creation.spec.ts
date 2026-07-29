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

async function setCloudTargets(page: Page, refnos: string[]) {
  await page.evaluate((targets) => {
    const store = (window as any).__viewerToolStore;
    if (!store) {
      throw new Error('viewer tool store is not ready');
    }
    store.setCloudTargetRefnos(targets);
  }, refnos);
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
    const memberRefnos = [point.objectId, 'MISSING/TARGET'];

    await setCloudTargets(page, memberRefnos);
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
    expect(state.firstCloud?.refnos).toEqual(memberRefnos);
    expect(state.firstCloud?.objectIds).toEqual(memberRefnos);
    expect(state.firstCloud?.bindings).toEqual([
      expect.objectContaining({ refno: point.objectId, role: 'anchor' }),
      expect.objectContaining({ refno: point.objectId, role: 'member' }),
      expect.objectContaining({ refno: 'MISSING/TARGET', role: 'member' }),
    ]);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForDtxReady(page);
    await waitForToolStoreReady(page);
    const restored = await readAnnotationState(page);
    expect(restored.firstCloud?.refnos).toEqual(memberRefnos);
    expect(restored.firstCloud?.bindings).toHaveLength(3);
  });

  test('云线批注创建后应自动上传 PNG 并保存截图信息', async ({ page }) => {
    let uploadBody = '';
    await page.route('**/api/review/attachments', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      uploadBody = route.request().postData() ?? '';
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          attachment: {
            id: 'att-auto-cloud',
            url: '/uploads/att-auto-cloud.png',
            name: 'att-auto-cloud.png',
            mimeType: 'image/png',
            size: 1024,
            uploadedAt: Date.now(),
          },
        }),
      });
    });

    await page.evaluate(async () => {
      const modulePath = '/src/composables/useReviewStore.ts';
      const { useReviewStore } = await import(/* @vite-ignore */ modulePath);
      useReviewStore().currentTask.value = {
        id: 'task-auto-cloud',
        title: '自动截图测试',
        description: '',
        modelName: 'AvevaMarineSample',
        status: 'in_review',
        priority: 'medium',
        requesterId: 'tester',
        requesterName: 'Tester',
        reviewerId: 'reviewer',
        reviewerName: 'Reviewer',
        components: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });

    const point = await findPickablePoint(page);
    await setCloudTargets(page, [point.objectId]);
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
        firstCloud: {
          screenshot: {
            attachmentId: 'att-auto-cloud',
            url: '/uploads/att-auto-cloud.png',
            mimeType: 'image/png',
          },
        },
      });
    expect(uploadBody).toContain('name="taskId"');
    expect(uploadBody).toContain('task-auto-cloud');
    expect(uploadBody).toContain('name="sourceAnnotationId"');
    expect(uploadBody).toContain('name="type"');
    expect(uploadBody).toContain('annotation_screenshot');
    expect(uploadBody).toContain('Content-Type: image/png');
  });
});
