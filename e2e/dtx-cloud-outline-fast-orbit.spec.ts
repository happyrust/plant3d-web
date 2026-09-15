/**
 * 快速拖动 orbit 时，云线轮廓必须**每一帧都真的画在画面上**——实机走查的自动化版（云线方案 §21 的收尾验收）。
 *
 * 跟 `dtx-cloud-outline-camera-motion` 的分工：那条用慢速 orbit 盯「几何是按本帧相机重建的」这条机制，
 * 判据停在 NDC 包围盒；这条把手速拉到实机快拖的量级（单帧转角中位 3°、峰值 30° 以上，比慢速用例高一个
 * 数量级），并且**直接读帧缓冲**——画面上到底还看不看得见云线，不再靠推断。
 *
 * 为什么要自己读帧缓冲：`page.screenshot` 会等页面稳定，截到的永远是「相机停下后又渲染的那一帧」，
 * 拖动中的画面它根本截不到（改前的代码用截图法也是绿的）。所以这里包住 `renderer.render`，在
 * `queueMicrotask` 里（本次 rAF 回调整段跑完之后、浏览器合成清掉 drawing buffer 之前）用 `gl.readPixels`
 * 把这一帧的成品像素读回来。
 *
 * 怎么判「看得见」：不数全画面的红——demo 构件本身是偏红的浅色、右上角 ViewportGizmo 还有个纯红的 X 轴小球，
 * 数出来的数跟云线没关系。改成**沿轮廓自己的折线采样**：把这一帧交给 renderer 的那份几何投影成屏幕坐标，
 * 画完再回到这些位置上看像素红不红，命中率就是「这条线画出来了没有」。轮廓被自身光晕压淡的地方
 * （≈244,132,132）也照样算红，而 demo 构件最红也只到 r-g≈77，够不着门槛。
 *
 * 两条对照兜住这把尺子本身：
 *  - 删掉云线后按**最后一份几何**的同一批位置再采样，命中率必须掉到近 0（证明量的是线，不是背景）；
 *  - 把工具层几何改回**渲染之后**重建（即 44530e4 之前的顺序），同样的快拖必须拍到整段落在画面外的帧
 *    （证明这条用例测得动）。
 *
 * 跑法：`npx @playwright/test test e2e/dtx-cloud-outline-fast-orbit.spec.ts`（primitives demo，不依赖后端）。
 * 加 `--headed` 就是一个真开着的 Chrome 窗口在拖。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { DEMO_URL, createCloud, waitForDemoReady } from './helpers/cloudOutlineScene';
import { fastOrbitSweeps, flickOrbit, nudgeCamera, type CanvasRect } from './helpers/dtxFastOrbit';

type MotionFrame = {
  phase: string;
  /** 本帧渲染用的相机世界位置 */
  camPos: [number, number, number];
  /** 本帧画出去的那份轮廓几何是按哪个相机位置重建的（null = 还没重建过） */
  overlayCamPos: [number, number, number] | null;
  /** 画之前量的：轮廓当前几何在本帧相机下与视锥 [-1,1]³ 有交集 */
  onScreen: boolean;
  /** 轮廓折线在画面内的采样点数（0 = 这一帧它整段不在画面上） */
  samples: number;
  /** 其中落在红像素上的点数 */
  hits: number;
  /** hits / samples */
  hitRatio: number;
  /** 这一帧用的是删云线前缓存的那份几何（只出现在删除后的对照阶段） */
  cached: boolean;
  /** 相对上一帧，相机绕 target 转过的角度（度）——手速的客观刻度 */
  orbitDeg: number;
};

const SHOT_DIR = join('e2e', 'screenshots', 'cloud-fast-orbit');

test.use({ viewport: { width: 1400, height: 900 } });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

/**
 * 在页面里挂帧级探针：每帧记下「画之前这份几何在哪」与「画之后那些位置上的像素红不红」。
 * `stale = true` 时顺手把几何重建挪回渲染之后，复现 44530e4 之前的帧序（负对照用）。
 */
async function installFramebufferProbe(page: Page, opts: { stale?: boolean } = {}) {
  await page.evaluate(({ stale }) => {
    const viewer = (window as any).__dtxViewer;
    const tools = (window as any).__viewerTools;
    const renderer = viewer.renderer;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const canvas = renderer.domElement as HTMLCanvasElement;

    const frames: unknown[] = [];
    const shots: { frame: number; png: string }[] = [];
    const probe = { frames, shots, phase: 'idle', wantShots: 0, shotMinDeg: 3, shotOnlyBlank: false };
    (window as any).__cloudFastOrbitProbe = probe;

    let overlayCamPos: number[] | null = null;
    const origUpdate = tools.updateOverlayPositions;
    tools.updateOverlayPositions = function patchedUpdateOverlayPositions(...args: unknown[]) {
      const result = origUpdate.apply(tools, args);
      overlayCamPos = viewer.camera.position.toArray();
      return result;
    };

    /** 采样点上限：折线点数远不止这些，均匀抽稀就够判「线在不在」 */
    const MAX_SAMPLES = 240;
    let lastPositions: number[] | null = null;

    /**
     * 画之前量这一帧交给 renderer 的那份几何：还在不在视锥里、折线落在哪些像素上。
     * 云线被删掉之后（对照阶段）退回最后一份几何，好在同一批位置上复量一次。
     */
    const measureOutline = (camera: any) => {
      // three 在 render 内部才结算 matrixWorld，这里先自己算一次，拿到的就是本帧真正用于投影的那个矩阵
      camera.updateMatrixWorld();
      const live: number[] = tools.debugCloudOutlines()[0]?.worldPositions ?? [];
      let cached = false;
      let pts = live;
      if (live.length > 0) lastPositions = live;
      else if (lastPositions) { pts = lastPositions; cached = true; }
      if (pts.length === 0) return { onScreen: false, samples: [] as number[], cached };

      const w = canvas.width;
      const h = canvas.height;
      const e = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements;
      const count = Math.floor(pts.length / 3);
      const stride = Math.max(1, Math.ceil(count / MAX_SAMPLES));
      const samples: number[] = [];
      let box: [number, number, number, number, number, number] | null = null;
      let behind = false;
      for (let p = 0; p < count; p += 1) {
        const i = p * 3;
        const x = pts[i]!;
        const y = pts[i + 1]!;
        const z = pts[i + 2]!;
        const clipW = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
        if (clipW <= 0) { behind = true; continue; }
        const nx = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / clipW;
        const ny = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / clipW;
        const nz = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) / clipW;
        if (!box) box = [nx, nx, ny, ny, nz, nz];
        else {
          box[0] = Math.min(box[0], nx); box[1] = Math.max(box[1], nx);
          box[2] = Math.min(box[2], ny); box[3] = Math.max(box[3], ny);
          box[4] = Math.min(box[4], nz); box[5] = Math.max(box[5], nz);
        }
        if (p % stride !== 0) continue;
        // readPixels 的原点在左下，NDC 的 y 也朝上，直接线性映射即可
        const px = Math.round((nx * 0.5 + 0.5) * w);
        const py = Math.round((ny * 0.5 + 0.5) * h);
        if (px >= 1 && px < w - 1 && py >= 1 && py < h - 1) samples.push(px, py);
      }
      const onScreen = !behind && !!box
        && box[1] >= -1 && box[0] <= 1 && box[3] >= -1 && box[2] <= 1 && box[5] >= -1 && box[4] <= 1;
      return { onScreen, samples, cached };
    };

    const toPng = (buf: Uint8Array, w: number, h: number): string => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y += 1) {
        // readPixels 是自下而上的，写进 ImageData 时翻过来
        const src = (h - 1 - y) * w * 4;
        img.data.set(buf.subarray(src, src + w * 4), y * w * 4);
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    };

    let buf = new Uint8Array(0);
    let lastDir: [number, number, number] | null = null;
    let readScheduled = false;

    const origRender = renderer.render.bind(renderer);
    renderer.render = (scene: any, camera: any) => {
      if (camera !== viewer.camera) return origRender(scene, camera);

      // 「画之前」的三项必须在 origRender 之前量：量的就是这一帧交出去的那份几何
      const measured = measureOutline(camera);
      const camPos = camera.position.toArray() as [number, number, number];
      const geomCamPos = overlayCamPos as [number, number, number] | null;

      const result = origRender(scene, camera);

      if (!readScheduled) {
        readScheduled = true;
        // 微任务跑在本次 rAF 回调整段结束之后、浏览器合成之前：那一刻 drawing buffer 里就是这一帧的成品
        queueMicrotask(() => {
          readScheduled = false;
          const w = canvas.width;
          const h = canvas.height;
          if (buf.length !== w * h * 4) buf = new Uint8Array(w * h * 4);
          const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);

          // 云线核心 #ef4444 ≈ (238,79,79)，被自身淡红光晕压过的地方 ≈ (244,132,132)，两种都算命中；
          // demo 构件是偏橙的浅红（r-g 最多 ~77），够不着 r-g > 90 这道门槛。容 ±1 像素的取整误差。
          const isRed = (px: number, py: number): boolean => {
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dx = -1; dx <= 1; dx += 1) {
                const i = ((py + dy) * w + (px + dx)) * 4;
                const r = buf[i]!;
                const g = buf[i + 1]!;
                const b = buf[i + 2]!;
                if (r > 190 && r - g > 90 && r - b > 90 && Math.abs(g - b) < 30) return true;
              }
            }
            return false;
          };
          let hits = 0;
          for (let s = 0; s + 1 < measured.samples.length; s += 2) {
            if (isRed(measured.samples[s]!, measured.samples[s + 1]!)) hits += 1;
          }
          const samples = measured.samples.length / 2;

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

          frames.push({
            phase: probe.phase,
            camPos,
            overlayCamPos: geomCamPos,
            onScreen: measured.onScreen,
            samples,
            hits,
            hitRatio: samples ? hits / samples : 0,
            cached: measured.cached,
            orbitDeg,
          });
          const wantThisOne = orbitDeg >= probe.shotMinDeg && (!probe.shotOnlyBlank || samples === 0);
          if (probe.wantShots > 0 && wantThisOne) {
            probe.wantShots -= 1;
            shots.push({ frame: frames.length - 1, png: toPng(buf, w, h) });
          }
        });
      }
      return result;
    };

    if (stale) {
      // 负对照：把「渲染之前重建几何」退回 44530e4 之前的顺序——渲染之前那一发变空转，真正的重建挪到渲染之后
      const beforeStale = tools.updateOverlayPositions;
      const staleRender = renderer.render;
      let pending = false;
      tools.updateOverlayPositions = function deferredUpdateOverlayPositions() {
        pending = true;
      };
      renderer.render = (scene: any, camera: any) => {
        const result = staleRender(scene, camera);
        if (pending && camera === viewer.camera) {
          pending = false;
          beforeStale.call(tools);
        }
        return result;
      };
    }
  }, { stale: opts.stale === true });
}

async function setPhase(page: Page, phase: string, shots?: { count: number; minDeg?: number; onlyBlank?: boolean }) {
  await page.evaluate(({ phase: p, shots: s }) => {
    const probe = (window as any).__cloudFastOrbitProbe;
    probe.phase = p;
    if (s) {
      probe.wantShots = s.count;
      probe.shotMinDeg = s.minDeg ?? 3;
      probe.shotOnlyBlank = s.onlyBlank === true;
    }
  }, { phase, shots });
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

async function readFrames(page: Page): Promise<MotionFrame[]> {
  return (await page.evaluate(() => (window as any).__cloudFastOrbitProbe.frames)) as MotionFrame[];
}

/** 把探针攒下的整帧画面落盘，供人眼复核（e2e/screenshots 不入库） */
async function saveShots(page: Page, prefix: string): Promise<string[]> {
  const shots = (await page.evaluate(() => (window as any).__cloudFastOrbitProbe.shots)) as { frame: number; png: string }[];
  if (shots.length === 0) return [];
  mkdirSync(SHOT_DIR, { recursive: true });
  return shots.map((shot) => {
    const file = join(SHOT_DIR, `${prefix}-frame-${String(shot.frame).padStart(3, '0')}.png`);
    writeFileSync(file, Buffer.from(shot.png.split(',')[1]!, 'base64'));
    return file;
  });
}

async function setUpCloudScene(page: Page): Promise<CanvasRect> {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await waitForDemoReady(page);
  await page.evaluate(() => (window as any).__viewerToolStore.clearAll());
  return createCloud(page);
}

/** 这一帧相机真的在动（排除松手后阻尼收尾的那几帧） */
function isMotion(f: MotionFrame): boolean {
  return f.orbitDeg > 0.05 && (f.phase === 'sweep' || f.phase === 'flick');
}

test.describe('DTX 云线轮廓 · 快速拖动 orbit', () => {
  test('快拖全程每一帧画面上都有云线，且几何都是按本帧相机重建的', async ({ page }) => {
    const rect = await setUpCloudScene(page);
    await installFramebufferProbe(page);

    await setPhase(page, 'sweep', { count: 2, minDeg: 3 });
    await fastOrbitSweeps(page, rect);
    await setPhase(page, 'flick', { count: 1, minDeg: 6 });
    await flickOrbit(page, rect);
    await setPhase(page, 'rest', { count: 1, minDeg: 0 });
    await page.waitForTimeout(900);

    const frames = await readFrames(page);
    expect(frames.length, '探针一帧都没记到（renderer.render 没被主相机调用？）').toBeGreaterThan(20);
    const motion = frames.filter(isMotion);
    expect(motion.length, '快拖没产生足够的运动帧，用例是空转的').toBeGreaterThan(25);

    const degs = motion.map((f) => f.orbitDeg).sort((a, b) => a - b);
    const peakDeg = degs[degs.length - 1]!;
    const medianDeg = degs[Math.floor(degs.length / 2)]!;
    expect(peakDeg, '拖得不够快，够不上「实机快拖」的量级').toBeGreaterThan(5);

    const ratios = motion.map((f) => f.hitRatio).sort((a, b) => a - b);
    const rest = frames[frames.length - 1]!;
    const invisible = motion.filter((f) => f.samples < 20 || f.hitRatio < 0.5);
    const offScreen = motion.filter((f) => !f.onScreen);
    const stale = motion.filter((f) => !f.overlayCamPos || dist(f.camPos, f.overlayCamPos) > 1e-6);

    const shotFiles = await saveShots(page, 'fixed');
    const summary = `运动帧 ${motion.length}；单帧转角 中位 ${medianDeg.toFixed(1)}° / 峰值 ${peakDeg.toFixed(1)}°；`
      + `折线采样命中率 最低 ${ratios[0]!.toFixed(2)} · 中位 ${ratios[Math.floor(ratios.length / 2)]!.toFixed(2)}`
      + `（静止 ${rest.hitRatio.toFixed(2)}，每帧 ${Math.min(...motion.map((f) => f.samples))}~${Math.max(...motion.map((f) => f.samples))} 个采样点）；`
      + `截帧 ${shotFiles.join(', ') || '无'}`;
    console.log(`[快拖实测] ${summary}`);
    test.info().annotations.push({ type: '快拖实测', description: summary });

    expect(
      invisible.length,
      `有 ${invisible.length}/${motion.length} 帧画面上看不到云线（折线经过的位置上没有红像素），例：${JSON.stringify(invisible[0])}`,
    ).toBe(0);
    expect(
      offScreen.length,
      `有 ${offScreen.length}/${motion.length} 帧轮廓几何整段落在视锥外，例：${JSON.stringify(offScreen[0])}`,
    ).toBe(0);
    expect(
      stale.length,
      `有 ${stale.length}/${motion.length} 帧画的是按别的相机摆的轮廓几何，例：${JSON.stringify(stale[0])}`,
    ).toBe(0);

    // 这把尺子量的确实是线不是背景：删掉云线，再按最后一份几何的同一批位置采样，命中率必须掉下去
    await setPhase(page, 'cleared');
    await page.evaluate(() => (window as any).__viewerToolStore.clearAll());
    await nudgeCamera(page, rect);
    const cleared = (await readFrames(page)).filter((f) => f.phase === 'cleared' && f.cached && f.samples >= 20);
    expect(cleared.length, '删掉云线后没量到对照帧').toBeGreaterThan(0);
    const clearedRatio = Math.max(...cleared.map((f) => f.hitRatio));
    console.log(`[对照] 删掉云线后同一批位置的命中率最高 ${clearedRatio.toFixed(2)}`);
    expect(clearedRatio, '删掉云线后那些位置上仍是红的——这把尺子量的不是云线').toBeLessThan(0.2);
  });

  test('负对照：几何改回渲染之后重建，同样的快拖必须拍到整段不在画面上的帧', async ({ page }) => {
    const rect = await setUpCloudScene(page);
    await installFramebufferProbe(page, { stale: true });

    await setPhase(page, 'sweep', { count: 2, minDeg: 3, onlyBlank: true });
    await fastOrbitSweeps(page, rect, 2);
    await setPhase(page, 'rest');
    await page.waitForTimeout(900);

    const frames = await readFrames(page);
    const shotFiles = await saveShots(page, 'stale');
    const motion = frames.filter(isMotion);
    expect(motion.length, '负对照也得真拖起来').toBeGreaterThan(10);

    const gone = motion.filter((f) => !f.onScreen && f.samples === 0);
    const summary = `运动帧 ${motion.length}，其中 ${gone.length} 帧轮廓整段不在画面上；截帧 ${shotFiles.join(', ') || '无'}`;
    console.log(`[负对照实测] ${summary}`);
    test.info().annotations.push({ type: '负对照实测', description: summary });

    expect(
      gone.length,
      '旧帧序（渲染之后才重建几何）竟然每一帧都还画在画面里——探针或拖动路径失效了，正向那条用例已不足为凭',
    ).toBeGreaterThan(0);
  });
});
