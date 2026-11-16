import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Box3, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { DynamicPivotController, type DynamicPivotConfig } from './DynamicPivotController';

import type { DTXLayer } from './DTXLayer';
import type { DTXSelectionController } from './selection/DTXSelectionController';

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
  let currentSelected = [...(options.selectedObjectIds ?? [])];
  const objectBoxes = options.objectBoxes ?? {};
  const visibleMap = options.visibleMap ?? {};

  const selectionController = {
    pickPoint: vi.fn(() => (currentPickHit ? { objectId: 'o:1_1:0', point: currentPickHit.clone(), distance: 1 } : null)),
    getSelected: vi.fn(() => [...currentSelected]),
  } as unknown as DTXSelectionController;

  const dtxLayer = {
    isObjectVisible: vi.fn((id: string) => visibleMap[id] ?? true),
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

  // 用捕获阶段监听把控制权接在 OrbitControls 之前，与 ViewerPanel 一致
  const onPointerDown = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    controller.handleMouseDown(new Vector2(e.clientX - rect.left, e.clientY - rect.top), e);
  };
  const onPointerMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    controller.handleMouseMove(new Vector2(e.clientX - rect.left, e.clientY - rect.top), e);
  };
  const onPointerUp = () => {
    controller.handleMouseUp();
  };
  const onWheel = (e: WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    controller.handleWheel(new Vector2(e.clientX - rect.left, e.clientY - rect.top), e);
  };

  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  canvas.addEventListener('pointermove', onPointerMove, { capture: true });
  canvas.addEventListener('pointerup', onPointerUp, { capture: true });
  canvas.addEventListener('pointercancel', onPointerUp, { capture: true });
  canvas.addEventListener('wheel', onWheel, { capture: true, passive: true });

  const dispatchPointer = (
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    x: number,
    y: number,
    init: PointerEventInit = {},
  ) => {
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        button: init.button ?? 0,
        ...init,
      }),
    );
  };

  const dispatchWheel = (x: number, y: number, deltaY: number) => {
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        deltaY,
        deltaMode: 0,
      }),
    );
  };

  const cleanup = () => {
    canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.removeEventListener('pointermove', onPointerMove, { capture: true });
    canvas.removeEventListener('pointerup', onPointerUp, { capture: true });
    canvas.removeEventListener('pointercancel', onPointerUp, { capture: true });
    canvas.removeEventListener('wheel', onWheel, { capture: true });
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
    setPickHit(hit: Vector3 | null) {
      currentPickHit = hit;
    },
    setSelected(ids: string[]) {
      currentSelected = [...ids];
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

    it('选中包围盒中心在相机后方但包围盒伸入前方半空间时，返回前方有效焦点；完全在后方时返回 null', () => {
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

      const front = h.controller.resolveFocusPoint(new Vector2(500, 400));
      expect(front?.source).toBe('selection');
      expect(front!.point.y).toBeGreaterThan(0);
      expect(front!.point.y).toBeLessThanOrEqual(4);

      // 将对象完全移至相机后方（y < 0）
      h.dtxLayer.getObjectBoundingBoxInto = vi.fn((_id: string, target: Box3) =>
        target.set(new Vector3(1, -12, 0), new Vector3(3, -2, 2)),
      );
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

  describe('300ms 长按兼容与 allowLongPress 门控', () => {
    it('导航态静止长按 300ms 将 target 设到光标下命中点；移动超 10px 取消长按', () => {
      const hoverPoint = new Vector3(2, 3, 1);
      const h = createHarness({
        cameraPosition: new Vector3(0, -20, 0),
        target: new Vector3(0, 0, 0),
        pickHit: hoverPoint,
        config: {
          longPressDelay: 300,
          allowLongPress: () => true,
        },
      });
      cleanups.push(h.cleanup);

      // 先测移动超 10px 会取消长按
      h.dispatchPointer('pointerdown', 500, 400, { button: 0 });
      h.dispatchPointer('pointermove', 520, 400, { button: 0 });
      vi.advanceTimersByTime(350);
      expect(h.controls.target.distanceTo(hoverPoint)).toBeGreaterThan(0.5);
      h.dispatchPointer('pointerup', 520, 400, { button: 0 });

      // 再测静止长按 300ms 生效
      h.controls.target.set(0, 0, 0);
      h.controls.update();
      h.dispatchPointer('pointerdown', 500, 400, { button: 0 });
      vi.advanceTimersByTime(320);
      expect(h.controls.target.distanceTo(hoverPoint)).toBeLessThan(1e-6);
      h.dispatchPointer('pointerup', 500, 400, { button: 0 });
    });

    it('allowLongPress 返回 false 时静止按住不改 target，但拖动旋转仍围绕焦点工作', () => {
      const hoverPoint = new Vector3(3, 2, 1);
      const h = createHarness({
        cameraPosition: new Vector3(0, -20, 0),
        target: new Vector3(0, 0, 0),
        pickHit: hoverPoint,
        config: {
          longPressDelay: 300,
          allowLongPress: () => false,
        },
      });
      cleanups.push(h.cleanup);

      h.dispatchPointer('pointerdown', 600, 350, { button: 0 });
      vi.advanceTimersByTime(500);
      expect(h.controls.target.distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-6);

      const ndcBefore = projectToNdc(hoverPoint, h.camera);
      h.dispatchPointer('pointermove', 680, 320, { button: 0 });
      h.dispatchPointer('pointerup', 680, 320, { button: 0 });
      const ndcAfter = projectToNdc(hoverPoint, h.camera);
      expect(Math.abs(ndcAfter.x - ndcBefore.x)).toBeLessThan(1e-4);
      expect(Math.abs(ndcAfter.y - ndcBefore.y)).toBeLessThan(1e-4);
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
});
