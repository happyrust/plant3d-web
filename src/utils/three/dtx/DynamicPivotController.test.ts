import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Box3, OrthographicCamera, PerspectiveCamera, Quaternion, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { bindDynamicPivotToCanvas } from './DynamicPivotCanvasBinding';
import { DynamicPivotController, type DynamicPivotConfig } from './DynamicPivotController';

import type { DTXLayer } from './DTXLayer';
import type { DTXSelectionController } from './selection/DTXSelectionController';

const DEFAULT_PICK_OBJECT_ID = 'o:1_1:0';
const LONG_PRESS_MS = 300;

type TestHarnessOptions = {
  enableDamping?: boolean;
  cameraPosition?: Vector3;
  target?: Vector3;
  selectedObjectIds?: string[];
  objectBoxes?: Record<string, Box3>;
  visibleMap?: Record<string, boolean>;
  pickHit?: Vector3 | null;
  config?: DynamicPivotConfig;
};

function createTestCanvas(width = 1000, height = 800): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(canvas, 'clientHeight', { value: height, configurable: true });
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  document.body.appendChild(canvas);
  return canvas;
}

function projectToNdc(point: Vector3, camera: PerspectiveCamera): Vector3 {
  camera.updateMatrixWorld(true);
  return point.clone().project(camera);
}

/** 这一点此刻落在画布的哪个像素上（画布 1000×800，见 createTestCanvas 的默认值） */
function projectToCanvas(point: Vector3, camera: PerspectiveCamera): { x: number; y: number } {
  const ndc = projectToNdc(point, camera);
  return { x: (ndc.x * 0.5 + 0.5) * 1000, y: (0.5 - ndc.y * 0.5) * 800 };
}

/** 两次投影落在屏幕同一处（NDC 差不到万分之一，1000 像素宽的画布上不到 0.05 px） */
function expectSameNdc(after: Vector3, before: Vector3): void {
  expect(Math.abs(after.x - before.x)).toBeLessThan(1e-4);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1e-4);
}

/** 这一点此刻正落在画布的 (x, y) 上（差不到百分之一像素） */
function expectAtCanvasPixel(point: Vector3, camera: PerspectiveCamera, x: number, y: number): void {
  const at = projectToCanvas(point, camera);
  expect(Math.abs(at.x - x)).toBeLessThan(0.01);
  expect(Math.abs(at.y - y)).toBeLessThan(0.01);
}

type CameraRig = { camera: PerspectiveCamera; controls: OrbitControls };

function snapshotCamera(rig: CameraRig) {
  return {
    position: rig.camera.position.clone(),
    quaternion: rig.camera.quaternion.clone(),
    target: rig.controls.target.clone(),
  };
}

/** 相机位置、朝向、target 都没动。朝向按分量比：两个相同的四元数用 angleTo 比，会带上 1e-8 量级的 acos 误差 */
function expectCameraUnmoved(rig: CameraRig, before: ReturnType<typeof snapshotCamera>): void {
  expect(rig.camera.position.distanceTo(before.position)).toBeLessThan(1e-9);
  expect(rig.controls.target.distanceTo(before.target)).toBeLessThan(1e-9);
  const now = rig.camera.quaternion;
  const was = before.quaternion;
  expect(
    Math.max(
      Math.abs(now.x - was.x),
      Math.abs(now.y - was.y),
      Math.abs(now.z - was.z),
      Math.abs(now.w - was.w),
    ),
  ).toBeLessThan(1e-9);
}

function createHarness(options: TestHarnessOptions = {}) {
  const canvas = createTestCanvas();
  const camera = new PerspectiveCamera(30, 1000 / 800, 0.1, 10000);
  camera.up.set(0, 0, 1);
  camera.position.copy(options.cameraPosition ?? new Vector3(0, -20, 0));

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = options.enableDamping ?? false;
  controls.dampingFactor = 0.2;
  controls.target.copy(options.target ?? new Vector3(0, 0, 0));
  controls.update();

  let currentPickHit: Vector3 | null = options.pickHit ?? null;
  let currentPickObjectId = DEFAULT_PICK_OBJECT_ID;
  let currentSelected = [...(options.selectedObjectIds ?? [])];
  const objectBoxes = options.objectBoxes ?? {};
  const visibleMap = { ...(options.visibleMap ?? {}) };
  const removedObjectIds = new Set<string>();

  const selectionController = {
    pickPoint: vi.fn(() => (currentPickHit ? { objectId: currentPickObjectId, point: currentPickHit.clone(), distance: 1 } : null)),
    getSelected: vi.fn(() => [...currentSelected]),
  } as unknown as DTXSelectionController;

  const dtxLayer = {
    hasObject: vi.fn((id: string) => !removedObjectIds.has(id)),
    isObjectVisible: vi.fn((id: string) => !removedObjectIds.has(id) && (visibleMap[id] ?? true)),
    getObjectBoundingBoxInto: vi.fn((id: string, target: Box3) => {
      const box = objectBoxes[id];
      return box ? target.copy(box) : null;
    }),
  } as unknown as DTXLayer;

  const controller = new DynamicPivotController(
    controls,
    selectionController,
    dtxLayer,
    options.config,
  );

  // 和 ViewerPanel 用的是同一份接线：测到的就是页面上真正跑的那一段
  const unbind = bindDynamicPivotToCanvas({ canvas, controls, getController: () => controller });

  const dispatchPointer = (
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    x: number,
    y: number,
    init: PointerEventInit = {},
  ) => {
    const defaultButton = type === 'pointermove' ? -1 : 0;
    const defaultButtons = type === 'pointerup' ? 0 : 1;
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        button: init.button ?? defaultButton,
        buttons: init.buttons ?? defaultButtons,
        ...init,
      }),
    );
  };

  const dispatchWheel = (x: number, y: number, deltaY: number) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaMode: 0 });
    // happy-dom 的 WheelEvent 不认构造参数里的鼠标坐标，这里补上
    Object.defineProperty(event, 'clientX', { value: x });
    Object.defineProperty(event, 'clientY', { value: y });
    canvas.dispatchEvent(event);
  };

  const cleanup = () => {
    unbind();
    controller.dispose();
    controls.dispose();
    canvas.remove();
  };

  return {
    canvas,
    camera,
    controls,
    controller,
    selectionController,
    dtxLayer,
    /** 光标下命中的点（null = 空白处），以及命中的是哪个构件 */
    setPickHit(hit: Vector3 | null, objectId = DEFAULT_PICK_OBJECT_ID) {
      currentPickHit = hit;
      currentPickObjectId = objectId;
    },
    setSelected(ids: string[]) {
      currentSelected = [...ids];
    },
    setObjectVisible(id: string, visible: boolean) {
      visibleMap[id] = visible;
    },
    removeObject(id: string) {
      removedObjectIds.add(id);
    },
    /** 左键按住不动直到长按触发，再松手 */
    longPress(x: number, y: number) {
      dispatchPointer('pointerdown', x, y);
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      dispatchPointer('pointerup', x, y);
    },
    dispatchPointer,
    dispatchWheel,
    cleanup,
  };
}

describe('DynamicPivotController', () => {
  const cleanups: (() => void)[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
    vi.useRealTimers();
  });

  describe('焦点解析优先级（Hover 优先，选中构件兜底）', () => {
    it('光标下有 Hover 命中时优先返回 Hover 点，即使同时存在选中构件', () => {
      const hoverPoint = new Vector3(4, 2, 1);
      const h = createHarness({
        pickHit: hoverPoint,
        selectedObjectIds: ['o:1_1:0'],
        objectBoxes: {
          'o:1_1:0': new Box3(new Vector3(-10, -2, -1), new Vector3(-8, 0, 1)),
        },
      });
      cleanups.push(h.cleanup);

      const resolved = h.controller.resolveFocusPoint(new Vector2(600, 350));
      expect(resolved?.source).toBe('hover');
      expect(resolved?.point.distanceTo(hoverPoint)).toBeLessThan(1e-6);
    });

    it('光标在空白处时回退到可见选中构件的联合包围盒中心（含 resolveSelectedBounds 子树）', () => {
      const h = createHarness({
        pickHit: null,
        selectedObjectIds: ['o:1_1:0', 'o:1_2:0'],
        visibleMap: {
          'o:1_1:0': true,
          'o:1_2:0': false,
        },
        objectBoxes: {
          'o:1_1:0': new Box3(new Vector3(2, 0, 0), new Vector3(4, 2, 2)),
          'o:1_2:0': new Box3(new Vector3(100, 100, 100), new Vector3(110, 110, 110)),
        },
        config: {
          resolveSelectedBounds: (target) =>
            target.set(new Vector3(6, 0, 0), new Vector3(8, 2, 2)),
        },
      });
      cleanups.push(h.cleanup);

      const resolved = h.controller.resolveFocusPoint(new Vector2(500, 400));
      expect(resolved?.source).toBe('selection');
      // 联合 [2..4, 0..2, 0..2] 与 [6..8, 0..2, 0..2] => [2..8, 0..2, 0..2]，中心 (5, 1, 1)
      expect(resolved?.point.distanceTo(new Vector3(5, 1, 1))).toBeLessThan(1e-6);
    });

    it('选中构件的中心不在画面里（出了画面，或到了相机背后）就不当焦点；回到画面里又用它', () => {
      // 默认相机在 (0,-20,0) 朝 +Y 看：20 远处左右各看得到约 6.7，上下各约 5.4
      const boxes: Record<string, Box3> = {};
      const centerAt = (x: number, y: number, z: number) => {
        boxes['o:1_1:0'] = new Box3(new Vector3(x - 1, y - 1, z - 1), new Vector3(x + 1, y + 1, z + 1));
      };
      const h = createHarness({ pickHit: null, selectedObjectIds: ['o:1_1:0'], objectBoxes: boxes });
      cleanups.push(h.cleanup);
      const cursor = new Vector2(700, 300);

      centerAt(5, 0, 3);
      expect(h.controller.resolveFocusPoint(cursor, 'rotate')?.source).toBe('selection');

      // 右边出了画面：旋转、平移没有焦点，缩放改朝光标
      centerAt(9, 0, 0);
      expect(h.controller.resolveFocusPoint(cursor, 'rotate')).toBeNull();
      expect(h.controller.resolveFocusPoint(cursor, 'pan')).toBeNull();
      expect(h.controller.resolveFocusPoint(cursor, 'dolly')?.source).toBe('cursor');
      // 下边出了画面
      centerAt(0, 0, -7);
      expect(h.controller.resolveFocusPoint(cursor, 'rotate')).toBeNull();
      // 到了相机背后
      centerAt(0, -30, 0);
      expect(h.controller.resolveFocusPoint(cursor, 'rotate')).toBeNull();

      centerAt(-5, 0, -3);
      const back = h.controller.resolveFocusPoint(cursor, 'rotate');
      expect(back?.source).toBe('selection');
      expect(back?.point.distanceTo(new Vector3(-5, 0, -3))).toBeLessThan(1e-9);
    });

    it('选中构件的包围盒伸到了面前、中心却在相机背后：一样不当焦点，不再往前另找一个点', () => {
      const h = createHarness({
        cameraPosition: new Vector3(0, 0, 0),
        target: new Vector3(0, 10, 0),
        pickHit: null,
        selectedObjectIds: ['o:1_1:0'],
        objectBoxes: {
          'o:1_1:0': new Box3(new Vector3(1, -12, 0), new Vector3(3, 4, 2)),
        },
      });
      cleanups.push(h.cleanup);

      expect(h.controller.resolveFocusPoint(new Vector2(500, 400))).toBeNull();
    });

    it('无 Hover 且无选中构件时返回 null', () => {
      const h = createHarness({ pickHit: null, selectedObjectIds: [] });
      cleanups.push(h.cleanup);

      expect(h.controller.resolveFocusPoint(new Vector2(500, 400))).toBeNull();
    });
  });

  describe('绕焦点原地旋转（无瞬间跳变）', () => {
    it('按下鼠标时视角不跳变；拖动旋转偏离中心的 Hover 点时焦点屏幕 NDC 稳定不漂移', () => {
      const hoverPoint = new Vector3(3.5, 4.0, 1.5);
      const h = createHarness({
        cameraPosition: new Vector3(0, -20, 0),
        target: new Vector3(0, 0, 0),
        pickHit: hoverPoint,
      });
      cleanups.push(h.cleanup);

      const posBeforeDown = h.camera.position.clone();
      const quatBeforeDown = h.camera.quaternion.clone();
      const targetBeforeDown = h.controls.target.clone();
      const ndcBefore = projectToNdc(hoverPoint, h.camera);

      h.dispatchPointer('pointerdown', 650, 320, { button: 0 });

      // 按下瞬间零跳变
      expect(h.camera.position.distanceTo(posBeforeDown)).toBeLessThan(1e-9);
      expect(h.camera.quaternion.angleTo(quatBeforeDown)).toBeLessThan(1e-9);
      expect(h.controls.target.distanceTo(targetBeforeDown)).toBeLessThan(1e-9);

      // 连续左键拖拽旋转
      h.dispatchPointer('pointermove', 730, 270, { button: 0 });
      h.dispatchPointer('pointermove', 810, 230, { button: 0 });
      h.dispatchPointer('pointerup', 810, 230, { button: 0 });

      // 相机确实旋转了且相机到焦点的距离保持恒定（绕焦点轨道旋转）
      expect(h.camera.quaternion.angleTo(quatBeforeDown)).toBeGreaterThan(0.05);
      const distBefore = posBeforeDown.distanceTo(hoverPoint);
      const distAfter = h.camera.position.distanceTo(hoverPoint);
      expect(Math.abs(distAfter - distBefore)).toBeLessThan(1e-4);

      // 焦点在屏幕上的 NDC 投影位置全程不变
      const ndcAfter = projectToNdc(hoverPoint, h.camera);
      expect(Math.abs(ndcAfter.x - ndcBefore.x)).toBeLessThan(1e-4);
      expect(Math.abs(ndcAfter.y - ndcBefore.y)).toBeLessThan(1e-4);
    });

    it('开启阻尼并在空白处拖拽时，围绕选中构件中心旋转且松手阻尼帧继续保持焦点稳定', () => {
      const selectionCenter = new Vector3(-4, 5, 2);
      const h = createHarness({
        enableDamping: true,
        cameraPosition: new Vector3(0, -25, 0),
        target: new Vector3(0, 0, 0),
        pickHit: null,
        selectedObjectIds: ['o:2_1:0'],
        objectBoxes: {
          'o:2_1:0': new Box3(
            selectionCenter.clone().addScalar(-1),
            selectionCenter.clone().addScalar(1),
          ),
        },
      });
      cleanups.push(h.cleanup);

      const ndcBefore = projectToNdc(selectionCenter, h.camera);
      const distBefore = h.camera.position.distanceTo(selectionCenter);

      h.dispatchPointer('pointerdown', 500, 400, { button: 0 });
      h.dispatchPointer('pointermove', 620, 360, { button: 0 });
      h.dispatchPointer('pointerup', 620, 360, { button: 0 });

      // 模拟松手后多帧阻尼惯性更新
      const quatAtRelease = h.camera.quaternion.clone();
      for (let i = 0; i < 15; i += 1) {
        h.controls.update();
      }

      expect(h.camera.quaternion.angleTo(quatAtRelease)).toBeGreaterThan(0.02);
      expect(Math.abs(h.camera.position.distanceTo(selectionCenter) - distBefore)).toBeLessThan(1e-4);

      const ndcAfterDamping = projectToNdc(selectionCenter, h.camera);
      expect(Math.abs(ndcAfterDamping.x - ndcBefore.x)).toBeLessThan(1e-4);
      expect(Math.abs(ndcAfterDamping.y - ndcBefore.y)).toBeLessThan(1e-4);
    });

    it('外部 flyTo 直接改写相机与 target 时自动退出在途旋转枢轴约束', () => {
      const hoverPoint = new Vector3(3, 4, 1);
      const h = createHarness({
        enableDamping: true,
        cameraPosition: new Vector3(0, -20, 0),
        target: new Vector3(0, 0, 0),
        pickHit: hoverPoint,
      });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 600, 400, { button: 0 });
      h.dispatchPointer('pointermove', 660, 380, { button: 0 });
      h.dispatchPointer('pointerup', 660, 380, { button: 0 });

      // 模拟外部 flyTo 接管相机位置与目标点
      const flyPos = new Vector3(50, -50, 10);
      const flyTarget = new Vector3(50, 0, 10);
      h.camera.position.copy(flyPos);
      h.controls.target.copy(flyTarget);
      h.controls.update();

      // 不会把 target 拽回 hoverPoint 附近
      expect(h.controls.target.distanceTo(flyTarget)).toBeLessThan(1e-3);
    });

    it('真实浏览器 pointermove（button=-1, buttons=1）拖动旋转偏心 Hover 点与选中兜底均锁定焦点', () => {
      const hoverPoint = new Vector3(4.5, 3.0, 2.0);
      const h = createHarness({
        enableDamping: true,
        cameraPosition: new Vector3(0, -25, 0),
        target: new Vector3(0, 0, 0),
        pickHit: hoverPoint,
      });
      cleanups.push(h.cleanup);

      const ndcBefore = projectToNdc(hoverPoint, h.camera);
      const distBefore = h.camera.position.distanceTo(hoverPoint);

      h.dispatchPointer('pointerdown', 720, 310, { button: 0, buttons: 1 });
      h.dispatchPointer('pointermove', 880, 290, { button: -1, buttons: 1 });
      h.dispatchPointer('pointerup', 880, 290, { button: 0, buttons: 0 });
      for (let i = 0; i < 10; i += 1) h.controls.update();

      const ndcAfterHover = projectToNdc(hoverPoint, h.camera);
      expect(Math.abs(ndcAfterHover.x - ndcBefore.x)).toBeLessThan(1e-4);
      expect(Math.abs(ndcAfterHover.y - ndcBefore.y)).toBeLessThan(1e-4);
      expect(Math.abs(h.camera.position.distanceTo(hoverPoint) - distBefore)).toBeLessThan(1e-4);

      const selectionCenter = new Vector3(-5, 4, 1);
      h.setPickHit(null);
      h.setSelected(['o:9_1:0']);
      h.dtxLayer.getObjectBoundingBoxInto = vi.fn((_id: string, target: Box3) =>
        target.set(selectionCenter.clone().addScalar(-1), selectionCenter.clone().addScalar(1)),
      );
      const selNdcBefore = projectToNdc(selectionCenter, h.camera);
      const selDistBefore = h.camera.position.distanceTo(selectionCenter);

      h.dispatchPointer('pointerdown', 300, 220, { button: 0, buttons: 1 });
      h.dispatchPointer('pointermove', 450, 220, { button: -1, buttons: 0 });
      h.dispatchPointer('pointerup', 450, 220, { button: 0, buttons: 0 });
      for (let i = 0; i < 10; i += 1) h.controls.update();

      const selNdcAfter = projectToNdc(selectionCenter, h.camera);
      expect(Math.abs(selNdcAfter.x - selNdcBefore.x)).toBeLessThan(1e-4);
      expect(Math.abs(selNdcAfter.y - selNdcBefore.y)).toBeLessThan(1e-4);
      expect(Math.abs(h.camera.position.distanceTo(selectionCenter) - selDistBefore)).toBeLessThan(1e-4);
    });
  });

  describe('绕焦点平滑缩放（滚轮与中键）', () => {
    it('滚轮缩放时以偏心 Hover 点为同位中心缩放，焦点 NDC 坐标不漂移且相机朝向不变', () => {
      const hoverPoint = new Vector3(4, 5, 1.5);
      const h = createHarness({
        cameraPosition: new Vector3(0, -20, 0),
        target: new Vector3(0, 0, 0),
        pickHit: hoverPoint,
      });
      cleanups.push(h.cleanup);

      const quatBefore = h.camera.quaternion.clone();
      const ndcBefore = projectToNdc(hoverPoint, h.camera);
      const distBefore = h.camera.position.distanceTo(hoverPoint);

      // 连续滚轮放大 3 次
      h.dispatchWheel(680, 310, -120);
      h.dispatchWheel(680, 310, -120);
      h.dispatchWheel(680, 310, -120);

      const distAfter = h.camera.position.distanceTo(hoverPoint);
      expect(distAfter).toBeLessThan(distBefore * 0.9);
      expect(h.camera.quaternion.angleTo(quatBefore)).toBeLessThan(1e-6);

      const ndcAfter = projectToNdc(hoverPoint, h.camera);
      expect(Math.abs(ndcAfter.x - ndcBefore.x)).toBeLessThan(1e-4);
      expect(Math.abs(ndcAfter.y - ndcBefore.y)).toBeLessThan(1e-4);
    });

    it('光标在空白处时滚轮围绕选中构件中心缩放，且中键拖拽同样围绕焦点缩放', () => {
      const selectionCenter = new Vector3(-3, 2, -1);
      const h = createHarness({
        cameraPosition: new Vector3(0, -20, 0),
        target: new Vector3(0, 0, 0),
        pickHit: null,
        selectedObjectIds: ['o:3_1:0'],
        objectBoxes: {
          'o:3_1:0': new Box3(
            selectionCenter.clone().addScalar(-0.5),
            selectionCenter.clone().addScalar(0.5),
          ),
        },
      });
      cleanups.push(h.cleanup);

      const ndcBefore = projectToNdc(selectionCenter, h.camera);
      const distBefore = h.camera.position.distanceTo(selectionCenter);

      // 滚轮放大
      h.dispatchWheel(200, 150, -120);
      const distAfterWheel = h.camera.position.distanceTo(selectionCenter);
      expect(distAfterWheel).toBeLessThan(distBefore);
      const ndcAfterWheel = projectToNdc(selectionCenter, h.camera);
      expect(Math.abs(ndcAfterWheel.x - ndcBefore.x)).toBeLessThan(1e-4);
      expect(Math.abs(ndcAfterWheel.y - ndcBefore.y)).toBeLessThan(1e-4);

      // 中键向下拖拽缩小（dollyOut）
      h.dispatchPointer('pointerdown', 200, 150, { button: 1 });
      h.dispatchPointer('pointermove', 200, 250, { button: 1 });
      h.dispatchPointer('pointerup', 200, 250, { button: 1 });

      const distAfterDolly = h.camera.position.distanceTo(selectionCenter);
      expect(distAfterDolly).toBeGreaterThan(distAfterWheel);
      const ndcAfterDolly = projectToNdc(selectionCenter, h.camera);
      expect(Math.abs(ndcAfterDolly.x - ndcBefore.x)).toBeLessThan(1e-4);
      expect(Math.abs(ndcAfterDolly.y - ndcBefore.y)).toBeLessThan(1e-4);
    });

    it('无 Hover 且无选中时接近旧 target 放大不会撞上缩放死墙', () => {
      const h = createHarness({
        cameraPosition: new Vector3(0, -0.05, 0),
        target: new Vector3(0, 0, 0),
        pickHit: null,
        selectedObjectIds: [],
      });
      cleanups.push(h.cleanup);

      const yBefore = h.camera.position.y;
      h.dispatchWheel(500, 400, -120);
      // target 被前推后，相机可以继续向前推进足够步幅
      expect(h.camera.position.y - yBefore).toBeGreaterThan(0.02);
    });
  });

  describe('空白处缩放朝光标（没有悬停，也没有可用的选中构件）', () => {
    /** 光标位置：不在画面正中 */
    const CURSOR = new Vector2(700, 300);
    /** 竖直视场 30°：离相机 1 远处，画面中线到上边缘的距离 */
    const HALF_HEIGHT_PER_DEPTH = Math.tan((15 * Math.PI) / 180);
    /**
     * 默认相机在 (0,-20,0) 朝 +Y 看，画布 1000×800：光标 (700, 300) 那条视线和 target 所在深度（离相机 20）的交点。
     * 光标在画面中线右边 40%、上边 25% 处，画面宽是高的 1.25 倍
     */
    const UNDER_CURSOR = new Vector3(0.4 * 1.25 * 20 * HALF_HEIGHT_PER_DEPTH, 0, 0.25 * 20 * HALF_HEIGHT_PER_DEPTH);
    /** 滚轮一格（deltaY = ±120）的缩放比例：OrbitControls 用的是 0.95^(|deltaY| / 100) */
    const WHEEL_STEP_SCALE = Math.pow(0.95, 1.2);

    it('滚轮放大、缩小：光标下的那一点留在光标下，相机不转，快慢和在画面正中滚一样', () => {
      const h = createHarness({ pickHit: null });
      cleanups.push(h.cleanup);
      expectAtCanvasPixel(UNDER_CURSOR, h.camera, CURSOR.x, CURSOR.y);
      const before = snapshotCamera(h);
      const distanceBefore = before.position.distanceTo(UNDER_CURSOR);

      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expectAtCanvasPixel(UNDER_CURSOR, h.camera, CURSOR.x, CURSOR.y);
      expect(h.camera.position.distanceTo(UNDER_CURSOR)).toBeCloseTo(distanceBefore * WHEEL_STEP_SCALE, 6);
      expect(h.camera.position.distanceTo(h.controls.target)).toBeCloseTo(20 * WHEEL_STEP_SCALE, 6);

      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expectAtCanvasPixel(UNDER_CURSOR, h.camera, CURSOR.x, CURSOR.y);

      for (let i = 0; i < 5; i += 1) h.dispatchWheel(CURSOR.x, CURSOR.y, 120);
      expectAtCanvasPixel(UNDER_CURSOR, h.camera, CURSOR.x, CURSOR.y);
      expect(h.camera.position.distanceTo(h.controls.target)).toBeCloseTo(20 / WHEEL_STEP_SCALE ** 2, 6);
      expect(h.camera.quaternion.angleTo(before.quaternion)).toBeLessThan(1e-6);
    });

    it('按住中键拖动：朝按下的那一点缩放，那一点留在原处，不跟着光标跑', () => {
      const h = createHarness({ pickHit: null });
      cleanups.push(h.cleanup);
      const distanceBefore = h.camera.position.distanceTo(UNDER_CURSOR);

      h.dispatchPointer('pointerdown', CURSOR.x, CURSOR.y, { button: 1, buttons: 4 });
      h.dispatchPointer('pointermove', CURSOR.x, CURSOR.y - 80, { buttons: 4 });
      expectAtCanvasPixel(UNDER_CURSOR, h.camera, CURSOR.x, CURSOR.y);
      expect(h.camera.position.distanceTo(UNDER_CURSOR)).toBeLessThan(distanceBefore * 0.97);

      h.dispatchPointer('pointermove', CURSOR.x + 30, CURSOR.y + 120, { buttons: 4 });
      expectAtCanvasPixel(UNDER_CURSOR, h.camera, CURSOR.x, CURSOR.y);
      expect(h.camera.position.distanceTo(UNDER_CURSOR)).toBeGreaterThan(distanceBefore);
      h.dispatchPointer('pointerup', CURSOR.x + 30, CURSOR.y + 120, { button: 1, buttons: 0 });
    });

    it('画面里有选中构件时，空白处缩放仍朝选中构件，不朝光标', () => {
      const selectionCenter = new Vector3(-3, 2, -1);
      const h = createHarness({
        pickHit: null,
        selectedObjectIds: ['o:3_1:0'],
        objectBoxes: {
          'o:3_1:0': new Box3(
            selectionCenter.clone().addScalar(-0.5),
            selectionCenter.clone().addScalar(0.5),
          ),
        },
      });
      cleanups.push(h.cleanup);

      expect(h.controller.resolveFocusPoint(CURSOR, 'dolly')?.source).toBe('selection');
    });

    it('贴着 target 放大：先把 target 前推，再按前推之后的深度取光标下的点', () => {
      const h = createHarness({
        cameraPosition: new Vector3(0, -0.05, 0),
        target: new Vector3(0, 0, 0),
        pickHit: null,
      });
      cleanups.push(h.cleanup);
      // 前推之后 target 离相机 1：光标那条视线在这个深度上的点
      const underCursor = new Vector3(0.4 * 1.25 * HALF_HEIGHT_PER_DEPTH, -0.05 + 1, 0.25 * HALF_HEIGHT_PER_DEPTH);
      const distanceBefore = h.camera.position.distanceTo(underCursor);

      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);

      expectAtCanvasPixel(underCursor, h.camera, CURSOR.x, CURSOR.y);
      expect(h.camera.position.distanceTo(underCursor)).toBeCloseTo(distanceBefore * WHEEL_STEP_SCALE, 6);
      expect(h.camera.position.distanceTo(h.controls.target)).toBeCloseTo(WHEEL_STEP_SCALE, 6);
    });

    it('算不出光标下的点就不给光标焦点：光标坐标不是数、画布还没有尺寸、target 贴在相机上', () => {
      const h = createHarness({ pickHit: null });
      cleanups.push(h.cleanup);
      expect(h.controller.resolveFocusPoint(CURSOR, 'dolly')?.source).toBe('cursor');

      expect(h.controller.resolveFocusPoint(new Vector2(Number.NaN, 300), 'dolly')).toBeNull();

      Object.defineProperty(h.canvas, 'clientHeight', { value: 0, configurable: true });
      expect(h.controller.resolveFocusPoint(CURSOR, 'dolly')).toBeNull();

      const stuck = createHarness({
        cameraPosition: new Vector3(0, 0, 0),
        target: new Vector3(0, 0, 0),
        pickHit: null,
      });
      cleanups.push(stuck.cleanup);
      expect(stuck.controller.resolveFocusPoint(CURSOR, 'dolly')).toBeNull();
    });

    it('正交相机没有「朝光标」这回事：空白处缩放不给光标焦点', () => {
      const canvas = createTestCanvas();
      const camera = new OrthographicCamera(-10, 10, 8, -8, 0.1, 1000);
      camera.up.set(0, 0, 1);
      camera.position.set(0, -20, 0);
      const controls = new OrbitControls(camera, canvas);
      controls.update();
      const controller = new DynamicPivotController(
        controls,
        { pickPoint: () => null, getSelected: () => [] } as unknown as DTXSelectionController,
        {} as unknown as DTXLayer,
      );
      cleanups.push(() => {
        controller.dispose();
        controls.dispose();
        canvas.remove();
      });

      expect(controller.resolveFocusPoint(CURSOR, 'dolly')).toBeNull();
    });
  });

  describe('连续滚动时复用选中中心（一轮连续滚动只算一次）', () => {
    /** 光标位置：空白处，不在画面正中 */
    const CURSOR = new Vector2(700, 300);
    /** 相邻两格滚轮相隔不超过这么久算同一轮（和实现里的 WHEEL_ROUND_GAP_MS 一致） */
    const ROUND_GAP_MS = 200;
    /** 连续滚动时相邻两格的间隔 */
    const NOTCH_MS = 60;
    /** 滚轮一格（deltaY = ±120）的缩放比例：OrbitControls 用的是 0.95^(|deltaY| / 100) */
    const WHEEL_STEP_SCALE = Math.pow(0.95, 1.2);
    /** 默认相机下，光标 (700, 300) 那条视线和 target 所在深度（离相机 20）的交点：竖直视场 30°，画布 1000×800 */
    const UNDER_CURSOR = new Vector3(
      0.4 * 1.25 * 20 * Math.tan((15 * Math.PI) / 180),
      0,
      0.25 * 20 * Math.tan((15 * Math.PI) / 180),
    );
    const SELECTED_ID = 'o:3_1:0';
    const OTHER_ID = 'o:3_2:0';
    const FIRST_CENTER = new Vector3(-3, 2, -1);
    const SECOND_CENTER = new Vector3(4, 1, 2);
    const boxAround = (center: Vector3) => new Box3(center.clone().addScalar(-0.5), center.clone().addScalar(0.5));

    /**
     * 选中了一个构件（中心 FIRST_CENTER，在画面里）、光标在空白处；另有一个没选中的构件（中心 SECOND_CENTER）备着换选中用。
     * `computed()`：到此刻一共算了几次选中中心（每算一次要向选择控制器问一次选中了谁）
     */
    function createSelectionHarness() {
      const h = createHarness({
        pickHit: null,
        selectedObjectIds: [SELECTED_ID],
        objectBoxes: { [SELECTED_ID]: boxAround(FIRST_CENTER), [OTHER_ID]: boxAround(SECOND_CENTER) },
      });
      cleanups.push(h.cleanup);
      const computed = () => vi.mocked(h.selectionController.getSelected).mock.calls.length;
      return { h, computed };
    }

    /** 隔 NOTCH_MS 再滚一格（同一轮） */
    function nextNotch(h: ReturnType<typeof createHarness>, deltaY = -120): void {
      vi.advanceTimersByTime(NOTCH_MS);
      h.dispatchWheel(CURSOR.x, CURSOR.y, deltaY);
    }

    it('空白处连续滚 6 格：选中中心只算一次，每一格都朝它缩放', () => {
      const { h, computed } = createSelectionHarness();
      const ndcBefore = projectToNdc(FIRST_CENTER, h.camera);
      let distance = h.camera.position.distanceTo(FIRST_CENTER);

      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      for (let i = 0; i < 6; i += 1) {
        if (i > 0) nextNotch(h);
        expectSameNdc(projectToNdc(FIRST_CENTER, h.camera), ndcBefore);
        expect(h.camera.position.distanceTo(FIRST_CENTER)).toBeCloseTo(distance * WHEEL_STEP_SCALE, 6);
        distance = h.camera.position.distanceTo(FIRST_CENTER);
      }

      expect(computed()).toBe(1);
    });

    it('停顿超过 200 毫秒算新的一轮，重新算；刚好 200 毫秒还算同一轮', () => {
      const { h, computed } = createSelectionHarness();
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expect(computed()).toBe(1);

      vi.advanceTimersByTime(ROUND_GAP_MS);
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expect(computed()).toBe(1);

      vi.advanceTimersByTime(ROUND_GAP_MS + 1);
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expect(computed()).toBe(2);
    });

    it('间隔按相邻两格算，不按这一轮的头一格算：每格相隔 150 毫秒来回滚 9 格，仍是同一轮', () => {
      const { h, computed } = createSelectionHarness();
      for (let i = 0; i < 9; i += 1) {
        if (i > 0) vi.advanceTimersByTime(150);
        h.dispatchWheel(CURSOR.x, CURSOR.y, i % 2 === 0 ? -120 : 120);
      }
      expect(computed()).toBe(1);
    });

    it('这一轮中途选中变了：这一轮接着朝原来的中心缩放，下一轮才跟上', () => {
      const { h, computed } = createSelectionHarness();
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      h.setSelected([OTHER_ID]);

      const firstNdc = projectToNdc(FIRST_CENTER, h.camera);
      nextNotch(h);
      expectSameNdc(projectToNdc(FIRST_CENTER, h.camera), firstNdc);
      expect(computed()).toBe(1);

      vi.advanceTimersByTime(ROUND_GAP_MS + 1);
      const secondNdc = projectToNdc(SECOND_CENTER, h.camera);
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expectSameNdc(projectToNdc(SECOND_CENTER, h.camera), secondNdc);
      expect(computed()).toBe(2);
    });

    it('按下鼠标就结束这一轮：点选换了选中之后紧接着滚，朝新的选中缩放', () => {
      const { h } = createSelectionHarness();
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);

      // 单击（选中换成另一个构件），前后离两格滚轮都不到 200 毫秒
      vi.advanceTimersByTime(40);
      h.dispatchPointer('pointerdown', CURSOR.x, CURSOR.y);
      h.dispatchPointer('pointerup', CURSOR.x, CURSOR.y);
      h.setSelected([OTHER_ID]);

      vi.advanceTimersByTime(40);
      const secondNdc = projectToNdc(SECOND_CENTER, h.camera);
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expectSameNdc(projectToNdc(SECOND_CENTER, h.camera), secondNdc);
    });

    it('每一格照旧先看光标下有没有构件：中途光标下有了构件就朝它缩放，没了再回到选中中心，不重算', () => {
      const { h, computed } = createSelectionHarness();
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expect(computed()).toBe(1);

      const hoverPoint = new Vector3(2, 3, 1);
      h.setPickHit(hoverPoint);
      const hoverNdc = projectToNdc(hoverPoint, h.camera);
      nextNotch(h);
      expectSameNdc(projectToNdc(hoverPoint, h.camera), hoverNdc);

      h.setPickHit(null);
      const centerNdc = projectToNdc(FIRST_CENTER, h.camera);
      nextNotch(h);
      expectSameNdc(projectToNdc(FIRST_CENTER, h.camera), centerNdc);
      expect(computed()).toBe(1);
    });

    it('这一轮的头一格在构件上，用不着选中中心就不算；到了空白处才算，之后复用', () => {
      const { h, computed } = createSelectionHarness();
      h.setPickHit(new Vector3(2, 3, 1));
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expect(computed()).toBe(0);

      h.setPickHit(null);
      nextNotch(h);
      expect(computed()).toBe(1);
      nextNotch(h);
      nextNotch(h);
      expect(computed()).toBe(1);
    });

    it('没有选中也只问一次：这一轮后面的格子直接朝光标缩放', () => {
      const resolveSelectedBounds = vi.fn(() => null);
      const h = createHarness({ pickHit: null, config: { resolveSelectedBounds } });
      cleanups.push(h.cleanup);
      expectAtCanvasPixel(UNDER_CURSOR, h.camera, CURSOR.x, CURSOR.y);

      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      for (let i = 0; i < 5; i += 1) {
        if (i > 0) nextNotch(h);
        expectAtCanvasPixel(UNDER_CURSOR, h.camera, CURSOR.x, CURSOR.y);
      }

      expect(resolveSelectedBounds).toHaveBeenCalledTimes(1);
      expect(h.selectionController.getSelected).toHaveBeenCalledTimes(1);
    });

    it('选中中心在不在画面里每一格现判：在画面外就朝光标，这一轮中途进了画面就用它，再出去又朝光标，都不重算', () => {
      const { h, computed } = createSelectionHarness();
      /** 相机整个往右挪 12：选中中心到了画面左边之外；这时光标下（和 target 同深度）的那一点 */
      const underCursorAside = UNDER_CURSOR.clone().add(new Vector3(12, 0, 0));
      const moveCamera = (x: number) => {
        h.camera.position.set(x, -20, 0);
        h.controls.target.set(x, 0, 0);
        h.controls.update();
      };

      // 这一轮的头一格：选中中心在画面外，朝光标缩放（包围盒中心照样算了、记下了）
      moveCamera(12);
      expectAtCanvasPixel(underCursorAside, h.camera, CURSOR.x, CURSOR.y);
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expectAtCanvasPixel(underCursorAside, h.camera, CURSOR.x, CURSOR.y);
      expect(computed()).toBe(1);

      // 别处把相机挪回来：选中中心进了画面，朝它缩放
      moveCamera(0);
      const centerNdc = projectToNdc(FIRST_CENTER, h.camera);
      nextNotch(h);
      expectSameNdc(projectToNdc(FIRST_CENTER, h.camera), centerNdc);

      // 又挪出去：改回朝光标
      moveCamera(12);
      nextNotch(h);
      expectAtCanvasPixel(underCursorAside, h.camera, CURSOR.x, CURSOR.y);
      expect(computed()).toBe(1);
    });

    it('clearPivot（场景清空）、cancelActiveGesture（别处接管相机）、停用再启用都结束这一轮：紧接着的一格重新算', () => {
      const { h, computed } = createSelectionHarness();
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      expect(computed()).toBe(1);

      h.controller.clearPivot();
      nextNotch(h);
      expect(computed()).toBe(2);

      h.controller.cancelActiveGesture();
      nextNotch(h);
      expect(computed()).toBe(3);

      h.controller.setEnabled(false);
      h.controller.setEnabled(true);
      nextNotch(h);
      expect(computed()).toBe(4);

      nextNotch(h);
      expect(computed()).toBe(4);
    });

    it('拖动起手不复用：这一轮里换了选中再在空白处按下左键拖，绕新的选中中心转', () => {
      const { h } = createSelectionHarness();
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      h.setSelected([OTHER_ID]);

      vi.advanceTimersByTime(NOTCH_MS);
      const quatBefore = h.camera.quaternion.clone();
      const secondNdc = projectToNdc(SECOND_CENTER, h.camera);
      h.dispatchPointer('pointerdown', CURSOR.x, CURSOR.y);
      h.dispatchPointer('pointermove', CURSOR.x + 80, CURSOR.y - 40);
      h.dispatchPointer('pointerup', CURSOR.x + 80, CURSOR.y - 40);

      expect(h.camera.quaternion.angleTo(quatBefore)).toBeGreaterThan(0.05);
      expectSameNdc(projectToNdc(SECOND_CENTER, h.camera), secondNdc);
    });

    it('对外的 resolveFocusPoint 不走复用：这一轮里问它，给的是按此刻的选中现算的', () => {
      const { h } = createSelectionHarness();
      h.dispatchWheel(CURSOR.x, CURSOR.y, -120);
      h.setSelected([OTHER_ID]);

      const focus = h.controller.resolveFocusPoint(CURSOR);
      expect(focus?.source).toBe('selection');
      expect(focus?.point.distanceTo(SECOND_CENTER)).toBeLessThan(1e-9);
    });
  });

  describe('等深 1:1 拖拽平移（Pan）', () => {
    it('右键起拖时 target 深度对齐到焦点前向深度，相机不旋转且平移量与焦点深度成正比', () => {
      const nearHover = new Vector3(0, -10, 0);
      const hNear = createHarness({
        cameraPosition: new Vector3(0, -20, 0),
        target: new Vector3(0, 50, 0),
        pickHit: nearHover,
      });
      cleanups.push(hNear.cleanup);

      const farHover = new Vector3(0, 20, 0);
      const hFar = createHarness({
        cameraPosition: new Vector3(0, -20, 0),
        target: new Vector3(0, 50, 0),
        pickHit: farHover,
      });
      cleanups.push(hFar.cleanup);

      const quatBefore = hNear.camera.quaternion.clone();

      // 在两份相同相机位姿下以相同像素位移右键平移
      hNear.dispatchPointer('pointerdown', 500, 400, { button: 2 });
      hNear.dispatchPointer('pointermove', 600, 400, { button: 2 });
      hNear.dispatchPointer('pointerup', 600, 400, { button: 2 });

      hFar.dispatchPointer('pointerdown', 500, 400, { button: 2 });
      hFar.dispatchPointer('pointermove', 600, 400, { button: 2 });
      hFar.dispatchPointer('pointerup', 600, 400, { button: 2 });

      expect(hNear.camera.quaternion.angleTo(quatBefore)).toBeLessThan(1e-6);
      expect(hNear.camera.position.distanceTo(hNear.controls.target)).toBeCloseTo(10, 3);
      expect(hFar.camera.position.distanceTo(hFar.controls.target)).toBeCloseTo(40, 3);

      // 焦点深度 40m 的平移世界距离应精确为深度 10m 时的 4 倍（1:1 跟随各自深度）
      const nearShift = Math.abs(hNear.camera.position.x);
      const farShift = Math.abs(hFar.camera.position.x);
      expect(nearShift).toBeGreaterThan(0.1);
      expect(farShift / nearShift).toBeCloseTo(4, 3);
    });
  });

  describe('平移不带惯性（拖动跟手，松手即停）', () => {
    /** 被抓住的那一点：默认相机下离相机 24（target 离相机 20），不在画面正中 */
    const GRABBED = new Vector3(3, 4, 2);
    const RIGHT_DOWN: PointerEventInit = { button: 2, buttons: 2 };
    const RIGHT_HELD: PointerEventInit = { buttons: 2 };
    const RIGHT_UP: PointerEventInit = { button: 2, buttons: 0 };

    /** 再跑若干帧，相机一点都不再动 */
    const expectNoCoasting = (rig: CameraRig) => {
      const before = snapshotCamera(rig);
      for (let i = 0; i < 10; i += 1) rig.controls.update();
      expectCameraUnmoved(rig, before);
    };

    it('开着惯性右键平移：抓住的那一点每一步都落在光标下，松手后画面不再滑', () => {
      const h = createHarness({ enableDamping: true, pickHit: GRABBED });
      cleanups.push(h.cleanup);
      const start = projectToCanvas(GRABBED, h.camera);
      const quatBefore = h.camera.quaternion.clone();

      h.dispatchPointer('pointerdown', start.x, start.y, RIGHT_DOWN);
      h.dispatchPointer('pointermove', start.x + 80, start.y + 30, RIGHT_HELD);
      expectAtCanvasPixel(GRABBED, h.camera, start.x + 80, start.y + 30);
      h.dispatchPointer('pointermove', start.x + 120, start.y - 40, RIGHT_HELD);
      expectAtCanvasPixel(GRABBED, h.camera, start.x + 120, start.y - 40);
      h.dispatchPointer('pointerup', start.x + 120, start.y - 40, RIGHT_UP);

      expectNoCoasting(h);
      expectAtCanvasPixel(GRABBED, h.camera, start.x + 120, start.y - 40);
      expect(h.camera.quaternion.angleTo(quatBefore)).toBeLessThan(1e-6);
    });

    it('按住 Shift 用左键平移一样跟手、松手即停', () => {
      const h = createHarness({ enableDamping: true, pickHit: GRABBED });
      cleanups.push(h.cleanup);
      const start = projectToCanvas(GRABBED, h.camera);

      h.dispatchPointer('pointerdown', start.x, start.y, { shiftKey: true });
      h.dispatchPointer('pointermove', start.x - 60, start.y + 50, { shiftKey: true });
      expectAtCanvasPixel(GRABBED, h.camera, start.x - 60, start.y + 50);
      h.dispatchPointer('pointerup', start.x - 60, start.y + 50, { shiftKey: true });

      expectNoCoasting(h);
      expectAtCanvasPixel(GRABBED, h.camera, start.x - 60, start.y + 50);
    });

    it('平移按下时，上一次旋转还没走完的惯性当场停住：画面不跳，之后也不补走', () => {
      const h = createHarness({ enableDamping: true, pickHit: GRABBED });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 500, 400);
      h.dispatchPointer('pointermove', 620, 360);
      h.dispatchPointer('pointerup', 620, 360);
      const released = h.camera.quaternion.clone();
      h.controls.update();
      // 惯性确实还在走
      expect(h.camera.quaternion.angleTo(released)).toBeGreaterThan(0.01);

      const atPress = snapshotCamera(h);
      h.dispatchPointer('pointerdown', 300, 500, RIGHT_DOWN);
      expectCameraUnmoved(h, atPress);
      // 拾取读的是 matrixWorld：里面的位置和朝向也得是按下那一刻的
      const { matrixWorld } = h.camera;
      expect(new Vector3().setFromMatrixPosition(matrixWorld).distanceTo(atPress.position)).toBeLessThan(1e-9);
      expect(new Quaternion().setFromRotationMatrix(matrixWorld).angleTo(atPress.quaternion)).toBeLessThan(1e-6);

      expectNoCoasting(h);
      h.dispatchPointer('pointerup', 300, 500, RIGHT_UP);
      expectNoCoasting(h);
      expectCameraUnmoved(h, atPress);
    });

    it('按下时还有没走完的平移惯性（键盘平移留下的）也一样当场停住', () => {
      const h = createHarness({ enableDamping: true, pickHit: null });
      cleanups.push(h.cleanup);
      h.controls.listenToKeyEvents(h.canvas);

      h.canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }));
      const afterKey = h.controls.target.clone();
      h.controls.update();
      // 惯性确实还在走
      expect(h.controls.target.distanceTo(afterKey)).toBeGreaterThan(1e-3);

      const atPress = snapshotCamera(h);
      h.dispatchPointer('pointerdown', 300, 500, RIGHT_DOWN);
      expectCameraUnmoved(h, atPress);
      expectNoCoasting(h);
    });

    it('本来就没开惯性的，平移前后都不去动这个开关', () => {
      const h = createHarness({ enableDamping: false, pickHit: GRABBED });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 500, 400, RIGHT_DOWN);
      h.dispatchPointer('pointermove', 560, 420, RIGHT_HELD);
      h.dispatchPointer('pointerup', 560, 420, RIGHT_UP);

      expect(h.controls.enableDamping).toBe(false);
    });

    it('平移过一次之后别处把惯性关了，后面的按下松手不会把它重新打开', () => {
      const h = createHarness({ enableDamping: true, pickHit: GRABBED });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 500, 400, RIGHT_DOWN);
      h.dispatchPointer('pointermove', 560, 420, RIGHT_HELD);
      h.dispatchPointer('pointerup', 560, 420, RIGHT_UP);
      expect(h.controls.enableDamping).toBe(true);

      h.controls.enableDamping = false;
      h.dispatchPointer('pointerdown', 500, 400);
      h.dispatchPointer('pointerup', 500, 400);
      expect(h.controls.enableDamping).toBe(false);
    });

    it('只按不拖、平移中途被打断（别处接管相机 / 控制器销毁）：惯性开关都回到开着', () => {
      const pressOnly = createHarness({ enableDamping: true, pickHit: GRABBED });
      cleanups.push(pressOnly.cleanup);
      pressOnly.dispatchPointer('pointerdown', 500, 400, RIGHT_DOWN);
      pressOnly.dispatchPointer('pointerup', 500, 400, RIGHT_UP);
      expect(pressOnly.controls.enableDamping).toBe(true);

      const cancelled = createHarness({ enableDamping: true, pickHit: GRABBED });
      cleanups.push(cancelled.cleanup);
      cancelled.dispatchPointer('pointerdown', 500, 400, RIGHT_DOWN);
      cancelled.dispatchPointer('pointermove', 560, 420, RIGHT_HELD);
      cancelled.controller.cancelActiveGesture();
      expect(cancelled.controls.enableDamping).toBe(true);

      const disposed = createHarness({ enableDamping: true, pickHit: GRABBED });
      cleanups.push(disposed.cleanup);
      disposed.dispatchPointer('pointerdown', 500, 400, RIGHT_DOWN);
      disposed.controller.dispose();
      expect(disposed.controls.enableDamping).toBe(true);
    });

    it('平移的松手没送到就来了下一次按下：先恢复惯性开关，再按新的动作来', () => {
      const h = createHarness({ enableDamping: true, pickHit: null });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 500, 400, RIGHT_DOWN);
      h.dispatchPointer('pointermove', 560, 420, RIGHT_HELD);
      // 没有 pointerup：另一个指针按下左键，开始的是旋转
      h.dispatchPointer('pointerdown', 500, 400, { pointerId: 2 });

      expect(h.controls.enableDamping).toBe(true);
    });

    it('平移之后，旋转的惯性照旧', () => {
      const h = createHarness({ enableDamping: true, pickHit: null });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 500, 400, RIGHT_DOWN);
      h.dispatchPointer('pointermove', 560, 420, RIGHT_HELD);
      h.dispatchPointer('pointerup', 560, 420, RIGHT_UP);

      h.dispatchPointer('pointerdown', 500, 400);
      h.dispatchPointer('pointermove', 620, 360);
      h.dispatchPointer('pointerup', 620, 360);
      const released = h.camera.quaternion.clone();
      for (let i = 0; i < 10; i += 1) h.controls.update();

      expect(h.camera.quaternion.angleTo(released)).toBeGreaterThan(0.02);
    });

    it('只有平移才关惯性：左键旋转、中键缩放拖动期间开关一直开着', () => {
      const h = createHarness({ enableDamping: true, pickHit: GRABBED });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 500, 400);
      h.dispatchPointer('pointermove', 540, 420);
      expect(h.controls.enableDamping).toBe(true);
      h.dispatchPointer('pointerup', 540, 420);

      h.dispatchPointer('pointerdown', 500, 400, { button: 1, buttons: 4 });
      h.dispatchPointer('pointermove', 500, 440, { buttons: 4 });
      expect(h.controls.enableDamping).toBe(true);
      h.dispatchPointer('pointerup', 500, 440, { button: 1, buttons: 0 });
    });
  });

  describe('长按记住旋转中心（画面不动）', () => {
    /** 「空白处」的落点：这里有没有构件由 setPickHit 决定，坐标只是让事件有个位置 */
    const EMPTY = new Vector2(200, 600);
    /** 被按住的那一点：默认相机下投在画布 (630, 335) 附近，离相机 23（target 离相机 20） */
    const PRESSED = new Vector3(2, 3, 1);

    it('在构件上静止按住 300ms：记下按住的那一点，相机和 target 都不动；松手后还记着', () => {
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);
      const before = snapshotCamera(h);

      h.dispatchPointer('pointerdown', 630, 335);
      vi.advanceTimersByTime(LONG_PRESS_MS - 1);
      expect(h.controller.getRememberedPivot()).toBeNull();
      vi.advanceTimersByTime(1);
      expect(h.controller.getRememberedPivot()?.distanceTo(PRESSED)).toBeLessThan(1e-9);
      expectCameraUnmoved(h, before);

      h.dispatchPointer('pointerup', 630, 335);
      h.controls.update();
      expect(h.controller.getRememberedPivot()?.distanceTo(PRESSED)).toBeLessThan(1e-9);
      expectCameraUnmoved(h, before);
    });

    it('按住期间移动超过 10px 就不算长按；10px 以内照样算', () => {
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 630, 335);
      h.dispatchPointer('pointermove', 650, 335);
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      h.dispatchPointer('pointerup', 650, 335);
      expect(h.controller.getRememberedPivot()).toBeNull();

      h.dispatchPointer('pointerdown', 630, 335);
      h.dispatchPointer('pointermove', 636, 335);
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      h.dispatchPointer('pointerup', 636, 335);
      expect(h.controller.getRememberedPivot()?.distanceTo(PRESSED)).toBeLessThan(1e-9);
    });

    it('只有会旋转的那种按下才算长按：右键、中键、Shift+左键按住既不记，也不取消', () => {
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);
      const otherPresses: PointerEventInit[] = [
        { button: 2, buttons: 2 },
        { button: 1, buttons: 4 },
        { button: 0, shiftKey: true },
      ];
      const holdAt = (x: number, y: number, init: PointerEventInit) => {
        h.dispatchPointer('pointerdown', x, y, init);
        vi.advanceTimersByTime(LONG_PRESS_MS + 20);
        h.dispatchPointer('pointerup', x, y, { button: init.button });
      };

      for (const init of otherPresses) {
        holdAt(630, 335, init);
        expect(h.controller.getRememberedPivot()).toBeNull();
      }

      h.longPress(630, 335);
      h.setPickHit(null);
      for (const init of otherPresses) {
        holdAt(EMPTY.x, EMPTY.y, init);
        expect(h.controller.getRememberedPivot()?.distanceTo(PRESSED)).toBeLessThan(1e-9);
      }
    });

    it('allowLongPress 返回 false（工具模式）时按住不记，但拖动旋转仍围绕焦点工作', () => {
      const hoverPoint = new Vector3(3, 2, 1);
      const h = createHarness({ pickHit: hoverPoint, config: { allowLongPress: () => false } });
      cleanups.push(h.cleanup);
      const before = snapshotCamera(h);

      h.dispatchPointer('pointerdown', 600, 350);
      vi.advanceTimersByTime(500);
      expect(h.controller.getRememberedPivot()).toBeNull();
      expectCameraUnmoved(h, before);

      const ndcBefore = projectToNdc(hoverPoint, h.camera);
      h.dispatchPointer('pointermove', 680, 320);
      h.dispatchPointer('pointerup', 680, 320);
      expect(h.camera.quaternion.angleTo(before.quaternion)).toBeGreaterThan(0.05);
      expectSameNdc(projectToNdc(hoverPoint, h.camera), ndcBefore);
    });

    it('按住期间才进了工具模式、或按下时在工具模式而中途退出：都不记', () => {
      let allow = true;
      const h = createHarness({ pickHit: PRESSED, config: { allowLongPress: () => allow } });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 630, 335);
      allow = false;
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      h.dispatchPointer('pointerup', 630, 335);
      expect(h.controller.getRememberedPivot()).toBeNull();

      h.dispatchPointer('pointerdown', 630, 335);
      allow = true;
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      h.dispatchPointer('pointerup', 630, 335);
      expect(h.controller.getRememberedPivot()).toBeNull();
    });

    it('长按之后，在空白处、没有选中时拖动旋转：绕记住的那一点转，松手后的惯性阶段也是', () => {
      const h = createHarness({ enableDamping: true, pickHit: PRESSED });
      cleanups.push(h.cleanup);
      h.longPress(630, 335);
      h.setPickHit(null);

      const ndcBefore = projectToNdc(PRESSED, h.camera);
      const distBefore = h.camera.position.distanceTo(PRESSED);
      const quatBefore = h.camera.quaternion.clone();

      h.dispatchPointer('pointerdown', EMPTY.x, EMPTY.y);
      h.dispatchPointer('pointermove', EMPTY.x + 120, EMPTY.y - 40);
      h.dispatchPointer('pointerup', EMPTY.x + 120, EMPTY.y - 40);
      for (let i = 0; i < 15; i += 1) h.controls.update();

      expect(h.camera.quaternion.angleTo(quatBefore)).toBeGreaterThan(0.05);
      expect(Math.abs(h.camera.position.distanceTo(PRESSED) - distBefore)).toBeLessThan(1e-4);
      expectSameNdc(projectToNdc(PRESSED, h.camera), ndcBefore);
    });

    it('长按之后有选中构件（在画面里）：在空白处旋转仍以选中构件为焦点，不用记住的那一点', () => {
      const selectionCenter = new Vector3(-4, 5, 2);
      const h = createHarness({
        pickHit: PRESSED,
        objectBoxes: {
          'o:2_1:0': new Box3(
            selectionCenter.clone().addScalar(-1),
            selectionCenter.clone().addScalar(1),
          ),
        },
      });
      cleanups.push(h.cleanup);
      h.longPress(630, 335);
      h.setPickHit(null);
      h.setSelected(['o:2_1:0']);

      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')?.source).toBe('selection');
      const selectionNdcBefore = projectToNdc(selectionCenter, h.camera);
      const pressedNdcBefore = projectToNdc(PRESSED, h.camera);

      h.dispatchPointer('pointerdown', EMPTY.x, EMPTY.y);
      h.dispatchPointer('pointermove', EMPTY.x + 120, EMPTY.y - 40);
      h.dispatchPointer('pointerup', EMPTY.x + 120, EMPTY.y - 40);

      expectSameNdc(projectToNdc(selectionCenter, h.camera), selectionNdcBefore);
      expect(projectToNdc(PRESSED, h.camera).distanceTo(pressedNdcBefore)).toBeGreaterThan(1e-2);
    });

    it('光标悬停在别的构件上时，悬停优先于记住的那一点；记住的不丢', () => {
      const other = new Vector3(-3, 1, -2);
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);
      h.longPress(630, 335);
      h.setPickHit(other, 'o:7_7:0');

      const otherNdcBefore = projectToNdc(other, h.camera);
      const pressedNdcBefore = projectToNdc(PRESSED, h.camera);

      h.dispatchPointer('pointerdown', 330, 500);
      h.dispatchPointer('pointermove', 450, 460);
      h.dispatchPointer('pointerup', 450, 460);

      expectSameNdc(projectToNdc(other, h.camera), otherNdcBefore);
      expect(projectToNdc(PRESSED, h.camera).distanceTo(pressedNdcBefore)).toBeGreaterThan(1e-2);
      expect(h.controller.getRememberedPivot()?.distanceTo(PRESSED)).toBeLessThan(1e-9);
    });

    it('记住的旋转中心只管旋转：空白处平移、缩放不拿它当焦点', () => {
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);
      h.longPress(630, 335);
      h.setPickHit(null);

      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')?.source).toBe('remembered');
      expect(h.controller.resolveFocusPoint(EMPTY, 'pan')).toBeNull();
      expect(h.controller.resolveFocusPoint(EMPTY, 'dolly')?.source).toBe('cursor');
      expect(h.controller.resolveFocusPoint(EMPTY)).toBeNull();

      // 右键平移：target 的远近没有被对到记住的那一点上（那一点离相机 23，target 离相机 20）
      h.dispatchPointer('pointerdown', EMPTY.x, EMPTY.y, { button: 2, buttons: 2 });
      h.dispatchPointer('pointermove', EMPTY.x + 80, EMPTY.y, { buttons: 2 });
      h.dispatchPointer('pointerup', EMPTY.x + 80, EMPTY.y, { button: 2 });
      expect(h.camera.position.distanceTo(h.controls.target)).toBeCloseTo(20, 6);
    });

    it('记住的那一点不在画面里（或到了相机后面）时不用，空白处旋转回到绕画面正中；转回画面里又用得上', () => {
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);
      h.longPress(630, 335);
      h.setPickHit(null);

      // 别处把相机转开（比如点方位块）：那一点还在相机前方，但已经出了画布
      h.controls.target.set(40, -20, 0);
      h.controls.update();
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')).toBeNull();

      const targetBefore = h.controls.target.clone();
      h.dispatchPointer('pointerdown', EMPTY.x, EMPTY.y);
      h.dispatchPointer('pointermove', EMPTY.x + 60, EMPTY.y);
      h.dispatchPointer('pointerup', EMPTY.x + 60, EMPTY.y);
      expect(h.controls.target.distanceTo(targetBefore)).toBeLessThan(1e-9);

      // 转到背对它
      h.camera.position.set(0, -20, 0);
      h.controls.target.set(0, -40, 0);
      h.controls.update();
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')).toBeNull();

      // 转回来：没有丢，照样用
      h.controls.target.set(0, 0, 0);
      h.controls.update();
      expect(h.controller.getRememberedPivot()?.distanceTo(PRESSED)).toBeLessThan(1e-9);
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')?.source).toBe('remembered');
    });

    it('所在构件被隐藏时暂时不用、重新显示后照旧；构件不在场景里了就丢掉', () => {
      const h = createHarness();
      cleanups.push(h.cleanup);
      h.setPickHit(PRESSED, 'o:5_5:0');
      h.longPress(630, 335);
      h.setPickHit(null);

      h.setObjectVisible('o:5_5:0', false);
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')).toBeNull();
      expect(h.controller.getRememberedPivot()?.distanceTo(PRESSED)).toBeLessThan(1e-9);

      h.setObjectVisible('o:5_5:0', true);
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')?.source).toBe('remembered');

      // 换模型、构件被移除
      h.removeObject('o:5_5:0');
      expect(h.controller.getRememberedPivot()).toBeNull();
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')).toBeNull();
    });

    it('在空白处长按一次就取消：画面不动，这次按下接着拖也回到绕画面正中', () => {
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);
      h.longPress(630, 335);
      h.setPickHit(null);
      const before = snapshotCamera(h);

      h.dispatchPointer('pointerdown', EMPTY.x, EMPTY.y);
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      expect(h.controller.getRememberedPivot()).toBeNull();
      expectCameraUnmoved(h, before);

      h.dispatchPointer('pointermove', EMPTY.x + 60, EMPTY.y);
      h.dispatchPointer('pointerup', EMPTY.x + 60, EMPTY.y);
      // 绕 target 转：target 没被挪到记住的那一点的远近上，也没跟着相机平移
      expect(h.camera.quaternion.angleTo(before.quaternion)).toBeGreaterThan(0.05);
      expect(h.controls.target.distanceTo(before.target)).toBeLessThan(1e-9);
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')).toBeNull();
    });

    it('空白处长按时即使有选中构件兜着焦点，也算空白处：照样取消', () => {
      const selectionCenter = new Vector3(-4, 5, 2);
      const h = createHarness({
        pickHit: PRESSED,
        objectBoxes: {
          'o:2_1:0': new Box3(
            selectionCenter.clone().addScalar(-1),
            selectionCenter.clone().addScalar(1),
          ),
        },
      });
      cleanups.push(h.cleanup);
      h.longPress(630, 335);
      h.setPickHit(null);
      h.setSelected(['o:2_1:0']);

      h.longPress(EMPTY.x, EMPTY.y);
      expect(h.controller.getRememberedPivot()).toBeNull();
    });

    it('空白处按下后稍微挪了一点（已经在绕它转）再按住到取消：之后不再绕它转', () => {
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);
      h.longPress(630, 335);
      h.setPickHit(null);

      h.dispatchPointer('pointerdown', EMPTY.x, EMPTY.y);
      h.dispatchPointer('pointermove', EMPTY.x + 5, EMPTY.y);
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      expect(h.controller.getRememberedPivot()).toBeNull();

      const targetAtCancel = h.controls.target.clone();
      h.dispatchPointer('pointermove', EMPTY.x + 80, EMPTY.y);
      h.dispatchPointer('pointerup', EMPTY.x + 80, EMPTY.y);
      expect(h.controls.target.distanceTo(targetAtCancel)).toBeLessThan(1e-9);
    });

    it('在别的构件上再长按一次，就换成新的那一点', () => {
      const other = new Vector3(-3, 1, -2);
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);
      h.longPress(630, 335);

      h.setPickHit(other, 'o:7_7:0');
      h.longPress(330, 500);
      expect(h.controller.getRememberedPivot()?.distanceTo(other)).toBeLessThan(1e-9);
    });

    it('按住 0.45 秒再拖：停的那一下画面不动，接着绕按住的那一点转', () => {
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);
      const before = snapshotCamera(h);
      const ndcBefore = projectToNdc(PRESSED, h.camera);

      h.dispatchPointer('pointerdown', 630, 335);
      vi.advanceTimersByTime(450);
      expectCameraUnmoved(h, before);

      h.dispatchPointer('pointermove', 710, 290);
      h.dispatchPointer('pointermove', 790, 250);
      h.dispatchPointer('pointerup', 790, 250);

      expect(h.camera.quaternion.angleTo(before.quaternion)).toBeGreaterThan(0.05);
      expectSameNdc(projectToNdc(PRESSED, h.camera), ndcBefore);
    });

    it('clearPivot、setEnabled(false) 会把记住的旋转中心一并清掉', () => {
      const h = createHarness({ pickHit: PRESSED });
      cleanups.push(h.cleanup);

      h.longPress(630, 335);
      h.controller.clearPivot();
      expect(h.controller.getRememberedPivot()).toBeNull();

      h.longPress(630, 335);
      expect(h.controller.getRememberedPivot()?.distanceTo(PRESSED)).toBeLessThan(1e-9);
      h.controller.setEnabled(false);
      expect(h.controller.getRememberedPivot()).toBeNull();
    });

    it('标记跟着记住的那一点走：记下时摆上，相机动了跟着动，用不上或取消时收起', () => {
      const place = vi.fn<(position: { x: number; y: number } | null) => void>();
      const h = createHarness({
        pickHit: PRESSED,
        config: { rememberedPivotMarker: { place, dispose: vi.fn() } },
      });
      cleanups.push(h.cleanup);
      const lastPlaced = () => place.mock.calls.at(-1)?.[0];
      const expectPlacedOnPressedPoint = () => {
        const expected = projectToCanvas(PRESSED, h.camera);
        expect(lastPlaced()?.x).toBeCloseTo(expected.x, 6);
        expect(lastPlaced()?.y).toBeCloseTo(expected.y, 6);
      };

      // 长按触发的那一刻就摆上：这一点在画面正中的右上方
      h.dispatchPointer('pointerdown', 630, 335);
      expect(lastPlaced() ?? null).toBeNull();
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      expectPlacedOnPressedPoint();
      expect(lastPlaced()?.x).toBeGreaterThan(500);
      expect(lastPlaced()?.y).toBeLessThan(400);
      h.dispatchPointer('pointerup', 630, 335);

      // 相机被别处改了（切视角、定位飞行）：渲染前那次 controls.update() 让标记跟上
      h.camera.position.set(6, -20, 3);
      h.controls.update();
      expectPlacedOnPressedPoint();

      // 改画布大小走的是控制器自己的 update()
      h.camera.position.set(6, -19, 3);
      h.controller.update();
      expectPlacedOnPressedPoint();

      // 转到那一点出了画布：收起
      h.camera.position.set(0, -20, 0);
      h.controls.target.set(40, -20, 0);
      h.controls.update();
      expect(lastPlaced()).toBeNull();

      // 转回来：重新摆上
      h.controls.target.set(0, 0, 0);
      h.controls.update();
      expectPlacedOnPressedPoint();

      // 空白处长按取消：收起
      h.setPickHit(null);
      h.longPress(EMPTY.x, EMPTY.y);
      expect(lastPlaced()).toBeNull();
    });

    it('自定义拾取只给点、不带构件 id 时照样能记，但不跟任何构件的显隐；带了 id 就跟着那个构件', () => {
      let hit: Vector3 | { point: Vector3; objectId: string } | null = PRESSED.clone();
      const h = createHarness({ config: { resolveHoverPoint: () => hit } });
      cleanups.push(h.cleanup);

      h.longPress(630, 335);
      hit = null;
      h.setObjectVisible(DEFAULT_PICK_OBJECT_ID, false);
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')?.source).toBe('remembered');

      hit = { point: PRESSED.clone(), objectId: 'o:5_5:0' };
      h.longPress(630, 335);
      hit = null;
      h.setObjectVisible('o:5_5:0', false);
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')).toBeNull();
      h.setObjectVisible('o:5_5:0', true);
      expect(h.controller.resolveFocusPoint(EMPTY, 'rotate')?.source).toBe('remembered');
    });
  });

  it('dispose 后还原 OrbitControls.update 并清理状态', () => {
    const h = createHarness({ pickHit: new Vector3(1, 2, 3) });
    const wrappedUpdate = h.controls.update;
    h.controller.dispose();
    expect(h.controls.update).not.toBe(wrappedUpdate);
    h.controls.dispose();
    h.canvas.remove();
  });

  it('dispose 时把旋转中心的标记一并收掉', () => {
    const dispose = vi.fn();
    const h = createHarness({
      pickHit: new Vector3(1, 2, 3),
      config: { rememberedPivotMarker: { place: vi.fn(), dispose } },
    });
    h.cleanup();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
