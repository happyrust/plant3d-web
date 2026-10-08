/**
 * 长按设旋转中心（`DynamicPivotController`）在真实模型上的交互回归：
 * - 导航态（`toolMode === 'none'`）左 / 右 / 中键长按，都把 orbit target 设到鼠标下的模型表面点；
 * - 长按不往场景里加任何 sprite（不再有长按图钉）；
 * - 距离测量态在拾取点上按住不动，orbit target 不动——测量选点不能被当成长按设 pivot、在拾取点上冒橙色图钉。
 *
 * 两种跑法：
 * - 缺省：与其它 live 型 e2e 同一态度，页面走 Playwright `baseURL` 的 Vite dev server，gen-model 在 `GEN_MODEL_V1_BASE_URL`
 *   （缺省 `http://127.0.0.1:8022`）且有 AvevaMarineSample；服务不在就跳过。
 * - `PIVOT_E2E_URL=<带 show_refno 的完整页面地址>`：直接打开已部署的站点，用它自己的后端，不探 gen-model。
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
const PROBE_OFFSETS: [number, number][] = [
  [0, 0], [0, 60], [60, 0], [-60, 0], [0, -60], [120, 40], [-120, -40], [40, 120], [-40, -120],
];
const BUTTON_NAME = { left: '左键', right: '右键', middle: '中键' } as const;

type MouseButton = keyof typeof BUTTON_NAME;
type Vec3 = [number, number, number];
type ViewState = {
  toolMode: string;
  target: Vec3;
  camera: Vec3;
  visibleSprites: number;
};

test.use({ viewport: { width: 1600, height: 900 } });
test.describe.configure({ timeout: 300_000 });

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
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
    const viewer = (window as any).__dtxViewer;
    let visibleSprites = 0;
    viewer.scene.traverseVisible((object: any) => {
      if (object.isSprite) visibleSprites += 1;
    });
    const t = viewer.controls.target;
    const c = viewer.camera.position;
    return {
      toolMode: (window as any).__viewerToolStore.toolMode.value,
      target: [t.x, t.y, t.z],
      camera: [c.x, c.y, c.z],
      visibleSprites,
    };
  });
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
  expect(loaded, `模型没加载起来（${DEPLOYED_URL || `gen-model ${GEN_MODEL_BASE}`}，show_refno=${SHOW_REFNO}）`).toBe(true);
  const bundle = await page.evaluate(() => [...document.scripts].map((s) => s.src).find((src) => /\/assets\/index-[^/]+\.js$/.test(src)) ?? 'vite dev');
  const bundleNote = `${bundle}${LOCAL_DIST ? `（本地构建 ${LOCAL_DIST}）` : ''}`;
  console.log(`[长按 pivot] 前端包 ${bundleNote}`);
  test.info().annotations.push({ type: '前端包', description: bundleNote });

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
  }, { message: 'show_refno 对焦后相机一直没停下来', timeout: 30_000 }).toBeLessThan(1e-6);
}

/** 右键松手会弹右键菜单、测量态松手算一次选点，松手后都用 Escape 收掉 */
async function longPress(page: Page, x: number, y: number, button: MouseButton, shot?: string): Promise<ViewState> {
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.waitForTimeout(HOLD_MS);
  const holding = await readViewState(page);
  if (shot) await test.info().attach(shot, { body: await page.screenshot(), contentType: 'image/png' });
  await page.mouse.up({ button });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return holding;
}

/** 相机不动、画面不变，画布中心的射线仍打在原命中点上，但 target 已离开表面：长按若设了 pivot，target 必然跳回命中点 */
async function liftTargetTowardCamera(page: Page, lift: number): Promise<void> {
  await page.evaluate((d) => {
    const viewer = (window as any).__dtxViewer;
    const controls = viewer.controls;
    const dir = controls.target.clone().sub(viewer.camera.position).normalize();
    controls.target.addScaledVector(dir, -d);
    controls.update();
  }, lift);
}

test('长按设旋转中心：导航态左 / 右 / 中键都设到命中点且不出图钉，测量态按住不挪旋转中心', async ({ page }) => {
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
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;

  // 命中后 OrbitControls 让相机看向命中点，此后命中点就在画布中心
  const hit = await test.step('导航态左键：在画布中心附近长按出一个命中点，不出图钉', async () => {
    await setToolMode(page, 'none');
    for (const [dx, dy] of PROBE_OFFSETS) {
      const before = await readViewState(page);
      const holding = await longPress(page, cx + dx, cy + dy, 'left');
      expect.soft(holding.visibleSprites, '长按往场景里加了 sprite（长按图钉回来了？）').toBe(before.visibleSprites);
      if (distance(before.target, holding.target) > 1e-6 * distance(before.camera, before.target)) return holding.target;
    }
    throw new Error('画布中心附近几处导航态左键长按都没挪动旋转中心：长按设 pivot 失效，或模型不在视口里');
  });

  const lift = 0.1 * distance((await readViewState(page)).camera, hit);

  for (const button of ['left', 'right', 'middle'] as const) {
    await test.step(`导航态${BUTTON_NAME[button]}长按：旋转中心回到命中点，不出图钉`, async () => {
      await setToolMode(page, 'none');
      await liftTargetTowardCamera(page, lift);
      const before = await readViewState(page);
      expect(distance(before.target, hit), 'target 没挪离命中点，这一步验不出东西').toBeGreaterThan(lift / 2);
      const holding = await longPress(page, cx, cy, button, button === 'left' ? '导航态左键按住' : undefined);
      expect.soft(distance(holding.target, hit), `导航态${BUTTON_NAME[button]}长按没把旋转中心设到命中点`).toBeLessThan(lift * 0.01);
      expect.soft(holding.visibleSprites, '长按往场景里加了 sprite（长按图钉回来了？）').toBe(before.visibleSprites);
    });
  }

  await test.step('距离测量态左键在拾取点上按住：旋转中心不动', async () => {
    await setToolMode(page, 'none');
    await liftTargetTowardCamera(page, lift);
    await setToolMode(page, 'xeokit_measure_distance');
    await page.waitForTimeout(300);
    const before = await readViewState(page);
    const holding = await longPress(page, cx, cy, 'left', '距离测量态左键按住');
    expect(holding.toolMode).toBe('xeokit_measure_distance');
    expect(distance(holding.target, before.target), '测量态按住拾取点被当成了长按设 pivot，旋转中心被挪到拾取点').toBeLessThan(lift * 0.01);
    await setToolMode(page, 'none');
  });

  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
