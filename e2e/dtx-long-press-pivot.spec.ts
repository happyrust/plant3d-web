/**
 * 长按记旋转中心（`DynamicPivotController`）在真实模型上的交互回归：
 * - 导航态（`toolMode === 'none'`）左键在构件上长按：画面不动（相机、观察中心都不变），只把按住的那一点记成旋转中心，
 *   并在那一点上显示小圆点；
 * - 右键 / 中键长按不记也不取消（右键在构件上要弹菜单，中键是缩放）；
 * - 长按不往场景里加任何 sprite（小圆点是叠在画布上的 DOM 元素，不进三维场景）；
 * - 距离测量态在拾取点上按住不动：相机不动，也不记、不取消旋转中心——测量选点不能被当成长按；
 * - 导航态左键在空白处长按：取消记住的旋转中心，小圆点消失。
 *
 * 各种手势下焦点在屏幕上漂多少，在 `dtx-view-focus.spec.ts` 里量（跑演示场景，不要后端）；这里只在真实模型上过一遍长按。
 *
 * 两种跑法：
 * - 缺省：与其它 live 型 e2e 同一态度，页面走 Playwright `baseURL` 的 Vite dev server，gen-model 在 `GEN_MODEL_V1_BASE_URL`
 *   （缺省 `http://127.0.0.1:8022`）且有 AvevaMarineSample；服务不在就跳过。
 * - `PIVOT_E2E_URL=<完整页面地址>`：直接打开那个地址，用它自己的后端，不探 gen-model（带 show_refno 的已部署站点，
 *   或者本机 dev server 的演示场景 `/?output_project=AvevaMarineSample&dtx_demo=primitives&dtx_demo_count=9`）。
 *   再给 `PIVOT_E2E_DIST=<vite build 产物目录>` 就把该站点的前端静态文件换成本地构建、接口照走站点——部署前在线上数据上验本地改动：
 *   `$env:PIVOT_E2E_URL='http://123.57.182.243/?show_refno=24381_145018'; npx @playwright/test test e2e/dtx-long-press-pivot.spec.ts`
 */
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const GEN_MODEL_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';
const DEPLOYED_URL = process.env.PIVOT_E2E_URL?.trim() || '';
const LOCAL_DIST = process.env.PIVOT_E2E_DIST?.trim() ? path.resolve(process.env.PIVOT_E2E_DIST.trim()) : '';
const SHOW_REFNO = '24381_145018';
/** `ViewerPanel` 配的长按阈值是 300 ms，按住时长留足三倍 */
const HOLD_MS = 900;
/** 找「光标下有构件」的位置：画布中心附近这几处挨个试（相对画布中心的像素偏移） */
const PROBE_OFFSETS: [number, number][] = [
  [0, 0], [0, 60], [60, 0], [-60, 0], [0, -60], [120, 40], [-120, -40], [40, 120], [-40, -120],
];
/** 找「空白处」的位置：画布靠边的这几处挨个试（占画布宽高的比例） */
const EMPTY_FRACTIONS: [number, number][] = [
  [0.08, 0.5], [0.5, 0.92], [0.1, 0.88], [0.9, 0.88], [0.08, 0.3], [0.3, 0.92], [0.7, 0.92], [0.92, 0.6],
];
const BUTTON_NAME = { left: '左键', right: '右键', middle: '中键' } as const;
/** 相机姿态逐帧会有浮点抖动，「没动」按容差判：位置 / 观察中心按视距的比例，朝向按角度 */
const POSE_EPS = 1e-9;
const ANGLE_EPS_DEG = 1e-3;

type MouseButton = keyof typeof BUTTON_NAME;
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type Pt = { x: number; y: number };
type ViewState = {
  toolMode: string;
  target: Vec3;
  camera: Vec3;
  quaternion: Quat;
  visibleSprites: number;
  /** 长按记住的旋转中心（世界坐标），没记是 null */
  remembered: Vec3 | null;
  /** 记住的旋转中心此刻投在画布上的位置（CSS 像素） */
  rememberedAt: Pt | null;
  /** 小圆点的中心在画布上的位置，没显示是 null */
  dotAt: Pt | null;
};
type Hold = { holding: ViewState; after: ViewState };

test.use({ viewport: { width: 1600, height: 900 } });
test.describe.configure({ timeout: 300_000 });

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function gapPx(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDeg(a: Quat, b: Quat): number {
  const d = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(d) * 180) / Math.PI;
}

function expectViewStill(before: ViewState, after: ViewState, what: string): void {
  const span = distance(before.camera, before.target);
  expect(distance(before.camera, after.camera) / span, `${what}：相机位置不该动`).toBeLessThan(POSE_EPS);
  expect(distance(before.target, after.target) / span, `${what}：观察中心不该动`).toBeLessThan(POSE_EPS);
  expect(angleDeg(before.quaternion, after.quaternion), `${what}：相机不该转`).toBeLessThan(ANGLE_EPS_DEG);
}

async function probeGenModel(): Promise<string | null> {
  try {
    const response = await fetch(`${GEN_MODEL_BASE}/api/v1/health`);
    return response.ok ? null : `gen-model health HTTP ${response.status}（${GEN_MODEL_BASE}）`;
  } catch {
    return `gen-model 不在 ${GEN_MODEL_BASE}（对已部署站点跑请设 PIVOT_E2E_URL）`;
  }
}

function readViewState(page: Page): Promise<ViewState> {
  return page.evaluate((): ViewState => {
    const w = window as any;
    const viewer = w.__dtxViewer;
    let visibleSprites = 0;
    viewer.scene.traverseVisible((object: any) => {
      if (object.isSprite) visibleSprites += 1;
    });
    const t = viewer.controls.target;
    const c = viewer.camera.position;
    const q = viewer.camera.quaternion;
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    const point = w.__dtxPivot.getRememberedPivot();
    let rememberedAt: { x: number; y: number } | null = null;
    if (point) {
      viewer.camera.updateMatrixWorld();
      const ndc = point.clone().project(viewer.camera);
      rememberedAt = { x: (ndc.x * 0.5 + 0.5) * rect.width, y: (0.5 - ndc.y * 0.5) * rect.height };
    }
    const dot = document.querySelector<HTMLElement>('[data-testid="dtx-remembered-pivot"]');
    let dotAt: { x: number; y: number } | null = null;
    if (dot && getComputedStyle(dot).display !== 'none') {
      const box = dot.getBoundingClientRect();
      dotAt = { x: box.left + box.width / 2 - rect.left, y: box.top + box.height / 2 - rect.top };
    }
    return {
      toolMode: w.__viewerToolStore.toolMode.value,
      target: [t.x, t.y, t.z],
      camera: [c.x, c.y, c.z],
      quaternion: [q.x, q.y, q.z, q.w],
      visibleSprites,
      remembered: point ? [point.x, point.y, point.z] : null,
      rememberedAt,
      dotAt,
    };
  });
}

/**
 * 在给定的几处（画布坐标）里找第一处能用的：那个位置最上面得是画布本身（没被工具条、方位块盖住），
 * `wantHit` 为 true 要光标下有构件（顺带返回拾到的表面点），为 false 要光标下没有构件。
 */
function findSpot(page: Page, candidates: Pt[], wantHit: boolean): Promise<{ at: Pt; point: Vec3 | null } | null> {
  return page.evaluate(([list, want]) => {
    const w = window as any;
    const canvas: HTMLCanvasElement = w.__dtxViewer.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    for (const at of list) {
      if (document.elementFromPoint(rect.left + at.x, rect.top + at.y) !== canvas) continue;
      const focus = w.__dtxPivot.resolveFocusPoint({ x: at.x, y: at.y }, null);
      const hit = focus?.source === 'hover';
      if (hit !== want) continue;
      return { at, point: hit ? [focus.point.x, focus.point.y, focus.point.z] as [number, number, number] : null };
    }
    return null;
  }, [candidates, wantHit] as const);
}

async function setToolMode(page: Page, mode: string): Promise<void> {
  await page.evaluate((m) => (window as any).__viewerToolStore.setToolMode(m), mode);
}

/** 站点的前端静态文件换成本地构建产物；`/api`、`/files` 照走站点自己的后端 */
async function serveFrontendFromDist(page: Page, siteUrl: string, dist: string): Promise<void> {
  expect(fs.existsSync(path.join(dist, 'index.html')), `${dist} 里没有 index.html，先 vite build`).toBe(true);
  await page.route(`${new URL(siteUrl).origin}/**`, async (route) => {
    let rel = decodeURIComponent(new URL(route.request().url()).pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(dist, rel);
    if (!rel.startsWith('/api') && !rel.startsWith('/files') && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return route.fulfill({ path: file });
    }
    return route.continue();
  });
}

async function openViewer(page: Page): Promise<void> {
  if (DEPLOYED_URL) {
    if (LOCAL_DIST) await serveFrontendFromDist(page, DEPLOYED_URL, LOCAL_DIST);
    await page.goto(DEPLOYED_URL, { waitUntil: 'domcontentloaded' });
  } else {
    // Vite HMR 的 websocket 不接到服务端：并行会话改 plant3d-web 时整页刷新会把查看器拆掉
    const devHost = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:3101').host;
    await page.routeWebSocket((url) => url.host === devHost, () => {});
    const params = new URLSearchParams({
      model_source: 'gen-model-v1',
      gm_backend: GEN_MODEL_BASE,
      output_project: 'AvevaMarineSample',
      show_refno: SHOW_REFNO,
    });
    await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  }

  const loaded = await page.waitForFunction(() => {
    const w = window as any;
    const stats = w.__dtxLayer?.getStats?.();
    return !!w.__dtxViewer && !!w.__viewerToolStore && stats?.compiled === true && Number(stats.totalObjects) > 0;
  }, null, { timeout: 180_000 }).then(() => true, () => false);
  expect(loaded, `模型没加载起来（${DEPLOYED_URL || `gen-model ${GEN_MODEL_BASE}，show_refno=${SHOW_REFNO}`}）`).toBe(true);
  const bundle = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((src) => /\/assets\/index-[^/]+\.js$/.test(src)) ?? 'vite dev');
  const bundleNote = `${bundle}${LOCAL_DIST ? `（本地构建 ${LOCAL_DIST}）` : ''}`;
  console.log(`[长按 pivot] 前端包 ${bundleNote}`);
  test.info().annotations.push({ type: '前端包', description: bundleNote });
  const hasPivotHandle = await page.evaluate(() => typeof (window as any).__dtxPivot?.getRememberedPivot === 'function');
  expect(hasPivotHandle, '页面上没有 window.__dtxPivot：这个前端包早于「长按只记旋转中心、画面不动」那次改动').toBe(true);

  const onboardingClose = page.getByRole('button', { name: '关闭向导', exact: true });
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click({ force: true }).catch(() => undefined);
  }
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  await expect.poll(async () => {
    const a = await readViewState(page);
    await page.waitForTimeout(500);
    const b = await readViewState(page);
    return distance(a.camera, b.camera) + distance(a.target, b.target);
  }, { message: '打开之后相机一直没停下来', timeout: 30_000 }).toBeLessThan(1e-6);
}

/**
 * 在页面坐标 (x, y) 按住 `HOLD_MS` 再松手，中间不移动；返回按住时和松手后的状态。
 * 右键松手会弹右键菜单、测量态松手算一次选点，松手后都用 Escape 收掉。
 */
async function longPress(page: Page, x: number, y: number, button: MouseButton, shot?: string): Promise<Hold> {
  await page.mouse.move(x - 3, y - 3);
  await page.waitForTimeout(80);
  await page.mouse.move(x, y);
  await page.waitForTimeout(150);
  await page.mouse.down({ button });
  await page.waitForTimeout(HOLD_MS);
  const holding = await readViewState(page);
  if (shot) await test.info().attach(shot, { body: await page.screenshot(), contentType: 'image/png' });
  await page.mouse.up({ button });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return { holding, after: await readViewState(page) };
}

test('长按记旋转中心：导航态左键只记不动画面，右键 / 中键和测量态按住不记不取消，空白处长按取消', async ({ page }) => {
  if (!DEPLOYED_URL) {
    const reason = await probeGenModel();
    test.skip(reason !== null, reason ?? '');
  }
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await openViewer(page);

  const canvas = await page.evaluate(() => {
    const rect = (window as any).__dtxViewer.renderer.domElement.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await setToolMode(page, 'none');

  const hitSpot = await findSpot(page, PROBE_OFFSETS.map(([dx, dy]) => ({ x: canvas.width / 2 + dx, y: canvas.height / 2 + dy })), true);
  expect(hitSpot, '画布中心附近几处光标下都没有构件：模型不在视口里').not.toBeNull();
  const spot = { at: hitSpot!.at, point: hitSpot!.point!, x: canvas.x + hitSpot!.at.x, y: canvas.y + hitSpot!.at.y };
  const emptySpot = await findSpot(page, EMPTY_FRACTIONS.map(([fx, fy]) => ({ x: canvas.width * fx, y: canvas.height * fy })), false);
  const empty = emptySpot ? { at: emptySpot.at, x: canvas.x + emptySpot.at.x, y: canvas.y + emptySpot.at.y } : null;
  if (!empty) test.info().annotations.push({ type: '没找到空白处', description: '画布靠边几处光标下都有构件，空白处的几步没跑' });
  console.log(`[长按 pivot] 空白处：${empty ? `画布内 (${Math.round(empty.at.x)}, ${Math.round(empty.at.y)})` : '没找到，空白处的几步没跑'}`);
  const start = await readViewState(page);
  expect(start.remembered, '还没长按就已经记着旋转中心').toBeNull();
  expect(start.dotAt, '还没长按就显示着小圆点').toBeNull();

  // 一、什么都没记的时候：右键、中键、测量态左键在构件上按住，都不该记
  for (const button of ['right', 'middle'] as const) {
    await test.step(`导航态${BUTTON_NAME[button]}在构件上长按：不记旋转中心，画面不动`, async () => {
      const before = await readViewState(page);
      const { holding, after } = await longPress(page, spot.x, spot.y, button);
      expectViewStill(before, holding, `导航态${BUTTON_NAME[button]}按住时`);
      expectViewStill(before, after, `导航态${BUTTON_NAME[button]}松手后`);
      expect(holding.remembered, `导航态${BUTTON_NAME[button]}长按不该记旋转中心`).toBeNull();
      expect(after.remembered, `导航态${BUTTON_NAME[button]}长按不该记旋转中心`).toBeNull();
      expect.soft(holding.visibleSprites, '长按往场景里加了 sprite（长按图钉回来了？）').toBe(before.visibleSprites);
    });
  }

  await test.step('距离测量态左键在拾取点上按住：相机不动，不记旋转中心', async () => {
    await setToolMode(page, 'xeokit_measure_distance');
    await page.waitForTimeout(300);
    const before = await readViewState(page);
    const { holding } = await longPress(page, spot.x, spot.y, 'left', '距离测量态左键按住');
    expect(holding.toolMode).toBe('xeokit_measure_distance');
    expectViewStill(before, holding, '测量态按住拾取点时');
    expect(holding.remembered, '测量态按住拾取点被当成了长按，记下了旋转中心').toBeNull();
    expect.soft(holding.dotAt, '测量态按住拾取点时冒出了小圆点').toBeNull();
    await setToolMode(page, 'none');
    await page.waitForTimeout(300);
    expect((await readViewState(page)).remembered, '测量态那次按住之后不该留下旋转中心').toBeNull();
  });

  // 二、导航态左键在构件上长按：只记，不动画面
  const remembered = await test.step('导航态左键在构件上长按：画面不动，旋转中心记到按住的那一点，那一点上出小圆点', async () => {
    const before = await readViewState(page);
    const span = distance(before.camera, before.target);
    const { holding, after } = await longPress(page, spot.x, spot.y, 'left', '导航态左键按住');
    for (const [stage, state] of [['按住时', holding], ['松手后', after]] as const) {
      expectViewStill(before, state, `导航态左键长按${stage}`);
      expect(state.remembered, `导航态左键长按${stage}应该记着旋转中心`).not.toBeNull();
      expect(distance(state.remembered!, spot.point) / span, `${stage}记下的点应该就是按住的那一点`).toBeLessThan(1e-3);
      expect(gapPx(state.rememberedAt!, spot.at), `${stage}记下的点在屏幕上应该就在按住的位置`).toBeLessThanOrEqual(2);
      expect(state.dotAt, `${stage}应该显示小圆点`).not.toBeNull();
      expect(gapPx(state.dotAt!, state.rememberedAt!), `${stage}小圆点应该贴在记下的点上`).toBeLessThanOrEqual(1);
      expect.soft(state.visibleSprites, '长按往场景里加了 sprite（长按图钉回来了？）').toBe(before.visibleSprites);
    }
    const note = `记下的点离按住的位置 ${gapPx(after.rememberedAt!, spot.at).toFixed(2)} px，小圆点离它 ${gapPx(after.dotAt!, after.rememberedAt!).toFixed(2)} px，相机转了 ${angleDeg(before.quaternion, after.quaternion).toFixed(4)}°`;
    console.log(`[长按 pivot] ${note}`);
    test.info().annotations.push({ type: '左键长按实测', description: note });
    return after.remembered!;
  });

  // 三、记着的时候：右键、中键、测量态左键在空白处按住，都不该取消；导航态左键在空白处长按才取消
  if (empty) {
    for (const button of ['right', 'middle'] as const) {
      await test.step(`导航态${BUTTON_NAME[button]}在空白处长按：不取消记住的旋转中心，画面不动`, async () => {
        const before = await readViewState(page);
        const { holding, after } = await longPress(page, empty.x, empty.y, button);
        expectViewStill(before, holding, `导航态${BUTTON_NAME[button]}在空白处按住时`);
        expectViewStill(before, after, `导航态${BUTTON_NAME[button]}在空白处松手后`);
        expect(after.remembered, `导航态${BUTTON_NAME[button]}在空白处长按不该动记住的旋转中心`).toEqual(remembered);
      });
    }

    await test.step('距离测量态左键在空白处按住：相机不动，不取消记住的旋转中心', async () => {
      await setToolMode(page, 'xeokit_measure_distance');
      await page.waitForTimeout(300);
      const before = await readViewState(page);
      const { holding } = await longPress(page, empty.x, empty.y, 'left');
      expectViewStill(before, holding, '测量态在空白处按住时');
      expect(holding.remembered, '测量态在空白处按住被当成了长按，取消了记住的旋转中心').toEqual(remembered);
      await setToolMode(page, 'none');
      await page.waitForTimeout(300);
      expect((await readViewState(page)).remembered, '测量态那次按住之后记住的旋转中心不该变').toEqual(remembered);
    });

    await test.step('导航态左键在空白处长按：取消记住的旋转中心，小圆点消失，画面不动', async () => {
      const before = await readViewState(page);
      const { holding, after } = await longPress(page, empty.x, empty.y, 'left');
      expectViewStill(before, holding, '导航态左键在空白处按住时');
      expectViewStill(before, after, '导航态左键在空白处松手后');
      expect(after.remembered, '在空白处长按之后不该还记着旋转中心').toBeNull();
      expect(after.dotAt, '在空白处长按之后小圆点应该消失').toBeNull();
    });
  }

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
