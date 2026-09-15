/**
 * 云线轮廓在相机运动中必须一直画着（回归：拖动期间轮廓整段消失、停下才出现）。
 *
 * 根因：`ViewerPanel.renderFrame` 先 `renderer.render` 再 `tools.updateOverlayPositions()`。云线轮廓是贴在
 * `frameNdcZ = 0`（离相机约一个 near 距离）的 billboard 折线，先渲染再重建 = 本帧画的那份几何是按**上一帧**相机
 * 摆的；orbit 时相机绕着目标整体挪动，上一帧那片近平面早已不在本帧视锥里，于是拖动期间轮廓整段消失、松手才回来。
 *
 * 怎么兜住：Playwright 的 `page.screenshot` 会等页面稳定，截到的永远是「相机停下后又渲染了一帧」的样子——
 * 旧代码下也看得见轮廓，像素法测不出这条回归（实测改前改后都绿）。所以这里在页面里挂两个探针，
 * 直接读每一帧渲染当刻的真实状态：
 *  1. 包 `renderer.render`：进去之前先把相机 matrixWorld 结算出来，再把云线轮廓**当前几何**投影一遍，
 *     记下它在本帧相机下的 NDC 包围盒（与 [-1,1]² 不相交 = 这一帧整段画到了画面外）；
 *  2. 包 `tools.updateOverlayPositions`：记下几何是按哪个相机位置重建的。
 * 于是「本帧渲染用的相机」与「本帧几何所用的相机」是否同一个、「本帧轮廓落在不落在画面里」，都成了可判定的断言。
 * billboard 面离相机约 1 个单位，而 orbit 一帧能把相机挪半个单位——差一帧的几何就偏出去二十几度，整段扫出画面。
 *
 * 跑法：`npx @playwright/test test e2e/dtx-cloud-outline-camera-motion.spec.ts`（`dtx_demo=primitives`，不依赖后端）。
 */
import { expect, test, type Page } from '@playwright/test';

const DEMO_URL = '/?output_project=AvevaMarineSample&dtx_demo=primitives&dtx_demo_count=50';

type PickPoint = { x: number; y: number; objectId: string; rect: { left: number; top: number; width: number; height: number } };

type NdcBox = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

type ProbeFrame = {
  /** 本帧 `renderer.render` 拿到的相机世界位置 */
  camPos: [number, number, number];
  /** 云线轮廓几何最后一次重建时的相机世界位置（null = 还没重建过） */
  overlayCamPos: [number, number, number] | null;
  /** 轮廓各点在本帧相机下的 NDC 包围盒 */
  ndc: NdcBox | null;
  /** 有点落到相机背后（裁剪 w ≤ 0） */
  behind: boolean;
  points: number;
};

test.use({ viewport: { width: 1400, height: 900 } });

async function waitForDemoReady(page: Page) {
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

/** 既能被 id 拾取又能被射线求到表面点（锚点用 pickPoint）、且没被浮层盖住的画布点 */
async function findPickablePoint(page: Page): Promise<PickPoint> {
  const point = await page.evaluate(() => {
    const v = (window as any).__xeokitViewer;
    const sel = v?.__dtxSelection;
    const canvas = document.querySelector('canvas.viewer') as HTMLCanvasElement | null;
    if (!sel || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ratios = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];
    for (const ry of ratios) {
      for (const rx of ratios) {
        const x = rect.width * rx;
        const y = rect.height * ry;
        const px = rect.left + x;
        const py = rect.top + y;
        if (document.elementFromPoint(px, py) !== canvas) continue;
        const hit = sel.pick?.({ x, y });
        if (!hit?.objectId) continue;
        if (typeof sel.pickPoint === 'function' && !sel.pickPoint({ x, y })) continue;
        return { x: px, y: py, objectId: hit.objectId as string, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
      }
    }
    return null;
  });
  expect(point, '找不到可拾取的画布点').not.toBeNull();
  return point as PickPoint;
}

async function createCloud(page: Page) {
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
async function countCloudRedPixels(page: Page, rect: PickPoint['rect']): Promise<number> {
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

/** 在页面里挂帧级探针：每次用主相机渲染都记一条 ProbeFrame */
async function installFrameProbe(page: Page) {
  await page.evaluate(() => {
    const viewer = (window as any).__dtxViewer;
    const tools = (window as any).__viewerTools;
    const frames: unknown[] = [];
    (window as any).__cloudMotionProbe = { frames };

    let overlayCamPos: number[] | null = null;
    const origUpdate = tools.updateOverlayPositions;
    tools.updateOverlayPositions = function patchedUpdateOverlayPositions(...args: unknown[]) {
      const result = origUpdate.apply(tools, args);
      overlayCamPos = viewer.camera.position.toArray();
      return result;
    };

    const renderer = viewer.renderer;
    const origRender = renderer.render.bind(renderer);
    renderer.render = (scene: any, camera: any) => {
      if (camera === viewer.camera) {
        // three 在 render 内部才结算 matrixWorld，这里先自己算一次，拿到的就是本帧真正用于投影的那个矩阵
        camera.updateMatrixWorld();
        const pts: number[] = tools.debugCloudOutlines()[0]?.worldPositions ?? [];
        const e = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements;
        let ndc: Record<string, number> | null = null;
        let behind = false;
        for (let i = 0; i + 2 < pts.length; i += 3) {
          const x = pts[i]!;
          const y = pts[i + 1]!;
          const z = pts[i + 2]!;
          const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
          if (w <= 0) {
            behind = true;
            continue;
          }
          const nx = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w;
          const ny = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w;
          const nz = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) / w;
          if (!ndc) ndc = { minX: nx, maxX: nx, minY: ny, maxY: ny, minZ: nz, maxZ: nz };
          else {
            ndc.minX = Math.min(ndc.minX!, nx); ndc.maxX = Math.max(ndc.maxX!, nx);
            ndc.minY = Math.min(ndc.minY!, ny); ndc.maxY = Math.max(ndc.maxY!, ny);
            ndc.minZ = Math.min(ndc.minZ!, nz); ndc.maxZ = Math.max(ndc.maxZ!, nz);
          }
        }
        frames.push({ camPos: camera.position.toArray(), overlayCamPos, ndc, behind, points: pts.length / 3 });
      }
      return origRender(scene, camera);
    };
  });
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/** 这一帧的轮廓在画面里还看得见吗：NDC 包围盒要与视锥 [-1,1]³ 有交集，且没有点跑到相机背后 */
function isOnScreen(frame: ProbeFrame): boolean {
  const b = frame.ndc;
  if (!b || frame.behind) return false;
  return b.maxX >= -1 && b.minX <= 1 && b.maxY >= -1 && b.minY <= 1 && b.maxZ >= -1 && b.minZ <= 1;
}

test.describe('DTX 云线轮廓 · 相机运动中不消失', () => {
  test('orbit 每一帧的轮廓都画在画面里，且几何是按本帧相机重建的', async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    await waitForDemoReady(page);
    await page.evaluate(() => (window as any).__viewerToolStore.clearAll());

    const rect = await createCloud(page);
    expect(await countCloudRedPixels(page, rect), '静止时应能看到云线轮廓').toBeGreaterThan(150);

    await installFrameProbe(page);

    // 在画布右下空白处按住拖动做 orbit，分小步、每步让 rAF 跑几帧
    const startX = rect.left + rect.width * 0.85;
    const startY = rect.top + rect.height * 0.85;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(startX - i * 6, startY - i * 3);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(700);

    const frames = (await page.evaluate(() => (window as any).__cloudMotionProbe.frames)) as ProbeFrame[];
    expect(frames.length, '探针一帧都没记到（renderer.render 没被主相机调用？）').toBeGreaterThan(10);
    expect(frames.every((f) => f.points > 0), '每一帧都该有云线轮廓几何').toBe(true);

    // 相机真的动了的那些帧才有判据；至少要有一批，否则这条用例是空转的
    const moving = frames.filter((f, i) => i > 0 && dist(f.camPos, frames[i - 1]!.camPos) > 1e-4);
    expect(moving.length, 'orbit 没让相机动起来，用例没测到东西').toBeGreaterThan(5);

    // 症状：相机动着的那些帧里，轮廓不能整段画到画面外
    const offScreen = moving.filter((f) => !isOnScreen(f));
    expect(
      offScreen.length,
      `有 ${offScreen.length}/${moving.length} 帧云线轮廓整段画在了画面外（相机运动中就是「消失」），例：${JSON.stringify(offScreen[0])}`,
    ).toBe(0);

    // 机制：本帧渲染用的相机，必须就是本帧几何重建时的那个相机
    const stale = moving.filter((f) => !f.overlayCamPos || dist(f.camPos, f.overlayCamPos) > 1e-6);
    expect(
      stale.length,
      `有 ${stale.length}/${moving.length} 帧画的是按别的相机摆的轮廓几何，例：${JSON.stringify(stale[0])}`,
    ).toBe(0);

    // 状态侧也该一直说轮廓可见（这条改前改后都过，真正兜住回归的是上面两条）
    const outlines = await page.evaluate(() => (window as any).__viewerTools.debugCloudOutlines());
    expect(outlines[0]?.visible).toBe(true);
    expect(await countCloudRedPixels(page, rect), '松手后仍应看到云线轮廓').toBeGreaterThan(150);
  });
});
