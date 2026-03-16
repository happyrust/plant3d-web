import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const DEMO_URL = '/?project_id=AvevaMarineSample&dtx_demo=primitives&dtx_demo_count=50';

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

async function resetToolStore(page: Page) {
  await page.evaluate(async () => {
    const storeMod = await import('/src/composables/useToolStore.ts');
    const store = storeMod.useToolStore();
    store.clearAll();
  });
}

async function setToolMode(
  page: Page,
  mode: 'annotation' | 'annotation_cloud' | 'annotation_rect' | 'annotation_obb',
) {
  await page.evaluate(async (nextMode) => {
    const storeMod = await import('/src/composables/useToolStore.ts');
    const store = storeMod.useToolStore();
    store.setToolMode(nextMode);
  }, mode);
}

async function findPickablePoint(page: Page) {
  const point = await page.evaluate(() => {
    const v = (window as any).__xeokitViewer;
    const sel = v?.__dtxSelection;
    const canvas = document.querySelector('canvas.viewer') as HTMLCanvasElement | null;
    if (!sel || !canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const ratios = [0.5, 0.45, 0.55, 0.4, 0.6];
    for (const ry of ratios) {
      for (const rx of ratios) {
        const x = rect.width * rx;
        const y = rect.height * ry;
        const hit = sel.pick?.({ x, y });
        if (!hit?.objectId) continue;
        return {
          x: rect.left + x,
          y: rect.top + y,
        };
      }
    }
    return null;
  });

  expect(point).not.toBeNull();
  return point as { x: number; y: number };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function saveViewerShot(page: Page, name: string) {
  const outDir = path.resolve(process.cwd(), 'e2e/screenshots/annotation-visual');
  await fs.mkdir(outDir, { recursive: true });
  const target = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  test.info().attach(name, {
    path: target,
    contentType: 'image/png',
  });
}

async function readLabelCardStyle(label: ReturnType<Page['locator']>) {
  return label.evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      borderTopColor: style.borderTopColor,
      paddingTop: style.paddingTop,
    };
  });
}

async function readTextAnnotationStore(page: Page) {
  return page.evaluate(async () => {
    const storeMod = await import('/src/composables/useToolStore.ts');
    const store = storeMod.useToolStore();
    const first = store.annotations.value[0] ?? null;
    return {
      count: store.annotations.value.length,
      first: first
        ? {
          worldPos: first.worldPos,
          labelWorldPos: first.labelWorldPos ?? null,
          collapsed: first.collapsed ?? false,
          title: first.title,
          description: first.description,
        }
        : null,
    };
  });
}

async function readCloudAnnotationStore(page: Page) {
  return page.evaluate(async () => {
    const storeMod = await import('/src/composables/useToolStore.ts');
    const store = storeMod.useToolStore();
    const first = store.cloudAnnotations.value[0] ?? null;
    return {
      count: store.cloudAnnotations.value.length,
      first: first
        ? {
          anchorWorldPos: first.anchorWorldPos,
          anchorRefno: first.anchorRefno ?? null,
          title: first.title,
          description: first.description,
          leaderEndWorldPos: first.leaderEndWorldPos ?? null,
        }
        : null,
    };
  });
}

async function readRectAnnotationStore(page: Page) {
  return page.evaluate(async () => {
    const storeMod = await import('/src/composables/useToolStore.ts');
    const store = storeMod.useToolStore();
    const first = store.rectAnnotations.value[0] ?? null;
    return {
      count: store.rectAnnotations.value.length,
      first: first
        ? {
          title: first.title,
          description: first.description,
          leaderEndWorldPos: first.leaderEndWorldPos ?? null,
        }
        : null,
    };
  });
}

async function readObbAnnotationStore(page: Page) {
  return page.evaluate(async () => {
    const storeMod = await import('/src/composables/useToolStore.ts');
    const store = storeMod.useToolStore();
    const first = store.obbAnnotations.value[0] ?? null;
    return {
      count: store.obbAnnotations.value.length,
      first: first
        ? {
          title: first.title,
          description: first.description,
          labelWorldPos: first.labelWorldPos ?? null,
        }
        : null,
    };
  });
}

test.describe('DTX 批注视觉截图', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    await waitForDtxReady(page);
    await resetToolStore(page);
  });

  test('应能自动创建云线、矩形与 OBB 批注并输出截图', async ({ page }) => {
    const point = await findPickablePoint(page);

    await setToolMode(page, 'annotation_cloud');
    await page.mouse.click(point.x, point.y);
    await drag(
      page,
      { x: point.x - 70, y: point.y - 70 },
      { x: point.x + 70, y: point.y + 70 },
    );
    await expect
      .poll(() => readCloudAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          anchorWorldPos: expect.any(Array),
          anchorRefno: expect.any(String),
        },
      });
    const cloudLabel = page.locator('.dtx-anno-label').first();
    const cloudTitleInput = cloudLabel.locator('[data-role="annotation-title-input"]');
    const cloudDescriptionInput = cloudLabel.locator('[data-role="annotation-description-input"]');
    const cloudDragHandle = cloudLabel.locator('[data-role="annotation-drag-handle"]');
    await expect(cloudTitleInput).toBeVisible();
    await cloudTitleInput.fill('云线图钉批注');
    await cloudDescriptionInput.fill('云线应显示图钉、引线和文字');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await expect
      .poll(() => readCloudAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          anchorWorldPos: expect.any(Array),
          anchorRefno: expect.any(String),
          title: '云线图钉批注',
          description: '云线应显示图钉、引线和文字',
          leaderEndWorldPos: expect.any(Array),
        },
      });
    await saveViewerShot(page, 'cloud-annotation');
    await expect(cloudLabel).toBeVisible();
    await expect(cloudTitleInput).toHaveValue('云线图钉批注');
    const cloudStyle = await readLabelCardStyle(cloudLabel);
    expect(cloudStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(cloudStyle.boxShadow).not.toBe('none');
    const cloudHandleBox = await cloudDragHandle.boundingBox();
    expect(cloudHandleBox).not.toBeNull();
    if (!cloudHandleBox) {
      throw new Error('云线批注拖拽 handle 未获取到 bounding box');
    }
    const cloudLeaderStart = (await readCloudAnnotationStore(page)).first?.leaderEndWorldPos ?? null;
    await drag(
      page,
      { x: cloudHandleBox.x + cloudHandleBox.width / 2, y: cloudHandleBox.y + cloudHandleBox.height / 2 },
      { x: cloudHandleBox.x + cloudHandleBox.width / 2 + 80, y: cloudHandleBox.y + cloudHandleBox.height / 2 + 40 },
    );
    await expect
      .poll(() => readCloudAnnotationStore(page), { timeout: 10_000 })
      .not.toMatchObject({
        first: {
          leaderEndWorldPos: cloudLeaderStart,
        },
      });
    await saveViewerShot(page, 'cloud-annotation-edit');

    await setToolMode(page, 'annotation_rect');
    await page.mouse.click(point.x, point.y);
    const rectLabel = page.locator('.dtx-anno-label').last();
    const rectTitleInput = rectLabel.locator('[data-role="annotation-title-input"]');
    const rectDescriptionInput = rectLabel.locator('[data-role="annotation-description-input"]');
    const rectDragHandle = rectLabel.locator('[data-role="annotation-drag-handle"]');
    await expect(rectTitleInput).toBeVisible();
    await rectTitleInput.fill('矩形图钉批注');
    await rectDescriptionInput.fill('矩形应显示图钉、引线和文字');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await expect
      .poll(() => readRectAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          title: '矩形图钉批注',
          description: '矩形应显示图钉、引线和文字',
          leaderEndWorldPos: expect.any(Array),
        },
      });
    await saveViewerShot(page, 'rect-annotation');
    await expect(rectLabel).toBeVisible();
    await expect(rectTitleInput).toHaveValue('矩形图钉批注');
    await expect
      .poll(() => readLabelCardStyle(rectLabel))
      .toMatchObject({
        borderRadius: '14px',
        paddingTop: '10px',
      });
    const rectStyle = await readLabelCardStyle(rectLabel);
    expect(rectStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(rectStyle.boxShadow).not.toBe('none');
    expect(rectStyle.borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
    const rectLeaderStart = (await readRectAnnotationStore(page)).first?.leaderEndWorldPos ?? null;
    const rectHandleBox = await rectDragHandle.boundingBox();
    expect(rectHandleBox).not.toBeNull();
    if (!rectHandleBox) {
      throw new Error('矩形批注拖拽 handle 未获取到 bounding box');
    }
    await drag(
      page,
      { x: rectHandleBox.x + rectHandleBox.width / 2, y: rectHandleBox.y + rectHandleBox.height / 2 },
      { x: rectHandleBox.x + rectHandleBox.width / 2 + 70, y: rectHandleBox.y + rectHandleBox.height / 2 + 45 },
    );
    await expect
      .poll(() => readRectAnnotationStore(page), { timeout: 10_000 })
      .not.toMatchObject({
        first: {
          leaderEndWorldPos: rectLeaderStart,
        },
      });
    await saveViewerShot(page, 'rect-annotation-edit');

    await setToolMode(page, 'annotation_obb');
    await drag(
      page,
      { x: point.x - 55, y: point.y - 55 },
      { x: point.x + 55, y: point.y + 55 },
    );
    const obbLabel = page.locator('.dtx-anno-label').last();
    const obbTitleInput = obbLabel.locator('[data-role="annotation-title-input"]');
    const obbDescriptionInput = obbLabel.locator('[data-role="annotation-description-input"]');
    const obbDragHandle = obbLabel.locator('[data-role="annotation-drag-handle"]');
    await expect(obbTitleInput).toBeVisible();
    await obbTitleInput.fill('OBB 图钉批注');
    await obbDescriptionInput.fill('OBB 应显示图钉、引线和文字');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await expect
      .poll(() => readObbAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          title: 'OBB 图钉批注',
          description: 'OBB 应显示图钉、引线和文字',
          labelWorldPos: expect.any(Array),
        },
      });
    await saveViewerShot(page, 'obb-annotation');
    await expect(obbLabel).toBeVisible();
    await expect(obbTitleInput).toHaveValue('OBB 图钉批注');
    const obbLeaderStart = (await readObbAnnotationStore(page)).first?.labelWorldPos ?? null;
    const obbHandleBox = await obbDragHandle.boundingBox();
    expect(obbHandleBox).not.toBeNull();
    if (!obbHandleBox) {
      throw new Error('OBB 批注拖拽 handle 未获取到 bounding box');
    }
    await drag(
      page,
      { x: obbHandleBox.x + obbHandleBox.width / 2, y: obbHandleBox.y + obbHandleBox.height / 2 },
      { x: obbHandleBox.x + obbHandleBox.width / 2 + 60, y: obbHandleBox.y + obbHandleBox.height / 2 + 45 },
    );
    await expect
      .poll(() => readObbAnnotationStore(page), { timeout: 10_000 })
      .not.toMatchObject({
        first: {
          labelWorldPos: obbLeaderStart,
        },
      });
    await saveViewerShot(page, 'obb-annotation-edit');
  });

  test('文字批注应支持拖动 card 与双击图钉折叠展开', async ({ page }) => {
    const point = await findPickablePoint(page);

    await setToolMode(page, 'annotation');
    await page.mouse.click(point.x, point.y);
    await expect
      .poll(() => readTextAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          labelWorldPos: expect.any(Array),
          collapsed: false,
        },
      });
    const titleInput = page.locator('.dtx-anno-label [data-role="annotation-title-input"]').first();
    const descriptionInput = page.locator('.dtx-anno-label [data-role="annotation-description-input"]').first();
    const textMarker = page.locator('.dtx-anno-marker[data-marker-kind="push-pin"]').first();
    await expect(titleInput).toBeVisible();
    await titleInput.fill('文字图钉批注');
    await descriptionInput.fill('文字批注应支持拖动和折叠');
    await textMarker.click();

    await expect
      .poll(() => readTextAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          title: '文字图钉批注',
          description: '文字批注应支持拖动和折叠',
        },
      });
    await saveViewerShot(page, 'text-annotation-expanded');

    const textLabel = page.locator('.dtx-anno-label').first();
    const renderedTitleInput = textLabel.locator('[data-role="annotation-title-input"]');
    const dragHandle = textLabel.locator('[data-role="annotation-drag-handle"]');
    await expect(textLabel).toBeVisible();
    await expect(renderedTitleInput).toHaveValue('文字图钉批注');
    await expect(textMarker).toBeVisible();
    await expect(dragHandle).toBeVisible();

    await textMarker.click();

    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) {
      throw new Error('文字批注拖拽 handle 未获取到 bounding box');
    }

    await drag(
      page,
      { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
      { x: handleBox.x + handleBox.width / 2 + 90, y: handleBox.y + handleBox.height / 2 + 50 },
    );

    await expect
      .poll(() => readTextAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          labelWorldPos: expect.any(Array),
        },
      });
    await saveViewerShot(page, 'text-annotation-dragged');

    await textMarker.dblclick();
    await expect(textLabel).toBeHidden();
    const collapsedMarker = page.locator('.dtx-anno-marker[data-marker-kind="location-pin"]').first();
    await expect(collapsedMarker).toBeVisible();
    await saveViewerShot(page, 'text-annotation-collapsed');

    await collapsedMarker.dblclick();
    await expect(textLabel).toBeVisible();
    await saveViewerShot(page, 'text-annotation-reexpanded');
  });
});
