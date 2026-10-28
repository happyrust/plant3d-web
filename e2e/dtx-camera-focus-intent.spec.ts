/**
 * 相机取景意图的回归守护（plant-ui `fix(focus)` 系列 `e9ef12c99` 的同构移植）。
 *
 * 治的是两件事：
 *  1. **飞行不可取消**：`DtxViewer.flyTo` 的 step 循环原来不存 raf 句柄，两次定位并发时两个循环同时
 *     lerp 同一台相机，落点由最后一帧的先后决定。修法是 `_flyRafId` + `cancelFlyTo()`，起新动画先撤旧的。
 *  2. **晚落地的取景抢相机**：范围查询 / 房间模型 / 批量加载这些异步路径互不相识，晚落地的那笔会把
 *     相机从用户最新那一下上拽走。修法是 `beginCameraIntent()` 拿戳、落地后 `isCameraIntentCurrent()` 核对。
 *
 * 为什么判据放在调度层而不是截图：Playwright 的 `page.screenshot` 会等页面稳定，截到的永远是
 * 「相机停下之后」的样子，取消与不取消都长得一样。所以这里直接看 `cancelAnimationFrame` 有没有被调到、
 * 以及相机最终落在谁的落点上。
 *
 * 注意别只比 raf 句柄：旧代码里两次 `flyTo` 各自 `requestAnimationFrame`，句柄本来就不一样，
 * 拿「句柄变了」当判据，把修复回退掉也照样绿（本文件写成后实测过）。真正的判据是 cancel 调用计数。
 *
 * 跑法：`npx @playwright/test test e2e/dtx-camera-focus-intent.spec.ts`（`dtx_demo=primitives`，不依赖后端）。
 */
import { expect, test, type Page } from '@playwright/test';

import { DEMO_URL, waitForDemoReady } from './helpers/cloudOutlineScene';

type Box6 = [number, number, number, number, number, number];

/**
 * 两个盒子。`BOX_A` 特意挑在 demo 初始相机对面：demo 场景加载后相机会自动 fit 到原点附近
 * （落点约 `40, 30, 40`），若 A 也用原点盒，飞行距离只有 0.3 量级，测不到「相机被挪动」。
 * A 与 B 的落点相距够远，才判得出相机最后被谁拽走。
 */
const BOX_A: Box6 = [-260, -260, -260, -200, -200, -200];
const BOX_B: Box6 = [200, 200, 200, 260, 260, 260];

type CamState = { pos: [number, number, number]; target: [number, number, number]; fly: number | null };

/** 读当前相机与飞行句柄（`_flyRafId` 非 null = 还有动画在跑）。 */
async function readCamera(page: Page): Promise<CamState> {
  return page.evaluate(() => {
    const dtx = (window as any).__dtxViewer;
    return {
      pos: dtx.camera.position.toArray() as [number, number, number],
      target: dtx.controls.target.toArray() as [number, number, number],
      fly: (dtx._flyRafId ?? null) as number | null,
    };
  });
}

/** 发一次 aabb 取景。走真实的 `cameraFlight.flyTo`（六个定位入口最后都落到这里）。 */
async function flyToBox(page: Page, box: Box6, durationSeconds: number) {
  await page.evaluate(
    ([aabb, dur]) => {
      (window as any).__xeokitViewer.cameraFlight.flyTo({ aabb, duration: dur, fit: true });
    },
    [box, durationSeconds] as const,
  );
}

/**
 * 某个盒子的期望落点。
 *
 * 不在这里重算 `computeFlyToPositionFromAabb` 的公式（重算就等于把被测逻辑抄一遍，公式改了两边一起错），
 * 而是让浏览器跑一次 `jumpTo`（duration 0，直接跳）把结果取出来当期望值。
 * 每次求完把相机还原到原处，免得影响后续断言。
 */
async function landingOf(page: Page, box: Box6): Promise<[number, number, number]> {
  return page.evaluate((aabb) => {
    const viewer = (window as any).__xeokitViewer;
    const dtx = (window as any).__dtxViewer;
    const pos = dtx.camera.position.clone();
    const target = dtx.controls.target.clone();
    viewer.cameraFlight.jumpTo({ aabb });
    const landing = dtx.camera.position.toArray() as [number, number, number];
    dtx.camera.position.copy(pos);
    dtx.controls.target.copy(target);
    dtx.controls.update();
    return landing;
  }, box);
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/**
 * 录屏必须关掉。仓里 `playwright.config.ts` 的 `video: 'retain-on-failure'` 要调 ffmpeg，
 * 而本机 `%LOCALAPPDATA%\ms-playwright` 只有 `.links`、没装 ffmpeg——context 收尾时等它等到超时，
 * 症状是「用例体 300ms 就跑完、`browserContext.close` 挂满 60s」，同目录下完全不碰 WebGL 的
 * `output-project-direct-entry` 也一样。`incremental-linkage-gen-model-v1.spec.ts:68` 早有同样的处理。
 */
test.use({ viewport: { width: 1400, height: 900 }, video: 'off' });

test.describe('相机取景意图', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
    await waitForDemoReady(page);
  });

  test.afterEach(async ({ page }) => {
    if (page.isClosed()) return;
    await page
      .evaluate(() => {
        const dtx = (window as any).__dtxViewer;
        dtx?.cancelFlyTo?.();
        dtx?.stop?.();
      })
      .catch(() => undefined);
  });
  test('在途飞行可取消：第二次定位撤掉第一次，落点是第二次的', async ({ page }) => {
    const landingA = await landingOf(page, BOX_A);
    const landingB = await landingOf(page, BOX_B);
    expect(dist(landingA, landingB), '两个盒子的落点要分得开，否则这条用例判不出东西').toBeGreaterThan(50);

    // 统计 cancelAnimationFrame 的真实调用：这是「旧循环被撤掉」最直接的证据。
    // 只比 raf 句柄不行——旧代码里两次 flyTo 各自 requestAnimationFrame，句柄本来就不一样，
    // 拿句柄不同当判据，回退修复也照样绿（实测过）。
    await page.evaluate(() => {
      const w = window as any;
      w.__cancelCount = 0;
      const orig = window.cancelAnimationFrame.bind(window);
      window.cancelAnimationFrame = (id: number) => {
        w.__cancelCount += 1;
        return orig(id);
      };
    });

    const idle = await readCamera(page);
    expect(idle.fly, '起始时不该有在途飞行').toBeNull();

    // A 的时长必须**长于** B：旧代码下两个 step 循环都在跑，最后一帧谁后到谁说了算。
    // 若 B 更长，B 天然是后结束者，落点仍是 B——用例就测不到「A 把相机拽回去」。
    await flyToBox(page, BOX_A, 2.0);
    const flyingA = await readCamera(page);
    expect(flyingA.fly, '第一次飞行应该真的在跑（raf 句柄非 null）').not.toBeNull();

    // 让它跑到中途再发第二次——太早发就等于没测到「打断」
    await page.waitForTimeout(400);
    const midwayA = await readCamera(page);
    expect(dist(midwayA.pos, idle.pos), 'A 应该已经把相机挪动了').toBeGreaterThan(1);
    expect(dist(midwayA.pos, landingA), 'A 此时不该已经到位（否则测不到打断）').toBeGreaterThan(1);

    const cancelBefore = await page.evaluate(() => (window as any).__cancelCount as number);
    await flyToBox(page, BOX_B, 0.6);
    const cancelAfter = await page.evaluate(() => (window as any).__cancelCount as number);
    expect(
      cancelAfter - cancelBefore,
      '发起第二次飞行时必须 cancelAnimationFrame 掉第一次的 raf（这是修复的核心动作）',
    ).toBeGreaterThanOrEqual(1);

    const flyingB = await readCamera(page);
    expect(flyingB.fly, '第二次飞行应该在跑').not.toBeNull();

    // 等过 A 原本的结束时刻（2.0s）再多留一点：若 A 的循环没被撤掉，它会在那一刻把相机拽回 A
    await page.waitForTimeout(2400);
    const settled = await readCamera(page);
    expect(settled.fly, '跑完后句柄应该清空').toBeNull();

    // 落点必须是 B 的
    const toB = dist(settled.pos, landingB);
    const toA = dist(settled.pos, landingA);
    expect(toB, `应落在 B 附近，实际 ${JSON.stringify(settled.pos)}`).toBeLessThan(2);
    expect(toB, `不该被 A 拽回去：到 B ${toB.toFixed(2)} / 到 A ${toA.toFixed(2)}`).toBeLessThan(toA);
  });

  test('cancelFlyTo 撤掉在途动画后相机停在原地，不再继续动', async ({ page }) => {
    await flyToBox(page, BOX_A, 1.5);
    await page.waitForTimeout(400);
    const before = await readCamera(page);
    expect(before.fly).not.toBeNull();

    await page.evaluate(() => {
      const w = window as any;
      w.__cancelCount = 0;
      const orig = window.cancelAnimationFrame.bind(window);
      window.cancelAnimationFrame = (id: number) => {
        w.__cancelCount += 1;
        return orig(id);
      };
      (window as any).__xeokitViewer.cameraFlight.cancel();
    });
    const afterCancel = await readCamera(page);
    expect(afterCancel.fly, 'cancel 之后不该还有句柄').toBeNull();
    expect(
      await page.evaluate(() => (window as any).__cancelCount as number),
      'cancel 必须真的调到 cancelAnimationFrame',
    ).toBeGreaterThanOrEqual(1);

    // 撤掉之后再等一段，相机必须一动不动
    await page.waitForTimeout(700);
    const later = await readCamera(page);
    expect(later.fly).toBeNull();
    expect(
      dist(later.pos, afterCancel.pos),
      `cancel 之后相机仍在动（${dist(later.pos, afterCancel.pos).toFixed(3)}），说明 step 循环没被真正撤掉`,
    ).toBeLessThan(0.01);
  });

  test('意图戳：新意图作废旧的，落地前核对得出来', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const mod = await import('/src/viewer/camera/cameraIntent.ts' as any);
      mod.__resetCameraIntentForTests();
      const a = mod.beginCameraIntent();
      const aValidAtBegin = mod.isCameraIntentCurrent(a);
      const b = mod.beginCameraIntent();
      const aValidAfterB = mod.isCameraIntentCurrent(a);
      const bValidAfterB = mod.isCameraIntentCurrent(b);
      // currentCameraIntent 不推进序号
      const peek1 = mod.currentCameraIntent();
      const peek2 = mod.currentCameraIntent();
      // supersedeCameraIntents 作废但不登记
      mod.supersedeCameraIntents();
      const bValidAfterSupersede = mod.isCameraIntentCurrent(b);
      const afterSupersede = mod.currentCameraIntent();
      return { a, b, aValidAtBegin, aValidAfterB, bValidAfterB, peek1, peek2, bValidAfterSupersede, afterSupersede };
    });

    expect(result.aValidAtBegin, '刚登记的戳应该有效').toBe(true);
    expect(result.b, '第二次登记必须拿到更大的戳').toBeGreaterThan(result.a);
    expect(result.aValidAfterB, '新意图必须作废旧意图').toBe(false);
    expect(result.bValidAfterB, '最新意图自身仍然有效').toBe(true);
    expect(result.peek1, 'currentCameraIntent 不该推进序号').toBe(result.peek2);
    expect(result.bValidAfterSupersede, 'supersede 必须作废在途意图').toBe(false);
    expect(result.afterSupersede, 'supersede 只撤销不登记：序号要往前走').toBeGreaterThan(result.b);
  });

  test('慢路径落地时意图已被顶掉：只装模型不动相机', async ({ page }) => {
    // 复刻 `useModelGeneration.showModelByRefnos` 的写法：await 之前盖戳，落地后核对。
    // 这里用一个可控的 Promise 当「慢路径」，中途插一次用户取景，验证守卫真的拦得住。
    const landingB = await landingOf(page, BOX_B);
    const landingA = await landingOf(page, BOX_A);

    const result = await page.evaluate(async (box) => {
      const mod = await import('/src/viewer/camera/cameraIntent.ts' as any);
      const viewer = (window as any).__xeokitViewer;
      mod.__resetCameraIntentForTests();

      // 慢路径开始：先盖戳，再去等（真实路径等的是几何落地）
      const stamp = mod.beginCameraIntent();
      await new Promise((r) => setTimeout(r, 300));

      // 期间用户又点了一次定位（走真实入口：登记新意图 + 飞）
      mod.beginCameraIntent();
      viewer.cameraFlight.flyTo({ aabb: box.user, duration: 0.5, fit: true });

      // 慢路径落地：核对戳，不该再动相机
      const allowed = mod.isCameraIntentCurrent(stamp);
      if (allowed) viewer.cameraFlight.flyTo({ aabb: box.stale, duration: 0.5, fit: true });
      return { stamp, allowed, current: mod.currentCameraIntent() };
    }, { user: BOX_A, stale: BOX_B });

    expect(result.allowed, '慢路径的戳应该已被用户的新取景顶掉').toBe(false);
    expect(result.current, '用户那次登记让序号往前走').toBeGreaterThan(result.stamp);

    await page.waitForTimeout(1000);
    const settled = await readCamera(page);
    expect(
      dist(settled.pos, landingA),
      `相机应停在用户那一下（A），实际 ${JSON.stringify(settled.pos)}；被慢路径拽到 B 就是守卫失效`,
    ).toBeLessThan(2);
    expect(dist(settled.pos, landingB), '不该落在慢路径的目标 B').toBeGreaterThan(50);
  });

  test('没有新意图插队时，慢路径正常取景', async ({ page }) => {
    const landingA = await landingOf(page, BOX_A);
    const result = await page.evaluate(async (box) => {
      const mod = await import('/src/viewer/camera/cameraIntent.ts' as any);
      const viewer = (window as any).__xeokitViewer;
      mod.__resetCameraIntentForTests();
      const stamp = mod.beginCameraIntent();
      await new Promise((r) => setTimeout(r, 300));
      const allowed = mod.isCameraIntentCurrent(stamp);
      if (allowed) viewer.cameraFlight.flyTo({ aabb: box, duration: 0.5, fit: true });
      return { allowed };
    }, BOX_A);

    expect(result.allowed, '没有新意图插队时守卫必须放行（否则定位会整体失效）').toBe(true);
    await page.waitForTimeout(900);
    const settled = await readCamera(page);
    expect(dist(settled.pos, landingA), '应落在取景目标上').toBeLessThan(2);
  });
});
