/**
 * 直段原型网格棱柱守卫（Prism）与截断矩阵重映射（1:1 移植自 `plant-ui/crates/plant-ui-view3d/src/room_clip.rs`，ADR-0028）。
 */
import { Matrix4, Vector3 } from 'three';

import { type Vec3Mm, transformPointMm } from './predicate';
import { MIN_PIECE_MM, type RoomSolid } from './roomSolid';

/** 断口薄饼世界厚度（2.0 mm）。 */
export const CAP_THICKNESS_MM = 2.0;

/** 断口薄饼截面 XY 放大系数（比管壁略宽 2%，压住共面 Z-fighting）。 */
export const CAP_SCALE = 1.02;

/** 洋红色断口颜色（`#D946EF`）。 */
export const SECTION_CAP_COLOR_HEX = 0xd946ef;

/** 沿局部 Z 轴拉伸的柱体端盖几何特征。 */
export type Prism = {
  cx: number;
  cy: number;
  z0: number;
  z1: number;
}

export type TubeClipPlan =
  | { kind: 'whole' }
  | { kind: 'hidden' }
  | { kind: 'cut'; pieces: [number, number][]; lengthMm: number }
  | { kind: 'skipped' };

/**
 * 检查原型网格是否为沿局部 Z 轴拉伸、全部顶点落在两端盖平面 `z0` / `z1` 上的直柱体（圆管 `CylinderV3` 或矩形风管 `BoxV1`）。
 *
 * 直接从顶点读取实际 `[z0, z1]`，兼容 `z ∈ [0, 1]`（圆管）与 `z ∈ [-0.5, 0.5]`（中心对称风管）。
 */
export function detectPrism(positions: ArrayLike<number>): Prism | null {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount < 6) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  if (spanX <= 1e-5 || spanY <= 1e-5 || spanZ <= 1e-5) return null;

  const zEps = spanZ * 1e-4;
  let lowMinX = Infinity;
  let lowMinY = Infinity;
  let lowMaxX = -Infinity;
  let lowMaxY = -Infinity;
  let highMinX = Infinity;
  let highMinY = Infinity;
  let highMaxX = -Infinity;
  let highMaxY = -Infinity;
  let lowCount = 0;
  let highCount = 0;

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    if (Math.abs(z - minZ) <= zEps) {
      lowCount++;
      if (x < lowMinX) lowMinX = x;
      if (y < lowMinY) lowMinY = y;
      if (x > lowMaxX) lowMaxX = x;
      if (y > lowMaxY) lowMaxY = y;
    } else if (Math.abs(z - maxZ) <= zEps) {
      highCount++;
      if (x < highMinX) highMinX = x;
      if (y < highMinY) highMinY = y;
      if (x > highMaxX) highMaxX = x;
      if (y > highMaxY) highMaxY = y;
    } else {
      // 中间存在非端盖环的顶点（如弯头、球面、多节异径管），不当棱柱截断
      return null;
    }
  }

  if (lowCount < 3 || highCount < 3) return null;

  const xyEps = Math.max(spanX, spanY) * 1e-3;
  if (
    Math.abs(lowMinX - highMinX) > xyEps ||
    Math.abs(lowMaxX - highMaxX) > xyEps ||
    Math.abs(lowMinY - highMinY) > xyEps ||
    Math.abs(lowMaxY - highMaxY) > xyEps
  ) {
    return null;
  }

  return {
    cx: 0.5 * (minX + maxX),
    cy: 0.5 * (minY + maxY),
    z0: minZ,
    z1: maxZ,
  };
}

/** 计算直段在世界毫米系下的轴线两端点 `a, b` 及总长 `lengthMm`。 */
export function computeTubeAxisMm(
  worldMatrixMm: Matrix4,
  prism: Prism,
): { a: Vec3Mm; b: Vec3Mm; lengthMm: number } {
  const a = transformPointMm(worldMatrixMm.elements, prism.cx, prism.cy, prism.z0);
  const b = transformPointMm(worldMatrixMm.elements, prism.cx, prism.cy, prism.z1);
  const lengthMm = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return { a, b, lengthMm };
}

/** 规划单根直段在 `RoomSolid` 下的截断方案。 */
export function planTubeClip(
  solid: RoomSolid,
  worldMatrixMm: Matrix4,
  prism: Prism,
): TubeClipPlan {
  const { a, b, lengthMm } = computeTubeAxisMm(worldMatrixMm, prism);
  if (!Number.isFinite(lengthMm) || lengthMm <= MIN_PIECE_MM) {
    return { kind: 'skipped' };
  }
  const pieces = solid.insideIntervals(a, b);
  if (pieces.length === 0) {
    return { kind: 'hidden' };
  }
  if (pieces.length === 1 && pieces[0]![0] === 0.0 && pieces[0]![1] === 1.0) {
    return { kind: 'whole' };
  }
  return { kind: 'cut', pieces, lengthMm };
}

/**
 * 将原直段变换矩阵重映射为子区间 `[t0, t1]` 的变换矩阵（毫米系）：
 * `M_piece = M * T(0, 0, za - z0 * k) * S(1, 1, k)`。
 */
export function buildPieceMatrix(
  worldMatrixMm: Matrix4,
  prism: Prism,
  interval: [number, number],
  target = new Matrix4(),
): Matrix4 {
  const [t0, t1] = interval;
  const span = prism.z1 - prism.z0;
  const za = prism.z0 + t0 * span;
  const k = t1 - t0;
  const tz = za - prism.z0 * k;

  const remap = new Matrix4().makeTranslation(0, 0, tz).scale(new Vector3(1, 1, k));
  return target.copy(worldMatrixMm).multiply(remap);
}

/**
 * 生成截点 `t ∈ (0, 1)` 处的断口薄饼变换矩阵（毫米系）：
 * 局部 Z 压成 `CAP_THICKNESS_MM`（2 mm），截面围绕 `(cx, cy)` 放大 `CAP_SCALE`（1.02）。
 */
export function buildCapMatrix(
  worldMatrixMm: Matrix4,
  prism: Prism,
  lengthMm: number,
  t: number,
  target = new Matrix4(),
): Matrix4 {
  const span = prism.z1 - prism.z0;
  const k = Math.min(CAP_THICKNESS_MM / Math.max(lengthMm, CAP_THICKNESS_MM), 0.25);
  const zMid = prism.z0 + t * span;
  const zCenter = 0.5 * (prism.z0 + prism.z1);
  const s = CAP_SCALE;

  const tx = prism.cx * (1.0 - s);
  const ty = prism.cy * (1.0 - s);
  const tz = zMid - zCenter * k;

  const remap = new Matrix4().makeTranslation(tx, ty, tz).scale(new Vector3(s, s, k));
  return target.copy(worldMatrixMm).multiply(remap);
}

/** 提取 `pieces` 中所有真正位于 `(0, 1)` 内部的截点参数（贴墙的原管头 `0.0` / `1.0` 不贴断口）。 */
export function collectInternalCutPoints(pieces: readonly [number, number][]): number[] {
  const points: number[] = [];
  for (const [t0, t1] of pieces) {
    if (t0 > 0.0) points.push(t0);
    if (t1 < 1.0) points.push(t1);
  }
  return points;
}