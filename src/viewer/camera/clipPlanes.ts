/**
 * 视口透视相机近/远裁剪面分档与外部标注外伸保护（#139）。
 *
 * 配合 `logarithmicDepthBuffer`，默认按模型包围盒对角线分档收紧 `near / far` 以保证深度精度；
 * 当已加载的 MBD 外部标注跨度远超模型本体（例如本体 `< 1 m` 而原点偏转角跨度 `16–19 m` 的复制设备）
 * 以致 `combinedDiagM * 10` 超出模型原档 `far` 时，按合并跨度扩展 `far`，并在 `far / near <= 2e4`
 * 深度比上限内尽量保持模型原有的 `near` 不变，避免小模型表面出现深度闪烁。
 */

export const MAX_CLIP_PLANE_RATIO = 2e4;

export type ClipPlanes = Readonly<{
  near: number;
  far: number;
}>;

export function computeClipPlanesByDiag(diag: number): ClipPlanes {
  const d = Math.max(0, Number(diag) || 0);
  if (d <= 1) return { near: 0.01, far: 20 };
  if (d <= 10) return { near: 0.05, far: 100 };
  if (d <= 100) return { near: 0.1, far: 1000 };
  if (d <= 1000) return { near: 1, far: 10000 };
  return { near: 5, far: Math.min(100000, Math.max(20000, d * 20)) };
}

function clampClipPlaneRatio(planes: ClipPlanes): ClipPlanes {
  let near = planes.near;
  let far = planes.far;
  if (far / near > MAX_CLIP_PLANE_RATIO) {
    near = Math.max(near, far / MAX_CLIP_PLANE_RATIO);
  }
  if (far <= near * 1.01) {
    far = near * 100;
  }
  return { near, far };
}

export function computeSceneClipPlanes(input: Readonly<{
  /** 模型几何包围盒对角线（米）；无模型几何时传 `0`。 */
  modelDiagM: number;
  /** 模型几何与已装外部尺寸标注合并后的包围盒对角线（米）；无外部标注时缺省或传 `null`。 */
  combinedDiagM?: number | null;
}>): ClipPlanes {
  const modelDiag = Math.max(0, Number(input.modelDiagM) || 0);
  const combinedDiag = Math.max(modelDiag, Number(input.combinedDiagM) || 0);

  if (modelDiag <= 0) {
    return clampClipPlaneRatio(computeClipPlanesByDiag(combinedDiag));
  }

  const base = computeClipPlanesByDiag(modelDiag);
  if (combinedDiag <= modelDiag) {
    return clampClipPlaneRatio(base);
  }

  const combinedBucket = computeClipPlanesByDiag(combinedDiag);
  const requiredFar = Math.min(combinedBucket.far, Math.ceil(combinedDiag * 10));
  const far = Math.max(base.far, requiredFar);
  return clampClipPlaneRatio({ near: base.near, far });
}
