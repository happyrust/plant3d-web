/**
 * 把 DynamicPivotController 接到画布上：指针 / 滚轮监听，加上相机控制器的 `start`。
 *
 * 按下时只登记，不动焦点控制器；等 OrbitControls 在同一次 pointerdown 的派发里发出 `start`
 * （它认了这次按下，真的开始旋转 / 平移 / 缩放）才把这次按下交过去。
 * 按下被工具截走、相机控制器被禁用、按的是它不认的键，都等不到 `start`：这时什么都不做，
 * 不留候选焦点，也不起长按计时。
 *
 * 监听挂在捕获阶段，起拖的那一次 pointermove 和滚轮都先于 OrbitControls 自己的处理到达焦点控制器，
 * 它来得及在相机动之前把操作焦点对好。
 *
 * 另外带着「记住的旋转中心」那个小圆点的 DOM 实现（`createRememberedPivotMarker`）。
 */
import { Vector2 } from 'three';

import type { DynamicPivotController, RememberedPivotMarker } from './DynamicPivotController';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type DynamicPivotCanvasBindingOptions = {
  canvas: HTMLCanvasElement;
  controls: OrbitControls;
  /** 每次事件现取：焦点控制器可能晚于接线创建，也可能已经销毁 */
  getController: () => DynamicPivotController | null;
  /** 返回 true 时整套焦点逻辑让路（例如版本对比的分屏视图） */
  isSuspended?: () => boolean;
};

type PendingPress = {
  position: Vector2;
  event: PointerEvent;
};

/** `Event.eventPhase` 在事件没有处于派发中时的取值（`Event.NONE`） */
const EVENT_PHASE_NONE = 0;

/**
 * 建立接线，返回解除函数。
 */
export function bindDynamicPivotToCanvas(options: DynamicPivotCanvasBindingOptions): () => void {
  const { canvas, controls, getController } = options;
  const isSuspended = options.isSuspended ?? (() => false);
  let pendingPress: PendingPress | null = null;

  const toCanvasPosition = (event: MouseEvent): Vector2 => {
    const rect = canvas.getBoundingClientRect();
    return new Vector2(event.clientX - rect.left, event.clientY - rect.top);
  };

  const onPointerDown = (event: PointerEvent) => {
    pendingPress = isSuspended() ? null : { position: toCanvasPosition(event), event };
  };

  const onControlsStart = () => {
    const press = pendingPress;
    pendingPress = null;
    // 只认此刻还在派发中的那次按下：`start` 也会由滚轮发出，那时登记着的按下早已派发完（阶段归零），不能算数
    if (!press || press.event.eventPhase === EVENT_PHASE_NONE) return;
    getController()?.handleMouseDown(press.position, press.event);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (isSuspended()) return;
    getController()?.handleMouseMove(toCanvasPosition(event), event);
  };

  const onPointerUp = () => {
    pendingPress = null;
    getController()?.handleMouseUp();
  };

  const onWheel = (event: WheelEvent) => {
    if (isSuspended()) return;
    getController()?.handleWheel(toCanvasPosition(event), event);
  };

  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  canvas.addEventListener('pointermove', onPointerMove, { capture: true });
  canvas.addEventListener('pointerup', onPointerUp, { capture: true });
  canvas.addEventListener('pointercancel', onPointerUp, { capture: true });
  canvas.addEventListener('wheel', onWheel, { capture: true, passive: true });
  controls.addEventListener('start', onControlsStart);

  return () => {
    pendingPress = null;
    canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.removeEventListener('pointermove', onPointerMove, { capture: true });
    canvas.removeEventListener('pointerup', onPointerUp, { capture: true });
    canvas.removeEventListener('pointercancel', onPointerUp, { capture: true });
    canvas.removeEventListener('wheel', onWheel, { capture: true });
    controls.removeEventListener('start', onControlsStart);
  };
}

const REMEMBERED_PIVOT_DOT_SIZE_PX = 10;

/**
 * 「记住的旋转中心」的小圆点：叠在画布上的一个 DOM 元素，不进三维场景、不改构件颜色、不吃鼠标。
 *
 * 放进 `host`（查看器的叠加层）里：叠加层整体隐藏时（版本对比的分屏视图）它跟着隐藏，不用另外管。
 */
export function createRememberedPivotMarker(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
): RememberedPivotMarker {
  const half = REMEMBERED_PIVOT_DOT_SIZE_PX / 2;
  const dot = host.ownerDocument.createElement('div');
  dot.dataset.testid = 'dtx-remembered-pivot';
  dot.setAttribute('aria-hidden', 'true');
  Object.assign(dot.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${REMEMBERED_PIVOT_DOT_SIZE_PX}px`,
    height: `${REMEMBERED_PIVOT_DOT_SIZE_PX}px`,
    margin: `-${half}px 0 0 -${half}px`,
    boxSizing: 'border-box',
    border: '2px solid #ffffff',
    borderRadius: '50%',
    background: '#f97316',
    boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.6)',
    pointerEvents: 'none',
    display: 'none',
  });
  host.appendChild(dot);

  let shownAt: { x: number; y: number } | null = null;

  return {
    place(position) {
      if (!position) {
        if (shownAt) {
          dot.style.display = 'none';
          shownAt = null;
        }
        return;
      }
      // 叠加层里的东西别人也在管；万一被清掉了就再放回去
      if (!dot.isConnected) host.appendChild(dot);
      const hostRect = host.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const x = position.x + canvasRect.left - hostRect.left;
      const y = position.y + canvasRect.top - hostRect.top;
      if (shownAt && shownAt.x === x && shownAt.y === y) return;
      dot.style.transform = `translate(${x}px, ${y}px)`;
      if (!shownAt) dot.style.display = 'block';
      shownAt = { x, y };
    },
    dispose() {
      dot.remove();
      shownAt = null;
    },
  };
}
