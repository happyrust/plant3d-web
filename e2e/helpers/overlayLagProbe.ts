/**
 * 「浮层有没有晚一帧」的帧级探针：给 demo 与真实模型两条用例共用。
 *
 * 量法：每帧结束时（`queueMicrotask`，本次 rAF 回调整段跑完、浏览器合成之前）读浮层元素**写在 DOM 上的
 * 坐标**，与「用本帧相机投影它自己的世界锚点」算出来的期望值比（与 `useDtxTools.worldToOverlay` 同一套
 * 算法；CSS2D 那类解析 `translate(Xpx,Ypx)`）。
 *
 * 判据自带标尺：同一帧再用**上一帧的相机**算一次（`errPrev`）——那就是「假如它晚一帧」的后果，
 * 不必把代码改坏再跑一遍。
 *
 * 覆盖四类：批注图钉 `.dtx-anno-marker`、批注文字框 `.dtx-anno-label`、三维标注 CSS2D 标签
 * `.annotation-label`、点集标签 `.ptset-label`（后者的 DOM 与世界点都从 `ptsetVis.visualObjects` 取）。
 */
import { expect, type Page } from '@playwright/test';

import { findPickablePoint } from './cloudOutlineScene';

/** 一帧里，某个浮层元素的实际落点与「本帧相机 / 上一帧相机」两种算法的偏差（overlay 像素） */
export type ItemError = { id: string; errNow: number; errPrev: number | null };

export type LabelFrame = {
  phase: string;
  /** 相对上一帧，相机绕 target 转过的角度（度） */
  orbitDeg: number;
  /** 相对上一帧，相机世界位置挪了多远（平移段 orbitDeg 近 0，靠这个判「在动」） */
  camStep: number;
  items: ItemError[];
};

export const OVERLAY_ITEM_IDS = ['图钉', '文字框', '三维标签', '点集标签'] as const;

export async function installLabelProbe(page: Page) {
  await page.evaluate(() => {
    type ItemErrorLike = { id: string; errNow: number; errPrev: number | null };

    const viewer = (window as any).__dtxViewer;
    const store = (window as any).__viewerToolStore;
    const renderer = viewer.renderer;
    const canvas = viewer.canvas as HTMLCanvasElement;

    const frames: unknown[] = [];
    const probe = { frames, phase: 'idle' };
    (window as any).__cloudLabelProbe = probe;

    /** 世界点 → NDC */
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

    /**
     * 三维标注的 CSS2D 标签挂在 `annotationGroup` 下，组自己带变换（真实项目里是 mm→m + recenter），
     * 所以锚点要读 `getWorldPosition`——拿创建时给的那个局部坐标去投影会差出几百像素。
     */
    const Vector3 = viewer.camera.position.constructor as new (x: number, y: number, z: number) => any;
    const tmpWorld = new Vector3(0, 0, 0);
    const findCss2dLabel = () => {
      let found: any = null;
      viewer.scene.traverse((o: any) => {
        if (found) return;
        if (o.element?.classList?.contains('annotation-label')) found = o;
      });
      return found;
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

          /**
           * overlay 定位的浮层（图钉 / 文字框 / 点集标签）：DOM 上的 left/top 对期望投影。
           * 偏移按元素自己那个 overlay 容器算——点集标签挂的容器与批注浮层不是同一个。
           */
          const overlayItem = (id: string, el: HTMLElement | null, world: number[] | null, yOffset = 0): ItemErrorLike | null => {
            if (!el || !world) return null;
            const overlayRect = el.parentElement?.getBoundingClientRect() ?? canvasRect;
            const offX = canvasRect.left - overlayRect.left;
            const offY = canvasRect.top - overlayRect.top;
            const actual = { x: px(el.style.left), y: px(el.style.top) };
            const toPixels = (e: number[] | null) => {
              const p = e ? project(e, world) : null;
              return p ? {
                x: (p.ndcX * 0.5 + 0.5) * canvasRect.width + offX,
                y: (-p.ndcY * 0.5 + 0.5) * canvasRect.height + offY + yOffset,
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
          const css2dObject = findCss2dLabel();
          const css2dWorld = css2dObject
            ? (() => { const p = css2dObject.getWorldPosition(tmpWorld); return [p.x, p.y, p.z]; })()
            : null;
          // 点集标签：worldPos 与 DOM 元素都在 visualObjects 里；它写 top 时额外抬了 10px
          const ptsetObjects = [...((window as any).__viewerContext?.ptsetVis?.value?.visualObjects?.value?.values?.() ?? [])] as {
            labelDiv?: HTMLElement; worldPos: number[];
          }[];

          const items = [
            overlayItem('图钉', document.querySelector<HTMLElement>('.dtx-anno-marker'), record?.worldPos ?? null),
            overlayItem('文字框', document.querySelector<HTMLElement>('.dtx-anno-label'), labelWorld),
            css2dItem('三维标签', (css2dObject?.element as HTMLElement | undefined) ?? null, css2dWorld),
            ...ptsetObjects.map((obj) => overlayItem('点集标签', obj.labelDiv ?? null, obj.worldPos, -10)),
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

export async function setLabelPhase(page: Page, phase: string) {
  await page.evaluate((p) => { (window as any).__cloudLabelProbe.phase = p; }, phase);
}

export async function readLabelFrames(page: Page): Promise<LabelFrame[]> {
  return (await page.evaluate(() => (window as any).__cloudLabelProbe.frames)) as LabelFrame[];
}

/** 文字批注：进 annotation 模式点一下构件，浮层里就有了一枚图钉 + 一张文字框 */
export async function createTextAnnotation(page: Page) {
  await page.evaluate(() => (window as any).__viewerToolStore.setToolMode('annotation'));
  await page.waitForTimeout(400);
  const anchor = await findPickablePoint(page);
  await page.mouse.click(anchor.x, anchor.y);
  await page.waitForFunction(() => (window as any).__viewerToolStore.annotations.value.length === 1, null, { timeout: 10_000 });
  await page.evaluate(() => (window as any).__viewerToolStore.setToolMode('none'));
  await page.waitForTimeout(400);
  return anchor.rect;
}

/** 三维标注系统的 CSS2D 标签：挂在文字批注锚点旁边一条引线上 */
export async function createLeaderAnnotation(page: Page) {
  const ok = await page.evaluate(() => {
    const system = (window as any).__viewerContext?.annotationSystem?.value;
    const record = (window as any).__viewerToolStore.annotations.value[0];
    const viewer = (window as any).__dtxViewer;
    if (!system || !record || !viewer) return false;
    const Vector3 = viewer.camera.position.constructor as new (x: number, y: number, z: number) => any;
    const [x, y, z] = record.worldPos as [number, number, number];
    system.createLeaderAnnotation('e2e-fast-orbit-leader', {
      anchor: new Vector3(x, y, z),
      textPosition: new Vector3(x + 1.6, y + 1.2, z + 0.8),
      text: '快拖标签',
    });
    return true;
  });
  expect(ok, '三维标注系统没挂上，建不出 CSS2D 标签').toBe(true);
  await page.waitForFunction(() => !!document.querySelector('.annotation-label'), null, { timeout: 10_000 });
}

/**
 * 点集标签（`.ptset-label`）：真实点集要后端算，demo 里喂一份合成响应走**同一条**渲染路径
 * （`renderPtset` → `appendEntry` → `updateLabelPositions`）。点按 `scenePt = gm · (pt · unitFactor)`
 * 反推，落在批注锚点旁边，确保在相机前方。
 */
export async function createSyntheticPtset(page: Page) {
  const count = await page.evaluate(() => {
    const ptsetVis = (window as any).__viewerContext?.ptsetVis?.value;
    const record = (window as any).__viewerToolStore.annotations.value[0];
    const viewer = (window as any).__dtxViewer;
    if (!ptsetVis || !record || !viewer) return 0;
    const Matrix4 = viewer.camera.matrixWorld.constructor as new () => any;
    const Vector3 = viewer.camera.position.constructor as new (x: number, y: number, z: number) => any;
    const gm = (window as any).__dtxLayer?.getGlobalModelMatrix?.() ?? null;
    const inverse = new Matrix4();
    if (gm) inverse.copy(gm).invert();
    const toLocal = (scene: [number, number, number]) => {
      const v = new Vector3(scene[0], scene[1], scene[2]).applyMatrix4(inverse);
      return [v.x, v.y, v.z] as [number, number, number];
    };
    const [x, y, z] = record.worldPos as [number, number, number];
    ptsetVis.setPanelContext('e2e-fast-orbit');
    ptsetVis.renderPtset('e2e_fast_orbit_ptset', {
      success: true,
      refno: 'e2e_fast_orbit_ptset',
      ptset: [
        { number: 1, pt: toLocal([x + 0.8, y, z]), dir: [0, 0, 1], pbore: 0, pconnect: '' },
        { number: 2, pt: toLocal([x, y + 0.8, z]), dir: [0, 0, 1], pbore: 0, pconnect: '' },
        { number: 3, pt: toLocal([x, y, z + 0.8]), dir: [0, 0, 1], pbore: 0, pconnect: '' },
      ],
      world_transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      unit_info: { source_unit: 'm', target_unit: 'm', conversion_factor: 1 },
    });
    return ptsetVis.visualObjects.value.size as number;
  });
  expect(count, '点集标签没渲染出来').toBeGreaterThan(0);
  await page.waitForFunction(() => document.querySelectorAll('.ptset-label').length > 0, null, { timeout: 5_000 });
}

function stats(values: number[]): { max: number; median: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { max: sorted[sorted.length - 1] ?? 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0 };
}

export type ItemMeasurement = {
  id: string;
  count: number;
  now: { max: number; median: number };
  prevPan: { max: number; median: number };
};

export function measureItems(motion: LabelFrame[], panning: LabelFrame[], ids: readonly string[]): ItemMeasurement[] {
  return ids.map((id) => {
    const pick = (fs: LabelFrame[], key: 'errNow' | 'errPrev') =>
      fs.flatMap((f) => f.items.filter((i) => i.id === id).map((i) => (key === 'errNow' ? i.errNow : i.errPrev ?? 0)));
    return { id, count: pick(motion, 'errNow').length, now: stats(pick(motion, 'errNow')), prevPan: stats(pick(panning, 'errPrev')) };
  });
}

export function describeMeasurements(measured: ItemMeasurement[]): string {
  return measured.map((m) => `${m.id}：本帧相机 中位 ${m.now.median.toFixed(2)}px / 最大 ${m.now.max.toFixed(2)}px，`
    + `平移段换上一帧相机算 中位 ${m.prevPan.median.toFixed(1)}px`).join('｜');
}

/** 逐项断言：本帧误差贴着 0，而同一批帧「晚一帧」会差出好几像素（标尺先立住，判据才有分辨力） */
export function expectNoLag(measured: ItemMeasurement[], minFrames: number) {
  for (const m of measured) {
    expect(m.count, `${m.id} 量到的帧太少（DOM 没找着？）`).toBeGreaterThan(minFrames);
    expect(
      m.prevPan.median,
      `${m.id} 在平移段用上一帧相机算也只差 ${m.prevPan.median.toFixed(1)}px——手速不够，判据分不出「晚一帧」`,
    ).toBeGreaterThan(6);
    expect(
      m.now.max,
      `${m.id} 最大偏差 ${m.now.max.toFixed(2)}px：它没跟上本帧相机（同一批帧用上一帧相机算是 ${m.prevPan.median.toFixed(1)}px）`,
    ).toBeLessThan(2);
  }
}
