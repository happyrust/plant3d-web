/**
 * 视图操作焦点的回归守护：旋转 / 滚轮 / 中键缩放 / 平移以谁为焦点，长按记旋转中心，工具模式不被误伤。
 *
 * 被测约定（`DynamicPivotController` + `DynamicPivotCanvasBinding`）：
 *  1. 焦点优先级：光标悬停的构件 → 画面里的选中构件中心 → 长按记住的旋转中心（只管旋转）→ 光标那条视线上
 *     和观察中心同深度的点（只管缩放）。都没有就是 OrbitControls 原样：绕画面正中转。
 *  2. 原地操作：按下、起拖、松手都不瞬移。平移拖动不带惯性，旋转的惯性保留。
 *  3. 长按（导航态在构件上按住 300ms 不动）只记旋转中心，画面不动；在空白处长按取消；工具模式下不生效。
 *
 * 量法：全部用真实输入（`page.mouse` / `page.keyboard`），盯住一个世界点，看它在屏幕上挪了多少像素。
 * 不比截图——截图要等页面稳定才截，起拖那一下的跳变和松手后的惯性都截不到。只有「悬停不变色」比的是截图。
 *
 * 两个容易踩的坑：
 *  - 相机位姿不能逐位比。`controls.update()` 每帧把位置重算一遍，末位会抖（1e-15 量级），
 *    「相机不动」一律按容差判（`POSE_EPS` / `ANGLE_EPS_DEG`）。
 *  - 标准视角故意把模型偏到画面右上、左下留空白。焦点要是落在画面正中，「绕焦点转」和「绕画面正中转」
 *    量出来一样，逻辑回退了也照样绿。
 *
 * 场景是 `dtx_demo=primitives`（9 个基本体），不依赖后端。读焦点走调试入口 `window.__dtxPivot`。
 *
 * 跑法：`npx @playwright/test test e2e/dtx-view-focus.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test';

import { waitForDemoReady } from './helpers/cloudOutlineScene';

const DEMO_URL = '/?output_project=AvevaMarineSample&dtx_demo=primitives&dtx_demo_count=9';

/** 焦点在屏幕上允许的漂移（像素），拖动中、松手后的惯性阶段、停稳后都算 */
const FOCUS_DRIFT_PX = 3;
/** 平移拖动中，抓住的点离光标允许的距离（像素） */
const PAN_LAG_PX = 8;
/** 平移松手后允许再滑多少（像素）：不带惯性，应该就是 0 */
const PAN_SLIDE_PX = 1;
/** 「画面不动」的容差（像素），只容浮点误差 */
const STILL_PX = 0.01;
/** 「相机不动」的容差：位置 / 观察中心的变化量除以视距 */
const POSE_EPS = 1e-9;
/** 「相机不转」的容差（度） */
const ANGLE_EPS_DEG = 1e-3;
/** 长按判定是 300ms，按 700ms 留足余量 */
const LONG_PRESS_MS = 700;

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];
type Box6 = [number, number, number, number, number, number];
type Pt = { x: number; y: number };
type Rect = { left: number; top: number; width: number; height: number };
type Pose = { pos: Vec3; quat: Quat; target: Vec3 };
type CameraSpot = { pos: Vec3; target: Vec3 };
/** 同一时刻读出来的一组状态：相机、要盯的世界点的屏幕位置、记住的旋转中心、小圆点的中心（画布坐标，不显示时为 null） */
type Snap = { pose: Pose; screens: Pt[]; remembered: Vec3 | null; dot: Pt | null };
type FocusUse = 'rotate' | 'pan' | 'dolly';
type Focus = { point: Vec3; source: 'hover' | 'selection' | 'remembered' | 'cursor'; objectId: string | null } | null;
type Button = 'left' | 'right' | 'middle';
type SceneObject = { id: string; min: Vec3; max: Vec3 };
type ScanResult = { hits: (Pt & { id: string })[]; empties: Pt[] };
type Scene = {
  rect: Rect;
  fov: number;
  /** 标准视角 */
  basePose: CameraSpot;
  /** 标准视角下相机的右方向 */
  right: Vec3;
  /** 标准视角下，观察中心那个深度上一个像素合多少世界长度 */
  unitsPerPx: number;
  /** 模型整体的中心 */
  center: Vec3;
  /** 悬停点：离画面正中最远的那个构件上的一点（画布坐标），和光标下拾到的世界点 */
  hover: { id: string; at: Pt; point: Vec3 };
  /** 另一个构件上的一点，用来单击选中；既不在画面正中，也离悬停点够远 */
  other: { id: string; at: Pt };
  /** 画布上一处空白 */
  empty: Pt;
};
type DragOptions = {
  at: Pt;
  button: Button;
  delta: [number, number];
  steps?: number;
  /** 按下后先停多久再拖（毫秒） */
  holdMs?: number;
  /** 松手后继续采样多久（毫秒），用来看惯性阶段 */
  tailMs?: number;
  shift?: boolean;
  /** 要盯的世界点 */
  track: Vec3[];
};
type DragRun = {
  before: Snap;
  afterHold: Snap | null;
  moving: (Snap & { cursor: Pt })[];
  beforeUp: Snap & { cursor: Pt };
  tail: Snap[];
  end: Snap;
};
type WheelRun = { before: Snap; steps: Snap[]; end: Snap };
type DimensionState = {
  active: boolean;
  records: number;
  placement: unknown;
  /** 第一条尺寸的标签中心（画布坐标），和那个位置命中的部位 */
  label: (Pt & { part: string | null }) | null;
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const px = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const round = (value: number, digits = 1): number => Math.round(value * 10 ** digits) / 10 ** digits;
const angleDeg = (a: Quat, b: Quat): number => {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
};
const angleBetweenDeg = (a: Vec3, b: Vec3): number =>
  (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;

/** 两个位姿差多少：位置 / 观察中心按视距归一，朝向按夹角，外加视距变成了原来的几倍 */
function poseDelta(a: Pose, b: Pose) {
  const distance = len(sub(a.pos, a.target)) || 1;
  return {
    pos: len(sub(a.pos, b.pos)) / distance,
    target: len(sub(a.target, b.target)) / distance,
    deg: angleDeg(a.quat, b.quat),
    distRatio: len(sub(b.pos, b.target)) / distance,
  };
}

function expectCameraStill(before: Pose, after: Pose, what: string): void {
  const delta = poseDelta(before, after);
  expect(delta.pos, `${what}：相机位置不该动`).toBeLessThan(POSE_EPS);
  expect(delta.target, `${what}：观察中心不该动`).toBeLessThan(POSE_EPS);
  expect(delta.deg, `${what}：相机不该转`).toBeLessThan(ANGLE_EPS_DEG);
}

/** 把实测数记到输出和用例注解里，跑完能直接读到每一项量出来是多少 */
function note(title: string, detail: string): void {
  const line = `${title}：${detail}`;
  console.log(`[视图焦点实测] ${line}`);
  test.info().annotations.push({ type: '视图焦点实测', description: line });
}

/**
 * 在页面里装一组读数函数（`window.__viewFocusProbe`）。只读状态、摆相机，不碰被测逻辑。
 *
 * 投影用相机当前的 position / quaternion 现算视图矩阵：`matrixWorld` 要等下一帧渲染才更新，
 * 拖动中读它会慢一帧。要向量 / 矩阵 / 包围盒实例时从现成对象上 clone，省得在页面里再 import 一份 three。
 */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    const dtx = w.__dtxViewer;
    const layer = w.__dtxLayer;
    const canvas = dtx.canvas as HTMLCanvasElement;
    const rect = () => canvas.getBoundingClientRect();
    const project = (point: number[]) => {
      const camera = dtx.camera;
      const view = camera.matrixWorld.clone().compose(camera.position, camera.quaternion, camera.scale).invert();
      const v = camera.position.clone().fromArray(point).applyMatrix4(view).applyMatrix4(camera.projectionMatrix);
      const r = rect();
      return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
    };
    const pose = () => ({
      pos: dtx.camera.position.toArray(),
      quat: dtx.camera.quaternion.toArray(),
      target: dtx.controls.target.toArray(),
    });
    const remembered = () => w.__dtxPivot.getRememberedPivot()?.toArray() ?? null;
    const dotCenter = () => {
      const el = document.querySelector('[data-testid="dtx-remembered-pivot"]');
      if (!el || getComputedStyle(el).display === 'none') return null;
      const box = el.getBoundingClientRect();
      const r = rect();
      return { x: box.left + box.width / 2 - r.left, y: box.top + box.height / 2 - r.top };
    };
    w.__viewFocusProbe = {
      rect: () => {
        const r = rect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      },
      fov: () => dtx.camera.fov,
      pose,
      // 关着阻尼 update：上一个手势没走完的惯性会被一次用掉并清零。所以外面要摆两遍，第二遍才落在准确的位置
      setPose: (pos: number[], target: number[]) => {
        dtx.cancelFlyTo?.();
        dtx.camera.position.fromArray(pos);
        dtx.controls.target.fromArray(target);
        const damping = dtx.controls.enableDamping;
        dtx.controls.enableDamping = false;
        dtx.controls.update();
        dtx.controls.enableDamping = damping;
      },
      focusAt: (x: number, y: number, use: string | null) => {
        const focus = w.__dtxPivot.resolveFocusPoint({ x, y }, use);
        return focus ? { point: focus.point.toArray(), source: focus.source, objectId: focus.objectId ?? null } : null;
      },
      onCanvas: (x: number, y: number) => {
        const r = rect();
        return document.elementFromPoint(r.left + x, r.top + y) === canvas;
      },
      objects: () => {
        const out: { id: string; min: number[]; max: number[] }[] = [];
        const box = layer.getBoundingBox().clone();
        for (const id of layer.getAllObjectIds()) {
          if (!layer.isObjectVisible(id)) continue;
          const found = layer.getObjectBoundingBoxInto(id, box);
          if (!found || found.isEmpty()) continue;
          out.push({ id, min: found.min.toArray(), max: found.max.toArray() });
        }
        return out;
      },
      // 扫一遍画布：哪些位置光标下有构件、哪些是空白（都避开浮在画布上的面板）
      scan: () => {
        const r = rect();
        const picker = w.__xeokitViewer.__dtxSelection;
        const hits: { x: number; y: number; id: string }[] = [];
        const empties: { x: number; y: number }[] = [];
        for (let j = 1; j < 16; j += 1) {
          for (let i = 1; i < 16; i += 1) {
            const x = Math.round((r.width * i) / 16);
            const y = Math.round((r.height * j) / 16);
            if (document.elementFromPoint(r.left + x, r.top + y) !== canvas) continue;
            const hit = picker.pickPoint({ x, y });
            if (hit) hits.push({ x, y, id: String(hit.objectId ?? '') });
            else empties.push({ x, y });
          }
        }
        return { hits, empties };
      },
      selected: () => [...(w.__xeokitViewer?.scene?.selectedObjectIds ?? [])],
      snap: (points: number[][]) => ({
        pose: pose(),
        screens: points.map(project),
        remembered: remembered(),
        dot: dotCenter(),
      }),
    };
  });
}

const probe = <T>(page: Page, method: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([name, list]) => (window as any).__viewFocusProbe[name](...list), [method, args] as const);
const snap = (page: Page, points: Vec3[] = []) => probe<Snap>(page, 'snap', points);
const readPose = (page: Page) => probe<Pose>(page, 'pose');
const readRect = (page: Page) => probe<Rect>(page, 'rect');
const focusAt = (page: Page, at: Pt, use: FocusUse | null = null) => probe<Focus>(page, 'focusAt', at.x, at.y, use);
const onCanvas = (page: Page, at: Pt) => probe<boolean>(page, 'onCanvas', at.x, at.y);
const selectedIds = (page: Page) => probe<string[]>(page, 'selected');
const scanCanvas = (page: Page) => probe<ScanResult>(page, 'scan');

/**
 * 等相机停稳。旋转带惯性，位姿是按指数衰减趋近终点的，不会「完全」不变，所以这里的门槛比 POSE_EPS 松：
 * 连续 quietMs 内相邻两次读数的变化都小到不影响像素级的量测（不到千分之一像素）就算稳。
 */
async function waitStable(page: Page, quietMs = 300, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  let last = await readPose(page);
  let quietFrom = Date.now();
  for (;;) {
    await page.waitForTimeout(50);
    const now = await readPose(page);
    const delta = poseDelta(last, now);
    last = now;
    if (delta.pos > 1e-6 || delta.target > 1e-6 || delta.deg > 1e-4) quietFrom = Date.now();
    else if (Date.now() - quietFrom >= quietMs) return;
    if (Date.now() - startedAt > timeoutMs) throw new Error('相机一直没有停稳');
  }
}

/** 把相机摆到指定位置，并清掉上一个手势留下的惯性。每一次量测前都从这里出发 */
async function resetPose(page: Page, spot: CameraSpot): Promise<void> {
  await waitStable(page);
  for (let i = 0; i < 2; i += 1) {
    await probe<void>(page, 'setPose', spot.pos, spot.target);
    await page.waitForTimeout(120);
  }
  await waitStable(page, 200);
}

/** 光标那条视线上、和观察中心同深度的点（空白处缩放的焦点）。按相机朝向和视角独立算，不问被测代码 */
function pointUnderCursor(scene: Scene, spot: CameraSpot, at: Pt): Vec3 {
  const forward = norm(sub(spot.target, spot.pos));
  const right = norm(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  const depth = len(sub(spot.target, spot.pos));
  const half = Math.tan(((scene.fov / 2) * Math.PI) / 180);
  const ndcX = (at.x / scene.rect.width) * 2 - 1;
  const ndcY = 1 - (at.y / scene.rect.height) * 2;
  const aspect = scene.rect.width / scene.rect.height;
  return add(add(spot.target, mul(right, ndcX * half * depth * aspect)), mul(up, ndcY * half * depth));
}

/** 把拖动方向翻到朝画布中心那一边，免得拖出画布、松手落在别的面板上 */
function inward(scene: Scene, from: Pt, delta: [number, number]): [number, number] {
  return [
    from.x > scene.rect.width / 2 ? -Math.abs(delta[0]) : Math.abs(delta[0]),
    from.y > scene.rect.height / 2 ? -Math.abs(delta[1]) : Math.abs(delta[1]),
  ];
}

/** 打开演示场景，摆到标准视角，找好悬停点 / 另一个构件 / 空白点 */
async function openScene(page: Page): Promise<Scene> {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await waitForDemoReady(page);
  await page.waitForFunction(
    () => !!(window as any).__dtxPivot && !!(window as any).__dtxViewer && !!(window as any).__dtxLayer,
    null,
    { timeout: 15_000 },
  );
  await installProbe(page);

  // 面板、工具条还在排版：画布尺寸连着两次读数一样才开始量
  let rect = await readRect(page);
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(300);
    const again = await readRect(page);
    const settled = again.left === rect.left && again.top === rect.top && again.width === rect.width && again.height === rect.height;
    rect = again;
    if (settled) break;
  }
  const fov = await probe<number>(page, 'fov');
  const objects = await probe<SceneObject[]>(page, 'objects');
  expect(objects.length, '演示场景里应该有好几个构件').toBeGreaterThan(2);

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const item of objects) {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i]!, item.min[i]!);
      max[i] = Math.max(max[i]!, item.max[i]!);
    }
  }
  const center = mul(add(min, max), 0.5);
  const distance = len(sub(max, min)) * 3.2;
  const toCamera = norm([-1, -1.2, 0.9]);
  const forward = mul(toCamera, -1);
  const right = norm(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  const visibleHeight = 2 * distance * Math.tan(((fov / 2) * Math.PI) / 180);
  const visibleWidth = visibleHeight * (rect.width / rect.height);
  // 相机往左下挪，模型就到了画面右上
  const shift = add(mul(right, -0.2 * visibleWidth), mul(up, -0.1 * visibleHeight));
  const basePose: CameraSpot = { pos: add(add(center, mul(toCamera, distance)), shift), target: add(center, shift) };
  await resetPose(page, basePose);

  expect(await selectedIds(page), '开始时不该有选中的构件').toEqual([]);
  expect((await snap(page)).remembered, '开始时不该有记住的旋转中心').toBeNull();

  // 每个构件包围盒中心的屏幕位置里，光标下确实拾得到这个构件的那些
  const mid: Pt = { x: rect.width / 2, y: rect.height / 2 };
  const screens = (await snap(page, objects.map((item) => mul(add(item.min, item.max), 0.5)))).screens;
  const candidates: { id: string; at: Pt; point: Vec3; off: number }[] = [];
  for (let i = 0; i < objects.length; i += 1) {
    const at: Pt = { x: Math.round(screens[i]!.x), y: Math.round(screens[i]!.y) };
    if (at.x < 20 || at.y < 20 || at.x > rect.width - 20 || at.y > rect.height - 20) continue;
    if (!(await onCanvas(page, at))) continue;
    const focus = await focusAt(page, at);
    if (focus?.source !== 'hover') continue;
    if (focus.objectId !== null && focus.objectId !== objects[i]!.id) continue;
    candidates.push({ id: objects[i]!.id, at, point: focus.point, off: px(at, mid) });
  }
  expect(candidates.length, '标准视角下至少要有两个能悬停到的构件').toBeGreaterThanOrEqual(2);
  candidates.sort((a, b) => b.off - a.off);
  const hover = candidates[0]!;
  const other = candidates
    .slice(1)
    .sort((a, b) => Math.min(b.off, px(b.at, hover.at)) - Math.min(a.off, px(a.at, hover.at)))[0]!;
  expect(hover.off, '悬停点要明显偏离画面正中，否则量不出「绕谁转」').toBeGreaterThan(100);
  expect(Math.min(other.off, px(other.at, hover.at)), '另一个构件要偏离画面正中、也要离悬停点够远').toBeGreaterThan(40);

  let empty: Pt | null = null;
  for (const [fx, fy] of [[0.2, 0.74], [0.16, 0.6], [0.26, 0.84], [0.12, 0.5], [0.3, 0.9]] as const) {
    const at: Pt = { x: Math.round(rect.width * fx), y: Math.round(rect.height * fy) };
    if (!(await onCanvas(page, at))) continue;
    if ((await focusAt(page, at, 'rotate')) === null) {
      empty = at;
      break;
    }
  }
  expect(empty, '标准视角下左下应该有一处空白').not.toBeNull();

  return {
    rect,
    fov,
    basePose,
    right,
    unitsPerPx: visibleHeight / rect.height,
    center,
    hover: { id: hover.id, at: hover.at, point: hover.point },
    other: { id: other.id, at: other.at },
    empty: empty!,
  };
}

/** 在画布上的一点按下再松开，中间不移动。holdMs 超过 300 就是长按 */
async function press(page: Page, scene: Scene, at: Pt, holdMs = 40, button: Button = 'left'): Promise<void> {
  const x = scene.rect.left + at.x;
  const y = scene.rect.top + at.y;
  await page.mouse.move(x - 3, y - 3);
  await page.waitForTimeout(80);
  await page.mouse.move(x, y);
  await page.waitForTimeout(150);
  await page.mouse.down({ button });
  await page.waitForTimeout(holdMs);
  await page.mouse.up({ button });
  await page.waitForTimeout(450);
}

/** 在 at 按下，按住不动 LONG_PRESS_MS，再拖一小段，松手；每个阶段记一笔状态。尺寸标注的用例用 */
async function holdThenDrag(page: Page, scene: Scene, at: Pt) {
  const x = scene.rect.left + at.x;
  const y = scene.rect.top + at.y;
  await page.mouse.move(x - 3, y - 3);
  await page.waitForTimeout(80);
  await page.mouse.move(x, y);
  await page.waitForTimeout(200);
  const before = await snap(page);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(LONG_PRESS_MS);
  const held = await snap(page);
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(x + 5 * i, y - 4 * i);
    await page.waitForTimeout(20);
  }
  const dragging = await snap(page);
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(600);
  const released = await snap(page);
  return { before, held, dragging, released };
}

/** 拖动：在 at 按下，分 steps 步挪 delta，松手后再盯 tailMs；每一步记一笔相机和被盯点的屏幕位置 */
async function drag(page: Page, scene: Scene, options: DragOptions): Promise<DragRun> {
  const { at, button, delta, steps = 20, holdMs = 0, tailMs = 1_500, shift = false, track } = options;
  const x0 = scene.rect.left + at.x;
  const y0 = scene.rect.top + at.y;
  await page.mouse.move(x0, y0);
  await page.waitForTimeout(150);
  const before = await snap(page, track);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.down({ button });
  let afterHold: Snap | null = null;
  if (holdMs > 0) {
    await page.waitForTimeout(holdMs);
    afterHold = await snap(page, track);
  }
  const moving: DragRun['moving'] = [];
  for (let i = 1; i <= steps; i += 1) {
    const cursor: Pt = { x: (delta[0] * i) / steps, y: (delta[1] * i) / steps };
    await page.mouse.move(x0 + cursor.x, y0 + cursor.y);
    await page.waitForTimeout(16);
    moving.push({ cursor, ...(await snap(page, track)) });
  }
  await page.waitForTimeout(120);
  const beforeUp = { cursor: { x: delta[0], y: delta[1] }, ...(await snap(page, track)) };
  await page.mouse.up({ button });
  if (shift) await page.keyboard.up('Shift');
  const tail: Snap[] = [];
  const releasedAt = Date.now();
  while (Date.now() - releasedAt < tailMs) {
    await page.waitForTimeout(40);
    tail.push(await snap(page, track));
  }
  await waitStable(page);
  const end = await snap(page, track);
  return { before, afterHold, moving, beforeUp, tail, end };
}

async function wheel(
  page: Page,
  scene: Scene,
  options: { at: Pt; deltaY: number; count?: number; track: Vec3[] },
): Promise<WheelRun> {
  const { at, deltaY, count = 8, track } = options;
  await page.mouse.move(scene.rect.left + at.x, scene.rect.top + at.y);
  await page.waitForTimeout(150);
  const before = await snap(page, track);
  const steps: Snap[] = [];
  for (let i = 0; i < count; i += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(70);
    steps.push(await snap(page, track));
  }
  await waitStable(page);
  const end = await snap(page, track);
  return { before, steps, end };
}

/** 被盯的点应该在屏幕上不动（旋转 / 中键缩放）：拖动中、松手后、停稳后各挪了多少 */
function fixedMetrics(run: DragRun, index = 0) {
  const start = run.before.screens[index]!;
  const duringPx = Math.max(0, ...[...run.moving, run.beforeUp].map((item) => px(item.screens[index]!, start)));
  const afterPx = Math.max(0, ...run.tail.map((item) => px(item.screens[index]!, start)));
  const endPx = px(run.end.screens[index]!, start);
  return {
    duringPx,
    afterPx,
    endPx,
    worstPx: Math.max(duringPx, afterPx, endPx),
    rotDeg: angleDeg(run.before.pose.quat, run.end.pose.quat),
  };
}

/** 被盯的点应该跟着光标走（平移）：拖动中离光标多远、停稳后差多少、松手后又滑了多少 */
function followMetrics(run: DragRun, index = 0) {
  const start = run.before.screens[index]!;
  const gap = (item: Snap, cursor: Pt) =>
    Math.hypot(item.screens[index]!.x - start.x - cursor.x, item.screens[index]!.y - start.y - cursor.y);
  const released = run.beforeUp.screens[index]!;
  return {
    lagPx: Math.max(0, ...[...run.moving, run.beforeUp].map((item) => gap(item, item.cursor))),
    endPx: gap(run.end, run.beforeUp.cursor),
    slidePx: Math.max(0, ...[...run.tail, run.end].map((item) => px(item.screens[index]!, released))),
    rotDeg: angleDeg(run.before.pose.quat, run.end.pose.quat),
  };
}

/** 滚轮：被盯的点最多挪了多少，相机到它的距离变成了原来的几倍 */
function wheelMetrics(run: WheelRun, point: Vec3, index = 0) {
  const start = run.before.screens[index]!;
  return {
    worstPx: Math.max(0, ...[...run.steps, run.end].map((item) => px(item.screens[index]!, start))),
    distRatio: len(sub(run.end.pose.pos, point)) / len(sub(run.before.pose.pos, point)),
  };
}

/** 单击选中 at 处的构件，返回之后光标在空白处时解析出的焦点（选中构件包围盒的中心） */
async function selectByClick(page: Page, scene: Scene, at: Pt): Promise<Vec3> {
  await press(page, scene, at);
  await expect.poll(() => selectedIds(page), { message: '单击之后应该选中一个构件' }).toHaveLength(1);
  const focus = await focusAt(page, scene.empty, 'rotate');
  expect(focus?.source, '有选中构件、光标在空白处时，焦点应该来自选中').toBe('selection');
  return focus!.point;
}

/**
 * 在悬停点长按，记下旋转中心。松手等于一次单击，会顺带选中那个构件，所以再在空白处单击一下把选中清掉
 * （单击不是长按，记下的点不受影响）。返回记下的点。
 */
async function rememberOnHover(page: Page, scene: Scene): Promise<Vec3> {
  await press(page, scene, scene.hover.at, LONG_PRESS_MS);
  await press(page, scene, scene.empty);
  expect(await selectedIds(page), '在空白处单击之后不该还有选中').toEqual([]);
  const state = await snap(page);
  expect(state.remembered, '长按之后应该记下旋转中心').not.toBeNull();
  expect(state.dot, '记着的时候应该显示小圆点').not.toBeNull();
  return state.remembered!;
}

/** 两张截图有多少个像素不一样：字节相同直接是 0，否则到页面里解码逐像素比 */
async function countDifferentPixels(page: Page, a: { equals(other: Uint8Array): boolean; toString(encoding: 'base64'): string }, b: Uint8Array & { toString(encoding: 'base64'): string }): Promise<number> {
  if (a.equals(b)) return 0;
  return page.evaluate(async ([first, second]) => {
    const load = async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const p = await load(first);
    const q = await load(second);
    let count = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) count += 1;
    }
    return count;
  }, [a.toString('base64'), b.toString('base64')] as const);
}

const dimensionActive = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as any).__viewerContext.dimensionSystem.value.pointer.hasActiveSession === true);

/** 尺寸标注系统此刻的状态（会按当前投影同步一次布局，只在鼠标松开时调） */
const dimensionState = (page: Page): Promise<DimensionState> =>
  page.evaluate(() => {
    const system = (window as any).__viewerContext.dimensionSystem.value;
    const record = system.document.state.records[0] ?? null;
    system.viewport.flushProjection?.();
    const layout = record ? system.viewport.getLayouts().find((item: any) => item.dimensionId === record.id) : null;
    const bounds = layout?.labelBounds ?? null;
    const center = bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null;
    return {
      active: system.pointer.hasActiveSession === true,
      records: system.document.state.records.length,
      placement: record?.placement ?? null,
      label: center ? { ...center, part: system.viewport.hitTest([center.x, center.y], 6)?.part ?? null } : null,
    };
  });

/**
 * 某个盒子的期望落点：让浏览器跑一次 `jumpTo`（直接跳）把结果取出来，再把相机还原。
 * 不在这里重算取景公式，理由见 `dtx-camera-focus-intent.spec.ts`。
 */
async function landingOf(page: Page, box: Box6): Promise<CameraSpot> {
  return page.evaluate((aabb) => {
    const viewer = (window as any).__xeokitViewer;
    const dtx = (window as any).__dtxViewer;
    const pos = dtx.camera.position.clone();
    const target = dtx.controls.target.clone();
    viewer.cameraFlight.jumpTo({ aabb });
    const landing = { pos: dtx.camera.position.toArray(), target: dtx.controls.target.toArray() };
    dtx.camera.position.copy(pos);
    dtx.controls.target.copy(target);
    dtx.controls.update();
    return landing;
  }, box);
}

/** 录屏关掉的理由见 `dtx-camera-focus-intent.spec.ts`（本机没装 ffmpeg，收尾会挂满超时） */
test.use({ viewport: { width: 1600, height: 1000 }, video: 'off' });
// 真实鼠标输入要一条一条量：同一个文件里的用例不并行，免得互相抢帧
test.describe.configure({ mode: 'default' });

test.describe('视图操作焦点', () => {
  let scene: Scene;
  let pivotErrors: string[];

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    pivotErrors = [];
    page.on('pageerror', (error) => {
      const text = `${error.message} ${error.stack ?? ''}`;
      if (text.includes('DynamicPivot')) pivotErrors.push(text.slice(0, 400));
    });
    scene = await openScene(page);
  });

  test.afterEach(() => {
    expect(pivotErrors, '焦点控制器不该在页面里抛错').toEqual([]);
  });

  test('左键旋转：悬停在构件上绕光标下那一点转，按住停一下再拖也不跳', async ({ page }) => {
    const { hover } = scene;
    const delta = inward(scene, hover.at, [150, 50]);
    expect((await focusAt(page, hover.at, 'rotate'))?.source, '光标下有构件时焦点来自悬停').toBe('hover');

    const run = await drag(page, scene, { at: hover.at, button: 'left', delta, steps: 25, track: [hover.point] });
    const m = fixedMetrics(run);
    note('左键旋转（悬停）', `焦点漂移 拖动中 ${round(m.duringPx)} / 松手后 ${round(m.afterPx)} / 停稳 ${round(m.endPx)} px，相机转了 ${round(m.rotDeg)}°`);
    expect(m.rotDeg, '相机应该真的转了').toBeGreaterThan(5);
    expect(m.worstPx, '光标下那一点在屏幕上不该挪').toBeLessThanOrEqual(FOCUS_DRIFT_PX);

    await resetPose(page, scene.basePose);
    const held = await drag(page, scene, { at: hover.at, button: 'left', delta, steps: 25, holdMs: 450, track: [hover.point] });
    const h = fixedMetrics(held);
    note('左键旋转（按住 0.45 秒再拖）', `焦点漂移 拖动中 ${round(h.duringPx)} / 松手后 ${round(h.afterPx)} / 停稳 ${round(h.endPx)} px，相机转了 ${round(h.rotDeg)}°`);
    expectCameraStill(held.before.pose, held.afterHold!.pose, '按住停的那 0.45 秒');
    expect(h.rotDeg, '相机应该真的转了').toBeGreaterThan(5);
    expect(h.worstPx, '光标下那一点在屏幕上不该挪').toBeLessThanOrEqual(FOCUS_DRIFT_PX);
  });

  test('左键旋转：有选中构件时，空白处绕选中构件中心转，悬停优先于选中', async ({ page }) => {
    const { hover, empty } = scene;
    const selection = await selectByClick(page, scene, scene.other.at);

    const fromEmpty = await drag(page, scene, { at: empty, button: 'left', delta: inward(scene, empty, [150, 50]), steps: 25, track: [selection] });
    const e = fixedMetrics(fromEmpty);
    note('左键旋转（空白处，有选中）', `选中构件中心漂移 拖动中 ${round(e.duringPx)} / 松手后 ${round(e.afterPx)} / 停稳 ${round(e.endPx)} px，相机转了 ${round(e.rotDeg)}°`);
    expect(e.rotDeg, '相机应该真的转了').toBeGreaterThan(5);
    expect(e.worstPx, '选中构件的中心在屏幕上不该挪').toBeLessThanOrEqual(FOCUS_DRIFT_PX);

    await resetPose(page, scene.basePose);
    expect((await focusAt(page, hover.at, 'rotate'))?.source, '悬停优先于选中').toBe('hover');
    const onHover = await drag(page, scene, { at: hover.at, button: 'left', delta: inward(scene, hover.at, [150, 50]), steps: 25, track: [hover.point, selection] });
    const o = fixedMetrics(onHover);
    const selectionMoved = px(onHover.end.screens[1]!, onHover.before.screens[1]!);
    note('左键旋转（悬停，同时有选中）', `光标下那一点漂移 ${round(o.worstPx)} px，选中构件中心挪了 ${round(selectionMoved)} px，相机转了 ${round(o.rotDeg)}°`);
    expect(o.rotDeg, '相机应该真的转了').toBeGreaterThan(5);
    expect(o.worstPx, '光标下那一点在屏幕上不该挪').toBeLessThanOrEqual(FOCUS_DRIFT_PX);
    expect(selectionMoved, '选中构件的中心应该跟着转走，说明这次不是绕它转').toBeGreaterThan(10);
  });

  test('滚轮缩放：悬停时光标下的点不动，空白处有选中时选中构件中心不动', async ({ page }) => {
    const { hover, empty } = scene;
    expect((await focusAt(page, hover.at, 'dolly'))?.source, '光标下有构件时焦点来自悬停').toBe('hover');

    const zoomIn = wheelMetrics(await wheel(page, scene, { at: hover.at, deltaY: -100, track: [hover.point] }), hover.point);
    note('滚轮放大 8 格（悬停）', `焦点漂移 ${round(zoomIn.worstPx)} px，距离变为 ${round(zoomIn.distRatio, 3)} 倍`);
    expect(zoomIn.distRatio, '应该真的拉近了').toBeLessThan(0.9);
    expect(zoomIn.worstPx, '光标下那一点不该滑走').toBeLessThanOrEqual(FOCUS_DRIFT_PX);

    await resetPose(page, scene.basePose);
    const zoomOut = wheelMetrics(await wheel(page, scene, { at: hover.at, deltaY: 100, track: [hover.point] }), hover.point);
    note('滚轮缩小 8 格（悬停）', `焦点漂移 ${round(zoomOut.worstPx)} px，距离变为 ${round(zoomOut.distRatio, 3)} 倍`);
    expect(zoomOut.distRatio, '应该真的拉远了').toBeGreaterThan(1.1);
    expect(zoomOut.worstPx, '光标下那一点不该滑走').toBeLessThanOrEqual(FOCUS_DRIFT_PX);

    await resetPose(page, scene.basePose);
    const selection = await selectByClick(page, scene, scene.other.at);
    expect((await focusAt(page, empty, 'dolly'))?.source, '空白处有选中时焦点来自选中').toBe('selection');
    const selIn = wheelMetrics(await wheel(page, scene, { at: empty, deltaY: -100, track: [selection] }), selection);
    note('滚轮放大 8 格（空白处，有选中）', `选中构件中心漂移 ${round(selIn.worstPx)} px，距离变为 ${round(selIn.distRatio, 3)} 倍`);
    expect(selIn.distRatio, '应该真的拉近了').toBeLessThan(0.9);
    expect(selIn.worstPx, '选中构件的中心不该滑走').toBeLessThanOrEqual(FOCUS_DRIFT_PX);

    await resetPose(page, scene.basePose);
    const selOut = wheelMetrics(await wheel(page, scene, { at: empty, deltaY: 100, track: [selection] }), selection);
    note('滚轮缩小 8 格（空白处，有选中）', `选中构件中心漂移 ${round(selOut.worstPx)} px，距离变为 ${round(selOut.distRatio, 3)} 倍`);
    expect(selOut.distRatio, '应该真的拉远了').toBeGreaterThan(1.1);
    expect(selOut.worstPx, '选中构件的中心不该滑走').toBeLessThanOrEqual(FOCUS_DRIFT_PX);
  });

  test('中键拖动缩放：悬停时光标下的点不动，空白处朝按下的那一点', async ({ page }) => {
    const { hover, empty } = scene;

    const onHover = await drag(page, scene, { at: hover.at, button: 'middle', delta: inward(scene, hover.at, [0, 140]), track: [hover.point] });
    const h = fixedMetrics(onHover);
    const hoverRatio = len(sub(onHover.end.pose.pos, hover.point)) / len(sub(onHover.before.pose.pos, hover.point));
    note('中键拖动缩放（悬停）', `焦点漂移 拖动中 ${round(h.duringPx)} / 停稳 ${round(h.endPx)} px，距离变为 ${round(hoverRatio, 3)} 倍`);
    expect(Math.abs(hoverRatio - 1), '应该真的缩放了').toBeGreaterThan(0.05);
    expect(h.worstPx, '按下时光标下那一点不该挪').toBeLessThanOrEqual(FOCUS_DRIFT_PX);

    await resetPose(page, scene.basePose);
    const under = pointUnderCursor(scene, scene.basePose, empty);
    const focus = await focusAt(page, empty, 'dolly');
    expect(focus?.source, '空白处、没有选中时，缩放的焦点来自光标').toBe('cursor');
    const fromEmpty = await drag(page, scene, { at: empty, button: 'middle', delta: inward(scene, empty, [0, 140]), track: [under, focus!.point] });
    const e = fixedMetrics(fromEmpty);
    const emptyRatio = len(sub(fromEmpty.end.pose.pos, under)) / len(sub(fromEmpty.before.pose.pos, under));
    note('中键拖动缩放（空白处，没有选中）', `按下那一点漂移 拖动中 ${round(e.duringPx)} / 停稳 ${round(e.endPx)} px，距离变为 ${round(emptyRatio, 3)} 倍`);
    expect(px(fromEmpty.before.screens[1]!, empty), '解析出的焦点应该就在光标下').toBeLessThanOrEqual(0.5);
    expect(Math.abs(emptyRatio - 1), '应该真的缩放了').toBeGreaterThan(0.05);
    expect(e.worstPx, '按下的那一点不该挪').toBeLessThanOrEqual(FOCUS_DRIFT_PX);
  });

  test('平移：右键和 Shift+左键拖动时构件跟手，松手后不滑', async ({ page }) => {
    const { hover, empty } = scene;
    const expectFollows = (title: string, run: DragRun) => {
      const m = followMetrics(run);
      note(title, `拖动中离光标最多 ${round(m.lagPx)} px，停稳后差 ${round(m.endPx)} px，松手后又滑了 ${round(m.slidePx)} px，相机转了 ${round(m.rotDeg, 2)}°`);
      expect(m.lagPx, `${title}：拖动中抓住的点要贴着光标`).toBeLessThanOrEqual(PAN_LAG_PX);
      expect(m.endPx, `${title}：停稳后抓住的点要在光标下`).toBeLessThanOrEqual(FOCUS_DRIFT_PX);
      expect(m.slidePx, `${title}：松手后不该再滑`).toBeLessThanOrEqual(PAN_SLIDE_PX);
      expect(m.rotDeg, `${title}：平移不该带出旋转`).toBeLessThan(0.5);
    };
    const delta = inward(scene, hover.at, [220, 110]);
    expect((await focusAt(page, hover.at, 'pan'))?.source, '光标下有构件时焦点来自悬停').toBe('hover');

    expectFollows('右键平移（悬停）', await drag(page, scene, { at: hover.at, button: 'right', delta, steps: 22, track: [hover.point] }));

    await resetPose(page, scene.basePose);
    expectFollows('Shift+左键平移（悬停）', await drag(page, scene, { at: hover.at, button: 'left', shift: true, delta, steps: 22, track: [hover.point] }));

    await resetPose(page, scene.basePose);
    const selection = await selectByClick(page, scene, scene.other.at);
    expect((await focusAt(page, empty, 'pan'))?.source, '空白处有选中时焦点来自选中').toBe('selection');
    expectFollows('右键平移（空白处，有选中）', await drag(page, scene, { at: empty, button: 'right', delta: inward(scene, empty, [220, 110]), steps: 22, track: [selection] }));
  });

  test('在构件上按住 0.7 秒：画面不动，旋转中心记到按住的那一点', async ({ page }) => {
    const { hover, other, rect } = scene;
    await page.mouse.move(rect.left + hover.at.x, rect.top + hover.at.y);
    await page.waitForTimeout(200);
    const before = await snap(page, [hover.point]);
    expect(before.dot, '开始时不该有小圆点').toBeNull();

    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(LONG_PRESS_MS);
    const held = await snap(page, [hover.point]);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(500);
    const released = await snap(page, [hover.point]);

    expectCameraStill(before.pose, held.pose, '按住 0.7 秒');
    expectCameraStill(before.pose, released.pose, '松手之后');
    const heldPx = px(held.screens[0]!, before.screens[0]!);
    const releasedPx = px(released.screens[0]!, before.screens[0]!);
    expect(heldPx, '按住期间画面不该动').toBeLessThanOrEqual(STILL_PX);
    expect(releasedPx, '松手之后画面不该动').toBeLessThanOrEqual(STILL_PX);

    expect(held.remembered, '按住 0.3 秒之后应该记下旋转中心').not.toBeNull();
    const remembered = held.remembered!;
    const viewDistance = len(sub(before.pose.pos, before.pose.target));
    const where = (await snap(page, [remembered])).screens[0]!;
    note('在构件上按住 0.7 秒', `画面挪了 ${round(Math.max(heldPx, releasedPx), 3)} px，相机转了 ${round(poseDelta(before.pose, held.pose).deg, 4)}°；记下的点离按住的位置 ${round(px(where, hover.at), 2)} px`);
    expect(len(sub(remembered, hover.point)) / viewDistance, '记下的应该就是光标下拾到的那一点').toBeLessThan(1e-6);
    expect(px(where, hover.at), '记下的点应该就在按住的位置').toBeLessThanOrEqual(0.5);
    expect(held.dot, '记下之后应该显示小圆点').not.toBeNull();
    expect(px(held.dot!, hover.at), '小圆点应该在按住的位置').toBeLessThanOrEqual(1);
    expect(released.remembered, '松手之后记下的点不变').toEqual(remembered);

    // 只有左键长按才记：右键、中键在另一个构件上按住，记下的点不该换
    for (const button of ['right', 'middle'] as const) {
      await press(page, scene, other.at, LONG_PRESS_MS, button);
      await page.keyboard.press('Escape');
      expect((await snap(page)).remembered, `${button === 'right' ? '右键' : '中键'}按住不该改记下的旋转中心`).toEqual(remembered);
    }
  });

  test('长按之后：空白处没有选中时绕记下的点转，有选中构件时仍绕选中构件', async ({ page }) => {
    const { empty } = scene;
    const remembered = await rememberOnHover(page, scene);
    expect((await focusAt(page, empty, 'rotate'))?.source, '空白处、没有选中时，旋转的焦点来自记下的点').toBe('remembered');

    const run = await drag(page, scene, { at: empty, button: 'left', delta: inward(scene, empty, [150, 50]), steps: 25, track: [remembered] });
    const m = fixedMetrics(run);
    const dotGap = Math.max(...[...run.moving, run.beforeUp, ...run.tail, run.end].map((item) => (item.dot ? px(item.dot, item.screens[0]!) : Infinity)));
    note('长按之后在空白处旋转（没有选中）', `记下的点漂移 拖动中 ${round(m.duringPx)} / 松手后 ${round(m.afterPx)} / 停稳 ${round(m.endPx)} px，相机转了 ${round(m.rotDeg)}°，圆点离它最多 ${round(dotGap, 2)} px`);
    expect(m.rotDeg, '相机应该真的转了').toBeGreaterThan(5);
    expect(m.worstPx, '记下的点在屏幕上不该挪').toBeLessThanOrEqual(FOCUS_DRIFT_PX);
    expect(dotGap, '小圆点应该一直贴在记下的那一点上').toBeLessThanOrEqual(1);

    await resetPose(page, scene.basePose);
    const selection = await selectByClick(page, scene, scene.other.at);
    const withSelection = await drag(page, scene, { at: empty, button: 'left', delta: inward(scene, empty, [150, 50]), steps: 25, track: [selection, remembered] });
    const s = fixedMetrics(withSelection);
    const rememberedMoved = px(withSelection.end.screens[1]!, withSelection.before.screens[1]!);
    note('长按之后在空白处旋转（有选中）', `选中构件中心漂移 ${round(s.worstPx)} px，记下的点挪了 ${round(rememberedMoved)} px，相机转了 ${round(s.rotDeg)}°`);
    expect(s.rotDeg, '相机应该真的转了').toBeGreaterThan(5);
    expect(s.worstPx, '选中构件的中心在屏幕上不该挪').toBeLessThanOrEqual(FOCUS_DRIFT_PX);
    expect(rememberedMoved, '记下的点应该跟着转走，说明这次不是绕它转').toBeGreaterThan(10);
  });

  test('小圆点：贴在记下的点上；在空白处长按后消失，之后空白处旋转回到绕画面正中', async ({ page }) => {
    const { hover, empty } = scene;
    const remembered = await rememberOnHover(page, scene);
    const shown = await snap(page, [remembered]);
    expect(px(shown.dot!, hover.at), '圆点应该在按住的位置').toBeLessThanOrEqual(1);
    expect(px(shown.dot!, shown.screens[0]!), '圆点应该贴在记下的那一点上').toBeLessThanOrEqual(1);

    // 平移一下：记下的点在屏幕上挪了，圆点要跟过去（往画布中心方向挪，免得点跑出画面、圆点藏起来）
    const pan = await drag(page, scene, { at: empty, button: 'right', delta: inward(scene, shown.screens[0]!, [120, 80]), track: [remembered] });
    const samples = [...pan.moving, pan.beforeUp, ...pan.tail, pan.end];
    const panGap = Math.max(...samples.map((item) => (item.dot ? px(item.dot, item.screens[0]!) : Infinity)));
    const moved = px(pan.end.screens[0]!, pan.before.screens[0]!);
    note('小圆点跟随', `平移后记下的点在屏幕上挪了 ${round(moved)} px，圆点离它最多 ${round(panGap, 2)} px`);
    expect(moved, '记下的点应该真的在屏幕上挪了').toBeGreaterThan(50);
    expect(panGap, '小圆点应该一直贴在记下的那一点上').toBeLessThanOrEqual(1);

    await resetPose(page, scene.basePose);
    await press(page, scene, empty, LONG_PRESS_MS);
    const cleared = await snap(page);
    expect(cleared.remembered, '在空白处长按之后应该取消').toBeNull();
    expect(cleared.dot, '取消之后圆点应该消失').toBeNull();
    expect(await focusAt(page, empty, 'rotate'), '取消之后，空白处旋转没有焦点').toBeNull();

    const run = await drag(page, scene, { at: empty, button: 'left', delta: inward(scene, empty, [150, 50]), steps: 25, track: [scene.basePose.target] });
    const delta = poseDelta(run.before.pose, run.end.pose);
    note('取消之后在空白处旋转', `相机转了 ${round(delta.deg)}°，观察中心挪了视距的 ${delta.target.toExponential(1)} 倍`);
    expect(delta.deg, '相机应该真的转了').toBeGreaterThan(5);
    expect(delta.target, '绕画面正中转：观察中心不动').toBeLessThan(POSE_EPS);
    expect(Math.abs(delta.distRatio - 1), '绕画面正中转：视距不变').toBeLessThan(POSE_EPS);
  });

  test('单击选中：画面不动', async ({ page }) => {
    const before = await snap(page, [scene.center]);
    await press(page, scene, scene.other.at);
    await expect.poll(() => selectedIds(page), { message: '单击之后应该选中一个构件' }).toHaveLength(1);
    await page.waitForTimeout(400);
    const after = await snap(page, [scene.center]);
    const moved = px(after.screens[0]!, before.screens[0]!);
    note('单击选中', `模型中心在屏幕上挪了 ${round(moved, 3)} px，相机转了 ${round(poseDelta(before.pose, after.pose).deg, 4)}°`);
    expectCameraStill(before.pose, after.pose, '单击选中');
    expect(moved, '单击选中之后画面不该动').toBeLessThanOrEqual(STILL_PX);
  });

  test('导航模式悬停：构件表面不变色，悬停前后画面 0 像素差', async ({ page }) => {
    const { hover, empty, rect } = scene;
    const viewport = page.viewportSize()!;
    const size = 220;
    const clip = {
      x: Math.max(0, Math.min(Math.round(rect.left + hover.at.x - size / 2), viewport.width - size)),
      y: Math.max(0, Math.min(Math.round(rect.top + hover.at.y - size / 2), viewport.height - size)),
      width: size,
      height: size,
    };
    await page.mouse.move(rect.left + empty.x, rect.top + empty.y);
    await page.waitForTimeout(900);
    const idle = await page.screenshot({ clip });
    await page.waitForTimeout(500);
    const idleAgain = await page.screenshot({ clip });
    await page.mouse.move(rect.left + hover.at.x - 6, rect.top + hover.at.y - 4);
    await page.waitForTimeout(120);
    await page.mouse.move(rect.left + hover.at.x, rect.top + hover.at.y);
    await page.waitForTimeout(1_000);
    const hovering = await page.screenshot({ clip });

    const noise = await countDifferentPixels(page, idle, idleAgain);
    const changed = await countDifferentPixels(page, idle, hovering);
    const hoverSource = (await focusAt(page, hover.at))?.source;

    // 对照：单击选中这个构件，同一块区域确实会变色——说明上面的比法量得出表面变色，0 不是量不出来
    await press(page, scene, hover.at);
    await expect.poll(() => selectedIds(page), { message: '单击之后应该选中一个构件' }).toHaveLength(1);
    await page.waitForTimeout(600);
    const selected = await page.screenshot({ clip });
    const highlighted = await countDifferentPixels(page, idle, selected);

    note('导航模式悬停', `光标不动时前后两张差 ${noise} 个像素，悬停和不悬停差 ${changed} 个像素；对照：选中之后差 ${highlighted} 个像素（构件周围 ${size}×${size}）`);
    expect(hoverSource, '光标确实停在构件上').toBe('hover');
    expect(noise, '光标不动时画面本身不该有变化，否则这一条量不出东西').toBe(0);
    expect(changed, '悬停前后画面不该有差别').toBe(0);
    expect(highlighted, '对照：选中之后这块区域应该变色，否则上面的 0 说明不了什么').toBeGreaterThan(0);
  });

  test('空白处、没有选中时滚轮：光标下那一点不滑走', async ({ page }) => {
    const { empty } = scene;
    const under = pointUnderCursor(scene, scene.basePose, empty);
    const focus = await focusAt(page, empty, 'dolly');
    expect(focus?.source, '空白处、没有选中时，缩放的焦点来自光标').toBe('cursor');
    expect(px((await snap(page, [focus!.point])).screens[0]!, empty), '解析出的焦点应该就在光标下').toBeLessThanOrEqual(0.5);

    const zoomIn = wheelMetrics(await wheel(page, scene, { at: empty, deltaY: -100, track: [under] }), under);
    note('滚轮放大 8 格（空白处，没有选中）', `光标下那一点漂移 ${round(zoomIn.worstPx)} px，距离变为 ${round(zoomIn.distRatio, 3)} 倍`);
    expect(zoomIn.distRatio, '应该真的拉近了').toBeLessThan(0.9);
    expect(zoomIn.worstPx, '光标下那一点不该滑走').toBeLessThanOrEqual(FOCUS_DRIFT_PX);

    await resetPose(page, scene.basePose);
    const zoomOut = wheelMetrics(await wheel(page, scene, { at: empty, deltaY: 100, track: [under] }), under);
    note('滚轮缩小 8 格（空白处，没有选中）', `光标下那一点漂移 ${round(zoomOut.worstPx)} px，距离变为 ${round(zoomOut.distRatio, 3)} 倍`);
    expect(zoomOut.distRatio, '应该真的拉远了').toBeGreaterThan(1.1);
    expect(zoomOut.worstPx, '光标下那一点不该滑走').toBeLessThanOrEqual(FOCUS_DRIFT_PX);
  });

  test('选中构件不在画面里：空白处旋转、滚轮和没有选中时一样', async ({ page }) => {
    const { hover, empty, rect } = scene;
    const selection = await selectByClick(page, scene, hover.at);

    // 把相机往左平移，选中的构件从画布右边出去
    const selectionAt = (await snap(page, [selection])).screens[0]!;
    const offset = mul(scene.right, -(rect.width - selectionAt.x + 150) * scene.unitsPerPx);
    const away: CameraSpot = { pos: add(scene.basePose.pos, offset), target: add(scene.basePose.target, offset) };
    await resetPose(page, away);
    expect((await snap(page, [selection])).screens[0]!.x, '选中构件的中心应该已经在画布外').toBeGreaterThan(rect.width + 20);
    expect(await selectedIds(page), '构件还选着，只是不在画面里').toHaveLength(1);
    expect(await focusAt(page, empty, 'rotate'), '选中构件不在画面里：旋转按没有选中处理').toBeNull();
    expect((await focusAt(page, empty, 'dolly'))?.source, '选中构件不在画面里：缩放朝光标').toBe('cursor');

    const under = pointUnderCursor(scene, away, empty);
    const rotateDelta = inward(scene, empty, [150, 50]);
    const rotateSelected = await drag(page, scene, { at: empty, button: 'left', delta: rotateDelta, steps: 25, track: [away.target] });
    await resetPose(page, away);
    const wheelSelected = await wheel(page, scene, { at: empty, deltaY: -100, track: [under] });

    // 清掉选中，同一个视角、同一组手势再来一遍当对照
    await resetPose(page, away);
    await press(page, scene, empty);
    expect(await selectedIds(page), '在空白处单击之后不该还有选中').toEqual([]);
    await resetPose(page, away);
    const rotateNone = await drag(page, scene, { at: empty, button: 'left', delta: rotateDelta, steps: 25, track: [away.target] });
    await resetPose(page, away);
    const wheelNone = await wheel(page, scene, { at: empty, deltaY: -100, track: [under] });

    const rotated = poseDelta(rotateSelected.before.pose, rotateSelected.end.pose);
    const rotateGap = poseDelta(rotateNone.end.pose, rotateSelected.end.pose);
    const zoomed = wheelMetrics(wheelSelected, under);
    const wheelGap = poseDelta(wheelNone.end.pose, wheelSelected.end.pose);
    note('选中构件不在画面里，空白处旋转', `相机转了 ${round(rotated.deg)}°，观察中心挪了视距的 ${rotated.target.toExponential(1)} 倍；和没有选中时的终点差 ${rotateGap.deg.toExponential(1)}° / ${rotateGap.pos.toExponential(1)}`);
    note('选中构件不在画面里，空白处滚轮', `光标下那一点漂移 ${round(zoomed.worstPx)} px，距离变为 ${round(zoomed.distRatio, 3)} 倍；和没有选中时的终点差 ${wheelGap.pos.toExponential(1)}`);
    expect(rotated.deg, '相机应该真的转了').toBeGreaterThan(5);
    expect(rotated.target, '按没有选中处理：绕画面正中转，观察中心不动').toBeLessThan(POSE_EPS);
    expect(rotateGap.deg, '旋转的终点应该和没有选中时一样').toBeLessThan(0.01);
    expect(rotateGap.pos, '旋转的终点应该和没有选中时一样').toBeLessThan(1e-4);
    expect(zoomed.distRatio, '应该真的拉近了').toBeLessThan(0.9);
    expect(zoomed.worstPx, '按没有选中处理：光标下那一点不该滑走').toBeLessThanOrEqual(FOCUS_DRIFT_PX);
    expect(wheelGap.pos, '滚轮的终点应该和没有选中时一样').toBeLessThan(1e-4);
    expect(wheelGap.target, '滚轮的终点应该和没有选中时一样').toBeLessThan(1e-4);
  });

  test('测量态按住：相机不动，记住的旋转中心不变；接着拖动照常绕焦点转', async ({ page }) => {
    const remembered = await rememberOnHover(page, scene);
    const setToolMode = (mode: string) => page.evaluate((value) => (window as any).__viewerToolStore.setToolMode(value), mode);
    /** 切工具模式会出提示条，画布可能变尺寸：重新量画布，重新找一个离记下的点最远的构件位置和一处空白 */
    const locate = async () => {
      await waitStable(page);
      await page.waitForTimeout(600);
      const live: Scene = { ...scene, rect: await readRect(page) };
      const { hits, empties } = await scanCanvas(page);
      const anchor = (await snap(page, [remembered])).screens[0]!;
      const spot = [...hits].sort((a, b) => px(b, anchor) - px(a, anchor))[0]!;
      const blank = [...empties].sort((a, b) => px(b, anchor) - px(a, anchor))[0]!;
      expect(px(spot, anchor), '要按的构件位置得离记下的点远一些，记没记才分得清').toBeGreaterThan(60);
      return { live, spot, blank };
    };

    await setToolMode('xeokit_measure_distance');
    const measuring = await locate();
    // 按住 0.7 秒再拖。按住的那一段：相机不动，也不记旋转中心（长按只在导航态生效）。
    // 接着的拖动是转视角（测量工具只认点击，不拦拖动），焦点规则和导航态一样。
    for (const [what, at, source] of [['测量态在构件上', measuring.spot, 'hover'], ['测量态在空白处', measuring.blank, 'remembered']] as const) {
      await resetPose(page, scene.basePose);
      const focus = await focusAt(page, at, 'rotate');
      expect(focus?.source, `${what}：旋转焦点的来源`).toBe(source);
      const run = await drag(page, measuring.live, {
        at,
        button: 'left',
        delta: inward(measuring.live, at, [150, 50]),
        steps: 25,
        holdMs: LONG_PRESS_MS,
        track: [focus!.point],
      });
      const m = fixedMetrics(run);
      const held = poseDelta(run.before.pose, run.afterHold!.pose);
      const shots: Snap[] = [run.afterHold!, ...run.moving, run.beforeUp, ...run.tail, run.end];
      const changed = shots.find((shot) => JSON.stringify(shot.remembered) !== JSON.stringify(remembered));
      note(`${what}按住 0.7 秒再拖`, `按住时相机位置变化 ${held.pos.toExponential(1)}、转了 ${round(held.deg, 4)}°；拖动转了 ${round(m.rotDeg)}°，焦点漂移 ${round(m.worstPx)} px；记住的旋转中心${changed ? '变了' : '没变'}`);
      expectCameraStill(run.before.pose, run.afterHold!.pose, `${what}按住 0.7 秒`);
      expect(changed ? changed.remembered : remembered, `${what}按住再拖：记住的旋转中心不该变`).toEqual(remembered);
      expect(m.rotDeg, `${what}拖动：测量态下拖动照常转视角`).toBeGreaterThan(5);
      expect(m.worstPx, `${what}拖动：焦点在屏幕上不该挪`).toBeLessThanOrEqual(FOCUS_DRIFT_PX);
    }

    // 按住 0.7 秒不拖就松手：测量工具把它当一次点击，视图这边什么都不该发生
    await resetPose(page, scene.basePose);
    const beforeHold = await snap(page);
    await press(page, measuring.live, measuring.spot, LONG_PRESS_MS);
    const afterHold = await snap(page);
    const still = poseDelta(beforeHold.pose, afterHold.pose);
    note('测量态在构件上按住 0.7 秒后松手', `相机位置变化 ${still.pos.toExponential(1)}，转了 ${round(still.deg, 4)}°，记住的旋转中心${JSON.stringify(afterHold.remembered) === JSON.stringify(remembered) ? '没变' : '变了'}`);
    expectCameraStill(beforeHold.pose, afterHold.pose, '测量态在构件上按住 0.7 秒后松手');
    expect(afterHold.remembered, '测量态在构件上按住 0.7 秒后松手：记住的旋转中心不该变').toEqual(remembered);

    // 正对照：回到导航态，在构件上同样按住，旋转中心会换过去——说明上面「不变」是因为测量态，不是因为这个位置记不了
    await setToolMode('none');
    const navigating = await locate();
    await press(page, navigating.live, navigating.spot, LONG_PRESS_MS);
    const changed = (await snap(page)).remembered;
    expect(changed, '导航态长按应该记下旋转中心').not.toBeNull();
    expect(len(sub(changed!, remembered)), '导航态在另一个位置长按，记下的点应该换过去').toBeGreaterThan(1e-6);
  });

  test('尺寸标注：创建中按住再拖、拖动已有尺寸的标签，相机不动，记住的旋转中心不变', async ({ page }) => {
    const remembered = await rememberOnHover(page, scene);
    const expectUntouched = (what: string, run: Awaited<ReturnType<typeof holdThenDrag>>) => {
      note(`${what}按住 0.7 秒再拖`, `相机位置变化 ${poseDelta(run.before.pose, run.released.pose).pos.toExponential(1)}，转了 ${round(poseDelta(run.before.pose, run.released.pose).deg, 4)}°，记住的旋转中心${JSON.stringify(run.released.remembered) === JSON.stringify(remembered) ? '没变' : '变了'}`);
      for (const [stage, shot] of [['按住 0.7 秒', run.held], ['拖动中', run.dragging], ['松手之后', run.released]] as const) {
        expectCameraStill(run.before.pose, shot.pose, `${what}${stage}`);
        expect(shot.remembered, `${what}${stage}：记住的旋转中心不该变`).toEqual(remembered);
      }
    };

    // 尺寸面板的入口和 `dimension-app-dev-smoke.spec.ts` 同一条路径
    await page.locator('[data-ribbon-tab="view"]').first().click();
    await page.locator('[data-command="panel.dimension"]').first().click();
    const linear = page.getByTestId('dimension.create.linear');
    await expect(linear).toBeVisible();
    await page.waitForTimeout(600);
    const live: Scene = { ...scene, rect: await readRect(page) };
    const { hits } = await scanCanvas(page);
    expect(hits.length, '画布上要有能拾到构件的位置').toBeGreaterThanOrEqual(2);
    const first = hits[0]!;
    const second = hits[hits.length - 1]!;

    // 一、创建会话里，在构件上按住 0.7 秒再拖
    await linear.click();
    await expect.poll(() => dimensionActive(page), { message: '点「线性」之后应该进入创建会话' }).toBe(true);
    expectUntouched('尺寸创建中', await holdThenDrag(page, live, first));

    // 上面那一下拖动在尺寸工具里算什么由它自己定：取消掉，干干净净地用两次单击建一条
    await page.getByTestId('dimension.cancel').click();
    await expect.poll(() => dimensionActive(page), { message: '取消之后会话应该结束' }).toBe(false);
    await linear.click();
    await expect.poll(() => dimensionActive(page)).toBe(true);
    const beforeCreate = await snap(page);
    await press(page, live, first);
    await press(page, live, second);
    await expect.poll(async () => (await dimensionState(page)).records, { message: '两次单击之后应该建出一条尺寸' }).toBe(1);
    const afterCreate = await snap(page);
    expectCameraStill(beforeCreate.pose, afterCreate.pose, '建尺寸的两次单击');
    expect(afterCreate.remembered, '建尺寸不该改记住的旋转中心').toEqual(remembered);

    // 二、拖动已有尺寸的标签。演示场景只有几毫米大，新建尺寸的默认偏移是 150 mm，标签在画布外很远的地方：
    // 把相机沿视线拉远，直到标签进到画布里。尺寸系统只跟「渲染帧里 controls.update() 挪出来」的相机变化，
    // 这里是直接摆的相机，所以手动通知它一次。
    let label: DimensionState['label'] = null;
    for (const factor of [12, 16, 24, 32, 48, 64]) {
      const far: CameraSpot = {
        pos: add(scene.basePose.target, mul(sub(scene.basePose.pos, scene.basePose.target), factor)),
        target: scene.basePose.target,
      };
      await resetPose(page, far);
      await page.evaluate(() => (window as any).__viewerContext.dimensionSystem.value.notifyViewerChanged());
      await page.waitForTimeout(300);
      const at = (await dimensionState(page)).label;
      if (!at || at.part !== 'label') continue;
      if (at.x < 80 || at.y < 80 || at.x > live.rect.width - 180 || at.y > live.rect.height - 80) continue;
      if (!(await onCanvas(page, at))) continue;
      label = at;
      break;
    }
    expect(label, '拉远之后尺寸的标签应该进到画布里').not.toBeNull();
    const placementBefore = (await dimensionState(page)).placement;

    const x = live.rect.left + label!.x;
    const y = live.rect.top + label!.y;
    await page.mouse.move(x - 3, y - 3);
    await page.waitForTimeout(80);
    await page.mouse.move(x, y);
    await page.waitForTimeout(200);
    const before = await snap(page);
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(100);
    expect(await dimensionActive(page), '按在标签上应该开始拖动尺寸').toBe(true);
    await page.waitForTimeout(LONG_PRESS_MS - 100);
    const held = await snap(page);
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(x + 5 * i, y - 4 * i);
      await page.waitForTimeout(20);
    }
    const dragging = await snap(page);
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(600);
    const released = await snap(page);
    expect(await dimensionActive(page), '松手之后拖动应该结束').toBe(false);
    expect((await dimensionState(page)).placement, '标签应该真的被拖动了').not.toEqual(placementBefore);
    expectUntouched('拖动尺寸标签', { before, held, dragging, released });

    // 三、尺寸工具用完之后导航照常：在空白处（也不压着尺寸图形）左键拖动，相机还能转
    await resetPose(page, scene.basePose);
    await page.evaluate(() => (window as any).__viewerContext.dimensionSystem.value.notifyViewerChanged());
    await page.waitForTimeout(300);
    const offDimension = await page.evaluate(([px0, py0]) => {
      const viewport = (window as any).__viewerContext.dimensionSystem.value.viewport;
      viewport.flushProjection?.();
      return viewport.hitTest([px0, py0], 6) === null;
    }, [scene.empty.x, scene.empty.y] as const);
    expect(offDimension, '空白点不该压在尺寸图形上').toBe(true);
    const spin = await drag(page, live, { at: scene.empty, button: 'left', delta: inward(scene, scene.empty, [150, 50]), track: [] });
    expect(angleDeg(spin.before.pose.quat, spin.end.pose.quat), '尺寸工具用完之后，空白处左键拖动还能转').toBeGreaterThan(5);
  });

  test('方位块和定位飞行：有选中、有记住的旋转中心、惯性还没停时都照常，不被焦点逻辑拉偏', async ({ page }) => {
    // 先记一个旋转中心，再选中另一个构件：两种焦点都在场
    await press(page, scene, scene.hover.at, LONG_PRESS_MS);
    await selectByClick(page, scene, scene.other.at);
    expect((await snap(page)).remembered, '长按之后应该记下旋转中心').not.toBeNull();

    // 一、点方位块上的 -Y 轴球。轴球在方位块里的位置：three-viewport-gizmo 把轴球放在离中心 1.3 个单位处，
    // 方位块自己的正交相机可视范围是 ±1.8，朝向跟主相机一致（点偏了的话下面「转到 -Y 方向」会先挂）
    const axis: Vec3 = [0, -1, 0];
    const gizmo = await page.evaluate((direction) => {
      const dtx = (window as any).__dtxViewer;
      const box = dtx.getGizmoElement().getBoundingClientRect();
      const v = dtx.camera.position.clone().fromArray(direction).applyQuaternion(dtx.camera.quaternion.clone().invert());
      return {
        ballX: box.left + box.width * (0.5 + (1.3 * v.x) / 3.6),
        ballY: box.top + box.height * (0.5 - (1.3 * v.y) / 3.6),
        centerX: box.left + box.width / 2,
        centerY: box.top + box.height / 2,
      };
    }, axis);
    const beforeClick = await readPose(page);
    await page.mouse.move(gizmo.ballX - 2, gizmo.ballY - 2);
    await page.waitForTimeout(120);
    await page.mouse.move(gizmo.ballX, gizmo.ballY);
    await page.waitForTimeout(250);
    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(40);
    await page.mouse.up({ button: 'left' });
    await expect
      .poll(async () => {
        const now = await readPose(page);
        return angleBetweenDeg(sub(now.pos, now.target), axis);
      }, { timeout: 5_000, message: '点 -Y 轴球之后，相机应该转到从 -Y 方向看' })
      .toBeLessThan(0.1);
    await waitStable(page);
    const clicked = poseDelta(beforeClick, await readPose(page));
    note('点方位块 -Y 轴球', `相机转了 ${round(clicked.deg)}°，观察中心挪了视距的 ${clicked.target.toExponential(1)} 倍，视距变为 ${round(clicked.distRatio, 6)} 倍`);
    expect(clicked.target, '切视角不该挪观察中心').toBeLessThan(POSE_EPS);
    expect(Math.abs(clicked.distRatio - 1), '切视角不该改视距').toBeLessThan(1e-6);

    // 二、按住方位块拖动：绕原来的观察中心转
    await resetPose(page, scene.basePose);
    const beforeDrag = await readPose(page);
    await page.mouse.move(gizmo.centerX, gizmo.centerY);
    await page.waitForTimeout(250);
    await page.mouse.down({ button: 'left' });
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(gizmo.centerX + 3 * i, gizmo.centerY + i);
      await page.waitForTimeout(20);
    }
    await page.mouse.up({ button: 'left' });
    await waitStable(page);
    const dragged = poseDelta(beforeDrag, await readPose(page));
    note('按住方位块拖动', `相机转了 ${round(dragged.deg)}°，观察中心挪了视距的 ${dragged.target.toExponential(1)} 倍，视距变为 ${round(dragged.distRatio, 6)} 倍`);
    expect(dragged.deg, '拖方位块应该真的转了').toBeGreaterThan(5);
    expect(dragged.target, '拖方位块不该挪观察中心').toBeLessThan(POSE_EPS);
    expect(Math.abs(dragged.distRatio - 1), '拖方位块不该改视距').toBeLessThan(1e-6);

    // 三、定位飞行：光标还悬停在构件上、刚用悬停焦点滚过滚轮，落点要和直接跳过去的一样
    await resetPose(page, scene.basePose);
    await wheel(page, scene, { at: scene.hover.at, deltaY: -100, count: 2, track: [] });
    const box: Box6 = [200, 200, 200, 260, 260, 260];
    const landing = await landingOf(page, box);
    const span = len(sub(landing.pos, landing.target));
    await page.evaluate((aabb) => {
      (window as any).__xeokitViewer.cameraFlight.flyTo({ aabb, duration: 0.5, fit: true });
    }, box);
    await expect
      .poll(async () => len(sub((await readPose(page)).pos, landing.pos)) / span, { timeout: 8_000, message: '飞行应该落到目标盒子的取景位置' })
      .toBeLessThan(1e-6);
    await waitStable(page);
    const landed = await readPose(page);
    note('定位飞行', `落点和直接跳过去的差：相机 ${(len(sub(landed.pos, landing.pos)) / span).toExponential(1)}，观察中心 ${(len(sub(landed.target, landing.target)) / span).toExponential(1)}（都除以视距）`);
    expect(len(sub(landed.pos, landing.pos)) / span, '飞行落点（相机）不该被拉偏').toBeLessThan(1e-6);
    expect(len(sub(landed.target, landing.target)) / span, '飞行落点（观察中心）不该被拉偏').toBeLessThan(1e-6);

    // 四、惯性还没停的时候：刚绕悬停焦点甩了一下就去拖方位块、定位飞行。这时候焦点逻辑手里还攥着那个焦点，
    // 是它唯一有机会把别人的相机动作带偏的时机
    const flick = async (): Promise<number> => {
      await resetPose(page, scene.basePose);
      const from = scene.hover.at;
      const [dx, dy] = inward(scene, from, [180, 60]);
      await page.mouse.move(scene.rect.left + from.x, scene.rect.top + from.y);
      await page.waitForTimeout(150);
      await page.mouse.down({ button: 'left' });
      for (let i = 1; i <= 6; i += 1) {
        await page.mouse.move(scene.rect.left + from.x + (dx * i) / 6, scene.rect.top + from.y + (dy * i) / 6);
      }
      await page.mouse.up({ button: 'left' });
      // 松手后隔两帧再看一眼：相机还在转，说明惯性没停
      return page.evaluate(async () => {
        const camera = (window as any).__dtxViewer.camera;
        const before = camera.quaternion.clone();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return (before.angleTo(camera.quaternion) * 180) / Math.PI;
      });
    };

    // 方位块接手的那一刻记下观察中心：从那一刻起它不该再动
    await page.evaluate(() => {
      const w = window as any;
      const widget = w.__dtxViewer.gizmo;
      w.__viewFocusGizmoStart = null;
      const onStart = () => {
        widget.removeEventListener('start', onStart);
        w.__viewFocusGizmoStart = { pos: w.__dtxViewer.camera.position.toArray(), target: w.__dtxViewer.controls.target.toArray() };
      };
      widget.addEventListener('start', onStart);
    });
    const spinBeforeGizmo = await flick();
    await page.mouse.move(gizmo.centerX, gizmo.centerY);
    await page.mouse.down({ button: 'left' });
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(gizmo.centerX + 3 * i, gizmo.centerY + i);
      await page.waitForTimeout(20);
    }
    await page.mouse.up({ button: 'left' });
    await waitStable(page);
    const taken = await page.evaluate(() => (window as any).__viewFocusGizmoStart as CameraSpot | null);
    expect(taken, '方位块应该接手了这次拖动').not.toBeNull();
    const afterGizmo = await readPose(page);
    const spanAtStart = len(sub(taken!.pos, taken!.target));
    const gizmoTargetMoved = len(sub(afterGizmo.target, taken!.target)) / spanAtStart;
    const gizmoDistRatio = len(sub(afterGizmo.pos, afterGizmo.target)) / spanAtStart;
    note('惯性还没停就拖方位块', `接手前相机两帧还在转 ${round(spinBeforeGizmo, 2)}°；接手之后观察中心挪了视距的 ${gizmoTargetMoved.toExponential(1)} 倍，视距变为 ${round(gizmoDistRatio, 6)} 倍`);
    expect(spinBeforeGizmo, '对照：松手之后相机应该还带着惯性在转').toBeGreaterThan(0.05);
    expect(gizmoTargetMoved, '惯性还没停就拖方位块：接手之后观察中心不该再被焦点带着走').toBeLessThan(POSE_EPS);
    expect(Math.abs(gizmoDistRatio - 1), '惯性还没停就拖方位块：不该改视距').toBeLessThan(1e-6);

    // 起飞那一刻相机还在转，落定时的观察方向跟起飞在哪一帧有关，所以只比观察中心和视距：
    // 焦点逻辑要是插手，是把相机和观察中心一起挪走，观察中心就不在目标盒子正中了
    const spinBeforeFly = await flick();
    await page.evaluate((aabb) => {
      (window as any).__xeokitViewer.cameraFlight.flyTo({ aabb, duration: 0.5, fit: true });
    }, box);
    await page.waitForTimeout(700);
    await waitStable(page);
    const flown = await readPose(page);
    const expected = await landingOf(page, box);
    const flownTarget = len(sub(flown.target, expected.target)) / span;
    const flownDist = len(sub(flown.pos, flown.target)) / len(sub(expected.pos, expected.target));
    note('惯性还没停就定位飞行', `起飞前相机两帧还在转 ${round(spinBeforeFly, 2)}°；落定后观察中心和直接跳过去的差 ${flownTarget.toExponential(1)}（除以视距），视距是直接跳过去的 ${round(flownDist, 5)} 倍`);
    expect(spinBeforeFly, '对照：松手之后相机应该还带着惯性在转').toBeGreaterThan(0.05);
    expect(flownTarget, '惯性还没停就定位飞行：落点（观察中心）不该被拉偏').toBeLessThan(1e-6);
    expect(Math.abs(flownDist - 1), '惯性还没停就定位飞行：落点（视距）不该被拉偏').toBeLessThan(1e-6);
  });
});
