/**
 * 快速拖动 / 平移相机时，浮层四件套——**文字框（`.dtx-anno-label`）、图钉（`.dtx-anno-marker`）、
 * 三维标注标签（CSS2D `.annotation-label`）、点集标签（`.ptset-label`）**——必须帧帧贴着本帧相机，不许甩尾。
 *
 * 为什么单开一条：§21 修的是云线轮廓（three 几何，先渲染再重建就会画上一帧的那份）。这四样都是 **DOM**，
 * 不经 WebGL 帧缓冲，`gl.readPixels` 看不见它们，得换一把尺子——比「DOM 上写的坐标」与「用本帧相机
 * 投影它自己的世界锚点算出来的坐标」差多少像素。尺子与判据都在 `helpers/overlayLagProbe.ts`。
 *
 * 结论（2026-09-15 实测，见方案 §23）：四样都已经是本帧的。图钉与文字框由 `updateOverlayPositions`
 * 定位，§21 已经把它整体提到渲染之前；CSS2D 标签与点集标签虽然仍在 `renderer.render` 之后调，但它们
 * 只写 DOM，与 canvas 在同一帧一起合成、用的也是同一个相机位姿——「排在渲染之后」对 DOM 浮层
 * 不构成晚一帧。这条用例把这个结论钉住。
 *
 * 这条跑 primitives demo（不依赖后端）；真实模型 + 真实点集那一条在
 * `dtx-overlay-labels-real-model.spec.ts`。
 *
 * 跑法：`npx @playwright/test test e2e/dtx-overlay-labels-fast-orbit.spec.ts`，加 `--headed` 就是真开窗口。
 */
import { expect, test } from '@playwright/test';

import { DEMO_URL, waitForDemoReady } from './helpers/cloudOutlineScene';
import { fastOrbitSweeps, fastPan, flickOrbit } from './helpers/dtxFastOrbit';
import {
  OVERLAY_ITEM_IDS,
  createLeaderAnnotation,
  createSyntheticPtset,
  createTextAnnotation,
  describeMeasurements,
  expectNoLag,
  installLabelProbe,
  measureItems,
  readLabelFrames,
  setLabelPhase,
} from './helpers/overlayLagProbe';

test.use({ viewport: { width: 1400, height: 900 } });
test.describe.configure({ timeout: 180_000 });

test('DTX 浮层 · 快拖时图钉 / 文字框 / 三维标签 / 点集标签都贴着本帧相机', async ({ page }) => {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await waitForDemoReady(page);
  await page.evaluate(() => (window as any).__viewerToolStore.clearAll());

  const rect = await createTextAnnotation(page);
  await createLeaderAnnotation(page);
  await createSyntheticPtset(page);
  await installLabelProbe(page);

  await setLabelPhase(page, 'sweep');
  await fastOrbitSweeps(page, rect);
  await setLabelPhase(page, 'flick');
  await flickOrbit(page, rect);
  await setLabelPhase(page, 'pan');
  await fastPan(page, rect);
  await setLabelPhase(page, 'rest');
  await page.waitForTimeout(900);

  const frames = await readLabelFrames(page);
  const motion = frames.filter((f) => f.camStep > 1e-4 && f.phase !== 'rest');
  const panning = motion.filter((f) => f.phase === 'pan');
  expect(motion.length, '快拖没产生足够的运动帧，用例是空转的').toBeGreaterThan(30);
  expect(Math.max(...motion.map((f) => f.orbitDeg)), '转得不够快').toBeGreaterThan(5);
  expect(panning.length, '平移那一段没跑起来（右键 pan 被别的手势吃了？）').toBeGreaterThan(8);

  const measured = measureItems(motion, panning, OVERLAY_ITEM_IDS);
  const summary = `运动帧 ${motion.length}（其中平移 ${panning.length}）；${describeMeasurements(measured)}`;
  console.log(`[浮层快拖实测] ${summary}`);
  test.info().annotations.push({ type: '浮层快拖实测', description: summary });

  expectNoLag(measured, 30);
});
