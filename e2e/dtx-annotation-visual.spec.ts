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
    const { useViewerContext } = await import('/src/composables/useViewerContext.ts');
    const store = useViewerContext().store.value;
    if (!store) {
      throw new Error('viewer store 尚未就绪，无法 reset');
    }
    store.clearAll();
  });
}

async function setToolMode(
  page: Page,
  mode: 'annotation' | 'annotation_cloud' | 'annotation_rect' | 'annotation_obb',
) {
  await page.evaluate(async (nextMode) => {
    const { useViewerContext } = await import('/src/composables/useViewerContext.ts');
    const store = useViewerContext().store.value;
    if (!store) {
      throw new Error('viewer store 尚未就绪，无法切换 toolMode');
    }
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
        const pointHit = typeof sel.pickPoint === 'function' ? sel.pickPoint({ x, y }) : null;
        if (!pointHit?.objectId) continue;
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

async function invokeCanvasToolPointer(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  point: { x: number; y: number },
  pointerId: number,
  buttons: number,
) {
  await page.evaluate(async ({ nextType, nextPoint, nextPointerId, nextButtons }) => {
    const [{ useViewerContext }] = await Promise.all([
      import('/src/composables/useViewerContext.ts'),
    ]);
    const ctx = useViewerContext();
    const tools = ctx.tools.value;
    const canvas = document.querySelector('canvas.viewer') as HTMLCanvasElement | null;
    if (!tools || !canvas) {
      throw new Error('viewer tools 或 canvas 尚未就绪');
    }
    const event = new PointerEvent(nextType, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: nextPoint.x,
      clientY: nextPoint.y,
      pointerId: nextPointerId,
      pointerType: 'mouse',
      button: 0,
      buttons: nextButtons,
      isPrimary: true,
    });
    if (nextType === 'pointerdown') {
      tools.onCanvasPointerDown(canvas, event);
      return;
    }
    if (nextType === 'pointermove') {
      tools.onCanvasPointerMove(canvas, event);
      return;
    }
    tools.onCanvasPointerUp(canvas, event);
  }, {
    nextType: type,
    nextPoint: point,
    nextPointerId: pointerId,
    nextButtons: buttons,
  });
}

async function clickCanvas(page: Page, point: { x: number; y: number }) {
  const pointerId = 101;
  await invokeCanvasToolPointer(page, 'pointerdown', point, pointerId, 1);
  await invokeCanvasToolPointer(page, 'pointerup', point, pointerId, 0);
}

async function dragCanvas(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const pointerId = 102;
  await invokeCanvasToolPointer(page, 'pointerdown', from, pointerId, 1);
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await invokeCanvasToolPointer(page, 'pointermove', {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    }, pointerId, 1);
  }
  await invokeCanvasToolPointer(page, 'pointerup', to, pointerId, 0);
}

async function dragOverlayHandle(
  handle: ReturnType<Page['locator']>,
  delta: { x: number; y: number },
) {
  await handle.evaluate((el, nextDelta) => {
    const target = el as HTMLElement;
    const rect = target.getBoundingClientRect();
    const pointerId = 201;
    const start = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    const emit = (type: 'pointerdown' | 'pointermove' | 'pointerup', point: { x: number; y: number }, buttons: number) => {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: point.x,
        clientY: point.y,
        pointerId,
        pointerType: 'mouse',
        button: 0,
        buttons,
        isPrimary: true,
      }));
    };
    emit('pointerdown', start, 1);
    const steps = 10;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      emit('pointermove', {
        x: start.x + nextDelta.x * t,
        y: start.y + nextDelta.y * t,
      }, 1);
    }
    emit('pointerup', {
      x: start.x + nextDelta.x,
      y: start.y + nextDelta.y,
    }, 0);
  }, delta);
}

async function commitInlineDraft(label: ReturnType<Page['locator']>) {
  await label.evaluate((el) => {
    const labelEl = el as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    if (document.body instanceof HTMLElement) {
      document.body.focus?.();
    }
    labelEl.dispatchEvent(new FocusEvent('focusout', {
      bubbles: true,
      cancelable: true,
      relatedTarget: document.body,
    }));
  });
}

async function dispatchMarkerClick(marker: ReturnType<Page['locator']>, count = 1) {
  await marker.evaluate((el, nextCount) => {
    const target = el as HTMLElement;
    for (let i = 0; i < nextCount; i += 1) {
      target.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
    }
  }, count);
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
    const { useViewerContext } = await import('/src/composables/useViewerContext.ts');
    const store = useViewerContext().store.value;
    if (!store) {
      return { count: 0, first: null };
    }
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
    const { useViewerContext } = await import('/src/composables/useViewerContext.ts');
    const store = useViewerContext().store.value;
    if (!store) {
      return { count: 0, first: null };
    }
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
    const { useViewerContext } = await import('/src/composables/useViewerContext.ts');
    const store = useViewerContext().store.value;
    if (!store) {
      return { count: 0, first: null };
    }
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
    const { useViewerContext } = await import('/src/composables/useViewerContext.ts');
    const store = useViewerContext().store.value;
    if (!store) {
      return { count: 0, first: null };
    }
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

async function readViewerToolRuntime(page: Page) {
  return page.evaluate(async () => {
    const [{ useViewerContext }] = await Promise.all([
      import('/src/composables/useViewerContext.ts'),
    ]);
    const ctx = useViewerContext();
    const store = ctx.store.value;
    return {
      toolMode: store?.toolMode.value ?? null,
      activeTab: store?.activeTab.value ?? null,
      statusText: ctx.tools.value?.statusText.value ?? null,
      toolsReady: ctx.tools.value?.ready.value ?? null,
      sameStore: !!store,
    };
  });
}

test.describe('DTX 批注视觉截图', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    await waitForDtxReady(page);
    await expect.poll(() => readViewerToolRuntime(page), { timeout: 15_000 }).toMatchObject({
      toolsReady: true,
      sameStore: true,
    });
    await resetToolStore(page);
  });

  test('应能自动创建云线、矩形与 OBB 批注并输出截图', async ({ page }) => {
    const point = await findPickablePoint(page);

    await setToolMode(page, 'annotation_cloud');
    await expect.poll(() => readViewerToolRuntime(page)).toMatchObject({
      toolMode: 'annotation_cloud',
      toolsReady: true,
      sameStore: true,
    });
    await clickCanvas(page, point);
    await dragCanvas(
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
    await commitInlineDraft(cloudLabel);
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
    const cloudLeaderStart = (await readCloudAnnotationStore(page)).first?.leaderEndWorldPos ?? null;
    await dragOverlayHandle(cloudDragHandle, { x: 80, y: 40 });
    await expect
      .poll(() => readCloudAnnotationStore(page), { timeout: 10_000 })
      .not.toMatchObject({
        first: {
          leaderEndWorldPos: cloudLeaderStart,
        },
      });
    await saveViewerShot(page, 'cloud-annotation-edit');

    await setToolMode(page, 'annotation_rect');
    await clickCanvas(page, point);
    const rectLabel = page.locator('.dtx-anno-label').last();
    const rectTitleInput = rectLabel.locator('[data-role="annotation-title-input"]');
    const rectDescriptionInput = rectLabel.locator('[data-role="annotation-description-input"]');
    const rectDragHandle = rectLabel.locator('[data-role="annotation-drag-handle"]');
    await expect(rectTitleInput).toBeVisible();
    await rectTitleInput.fill('矩形图钉批注');
    await rectDescriptionInput.fill('矩形应显示图钉、引线和文字');
    await commitInlineDraft(rectLabel);
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
    await expect
      .poll(() => readRectAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          leaderEndWorldPos: expect.any(Array),
        },
      });
    await saveViewerShot(page, 'rect-annotation');

    await setToolMode(page, 'annotation_obb');
    await dragCanvas(
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
    await commitInlineDraft(obbLabel);
    await expect(obbLabel).toBeVisible();
    await expect(obbTitleInput).toHaveValue('OBB 图钉批注');
    await expect
      .poll(() => readObbAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          labelWorldPos: expect.any(Array),
        },
      });
    await saveViewerShot(page, 'obb-annotation');
  });

  test('文字批注应支持拖动 card 与双击图钉折叠展开', async ({ page }) => {
    const point = await findPickablePoint(page);

    await setToolMode(page, 'annotation');
    await clickCanvas(page, point);
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
    await commitInlineDraft(page.locator('.dtx-anno-label').first());
    await dispatchMarkerClick(textMarker);

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

    await dragOverlayHandle(dragHandle, { x: 90, y: 50 });

    await expect
      .poll(() => readTextAnnotationStore(page), { timeout: 10_000 })
      .toMatchObject({
        count: 1,
        first: {
          labelWorldPos: expect.any(Array),
        },
      });
    await saveViewerShot(page, 'text-annotation-dragged');

    await page.waitForTimeout(450);
    await dispatchMarkerClick(textMarker, 2);
    await expect(textLabel).toBeHidden();
    const collapsedMarker = page.locator('.dtx-anno-marker[data-marker-kind="location-pin"]').first();
    await expect(collapsedMarker).toBeVisible();
    await saveViewerShot(page, 'text-annotation-collapsed');

    await page.waitForTimeout(450);
    await dispatchMarkerClick(collapsedMarker, 2);
    await expect(textLabel).toBeVisible();
    await saveViewerShot(page, 'text-annotation-reexpanded');
  });
});
