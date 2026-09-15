/**
 * 快拖 orbit 的输入驱动：给「相机运动中浮层还跟不跟得上」这类用例共用。
 *
 * 要点是**每一步都是一整跳**（`mouse.move` 不给 steps）、步间只等一帧——Playwright 默认的插值移动
 * 会把一次拖动摊成很多小步，手速反而比真人慢，测不出快拖下的问题。
 */
import type { Page } from '@playwright/test';

export type CanvasRect = { left: number; top: number; width: number; height: number };

/** 快速来回拖 orbit：每步约 0.76 个画布宽 / 10、间隔约 16ms，比人手快拖还快一截 */
export async function fastOrbitSweeps(page: Page, rect: CanvasRect, sweeps = 4, stepsPerSweep = 10) {
  const y = rect.top + rect.height * 0.76;
  const xLeft = rect.left + rect.width * 0.12;
  const xRight = rect.left + rect.width * 0.88;
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    const forward = sweep % 2 === 0;
    const from = forward ? xRight : xLeft;
    const dx = ((forward ? xLeft : xRight) - from) / stepsPerSweep;
    await page.mouse.move(from, y);
    await page.mouse.down();
    for (let i = 1; i <= stepsPerSweep; i += 1) {
      await page.mouse.move(from + dx * i, y + (i % 2 === 0 ? 26 : -26));
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
}

/** 甩一把：4 跳、每跳约 0.2 个画布宽、间隔 8ms，一帧能转十几度 */
export async function flickOrbit(page: Page, rect: CanvasRect) {
  const y = rect.top + rect.height * 0.62;
  const from = rect.left + rect.width * 0.85;
  const step = rect.width * 0.2;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i += 1) {
    await page.mouse.move(from - i * step, y - i * 40);
    await page.waitForTimeout(8);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/**
 * 快速来回平移（OrbitControls 默认右键 = pan）：orbit 只让画面绕着 target 转、靶心附近的东西几乎不动，
 * 而 pan 让所有东西整块跟着走，一帧能挪上百像素——要量「浮层晚没晚一帧」，这一档才拉得开差距。
 */
export async function fastPan(page: Page, rect: CanvasRect, sweeps = 3, stepsPerSweep = 6) {
  const y = rect.top + rect.height * 0.5;
  const xLeft = rect.left + rect.width * 0.14;
  const xRight = rect.left + rect.width * 0.86;
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    const forward = sweep % 2 === 0;
    const from = forward ? xRight : xLeft;
    const dx = ((forward ? xLeft : xRight) - from) / stepsPerSweep;
    await page.mouse.move(from, y);
    await page.mouse.down({ button: 'right' });
    for (let i = 1; i <= stepsPerSweep; i += 1) {
      await page.mouse.move(from + dx * i, y + (i % 2 === 0 ? 24 : -24));
      await page.waitForTimeout(12);
    }
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(150);
  }
}

/** 轻轻推一下相机，逼出几帧渲染（按需渲染的画布，不动就不画） */
export async function nudgeCamera(page: Page, rect: CanvasRect) {
  const x = rect.left + rect.width * 0.5;
  const y = rect.top + rect.height * 0.8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 4, y + 2);
  await page.mouse.move(x + 8, y + 4);
  await page.mouse.up();
  await page.waitForTimeout(500);
}
