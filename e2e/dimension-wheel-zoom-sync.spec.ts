import { expect, test } from '@playwright/test';

import { DEMO_URL, waitForDemoReady } from './helpers/cloudOutlineScene';

/**
 * 滚轮缩放之后，尺寸层要按新相机重排。
 *
 * OrbitControls 在滚轮事件的回调里就把相机推到位了，宿主渲染循环在本帧 `controls.update()` 前后量不出差。
 * 只在量得出差的帧上同步尺寸层的话，滚轮缩放之后标注的 LOD、避让和标签位置会停在缩放之前，
 * 要等下一次拖动旋转才更新。primitives demo 不依赖后端；`__dimensionFrameStats` 只有 dev 构建有。
 */
test('a wheel zoom alone re-lays the dimension layer out for the new camera', async ({ page }) => {
  await page.goto(DEMO_URL);
  await waitForDemoReady(page);
  await page.waitForFunction(() => Boolean((window as any).__viewerContext?.dimensionSystem?.value));
  // 等装载、自动 fit 和首轮布局安静下来。
  await page.waitForTimeout(1_500);

  const canvas = await page.evaluate(() => {
    const rect = (document.querySelector('canvas.viewer') as HTMLCanvasElement).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(canvas.x, canvas.y);

  const cameraDistance = () => page.evaluate(() => {
    const viewer = (window as any).__dtxViewer;
    return viewer.camera.position.distanceTo(viewer.controls.target) as number;
  });
  const before = await cameraDistance();
  await page.evaluate(() => (window as any).__dimensionFrameStats.reset());

  for (let notch = 0; notch < 6; notch += 1) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(30);
  }
  expect(await cameraDistance()).toBeLessThan(before);

  // 没有别的输入：只靠这几下滚轮，尺寸层就该跑过一次全量布局。
  await expect.poll(
    () => page.evaluate(() => (window as any).__dimensionFrameStats.summary().layoutFrames as number),
  ).toBeGreaterThan(0);

  // 相机停下之后尺寸层也要安静下来：同步不能自己把重绘转起来。
  await page.waitForTimeout(1_500);
  await page.evaluate(() => (window as any).__dimensionFrameStats.reset());
  await page.waitForTimeout(1_000);
  expect(
    await page.evaluate(() => (window as any).__dimensionFrameStats.summary().frames as number),
  ).toBe(0);
});
