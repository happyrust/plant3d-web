/**
 * 尺寸只认主键，不拦别人的拖动（#205 第一步）。
 *
 * 尺寸层在画布上用捕获阶段接指针事件，接下来的就 `stopImmediatePropagation()`，相机收不到。它原先判断接不接时
 * 不看是哪个键、有没有键按着：右键、中键按在标注上相机动不了，用户尺寸的标签会被右键、中键拖走，创建过程中
 * 右键、中键单击算一次拾点，相机旋转经过标注时那几步移动被吃掉。
 *
 * 场景是 primitives demo，不依赖后端：一条用户线性尺寸（拾两点再放置），外加一条同一对点、摆在另一侧的只读外部尺寸。
 * 量法是真实的 `page.mouse` 输入加相机位姿，不比截图。
 *
 * 左键按在尺寸图形上的行为（创建中按住再拖、拖标签，相机都不动）由 `dtx-view-focus.spec.ts` 守着，这里只补单击选中。
 */
import { expect, test, type Page } from '@playwright/test';

import { DEMO_URL, waitForDemoReady } from './helpers/cloudOutlineScene';

type Pt = { x: number; y: number };
type Rect = { left: number; top: number; width: number; height: number };
type Pose = { pos: number[]; quat: number[]; target: number[] };
type Button = 'left' | 'right' | 'middle';
type Scene = {
  rect: Rect;
  /** 能拾到模型表面的一点（画布坐标） */
  surface: Pt;
  /** 没有模型、没有尺寸图形的一点，离两个标签都远 */
  empty: Pt;
  userId: string;
  base: Pose;
};

const READ_ONLY_ID = 'e2e-read-only';
/** 平移算数：观察中心挪动超过视距的这个比例。空白处同样的右键拖动约 0.12 */
const PAN_MIN = 0.03;
/** 缩放算数：视距变化超过这个比例。空白处同样的中键拖动约 0.06 */
const DOLLY_MIN = 0.02;

const dist = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const px = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

const readPose = (page: Page): Promise<Pose> => page.evaluate(() => {
  const viewer = (window as any).__dtxViewer;
  return {
    pos: viewer.camera.position.toArray(),
    quat: viewer.camera.quaternion.toArray(),
    target: viewer.controls.target.toArray(),
  };
});

/** 把相机摆回去。直接摆的相机尺寸层不知道，手动通知一次；再等惯性和布局停下来 */
async function setPose(page: Page, pose: Pose): Promise<void> {
  await page.evaluate((to) => {
    const w = window as any;
    const viewer = w.__dtxViewer;
    viewer.camera.position.fromArray(to.pos);
    viewer.controls.target.fromArray(to.target);
    viewer.controls.update();
    w.__viewerContext.dimensionSystem.value.notifyViewerChanged();
  }, pose);
  await page.waitForTimeout(700);
}

const sessionPhase = (page: Page): Promise<string> => page.evaluate(() => {
  const status = (window as any).__viewerContext.dimensionSystem.value.pointer.sessionStatus;
  return status ? `${status.kind}:${status.phase}` : '';
});

const userPlacement = (page: Page): Promise<unknown> => page.evaluate(
  () => (window as any).__viewerContext.dimensionSystem.value.document.state.records[0].placement,
);

/** 这条尺寸的标签中心（画布坐标）和大小，并确认中心那一点命中的就是它的标签 */
async function labelCentre(page: Page, id: string): Promise<Pt & { width: number; height: number }> {
  const label = await page.evaluate((dimensionId) => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    system.viewport.flushProjection?.();
    const bounds = system.viewport.getLayouts()
      .find((layout: any) => layout.dimensionId === dimensionId)?.labelBounds;
    if (!bounds) return null;
    const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const hit = system.viewport.hitTest([centre.x, centre.y], 6);
    return { ...centre, width: bounds.width, height: bounds.height, hitId: hit?.dimensionId ?? null, part: hit?.part ?? null };
  }, id);
  expect(label, `尺寸 ${id} 要排出标签`).not.toBeNull();
  expect({ hitId: label!.hitId, part: label!.part }, `标签中心命中的要是 ${id} 的标签`)
    .toEqual({ hitId: id, part: 'label' });
  return { x: label!.x, y: label!.y, width: label!.width, height: label!.height };
}

const overDimension = (page: Page, at: Pt): Promise<boolean> => page.evaluate(([x, y]) => {
  const system = (window as any).__viewerContext.dimensionSystem.value;
  system.viewport.flushProjection?.();
  return system.viewport.hitTest([x, y], 6) !== null;
}, [at.x, at.y] as const);

/** 在 at 按下 button，分 steps 步拖过 delta，松手，等惯性停下；返回相机整体动了多少 */
async function drag(page: Page, rect: Rect, at: Pt, button: Button, delta: [number, number], steps = 15) {
  const x = rect.left + at.x;
  const y = rect.top + at.y;
  await page.mouse.move(x - 3, y - 3);
  await page.waitForTimeout(80);
  await page.mouse.move(x, y);
  await page.waitForTimeout(150);
  const before = await readPose(page);
  await page.mouse.down({ button });
  await page.waitForTimeout(60);
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(x + (delta[0] * i) / steps, y + (delta[1] * i) / steps);
    await page.waitForTimeout(24);
  }
  await page.mouse.up({ button });
  await page.waitForTimeout(700);
  const end = await readPose(page);
  const viewDistance = dist(before.pos, before.target) || 1;
  return {
    /** 观察中心挪了多少，除以视距 */
    targetShift: dist(before.target, end.target) / viewDistance,
    /** 视距变成了原来的几倍 */
    distRatio: dist(end.pos, end.target) / viewDistance,
  };
}

/** 打开 demo，建一条用户线性尺寸，再登记一条同一对点、摆在另一侧的只读外部尺寸 */
async function openSceneWithDimensions(page: Page): Promise<Scene> {
  await page.goto(DEMO_URL);
  await waitForDemoReady(page);
  await page.waitForFunction(() => Boolean((window as any).__viewerContext?.dimensionSystem?.value));
  await page.locator('[data-ribbon-tab="view"]').first().click();
  await page.locator('[data-command="panel.dimension"]').first().click();
  await expect(page.getByTestId('dimension.create.linear')).toBeVisible();
  // 面板一开画布会缩，等它停下来再扫
  await page.waitForTimeout(800);

  const scan = await page.evaluate(() => {
    type Q = { x: number; y: number };
    const selection = (window as any).__xeokitViewer.__dtxSelection;
    const canvas = document.querySelector('canvas.viewer') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const uncovered = (p: Q) => document.elementFromPoint(rect.left + p.x, rect.top + p.y) === canvas;
    const surface: Q[] = [];
    const empties: Q[] = [];
    const steps = 20;
    for (let j = 3; j <= steps - 3; j += 1) {
      for (let i = 3; i <= steps - 3; i += 1) {
        const p = { x: Math.round((rect.width * i) / steps), y: Math.round((rect.height * j) / steps) };
        if (!uncovered(p)) continue;
        if (selection.pickPoint(p)) surface.push(p); else empties.push(p);
      }
    }
    // 拾点取屏幕上离得最远的一对；放置点取中点沿连线法向偏 70 px，哪一侧没被盖住用哪一侧
    let a = surface[0] ?? null;
    let b = surface[surface.length - 1] ?? null;
    for (const p of surface) {
      for (const q of surface) {
        if (a && b && Math.hypot(p.x - q.x, p.y - q.y) > Math.hypot(a.x - b.x, a.y - b.y)) { a = p; b = q; }
      }
    }
    let place: Q | null = null;
    if (a && b) {
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      for (const side of [1, -1]) {
        const candidate = {
          x: Math.round((a.x + b.x) / 2 - ((b.y - a.y) / length) * 70 * side),
          y: Math.round((a.y + b.y) / 2 + ((b.x - a.x) / length) * 70 * side),
        };
        const inside = candidate.x > 0 && candidate.y > 0 && candidate.x < rect.width && candidate.y < rect.height;
        if (inside && uncovered(candidate)) { place = candidate; break; }
      }
    }
    return { rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, a, b, place, empties };
  });
  expect(scan.a && scan.b && scan.place, '演示场景里要找得到两个拾点和一个放置点').toBeTruthy();
  const rect = scan.rect;

  await page.getByTestId('dimension.create.linear').click();
  for (const point of [scan.a!, scan.b!, scan.place!]) {
    await page.mouse.click(rect.left + point.x, rect.top + point.y);
    await page.waitForTimeout(350);
  }
  await expect.poll(() => page.evaluate(
    () => (window as any).__viewerContext.dimensionSystem.value.document.state.records.length,
  ), { message: '拾两点再放置，应该建出一条用户尺寸' }).toBe(1);

  const userId = await page.evaluate((readOnlyId) => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const record = system.document.state.records[0];
    system.replaceExternalSource('mbd', [{
      id: readOnlyId,
      source: 'mbd',
      sourceLabel: 'MBD',
      role: 'external',
      layout: {
        id: readOnlyId,
        kind: 'linear',
        role: 'external',
        labelPinned: false,
        a: record.a.snapshot,
        b: record.b.snapshot,
        placement: { ...record.placement, side: -record.placement.side },
      },
    }]);
    return record.id as string;
  }, READ_ONLY_ID);
  await page.waitForTimeout(600);

  const userLabel = await labelCentre(page, userId);
  const readOnlyLabel = await labelCentre(page, READ_ONLY_ID);
  let empty: Pt | null = null;
  for (const point of scan.empties) {
    if (point.x < 120 || point.y < 120 || point.x > rect.width - 260 || point.y > rect.height - 160) continue;
    if (px(point, userLabel) < 220 || px(point, readOnlyLabel) < 220) continue;
    if (await overDimension(page, point)) continue;
    empty = point;
    break;
  }
  expect(empty, '画布上要有一处没有模型、没有尺寸图形的空白').not.toBeNull();

  return { rect, surface: scan.a!, empty: empty!, userId, base: await readPose(page) };
}

test.use({ viewport: { width: 1600, height: 1000 } });
// 真实鼠标输入要一条一条量：同一个文件里的用例不并行，免得互相抢帧
test.describe.configure({ mode: 'default' });

test.describe('尺寸只认主键', () => {
  test('右键拖、中键拖从标签上起：相机照常平移、缩放，用户尺寸的标签不被拖走', async ({ page }) => {
    const scene = await openSceneWithDimensions(page);

    for (const [what, id] of [['只读尺寸', READ_ONLY_ID], ['用户尺寸', scene.userId]] as const) {
      const placementBefore = await userPlacement(page);

      await setPose(page, scene.base);
      const pan = await drag(page, scene.rect, await labelCentre(page, id), 'right', [150, 50]);
      expect(pan.targetShift, `右键从${what}的标签上起拖，相机应该平移`).toBeGreaterThan(PAN_MIN);

      await setPose(page, scene.base);
      const dolly = await drag(page, scene.rect, await labelCentre(page, id), 'middle', [0, 120]);
      expect(Math.abs(dolly.distRatio - 1), `中键从${what}的标签上起拖，相机应该缩放`).toBeGreaterThan(DOLLY_MIN);

      expect(await userPlacement(page), `右键、中键在${what}的标签上拖，用户尺寸的摆放不该变`).toEqual(placementBefore);
      expect(await sessionPhase(page), '右键、中键不该开出尺寸会话').toBe('');
    }

    // 主键照旧：单击只读尺寸的标签选中它，相机不动
    await setPose(page, scene.base);
    const label = await labelCentre(page, READ_ONLY_ID);
    const before = await readPose(page);
    await page.mouse.click(scene.rect.left + label.x, scene.rect.top + label.y);
    await page.waitForTimeout(400);
    expect(await page.evaluate(
      () => (window as any).__viewerContext.dimensionSystem.value.viewport.getSelection(),
    ), '主键单击标签应该选中这条尺寸').toBe(READ_ONLY_ID);
    const after = await readPose(page);
    expect(dist(before.pos, after.pos) / (dist(before.pos, before.target) || 1), '单击标签相机不该动').toBeLessThan(1e-6);
  });

  test('创建会话进行中：右键、中键单击不算拾点，右键拖、中键拖照常动相机', async ({ page }) => {
    const scene = await openSceneWithDimensions(page);
    const surface = { x: scene.rect.left + scene.surface.x, y: scene.rect.top + scene.surface.y };

    await page.getByTestId('dimension.create.linear').click();
    await expect.poll(() => sessionPhase(page)).toBe('linear:pick-first');

    for (const button of ['right', 'middle'] as const) {
      await page.mouse.click(surface.x, surface.y, { button });
      await page.waitForTimeout(400);
      expect(await sessionPhase(page), `${button} 单击构件表面不该算拾点`).toBe('linear:pick-first');
    }

    await setPose(page, scene.base);
    const pan = await drag(page, scene.rect, scene.empty, 'right', [150, 50]);
    expect(pan.targetShift, '创建中右键拖，相机应该平移').toBeGreaterThan(PAN_MIN);

    await setPose(page, scene.base);
    const dolly = await drag(page, scene.rect, scene.empty, 'middle', [0, 120]);
    expect(Math.abs(dolly.distRatio - 1), '创建中中键拖，相机应该缩放').toBeGreaterThan(DOLLY_MIN);
    expect(await sessionPhase(page), '右键、中键拖动不该推进会话').toBe('linear:pick-first');

    // 主键照旧拾点
    await setPose(page, scene.base);
    await page.mouse.click(surface.x, surface.y);
    await expect.poll(() => sessionPhase(page), { message: '主键单击构件表面应该拾到第一点' }).toBe('linear:pick-second');
    await page.getByTestId('dimension.cancel').click();
    await expect.poll(() => sessionPhase(page)).toBe('');
  });

  test('从空白处左键起拖旋转、光标横穿标签：移动事件一个都不被尺寸层吃掉', async ({ page }) => {
    const scene = await openSceneWithDimensions(page);
    await setPose(page, scene.base);
    const label = await labelCentre(page, READ_ONLY_ID);
    // 起拖点紧挨着标签、又不压着任何尺寸图形：相机一转标签会挪，离得远光标就追不上它。四个方向挑一个空着的
    let approach: { start: Pt; step: Pt } | null = null;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const reach = (dx === 0 ? label.height : label.width) / 2 + 14;
      const start = { x: label.x + dx * reach, y: label.y + dy * reach };
      if (await overDimension(page, start)) continue;
      approach = { start, step: { x: -dx * 2, y: -dy * 2 } };
      break;
    }
    expect(approach, '标签旁边要有一处不压尺寸图形的起拖点').not.toBeNull();
    const { start, step } = approach!;

    // 文档上的捕获监听数全部移动；画布上最后注册的监听只数得到尺寸层放过来的
    await page.evaluate(() => {
      const w = window as any;
      w.__e2ePointerMoves = { all: 0, passed: 0, armed: false };
      document.addEventListener('pointermove', () => { if (w.__e2ePointerMoves.armed) w.__e2ePointerMoves.all += 1; }, true);
      (document.querySelector('canvas.viewer') as HTMLCanvasElement)
        .addEventListener('pointermove', () => { if (w.__e2ePointerMoves.armed) w.__e2ePointerMoves.passed += 1; });
    });

    const x = scene.rect.left + start.x;
    const y = scene.rect.top + start.y;
    await page.mouse.move(x - 3, y - 3);
    await page.waitForTimeout(80);
    await page.mouse.move(x, y);
    await page.waitForTimeout(150);
    const before = await readPose(page);
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(60);
    await page.evaluate(() => { (window as any).__e2ePointerMoves.armed = true; });
    let stepsOverDimension = 0;
    for (let i = 1; i <= 40; i += 1) {
      const cursor = { x: start.x + step.x * i, y: start.y + step.y * i };
      await page.mouse.move(scene.rect.left + cursor.x, scene.rect.top + cursor.y);
      await page.waitForTimeout(24);
      if (await overDimension(page, cursor)) stepsOverDimension += 1;
    }
    const moves = await page.evaluate(() => ({ ...(window as any).__e2ePointerMoves }));
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(400);
    const after = await readPose(page);

    expect(stepsOverDimension, '拖动途中光标要真的压到过尺寸图形，否则这条什么都没量').toBeGreaterThan(0);
    expect(moves.all, '拖动期间应该有移动事件').toBeGreaterThanOrEqual(40);
    expect(moves.passed, '尺寸层没有会话，别人的拖动它不该拦').toBe(moves.all);
    expect(dist(before.pos, after.pos) / (dist(before.pos, before.target) || 1), '相机应该转起来了').toBeGreaterThan(0.05);
  });
});
