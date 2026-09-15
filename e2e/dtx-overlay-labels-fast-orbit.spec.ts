/**
 * 快速拖动 orbit 时，浮层三兄弟——**文字框（`.dtx-anno-label`）、图钉（`.dtx-anno-marker`）、
 * 三维标注标签（CSS2D `.annotation-label`）**——必须帧帧贴着本帧相机，不许甩尾。
 *
 * 为什么单开一条：§21 修的是云线轮廓（three 几何，先渲染再重建就会画上一帧的那份）。这三样都是 **DOM**，
 * 不经 WebGL 帧缓冲，`gl.readPixels` 看不见它们，得换一把尺子——比「DOM 上写的坐标」与「用本帧相机
 * 投影它自己的世界锚点算出来的坐标」差多少像素。
 *
 * 判据里自带标尺：同一帧再用**上一帧的相机**投一次（`errPrev`）。它就是「假如这一样东西晚一帧」的
 * 后果，快拖时是几十像素；真实误差 `errNow` 若贴着 0，就等于证明了它们跟的是本帧相机。不必把代码
 * 改坏再跑一遍。
 *
 * 结论（2026-09-15 实测，见方案 §23）：三样都已经是本帧的。图钉与文字框由 `updateOverlayPositions`
 * 定位，§21 已经把它整体提到渲染之前；CSS2D 标签虽然仍在 `renderer.render` 之后调，但它只写 DOM
 * transform，与 canvas 在同一帧一起合成，用的也是同一个相机位姿——「排在渲染之后」对 DOM 浮层
 * 不构成晚一帧。这条用例把这个结论钉住。
 *
 * 跑法：`npx @playwright/test test e2e/dtx-overlay-labels-fast-orbit.spec.ts`（primitives demo，不依赖后端）。
 */
import { expect, test, type Page } from '@playwright/test';

import { DEMO_URL, findPickablePoint, waitForDemoReady } from './helpers/cloudOutlineScene';
import { fastOrbitSweeps, fastPan, flickOrbit, type CanvasRect } from './helpers/dtxFastOrbit';

/** 一帧里，某个浮层元素的实际落点与「本帧相机 / 上一帧相机」两种算法的偏差（overlay 像素） */
type ItemError = { id: string; errNow: number; errPrev: number | null };

type LabelFrame = {
  phase: string;
  /** 相对上一帧，相机绕 target 转过的角度（度） */
  orbitDeg: number;
  /** 相对上一帧，相机世界位置挪了多远（pan 阶段 orbitDeg 近 0，靠这个判「在动」） */
  camStep: number;
  items: ItemError[];
};

test.use({ viewport: { width: 1400, height: 900 } });
test.describe.configure({ timeout: 180_000 });

/**
 * 在页面里挂帧级探针：每帧结束时（`queueMicrotask`，本次 rAF 回调整段跑完、浏览器合成之前）读一遍
 * 三个浮层元素写在 DOM 上的坐标，和本帧 / 上一帧相机各算一次的期望值比。
 */
async function installLabelProbe(page: Page) {
  await page.evaluate(() => {
    type ItemErrorLike = { id: string; errNow: number; errPrev: number | null };

    const viewer = (window as any).__dtxViewer;
    const store = (window as any).__viewerToolStore;
    const renderer = viewer.renderer;
    const canvas = viewer.canvas as HTMLCanvasElement;

    const frames: unknown[] = [];
    const probe = { frames, phase: 'idle' };
    (window as any).__cloudLabelProbe = probe;

    /** 世界点 → overlay 像素，与 useDtxTools 的 worldToOverlay 同一套算法 */
    const project = (e: number[], world: number[]) => {
      const [x, y, z] = world as [number, number, number];
      const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
      if (w <= 0) return null;
      return {
        ndcX: (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w,
        ndcY: (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w,
      };
    };

    const viewProjOf = (camera: any): number[] => {
      camera.updateMatrixWorld();
      return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements.slice();
    };

    const px = (value: string): number => Number.parseFloat(value) || 0;

    /** CSS2DRenderer 写的是 `translate(-50%,-50%) translate(Xpx,Ypx)`，把后面那对数抠出来 */
    const parseCss2dTransform = (transform: string): { x: number; y: number } | null => {
      const all = [...transform.matchAll(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/g)];
      const last = all[all.length - 1];
      return last ? { x: Number(last[1]), y: Number(last[2]) } : null;
    };

    let lastViewProj: number[] | null = null;
    let lastDir: [number, number, number] | null = null;
    let lastCamPos: [number, number, number] | null = null;
    let readScheduled = false;

    const origRender = renderer.render.bind(renderer);
    renderer.render = (scene: any, camera: any) => {
      if (camera !== viewer.camera) return origRender(scene, camera);
      const viewProj = viewProjOf(camera);
      const prevViewProj = lastViewProj;
      const camPos = camera.position.toArray() as [number, number, number];
      const result = origRender(scene, camera);

      if (!readScheduled) {
        readScheduled = true;
        queueMicrotask(() => {
          readScheduled = false;
          const canvasRect = canvas.getBoundingClientRect();
          const overlay = document.querySelector('.dtx-anno-marker')?.parentElement ?? null;
          const overlayRect = overlay?.getBoundingClientRect() ?? canvasRect;
          const offX = canvasRect.left - overlayRect.left;
          const offY = canvasRect.top - overlayRect.top;

          /** overlay 定位的浮层（图钉 / 文字框）：DOM 上的 left/top 对期望投影 */
          const overlayItem = (id: string, el: HTMLElement | null, world: number[] | null): ItemErrorLike | null => {
            if (!el || !world) return null;
            const actual = { x: px(el.style.left), y: px(el.style.top) };
            const toPixels = (e: number[] | null) => {
              const p = e ? project(e, world) : null;
              return p ? {
                x: (p.ndcX * 0.5 + 0.5) * canvasRect.width + offX,
                y: (-p.ndcY * 0.5 + 0.5) * canvasRect.height + offY,
              } : null;
            };
            const now = toPixels(viewProj);
            const prev = toPixels(prevViewProj);
            if (!now) return null;
            return {
              id,
              errNow: Math.hypot(now.x - actual.x, now.y - actual.y),
              errPrev: prev ? Math.hypot(prev.x - actual.x, prev.y - actual.y) : null,
            };
          };

          /** CSS2D 标签：它按 renderer 自己的尺寸算像素，原点在画布左上，不带 overlay 偏移 */
          const css2dItem = (id: string, el: HTMLElement | null, world: number[] | null): ItemErrorLike | null => {
            if (!el || !world) return null;
            const actual = parseCss2dTransform(el.style.transform);
            if (!actual) return null;
            const toPixels = (e: number[] | null) => {
              const p = e ? project(e, world) : null;
              return p ? {
                x: (p.ndcX * 0.5 + 0.5) * canvas.clientWidth,
                y: (-p.ndcY * 0.5 + 0.5) * canvas.clientHeight,
              } : null;
            };
            const now = toPixels(viewProj);
            const prev = toPixels(prevViewProj);
            if (!now) return null;
            return {
              id,
              errNow: Math.hypot(now.x - actual.x, now.y - actual.y),
              errPrev: prev ? Math.hypot(prev.x - actual.x, prev.y - actual.y) : null,
            };
          };

          const record = store.annotations.value[0] ?? null;
          const labelWorld: number[] | null = record
            ? (record.labelWorldPos ?? [record.worldPos[0] + 0.9, record.worldPos[1] + 0.6, record.worldPos[2] + 0.7])
            : null;
          const leader = (window as any).__cloudLabelProbeLeader ?? null;

          const items = [
            overlayItem('图钉', document.querySelector<HTMLElement>('.dtx-anno-marker'), record?.worldPos ?? null),
            overlayItem('文字框', document.querySelector<HTMLElement>('.dtx-anno-label'), labelWorld),
            css2dItem('三维标签', document.querySelector<HTMLElement>('.annotation-label'), leader),
          ].filter((item): item is ItemErrorLike => item !== null);

          const target = viewer.controls.target;
          const dx = camPos[0] - target.x;
          const dy = camPos[1] - target.y;
          const dz = camPos[2] - target.z;
          const len = Math.hypot(dx, dy, dz) || 1;
          const dir: [number, number, number] = [dx / len, dy / len, dz / len];
          let orbitDeg = 0;
          if (lastDir) {
            const dot = Math.min(1, Math.max(-1, dir[0] * lastDir[0] + dir[1] * lastDir[1] + dir[2] * lastDir[2]));
            orbitDeg = (Math.acos(dot) * 180) / Math.PI;
          }
          lastDir = dir;
          const camStep = lastCamPos
            ? Math.hypot(camPos[0] - lastCamPos[0], camPos[1] - lastCamPos[1], camPos[2] - lastCamPos[2])
            : 0;
          lastCamPos = camPos;

          frames.push({ phase: probe.phase, orbitDeg, camStep, items });
        });
      }

      lastViewProj = viewProj;
      return result;
    };
  });
}

async function setPhase(page: Page, phase: string) {
  await page.evaluate((p) => { (window as any).__cloudLabelProbe.phase = p; }, phase);
}

/** 文字批注：进 annotation 模式点一下构件，浮层里就有了一枚图钉 + 一张文字框 */
async function createTextAnnotation(page: Page): Promise<CanvasRect> {
  const target = await findPickablePoint(page);
  await page.evaluate(() => (window as any).__viewerToolStore.setToolMode('annotation'));
  await page.waitForTimeout(400);
  const anchor = await findPickablePoint(page);
  await page.mouse.click(anchor.x, anchor.y);
  await page.waitForFunction(() => (window as any).__viewerToolStore.annotations.value.length === 1, null, { timeout: 10_000 });
  await page.evaluate(() => (window as any).__viewerToolStore.setToolMode('none'));
  await page.waitForTimeout(400);
  void target;
  return anchor.rect;
}

/** 三维标注系统的 CSS2D 标签：挂在文字批注锚点旁边一条引线上 */
async function createLeaderAnnotation(page: Page) {
  const ok = await page.evaluate(() => {
    const system = (window as any).__viewerContext?.annotationSystem?.value;
    const record = (window as any).__viewerToolStore.annotations.value[0];
    const viewer = (window as any).__dtxViewer;
    if (!system || !record || !viewer) return false;
    const Vector3 = viewer.camera.position.constructor as new (x: number, y: number, z: number) => any;
    const [x, y, z] = record.worldPos as [number, number, number];
    const textPosition = [x + 1.6, y + 1.2, z + 0.8] as [number, number, number];
    system.createLeaderAnnotation('e2e-fast-orbit-leader', {
      anchor: new Vector3(x, y, z),
      textPosition: new Vector3(...textPosition),
      text: '快拖标签',
    });
    (window as any).__cloudLabelProbeLeader = textPosition;
    return true;
  });
  expect(ok, '三维标注系统没挂上，建不出 CSS2D 标签').toBe(true);
  await page.waitForFunction(() => !!document.querySelector('.annotation-label'), null, { timeout: 10_000 });
}

function stats(values: number[]): { max: number; median: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { max: sorted[sorted.length - 1] ?? 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0 };
}

test('DTX 浮层 · 快拖时图钉 / 文字框 / 三维标签都贴着本帧相机', async ({ page }) => {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await waitForDemoReady(page);
  await page.evaluate(() => (window as any).__viewerToolStore.clearAll());

  const rect = await createTextAnnotation(page);
  await createLeaderAnnotation(page);
  await installLabelProbe(page);

  await setPhase(page, 'sweep');
  await fastOrbitSweeps(page, rect);
  await setPhase(page, 'flick');
  await flickOrbit(page, rect);
  await setPhase(page, 'pan');
  await fastPan(page, rect);
  await setPhase(page, 'rest');
  await page.waitForTimeout(900);

  const frames = (await page.evaluate(() => (window as any).__cloudLabelProbe.frames)) as LabelFrame[];
  const motion = frames.filter((f) => f.camStep > 1e-4 && f.phase !== 'rest');
  const panning = motion.filter((f) => f.phase === 'pan');
  expect(motion.length, '快拖没产生足够的运动帧，用例是空转的').toBeGreaterThan(30);
  expect(Math.max(...motion.map((f) => f.orbitDeg)), '转得不够快').toBeGreaterThan(5);
  expect(panning.length, '平移那一段没跑起来（右键 pan 被别的手势吃了？）').toBeGreaterThan(8);

  const ids = ['图钉', '文字框', '三维标签'];
  const measured = ids.map((id) => {
    const pick = (fs: LabelFrame[], key: 'errNow' | 'errPrev') =>
      fs.flatMap((f) => f.items.filter((i) => i.id === id).map((i) => (key === 'errNow' ? i.errNow : i.errPrev ?? 0)));
    return { id, count: pick(motion, 'errNow').length, now: stats(pick(motion, 'errNow')), prevPan: stats(pick(panning, 'errPrev')) };
  });

  const summary = `运动帧 ${motion.length}（其中平移 ${panning.length}）；`
    + measured.map((m) => `${m.id}：本帧相机 中位 ${m.now.median.toFixed(2)}px / 最大 ${m.now.max.toFixed(2)}px，`
      + `平移段换上一帧相机算 中位 ${m.prevPan.median.toFixed(1)}px`).join('｜');
  console.log(`[浮层快拖实测] ${summary}`);
  test.info().annotations.push({ type: '浮层快拖实测', description: summary });

  for (const m of measured) {
    expect(m.count, `${m.id} 一帧都没量到（DOM 没找着？）`).toBeGreaterThan(30);
    // 标尺先立住：同一帧改用上一帧相机要差出好几像素，这条判据才分得出「晚一帧」
    expect(
      m.prevPan.median,
      `${m.id} 在平移段用上一帧相机算也只差 ${m.prevPan.median.toFixed(1)}px——手速不够，判据分不出「晚一帧」`,
    ).toBeGreaterThan(6);
    expect(
      m.now.max,
      `${m.id} 最大偏差 ${m.now.max.toFixed(2)}px：它没跟上本帧相机（同一批帧用上一帧相机算是 ${m.prevPan.median.toFixed(1)}px）`,
    ).toBeLessThan(2);
  }
});

