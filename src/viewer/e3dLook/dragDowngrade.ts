/**
 * 拖动时临时降画质的判定（E3D 外观管线）：相机一动就降级，松手后阻尼 / 飞行还在动就继续延长，
 * 停稳 `graceMs` 后恢复，恢复的那一帧由宿主补画（按需出帧不会自己再画）。
 *
 * 只按着不动（点选）不降级，免得每次点选都闪一帧低画质；降级之后按着不放则保持降级，
 * 避免拖拖停停时离屏图反复重建。
 */

export const DRAG_DOWNGRADE_GRACE_MS = 200;

export interface DragDowngradeState {
  downgraded: boolean;
  /** 最近一次「相机在动 / 降级中按着」的时间戳（ms）；没有过为 -Infinity */
  lastActiveAt: number;
}

export interface DragDowngradeInput {
  /** 开关（`dtx_drag_downgrade=0` 关闭） */
  enabled: boolean;
  /** 这一帧主场景走不走 SGL 管线（非 E3D 样式不降级） */
  pipelineActive: boolean;
  /** 鼠标 / gizmo 是否按着（OrbitControls、gizmo 的 start..end） */
  held: boolean;
  /** 这一帧相机是否变了（含阻尼惯性、flyTo、滚轮） */
  cameraMoving: boolean;
  now: number;
}

export interface DragDowngradeStep {
  state: DragDowngradeState;
  /** 本步从降级回到全画质：宿主要补画一帧 */
  restored: boolean;
  /** 还在降级、但已经不活跃：宿主要在这个时刻再走一步（之前按需出帧可能已经停了） */
  restoreAt: number | null;
}

export function createDragDowngradeState(): DragDowngradeState {
  return { downgraded: false, lastActiveAt: -Infinity };
}

export function stepDragDowngrade(
  prev: DragDowngradeState,
  input: DragDowngradeInput,
  graceMs: number = DRAG_DOWNGRADE_GRACE_MS,
): DragDowngradeStep {
  if (!input.enabled || !input.pipelineActive) {
    return { state: createDragDowngradeState(), restored: prev.downgraded, restoreAt: null };
  }
  const active = input.cameraMoving || (input.held && prev.downgraded);
  if (active) {
    return { state: { downgraded: true, lastActiveAt: input.now }, restored: false, restoreAt: null };
  }
  if (!prev.downgraded) return { state: prev, restored: false, restoreAt: null };
  const restoreAt = prev.lastActiveAt + graceMs;
  if (input.now >= restoreAt) {
    return { state: { downgraded: false, lastActiveAt: prev.lastActiveAt }, restored: true, restoreAt: null };
  }
  return { state: prev, restored: false, restoreAt };
}

/** URL `?dtx_drag_downgrade=0` 或 localStorage `dtx_drag_downgrade=0` 关闭；URL 优先，默认开 */
export function isDragDowngradeEnabled(query: URLSearchParams, stored: string | null): boolean {
  const raw = query.get('dtx_drag_downgrade') ?? stored;
  return raw === null || raw.trim() !== '0';
}
