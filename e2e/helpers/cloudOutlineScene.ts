/**
 * 云线轮廓类 e2e 的共用场景：起 primitives demo（不依赖后端）、等就绪、画一条云线、数画面上的云线红像素。
 *
 * 被 `dtx-cloud-outline-camera-motion`（慢速 orbit，帧级探针）与 `dtx-cloud-outline-fast-orbit`
 * （快速拖动，读真实帧缓冲）两条用例共用。
 */
import { expect, type Page } from '@playwright/test';

export const DEMO_URL = '/?output_project=AvevaMarineSample&dtx_demo=primitives&dtx_demo_count=50';

export type PickPoint = { x: number; y: number; objectId: string; rect: { left: number; top: number; width: number; height: number } };

export async function waitForDemoReady(page: Page) {
  await page.waitForFunction(() => {
    const v = (window as any).__xeokitViewer;
    const layer = v && v.__dtxLayer;
    if (!layer || typeof layer.getStats !== 'function') return false;
    const stats = layer.getStats();
    return !!stats && stats.compiled === true && Number(stats.totalObjects) > 0;
  }, null, { timeout: 60_000 });
  await page.waitForFunction(() => typeof (window as any).__viewerToolStore?.clearAll === 'function', null, { timeout: 10_000 });
  await page.waitForFunction(() => (window as any).__viewerTools?.ready?.value === true, null, { timeout: 15_000 });
}

/**
 * 既能被 id 拾取又能被射线求到表面点（锚点用 pickPoint）、且没被浮层盖住的画布点。
 *
 * 先扫一遍靠中间的疏网格（demo 这类满屏构件一两下就中）；一个都没中再上密网格——真实项目常常
 * 只显示一条 BRAN，144 个采样点里只有三四个落在管子上，疏网格会整片扫空。
 */
export async function findPickablePoint(page: Page): Promise<PickPoint> {
  const point = await page.evaluate(() => {
    const v = (window as any).__xeokitViewer;
    const sel = v?.__dtxSelection;
    const canvas = document.querySelector('canvas.viewer') as HTMLCanvasElement | null;
    if (!sel || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const tryAt = (rx: number, ry: number) => {
      const x = rect.width * rx;
      const y = rect.height * ry;
      const px = rect.left + x;
      const py = rect.top + y;
      if (document.elementFromPoint(px, py) !== canvas) return null;
      const hit = sel.pick?.({ x, y });
      if (!hit?.objectId) return null;
      if (typeof sel.pickPoint === 'function' && !sel.pickPoint({ x, y })) return null;
      return { x: px, y: py, objectId: hit.objectId as string, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
    };
    const coarse = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];
    for (const ry of coarse) {
      for (const rx of coarse) {
        const found = tryAt(rx, ry);
        if (found) return found;
      }
    }
    const steps = 24;
    for (let j = 1; j < steps; j += 1) {
      for (let i = 1; i < steps; i += 1) {
        const found = tryAt(i / steps, j / steps);
        if (found) return found;
      }
    }
    return null;
  });
  expect(point, '找不到可拾取的画布点').not.toBeNull();
  return point as PickPoint;
}

export async function createCloud(page: Page) {
  const target = await findPickablePoint(page);
  await page.evaluate((refno) => {
    const store = (window as any).__viewerToolStore;
    store.setCloudTargetRefnos([refno]);
    store.setToolMode('annotation_cloud');
  }, target.objectId);
  // 进云线模式后工具条 / 提示出现，画布会缩：等布局稳定后重新拾锚点
  await page.waitForTimeout(600);
  const anchor = await findPickablePoint(page);
  await page.mouse.click(anchor.x, anchor.y);
  await page.mouse.move(anchor.x - 70, anchor.y - 70);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 70, anchor.y + 70, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(() => (window as any).__viewerToolStore.cloudAnnotations.value.length === 1, null, { timeout: 10_000 });
  await page.evaluate(() => (window as any).__viewerToolStore.setToolMode('none'));
  await page.waitForTimeout(600);
  return anchor.rect;
}

/** 截当前画布区域，数云线红（#ef4444 附近）的像素——只用来确认静止时轮廓真的画出来了 */
export async function countCloudRedPixels(page: Page, rect: PickPoint['rect']): Promise<number> {
  const png = await page.screenshot({ clip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } });
  return page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (r > 200 && g < 110 && b < 110 && Math.abs(g - b) < 30) count += 1;
    }
    return count;
  }, png.toString('base64'));
}
