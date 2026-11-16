/**
 * DynamicPivotController - 动态 Pivot 点控制器
 *
 * 功能：
 * 1. 旋转、缩放、拖拽平移焦点解析（鼠标 Hover 构件优先，选中构件包围盒中心兜底）
 * 2. 原地绕焦点平滑旋转、同位缩放、等深 1:1 拖拽平移（按下与起拖瞬间零跳变）
 * 3. 鼠标长按触发：导航态按住保持 300ms 后，将 orbit target 对齐到鼠标与 mesh 的交点
 */

import { Box3, MOUSE, Quaternion, TOUCH, Vector2, Vector3 } from 'three';

import type { DTXLayer } from './DTXLayer';
import type { DTXSelectionController } from './selection/DTXSelectionController';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type PivotFocusSource = 'hover' | 'selection';

export type ResolvedFocus = {
  point: Vector3;
  source: PivotFocusSource;
};

export type DynamicPivotConfig = {
  /** 是否启用动态 pivot */
  enabled?: boolean;
  /** 长按触发时间（毫秒，默认 300） */
  longPressDelay?: number;
  /** 是否允许 300ms 静止长按对中（默认 true；工具模式可返回 false） */
  allowLongPress?: () => boolean;
  /** 外部补充解析当前选中构件包围盒（例如树选中的 BRAN / PIPE / EQUI 子树） */
  resolveSelectedBounds?: (target: Box3) => Box3 | null;
  /** 外部自定义 hover 表面拾取点（例如单视口版本对比时兼顾隔离图层） */
  resolveHoverPoint?: (mousePos: Vector2) => Vector3 | null;
};

type ResolvedConfig = {
  enabled: boolean;
  longPressDelay: number;
  allowLongPress?: () => boolean;
  resolveSelectedBounds?: (target: Box3) => Box3 | null;
  resolveHoverPoint?: (mousePos: Vector2) => Vector3 | null;
};

type DragAction = 'rotate' | 'pan' | 'dolly';
type ZoomSource = 'wheel' | 'dolly';

type ActiveRotatePivot = {
  worldPoint: Vector3;
  cameraLocal: Vector3;
};

const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
const DRAG_START_DISTANCE_SQ = 1e-4;
const FOCUS_EPS = 1e-3;
const MIN_FOCUS_DISTANCE = 0.05;
const MIN_EMPTY_WHEEL_ZOOM_DEPTH = 1.0;

export class DynamicPivotController {
  private controls: OrbitControls;
  private selectionController: DTXSelectionController;
  private dtxLayer: DTXLayer;
  private config: ResolvedConfig;
  private origControlsUpdate: (deltaTime?: number) => boolean;

  private currentPivot: Vector3 | null = null;
  private isMouseDown = false;
  private mouseDownPos: Vector2 | null = null;
  private dragActivated = false;
  private pendingAction: DragAction | null = null;
  private pendingFocus: ResolvedFocus | null = null;
  private activeRotatePivot: ActiveRotatePivot | null = null;
  private activeZoomFocus: Vector3 | null = null;
  private activeZoomSource: ZoomSource | null = null;
  private longPressTimer: number | null = null;

  private hasLastObservedState = false;
  private readonly lastObservedCameraPos = new Vector3();
  private readonly lastObservedTarget = new Vector3();

  private readonly tmpVecA = new Vector3();
  private readonly tmpVecB = new Vector3();
  private readonly tmpVecC = new Vector3();
  private readonly tmpVecD = new Vector3();
  private readonly tmpBeforePos = new Vector3();
  private readonly tmpBeforeTarget = new Vector3();
  private readonly tmpBeforeQuat = new Quaternion();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpSelectionBox = new Box3();
  private readonly tmpObjectBox = new Box3();
  private readonly tmpExtraBox = new Box3();

  constructor(
    controls: OrbitControls,
    selectionController: DTXSelectionController,
    dtxLayer: DTXLayer,
    config: DynamicPivotConfig = {},
  ) {
    this.controls = controls;
    this.selectionController = selectionController;
    this.dtxLayer = dtxLayer;

    this.config = {
      enabled: config.enabled ?? true,
      longPressDelay: config.longPressDelay ?? 300,
      allowLongPress: config.allowLongPress,
      resolveSelectedBounds: config.resolveSelectedBounds,
      resolveHoverPoint: config.resolveHoverPoint,
    };

    this.origControlsUpdate = this.controls.update.bind(this.controls);
    this.controls.update = (deltaTime?: number) => this.handleControlsUpdate(deltaTime);
    this.recordObservedState();
  }

  /**
   * 按优先级解析当前操作焦点：
   * 1. 光标下 Hover 命中的可见构件表面点（需位于相机前方）
   * 2. 当前选中构件包围盒中心（需位于相机前方，或取包围盒伸入前方的有效深度点）
   */
  resolveFocusPoint(mousePos: Vector2 | null): ResolvedFocus | null {
    if (mousePos) {
      const hoverPoint = this.pickHoverPoint(mousePos);
      if (hoverPoint && this.isFiniteVec3(hoverPoint) && this.isPointInFrontOfCamera(hoverPoint)) {
        return { point: hoverPoint.clone(), source: 'hover' };
      }
    }

    const selectionCenter = this.resolveSelectionCenter();
    if (selectionCenter) {
      return { point: selectionCenter, source: 'selection' };
    }

    return null;
  }

  /**
   * 处理鼠标按下事件（仅记录候选焦点，不瞬移相机或 target）
   */
  handleMouseDown(mousePos: Vector2, event?: PointerEvent | MouseEvent): void {
    if (!this.config.enabled || !this.controls.enabled) return;

    this.cancelLongPress();
    this.isMouseDown = true;
    this.mouseDownPos = mousePos.clone();
    this.dragActivated = false;
    this.pendingAction = this.classifyDragAction(event);
    this.pendingFocus = this.resolveFocusPoint(mousePos);

    if (this.canLongPress()) {
      const pressedPos = mousePos.clone();
      this.longPressTimer = window.setTimeout(() => {
        this.onLongPress(pressedPos);
      }, this.config.longPressDelay);
    }
  }

  /**
   * 处理鼠标移动事件
   */
  handleMouseMove(mousePos: Vector2, event?: PointerEvent | MouseEvent): void {
    if (!this.isMouseDown || !this.mouseDownPos) return;
    if (!this.config.enabled || !this.controls.enabled) {
      this.cancelLongPress();
      return;
    }

    const distSq = mousePos.distanceToSquared(this.mouseDownPos);
    if (distSq > LONG_PRESS_MOVE_THRESHOLD_PX * LONG_PRESS_MOVE_THRESHOLD_PX) {
      this.cancelLongPress();
    }

    if (!this.dragActivated && distSq > DRAG_START_DISTANCE_SQ) {
      this.dragActivated = true;
      const action = event ? this.classifyDragAction(event) : (this.pendingAction ?? 'rotate');
      this.pendingAction = action;
      this.activateDragFocus(action, this.pendingFocus);
    }
  }

  /**
   * 处理鼠标释放/取消事件（保留 activeRotatePivot 让松手后的阻尼继续绕焦点旋转）
   */
  handleMouseUp(): void {
    this.isMouseDown = false;
    this.mouseDownPos = null;
    this.dragActivated = false;
    this.pendingFocus = null;
    this.pendingAction = null;
    this.cancelLongPress();

    if (this.activeZoomSource === 'dolly') {
      this.activeZoomFocus = null;
      this.activeZoomSource = null;
    }
  }

  /**
   * 处理滚轮缩放事件：在 OrbitControls.onMouseWheel 之前对齐目标深度并记录缩放焦点
   */
  handleWheel(mousePos: Vector2, event?: WheelEvent): void {
    if (!this.config.enabled || !this.controls.enabled) return;

    this.cancelLongPress();
    this.activeRotatePivot = null;
    this.activeZoomFocus = null;
    this.activeZoomSource = null;

    const focus = this.resolveFocusPoint(mousePos);
    if (focus) {
      if (this.alignTargetDepthToFocus(focus.point)) {
        this.currentPivot = focus.point.clone();
        this.activeZoomFocus = focus.point.clone();
        this.activeZoomSource = 'wheel';
      }
      return;
    }

    // 无 Hover 且无选中时：向上滚轮放大若 target 过近，前推 target 防止缩放死墙
    if (event && event.deltaY < 0) {
      const minDepth = Math.max(this.controls.minDistance || 0, MIN_EMPTY_WHEEL_ZOOM_DEPTH);
      const currentDist = this.controls.object.position.distanceTo(this.controls.target);
      if (currentDist < minDepth) {
        const forward = this.getForwardDirection(
          this.controls.object.position,
          this.controls.target,
          this.tmpVecC,
        );
        this.controls.target.copy(this.controls.object.position).addScaledVector(forward, minDepth);
        this.recordObservedState();
      }
    }
  }

  /**
   * 取消当前手势与阻尼锁定状态（用于 Gizmo / 分屏 / 外部相机切换）
   */
  cancelActiveGesture(): void {
    this.handleMouseUp();
    this.activeRotatePivot = null;
    this.activeZoomFocus = null;
    this.activeZoomSource = null;
  }

  /**
   * 清除 pivot 点
   */
  clearPivot(): void {
    this.currentPivot = null;
    this.activeRotatePivot = null;
    this.activeZoomFocus = null;
    this.activeZoomSource = null;
  }

  /**
   * 获取当前 pivot 点
   */
  getCurrentPivot(): Vector3 | null {
    return this.currentPivot;
  }

  /**
   * 设置是否启用
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      this.cancelActiveGesture();
      this.clearPivot();
    }
  }

  /**
   * 更新（每帧调用）
   */
  update(): void {
    // 预留用于动画或其他更新逻辑
  }

  /**
   * 释放资源并还原 OrbitControls.update
   */
  dispose(): void {
    this.cancelActiveGesture();
    this.currentPivot = null;
    this.controls.update = this.origControlsUpdate;
  }

  private handleControlsUpdate(deltaTime?: number): boolean {
    const camera = this.controls.object;
    const target = this.controls.target;

    // 外部直接改写相机或 target（如 flyTo / jumpTo / gizmo）时，放弃在途枢轴约束
    if (this.hasLastObservedState) {
      const camMovedExternally =
        camera.position.distanceToSquared(this.lastObservedCameraPos) > 1e-10;
      const targetMovedExternally =
        target.distanceToSquared(this.lastObservedTarget) > 1e-10;
      if (camMovedExternally || targetMovedExternally) {
        this.activeRotatePivot = null;
        this.activeZoomFocus = null;
        this.activeZoomSource = null;
      }
    }

    const beforePos = this.tmpBeforePos.copy(camera.position);
    const beforeTarget = this.tmpBeforeTarget.copy(target);
    const beforeQuat = this.tmpBeforeQuat.copy(camera.quaternion);
    const rBefore = beforePos.distanceTo(beforeTarget);

    const changed = this.origControlsUpdate(deltaTime);

    if (!this.config.enabled) {
      this.recordObservedState();
      return changed;
    }

    let adjusted = false;

    if (this.activeZoomFocus) {
      const rAfter = camera.position.distanceTo(target);
      if (rBefore > 1e-9 && rAfter > 1e-9 && Math.abs(rAfter - rBefore) > 1e-9) {
        const scale = rAfter / rBefore;
        adjusted = this.applyZoomFocusAdjustment(
          this.activeZoomFocus,
          beforePos,
          beforeTarget,
          beforeQuat,
          scale,
        );
      }
      if (this.activeZoomSource === 'wheel') {
        this.activeZoomFocus = null;
        this.activeZoomSource = null;
      }
    } else if (this.activeRotatePivot) {
      const quatDelta = beforeQuat.angleTo(camera.quaternion);
      const isRotatingDrag = this.isMouseDown && this.dragActivated && this.pendingAction === 'rotate';
      const targetTranslatedOnly =
        quatDelta <= 1e-7 && beforeTarget.distanceToSquared(target) > 1e-12;

      if (targetTranslatedOnly || (!isRotatingDrag && quatDelta <= 1e-7)) {
        this.activeRotatePivot = null;
      } else if (quatDelta > 1e-8) {
        adjusted = this.applyRotatePivotAdjustment(this.activeRotatePivot);
      }
    }

    this.recordObservedState();
    return changed || adjusted;
  }

  private activateDragFocus(action: DragAction | null, focus: ResolvedFocus | null): void {
    this.activeRotatePivot = null;
    this.activeZoomFocus = null;
    this.activeZoomSource = null;
    if (!action || !focus) return;

    if (!this.alignTargetDepthToFocus(focus.point)) return;
    this.currentPivot = focus.point.clone();

    if (action === 'rotate') {
      const camera = this.controls.object;
      const invQuat = this.tmpQuat.copy(camera.quaternion).invert();
      const cameraLocal = focus.point.clone().sub(camera.position).applyQuaternion(invQuat);
      this.activeRotatePivot = {
        worldPoint: focus.point.clone(),
        cameraLocal,
      };
      return;
    }

    if (action === 'dolly') {
      this.activeZoomFocus = focus.point.clone();
      this.activeZoomSource = 'dolly';
    }
  }

  private alignTargetDepthToFocus(focusPoint: Vector3): boolean {
    const camera = this.controls.object;
    const forward = this.getForwardDirection(camera.position, this.controls.target, this.tmpVecC);
    const depth = this.tmpVecA.copy(focusPoint).sub(camera.position).dot(forward);
    if (!Number.isFinite(depth) || depth <= FOCUS_EPS) return false;

    const targetDepth = this.clampDistanceToControls(Math.max(this.getMinFocusDistance(), depth));
    this.controls.target.copy(camera.position).addScaledVector(forward, targetDepth);
    this.recordObservedState();
    return true;
  }

  private applyRotatePivotAdjustment(pivot: ActiveRotatePivot): boolean {
    const camera = this.controls.object;
    const target = this.controls.target;
    const rotatedLocal = this.tmpVecA.copy(pivot.cameraLocal).applyQuaternion(camera.quaternion);
    const desiredCameraPos = this.tmpVecB.copy(pivot.worldPoint).sub(rotatedLocal);
    const delta = desiredCameraPos.sub(camera.position);
    if (delta.lengthSq() <= 1e-16) return false;

    camera.position.add(delta);
    target.add(delta);
    camera.updateMatrixWorld();
    return true;
  }

  private applyZoomFocusAdjustment(
    focus: Vector3,
    beforePos: Vector3,
    beforeTarget: Vector3,
    beforeQuat: Quaternion,
    scale: number,
  ): boolean {
    const camera = this.controls.object;
    const target = this.controls.target;
    if ((camera as { isOrthographicCamera?: boolean }).isOrthographicCamera) return false;
    if (this.controls.zoomToCursor) return false;

    const beforeForward = this.getForwardDirection(beforePos, beforeTarget, this.tmpVecC);
    const depthBefore = this.tmpVecA.copy(focus).sub(beforePos).dot(beforeForward);
    if (!Number.isFinite(depthBefore) || depthBefore <= FOCUS_EPS) return false;

    const invBeforeQuat = this.tmpQuat.copy(beforeQuat).invert();
    const localBefore = this.tmpVecB.copy(focus).sub(beforePos).applyQuaternion(invBeforeQuat);
    const scaledLocal = localBefore.multiplyScalar(scale);
    const rotatedLocal = scaledLocal.applyQuaternion(camera.quaternion);
    const desiredCameraPos = this.tmpVecA.copy(focus).sub(rotatedLocal);

    const afterForward = this.getForwardDirection(camera.position, target, this.tmpVecD);
    const nextDepth = this.clampDistanceToControls(
      Math.max(this.getMinFocusDistance(), depthBefore * scale),
    );

    camera.position.copy(desiredCameraPos);
    target.copy(desiredCameraPos).addScaledVector(afterForward, nextDepth);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return true;
  }

  private pickHoverPoint(mousePos: Vector2): Vector3 | null {
    if (this.config.resolveHoverPoint) {
      return this.config.resolveHoverPoint(mousePos);
    }
    return this.selectionController.pickPoint(mousePos)?.point ?? null;
  }

  private resolveSelectionCenter(): Vector3 | null {
    const box = this.tmpSelectionBox.makeEmpty();
    let hasBounds = false;

    const selectedIds = this.selectionController.getSelected();
    const hasVisibleCheck = typeof this.dtxLayer.isObjectVisible === 'function';
    for (const objectId of selectedIds) {
      if (hasVisibleCheck && !this.dtxLayer.isObjectVisible(objectId)) continue;
      const objBox = this.dtxLayer.getObjectBoundingBoxInto(objectId, this.tmpObjectBox);
      if (!objBox || objBox.isEmpty()) continue;
      box.union(objBox);
      hasBounds = true;
    }

    if (this.config.resolveSelectedBounds) {
      const extraBox = this.config.resolveSelectedBounds(this.tmpExtraBox.makeEmpty());
      if (extraBox && !extraBox.isEmpty()) {
        box.union(extraBox);
        hasBounds = true;
      }
    }

    if (!hasBounds || box.isEmpty()) return null;

    const center = box.getCenter(new Vector3());
    if (this.isPointInFrontOfCamera(center)) {
      return center;
    }

    const cameraPos = this.controls.object.position;
    const forward = this.getForwardDirection(cameraPos, this.controls.target, this.tmpVecC);
    const maxDepth = this.computeBoxMaxForwardDepth(box, cameraPos, forward);
    if (maxDepth <= FOCUS_EPS) return null;

    const currentDepth = this.tmpVecA.copy(center).sub(cameraPos).dot(forward);
    const preferredDepth = Math.max(this.getMinFocusDistance(), maxDepth * 0.5);
    const targetDepth = Math.min(maxDepth, preferredDepth);
    if (targetDepth <= FOCUS_EPS) return null;
    return center.addScaledVector(forward, targetDepth - currentDepth);
  }

  private computeBoxMaxForwardDepth(box: Box3, cameraPos: Vector3, forward: Vector3): number {
    const cx = forward.x >= 0 ? box.max.x : box.min.x;
    const cy = forward.y >= 0 ? box.max.y : box.min.y;
    const cz = forward.z >= 0 ? box.max.z : box.min.z;
    return (
      (cx - cameraPos.x) * forward.x +
      (cy - cameraPos.y) * forward.y +
      (cz - cameraPos.z) * forward.z
    );
  }

  private isPointInFrontOfCamera(point: Vector3): boolean {
    const cameraPos = this.controls.object.position;
    const forward = this.getForwardDirection(cameraPos, this.controls.target, this.tmpVecC);
    const depth = this.tmpVecA.copy(point).sub(cameraPos).dot(forward);
    return Number.isFinite(depth) && depth > FOCUS_EPS;
  }

  private getForwardDirection(
    cameraPos = this.controls.object.position,
    target = this.controls.target,
    out = this.tmpVecC,
  ): Vector3 {
    out.copy(target).sub(cameraPos);
    if (out.lengthSq() > 1e-12) {
      return out.normalize();
    }
    return this.controls.object.getWorldDirection(out).normalize();
  }

  private getMinFocusDistance(): number {
    const minDist = Number.isFinite(this.controls.minDistance) ? this.controls.minDistance : 0;
    return Math.max(minDist, MIN_FOCUS_DISTANCE);
  }

  private clampDistanceToControls(dist: number): number {
    const minDist = Number.isFinite(this.controls.minDistance) ? Math.max(0, this.controls.minDistance) : 0;
    const maxDist = Number.isFinite(this.controls.maxDistance) ? this.controls.maxDistance : Infinity;
    return Math.max(minDist, Math.min(maxDist, dist));
  }

  private isFiniteVec3(v: Vector3): boolean {
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  }

  private classifyDragAction(event?: PointerEvent | MouseEvent): DragAction | null {
    if (!event) return 'rotate';
    if ('pointerType' in event && event.pointerType === 'touch') {
      const action = this.controls.touches.ONE === TOUCH.PAN ? 'pan' : 'rotate';
      if (action === 'pan' && !this.controls.enablePan) return null;
      if (action === 'rotate' && !this.controls.enableRotate) return null;
      return action;
    }

    let mouseAction: MOUSE | null | undefined;
    switch (event.button) {
      case 0:
        mouseAction = this.controls.mouseButtons.LEFT;
        break;
      case 1:
        mouseAction = this.controls.mouseButtons.MIDDLE;
        break;
      case 2:
        mouseAction = this.controls.mouseButtons.RIGHT;
        break;
      default:
        return null;
    }

    const hasModifier = !!(event.ctrlKey || event.metaKey || event.shiftKey);
    let action: DragAction | null = null;
    if (mouseAction === MOUSE.ROTATE) {
      action = hasModifier ? 'pan' : 'rotate';
    } else if (mouseAction === MOUSE.PAN) {
      action = hasModifier ? 'rotate' : 'pan';
    } else if (mouseAction === MOUSE.DOLLY) {
      action = 'dolly';
    }

    if (action === 'rotate' && !this.controls.enableRotate) return null;
    if (action === 'pan' && !this.controls.enablePan) return null;
    if (action === 'dolly' && !this.controls.enableZoom) return null;
    return action;
  }

  private canLongPress(): boolean {
    return this.config.allowLongPress ? this.config.allowLongPress() : true;
  }

  private recordObservedState(): void {
    this.lastObservedCameraPos.copy(this.controls.object.position);
    this.lastObservedTarget.copy(this.controls.target);
    this.hasLastObservedState = true;
  }

  /**
   * 长按触发
   */
  private onLongPress(mousePos: Vector2): void {
    this.longPressTimer = null;
    if (!this.config.enabled || !this.controls.enabled || !this.canLongPress()) return;

    // 仅认鼠标下方的直接表面命中，不回退到选中构件中心
    const hoverPoint = this.pickHoverPoint(mousePos);
    if (!hoverPoint || !this.isFiniteVec3(hoverPoint) || !this.isPointInFrontOfCamera(hoverPoint)) {
      return;
    }

    this.activeRotatePivot = null;
    this.activeZoomFocus = null;
    this.activeZoomSource = null;
    this.currentPivot = hoverPoint.clone();
    this.pendingFocus = { point: hoverPoint.clone(), source: 'hover' };
    this.controls.target.copy(this.currentPivot);
    this.recordObservedState();
    this.controls.update();
  }

  /**
   * 取消长按
   */
  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
}
