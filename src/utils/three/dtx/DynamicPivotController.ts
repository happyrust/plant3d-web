/**
 * DynamicPivotController - 动态 Pivot 点控制器
 *
 * 功能：
 * 1. 旋转、缩放、拖拽平移焦点解析（鼠标 Hover 构件优先，画面里的选中构件包围盒中心兜底；空白处缩放朝光标）
 * 2. 原地绕焦点平滑旋转、同位缩放、等深 1:1 拖拽平移（按下与起拖瞬间零跳变）
 * 3. 鼠标长按：导航态在构件上按住 300ms 不动，把按住的那一点记为「记住的旋转中心」，相机和画面都不动；
 *    之后在空白处旋转、又没有可用的选中构件时绕它转。在空白处长按一次取消
 * 4. 平移不带惯性：平移拖动期间暂时关掉 OrbitControls 的阻尼，抓住的点跟手、松手即停；旋转的惯性不变
 * 5. 连续滚动不重复算选中中心：一轮连续滚动（相邻两格滚轮相隔不超过 200ms）里，选中构件的包围盒中心只算一次，
 *    后面的格子复用；光标下的拾取、选中中心在不在画面里仍然每一格现算
 */

import { Box3, MOUSE, Quaternion, TOUCH, Vector2, Vector3 } from 'three';

import type { DTXLayer } from './DTXLayer';
import type { DTXSelectionController } from './selection/DTXSelectionController';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type PivotFocusSource = 'hover' | 'selection' | 'remembered' | 'cursor';

export type ResolvedFocus = {
  point: Vector3;
  source: PivotFocusSource;
  /** Hover 命中的构件在 DTX 图层里的 id（拾取方给了才有） */
  objectId?: string | null;
};

/** Hover 拾取结果：命中点，外加被命中构件在 DTX 图层里的 id（不在该图层里的就不填） */
export type PivotHoverHit = {
  point: Vector3;
  objectId?: string | null;
};

/** 「记住的旋转中心」的标记：控制器只告诉它该摆在哪，画成什么样由实现决定 */
export type RememberedPivotMarker = {
  /** 画布内的 CSS 像素坐标；`null` 表示此刻不显示 */
  place(position: { x: number; y: number } | null): void;
  dispose(): void;
};

export type DynamicPivotConfig = {
  /** 是否启用动态 pivot */
  enabled?: boolean;
  /** 长按触发时间（毫秒，默认 300） */
  longPressDelay?: number;
  /** 是否允许 300ms 静止长按记住旋转中心（默认 true；工具模式可返回 false） */
  allowLongPress?: () => boolean;
  /** 外部补充解析当前选中构件包围盒（例如树选中的 BRAN / PIPE / EQUI 子树） */
  resolveSelectedBounds?: (target: Box3) => Box3 | null;
  /** 外部自定义 hover 表面拾取（例如单视口版本对比时兼顾隔离图层）；可以只返回命中点，也可以带上构件 id */
  resolveHoverPoint?: (mousePos: Vector2) => Vector3 | PivotHoverHit | null;
  /** 「记住的旋转中心」怎么显示；不给就只记不显示 */
  rememberedPivotMarker?: RememberedPivotMarker;
};

type ResolvedConfig = {
  enabled: boolean;
  longPressDelay: number;
  allowLongPress?: () => boolean;
  resolveSelectedBounds?: (target: Box3) => Box3 | null;
  resolveHoverPoint?: (mousePos: Vector2) => Vector3 | PivotHoverHit | null;
  rememberedPivotMarker?: RememberedPivotMarker;
};

type DragAction = 'rotate' | 'pan' | 'dolly';
type ZoomSource = 'wheel' | 'dolly';

type ActiveRotatePivot = {
  worldPoint: Vector3;
  cameraLocal: Vector3;
};

type RememberedPivot = {
  point: Vector3;
  /** 记下时按住的构件；拾取方没给 id 就是 null，那时不跟构件的存在与显隐 */
  objectId: string | null;
};

const LONG_PRESS_MOVE_THRESHOLD_PX = 10;
const DRAG_START_DISTANCE_SQ = 1e-4;
const FOCUS_EPS = 1e-3;
const MIN_FOCUS_DISTANCE = 0.05;
const MIN_EMPTY_WHEEL_ZOOM_DEPTH = 1.0;
/**
 * 相邻两格滚轮相隔不超过这么久，算同一轮连续滚动。一轮里「选中中心」只在头一次用到时算一次，后面的格子复用：
 * 算它要把选中的构件过一遍求包围盒（外面补的那一份还要把场景里登记的节点过一遍），选中几千个构件时一次要好几毫秒，
 * 每一格都算，连续滚动就发卡。代价：这一轮中途选中、显隐或模型变了，要到下一轮（停顿超过这个间隔，或按下鼠标之后）才跟上。
 */
const WHEEL_ROUND_GAP_MS = 200;

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
  private hasPendingAction = false;
  private pendingFocus: ResolvedFocus | null = null;
  private activeRotatePivot: ActiveRotatePivot | null = null;
  private activeZoomFocus: Vector3 | null = null;
  private activeZoomSource: ZoomSource | null = null;
  private longPressTimer: number | null = null;
  private rememberedPivot: RememberedPivot | null = null;
  /** 平移拖动期间由本控制器关掉了 OrbitControls 的阻尼，松手时要恢复 */
  private panDampingSuspended = false;
  /** 上一格滚轮的时刻（`performance.now()`），用来判断这一格和上一格是不是同一轮连续滚动 */
  private lastWheelAt = 0;
  /**
   * 这一轮连续滚动里算过的选中构件包围盒中心：`null` = 没有可用的包围盒，`undefined` = 还没算过（或已作废）。
   * 只在控制器内部读，不改它、也不交出去
   */
  private wheelSelectionCenter: Vector3 | null | undefined;

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
  private readonly tmpNdc = new Vector3();

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
      rememberedPivotMarker: config.rememberedPivotMarker,
    };

    this.origControlsUpdate = this.controls.update.bind(this.controls);
    this.controls.update = (deltaTime?: number) => this.handleControlsUpdate(deltaTime);
    this.recordObservedState();
  }

  /**
   * 按优先级解析当前操作焦点：
   * 1. 光标下 Hover 命中的可见构件表面点（需位于相机前方）
   * 2. 当前选中构件包围盒中心（需在画面里：位于相机前方，投影落在画布范围内）
   * 3. 只在给旋转用（`use === 'rotate'`）时：长按记住的旋转中心（需在画面里，所在构件还在且可见）
   * 4. 只在给缩放用（`use === 'dolly'`，滚轮和中键拖动都算）时：光标那条视线上、和当前 target 同深度的点
   */
  resolveFocusPoint(mousePos: Vector2 | null, use: DragAction | null = null): ResolvedFocus | null {
    return this.resolveFocus(mousePos, use, false);
  }

  /**
   * `resolveFocusPoint` 的本体。`inWheelRound`：给滚轮用，「选中中心」复用这一轮连续滚动里算过的
   * （见 `WHEEL_ROUND_GAP_MS`）；拖动起手和对外的调用都传 false，每次现算
   */
  private resolveFocus(
    mousePos: Vector2 | null,
    use: DragAction | null,
    inWheelRound: boolean,
  ): ResolvedFocus | null {
    if (mousePos) {
      const hover = this.pickHover(mousePos);
      if (hover && this.isFiniteVec3(hover.point) && this.isPointInFrontOfCamera(hover.point)) {
        return { point: hover.point.clone(), source: 'hover', objectId: hover.objectId ?? null };
      }
    }

    const selectionCenter = this.resolveSelectionCenter(inWheelRound);
    if (selectionCenter) {
      return { point: selectionCenter, source: 'selection' };
    }

    if (use === 'rotate') {
      const remembered = this.resolveRememberedPivot();
      if (remembered) {
        return { point: remembered.clone(), source: 'remembered' };
      }
    }

    if (use === 'dolly' && mousePos) {
      return this.resolveCursorFocus(mousePos);
    }

    return null;
  }

  /**
   * 处理鼠标按下事件（仅记录候选焦点，不瞬移相机或 target）
   */
  handleMouseDown(mousePos: Vector2, event?: PointerEvent | MouseEvent): void {
    if (!this.config.enabled || !this.controls.enabled) return;

    this.cancelLongPress();
    // 按下可能换了选中（点选）：这一轮连续滚动里算过的选中中心到此作废
    this.wheelSelectionCenter = undefined;
    // 上一次平移的松手要是没送到，阻尼还关着：先恢复，再按这一次的动作重新判断
    this.restoreDampingAfterPan();
    this.isMouseDown = true;
    this.mouseDownPos = mousePos.clone();
    this.dragActivated = false;
    this.pendingAction = this.classifyDragAction(event);
    this.hasPendingAction = true;
    this.pendingFocus = this.resolveFocusPoint(mousePos, this.pendingAction);

    if (this.pendingAction === 'pan') {
      this.suspendDampingForPan();
    }

    // 只有会旋转的那种按下才算长按：右键在构件上要弹菜单、中键是缩放，慢一点的点击不该顺带记下或取消旋转中心
    if (this.pendingAction === 'rotate' && this.canLongPress()) {
      this.longPressTimer = window.setTimeout(() => {
        this.onLongPress();
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
      // 真实浏览器 pointermove 的 event.button 恒为 -1，优先沿用 pointerdown 已锁定的动作（与 OrbitControls 一致）
      const action = this.hasPendingAction
        ? this.pendingAction
        : (event ? this.classifyDragAction(event) : 'rotate');
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
    this.hasPendingAction = false;
    this.cancelLongPress();
    this.restoreDampingAfterPan();

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

    // 离上一格太久就另起一轮：上一轮算过的选中中心作废
    const now = performance.now();
    if (now - this.lastWheelAt > WHEEL_ROUND_GAP_MS) this.wheelSelectionCenter = undefined;
    this.lastWheelAt = now;

    let focus = this.resolveFocus(mousePos, null, true);
    if (!focus) {
      // 无 Hover 且无可用的选中构件：朝光标缩放。
      // 向上滚轮放大若 target 过近，先前推 target 防止缩放死墙；光标点按前推之后的深度取
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
      focus = this.resolveCursorFocus(mousePos);
    }

    if (focus && this.alignTargetDepthToFocus(focus.point)) {
      this.currentPivot = focus.point.clone();
      this.activeZoomFocus = focus.point.clone();
      this.activeZoomSource = 'wheel';
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
    this.wheelSelectionCenter = undefined;
  }

  /**
   * 清除 pivot 点（连同长按记住的旋转中心）
   */
  clearPivot(): void {
    this.currentPivot = null;
    this.activeRotatePivot = null;
    this.activeZoomFocus = null;
    this.activeZoomSource = null;
    this.rememberedPivot = null;
    this.wheelSelectionCenter = undefined;
    this.syncRememberedPivotMarker();
  }

  /**
   * 获取当前 pivot 点
   */
  getCurrentPivot(): Vector3 | null {
    return this.currentPivot;
  }

  /**
   * 长按记住的旋转中心；没记、或所在构件已经不在场景里了，返回 null
   */
  getRememberedPivot(): Vector3 | null {
    return this.getLiveRememberedPivot()?.point.clone() ?? null;
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
   * 更新（每帧调用）：相机或画布尺寸可能刚被别处改过，让旋转中心的标记跟上
   */
  update(): void {
    this.syncRememberedPivotMarker();
  }

  /**
   * 释放资源并还原 OrbitControls.update
   */
  dispose(): void {
    this.cancelActiveGesture();
    this.currentPivot = null;
    this.rememberedPivot = null;
    this.config.rememberedPivotMarker?.dispose();
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
    this.syncRememberedPivotMarker();
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

  /**
   * 平移不要惯性：拖动期间关掉 OrbitControls 的阻尼，每一步的位移当场走完，松手后没有剩下的可滑。
   * 关之前先让还没走完的惯性（比如上一次旋转留下的）当场停住，否则它会在平移的第一步里一次走完，画面一跳。
   */
  private suspendDampingForPan(): void {
    const { controls } = this;
    if (!controls.enableDamping) return;

    const camera = controls.object;
    const position = camera.position.clone();
    const quaternion = camera.quaternion.clone();
    const target = controls.target.clone();

    // OrbitControls 不给清惯性的入口：只有关着阻尼跑一次 update，剩下的才会走完并清零。走出来的位移不要，原样放回
    controls.enableDamping = false;
    this.origControlsUpdate();
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    controls.target.copy(target);
    // 拾取读的是 matrixWorld：下一帧渲染之前它也得是放回之后的样子
    camera.updateMatrixWorld();

    this.panDampingSuspended = true;
  }

  private restoreDampingAfterPan(): void {
    if (!this.panDampingSuspended) return;
    this.panDampingSuspended = false;
    this.controls.enableDamping = true;
  }

  private pickHover(mousePos: Vector2): PivotHoverHit | null {
    if (this.config.resolveHoverPoint) {
      const hit = this.config.resolveHoverPoint(mousePos);
      if (!hit) return null;
      return 'point' in hit ? hit : { point: hit };
    }
    const hit = this.selectionController.pickPoint(mousePos);
    return hit ? { point: hit.point, objectId: hit.objectId } : null;
  }

  /** 记住的旋转中心；所在构件已经不在场景里（换了模型、构件被移除）就当场丢掉 */
  private getLiveRememberedPivot(): RememberedPivot | null {
    const remembered = this.rememberedPivot;
    if (!remembered) return null;
    const { objectId } = remembered;
    if (
      objectId !== null &&
      typeof this.dtxLayer.hasObject === 'function' &&
      !this.dtxLayer.hasObject(objectId)
    ) {
      this.rememberedPivot = null;
      return null;
    }
    return remembered;
  }

  /** 记住的旋转中心此刻能不能用：所在构件得看得见，这一点得在画面里；不满足只是这一次不用，不丢 */
  private resolveRememberedPivot(): Vector3 | null {
    const remembered = this.getLiveRememberedPivot();
    if (!remembered) return null;
    const { point, objectId } = remembered;
    if (
      objectId !== null &&
      typeof this.dtxLayer.isObjectVisible === 'function' &&
      !this.dtxLayer.isObjectVisible(objectId)
    ) {
      return null;
    }
    return this.isPointOnScreen(point) ? point : null;
  }

  /** 把标记摆到记住的旋转中心此刻在画面上的位置；这一刻用不上它（没记、构件隐藏、出了画面）就收起来 */
  private syncRememberedPivotMarker(): void {
    const marker = this.config.rememberedPivotMarker;
    if (!marker) return;
    const point = this.resolveRememberedPivot();
    const viewport = point ? this.getViewportSize() : null;
    if (!point || !viewport) {
      marker.place(null);
      return;
    }
    const ndc = this.projectToNdc(point, this.tmpNdc);
    marker.place({
      x: (ndc.x * 0.5 + 0.5) * viewport.width,
      y: (0.5 - ndc.y * 0.5) * viewport.height,
    });
  }

  /** 画布的 CSS 像素尺寸；OrbitControls 挂在 document 上、或画布还没有尺寸时为 null */
  private getViewportSize(): { width: number; height: number } | null {
    const element = this.controls.domElement;
    if (!('clientWidth' in element)) return null;
    const { clientWidth: width, clientHeight: height } = element;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  /** 这一点在相机前方，投到屏幕上又落在画布范围内 */
  private isPointOnScreen(point: Vector3): boolean {
    if (!this.isPointInFrontOfCamera(point)) return false;
    const ndc = this.projectToNdc(point, this.tmpNdc);
    return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
  }

  private projectToNdc(point: Vector3, out: Vector3): Vector3 {
    const camera = this.controls.object;
    camera.updateMatrixWorld();
    return out.copy(point).project(camera);
  }

  /**
   * 当前选中构件联合包围盒的中心；中心不在画面里时返回 null。
   * `inWheelRound`：包围盒中心复用这一轮连续滚动里算过的（头一次用到时算）；它在不在画面里仍按此刻的相机现判
   */
  private resolveSelectionCenter(inWheelRound: boolean): Vector3 | null {
    let center: Vector3 | null;
    if (inWheelRound && this.wheelSelectionCenter !== undefined) {
      center = this.wheelSelectionCenter;
    } else {
      center = this.computeSelectionBoundsCenter();
      if (inWheelRound) this.wheelSelectionCenter = center;
    }

    // 中心在画面里才拿来当焦点：绕一个看不见的点转、朝它缩放，画面会往意料之外的方向跑
    return center && this.isPointOnScreen(center) ? center : null;
  }

  /** 当前选中构件（只算看得见的）联合包围盒的中心；没有可用的包围盒时返回 null */
  private computeSelectionBoundsCenter(): Vector3 | null {
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
    return box.getCenter(new Vector3());
  }

  /**
   * 空白处缩放的焦点：光标那条视线上、和当前旋转中心（target）同一深度的点。绕它缩放，光标下的位置不动，
   * 快慢和在画面正中滚一样。正交相机、画布还没有尺寸、算不出相机前方的点时返回 null（照旧绕 target 缩放）。
   */
  private resolveCursorFocus(mousePos: Vector2): ResolvedFocus | null {
    const camera = this.controls.object;
    const viewport = this.getViewportSize();
    if (!viewport || (camera as { isOrthographicCamera?: boolean }).isOrthographicCamera) return null;

    const forward = this.getForwardDirection(camera.position, this.controls.target, this.tmpVecC);
    const depth = this.tmpVecA.copy(this.controls.target).sub(camera.position).dot(forward);

    camera.updateMatrixWorld();
    const ray = new Vector3(
      (mousePos.x / viewport.width) * 2 - 1,
      1 - (mousePos.y / viewport.height) * 2,
      0.5,
    )
      .unproject(camera)
      .sub(camera.position);
    const point = ray.multiplyScalar(depth / ray.dot(forward)).add(camera.position);
    return this.isPointInFrontOfCamera(point) ? { point, source: 'cursor' } : null;
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

    const resolvedButton = this.resolvePointerButton(event);
    let mouseAction: MOUSE | null | undefined;
    switch (resolvedButton) {
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

  private resolvePointerButton(event: PointerEvent | MouseEvent): number | null {
    if (event.button === 0 || event.button === 1 || event.button === 2) {
      return event.button;
    }
    // W3C Pointer Events：pointermove 时 button 为 -1，按 buttons 位掩码读取当前按住的键
    if (event.button === -1 && typeof event.buttons === 'number') {
      if ((event.buttons & 1) !== 0) return 0;
      if ((event.buttons & 4) !== 0) return 1;
      if ((event.buttons & 2) !== 0) return 2;
    }
    return null;
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
   * 长按触发：只记下（或取消）旋转中心，相机、target、画面都不动。
   * 按在构件上 → 把按住的那一点记为旋转中心；按在空白处 → 取消已经记住的。
   */
  private onLongPress(): void {
    this.longPressTimer = null;
    if (!this.config.enabled || !this.controls.enabled || !this.canLongPress()) return;

    // 只认按下时光标正下方的表面命中：空白处按下即使焦点落在选中构件上，也算空白处
    const pressed = this.pendingFocus;
    if (pressed?.source === 'hover') {
      this.rememberedPivot = { point: pressed.point.clone(), objectId: pressed.objectId ?? null };
    } else {
      this.rememberedPivot = null;
      if (pressed?.source === 'remembered') {
        // 这次按下本来要绕它转：既然取消了，接下来的拖动回到绕画面正中
        this.pendingFocus = null;
        this.activeRotatePivot = null;
      }
    }
    this.syncRememberedPivotMarker();
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
